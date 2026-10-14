import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SiScheduleOrders} from '../si-schedule-orders.mjs';

const uuid=n=>String(n).padStart(8,'0')+'-0000-4000-8000-000000000000';
const slot=(imo,inspector='ENG-1',start='2026-10-20T06:00:00.000Z')=>{
 const at=Date.parse(start);
 return {imo,inspectorId:inspector,inspectorName:'POC Inspector 1',
  portId:'JEA',portName:'Jebel Ali',startUtc:start,
  endUtc:new Date(at+2*3600000).toISOString(),
  startLocal:'2026-10-20T10:00',endLocal:'2026-10-20T12:00',
  locationName:'POC Berth 01',optionId:'ERP-OPT-1'};
};
const reasons=[{eventKey:'PSC-EVENT-01',candidateKey:'CK-1',
 sourceType:'PSC_PORT_CALL',sourceEventId:'PSC-1',
 sourceReference:'PSC-POC-1',inspectionRegime:'PORT_STATE_CONTROL',
 sourceApproval:'SOURCE_FINAL',reason:null,evidenceIds:['EV-1'],
 sourceProvenance:null}];
const plan=(id=uuid(1))=>({id,number:'IP-POC',
 status:'APPROVED',revision:2,approvedVessels:[{
  imo:'9400643',planRank:1,regimes:['PORT_STATE_CONTROL'],
  inspectionReasons:reasons}]});
