/**
 * Capacity-first: one supervisor approval for selected source-backed vessels,
 * ALL validated inspector/time slots, and canonical 019 work orders.
 * Oracle 018 and 019 rows are committed or rolled back TOGETHER.
 */
import {randomUUID} from 'node:crypto';
import oracledb from 'oracledb';
const doc=x=>({val:JSON.stringify(x),type:oracledb.DB_TYPE_CLOB});
const fail=(code,status=409)=>{const e=new Error(code);e.code=code;e.status=status;throw e;};
const valid=(x,max=180)=>typeof x==='string'&&x.trim().length>0&&x.trim().length<=max;
const intersect=(a,b)=>a.inspectorId===b.inspectorId&&
 Date.parse(a.startUtc)<Date.parse(b.endUtc)&&
 Date.parse(b.startUtc)<Date.parse(a.endUtc);
export async function commitCapacityFirstPlan({rolling,plan,selection,capacity,
 selectedOptionId,actor,reason,expectedRevision,expectedSourceHash,
 confirmCrossPort=false}={}){
 if(rolling?.mode!=='oracle'||!rolling.oracle?.pool)
  fail('SI_CAPACITY_FIRST_ATOMIC_APPROVAL_REQUIRES_ORACLE',503);
 if(!plan||!valid(actor,160)||!valid(reason,500)||reason.trim().length<8||
  !Number.isInteger(expectedRevision)||!valid(expectedSourceHash,200)||
  plan.revision!==expectedRevision||plan.status!=='READY_FOR_APPROVAL'||
  capacity?.planId!==plan.id||capacity?.planRevision!==plan.revision||
  !capacity?.readyForApproval||capacity.sourceHash!==expectedSourceHash||
  !valid(selectedOptionId,80))
  fail('SI_CAPACITY_FIRST_APPROVAL_REPREVIEW_REQUIRED',409);
 const option=capacity.proposal?.variants?.find(v=>v.optionId===selectedOptionId);
 const vessels=(selection.vessels||[]).map(v=>({
  imo:v.imo,planRank:v.rank,caseId:null,
  regimes:v.inspectionRegimes,inspectionReasons:v.reasons
 }));
 const slots=option?.assignments||[];
 if(!vessels.length||vessels.length>40||
  slots.length!==vessels.length||
  capacity.proposal.summary.proposed!==vessels.length||
  capacity.proposal.summary.unscheduled!==0||
  selection.sourceHash!==expectedSourceHash||
  new Set(vessels.map(v=>v.imo)).size!==vessels.length||
  new Set(slots.map(a=>a.imo)).size!==vessels.length||
  new Set(vessels.map(v=>v.planRank)).size!==vessels.length||
  vessels.some(v=>!/^\d{7}$/.test(v.imo)||!Number.isInteger(v.planRank)||
   v.planRank<1||!v.regimes?.length||!v.inspectionReasons?.length||
   v.inspectionReasons.some(e=>!valid(e?.eventKey,180)))||
  slots.some(a=>!vessels.some(v=>v.imo===a.imo)||
   !valid(a.inspectorId,120)||!valid(a.inspectorName,120)||
   !valid(a.portId,100)||!valid(a.portName,120)||
   !Number.isFinite(Date.parse(a.startUtc))||
   !Number.isFinite(Date.parse(a.endUtc))||
   Date.parse(a.startUtc)>=Date.parse(a.endUtc)||
   (a.manualReasons||[]).includes('OVERTIME_APPROVAL_REQUIRED')))
  fail('SI_CAPACITY_FIRST_ALL_SELECTED_VESSELS_NEED_FEASIBLE_ASSIGNMENTS',409);
 const crossing=slots.filter(a=>a.crossPort===true);
 if(crossing.some(a=>!valid(a.originPortId,100)||
  a.originPortId===a.portId||!Number.isFinite(a.travelMinutes)||
  a.travelMinutes<0||
  (capacity.mode==='POC_MOCK'&&
    !a.manualReasons?.includes('CROSS_PORT_REQUIRES_APPROVAL'))))
  fail('SI_CAPACITY_FIRST_CROSS_PORT_TRAVEL_EVIDENCE_INVALID',409);
 if(crossing.length&&confirmCrossPort!==true)
  fail('SI_CAPACITY_FIRST_CROSS_PORT_SUPERVISOR_APPROVAL_REQUIRED',422);
 for(let i=0;i<slots.length;i++)for(let j=i+1;j<slots.length;j++)
  if(intersect(slots[i],slots[j]))
   fail('SI_CAPACITY_FIRST_ENGINEER_OVERLAP',409);
 return rolling.db(async con=>{
  try{
   // Synchronize with SI-S02 approvers using the same canonical mutex.
   await con.execute('SELECT LOCK_ID FROM SI_SCHED_MUTEX WHERE LOCK_ID=1 FOR UPDATE');
   const rows=await rolling.query(con,
    'SELECT STATE_JSON FROM SI_PLAN_ROLLING WHERE PLAN_ID=:id FOR UPDATE',
    {id:plan.id});
   if(!rows.length)fail('SI_ROLLING_PLAN_NOT_FOUND',404);
   const before=JSON.parse(rows[0].STATE_JSON);
   if(before.status!=='READY_FOR_APPROVAL'||
    before.revision!==expectedRevision||
    before.selectionSourceHash!==expectedSourceHash)
    fail('SI_CAPACITY_FIRST_STALE_PLAN_REPREVIEW',409);
   const selected=(before.savedPlanRows||before.latest?.rows||[])
    .filter(r=>r.planSelected);
   if(selected.length!==vessels.length||
    selected.some(r=>!vessels.some(v=>v.imo===r.imo)))
    fail('SI_CAPACITY_FIRST_SELECTION_CHANGED_REPREVIEW',409);
   const otherOrders=await con.execute(
    'SELECT INSPECTOR_ID,START_UTC,END_UTC FROM SI_SCHED_WORK_ORDER',[],
    {outFormat:oracledb.OUT_FORMAT_OBJECT});
   if(slots.some(a=>otherOrders.rows.some(o=>intersect(a,{
    inspectorId:o.INSPECTOR_ID,startUtc:o.START_UTC,endUtc:o.END_UTC
   }))))fail('SI_CAPACITY_FIRST_INSPECTOR_COLLISION_REPREVIEW',409);
   const timestamp=new Date().toISOString(),scheduleId=randomUUID();
   const workOrders=slots.map(a=>({
    id:randomUUID(),scheduleId,planId:plan.id,imo:a.imo,
    planRank:vessels.find(v=>v.imo===a.imo).planRank,
    assignment:structuredClone(a),status:'ISSUED',version:1,caseId:null,
    checklistStatus:'NOT_PREPARED',aiStatus:'NOT_REQUESTED',
    scopeStatus:'NOT_APPROVED',createdAt:timestamp,updatedAt:timestamp,
    issuedBy:actor,error:null,audit:[{
     at:timestamp,actor,action:'WORK_ORDER_ISSUED'}]
   }));
   const crossingAudit=crossing.map(a=>({
    imo:a.imo,inspectorId:a.inspectorId,fromPortId:a.originPortId,
    toPortId:a.portId,travelMinutes:a.travelMinutes
   }));
   const schedule={
    id:scheduleId,planId:plan.id,planRevision:before.revision+1,
    proposalHash:capacity.proposal.proposalHash,
    optionId:selectedOptionId,erpSnapshotId:capacity.proposal.erpSnapshotId,
    mode:capacity.mode,status:'APPROVED_WORK_ORDERS_ISSUED',
    approvedBy:actor,approvalReason:reason.trim(),approvedAt:timestamp,
    crossPortApprovalConfirmed:crossing.length>0&&confirmCrossPort,
    crossPortApprovalBy:crossing.length?actor:null,
    crossPortOrders:crossingAudit,
    capacityHash:capacity.capacityHash,capacityWeights:capacity.weights,
    priorityAdvisory:capacity.priorityAdvisory,
    operationalBookingConfirmed:false,
    officialRegulatoryInspectionAuthorized:false,
    orders:workOrders
   };
   const next=structuredClone(before);
   next.status='APPROVED';next.approvedAt=timestamp;next.approvedBy=actor;
   next.scheduleMode='CAPACITY_VERIFIED_PLAN_AND_ASSIGNMENTS_APPROVED';
   next.approvalReason=reason.trim();next.approvedBatchId=null;
   next.approvedVessels=vessels;next.approvedRows=structuredClone(selected);
   next.approvedScheduleId=scheduleId;
   next.capacityWeights=capacity.weights;next.capacityHash=capacity.capacityHash;
   next.capacitySnapshotId=capacity.proposal.erpSnapshotId;
   next.approvedAssignmentCount=slots.length;
   next.revision++;next.updatedAt=timestamp;next.updatedBy=actor;
   next.audit=[...(next.audit||[]),{
    event:'CAPACITY_FIRST_PLAN_AND_ASSIGNMENTS_APPROVED',
    actor,at:timestamp,capacityHash:capacity.capacityHash,
    scheduleId,workOrdersIssued:workOrders.length,
    crossPortCount:crossing.length
   }].slice(-300);
   const changed=await con.execute(
    "UPDATE SI_PLAN_ROLLING SET STATUS='APPROVED',VERSION_NO=:revision,"+
    'STATE_JSON=:state,APPROVED_BATCH_ID=NULL,APPROVED_BY=:actor,'+
    'APPROVED_AT=SYSTIMESTAMP,UPDATED_BY=:updatedBy,'+
    'UPDATED_AT=SYSTIMESTAMP WHERE PLAN_ID=:planId AND VERSION_NO=:expected',
    {revision:next.revision,state:doc(next),actor,updatedBy:actor,
     planId:plan.id,expected:before.revision});
   if(changed.rowsAffected!==1)
    fail('SI_CAPACITY_FIRST_CONCURRENT_PLAN_APPROVAL',409);
   await con.execute(
    'INSERT INTO SI_PLAN_ROLLING_VERSION '+
    '(PLAN_ID,VERSION_NO,STATE_JSON,ACTOR,EVENT_CODE) '+
    "VALUES(:planId,:revision,:state,:actor,'CAPACITY_FIRST_APPROVED')",
    {planId:plan.id,revision:next.revision,state:doc(next),actor});
   for(const v of vessels){
    await con.execute(
     'INSERT INTO SI_PLAN_ROLLING_VESSEL '+
     '(PLAN_ID,IMO,PLAN_RANK,CASE_ID,APPROVED_SCOPE_JSON) '+
     'VALUES(:planId,:imo,:rank,NULL,:scope)',
     {planId:plan.id,imo:v.imo,rank:v.planRank,
      scope:doc({regimes:v.regimes})});
    for(const reasonRow of v.inspectionReasons)await con.execute(
     'INSERT INTO SI_PLAN_ROLLING_REASON '+
     '(PLAN_ID,IMO,EVENT_KEY,REASON_JSON) VALUES '+
     '(:planId,:imo,:key,:data)',
     {planId:plan.id,imo:v.imo,key:reasonRow.eventKey,data:doc(reasonRow)});
   }
   await con.execute(
    'INSERT INTO SI_SCHED_APPROVAL '+
    '(SCHEDULE_ID,PLAN_ID,PLAN_REVISION,PROPOSAL_HASH,OPTION_ID,'+
    'ERP_SNAPSHOT_ID,MODE_CODE,DOC_JSON,APPROVED_BY) VALUES '+
    '(:id,:planId,:revision,:hash,:optionId,:erp,:mode,:data,:actor)',
    {id:scheduleId,planId:plan.id,revision:next.revision,
     hash:schedule.proposalHash,optionId:selectedOptionId,
     erp:schedule.erpSnapshotId,mode:schedule.mode,
     data:doc({...schedule,orders:[]}),actor});
   for(const order of workOrders)await con.execute(
    'INSERT INTO SI_SCHED_WORK_ORDER '+
    '(ORDER_ID,SCHEDULE_ID,IMO,INSPECTOR_ID,START_UTC,END_UTC,PORT_ID,'+
    'STATUS_CODE,VERSION_NO,DOC_JSON) VALUES '+
    '(:id,:schedule,:imo,:inspector,:startUtc,:endUtc,:port,:status,1,:data)',
    {id:order.id,schedule:scheduleId,imo:order.imo,
     inspector:order.assignment.inspectorId,
     startUtc:order.assignment.startUtc,endUtc:order.assignment.endUtc,
     port:order.assignment.portId,status:order.status,data:doc(order)});
   await con.execute(
    'INSERT INTO SI_SCHED_ORDER_AUDIT '+
    '(AUDIT_ID,SCHEDULE_ID,EVENT_CODE,ACTOR,DETAILS_JSON) '+
    "VALUES(:id,:schedule,'CAPACITY_FIRST_PLAN_AND_WORK_ORDERS',:actor,:data)",
    {id:randomUUID(),schedule:scheduleId,actor,
     data:doc({capacityHash:capacity.capacityHash,weights:capacity.weights,
      approvedImos:workOrders.map(o=>o.imo),
      crossPortOrders:crossingAudit,bookingCreated:false})});
   await rolling.audit(con,plan.id,'CAPACITY_FIRST_PLAN_AND_ASSIGNMENTS_APPROVED',
    actor,{capacityHash:capacity.capacityHash,scheduleId,
     workOrdersIssued:workOrders.length});
   await con.commit();
   return {plan:next,schedule};
  }catch(e){await con.rollback();throw e;}
 });
}
