import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SiV2ScheduleApproval} from '../si-v2-schedule-approval.mjs';

function fixture(){
 const folder=mkdtempSync(join(tmpdir(),'si-work-order-test-'));
 const planId='11111111-1111-4111-8111-111111111111';
 const caseId='22222222-2222-4222-8222-222222222222';
 const imo='9400643',actor='inspector@moei.example';
 const original=process.env.SI_V2_INSPECTOR_IDENTITY_MAP_JSON;
 process.env.SI_V2_INSPECTOR_IDENTITY_MAP_JSON=JSON.stringify({
  [actor]:'INSPECTOR-ERP-01'
 });
 const operations=[],lifecycle={record:null};
 const before={
  planId,id:'33333333-3333-4333-8333-333333333333',
  status:'DOSSIERS_PREPARED_SCOPE_APPROVAL_PENDING',
  approvedBy:'supervisor@moei.example',
  approvalReason:'Approved inspected source and qualified engineer assignment',
  items:[{imo,orderId:'44444444-4444-4444-8444-444444444444',
    orderStatus:'ISSUED',caseId,dispatchStatus:'DOSSIER_PREPARED',
    dossierStatus:'APPROVED',
    assignment:{inspectorId:'INSPECTOR-ERP-01',
     inspectorName:'POC Engineer One',portId:'JEA',portName:'Jebel Ali',
     startUtc:'2026-10-20T07:00:00.000Z',endUtc:'2026-10-20T09:00:00.000Z'}}],
  audit:[]
 };
 const preparation={
  async get(){return {stale:false,saved:{
   status:'APPROVED',version:3,dossier:{suggestedAdditionalItems:[
    {title:'Additional lifejacket audit from reviewed A04'}
   ]},review:{actor:'supervisor@moei.example',
     reason:'Approve evidence-supported additional lifejacket check'}}};}
 };
 const field={starts:0,async start(_id,who){
   this.starts++;assert.equal(who,'POC Engineer One');
   return {version:1,templates:[{templateId:'MANDATORY-PSC',
     mandatory:true,groups:[{items:[{id:'psc-1',mandatory:true}]}]}]};
 },async preview(){return {saved:{version:1,templates:[{templateId:'MANDATORY-PSC'}]}}}};
 const lc={
  async snapshot(){return {record:lifecycle.record?structuredClone(lifecycle.record):null};},
  async apply(_id,{action,data,actor:who,expectedVersion}){
   assert.equal(expectedVersion,lifecycle.record?.version||0);
   operations.push({action,data,actor:who});
   let r=lifecycle.record||{version:0,stage:null};
   const stages={INITIALIZE:'PREPARATION_READY',ADD_SCOPE:'PREPARATION_READY',
    APPROVE_SCOPE:'SCOPE_APPROVED',ASSIGN:'ASSIGNED',START_FIELD:'IN_FIELD'};
   lifecycle.record={...r,stage:stages[action],version:r.version+1};
   return lifecycle.record;
  }
 };
 const targeting={async inspectionCase(){return {id:caseId,imo}}};
 const svc=new SiV2ScheduleApproval({mode:'json',file:join(folder,'approvals.json'),
  rolling:{},targeting,preparation,erp:{},scheduler:{},cases:{},
  lifecycle:lc,checklists:field});
 svc.write([before]);svc.ready=true;
 return {svc,planId,caseId,imo,actor,operations,field,dispose(){
  if(original===undefined)delete process.env.SI_V2_INSPECTOR_IDENTITY_MAP_JSON;
  else process.env.SI_V2_INSPECTOR_IDENTITY_MAP_JSON=original;
  rmSync(folder,{recursive:true,force:true});
 }};
}
test('issued order belongs only to authenticated ERP-mapped inspector',async()=>{
 const f=fixture();try{
  assert.equal((await f.svc.mine(f.actor)).length,1);
  assert.deepEqual(await f.svc.mine('unrelated@moei.example'),[]);
  await assert.rejects(f.svc.executeOrder({planId:f.planId,imo:f.imo,
   actor:'supervisor@moei.example',confirmExecution:true}),
   e=>e.code==='SI_V2_ONLY_ASSIGNED_ENGINEER_MAY_EXECUTE'&&e.status===403);
  assert.equal(f.field.starts,0);
 }finally{f.dispose();}
});
test('work order seeds mandatory checklist and review-approved A04 scope once',async()=>{
 const f=fixture();try{
  const started=await f.svc.executeOrder({planId:f.planId,imo:f.imo,
   actor:f.actor,confirmExecution:true});
  assert.equal(started.status,'IN_EXECUTION');
  assert.equal(started.caseId,f.caseId);
  assert.deepEqual(started.mandatoryTemplates,['MANDATORY-PSC']);
  assert.deepEqual(started.approvedAiAdditionalItems,
   ['Additional lifejacket audit from reviewed A04']);
  assert.deepEqual(f.operations.map(o=>o.action),
   ['INITIALIZE','ADD_SCOPE','APPROVE_SCOPE','ASSIGN','START_FIELD']);
  assert.equal(f.field.starts,1);
  const second=await f.svc.executeOrder({planId:f.planId,imo:f.imo,
   actor:f.actor,confirmExecution:true});
  assert.equal(second.alreadyStarted,true);
  assert.equal(f.field.starts,1);
  assert.equal((await f.svc.mine(f.actor)).length,1);
  assert.equal((await f.svc.get(f.planId)).items[0].executedByIdentity,f.actor);
 }finally{f.dispose();}
});