const proposal=(p=plan(),start='2026-10-20T06:00:00.000Z')=>({
 planId:p.id,planRevision:p.revision,
 proposalHash:'a'.repeat(64),erpSnapshotId:'ERP-POC',
 summary:{total:1,proposed:1,unscheduled:0},
 variants:[{optionId:'SI-S01-VALID',assignments:[slot('9400643','ENG-1',start)]}]
});
function workspace({mandatory=true}={}){
 const directory=mkdtempSync(join(tmpdir(),'si-orders-test-'));
 const p=plan(),calls={caseCreates:0,checklistCreates:0,ai:0};
 let caseObj=null,prep=null,checklistStarted=false;
 let lifecycle=null;
 const targeting={
  dashboard:async()=>({candidates:[{
   imo:'9400643',key:'CK-1',regime:'PORT_STATE_CONTROL',
   status:caseObj?'HANDLED':'PENDING_REVIEW',
   events:[{sourceType:'PSC_PORT_CALL',sourceEventId:'PSC-1',
    eventKey:'PSC-EVENT-01',sourceReference:'PSC-POC-1',
    approval:'SOURCE_FINAL',contextNote:null,evidenceIds:['EV-1'],
    provenance:null}]}]}),
  inspectionCaseRegistry:async()=>({cases:caseObj?[caseObj]:[]}),
  inspectionCase:async id=>caseObj?.id===id?caseObj:null,
  decideBatch:async ({items,approvedPlanId})=>{
   calls.caseCreates++;
   assert.equal(items.length,1);
   assert.equal(items[0].candidateKey,'CK-1');
   assert.deepEqual(items[0].inspectionReasons,reasons);
   caseObj={id:uuid(2),imo:'9400643',approvedPlanId,status:'CREATED'};
   return {cases:[caseObj]};
  }
 };
 const preparation={
  provider:'mock',get:async()=>({
   saved:prep,stale:false,canGenerate:true}),
  prepare:async()=>{prep={version:1,status:'PREPARED'};return {saved:prep};},
  generate:async()=>{calls.ai++;prep={...prep,version:2,status:'DRAFT_REVIEW'};
   return {saved:prep};}
 };
 const checklists={
  preview:async()=>({selectedTemplates:mandatory?[{
   mandatory:true,itemCount:12}]:[]}),
  start:async()=>{if(!checklistStarted){calls.checklistCreates++;
    checklistStarted=true;}return {status:'IN_PROGRESS'};}
 };
 const lifecycleApi={
  snapshot:async()=>({record:lifecycle?structuredClone(lifecycle):null}),
  apply:async (caseId,{action,expectedVersion,actor,data})=>{
   assert.equal(caseId,uuid(2));
   assert.equal(expectedVersion,lifecycle?.version||0);
   if(action==='INITIALIZE')lifecycle={version:1,stage:'PREPARATION_READY'};
   else if(action==='ADD_SCOPE')lifecycle.version++;
   else if(action==='APPROVE_SCOPE'){
    assert.ok(data.reason.length>=8);
    lifecycle={...lifecycle,version:lifecycle.version+1,stage:'SCOPE_APPROVED'};
   }else if(action==='ASSIGN'){
    assert.equal(data.inspector,'POC Inspector 1');
    lifecycle={...lifecycle,version:lifecycle.version+1,stage:'ASSIGNED'};
   }else if(action==='START_FIELD'){
    assert.equal(actor,'POC Inspector 1');
    lifecycle={...lifecycle,version:lifecycle.version+1,stage:'IN_FIELD'};
   }else throw Error('unexpected '+action);
   return {record:lifecycle};
  }
 };
 const orders=new SiScheduleOrders({mode:'json',file:join(directory,'orders.json'),
  rolling:{get:async id=>id===p.id?p:plan(id)},
  targeting,preparation,checklists,lifecycle:lifecycleApi,
  cases:{listInspectionRequests:async()=>[]}});
 const approve=async(opts={})=>orders.approve({
  plan:p,proposal:proposal(p),selectedOptionId:'SI-S01-VALID',
  expectedHash:'a'.repeat(64),expectedPlanRevision:2,
  actor:'supervisor@moei',reason:'Approved qualified engineering plan',
  confirmApproval:true,demoMode:true,...opts});
 return {orders,approve,p,calls,done:()=>rmSync(directory,{recursive:true,force:true}),
  lifecycle:()=>lifecycle};
}
test('supervisor issues one idempotent schedule and inspector work order, no case before activation',async()=>{
 const x=workspace();try{
  const first=await x.approve(),repeat=await x.approve();
  assert.equal(first.id,repeat.id);
  assert.equal(first.orders.length,1);
  assert.equal(first.orders[0].status,'ISSUED');
  assert.equal(first.operationalBookingConfirmed,false);
  assert.equal(x.calls.caseCreates,0);
  assert.equal((await x.orders.byPlan(x.p.id)).orders[0].imo,'9400643');
 }finally{x.done();}
});
test('activate work order creates case, mandatory checklist, optional A04 draft and explicit field cycle',async()=>{
 const x=workspace();try{
  const saved=await x.approve(),orderId=saved.orders[0].id;
  const activated=await x.orders.activate({planId:x.p.id,orderId,
   actor:'supervisor@moei',generateAi:true,confirmAiCost:true});
  assert.equal(activated.status,'READY_FOR_SCOPE_REVIEW');
  assert.equal(activated.checklistStatus,'MANDATORY_PUBLISHED_TEMPLATE_SNAPSHOT');
  assert.equal(activated.aiStatus,'A04_DRAFT_REVIEW_PENDING');
  assert.equal(x.calls.caseCreates,1);
  assert.equal(x.calls.checklistCreates,1);
  assert.equal(x.calls.ai,1);
  await x.orders.activate({planId:x.p.id,orderId,
   actor:'supervisor@moei'});
  assert.equal(x.calls.caseCreates,1,'second click must not create case');
  const scoped=await x.orders.approveScope({planId:x.p.id,orderId,
   actor:'supervisor@moei',reason:'Mandatory statutory scope checked'});
  assert.equal(scoped.status,'READY_FOR_FIELD');
  await assert.rejects(()=>x.orders.startField({planId:x.p.id,orderId,
    actor:'unassigned@moei'}),e=>e.code==='SI_WORK_ORDER_ONLY_ASSIGNED_INSPECTOR_CAN_START');
  const started=await x.orders.startField({planId:x.p.id,orderId,
   actor:'supervisor@moei',confirmPocDelegation:true});
  assert.equal(started.status,'FIELD_STARTED');
  assert.equal(started.pocDelegated,true);
  assert.equal(x.lifecycle().stage,'IN_FIELD');
  assert.equal((await x.orders.byPlan(x.p.id)).orders[0].status,'FIELD_STARTED');
 }finally{x.done();}
});
test('missing published mandatory checklist blocks activation safely without creating another case',async()=>{
 const x=workspace({mandatory:false});try{
  const schedule=await x.approve(),id=schedule.orders[0].id;
  await assert.rejects(()=>x.orders.activate({planId:x.p.id,orderId:id,
   actor:'operator@moei'}),e=>e.code==='SI_WORK_ORDER_PUBLISH_MANDATORY_CHECKLIST_FIRST');
  assert.equal(x.calls.caseCreates,1);
  assert.equal(x.calls.checklistCreates,0);
  const saved=await x.orders.byPlan(x.p.id);
  assert.equal(saved.orders[0].status,'PREPARATION_NEEDS_REVIEW');
  assert.equal(saved.orders[0].caseId,uuid(2));
 }finally{x.done();}
});
test('approval refuses unscheduled vessels, stale hash and colliding inspector slots',async()=>{
 const x=workspace();try{
  for(const p of [
   {...proposal(x.p),variants:[{optionId:'SI-S01-VALID',assignments:[]}]},
   {...proposal(x.p),proposalHash:'b'.repeat(64)}
  ])await assert.rejects(()=>x.approve({proposal:p}),
   e=>e.code?.startsWith('SI_SCHED_'));
  await x.approve();
  const other=plan(uuid(3));
  await assert.rejects(()=>x.approve({
   plan:other,proposal:proposal(other),expectedPlanRevision:2}),
   e=>e.code==='SI_SCHED_ENGINEER_ALREADY_ASSIGNED_TO_OTHER_PLAN');
  assert.equal((await x.orders.all()).length,1);
 }finally{x.done();}
});
