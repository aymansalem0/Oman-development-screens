import test from 'node:test';
import assert from 'node:assert/strict';
import {tmpdir} from 'node:os';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {SiInspectionLifecycle} from '../si-inspection-lifecycle.mjs';
const CASE=randomUUID();
function harness({nmc=false}={}){
  const folder=mkdtempSync(join(tmpdir(),'si-cycle-'));
  const prep={saved:{status:'PREPARED',version:1,dossier:null},
    stale:false,context:{baseChecklistItemIds:[
      'fire-safety','certificates','navigation','lifesaving',
      'pollution','manning','hull-machinery','security'],
      provenance:'SYNTHETIC_POC_NOT_OFFICIAL_SOURCE',externalDocumentsVerified:false}};
  const c={id:CASE,imo:'9328471',regime:nmc?'FOCUSED_INSPECTION':'UAE_SERVICE_INSPECTION',
    status:'CREATED',approvedBy:'Supervisor',nmcReferralId:nmc?'REF123':null};
  const deps={
    mode:'json',file:join(folder,'state.json'),
    targeting:{
      inspectionCase:async()=>c,
      dashboard:async()=>({candidates:[{
        status:'INSPECTION_CREATED',imo:c.imo,regime:c.regime,vesselName:'Demo Vessel',
        currentRisk:null,events:[],inspectionCase:{id:CASE,approvedBy:'Supervisor'}}]})
    },
    preparation:{get:async()=>({...prep,context:prep.context})},
    cases:{listInspectionRequests:async()=>[{
      id:'REF123',imo:c.imo,status:'SCHEDULED',port:'JEA',
      inspector:'Inspector',scheduledAt:'2026-10-15T06:00:00.000Z'}]}
  };
  const store=new SiInspectionLifecycle(deps);
  const step=async(action,actor,data={})=>{
    const before=await store.saved(CASE);
    return store.apply(CASE,{action,expectedVersion:before?.version||0,actor,data});
  };
  return {store,step,prep,folder,cleanup:()=>rmSync(folder,{force:true,recursive:true})};
}
const withReason={reason:'Authorized supervisor decision after evidence review'};
async function start(h,nmc=false){
  await h.step('INITIALIZE','Officer');
  await h.step('APPROVE_SCOPE','Supervisor',withReason);
  await h.step('ASSIGN','Coordinator',{inspector:'Inspector',port:'JEA',
    startLocal:'2026-10-15T10:00',mode:nmc?'NMC_SCHEDULED':'POC_MANUAL'});
  await h.step('START_FIELD','Inspector');
}
function results(major){
  const ids=['fire-safety','certificates','navigation','lifesaving',
    'pollution','manning','hull-machinery','security'];
  return ids.map((id,i)=>({id,status:major&&i===0?'DEFICIENCY':'PASS',
    severity:major&&i===0?'MAJOR':null,note:major&&i===0?'Damaged fire safety hose':'',
    naReason:'',evidenceRefs:major&&i===0?['EV-001']:[]}));
}
test('no-findings case: controlled end-to-end stage transitions and closure',async()=>{
  const h=harness();
  try{
    await assert.rejects(h.step('ASSIGN','Operator',{}),e=>e.code==='SI_LIFECYCLE_STAGE_CONFLICT');
    await start(h);
    await h.step('SAVE_CHECKS','Inspector',{checks:results(false)});
    await h.step('SUBMIT_FIELD','Inspector',{summary:'All checks completed'});
    await h.step('APPROVE_REPORT','Supervisor',withReason);
    await h.step('CLOSE','Supervisor',withReason);
    const snapshot=await h.store.snapshot(CASE);
    assert.equal(snapshot.record.stage,'CLOSED');
    assert.equal(snapshot.record.report.aiGenerated,false);
    assert.equal(snapshot.record.closure.nmcRiskRecalculated,false);
    assert.equal(snapshot.record.audit.length,8);
    await assert.rejects(h.step('START_FIELD','Inspector'),e=>e.code==='SI_LIFECYCLE_ALREADY_CLOSED');
  }finally{h.cleanup();}
});
test('major deficiency: evidence, correction, verification, failed follow-up and rework',async()=>{
  const h=harness();
  try{
    await start(h);
    await assert.rejects(h.step('SUBMIT_FIELD','Inspector'),e=>e.code==='SI_ALL_CHECKS_REQUIRED');
    await h.step('SAVE_CHECKS','Inspector',{checks:results(true)});
    await h.step('SUBMIT_FIELD','Inspector');
    await h.step('APPROVE_REPORT','Supervisor',withReason);
    const r0=await h.store.saved(CASE);
    assert.equal(r0.findings.length,1);
    await assert.rejects(h.step('CLOSE','Supervisor',withReason),e=>e.code==='SI_LIFECYCLE_STAGE_CONFLICT');
    await h.step('ISSUE_ACTIONS','Supervisor',{
      ...withReason,actions:[{findingId:r0.findings[0].id,owner:'Action Owner',
        dueDate:'2026-11-01',instruction:'Replace damaged hose'}]});
    let action=(await h.store.saved(CASE)).actions[0];
    await assert.rejects(h.step('SUBMIT_ACTION','Not Owner',{
      actionId:action.id,evidenceRefs:['PHOTO-001']}),e=>e.code==='SI_ACTION_OWNER_REQUIRED');
    await h.step('SUBMIT_ACTION','Action Owner',{actionId:action.id,evidenceRefs:['PHOTO-001']});
    await h.step('VERIFY_ACTION','Supervisor',{...withReason,actionId:action.id,decision:'ACCEPT'});
    await h.step('RECORD_FOLLOW_UP','Supervisor',{...withReason,mode:'ON_SITE',result:'FAIL'});
    assert.equal((await h.store.saved(CASE)).stage,'ACTIONS_OPEN');
    await h.step('SUBMIT_ACTION','Action Owner',{actionId:action.id,evidenceRefs:['PHOTO-002']});
    await h.step('VERIFY_ACTION','Supervisor',{...withReason,actionId:action.id,decision:'ACCEPT'});
    await h.step('RECORD_FOLLOW_UP','Supervisor',{...withReason,mode:'DESK_REVIEW',result:'PASS'});
    await h.step('CLOSE','Supervisor',withReason);
    assert.equal((await h.store.saved(CASE)).stage,'CLOSED');
    assert.equal((await h.store.saved(CASE)).followUps.length,2);
  }finally{h.cleanup();}
});
test('NMC origin cannot be falsely labeled as confirmed by a manual or mismatched visit',async()=>{
  const h=harness({nmc:true});
  try{
    await h.step('INITIALIZE','Officer');
    await h.step('APPROVE_SCOPE','Supervisor',withReason);
    await assert.rejects(h.step('ASSIGN','Coordinator',{
      inspector:'Inspector',port:'JEA',startLocal:'2026-10-15T10:00',mode:'POC_MANUAL'
    }),e=>e.code==='SI_NMC_SCHEDULING_REQUIRED');
    await assert.rejects(h.step('ASSIGN','Coordinator',{
      inspector:'Other',port:'JEA',startLocal:'2026-10-15T10:00',mode:'NMC_SCHEDULED'
    }),e=>e.code==='SI_NMC_CONFIRMED_ASSIGNMENT_MISMATCH');
    await h.step('ASSIGN','Coordinator',{inspector:'Inspector',port:'JEA',
      startLocal:'2026-10-15T10:00',mode:'NMC_SCHEDULED'});
    assert.equal((await h.store.saved(CASE)).assignment.operationalValidity,'NMC_CONFIRMED');
  }finally{h.cleanup();}
});
test('optimistic concurrency prevents an older browser from overwriting the case',async()=>{
  const h=harness();
  try{
    await h.step('INITIALIZE','Officer');
    await assert.rejects(h.store.apply(CASE,{
      action:'APPROVE_SCOPE',expectedVersion:0,actor:'Supervisor',data:withReason
    }),e=>e.code==='SI_LIFECYCLE_VERSION_CONFLICT');
  }finally{h.cleanup();}
});
