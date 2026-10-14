/**
 * Independent SI-01 rolling planning cycles.
 * Oracle 018 is authoritative in NMC_DB_MODE=oracle.
 * JSON mode is intentionally for single-instance POC testing only.
 * There is no daily cron, implicit AI call, automatic plan carry-forward, or
 * mutation of pre-existing SI_CASE / SI-02 / Checklist records.
 */
import oracledb from 'oracledb';
import {randomUUID} from 'node:crypto';
import {readFileSync,existsSync,writeFileSync,renameSync,mkdirSync} from 'node:fs';
import {dirname} from 'node:path';

const json=v=>({val:JSON.stringify(v),type:oracledb.DB_TYPE_CLOB});
const clone=x=>structuredClone(x);
const now=()=>new Date().toISOString();
const ID=/^[a-f0-9-]{36}$/i;
const DATE=/^\d{4}-\d\d-\d\d$/;
const goodDate=x=>DATE.test(x)&&!Number.isNaN(Date.parse(x+'T00:00:00Z'))&&
 new Date(x+'T00:00:00Z').toISOString().slice(0,10)===x;
const text=(x,max=200)=>typeof x==='string'&&x.trim()&&x.trim().length<=max?x.trim():null;
const from=x=>typeof x==='string'?JSON.parse(x):x;
const empty=()=>({version:1,plans:[]});
const sanitize=x=>({
 id:x.id,number:x.number,title:x.title,startsOn:x.startsOn,endsOn:x.endsOn,
 notes:x.notes||'',status:x.status,revision:x.revision,
 createdBy:x.createdBy,createdAt:x.createdAt,updatedBy:x.updatedBy,
 updatedAt:x.updatedAt,approvedAt:x.approvedAt||null,
 approvedBy:x.approvedBy||null,approvedBatchId:x.approvedBatchId||null,
 vesselCount:x.approvedVessels?.length||x.savedPlanRows?.filter(r=>r.planSelected).length||
    x.latest?.rows?.filter(r=>r.planSelected).length||0,
 candidateCount:new Set((x.candidateSnapshot||[]).map(c=>c.imo)).size,
 deferredCount:Object.values(x.overrides||{}).filter(d=>d.disposition==='DEFER').length
});
const uniqueNumber=()=>('IP-'+new Date().toISOString().slice(0,10).replaceAll('-','')+
 '-'+randomUUID().slice(0,8).toUpperCase());
