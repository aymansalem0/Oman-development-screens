import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {SiV2ScheduleApproval} from '../si-v2-schedule-approval.mjs';
const planId='11111111-1111-4111-8111-111111111111';
const caseId='22222222-2222-4222-8222-222222222222';
function workspace({approvedAi=true,mandatory=true}={}){
 const dir=mkdtempSync(join(tmpdir(),'moei-si-wo-'));
 const steps=[],metadata=[];
 let lifecycle=null,checklist=null;
 const preparation={get:async()=>({
  stale:false,saved:approvedAi?{
   status:'APPROVED',review:{actor:'reviewer@moei',reason:'Evidence reviewed and checklist scope approved'},
   dossier:{suggestedAdditionalItems:[{title:'Inspect cargo security seals'}]}}
  :{status:'PREPARED',dossier:null}})};
 const engine=new SiV2ScheduleApproval({
  mode:'json',file:join(dir,'orders.json'),
  rolling:{get:async()=>({status:'APPROVED'})},
  targeting:{inspectionCase:async()=>({id:caseId,nmcReferralId:null})},
  preparation,erp:{},scheduler:{},cases:{},
  lifecycle:{
   snapshot:async()=>({record:lifecycle}),
   apply:async(_case,{action,expectedVersion,actor,data})=>{
    assert.equal(_case,caseId);
    assert.equal(expectedVersion,lifecycle?.version||0);
    steps.push({action,actor,data});
    const version=(lifecycle?.version||0)+1;
    const stage={INITIALIZE:'PREPARATION_READY',ADD_SCOPE:'PREPARATION_READY',
     APPROVE_SCOPE:'SCOPE_APPROVED',ASSIGN:'ASSIGNED',START_FIELD:'IN_FIELD'}[action];
    lifecycle={version,stage};
    return {record:lifecycle};
   }
  },
  checklists:{
   preview:async()=>({selectedTemplates:mandatory?[{
    mandatory:true,itemCount:4,templateId:'MANDATORY-PSC'
   }]:[],saved:checklist}),
   start:async(id,actor)=>{
    assert.equal(id,caseId);
    assert.equal(actor,'Engineer Alpha');
    metadata.push({id,actor});
    checklist={caseId:id,version:1,
     templates:[{mandatory:true,templateId:'MANDATORY-PSC'}]};
    return checklist;
   }
  }
 });
 const schedule={id:'33333333-3333-4333-8333-333333333333',
  planId,planRevision:3,status:'DOSSIERS_PREPARED_SCOPE_APPROVAL_PENDING',
  proposalHash:'a'.repeat(64),erpSnapshotId:'ERP-SAVED',
  approvedBy:'supervisor@moei',approvalReason:'Reviewed and approved all visit assignments',
  approvedAt:'2026-10-14T05:00:00Z',updatedAt:'2026-10-14T05:00:00Z',
  items:[{imo:'9400643',caseId,orderId:'44444444-4444-4444-8444-444444444444',
   orderStatus:'ISSUED',dossierStatus:'APPROVED',dispatchStatus:'DOSSIER_PREPARED',
   assignment:{inspectorId:'ENG-01',inspectorName:'Engineer Alpha',
    startUtc:'2026-10-20T05:00:00Z',portName:'Jebel Ali'}}],
  audit:[]};
 return {engine,dir,steps,metadata,schedule,cleanup:()=>rmSync(dir,{recursive:true,force:true})};
}
test('engineer execution combines published mandatory templates and separately approved A04 additions',async()=>{
 const w=workspace();
 try{
  await w.engine.initialize();w.engine.write([w.schedule]);
  assert.equal((await w.engine.mine('ENG-01')).length,1);
  assert.equal((await w.engine.mine('other-user')).length,0);
  const r=await w.engine.executeOrder({
   planId,imo:'9400643',actor:'ENG-01',confirmExecution:true});
  assert.equal(r.status,'IN_EXECUTION');
  assert.deepEqual(r.mandatoryTemplates,['MANDATORY-PSC']);
  assert.deepEqual(r.approvedAiAdditionalItems,['Inspect cargo security seals']);
  assert.deepEqual(w.steps.map(s=>s.action),[
   'INITIALIZE','ADD_SCOPE','APPROVE_SCOPE','ASSIGN','START_FIELD']);
  assert.equal(w.steps.find(x=>x.action==='ADD_SCOPE').actor,'reviewer@moei');
  assert.equal(w.steps.find(x=>x.action==='START_FIELD').actor,'Engineer Alpha');
  assert.equal(w.metadata.length,1);
  const persisted=await w.engine.get(planId);
  assert.equal(persisted.items[0].orderStatus,'IN_EXECUTION');
  assert.equal(persisted.items[0].aiAdditionalItemsApproved,1);
  const again=await w.engine.executeOrder({
   planId,imo:'9400643',actor:'ENG-01',confirmExecution:true});
  assert.equal(again.alreadyStarted,true);
  assert.equal(w.metadata.length,1,'retry cannot recreate checklist');
 }finally{w.cleanup();}
});
test('execution cannot claim supervisor identity as inspector or start without consent',async()=>{
 const w=workspace();
 try{
  await w.engine.initialize();w.engine.write([w.schedule]);
  await assert.rejects(()=>w.engine.executeOrder({
   planId,imo:'9400643',actor:'supervisor@moei',confirmExecution:true}),
   e=>e.code==='SI_V2_ONLY_ASSIGNED_ENGINEER_MAY_EXECUTE');
  await assert.rejects(()=>w.engine.executeOrder({
   planId,imo:'9400643',actor:'ENG-01',confirmExecution:false}),
   e=>e.code==='SI_V2_WORK_ORDER_EXECUTION_INVALID');
  assert.equal((await w.engine.get(planId)).items[0].orderStatus,'ISSUED');
  assert.equal(w.steps.length,0);
 }finally{w.cleanup();}
});
test('unreviewed AI advice never becomes a mandatory or supplementary inspector task',async()=>{
 const w=workspace({approvedAi:false});
 try{
  await w.engine.initialize();w.engine.write([w.schedule]);
  const r=await w.engine.executeOrder({
   planId,imo:'9400643',actor:'ENG-01',confirmExecution:true});
  assert.deepEqual(r.approvedAiAdditionalItems,[]);
  assert.equal(w.steps.some(x=>x.action==='ADD_SCOPE'),false);
  assert.deepEqual(r.mandatoryTemplates,['MANDATORY-PSC']);
 }finally{w.cleanup();}
});
test('missing published mandatory checklist blocks execution before lifecycle creation',async()=>{
 const w=workspace({mandatory:false});
 try{
  await w.engine.initialize();w.engine.write([w.schedule]);
  await assert.rejects(()=>w.engine.executeOrder({
   planId,imo:'9400643',actor:'ENG-01',confirmExecution:true}),
   e=>e.code==='SI_V2_MANDATORY_CHECKLISTS_NOT_PUBLISHED');
  assert.equal(w.steps.length,0);
  assert.equal((await w.engine.get(planId)).items[0].orderStatus,'ISSUED');
 }finally{w.cleanup();}
});
