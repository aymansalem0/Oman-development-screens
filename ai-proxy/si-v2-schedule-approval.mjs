/**
 * Whole-plan supervisory schedule decision, followed by retryable case/dossier
 * dispatch. Oracle 019 is authoritative in Oracle mode; JSON is POC-only.
 * Preview is pure. An approved schedule does not itself certify an inspection
 * report or complete the NMC origin. Cross-workspace actions are reconciled,
 * never falsely claimed to be one XA transaction.
 */
import {randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync,renameSync,mkdirSync,existsSync} from 'node:fs';
import {dirname} from 'node:path';
import oracledb from 'oracledb';
import {proposeMaritimeBatchSchedule} from './si-maritime-batch-scheduling.mjs';
import {maritimePlanSchedulingContext,validateOperatorScheduleAgainstSource}
 from './si-maritime-plan-source.mjs';

const now=()=>new Date().toISOString();
const clone=v=>structuredClone(v);
const doc=v=>({val:JSON.stringify(v),type:oracledb.DB_TYPE_CLOB});
const ID=/^[0-9a-f-]{36}$/i;
const text=(v,n=160)=>typeof v==='string'&&v.trim().length>0&&
 v.trim().length<=n?v.trim():null;
const validIso=v=>typeof v==='string'&&Number.isFinite(Date.parse(v));
export class SiV2ScheduleError extends Error{
 constructor(code,status=409){super(code);this.code=code;this.status=status;}
}
const fail=(code,status)=>{throw new SiV2ScheduleError(code,status);};
function canonicalItems(plan,dashboard){
 const eligible=c=>c.status==='PENDING_REVIEW'||(
  c.status==='EXTERNALLY_SCHEDULED'&&c.events.some(e=>
   e.sourceType==='NMC_CASE'&&e.approval==='APPROVED'));
 return plan.approvedVessels.map(v=>{
  const workflows=dashboard.candidates.filter(c=>c.imo===v.imo&&eligible(c))
   .sort((a,b)=>Number(b.events.some(e=>e.sourceType==='NMC_CASE'))-
     Number(a.events.some(e=>e.sourceType==='NMC_CASE'))||
     a.regime.localeCompare(b.regime));
  if(!workflows.length)fail('SI_V2_APPROVED_SOURCE_NO_LONGER_ELIGIBLE');
  const reasons=new Map();
  for(const c of workflows)for(const e of c.events){
   const eventKey=e.eventKey||[e.sourceType,e.sourceEventId,c.regime].join(':');
   if(!reasons.has(eventKey))reasons.set(eventKey,{
    eventKey,candidateKey:c.key,sourceType:e.sourceType,
    sourceEventId:e.sourceEventId,sourceReference:e.sourceReference,
    inspectionRegime:c.regime,sourceApproval:e.approval,
    reason:e.contextNote||null,evidenceIds:[...new Set(e.evidenceIds||[])],
    sourceProvenance:e.provenance||null
   });
  }
  const actual=[...reasons.values()];
  const expected=new Set((v.inspectionReasons||[]).map(x=>x.eventKey));
  if(actual.length!==expected.size||actual.some(x=>!expected.has(x.eventKey))||
   JSON.stringify([...new Set(workflows.map(x=>x.regime))].sort())!==
   JSON.stringify([...v.regimes].sort()))
   fail('SI_V2_APPROVED_REGULATORY_REASONS_CHANGED');
  return {imo:v.imo,candidateKey:workflows[0].key,
   candidateKeys:workflows.map(x=>x.key),inspectionReasons:actual,
   regimes:[...new Set(workflows.map(x=>x.regime))]};
 });
}
export class SiV2ScheduleApproval{
 constructor({mode='json',oracleRepository=null,rolling,targeting,preparation,
   erp,scheduler,cases,lifecycle=null,checklists=null,file=process.env.SI_V2_SCHEDULE_PATH||
   '/data/si-v2-schedule-approvals.json'}={}){
  if(!rolling||!targeting||!preparation||!erp||!scheduler||!cases)
   throw Error('SI_V2_SCHEDULE_CONFIGURATION_INVALID');
  this.mode=mode;this.oracle=oracleRepository;this.rolling=rolling;
  this.targeting=targeting;this.preparation=preparation;
  this.erp=erp;this.scheduler=scheduler;this.cases=cases;this.file=file;
  this.lifecycle=lifecycle;this.checklists=checklists;
  this.pending=new Set();this.lock=false;this.ready=false;
 }
 read(){
  if(!existsSync(this.file))return [];
  const data=JSON.parse(readFileSync(this.file,'utf8'));
  if(!Array.isArray(data))fail('SI_V2_SCHEDULE_STORE_CORRUPT',503);
  return data;
 }
 write(data){
  mkdirSync(dirname(this.file),{recursive:true});
  const tmp=this.file+'.'+randomUUID()+'.tmp';
  writeFileSync(tmp,JSON.stringify(data,null,2),{mode:0o600});
  renameSync(tmp,this.file);
 }
 async db(fn){
  if(!this.oracle?.pool)fail('SI_V2_SCHEDULE_ORACLE_UNAVAILABLE',503);
  const con=await this.oracle.pool.getConnection();
  try{return await fn(con);}finally{await con.close();}
 }
 async initialize(){
  if(this.mode==='json'){this.read();this.ready=true;return;}
  await this.db(async con=>{
   const r=await con.execute("SELECT TABLE_NAME FROM USER_TABLES WHERE TABLE_NAME IN "+
    "('SI_V2_SCHEDULE_APPROVAL','SI_V2_SCHEDULE_ASSIGNMENT',"+
    "'SI_V2_SCHEDULE_AUDIT','SI_V2_SCHEDULE_MUTEX')",[],
    {outFormat:oracledb.OUT_FORMAT_OBJECT});
   if(r.rows.length!==4)fail('SI_V2_MIGRATION_019_REQUIRED',503);
   const mutex=await con.execute(
    "SELECT COUNT(*) AS N FROM SI_V2_SCHEDULE_MUTEX WHERE LOCK_ID=1",[],
    {outFormat:oracledb.OUT_FORMAT_OBJECT});
   if(Number(mutex.rows[0].N)!==1)fail('SI_V2_MIGRATION_019_REQUIRED',503);
  });
  this.ready=true;
 }
 assertReady(){if(!this.ready)fail('SI_V2_MIGRATION_019_REQUIRED',503);}
 async _get(con,planId){
  const r=await con.execute(
   'SELECT DOC_JSON FROM SI_V2_SCHEDULE_APPROVAL WHERE PLAN_ID=:id',{id:planId},
   {outFormat:oracledb.OUT_FORMAT_OBJECT,
    fetchInfo:{DOC_JSON:{type:oracledb.STRING}}});
  return r.rows.length?JSON.parse(r.rows[0].DOC_JSON):null;
 }
 async get(planId){
  this.assertReady();
  if(!ID.test(planId||''))fail('SI_V2_PLAN_ID_INVALID',422);
  if(this.mode==='json')return clone(this.read().find(x=>x.planId===planId)||null);
  return this.db(con=>this._get(con,planId));
 }
 async _existing(con=null){
  if(this.mode==='json')return this.read();
  const r=await con.execute(
   "SELECT DOC_JSON FROM SI_V2_SCHEDULE_APPROVAL",[],
   {outFormat:oracledb.OUT_FORMAT_OBJECT,
    fetchInfo:{DOC_JSON:{type:oracledb.STRING}}});
  return r.rows.map(x=>JSON.parse(x.DOC_JSON));
 }
 async _save(record){
  record.updatedAt=now();
  if(this.mode==='json'){
   const data=this.read(),index=data.findIndex(x=>x.planId===record.planId);
   if(index<0)data.push(clone(record));else data[index]=clone(record);
   this.write(data);return;
  }
  await this.db(async con=>{
   try{
    const x=await con.execute(
      'UPDATE SI_V2_SCHEDULE_APPROVAL SET STATUS=:status,DOC_JSON=:body,'+
      ' UPDATED_AT=SYSTIMESTAMP WHERE SCHEDULE_ID=:id',
      {id:record.id,status:record.status,body:doc(record)});
    if(!x.rowsAffected)fail('SI_V2_SCHEDULE_NOT_FOUND',404);
    for(const item of record.items){
     await con.execute(
      'UPDATE SI_V2_SCHEDULE_ASSIGNMENT SET CASE_ID=:caseId,'+
      'DOC_JSON=:body WHERE SCHEDULE_ID=:id AND IMO=:imo',
      {id:record.id,imo:item.imo,caseId:item.caseId,body:doc(item)});
    }
    await con.execute('INSERT INTO SI_V2_SCHEDULE_AUDIT '+
      '(AUDIT_ID,SCHEDULE_ID,EVENT_CODE,ACTOR,DETAILS_JSON) '+
      'VALUES(:auditId,:id,:eventCode,:actor,:details)',
      {auditId:randomUUID(),id:record.id,eventCode:record.status,
       actor:record.approvedBy,details:doc({updatedAt:record.updatedAt})});
    await con.commit();
   }catch(e){await con.rollback();throw e;}
  });
 }
 async approve({planId,requests,expectedProposalHash,expectedPlanRevision,
   actor,reason,confirmApproval}={}){
  this.assertReady();
  if(!ID.test(planId||'')||!Array.isArray(requests)||
   !requests.length||requests.length>500||!Number.isInteger(expectedPlanRevision)||
   !/^[0-9a-f]{64}$/.test(expectedProposalHash||'')||
   !text(actor)||!text(reason,500)||reason.trim().length<8||
   confirmApproval!==true)
   fail('SI_V2_SCHEDULE_APPROVAL_INVALID',422);
  if(this.lock)fail('SI_V2_SCHEDULE_APPROVAL_IN_PROGRESS',409);
  this.lock=true;
  try{
   const attempt=async con=>{
    const previous=con?await this._get(con,planId):
     this.read().find(x=>x.planId===planId);
    if(previous){
     if(previous.proposalHash===expectedProposalHash)return previous;
     fail('SI_V2_SCHEDULE_ALREADY_APPROVED',409);
    }
    const plan=await this.rolling.get(planId);
    if(plan.status!=='APPROVED'||plan.revision!==expectedPlanRevision)
     fail('SI_V2_PLAN_REVISION_CHANGED',409);
    const erp=this.erp.requireSnapshot(),policy=this.scheduler.getPolicy();
    const dashboard=await this.targeting.dashboard();
    validateOperatorScheduleAgainstSource(
     maritimePlanSchedulingContext(plan,dashboard,erp),requests);
    // Reject deleted/new regulatory triggers before making any schedule write.
    canonicalItems(plan,dashboard);
    const referrals=await this.cases.listInspectionRequests();
    const nmcBookings=await this.scheduler.centralBookings(erp);
    const prior=await this._existing(con);
    const scheduleBookings=prior.filter(x=>x.planId!==planId).flatMap(x=>x.items.map(item=>({
     inspectorId:item.assignment.inspectorId,
     startUtc:item.assignment.startUtc,endUtc:item.assignment.endUtc,
     portId:item.assignment.portId
    })));
    const proposal=proposeMaritimeBatchSchedule({
     plan,erpSnapshot:erp,policy,requests,nmcReferrals:referrals,
     existingBookings:[...this.scheduler.state.confirmed,...nmcBookings,
      ...scheduleBookings],scheduler:this.scheduler
    });
    if(proposal.proposalHash!==expectedProposalHash)
     fail('SI_V2_SCHEDULE_PROPOSAL_CHANGED_REVIEW_AGAIN',409);
    if(proposal.summary.unscheduled>0||proposal.rows.length!==plan.approvedVessels.length)
     fail('SI_V2_ALL_APPROVED_VESSELS_MUST_BE_SCHEDULED',409);
    const id=randomUUID(),at=now();
    const items=proposal.rows.map(row=>({imo:row.imo,planRank:row.planRank,
     assignment:row.assignment,caseId:null,orderId:randomUUID(),
     orderStatus:'AWAITING_CASE_DISPATCH',dossierStatus:'PENDING',
     dispatchStatus:'PENDING',error:null}));
    const record={id,planId,planRevision:plan.revision,
     proposalHash:proposal.proposalHash,erpSnapshotId:erp.snapshotId,
     status:'APPROVED_AWAITING_CASES',approvedBy:actor.trim(),
     approvalReason:reason.trim(),approvedAt:at,updatedAt:at,
     items,audit:[{event:'SUPERVISOR_APPROVED_WHOLE_SCHEDULE',
       actor:actor.trim(),at}],caseWrites:0,
     statutoryDecision:false,nmcCaseClosure:false};
    if(this.mode==='json'){
     this.write([...this.read(),record]);
    }else{
     await con.execute('INSERT INTO SI_V2_SCHEDULE_APPROVAL '+
      '(SCHEDULE_ID,PLAN_ID,PLAN_REVISION,PROPOSAL_HASH,ERP_SNAPSHOT_ID,'+
      'STATUS,DOC_JSON,APPROVED_BY) VALUES '+
      '(:id,:planId,:revision,:hash,:erpId,:status,:body,:actor)',{
       id,planId,revision:plan.revision,hash:record.proposalHash,
       erpId:record.erpSnapshotId,status:record.status,body:doc(record),actor});
     for(const item of items){
      const a=item.assignment;
      if(!validIso(a.startUtc)||!validIso(a.endUtc))
       fail('SI_V2_ASSIGNMENT_UTC_INVALID',422);
      await con.execute('INSERT INTO SI_V2_SCHEDULE_ASSIGNMENT '+
       '(SCHEDULE_ID,IMO,INSPECTOR_ID,START_UTC,END_UTC,PORT_ID,DOC_JSON) '+
       'VALUES(:id,:imo,:inspector,:startUtc,:endUtc,:port,:body)',{
       id,imo:item.imo,inspector:a.inspectorId,startUtc:a.startUtc,
       endUtc:a.endUtc,port:a.portId,body:doc(item)});
     }
     await con.execute('INSERT INTO SI_V2_SCHEDULE_AUDIT '+
      '(AUDIT_ID,SCHEDULE_ID,EVENT_CODE,ACTOR,DETAILS_JSON) '+
      "VALUES(:auditId,:id,'SUPERVISOR_APPROVED',:actor,:details)",{
       auditId:randomUUID(),id,actor:actor.trim(),
       details:doc({proposalHash:record.proposalHash,items:items.length})});
     await con.commit();
    }
    return record;
   };
   if(this.mode==='json')return clone(await attempt(null));
   return this.db(async con=>{
    try{
     // Serializes all new-schedule commitments in one Oracle transaction.
     await con.execute('SELECT LOCK_ID FROM SI_V2_SCHEDULE_MUTEX '+
       'WHERE LOCK_ID=1 FOR UPDATE');
     return clone(await attempt(con));
    }catch(e){await con.rollback();if(e.code==='ORA-00001')
      fail('SI_V2_SCHEDULE_ALREADY_APPROVED',409);throw e;}
   });
  }finally{this.lock=false;}
 }
 /**
  * Independent retryable delivery into the already transactionally protected
  * case ledger, then the existing SI-02 deterministic dossier builder.
  * No stage transition to FIELD: independent scope approval still required.
  */
 async dispatch(planId){
  this.assertReady();
  if(this.pending.has(planId))fail('SI_V2_DISPATCH_BUSY',409);
  this.pending.add(planId);
  try{
   let record=await this.get(planId);
   if(!record)fail('SI_V2_SCHEDULE_NOT_FOUND',404);
   if(record.status==='DOSSIERS_PREPARED_SCOPE_APPROVAL_PENDING')return record;
   const plan=await this.rolling.get(planId);
   if(plan.status!=='APPROVED')fail('SI_V2_APPROVED_PLAN_REQUIRED',409);
   const referrals=await this.cases.listInspectionRequests();
   // NMC remains a separate official scheduling decision. Never mark an
   // unconfirmed NMC referral as booked because a plan was approved.
   for(const vessel of plan.approvedVessels){
    const assignment=record.items.find(x=>x.imo===vessel.imo)?.assignment;
    for(const reason of vessel.inspectionReasons.filter(x=>x.sourceType==='NMC_CASE')){
     const existing=referrals.find(r=>r.id===reason.sourceEventId&&r.imo===vessel.imo);
     if(!existing||existing.status!=='SCHEDULED'||
       existing.inspector!==assignment.inspectorName||
       existing.port!==assignment.portName||
       Math.abs(Date.parse(existing.scheduledAt||'')-
        Date.parse(assignment.startUtc||''))>=60000){
      record.status='WAITING_NMC_CONFIRMATION';
      record.lastIssue='SI_V2_NMC_CONFIRMED_SCHEDULE_REQUIRED';
      await this._save(record);return record;
     }
    }
   }
   const registry=await this.targeting.inspectionCaseRegistry();
   const linked=record.items.map(item=>registry.cases.find(c=>
    c.imo===item.imo&&c.approvedPlanId===record.id));
   if(!linked.every(Boolean)){
    const dashboard=await this.targeting.dashboard();
    const all=canonicalItems(plan,dashboard);
    // Each decideBatch call is atomic up to 40 cases in the existing ledger.
    // On a restart, the already-created part is reconciled by IMO/plan ID;
    // never retry the same source candidate twice.
    const outstanding=all.filter(v=>!linked.some(c=>c?.imo===v.imo));
    for(let index=0;index<outstanding.length;index+=40){
     try{
      await this.targeting.decideBatch({
       items:outstanding.slice(index,index+40),
       actor:record.approvedBy,note:record.approvalReason,
       approvedPlanId:record.id});
     }catch(e){
      record.status='DISPATCH_PARTIAL';
      record.lastIssue=e.code||'SI_V2_CASE_APPROVAL_FAILED';
      await this._save(record);return record;
     }
    }
   }
   const fresh=await this.targeting.inspectionCaseRegistry();
   for(const item of record.items){
    const c=fresh.cases.find(x=>x.imo===item.imo&&
     x.approvedPlanId===record.id);
    if(!c){item.error='SI_V2_CASE_LINK_MISSING';continue;}
    item.caseId=c.id;
    try{
     const current=await this.preparation.get(c.id);
     if(current.saved&&!current.stale&&
        ['PREPARED','APPROVED'].includes(current.saved.status)){
      item.dossierStatus=current.saved.status;
     }else{
      if(current.saved?.status==='APPROVED')
       fail('SI_V2_APPROVED_DOSSIER_STALE_REVIEW',409);
      const result=await this.preparation.prepare(c.id,{
       actor:record.approvedBy,expectedVersion:current.saved?.version||0});
      item.dossierStatus=result.saved.status;
     }
     item.dispatchStatus='DOSSIER_PREPARED';
     item.orderStatus='ISSUED';item.error=null;
    }catch(e){
     item.dispatchStatus='DOSSIER_FAILED';
     item.error=e.code||'SI_V2_DOSSIER_PREPARATION_FAILED';
    }
   }
   record.caseWrites=record.items.filter(x=>x.caseId).length;
   record.status=record.items.every(x=>x.dispatchStatus==='DOSSIER_PREPARED')?
    'DOSSIERS_PREPARED_SCOPE_APPROVAL_PENDING':'DISPATCH_PARTIAL';
   record.lastIssue=record.status==='DISPATCH_PARTIAL'?
    'SI_V2_ITEM_PREPARATION_RETRY_REQUIRED':null;
   await this._save(record);
   return record;
  }finally{this.pending.delete(planId);}
 }
 async executeOrder({planId,imo,actor,confirmExecution}={}){
  this.assertReady();
  if(!ID.test(planId||'')||!/^[0-9]{7}$/.test(imo||'')||
    !text(actor)||confirmExecution!==true)
   fail('SI_V2_WORK_ORDER_EXECUTION_INVALID',422);
  if(!this.lifecycle||!this.checklists)
   fail('SI_V2_FIELD_EXECUTION_NOT_CONFIGURED',503);
  if(this.pending.has(planId))fail('SI_V2_WORK_ORDER_BUSY',409);
  this.pending.add(planId);
  try{
   const record=await this.get(planId);
   if(!record||!['DOSSIERS_PREPARED_SCOPE_APPROVAL_PENDING',
     'DISPATCH_PARTIAL'].includes(record.status))
    fail('SI_V2_WORK_ORDER_NOT_ISSUED',409);
   const item=record.items.find(x=>x.imo===imo);
   if(!item||item.orderStatus!=='ISSUED'||!item.caseId)
    fail('SI_V2_WORK_ORDER_NOT_READY',409);
   // Inspections must be executed by the actual assigned engineer.
   // Never treat the supervisor's session as the inspector's session.
   if(![item.assignment.inspectorName,item.assignment.inspectorId]
     .includes(actor.trim()))
    fail('SI_V2_ONLY_ASSIGNED_ENGINEER_MAY_EXECUTE',403);
   const prep=await this.preparation.get(item.caseId);
   if(prep.stale||!['APPROVED','PREPARED'].includes(prep.saved?.status))
    fail('SI_V2_PREPARATION_REVIEW_REQUIRED',409);
   const saved=prep.saved;
   // Unreviewed AI drafts must never become mandatory inspector tasks.
   const additions=saved.status==='APPROVED'?
     (saved.dossier?.suggestedAdditionalItems||[]).map(x=>x.title):[];
   let lifecycle=await this.lifecycle.snapshot(item.caseId);
   const apply=async(action,data,as)=>{
    const result=await this.lifecycle.apply(item.caseId,{
      action,data,actor:as,expectedVersion:lifecycle.saved?.version||0});
    lifecycle=await this.lifecycle.snapshot(item.caseId);
    return result;
   };
   if(!lifecycle.saved)await apply('INITIALIZE',{},record.approvedBy);
   if(lifecycle.saved?.stage==='PREPARATION_READY'){
    if(additions.length)await apply('ADD_SCOPE',{additions},
      saved.review?.actor||record.approvedBy);
    await apply('APPROVE_SCOPE',{
      reason:saved.review?.reason||record.approvalReason
    },saved.review?.actor||record.approvedBy);
   }
   if(lifecycle.saved?.stage==='SCOPE_APPROVED'){
    const d=new Date(item.assignment.startUtc);
    const local=new Intl.DateTimeFormat('sv-SE',{
      timeZone:'Asia/Dubai',year:'numeric',month:'2-digit',
      day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false
    }).format(d).replace(' ','T');
    await apply('ASSIGN',{inspector:item.assignment.inspectorName,
      port:item.assignment.portName,startLocal:local,
      mode:'POC_MANUAL'},record.approvedBy);
   }
   if(lifecycle.saved?.stage!=='ASSIGNED'&&lifecycle.saved?.stage!=='IN_FIELD')
    fail('SI_V2_WORK_ORDER_LIFECYCLE_REVIEW_REQUIRED',409);
   // Idempotent checklist seed includes ALL mandatory statutory templates.
   const checklist=await this.checklists.start(item.caseId,actor.trim());
   if(lifecycle.saved.stage==='ASSIGNED')await apply('START_FIELD',{},actor.trim());
   item.orderStatus='IN_EXECUTION';item.startedAt=item.startedAt||now();
   item.checklistVersion=checklist.version;
   item.mandatoryTemplates=checklist.templates
      .filter(t=>t.mandatory).map(t=>t.templateId);
   item.aiAdditionalItemsApproved=additions.length;
   record.audit.push({event:'ENGINEER_STARTED_WORK_ORDER',at:now(),
     actor:actor.trim(),imo,orderId:item.orderId});
   await this._save(record);
   return {status:'IN_EXECUTION',orderId:item.orderId,planId,imo,
     caseId:item.caseId,mandatoryTemplates:item.mandatoryTemplates,
     approvedAiAdditionalItems:additions,checklist,
     fieldStage:'IN_FIELD',realAiriaCalls:0};
  }finally{this.pending.delete(planId);}
 }
}
