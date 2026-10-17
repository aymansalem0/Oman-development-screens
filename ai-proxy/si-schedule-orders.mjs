/**
 * SI-S02: persist an officer-approved, ERP-feasible schedule and issue one
 * traceable work order per IMO. The official statutory sources remain in
 * SI_INSPECTION_CASE and SI_PLAN_ROLLING. Oracle 019 is authoritative.
 *
 * No silent paid AI call; A04 suggestions remain draft until a publisher
 * explicitly reviews them. No claim of an ERP booking from Excel POC data.
 */
import {randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync,renameSync,existsSync,mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import oracledb from 'oracledb';
import {resolveAssignedInspector,matchesAssignedInspector,pocInspectorIdForActor} from './si-inspector-identity.mjs';
import {sourceVerified} from './si-integrated-capacity-plan.mjs';

const id=()=>randomUUID(),at=()=>new Date().toISOString();
const clone=v=>structuredClone(v);
const doc=v=>({val:JSON.stringify(v),type:oracledb.DB_TYPE_CLOB});
/** Bind values are never logged. The stage is a fixed non-sensitive ID. */
const executeApprovalWrite=async(con,stage,statement,params)=>{
 try{return await con.execute(statement,params);}
 catch(error){
  if(error&&typeof error==='object'&&!error.scheduleSqlStage)
   error.scheduleSqlStage=stage;
  throw error;
 }
};
const UUID=/^[a-f0-9-]{36}$/i;
const label=(v,max=180)=>typeof v==='string'&&v.trim().length&&
 v.trim().length<=max?v.trim():null;
const err=(code,status=409)=>{throw new SiWorkOrderError(code,status);};
export class SiWorkOrderError extends Error{
 constructor(code,status=409){super(code);this.code=code;this.status=status;}
}
const overlap=(a,b)=>a.inspectorId===b.inspectorId&&
 Date.parse(a.startUtc)<Date.parse(b.endUtc)&&
 Date.parse(b.startUtc)<Date.parse(a.endUtc);
const okSlot=o=>o&&/^[0-9]{7}$/.test(o.imo)&&
 label(o.inspectorId,120)&&label(o.inspectorName,120)&&
 label(o.portId,100)&&label(o.portName,120)&&
 Number.isFinite(Date.parse(o.startUtc))&&Number.isFinite(Date.parse(o.endUtc))&&
 Date.parse(o.endUtc)>Date.parse(o.startUtc);
// The scheduler stores UAE-local times as YYYY-MM-DD HH:mm, while the
// inspection lifecycle ASSIGN contract requires YYYY-MM-DDTHH:mm.
// Normalize notation only: no timezone conversion or guessed date.
export function lifecycleLocalStart(value){
 const source=label(value,40);
 if(!source||!/^\d{4}-\d\d-\d\d[ T]\d\d:\d\d$/.test(source))
  err('SI_ASSIGNMENT_SCHEDULE_START_INVALID',422);
 const normalized=source.replace(' ','T');
 const utc=Date.parse(normalized+':00+04:00');
 if(!Number.isFinite(utc)||
    new Date(utc+4*3600000).toISOString().slice(0,16)!==normalized)
  err('SI_ASSIGNMENT_SCHEDULE_START_INVALID',422);
 return normalized;
}
const batchReason=r=>({
 eventKey:r.eventKey,candidateKey:r.candidateKey,
 sourceType:r.sourceType,sourceEventId:r.sourceEventId,
 sourceReference:r.sourceReference,inspectionRegime:r.inspectionRegime,
 sourceApproval:r.sourceApproval,reason:r.reason,
 evidenceIds:r.evidenceIds,sourceProvenance:r.sourceProvenance
});
export class SiScheduleOrders{
 constructor({mode='json',oracleRepository=null,rolling,targeting,preparation,
  checklists,lifecycle,cases,
  resolveInspectorIdentity=matchesAssignedInspector,
  file=process.env.SI_SCHEDULE_ORDERS_PATH||
   '/data/si-schedule-work-orders.json'}={}){
  if(!rolling||!targeting||!preparation||!checklists||!lifecycle||!cases)
   throw Error('SI_SCHEDULE_ORDERS_CONFIGURATION_REQUIRED');
  Object.assign(this,{mode,oracle:oracleRepository,rolling,targeting,preparation,
   checklists,lifecycle,cases,file});
  this.ready=mode==='json';this.processing=new Set();this.approving=false;
  this.resolveInspectorIdentity=resolveInspectorIdentity;
 }
 async db(fn){
  if(!this.oracle?.pool)err('SI_SCHED_ORACLE_POOL_UNAVAILABLE',503);
  const con=await this.oracle.pool.getConnection();
  try{return await fn(con);}finally{await con.close();}
 }
 async initialize(){
  if(this.mode==='json'){this.read();this.ready=true;return;}
  await this.db(async con=>{
   const rows=await con.execute("SELECT TABLE_NAME FROM USER_TABLES "+
    "WHERE TABLE_NAME IN ('SI_SCHED_MUTEX','SI_SCHED_APPROVAL',"+
    "'SI_SCHED_WORK_ORDER','SI_SCHED_ORDER_AUDIT')",[],{
    outFormat:oracledb.OUT_FORMAT_OBJECT});
   if(rows.rows.length!==4)err('SI_SCHED_MIGRATION_019_REQUIRED',503);
  });
  this.ready=true;
 }
 assertReady(){if(!this.ready)err('SI_SCHED_MIGRATION_019_REQUIRED',503);}
 read(){
  if(!existsSync(this.file))return [];
  try{
   const value=JSON.parse(readFileSync(this.file,'utf8'));
   if(Array.isArray(value))return value;
  }catch{}
  err('SI_SCHED_STORE_CORRUPT',503);
 }
 write(rows){
  mkdirSync(dirname(this.file),{recursive:true});
  const temp=this.file+'.'+id()+'.tmp';
  writeFileSync(temp,JSON.stringify(rows,null,2),{mode:0o600});
  renameSync(temp,this.file);
 }
 async _records(con=null){
  if(this.mode==='json')return this.read();
  const r=await con.execute('SELECT DOC_JSON FROM SI_SCHED_APPROVAL',[],{
   outFormat:oracledb.OUT_FORMAT_OBJECT,
   fetchInfo:{DOC_JSON:{type:oracledb.STRING}}});
  const approvals=r.rows.map(x=>JSON.parse(x.DOC_JSON));
  for(const item of approvals){
   const q=await con.execute('SELECT DOC_JSON FROM SI_SCHED_WORK_ORDER '+
     'WHERE SCHEDULE_ID=:id ORDER BY CREATED_AT,IMO',{id:item.id},{
      outFormat:oracledb.OUT_FORMAT_OBJECT,
      fetchInfo:{DOC_JSON:{type:oracledb.STRING}}});
   item.orders=q.rows.map(x=>JSON.parse(x.DOC_JSON));
  }
  return approvals;
 }
 async byPlan(planId){
  this.assertReady();
  if(!UUID.test(planId||''))err('SI_SCHED_PLAN_ID_INVALID',422);
  const schedules=this.mode==='json'?this.read():
   await this.db(con=>this._records(con));
  return clone(schedules.find(x=>x.planId===planId)||null);
 }
 async all(){
  this.assertReady();
  return clone(this.mode==='json'?this.read():await this.db(con=>this._records(con)));
 }
 /**
  * Read-only roster for the signed-in ERP inspector from canonical Oracle 019.
  * User identity is validated server-side; no actor value from the browser.
  */
 async mine(actor){
  this.assertReady();
  if(!label(actor,160))err('SI_WORK_ORDER_AUTHENTICATED_INSPECTOR_REQUIRED',403);
  const schedules=await this.all();
  return schedules.flatMap(schedule=>schedule.orders
   .filter(order=>Boolean(this.resolveInspectorIdentity(actor,order.assignment,schedule.mode)))
   .map(order=>({
    planId:schedule.planId,scheduleId:schedule.id,orderId:order.id,
    imo:order.imo,
    vesselName:this.targeting.bundles?.find(x=>x.imo===order.imo)
      ?.inlineContext?.vessel?.name||('IMO '+order.imo),
    status:order.status,caseId:order.caseId,
    assignment:order.assignment,mode:schedule.mode,
    isMyPocEngineer:schedule.mode==='POC_MOCK'&&
      order.assignment?.inspectorId===pocInspectorIdForActor(actor),
    checklistStatus:order.checklistStatus,aiStatus:order.aiStatus,
    scopeStatus:order.scopeStatus,
    canSelfConfirmScope:schedule.mode==='POC_MOCK'&&
      process.env.SI_POC_INSPECTOR_SELF_SCOPE_ENABLED==='true'
   })));
 }
 /** Case-scoped access without trusting a browser-supplied employee ID. */
 async mineOrder(actor,orderId){
   this.assertReady();
   if(!UUID.test(orderId||''))err('SI_WORK_ORDER_ID_INVALID',422);
   const schedules=await this.all();
   for(const schedule of schedules){
     const order=schedule.orders.find(x=>x.id===orderId);
     if(!order)continue;
     if(!this.resolveInspectorIdentity(actor,order.assignment,schedule.mode))
       err('SI_WORK_ORDER_NOT_ASSIGNED_TO_SESSION',403);
     return {schedule,order};
   }
   err('SI_WORK_ORDER_NOT_FOUND',404);
 }
 async order(planId,orderId){
  const schedule=await this.byPlan(planId);
  if(!schedule)err('SI_SCHED_APPROVAL_NOT_FOUND',404);
  const order=schedule.orders.find(o=>o.id===orderId);
  if(!order)err('SI_WORK_ORDER_NOT_FOUND',404);
  return {schedule,order};
 }
 async approve({plan,proposal,selectedOptionId,expectedHash,
  expectedPlanRevision,actor,reason,confirmApproval,demoMode=false,
  confirmCrossPort=false,connection=null}={}){
  this.assertReady();
  if(!UUID.test(plan?.id||'')||!label(actor,160)||!label(reason,500)||
   reason.trim().length<8||confirmApproval!==true||
   !Number.isInteger(expectedPlanRevision)||
   !/^[a-f0-9]{64}$/i.test(expectedHash||'')||
   !label(selectedOptionId,80))
   err('SI_SCHED_APPROVAL_FIELDS_INVALID',422);
  if(plan.status!=='APPROVED'||plan.revision!==expectedPlanRevision||
   proposal.planId!==plan.id||proposal.planRevision!==plan.revision||
   proposal.proposalHash!==expectedHash)
   err('SI_SCHED_APPROVAL_STALE_RECALCULATE',409);
  const variant=proposal.variants?.find(v=>v.optionId===selectedOptionId);
  if(!variant||!Array.isArray(variant.assignments)||
   variant.assignments.length!==plan.approvedVessels.length||
   proposal.summary.total!==variant.assignments.length||
   variant.assignments.some(x=>!okSlot(x))||
   new Set(variant.assignments.map(x=>x.imo)).size!==variant.assignments.length||
   variant.assignments.some(x=>!plan.approvedVessels.some(v=>v.imo===x.imo)))
   err('SI_SCHED_ALL_VESSELS_MUST_HAVE_VALID_ASSIGNMENT',409);
  const crossPortAssignments=variant.assignments.filter(a=>a.crossPort===true);
  if(crossPortAssignments.some(a=>!label(a.originPortId,100)||
    a.originPortId===a.portId||
    !Number.isFinite(a.travelMinutes)||a.travelMinutes<0||
    (demoMode&&!a.manualReasons?.includes('CROSS_PORT_REQUIRES_APPROVAL'))))
   err('SI_SCHED_CROSS_PORT_TRAVEL_OR_APPROVAL_EVIDENCE_INVALID',409);
  if(crossPortAssignments.length&&confirmCrossPort!==true)
   err('SI_SCHED_CROSS_PORT_SUPERVISOR_CONFIRMATION_REQUIRED',422);
  for(let i=0;i<variant.assignments.length;i++)
   for(let j=i+1;j<variant.assignments.length;j++)
    if(overlap(variant.assignments[i],variant.assignments[j]))
     err('SI_SCHED_ENGINEER_OVERLAP',409);
  if(this.approving)err('SI_SCHED_APPROVAL_IN_PROGRESS',409);
  this.approving=true;
  try{
   const perform=async con=>{
    if(con)await con.execute('SELECT LOCK_ID FROM SI_SCHED_MUTEX '+
      'WHERE LOCK_ID=1 FOR UPDATE');
    const previous=await this._records(con);
    const existing=previous.find(x=>x.planId===plan.id);
    if(existing){
     if(existing.proposalHash===expectedHash&&
        existing.optionId===selectedOptionId)return existing;
     err('SI_SCHED_ALREADY_APPROVED_REVIEW_ORDERS',409);
    }
    for(const other of previous)for(const o of other.orders){
     if(other.planId===plan.id)continue;
     if(variant.assignments.some(a=>overlap(a,o.assignment)))
      err('SI_SCHED_ENGINEER_ALREADY_ASSIGNED_TO_OTHER_PLAN',409);
    }
    const approvedAt=at(),scheduleId=id();
    const orders=variant.assignments.map(a=>({
     id:id(),scheduleId,planId:plan.id,imo:a.imo,
     planRank:plan.approvedVessels.find(v=>v.imo===a.imo).planRank,
     assignment:clone(a),status:'ISSUED',version:1,caseId:null,
     checklistStatus:'NOT_PREPARED',aiStatus:'NOT_REQUESTED',
     scopeStatus:'NOT_APPROVED',createdAt:approvedAt,updatedAt:approvedAt,
     issuedBy:actor.trim(),error:null,audit:[{
      at:approvedAt,actor:actor.trim(),action:'WORK_ORDER_ISSUED'}]
    }));
    const record={id:scheduleId,planId:plan.id,planRevision:plan.revision,
     proposalHash:expectedHash,optionId:selectedOptionId,
     erpSnapshotId:proposal.erpSnapshotId,
     mode:demoMode?'POC_MOCK':'ERP_EXCEL_POC',
     status:'APPROVED_WORK_ORDERS_ISSUED',approvedBy:actor.trim(),
     approvalReason:reason.trim(),approvedAt,
     crossPortApprovalConfirmed:crossPortAssignments.length>0&&
       confirmCrossPort===true,
     crossPortApprovalBy:crossPortAssignments.length?actor.trim():null,
     crossPortOrders:crossPortAssignments.map(a=>({
       imo:a.imo,inspectorId:a.inspectorId,fromPortId:a.originPortId,
       toPortId:a.portId,travelMinutes:a.travelMinutes
     })),
     operationalBookingConfirmed:false,
     officialRegulatoryInspectionAuthorized:false,
     orders};
    if(!con){this.write([...previous,record]);return record;}
    await executeApprovalWrite(con,'SCHEDULE_HEADER_INSERT',
     'INSERT INTO SI_SCHED_APPROVAL '+
     '(SCHEDULE_ID,PLAN_ID,PLAN_REVISION,PROPOSAL_HASH,OPTION_ID,'+
     'ERP_SNAPSHOT_ID,MODE_CODE,DOC_JSON,APPROVED_BY) '+
     'VALUES(:b_sched_id,:b_plan_id,:b_plan_revision,:b_proposal_hash,'+
     ':b_option_id,:b_erp_snapshot_id,:b_mode_code,:b_approval_doc,'+
     ':b_approved_actor)',{
      b_sched_id:scheduleId,b_plan_id:plan.id,
      b_plan_revision:plan.revision,b_proposal_hash:expectedHash,
      b_option_id:selectedOptionId,b_erp_snapshot_id:record.erpSnapshotId,
      b_mode_code:record.mode,
      b_approval_doc:doc({...record,orders:[]}),
      b_approved_actor:record.approvedBy});
    for(const o of orders){
     await executeApprovalWrite(con,'WORK_ORDER_INSERT',
      'INSERT INTO SI_SCHED_WORK_ORDER '+
      '(ORDER_ID,SCHEDULE_ID,IMO,INSPECTOR_ID,START_UTC,END_UTC,PORT_ID,'+
      'STATUS_CODE,VERSION_NO,DOC_JSON) VALUES '+
      '(:b_order_id,:b_sched_id,:b_imo,:b_inspector_id,'+
      ':b_start_utc,:b_end_utc,:b_port_id,:b_status_code,'+
      '1,:b_order_doc)',{
       b_order_id:o.id,b_sched_id:scheduleId,b_imo:o.imo,
       b_inspector_id:o.assignment.inspectorId,
       b_start_utc:o.assignment.startUtc,
       b_end_utc:o.assignment.endUtc,
       b_port_id:o.assignment.portId,
       b_status_code:o.status,b_order_doc:doc(o)});
    }
    await executeApprovalWrite(con,'SCHEDULE_AUDIT_INSERT',
     'INSERT INTO SI_SCHED_ORDER_AUDIT '+
     '(AUDIT_ID,SCHEDULE_ID,EVENT_CODE,ACTOR,DETAILS_JSON) '+
     "VALUES(:b_audit_id,:b_sched_id,'SUPERVISOR_APPROVED_SCHEDULE',"+
     ':b_approved_actor,:b_audit_doc)',{
      b_audit_id:id(),b_sched_id:scheduleId,
      b_approved_actor:record.approvedBy,
      b_audit_doc:doc({optionId:selectedOptionId,vesselCount:orders.length,
       erpSnapshotId:record.erpSnapshotId,mode:record.mode,
       crossPortApprovalConfirmed:record.crossPortApprovalConfirmed,
       crossPortOrders:record.crossPortOrders})});
    if(!connection)await con.commit();return record;
   };
   if(connection){
    if(this.mode!=='oracle')err('SI_SCHED_SHARED_ORACLE_TRANSACTION_REQUIRED',503);
    return clone(await perform(connection));
   }
   if(this.mode==='json')return clone(await perform(null));
   return clone(await this.db(async con=>{
    try{return await perform(con);}
    catch(e){await con.rollback();
     if(e.code==='ORA-00001')err('SI_SCHED_APPROVAL_CONCURRENT_CONFLICT',409);
     throw e;}
   }));
  }finally{this.approving=false;}
 }
 async saveOrder(schedule,order,event,actor){
  order.version++;order.updatedAt=at();
  order.audit=[...(order.audit||[]),{
   action:event,actor,at:order.updatedAt,
   status:order.status,error:order.error||null}].slice(-60);
  if(this.mode==='json'){
   const all=this.read(),s=all.find(x=>x.id===schedule.id);
   if(!s)err('SI_SCHED_APPROVAL_NOT_FOUND',404);
   const index=s.orders.findIndex(x=>x.id===order.id);
   if(index<0)err('SI_WORK_ORDER_NOT_FOUND',404);
   if(s.orders[index].version!==order.version-1)
    err('SI_WORK_ORDER_VERSION_CONFLICT',409);
   s.orders[index]=clone(order);this.write(all);return clone(order);
  }
  await this.db(async con=>{
   try{
    // Oracle bind names here must follow the same safe convention as
    // schedule approval writes. :before / :event / :schedule can raise
    // ORA-01745 and previously prevented the first Prepare transition.
    const r=await executeApprovalWrite(con,'WORK_ORDER_STATUS_UPDATE',
     'UPDATE SI_SCHED_WORK_ORDER SET '+
     'STATUS_CODE=:b_status_code,CASE_ID=:b_case_id,'+
     'VERSION_NO=:b_version_no,DOC_JSON=:b_order_doc,'+
     'UPDATED_AT=SYSTIMESTAMP WHERE ORDER_ID=:b_order_id '+
     'AND VERSION_NO=:b_expected_version',{
      b_order_id:order.id,b_status_code:order.status,
      b_case_id:order.caseId,b_version_no:order.version,
      b_order_doc:doc(order),b_expected_version:order.version-1});
    if(r.rowsAffected!==1)err('SI_WORK_ORDER_VERSION_CONFLICT',409);
    await executeApprovalWrite(con,'WORK_ORDER_STATUS_AUDIT',
     'INSERT INTO SI_SCHED_ORDER_AUDIT '+
     '(AUDIT_ID,SCHEDULE_ID,ORDER_ID,EVENT_CODE,ACTOR,DETAILS_JSON) '+
     'VALUES(:b_audit_id,:b_schedule_id,:b_order_id,'+
     ':b_event_code,:b_actor,:b_audit_doc)',{
      b_audit_id:id(),b_schedule_id:schedule.id,b_order_id:order.id,
      b_event_code:event,b_actor:actor,
      b_audit_doc:doc({status:order.status,caseId:order.caseId,
        error:order.error})});
    await con.commit();
   }catch(e){await con.rollback();throw e;}
  });return clone(order);
 }
 async _freshApprovedCandidate(imo,plan){
  const dashboard=await this.targeting.dashboard();
  // Capacity-verified integrated approvals freeze only authoritative source
  // events. Unverified source rows are review evidence, not approved reasons.
  // Legacy scheduling retains its existing complete-event behavior.
  const verifiedOnly=plan.scheduleMode==='SINGLE_CAPACITY_VERIFIED_PLAN_APPROVAL';
  const candidates=dashboard.candidates.filter(c=>c.imo===imo&&
   (c.status==='PENDING_REVIEW'||c.status==='EXTERNALLY_SCHEDULED'&&
    c.events.some(e=>e.sourceType==='NMC_CASE'&&e.approval==='APPROVED'))&&
   (!verifiedOnly||c.events.some(sourceVerified)))
   .sort((a,b)=>Number(b.events.some(e=>e.sourceType==='NMC_CASE'))-
      Number(a.events.some(e=>e.sourceType==='NMC_CASE'))||
      a.regime.localeCompare(b.regime));
  if(!candidates.length)err('SI_WORK_ORDER_SOURCE_CANDIDATE_CHANGED',409);
  const reasons=new Map();
  for(const c of candidates)for(const e of c.events){
   if(verifiedOnly&&!sourceVerified(e))continue;
   const key=e.eventKey||[e.sourceType,e.sourceEventId,c.regime].join(':');
   if(!reasons.has(key))reasons.set(key,{
    eventKey:key,candidateKey:c.key,sourceType:e.sourceType,
    sourceEventId:e.sourceEventId,sourceReference:e.sourceReference,
    inspectionRegime:c.regime,sourceApproval:e.approval,
    reason:e.contextNote||null,
    evidenceIds:[...new Set(e.evidenceIds||[])],
    sourceProvenance:e.provenance||null});
  }
  const actual=[...reasons.values()];
  const vessel=plan.approvedVessels.find(v=>v.imo===imo);
  const approvedKeys=(vessel?.inspectionReasons||[]).map(x=>x.eventKey).sort();
  const currentRegimes=[...new Set(candidates.map(x=>x.regime))].sort();
  // Verify not just the event IDs, but the immutable approved evidence and
  // source authority. Any genuinely new, revoked or modified verified source
  // requires a supervisor-reviewed plan; never silently add statutory scope.
  const normalized=reasons=>reasons.map(r=>({
   ...batchReason(r),
   evidenceIds:[...new Set(r.evidenceIds||[])].sort()
  })).sort((a,b)=>a.eventKey.localeCompare(b.eventKey));
  if(!vessel||JSON.stringify(actual.map(x=>x.eventKey).sort())!==
      JSON.stringify(approvedKeys)||
    JSON.stringify(currentRegimes)!==
      JSON.stringify([...vessel.regimes].sort())||
    (verifiedOnly&&JSON.stringify(normalized(actual))!==
      JSON.stringify(normalized(vessel.inspectionReasons))))
   err('SI_WORK_ORDER_APPROVED_REASONS_CHANGED',409);
  return {imo,candidateKey:candidates[0].key,
   candidateKeys:candidates.map(x=>x.key),
   regimes:vessel.regimes,inspectionReasons:actual.map(batchReason),
   verifiedOnly};
 }
 async activate({planId,orderId,actor,generateAi=false,
  confirmAiCost=false}={}){
  this.assertReady();
  if(!label(actor,160)||!UUID.test(planId||'')||!UUID.test(orderId||'')||
   typeof generateAi!=='boolean'||typeof confirmAiCost!=='boolean')
   err('SI_WORK_ORDER_EXECUTION_INPUT_INVALID',422);
  const lock=planId+'/'+orderId;
  if(this.processing.has(lock))err('SI_WORK_ORDER_PROCESSING',409);
  this.processing.add(lock);
  try{
   const {schedule,order}=await this.order(planId,orderId);
   if(!['ISSUED','PREPARING','PREPARATION_NEEDS_REVIEW','READY_FOR_SCOPE_REVIEW']
     .includes(order.status))return order;
   const plan=await this.rolling.get(planId);
   if(!['APPROVED','IN_EXECUTION'].includes(plan.status)||
      plan.revision<schedule.planRevision||
      !plan.approvedVessels?.some(v=>v.imo===order.imo))
    err('SI_WORK_ORDER_PLAN_CHANGED',409);
   // On the NMC origin, an official referral booking is a different
   // officer-controlled action, not implied by SI-S01 or this POC ledger.
   const nmc=plan.approvedVessels.find(v=>v.imo===order.imo)
     .inspectionReasons.filter(x=>x.sourceType==='NMC_CASE');
   if(nmc.length){
    const refs=await this.cases.listInspectionRequests();
    for(const reason of nmc){
     const linked=refs.find(x=>x.id===reason.sourceEventId&&
       x.imo===order.imo);
     if(!linked||linked.status!=='SCHEDULED'||
       linked.inspector!==order.assignment.inspectorName||
       linked.port!==order.assignment.portName||
       Math.abs(Date.parse(linked.scheduledAt||'')-
         Date.parse(order.assignment.startUtc))>=60000)
      err('SI_NMC_REFERRAL_REQUIRES_INDEPENDENT_CONFIRMED_BOOKING',409);
    }
   }
   // Keep interrupted or failed A04 requests flagged across subsequent
   // preparation retries. Never issue an implicit second paid Airia call.
   const aiRequestNeedsReconciliation=[
    'A04_REQUESTED_NO_AUTOMATIC_RETRY',
    'A04_PREVIOUS_REQUEST_RECONCILIATION_REQUIRED',
    'A04_FAILED_MANUAL_REVIEW_REQUIRED'
   ].includes(order.aiStatus);
   const set=async(status,event,error=null)=>{
    order.status=status;order.error=error;
    await this.saveOrder(schedule,order,event,actor);
   };
   if(order.status!=='READY_FOR_SCOPE_REVIEW')
    await set('PREPARING','ORDER_PREPARATION_STARTED');
   let stage='INSPECTION_CASE_REGISTRY';
   try{
    let caseId=order.caseId;
    if(!caseId){
     const registry=await this.targeting.inspectionCaseRegistry();
     const prior=registry.cases.find(c=>c.imo===order.imo&&
       c.approvedPlanId===schedule.id);
     if(prior)caseId=prior.id;
     else{
      stage='APPROVED_SOURCE_REVALIDATION';
      const item=await this._freshApprovedCandidate(order.imo,plan);
      const conflict=registry.cases.find(c=>c.imo===order.imo&&
       item.candidateKeys.some(k=>[c.candidateKey,...(c.candidateKeys||[])].includes(k)));
      if(conflict)err('SI_WORK_ORDER_CASE_EXISTS_IN_ANOTHER_APPROVAL',409);
      stage='CASE_LEDGER_CREATION';
      const generated=await this.targeting.decideBatch({
       items:[item],actor:schedule.approvedBy,
       note:schedule.approvalReason,approvedPlanId:schedule.id,
       verifiedOnly:item.verifiedOnly});
      caseId=generated.cases?.[0]?.id;
     }
     if(!caseId)err('SI_WORK_ORDER_CASE_CREATION_INCOMPLETE',503);
     order.caseId=caseId;
     stage='WORK_ORDER_CASE_ID_SAVE';
     await set('PREPARING','INSPECTION_CASE_LINKED');
    }
    // Recoverable linkage to the approved rolling plan is required for
    // close-if-all-closed and preserves the frozen source evidence.
    stage='PLAN_CASE_LINK';
    await this.rolling.attachScheduledCase(planId,order.imo,caseId,
     actor,schedule.id);
    stage='DOSSIER_READ';
    let prepared=await this.preparation.get(caseId);
    if(!prepared.saved){
     stage='DOSSIER_PREPARATION_WRITE';
     await this.preparation.prepare(caseId,{actor,expectedVersion:0});
     prepared=await this.preparation.get(caseId);
    }
    if(prepared.stale||!['PREPARED','APPROVED','DRAFT_REVIEW'].includes(prepared.saved?.status))
     err('SI_WORK_ORDER_DOSSIER_REVIEW_REQUIRED',409);
    // Mandatory, published checklist template revision is immutable in each
    // inspection case. Never replace it with AI-suggested content.
    stage='CHECKLIST_TEMPLATE_PREVIEW';
    const overview=await this.checklists.preview(caseId);
    if(!overview.selectedTemplates.some(t=>t.mandatory&&t.itemCount>0))
     err('SI_WORK_ORDER_PUBLISH_MANDATORY_CHECKLIST_FIRST',409);
    stage='CHECKLIST_INITIALIZATION';
    await this.checklists.start(caseId,actor);
    order.checklistStatus='MANDATORY_PUBLISHED_TEMPLATE_SNAPSHOT';
    stage='LIFECYCLE_SNAPSHOT';
    const view=await this.lifecycle.snapshot(caseId);
    if(!view.record)
     {
      stage='LIFECYCLE_INITIALIZATION';
      await this.lifecycle.apply(caseId,{
       action:'INITIALIZE',expectedVersion:0,actor,data:{}});
     }
    order.aiStatus=prepared.saved.status==='APPROVED'?
     'A04_ADDITIONS_APPROVED_BY_REVIEWER':
     prepared.saved.status==='DRAFT_REVIEW'?'A04_DRAFT_REVIEW_PENDING':
      aiRequestNeedsReconciliation?
       'A04_PREVIOUS_REQUEST_RECONCILIATION_REQUIRED':'NOT_REQUESTED';
    if(generateAi&&prepared.saved.status==='PREPARED'){
     // An interrupted paid A04 request is never replayed automatically.
     // Reconcile the Airia run and saved dossier before manually requesting
     // another call, even after container restart.
     if(aiRequestNeedsReconciliation){
      order.aiStatus='A04_PREVIOUS_REQUEST_RECONCILIATION_REQUIRED';
      await this.saveOrder(schedule,order,'A04_RETRY_BLOCKED',actor);
     }else{
     const safeAi=await this.preparation.get(caseId);
     if(!safeAi.canGenerate){
      order.aiStatus='A04_BLOCKED_SOURCE_RISK_OR_PROVIDER';
     }else{
      if(this.preparation.provider!=='mock'&&!confirmAiCost)
       err('SI_A04_EXPLICIT_COST_CONFIRMATION_REQUIRED',422);
      // Record consent intent before a possibly paid call; no silent replay.
      order.aiStatus='A04_REQUESTED_NO_AUTOMATIC_RETRY';
      await set('PREPARING','A04_REQUEST_CONFIRMED');
      try{
       const ai=await this.preparation.generate(caseId,{actor,
        expectedVersion:safeAi.saved.version,confirmCost:true});
       order.aiStatus=ai.saved?.status==='DRAFT_REVIEW'?
        'A04_DRAFT_REVIEW_PENDING':'A04_REVIEW_REQUIRED';
      }catch(e){
       order.aiStatus='A04_FAILED_MANUAL_REVIEW_REQUIRED';
       order.aiError=e.code||'SI_A04_PROVIDER_FAILURE';
      }
     }
     }
    }
    order.status='READY_FOR_SCOPE_REVIEW';order.error=null;
    stage='WORK_ORDER_READY_SAVE';
    await this.saveOrder(schedule,order,'MANDATORY_CHECKLIST_READY',actor);
    return clone(order);
   }catch(e){
    // Only fixed server-side operation codes, never SQL, secrets, or IDs.
    if(e&&typeof e==='object'&&!e.siPreparationStage)
     e.siPreparationStage=stage;
    order.status='PREPARATION_NEEDS_REVIEW';
    order.error=e.code||'SI_WORK_ORDER_PREPARATION_FAILED';
    await this.saveOrder(schedule,order,'PREPARATION_NEEDS_REVIEW',actor);
    throw e;
   }
  }finally{this.processing.delete(lock);}
 }
 async approveScope({planId,orderId,actor,reason,includeAiSuggestions=false,
  inspectorPocSelfConfirm=false}={}){
  const {schedule,order}=await this.order(planId,orderId);
  if(inspectorPocSelfConfirm){
   if(process.env.SI_POC_INSPECTOR_SELF_SCOPE_ENABLED!=='true'||
     schedule.mode!=='POC_MOCK')
    err('SI_INSPECTOR_POC_SELF_SCOPE_NOT_ENABLED',403);
   if(!this.resolveInspectorIdentity(actor,order.assignment,schedule.mode))
    err('SI_WORK_ORDER_NOT_ASSIGNED_TO_SESSION',403);
   if(includeAiSuggestions)
    err('SI_POC_INSPECTOR_CANNOT_APPROVE_A04_ADDITIONS',403);
  }
  if(!label(actor,160)||!label(reason,500)||reason.trim().length<8)
   err('SI_WORK_ORDER_SCOPE_REASON_REQUIRED',422);
  if(order.status==='READY_FOR_FIELD'||order.status==='FIELD_STARTED')
   return order;
  if(order.status!=='READY_FOR_SCOPE_REVIEW'||!order.caseId)
   err('SI_WORK_ORDER_CHECKLIST_PREPARATION_REQUIRED',409);
  const prep=await this.preparation.get(order.caseId);
  if(prep.stale)err('SI_WORK_ORDER_STALE_DOSSIER',409);
  if(includeAiSuggestions&&prep.saved?.status!=='APPROVED')
   err('SI_WORK_ORDER_A04_ADDITIONS_NOT_REVIEWED',409);
  const curr=await this.lifecycle.snapshot(order.caseId);
  // Recover from a crash after the authoritative lifecycle applied scope
  // approval / ASSIGN but before the order projection was updated.
  if(curr.record?.stage==='ASSIGNED'||curr.record?.stage==='IN_FIELD'){
   order.scopeStatus=inspectorPocSelfConfirm?
    'POC_INSPECTOR_MANDATORY_ACKNOWLEDGED':'MANUAL_SCOPE_APPROVED';
   order.status=curr.record.stage==='IN_FIELD'?'FIELD_STARTED':'READY_FOR_FIELD';
   await this.saveOrder(schedule,order,'ORDER_RECOVERED_FROM_LIFECYCLE',actor);
   return clone(order);
  }
  if(!['PREPARATION_READY','SCOPE_APPROVED'].includes(curr.record?.stage))
   err('SI_WORK_ORDER_LIFECYCLE_SCOPE_CONFLICT',409);
  if(includeAiSuggestions&&curr.record.stage!=='PREPARATION_READY')
   err('SI_WORK_ORDER_SCOPE_ALREADY_APPROVED',409);
  if(includeAiSuggestions){
   const names=(prep.saved.dossier?.suggestedAdditionalItems||[])
     .slice(0,12).map(x=>x.title).filter(Boolean);
   await this.lifecycle.apply(order.caseId,{
    action:'ADD_SCOPE',expectedVersion:curr.record.version,actor,
    data:{additions:names}});
  }
  const newState=await this.lifecycle.snapshot(order.caseId);
  if(newState.record.stage==='PREPARATION_READY')
   await this.lifecycle.apply(order.caseId,{action:'APPROVE_SCOPE',
    expectedVersion:newState.record.version,actor,data:{reason}});
  const approved=await this.lifecycle.snapshot(order.caseId);
  await this.lifecycle.apply(order.caseId,{action:'ASSIGN',
   expectedVersion:approved.record.version,actor,
   data:{inspector:order.assignment.inspectorName,
    port:order.assignment.portName,
    startLocal:lifecycleLocalStart(order.assignment.startLocal),
    mode:order.assignment.sourceType==='NMC_CASE'?
     'NMC_SCHEDULED':(await this.targeting.inspectionCase(order.caseId))
       ?.nmcReferralId?'NMC_SCHEDULED':'POC_MANUAL'}});
  order.scopeStatus=inspectorPocSelfConfirm?
   'POC_INSPECTOR_MANDATORY_ACKNOWLEDGED':
   includeAiSuggestions?'MANDATORY_PLUS_REVIEWED_A04':'MANDATORY_APPROVED';
  order.status='READY_FOR_FIELD';order.error=null;
  await this.saveOrder(schedule,order,inspectorPocSelfConfirm?
   'POC_INSPECTOR_SELF_CONFIRMED_MANDATORY':
   'SUPERVISOR_APPROVED_SCOPE_AND_ASSIGNMENT',actor);
  return clone(order);
 }
 /** POC-only assigned-inspector acknowledgement, not formal supervisor approval.
  * Saves a distinct audit/status while allowing a synthetic guided inspection.
  * Mandatory checklist remains pinned; A04 advice never becomes findings.
  */
 async confirmPocInspectorScope({planId,orderId,actor,reason}={}){
  if(typeof reason!=='string'||reason.trim().length<8||reason.trim().length>400)
   err('SI_POC_INSPECTOR_CONFIRMATION_REASON_REQUIRED',422);
  return this.approveScope({planId,orderId,actor,
   reason:'POC_DEMO_INSPECTOR_ACKNOWLEDGEMENT: '+reason.trim(),
   includeAiSuggestions:false,inspectorPocSelfConfirm:true});
 }
 async startField({planId,orderId,actor,confirmPocDelegation=false}={}){
  const {schedule,order}=await this.order(planId,orderId);
  if(!label(actor,160))err('SI_WORK_ORDER_ACTOR_REQUIRED',422);
  const delegated=confirmPocDelegation===true&&schedule.mode==='POC_MOCK';
  if(confirmPocDelegation&&!delegated)
   err('SI_POC_DELEGATION_ONLY_FOR_MOCK_SCHEDULE',403);
  const engineer=this.resolveInspectorIdentity(actor,order.assignment,schedule.mode);
  if(!delegated&&!engineer)
   err('SI_WORK_ORDER_ONLY_ASSIGNED_INSPECTOR_CAN_START',403);
  if(order.status==='FIELD_STARTED')return order;
  if(order.status!=='READY_FOR_FIELD'||!order.caseId)
   err('SI_WORK_ORDER_SCOPE_NOT_APPROVED',409);
  const signature=order.assignment.inspectorName;
  const state=await this.lifecycle.snapshot(order.caseId);
  if(state.record?.stage==='ASSIGNED')
   await this.lifecycle.apply(order.caseId,{action:'START_FIELD',
    expectedVersion:state.record.version,actor:signature,data:{}});
  else if(state.record?.stage!=='IN_FIELD')
   err('SI_WORK_ORDER_INSPECTION_STAGE_CONFLICT',409);
  await this.rolling.setExecutionState(planId,'IN_EXECUTION',actor);
  order.status='FIELD_STARTED';order.startedAt=at();
  order.pocDelegated=delegated;
  order.startedBySession=actor;
  order.startedByInspectorId=delegated?null:engineer.id;
  await this.saveOrder(schedule,order,delegated?
   'POC_DELEGATED_FIELD_START':'INSPECTOR_STARTED_FIELD',actor);
  return clone(order);
 }
}
