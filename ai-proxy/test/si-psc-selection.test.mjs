import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {SiCandidateTargeting} from '../si-candidate-targeting.mjs';
import {SiPscSelection} from '../si-psc-selection.mjs';
import {buildSiPrioritySnapshot} from '../si-ai-prioritization.mjs';
const vessels=Array.from({length:50},(_,i)=>({
  imo:String(9100000+i),
  inlineContext:{vessel:{name:'PSC Vessel '+i,flag:'UAE',vesselType:'CARGO'}}
}));
const refs=[{id:'11111111-1111-4111-8111-111111111111',
  caseId:'22222222-2222-4222-8222-222222222222',
  imo:vessels[0].imo,status:'PENDING_SCHEDULING',caseStatus:'IN_PROGRESS',
  reason:'Human approved NMC referral',createdAt:'2026-10-09T10:00:00Z',
  evidenceIds:['NMC-001'],sourceAssessmentId:'ASSESSMENT-1'}];
function setup({nmc=false,risk=[]}={}){
  const dir=mkdtempSync(join(tmpdir(),'si-quota-'));
  const targeting=new SiCandidateTargeting({mode:'json',
    file:join(dir,'targeting.json'),bundles:vessels,
    cases:{listInspectionRequests:async()=>nmc?refs:[]},
    riskPolicy:{ready:true,projectCurrent:async()=>({
      policyRevision:2,projections:risk
    })}});
  const selection=new SiPscSelection({mode:'json',targeting,file:join(dir,'selection.json')});
  targeting.pscSelection=selection;
  return {targeting,selection,cleanup:()=>rmSync(dir,{recursive:true,force:true})};
}
function psc(n,{port='Jebel Ali',imo=vessels[n%50].imo,eta='2026-10-15T08:00'}={}){
  return {sourceType:'PSC_PORT_CALL',sourceEventId:'PSC-'+n,
    sourceReference:'UAE-PSC-POC-'+n,imo,requestedRegime:'PORT_STATE_CONTROL',
    port,eta,sourceApprovalStatus:'UNVERIFIED',provenance:'POC_SIMULATOR',
    createdBy:'Test Operator',evidenceIds:[]};
}
function service(n,imo=vessels[0].imo){
  return {sourceType:'SERVICE_REQUEST',sourceEventId:'SR-'+n,
    sourceReference:'UAE-SERVICE-'+n,imo,requestedRegime:'UAE_SERVICE_INSPECTION',
    port:'Jebel Ali',sourceApprovalStatus:'UNVERIFIED',
    provenance:'POC_SIMULATOR',createdBy:'Test Operator'};
}
async function imports(t,total=20,port='Jebel Ali'){
  for(let i=0;i<total;i++)await t.receiveEvent(psc(i,{port}));
}
const request=(eventKey,policyVersion,action='SELECT')=>({
  eventKey,expectedPolicyVersion:policyVersion,action,
  actor:'Maritime PSC Supervisor',reason:'Reviewed maritime targeting evidence'
});
test('PSC Excel creates targeting pool records, NOT pending inspection candidates or AI inputs',async()=>{
  const w=setup({nmc:true});
  try{
    await imports(w.targeting,20);
    await w.targeting.receiveEvent(service(1));
    const d=await w.targeting.dashboard();
    assert.equal(d.summary.bySource.PSC_PORT_CALL,0);
    assert.equal(d.summary.bySource.NMC_CASE,1);
    assert.equal(d.summary.bySource.SERVICE_REQUEST,1);
    assert.equal(d.summary.candidates,2);
    assert.equal(buildSiPrioritySnapshot(d).items.some(x=>
      x.inspectionRegime==='PORT_STATE_CONTROL'),false);
    const pool=await w.selection.pool();
    assert.equal(pool.summary.eligiblePortCalls,20);
    assert.equal(pool.summary.inPoolPortCalls,20);
    assert.equal(pool.summary.buckets.length,1);
    assert.equal(pool.summary.buckets[0].targetCount,3); // 15% POC, floor
    assert.equal(pool.summary.buckets[0].selectedCount,0);
    assert.equal(pool.items.length,20);
  }finally{w.cleanup();}
});
test('publisher selects PSC source events within quota; other source IMOs unchanged',async()=>{
  const w=setup();
  try{
    await imports(w.targeting,20);
    const pool=await w.selection.pool();
    const keys=pool.items.slice(0,4).map(x=>x.eventKey);
    for(const key of keys.slice(0,3))await w.selection.decide(request(key,1));
    await assert.rejects(()=>w.selection.decide(request(keys[3],1)),
      e=>e.code==='SI_SELECTION_QUOTA_EXHAUSTED');
    const after=await w.selection.pool();
    assert.equal(after.summary.selectedPortCalls,3);
    assert.equal(after.summary.inPoolPortCalls,17);
    assert.equal(after.summary.buckets[0].remainingSlots,0);
    const d=await w.targeting.dashboard();
    assert.equal(d.summary.bySource.PSC_PORT_CALL,3);
    assert.equal(d.summary.candidates,3);
    assert.equal(d.summary.candidateVessels,3);
    assert.ok(d.candidates.every(c=>c.events.every(e=>
      keys.slice(0,3).includes(e.eventKey))));
    await assert.rejects(()=>w.selection.decide(request(keys[0],1)),
      e=>e.code==='SI_SELECTION_ALREADY_DECIDED');
    const latest=await w.selection.selectedEventKeys();
    assert.equal(latest.size,3);
  }finally{w.cleanup();}
});
test('one IMO can have Service Request while PSC port call stays outside candidate center',async()=>{
  const w=setup();
  try{
    await w.targeting.receiveEvent(psc(1,{imo:vessels[0].imo}));
    await w.targeting.receiveEvent(service(1));
    let d=await w.targeting.dashboard();
    assert.equal(d.vesselCandidates.length,1);
    assert.deepEqual(d.vesselCandidates[0].sourceTypes,['SERVICE_REQUEST']);
    const pool=await w.selection.pool();
    assert.equal(pool.summary.eligiblePortCalls,1);
    assert.equal(pool.summary.buckets[0].targetCount,0);
    await assert.rejects(()=>w.selection.decide(request(pool.items[0].eventKey,1)),
      e=>e.code==='SI_SELECTION_QUOTA_EXHAUSTED');
    assert.equal((await w.targeting.dashboard()).summary.bySource.PSC_PORT_CALL,0);
  }finally{w.cleanup();}
});
test('monthly quotas respect per-port scope, version checks and clear impact preview',async()=>{
  const w=setup();
  try{
    await imports(w.targeting,10,'Jebel Ali');
    for(let i=10;i<20;i++)await w.targeting.receiveEvent(psc(i,{port:'Khalifa'}));
    const current=await w.selection.policy();
    assert.equal(current.config.scope,'NATIONAL');
    const cfg={period:'MONTHLY',scope:'PER_PORT',ratePercent:20,
      portOverrides:[{port:'Khalifa',ratePercent:40}],
      mandatoryOutsideQuota:true};
    const preview=await w.selection.previewPolicy(cfg);
    assert.equal(preview.status,'PREVIEW_ONLY_NO_AI');
    assert.deepEqual(preview.summary.map(b=>b.targetCount),[2,4]);
    assert.equal((await w.selection.policy()).version,1);
    const published=await w.selection.publish({config:cfg,expectedVersion:1,
      publishedBy:'Chief PSC Officer',reason:'POC national and port example'});
    assert.equal(published.version,2);
    await assert.rejects(()=>w.selection.publish({config:cfg,expectedVersion:1,
      publishedBy:'Chief PSC Officer',reason:'POC repeat attempt'}),
      e=>e.code==='SI_SELECTION_POLICY_VERSION_CONFLICT');
    const pool=await w.selection.pool();
    assert.equal(pool.summary.buckets.length,2);
    assert.equal(pool.summary.buckets.find(b=>b.port==='JEBEL ALI').targetCount,2);
    assert.equal(pool.summary.buckets.find(b=>b.port==='KHALIFA').targetCount,4);
    await assert.rejects(()=>w.selection.decide(request(pool.items[0].eventKey,1)),
      e=>e.code==='SI_SELECTION_POLICY_VERSION_CONFLICT');
    await w.selection.decide(request(pool.items[0].eventKey,2));
    assert.equal((await w.selection.pool()).summary.selectedPortCalls,1);
    assert.equal((await w.targeting.dashboard()).summary.bySource.PSC_PORT_CALL,1);
  }finally{w.cleanup();}
});
test('NOT_SELECT requires audit, remains in pool, can be changed by publisher with quota',async()=>{
  const w=setup();
  try{
    await imports(w.targeting,20);
    const p=await w.selection.pool(),key=p.items[0].eventKey;
    await assert.rejects(()=>w.selection.decide({...request(key,1),reason:'short'}),
      e=>e.code==='SI_SELECTION_DECISION_INVALID');
    await w.selection.decide(request(key,1,'NOT_SELECT'));
    let pool=await w.selection.pool();
    assert.equal(pool.summary.notSelectedPortCalls,1);
    assert.equal(pool.summary.selectedPortCalls,0);
    assert.equal((await w.targeting.dashboard()).summary.candidates,0);
    await w.selection.decide(request(key,1,'SELECT'));
    pool=await w.selection.pool();
    assert.equal(pool.summary.selectedPortCalls,1);
    assert.equal(pool.summary.notSelectedPortCalls,0);
    assert.equal((await w.targeting.dashboard()).summary.candidates,1);
  }finally{w.cleanup();}
});
test('quota policy cannot contain invalid scope, rate or duplicate port overrides',async()=>{
  const w=setup();
  try{
    for(const cfg of [
      {period:'MONTHLY',scope:'NATIONAL',ratePercent:130,portOverrides:[],mandatoryOutsideQuota:true},
      {period:'MONTHLY',scope:'PER_PORT',ratePercent:15,portOverrides:[
        {port:'Khalifa',ratePercent:20},{port:'KHALIFA',ratePercent:30}
      ],mandatoryOutsideQuota:true},
      {period:'MONTHLY',scope:'NATIONAL',ratePercent:15,portOverrides:[
        {port:'Khalifa',ratePercent:30}],mandatoryOutsideQuota:true}
    ])await assert.rejects(()=>w.selection.previewPolicy(cfg),
      e=>e.code==='SI_SELECTION_POLICY_INVALID');
  }finally{w.cleanup();}
});
