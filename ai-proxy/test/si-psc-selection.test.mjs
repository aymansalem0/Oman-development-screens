import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {SiCandidateTargeting} from '../si-candidate-targeting.mjs';
import {SiPscSelection} from '../si-psc-selection.mjs';
import {buildC01Source} from '../si-candidate-agent.mjs';
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
  return {targeting,selection,// Windows Node 24 may observe transient Defender/indexer locks in fresh TEMP
    // workspaces. Retry ENOTEMPTY/EPERM/EBUSY only for this disposable test dir.
    cleanup:()=>rmSync(dir,{recursive:true,force:true,maxRetries:12,retryDelay:100})};
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
test('Saved PSC Excel events immediately receive the published quota shortlist, without inspection approval or AI invocation',async()=>{
  const w=setup({nmc:true});
  try{
    await imports(w.targeting,20);
    await w.targeting.receiveEvent(service(1));
    const d=await w.targeting.dashboard();
    assert.equal(d.summary.bySource.PSC_PORT_CALL,3);
    assert.equal(d.summary.bySource.NMC_CASE,1);
    assert.equal(d.summary.bySource.SERVICE_REQUEST,1);
    assert.equal(d.summary.candidates,5);
    assert.equal(buildC01Source(d,{version:1}).candidates.some(x=>
      x.sourceTypes.includes('PSC_PORT_CALL')),true);
    const pool=await w.selection.pool();
    assert.equal(pool.summary.eligiblePortCalls,20);
    assert.equal(pool.summary.inPoolPortCalls,17);
    assert.equal(pool.summary.automaticallyShortlistedPortCalls,3);
    assert.equal(pool.summary.selectedPortCalls,3);
    assert.equal((await w.selection._state()).decisions.length,0,
      'Derived rule shortlist must not write official PSC decision records');
    assert.equal(pool.summary.buckets.length,1);
    assert.equal(pool.summary.buckets[0].targetCount,3); // 15% POC, floor
    assert.equal(pool.summary.buckets[0].selectedCount,3);
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
    assert.equal((await w.selection.pool()).summary.selectedPortCalls,6);
    assert.equal((await w.targeting.dashboard()).summary.bySource.PSC_PORT_CALL,6);
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
    assert.equal(pool.summary.selectedPortCalls,3);
    assert.equal(pool.summary.notSelectedPortCalls,1);
    assert.ok(!((await w.selection.selectedEventKeys()).has(key)),
      'An explicit NOT_SELECT always excludes the event');
    await w.selection.decide(request(key,1,'SELECT'));
    pool=await w.selection.pool();
    assert.equal(pool.summary.selectedPortCalls,3);
    assert.equal(pool.summary.notSelectedPortCalls,0);
    assert.equal((await w.targeting.dashboard()).summary.candidates,3);
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

test('two distinct selected Port Calls for the same IMO consume two slots but create one vessel row',async()=>{
  const w=setup();
  try{
    for(let i=0;i<10;i++)await w.targeting.receiveEvent(
      psc(i,{imo:i<2?vessels[0].imo:vessels[i].imo}));
    await w.selection.publish({
      expectedVersion:1,
      config:{period:'MONTHLY',scope:'NATIONAL',ratePercent:30,
        portOverrides:[],mandatoryOutsideQuota:true},
      publishedBy:'PSC Supervisor',reason:'POC multi-arrival event count acceptance'
    });
    const p=await w.selection.pool();
    assert.equal(p.summary.buckets[0].targetCount,3);
    const matching=p.items.filter(x=>x.imo===vessels[0].imo);
    assert.equal(matching.length,2);
    for(const item of matching)await w.selection.decide(request(item.eventKey,2));
    const after=await w.selection.pool();
    assert.equal(after.summary.selectedPortCalls,3);
    const d=await w.targeting.dashboard();
    assert.equal(d.summary.bySource.PSC_PORT_CALL,2);
    assert.equal(d.summary.candidates,2);
    assert.equal(d.summary.candidateVessels,2);
    const repeated=d.vesselCandidates.find(x=>x.imo===vessels[0].imo);
    assert.equal(repeated.sourceEvents.length,2);
    assert.equal(repeated.sourceTypes.length,1);
  }finally{w.cleanup();}
});

test('Published 100% PSC policy shortlists all saved imported events immediately',async()=>{
 const w=setup();
 try{
  await imports(w.targeting,20);
  const policy=await w.selection.publish({expectedVersion:1,
   config:{period:'MONTHLY',scope:'NATIONAL',ratePercent:100,
     portOverrides:[],mandatoryOutsideQuota:true},
   publishedBy:'PSC Chief Officer',reason:'Explicit POC quota rate policy'});
  assert.equal(policy.config.ratePercent,100);
  const pool=await w.selection.pool();
  assert.equal(pool.summary.eligiblePortCalls,20);
  assert.equal(pool.summary.selectedPortCalls,20);
  assert.equal(pool.summary.automaticallyShortlistedPortCalls,20);
  assert.equal(pool.summary.buckets[0].remainingSlots,0);
  assert.equal((await w.targeting.dashboard()).summary.bySource.PSC_PORT_CALL,20);
  assert.equal((await w.selection._state()).decisions.length,0);
 }finally{w.cleanup();}
});
test('New Excel PSC arrivals automatically recalculate quota without duplicating manual selection',async()=>{
 const w=setup();
 try{
  await imports(w.targeting,10);
  let pool=await w.selection.pool();
  assert.equal(pool.summary.buckets[0].targetCount,1);
  const explicit=pool.items[0].eventKey;
  await w.selection.decide(request(explicit,1,'SELECT'));
  assert.equal((await w.selection.pool()).summary.selectedPortCalls,1);
  for(let i=10;i<20;i++)await w.targeting.receiveEvent(psc(i));
  pool=await w.selection.pool();
  assert.equal(pool.summary.buckets[0].targetCount,3);
  assert.equal(pool.summary.selectedPortCalls,3);
  assert.equal(pool.summary.automaticallyShortlistedPortCalls,2);
  assert.ok((await w.selection.selectedEventKeys()).has(explicit));
  assert.equal((await w.selection._state()).decisions.length,1,
    'Recalculation must remain read-only, retaining old human audit');
 }finally{w.cleanup();}
});
test('Manual quota selections are preserved after a stricter policy, without auto-overfilling',async()=>{
 const w=setup();
 try{
  await imports(w.targeting,20);
  const p=await w.selection.pool();
  for(const item of p.items.slice(0,3))
   await w.selection.decide(request(item.eventKey,1));
  const updated=await w.selection.publish({expectedVersion:1,
   config:{period:'MONTHLY',scope:'NATIONAL',ratePercent:5,
    portOverrides:[],mandatoryOutsideQuota:true},
   publishedBy:'Chief PSC Officer',reason:'Revised POC quota after assessment'});
  assert.equal(updated.version,2);
  const pool=await w.selection.pool();
  assert.equal(pool.summary.selectedPortCalls,3);
  assert.equal(pool.summary.automaticallyShortlistedPortCalls,0);
  assert.equal(pool.summary.buckets[0].targetCount,1);
  assert.equal(pool.summary.buckets[0].overQuota,true);
 }finally{w.cleanup();}
});