export class SiRollingPlanError extends Error{
 constructor(code,status=409){super(code);this.code=code;this.status=status;}
}
const fail=(code,status)=>{throw new SiRollingPlanError(code,status);};
export class SiRollingPlanStore{
 constructor({mode='json',oracleRepository=null,
  file=process.env.SI_ROLLING_PLAN_PATH||'/data/si-rolling-plans.json'}={}){
  this.mode=mode;this.oracle=oracleRepository;this.file=file;
  if(mode!=='json'&&mode!=='oracle')throw Error('SI_ROLLING_MODE_INVALID');
 }
 readFile(){
  if(!existsSync(this.file))return empty();
  let v;
  try{v=JSON.parse(readFileSync(this.file,'utf8'));}
  catch{fail('SI_ROLLING_STORE_CORRUPT',503);}
  if(v.version!==1||!Array.isArray(v.plans))fail('SI_ROLLING_STORE_CORRUPT',503);
  return v;
 }
 writeFile(state){
  mkdirSync(dirname(this.file),{recursive:true});
  const temp=this.file+'.'+randomUUID()+'.tmp';
  writeFileSync(temp,JSON.stringify(state,null,2),{mode:0o600});
  renameSync(temp,this.file);
 }
 async db(fn){
  if(!this.oracle?.pool)fail('SI_ROLLING_ORACLE_UNAVAILABLE',503);
  const con=await this.oracle.pool.getConnection();
  try{return await fn(con);}
  finally{await con.close();}
 }
 async query(con,sql,binds={}){
  const x=await con.execute(sql,binds,{
   outFormat:oracledb.OUT_FORMAT_OBJECT,
   fetchInfo:{STATE_JSON:{type:oracledb.STRING}}});
  return x.rows;
 }
 async initialize(){
  if(this.mode==='json'){this.readFile();return;}
  await this.db(async con=>{
   const expected=['SI_PLAN_ROLLING','SI_PLAN_ROLLING_VERSION',
    'SI_PLAN_ROLLING_AUDIT','SI_PLAN_ROLLING_VESSEL','SI_PLAN_ROLLING_REASON'];
   const rows=await this.query(con,"SELECT TABLE_NAME FROM USER_TABLES WHERE TABLE_NAME IN ("+
    expected.map((_,i)=>':k'+i).join(',')+")",
    Object.fromEntries(expected.map((t,i)=>['k'+i,t])));
   if(rows.length!==expected.length)fail('SI_ROLLING_MIGRATION_018_REQUIRED',503);
  });
 }
 async list(){
  if(this.mode==='json')return this.readFile().plans.map(sanitize).reverse();
  return this.db(async con=>(await this.query(con,
    'SELECT STATE_JSON FROM SI_PLAN_ROLLING ORDER BY CREATED_AT DESC'))
    .map(r=>sanitize(from(r.STATE_JSON))));
 }
 async get(id){
  if(!ID.test(id||''))fail('SI_ROLLING_PLAN_ID_INVALID',422);
  if(this.mode==='json'){
   const x=this.readFile().plans.find(p=>p.id===id);
   if(!x)fail('SI_ROLLING_PLAN_NOT_FOUND',404);
   return clone(x);
  }
  return this.db(async con=>{
   const x=await this.query(con,
    'SELECT STATE_JSON FROM SI_PLAN_ROLLING WHERE PLAN_ID=:id',{id});
   if(!x.length)fail('SI_ROLLING_PLAN_NOT_FOUND',404);
   return from(x[0].STATE_JSON);
  });
 }
 async previousCandidateDecisions(candidates){
  const plans=this.mode==='json'?this.readFile().plans:
   await this.db(async con=>(await this.query(con,
    'SELECT STATE_JSON FROM SI_PLAN_ROLLING ORDER BY CREATED_AT DESC'))
    .map(row=>from(row.STATE_JSON)));
  const results={};
  for(const prior of [...plans].reverse()){
   for(const c of candidates){
    if(results[c.imo])continue;
    const older=(prior.candidateSnapshot||[]).filter(x=>x.imo===c.imo);
    const currentKeys=new Set((c.sourceEvents||[]).map(x=>x.eventKey));
    const sameEvent=older.some(x=>(x.sourceEventKeys||[]).some(k=>currentKeys.has(k)));
    const oldKeysKnown=older.some(x=>(x.sourceEventKeys||[]).length);
    // An entirely NEW maritime referral must never inherit the previous
    // event's disposition merely because it has the same IMO.
    if(currentKeys.size&&oldKeysKnown&&!sameEvent)continue;
    const choice=prior.overrides?.[c.imo];
    if(choice){
     results[c.imo]={fromPlan:prior.number,disposition:choice.disposition||
      (choice.selected?'INCLUDE':'NOT_SELECTED'),
      reviewAfter:choice.reviewAfter||null,
      reason:choice.reason||null,decidedAt:choice.at||prior.updatedAt};
     continue;
    }
    // Derive 'not included' from a previously APPROVED plan snapshot. This
    // is NOT a DEFER/REJECT business decision and never removes eligibility.
    const approved=['APPROVED','IN_EXECUTION','COMPLETED'].includes(prior.status);
    const wasApproved=(prior.approvedVessels||[]).some(x=>x.imo===c.imo);
    if(approved&&sameEvent&&!wasApproved){
     results[c.imo]={fromPlan:prior.number,
      disposition:'NOT_SELECTED_IN_PREVIOUS_PLAN',reviewAfter:null,
      reason:'Vessel remained eligible but was not included in a previous approved plan; no formal deferral.',
      decidedAt:prior.approvedAt||prior.updatedAt,systemDerived:true};
    }
   }
  }
  return results;
 }
 async create(input={},actor,{candidates=[],sourceHash=null}={}){
  // No port belongs to the rolling inspection plan business model.
  // Legacy input.port is ignored; the nullable Oracle 018 PORT column is kept
  // for backwards compatibility without any destructive schema operation.
  const title=text(input.title,180),
   notes=input.notes?text(input.notes,1200):'';
  if(!title||input.notes&&!notes||
   !goodDate(input.startsOn||'')||!goodDate(input.endsOn||'')||
   input.endsOn<input.startsOn||!text(actor,160))
   fail('SI_ROLLING_PLAN_INFORMATION_INVALID',422);
  const createdAt=now();
  const carryForward=await this.previousCandidateDecisions(candidates);
  const state={id:randomUUID(),number:uniqueNumber(),title,startsOn:input.startsOn,
   endsOn:input.endsOn,notes,status:'DRAFT',revision:0,
   createdAt,createdBy:actor,updatedAt:createdAt,updatedBy:actor,
   overrides:{},latest:null,selectionSourceHash:null,savedPlanRows:null,
   candidateSnapshot:candidates.map(c=>({
    candidateKey:c.candidateKey,imo:c.imo,regime:c.regime,
    sourceEventKeys:(c.sourceEvents||[]).map(e=>e.eventKey),
    sourceTypes:c.sourceTypes||[],risk:c.currentRisk||null
   })),
   candidateSourceHash:sourceHash,carryForward,
   audit:[{event:'CREATED',at:createdAt,actor}],
   approvedBatchId:null,approvedVessels:[],approvedBy:null,approvedAt:null};
  if(this.mode==='json'){
   const data=this.readFile();data.plans.push(state);this.writeFile(data);
   return clone(state);
  }
  return this.db(async con=>{
   try{
    await con.execute(`INSERT INTO SI_PLAN_ROLLING
      (PLAN_ID,PLAN_NO,TITLE,START_DATE,END_DATE,NOTES,
       STATUS,VERSION_NO,STATE_JSON,CREATED_BY,UPDATED_BY)
      VALUES(:id,:planNo,:title,:startDate,:endDate,:notes,
       'DRAFT',0,:state,:actor,:actor)`,{
      id:state.id,planNo:state.number,title, startDate:state.startsOn,
      endDate:state.endsOn,notes,state:json(state),actor});
    await con.execute(`INSERT INTO SI_PLAN_ROLLING_VERSION
     (PLAN_ID,VERSION_NO,STATE_JSON,ACTOR,EVENT_CODE)
     VALUES(:id,0,:state,:actor,'CREATED')`,{
      id:state.id,state:json(state),actor});
    await this.audit(con,state.id,'CREATED',actor,{period:[state.startsOn,state.endsOn]});
    await con.commit();return clone(state);
   }catch(e){await con.rollback();throw e;}
  });
 }
 async audit(con,id,event,actor,details){
  await con.execute(`INSERT INTO SI_PLAN_ROLLING_AUDIT
    (AUDIT_ID,PLAN_ID,EVENT_CODE,ACTOR,DETAILS_JSON)
    VALUES(:id,:rollingId,:eventCode,:actor,:details)`,{
     id:randomUUID(),rollingId:id,eventCode:event,actor,details:json(details)});
 }
 async mutate(id,expectedRevision,actor,operation,event='UPDATED'){
  if(!Number.isInteger(expectedRevision)||!text(actor,160))
   fail('SI_ROLLING_REVISION_OR_ACTOR_INVALID',422);
  const allowed=p=>['DRAFT','READY_FOR_APPROVAL'].includes(p.status);
  const build=p=>{
   if(!allowed(p))fail('SI_ROLLING_APPROVED_PLAN_IMMUTABLE',409);
   if(p.revision!==expectedRevision)fail('SI_ROLLING_VERSION_CONFLICT',409);
   const next=operation(clone(p));
   next.revision=p.revision+1;next.updatedAt=now();next.updatedBy=actor;
   // Keep the one audited officer disposition breakdown that the trusted
   // bulk mutation added. Prior event history cannot be rewritten by it.
   const earlier=p.audit||[],proposed=next.audit||[];
   const sameHistory=proposed.length===earlier.length+1&&
     earlier.every((item,i)=>JSON.stringify(item)===JSON.stringify(proposed[i]));
   const detail=sameHistory&&proposed.at(-1)?.event==='BULK_DISPOSITION_DETAILS'&&
     event.startsWith('OFFICER_BULK_')?[proposed.at(-1)]:[];
   next.audit=[...earlier,...detail,{event,at:next.updatedAt,actor}].slice(-300);
   return next;
  };
  if(this.mode==='json'){
   const data=this.readFile(),index=data.plans.findIndex(p=>p.id===id);
   if(index<0)fail('SI_ROLLING_PLAN_NOT_FOUND',404);
   const next=build(data.plans[index]);data.plans[index]=next;this.writeFile(data);
   return clone(next);
  }
  return this.db(async con=>{
   try{
    const r=await this.query(con,`SELECT STATE_JSON FROM SI_PLAN_ROLLING
     WHERE PLAN_ID=:id FOR UPDATE`,{id});
    if(!r.length)fail('SI_ROLLING_PLAN_NOT_FOUND',404);
    const next=build(from(r[0].STATE_JSON));
    await con.execute(`UPDATE SI_PLAN_ROLLING SET STATUS=:status,
     VERSION_NO=:revision,STATE_JSON=:state,UPDATED_BY=:actor,
     UPDATED_AT=SYSTIMESTAMP WHERE PLAN_ID=:id`,{
     id,revision:next.revision,status:next.status,state:json(next),actor});
    await con.execute(`INSERT INTO SI_PLAN_ROLLING_VERSION
     (PLAN_ID,VERSION_NO,STATE_JSON,ACTOR,EVENT_CODE)
     VALUES(:id,:revision,:state,:actor,:eventCode)`,{
      id,revision:next.revision,state:json(next),actor,eventCode:event});
    await this.audit(con,id,event,actor,{revision:next.revision});
    await con.commit();return next;
   }catch(e){await con.rollback();throw e;}
  });
 }
 saveDraft(id,expectedRevision,actor,operation){
  return this.mutate(id,expectedRevision,actor,operation,'C01_REEVALUATED');
 }
 cancel(id,expectedRevision,actor,reason){
  if(!text(reason,500)||reason.trim().length<8)
   fail('SI_ROLLING_CANCELLATION_REASON_REQUIRED',422);
  return this.mutate(id,expectedRevision,actor,p=>{
   p.status='CANCELLED';p.cancelReason=reason.trim();return p;
  },'CANCELLED');
 }

