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
  rolling:{
   get:async id=>id===p.id?p:plan(id),
   attachScheduledCase:async(planId,imo,caseId)=>{
    assert.equal(planId,p.id);
    const item=p.approvedVessels.find(v=>v.imo===imo);
    if(!item.caseId){item.caseId=caseId;p.revision++;}
   },
   setExecutionState:async(planId,status)=>{
    assert.equal(planId,p.id);
    if(p.status!==status){p.status=status;p.revision++;}
   }
  },
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

test('PR125 inspector roster is limited to ERP identity mapping on PR124 canonical orders',async()=>{
 const previous=process.env.SI_V2_INSPECTOR_IDENTITY_MAP_JSON;
 process.env.SI_V2_INSPECTOR_IDENTITY_MAP_JSON=
  JSON.stringify({'engineer@moei.example':'ENG-1','another@moei.example':'ENG-99'});
 const x=workspace();
 try{
  const saved=await x.approve(),orderId=saved.orders[0].id;
  assert.equal((await x.orders.mine('stranger@moei.example')).length,0);
  assert.equal((await x.orders.mine('another@moei.example')).length,0);
  const assigned=await x.orders.mine('engineer@moei.example');
  assert.equal(assigned.length,1);
  assert.equal(assigned[0].orderId,orderId);
  assert.equal(assigned[0].planId,x.p.id);
  await x.orders.activate({planId:x.p.id,orderId,actor:'supervisor@moei'});
  await x.orders.approveScope({planId:x.p.id,orderId,
   actor:'supervisor@moei',reason:'Mandated items independently reviewed'});
  await assert.rejects(()=>x.orders.startField({
   planId:x.p.id,orderId,actor:'supervisor@moei'}),
   e=>e.code==='SI_WORK_ORDER_ONLY_ASSIGNED_INSPECTOR_CAN_START');
  const started=await x.orders.startField({
   planId:x.p.id,orderId,actor:'engineer@moei.example',confirmPocDelegation:false});
  assert.equal(started.status,'FIELD_STARTED');
  assert.equal(started.startedByInspectorId,'ENG-1');
  assert.equal(started.pocDelegated,false);
 }finally{
  x.done();
  if(previous===undefined)delete process.env.SI_V2_INSPECTOR_IDENTITY_MAP_JSON;
  else process.env.SI_V2_INSPECTOR_IDENTITY_MAP_JSON=previous;
 }
});
test('non-MOCK schedule cannot use supervisor POC delegation for field start',async()=>{
 const x=workspace();
 try{
  const saved=await x.approve({demoMode:false}),orderId=saved.orders[0].id;
  await x.orders.activate({planId:x.p.id,orderId,actor:'supervisor@moei'});
  await x.orders.approveScope({planId:x.p.id,orderId,
   actor:'supervisor@moei',reason:'Mandatory items approved'});
  await assert.rejects(()=>x.orders.startField({
   planId:x.p.id,orderId,actor:'supervisor@moei',confirmPocDelegation:true}),
   e=>e.code==='SI_POC_DELEGATION_ONLY_FOR_MOCK_SCHEDULE');
 }finally{x.done();}
});