 /** Supervisor approval of V2 roster: no cases or dossiers until scheduling. */
 async approveForScheduling(id,{expectedRevision,expectedSourceHash,actor,reason,vessels}={}){
  if(!ID.test(id||'')||!Number.isInteger(expectedRevision)||
    !text(actor,160)||!text(reason,500)||reason.trim().length<8||
    !text(expectedSourceHash,200))
   fail('SI_V2_PLAN_APPROVAL_INFORMATION_INVALID',422);
  if(!Array.isArray(vessels)||vessels.length===0)
   fail('SI_V2_PLAN_APPROVAL_NO_VESSELS',422);
  // V2 freezes a *roster only*. The legacy 40-vessel limit applies to
  // immediate case-creation batches, not this approval-only transaction.
  // C01 allows up to 500 workflows per controlled execution cycle.
  if(vessels.length>500)fail('SI_V2_PLAN_APPROVAL_ROSTER_LIMIT_500',422);
  if(vessels.some(v=>!v||typeof v!=='object'||
    !/^[0-9]{7}$/.test(v.imo||'')))
   fail('SI_V2_PLAN_APPROVAL_IMO_INVALID',422);
  if(new Set(vessels.map(v=>v.imo)).size!==vessels.length)
   fail('SI_V2_PLAN_APPROVAL_DUPLICATE_IMO',422);
  if(vessels.some(v=>!Number.isInteger(v.planRank)||v.planRank<1||
     v.planRank>vessels.length)||
     new Set(vessels.map(v=>v.planRank)).size!==vessels.length)
   fail('SI_V2_PLAN_APPROVAL_RANK_INVALID',422);
  if(vessels.some(v=>!Array.isArray(v.regimes)||!v.regimes.length||
     v.regimes.some(regime=>typeof regime!=='string'||!regime.trim())))
   fail('SI_V2_PLAN_APPROVAL_REGIMES_MISSING',422);
  if(vessels.some(v=>!Array.isArray(v.inspectionReasons)||
     !v.inspectionReasons.length||
     v.inspectionReasons.some(r=>!r||typeof r.eventKey!=='string'||!r.eventKey.trim())))
   fail('SI_V2_PLAN_APPROVAL_SOURCE_REASONS_MISSING',422);
  const change=before=>{
   if(before.status!=='READY_FOR_APPROVAL'||before.revision!==expectedRevision||
      before.selectionSourceHash!==expectedSourceHash)
    fail('SI_V2_PLAN_CHANGED_REVIEW_AGAIN',409);
   const selected=(before.savedPlanRows||before.latest?.rows||[]).filter(r=>r.planSelected);
   const allowed=new Set(selected.map(r=>r.imo));
   if(allowed.size!==vessels.length||vessels.some(v=>!allowed.has(v.imo)))
    fail('SI_V2_SELECTION_CHANGED_REVIEW_AGAIN',409);
   const next=clone(before),at=now();
   next.status='APPROVED';next.approvedAt=at;next.approvedBy=actor;
   next.scheduleMode='HUMAN_APPROVED_ROSTER_PENDING_AI_SCHEDULE';
   next.approvalReason=reason.trim();next.approvedBatchId=null;
   next.approvedVessels=clone(vessels.map(v=>({
    imo:v.imo,planRank:v.planRank,caseId:null,
    regimes:v.regimes,inspectionReasons:v.inspectionReasons
   })));
   next.approvedRows=clone(selected);
   next.revision++;next.updatedAt=at;next.updatedBy=actor;
   next.audit=[...(next.audit||[]),{
    event:'APPROVED_FOR_ELECTRONIC_SCHEDULING',at,actor,
    reason:reason.trim(),casesCreated:0
   }].slice(-300);
   return next;
  };
  if(this.mode==='json'){
   const state=this.readFile(),index=state.plans.findIndex(p=>p.id===id);
   if(index<0)fail('SI_ROLLING_PLAN_NOT_FOUND',404);
   const next=change(state.plans[index]);
   state.plans[index]=next;this.writeFile(state);return clone(next);
  }
  return this.db(async con=>{
   try{
    const found=await this.query(con,
      "SELECT STATE_JSON FROM SI_PLAN_ROLLING WHERE PLAN_ID=:p_plan FOR UPDATE",
      {p_plan:id});
    if(!found.length)fail('SI_ROLLING_PLAN_NOT_FOUND',404);
    const next=change(from(found[0].STATE_JSON));
    await con.execute(
      "UPDATE SI_PLAN_ROLLING SET STATUS='APPROVED',VERSION_NO=:p_rev,STATE_JSON=:p_state,APPROVED_BATCH_ID=NULL,APPROVED_BY=:p_actor,APPROVED_AT=SYSTIMESTAMP,UPDATED_BY=:p_actor2,UPDATED_AT=SYSTIMESTAMP WHERE PLAN_ID=:p_plan",
      {p_plan:id,p_rev:next.revision,p_state:json(next),p_actor:actor,p_actor2:actor});
    await con.execute(
      "INSERT INTO SI_PLAN_ROLLING_VERSION (PLAN_ID,VERSION_NO,STATE_JSON,ACTOR,EVENT_CODE) VALUES(:p_plan,:p_rev,:p_state,:p_actor,'APPROVED_FOR_SCHEDULING')",
      {p_plan:id,p_rev:next.revision,p_state:json(next),p_actor:actor});
    for(const vessel of next.approvedVessels){
      await con.execute(
        "INSERT INTO SI_PLAN_ROLLING_VESSEL (PLAN_ID,IMO,PLAN_RANK,CASE_ID,APPROVED_SCOPE_JSON) VALUES(:p_plan,:p_imo,:p_rank,NULL,:p_scope)",
        {p_plan:id,p_imo:vessel.imo,p_rank:vessel.planRank,
         p_scope:json({regimes:vessel.regimes})});
      for(const evidence of vessel.inspectionReasons){
        await con.execute(
          "INSERT INTO SI_PLAN_ROLLING_REASON (PLAN_ID,IMO,EVENT_KEY,REASON_JSON) VALUES(:p_plan,:p_imo,:p_event,:p_doc)",
          {p_plan:id,p_imo:vessel.imo,p_event:evidence.eventKey,p_doc:json(evidence)});
      }
    }
    await this.audit(con,id,'APPROVED_FOR_ELECTRONIC_SCHEDULING',actor,
      {vessels:vessels.length,casesCreated:0,reason:reason.trim()});
    await con.commit();return clone(next);
   }catch(error){await con.rollback();throw error;}
  });
 }
 async approve(id,{expectedRevision,batchId,cases,actor}){
  if(!ID.test(id||'')||!ID.test(batchId||'')||!Array.isArray(cases)||
   !cases.length||!text(actor,160))fail('SI_ROLLING_APPROVAL_INVALID',422);
  const change=p=>{
   if(p.approvedBatchId===batchId)return p;
   if(!['DRAFT','READY_FOR_APPROVAL'].includes(p.status)||
     p.revision!==expectedRevision)fail('SI_ROLLING_APPROVAL_CONFLICT',409);
   p.status='APPROVED';p.approvedBatchId=batchId;
   p.approvedAt=now();p.approvedBy=actor;
   p.approvedVessels=cases.map(({imo,caseId,planRank,inspectionReasons,regimes})=>({
    imo,caseId,planRank,inspectionReasons,regimes}));
   // Pin the original approved selection for tomorrow's historical reads.
   // Do not recompute it from a newer PSC/NMC source snapshot.
   p.approvedRows=clone((p.savedPlanRows||p.latest?.rows||[])
     .filter(row=>row.planSelected));
   p.revision++;p.updatedAt=now();p.updatedBy=actor;
   p.audit=[...(p.audit||[]),{event:'APPROVED',at:p.approvedAt,actor,
    batchId}].slice(-300);
   return p;
  };
  if(this.mode==='json'){
   const data=this.readFile(),index=data.plans.findIndex(p=>p.id===id);
   if(index<0)fail('SI_ROLLING_PLAN_NOT_FOUND',404);
   const next=change(clone(data.plans[index]));
   data.plans[index]=next;this.writeFile(data);return next;
  }
  return this.db(async con=>{
   try{
    const found=await this.query(con,`SELECT STATE_JSON FROM SI_PLAN_ROLLING
      WHERE PLAN_ID=:id FOR UPDATE`,{id});
    if(!found.length)fail('SI_ROLLING_PLAN_NOT_FOUND',404);
    const before=from(found[0].STATE_JSON),next=change(clone(before));
    if(before.approvedBatchId===batchId){await con.rollback();return before;}
    await con.execute(`UPDATE SI_PLAN_ROLLING SET STATUS='APPROVED',
      VERSION_NO=:rev,STATE_JSON=:state,APPROVED_BATCH_ID=:batch,
      APPROVED_BY=:actor,APPROVED_AT=SYSTIMESTAMP,UPDATED_BY=:actor2,
      UPDATED_AT=SYSTIMESTAMP WHERE PLAN_ID=:id`,{
       id,rev:next.revision,state:json(next),batch:batchId,actor,actor2:actor});
    await con.execute(`INSERT INTO SI_PLAN_ROLLING_VERSION
      (PLAN_ID,VERSION_NO,STATE_JSON,ACTOR,EVENT_CODE)
      VALUES(:id,:version,:state,:actor,'APPROVED')`,{
       id,version:next.revision,state:json(next),actor});
    for(const item of next.approvedVessels){
     await con.execute(`INSERT INTO SI_PLAN_ROLLING_VESSEL
       (PLAN_ID,IMO,PLAN_RANK,CASE_ID,APPROVED_SCOPE_JSON)
       VALUES(:rollingId,:imo,:planRank,:caseId,:scope)`,{
        rollingId:id,imo:item.imo,planRank:item.planRank,caseId:item.caseId,
        scope:json({regimes:item.regimes})});
     for(const reason of item.inspectionReasons){
      await con.execute(`INSERT INTO SI_PLAN_ROLLING_REASON
       (PLAN_ID,IMO,EVENT_KEY,REASON_JSON)
       VALUES(:rollingId,:imo,:eventKey,:reason)`,{
        rollingId:id,imo:item.imo,eventKey:reason.eventKey,reason:json(reason)});
     }
    }
    await this.audit(con,id,'APPROVED',actor,{batchId,vessels:cases.length});
    await con.commit();return next;
   }catch(e){await con.rollback();throw e;}
  });
 }
 /**
  * Linked case execution never changes an approved vessel/reason snapshot.
  * Each transition is a new durable version with an audit entry.
  */
 async setExecutionState(planId,target,actor){
  if(!['IN_EXECUTION','COMPLETED'].includes(target)||!text(actor,160))
   fail('SI_ROLLING_STATE_INVALID',422);
  const advance=p=>{
   if(p.status===target)return p;
   const required=target==='IN_EXECUTION'?'APPROVED':'IN_EXECUTION';
   if(p.status!==required)fail('SI_ROLLING_STATE_TRANSITION_INVALID',409);
   p.status=target;p.revision++;p.updatedAt=now();p.updatedBy=actor;
   p.audit=[...(p.audit||[]),{event:target,at:p.updatedAt,actor}].slice(-300);
   return p;
  };
  if(this.mode==='json'){
   const data=this.readFile(),i=data.plans.findIndex(p=>p.id===planId);
   if(i<0)fail('SI_ROLLING_PLAN_NOT_FOUND',404);
   const next=advance(clone(data.plans[i]));
   data.plans[i]=next;this.writeFile(data);return next;
  }
  return this.db(async con=>{
   try{
    const found=await this.query(con,`SELECT STATE_JSON FROM SI_PLAN_ROLLING
      WHERE PLAN_ID=:id FOR UPDATE`,{id:planId});
    if(!found.length)fail('SI_ROLLING_PLAN_NOT_FOUND',404);
    const before=from(found[0].STATE_JSON);
    if(before.status===target){await con.rollback();return before;}
    const next=advance(clone(before));
    await con.execute(`UPDATE SI_PLAN_ROLLING SET STATUS=:status,
      VERSION_NO=:version,STATE_JSON=:state,UPDATED_BY=:actor,
      UPDATED_AT=SYSTIMESTAMP WHERE PLAN_ID=:id`,{
       id:planId,status:next.status,version:next.revision,
       state:json(next),actor});
    await con.execute(`INSERT INTO SI_PLAN_ROLLING_VERSION
      (PLAN_ID,VERSION_NO,STATE_JSON,ACTOR,EVENT_CODE)
      VALUES(:id,:version,:state,:actor,:eventCode)`,{
       id:planId,version:next.revision,state:json(next),actor,eventCode:target});
    await this.audit(con,planId,target,actor,{linkedCases:next.approvedVessels.length});
    await con.commit();return next;
   }catch(e){await con.rollback();throw e;}
  });
 }
 /**
  * SI-S02 assigns an already human-approved inspection case to an immutable
  * approved-plan IMO. It may update CASE_ID and version, never change
  * statutory source reasons, selected roster or scope.
  */
 async attachScheduledCase(planId,imo,caseId,actor,scheduleId){
  if(!ID.test(planId||'')||!/^[0-9]{7}$/.test(imo||'')||
     !ID.test(caseId||'')||!ID.test(scheduleId||'')||
     !text(actor,160))fail('SI_ROLLING_CASE_LINK_INVALID',422);
  const link=before=>{
   const p=clone(before);
   if(!['APPROVED','IN_EXECUTION'].includes(p.status))
    fail('SI_ROLLING_APPROVED_PLAN_REQUIRED',409);
   const item=p.approvedVessels?.find(v=>v.imo===imo);
   if(!item)fail('SI_ROLLING_APPROVED_VESSEL_NOT_FOUND',409);
   if(item.caseId===caseId)return {unchanged:true,next:p};
   if(item.caseId)fail('SI_ROLLING_DIFFERENT_CASE_ALREADY_LINKED',409);
   item.caseId=caseId;p.revision++;p.updatedAt=now();p.updatedBy=actor;
   p.audit=[...(p.audit||[]),{event:'WORK_ORDER_CASE_LINKED',at:p.updatedAt,
    actor,imo,caseId,scheduleId}].slice(-300);
   return {unchanged:false,next:p};
  };
  if(this.mode==='json'){
   const state=this.readFile(),i=state.plans.findIndex(p=>p.id===planId);
   if(i<0)fail('SI_ROLLING_PLAN_NOT_FOUND',404);
   const value=link(state.plans[i]);
   if(!value.unchanged){state.plans[i]=value.next;this.writeFile(state);}
   return value.next;
  }
  return this.db(async con=>{
   try{
    const found=await this.query(con,
     'SELECT STATE_JSON FROM SI_PLAN_ROLLING WHERE PLAN_ID=:id FOR UPDATE',
     {id:planId});
    if(!found.length)fail('SI_ROLLING_PLAN_NOT_FOUND',404);
    const value=link(from(found[0].STATE_JSON));
    if(value.unchanged){await con.rollback();return value.next;}
    const next=value.next;
    const updated=await con.execute(
     'UPDATE SI_PLAN_ROLLING_VESSEL SET CASE_ID=:caseId WHERE PLAN_ID=:id '+
     'AND IMO=:imo AND CASE_ID IS NULL',{caseId,id:planId,imo});
    if(updated.rowsAffected!==1)fail('SI_ROLLING_CASE_LINK_CONFLICT',409);
    await con.execute('UPDATE SI_PLAN_ROLLING SET VERSION_NO=:version, '+
     'STATE_JSON=:state,UPDATED_BY=:actor,UPDATED_AT=SYSTIMESTAMP '+
     'WHERE PLAN_ID=:id',{id:planId,version:next.revision,state:json(next),actor});
    await con.execute('INSERT INTO SI_PLAN_ROLLING_VERSION '+
     "(PLAN_ID,VERSION_NO,STATE_JSON,ACTOR,EVENT_CODE) "+
     "VALUES(:id,:version,:state,:actor,'WORK_ORDER_CASE_LINKED')",{
      id:planId,version:next.revision,state:json(next),actor});
    await this.audit(con,planId,'WORK_ORDER_CASE_LINKED',actor,
     {imo,caseId,scheduleId});
    await con.commit();return next;
   }catch(e){await con.rollback();throw e;}
  });
 }
 /**
  * Called only after an INSPECTOR/SUPERVISOR lifecycle CLOSE has actually
  * persisted. Never infer closure from a planning date, or from AI.
  */
 async completeIfAllClosed(changedCaseId,actor,lifecycle){
  if(!ID.test(changedCaseId||''))return [];
  let ids;
  if(this.mode==='json')
   ids=this.readFile().plans.filter(p=>p.approvedVessels?.some(v=>
     v.caseId===changedCaseId)).map(p=>p.id);
  else ids=await this.db(async con=>
   (await this.query(con,`SELECT PLAN_ID FROM SI_PLAN_ROLLING_VESSEL
     WHERE CASE_ID=:id`,{id:changedCaseId})).map(r=>r.PLAN_ID));
  if(!ids.length)return [];
  const live=await lifecycle.list();
  const cases=new Map((live.cases||[]).map(c=>[c.id,c.stage]));
  const results=[];
  for(const id of ids){
   const p=await this.get(id);
   if(p.status!=='IN_EXECUTION')continue;
   if(!p.approvedVessels.length||
      !p.approvedVessels.every(v=>cases.get(v.caseId)==='CLOSED'))continue;
   results.push(await this.setExecutionState(id,'COMPLETED',actor));
  }
  return results;
 }

}