test('cross-port work orders require a separate positive supervisor confirmation, then are audited',async()=>{
 const x=workspace();
 try{
  const p=proposal(x.p);
  p.variants[0].assignments[0]={
   ...p.variants[0].assignments[0],
   crossPort:true,originPortId:'FUJ',originPortName:'Fujairah',
   travelMinutes:30,manualReasons:['CROSS_PORT_REQUIRES_APPROVAL']
  };
  await assert.rejects(()=>x.approve({proposal:p}),e=>
   e.code==='SI_SCHED_CROSS_PORT_SUPERVISOR_CONFIRMATION_REQUIRED');
  assert.equal((await x.orders.all()).length,0);
  const saved=await x.approve({proposal:p,confirmCrossPort:true});
  assert.equal(saved.crossPortApprovalConfirmed,true);
  assert.equal(saved.crossPortApprovalBy,'supervisor@moei');
  assert.deepEqual(saved.crossPortOrders,[{
   imo:'9400643',inspectorId:'ENG-1',fromPortId:'FUJ',
   toPortId:'JEA',travelMinutes:30
  }]);
  assert.equal(saved.orders[0].assignment.crossPort,true);
  assert.equal(saved.orders[0].assignment.originPortId,'FUJ');
  assert.equal(saved.operationalBookingConfirmed,false);
 }finally{x.done();}
});
test('cross-port approval refuses missing travel or supervisor-approval evidence',async()=>{
 const x=workspace();
 try{
  const p=proposal(x.p);
  p.variants[0].assignments[0]={
   ...p.variants[0].assignments[0],
   crossPort:true,originPortId:'FUJ',travelMinutes:-1,manualReasons:[]
  };
  await assert.rejects(()=>x.approve({proposal:p,confirmCrossPort:true}),
   e=>e.code==='SI_SCHED_CROSS_PORT_TRAVEL_OR_APPROVAL_EVIDENCE_INVALID');
  assert.equal((await x.orders.all()).length,0);
 }finally{x.done();}
});


test('Oracle 019 supervisor approval uses valid bind names and matching bind objects for all three writes',async()=>{
 const x=workspace();
 const writes=[];
 const connection={
  async execute(sql,binds={}){
   if(sql.startsWith('INSERT INTO SI_SCHED_')){
    const placeholders=[...sql.matchAll(/:([A-Za-z_][A-Za-z_0-9]*)/g)]
      .map(match=>match[1]);
    assert.ok(placeholders.length>0,'INSERT must be bound');
    assert.ok(placeholders.every(name=>/^b_[a-z][a-z_0-9]*$/.test(name)),
      'avoid reserved Oracle bind identifiers such as MODE / STATUS / SCHEDULE');
    assert.deepEqual([...new Set(placeholders)].sort(),
      Object.keys(binds).sort(),
      'SQL and node-oracledb bind object must use identical names');
    writes.push({sql,binds});
   }
   return {rows:[],rowsAffected:1};
  },
  async commit(){assert.fail('shared rolling-plan approval controls commit')},
  async rollback(){assert.fail('shared rolling-plan approval controls rollback')}
 };
 try{
  x.orders.mode='oracle';
  const output=await x.approve({connection});
  assert.equal(output.orders.length,1);
  assert.equal(output.orders[0].imo,'9400643');
  assert.deepEqual(writes.map(x=>
    x.sql.match(/^INSERT INTO ([A-Z_]+)/)[1]),[
    'SI_SCHED_APPROVAL','SI_SCHED_WORK_ORDER','SI_SCHED_ORDER_AUDIT']);
  assert.equal(writes[1].binds.b_inspector_id,'ENG-1');
  assert.equal(writes[1].binds.b_imo,'9400643');
  assert.equal(writes[1].binds.b_start_utc,'2026-10-20T06:00:00.000Z');
  assert.equal(writes[0].binds.b_mode_code,'POC_MOCK');
 }finally{x.done();}
});

test('Oracle 019 write failure keeps precise work-order SQL stage for outer atomic rollback',async()=>{
 const x=workspace();
 let commitCount=0;
 const connection={
  async execute(sql,binds={}){
   if(sql.startsWith('INSERT INTO SI_SCHED_WORK_ORDER')){
    assert.equal(binds.b_inspector_id,'ENG-1');
    const failure=new Error('Do not return inspector private data');
    failure.code='ORA-01745';failure.errorNum=1745;
    throw failure;
   }
   return {rows:[],rowsAffected:1};
  },
  async commit(){commitCount++;}
 };
 try{
  x.orders.mode='oracle';
  await assert.rejects(()=>x.approve({connection}),e=>
    e.code==='ORA-01745'&&
    e.scheduleSqlStage==='WORK_ORDER_INSERT');
  assert.equal(commitCount,0,
    'shared outer transaction is responsible for rollback and commit');
 }finally{x.done();}
});
