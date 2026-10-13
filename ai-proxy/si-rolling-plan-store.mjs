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
 port:x.port||null,notes:x.notes||'',status:x.status,revision:x.revision,
 createdBy:x.createdBy,createdAt:x.createdAt,updatedBy:x.updatedBy,
 updatedAt:x.updatedAt,approvedAt:x.approvedAt||null,
 approvedBy:x.approvedBy||null,approvedBatchId:x.approvedBatchId||null,
 vesselCount:x.approvedVessels?.length??x.latest?.rows?.filter(r=>r.planSelected).length??0
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
 async create(input={},actor){
  const title=text(input.title,180),port=input.port?text(input.port,160):null,
   notes=input.notes?text(input.notes,1200):'';
  if(!title||input.port&&!port||input.notes&&!notes||
   !goodDate(input.startsOn||'')||!goodDate(input.endsOn||'')||
   input.endsOn<input.startsOn||!text(actor,160))
   fail('SI_ROLLING_PLAN_INFORMATION_INVALID',422);
  const createdAt=now();
  const state={id:randomUUID(),number:uniqueNumber(),title,startsOn:input.startsOn,
   endsOn:input.endsOn,port,notes,status:'DRAFT',revision:0,
   createdAt,createdBy:actor,updatedAt:createdAt,updatedBy:actor,
   overrides:{},latest:null,audit:[{event:'CREATED',at:createdAt,actor}],
   approvedBatchId:null,approvedVessels:[],approvedBy:null,approvedAt:null};
  if(this.mode==='json'){
   const data=this.readFile();data.plans.push(state);this.writeFile(data);
   return clone(state);
  }
  return this.db(async con=>{
   try{
    await con.execute(`INSERT INTO SI_PLAN_ROLLING
      (PLAN_ID,PLAN_NO,TITLE,START_DATE,END_DATE,PORT,NOTES,
       STATUS,VERSION_NO,STATE_JSON,CREATED_BY,UPDATED_BY)
      VALUES(:id,:number,:title,:startDate,:endDate,:port,:notes,
       'DRAFT',0,:state,:actor,:actor)`,{
      id:state.id,number:state.number,title, startDate:state.startsOn,
      endDate:state.endsOn,port,notes,state:json(state),actor});
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
    VALUES(:id,:plan,:event,:actor,:details)`,{
     id:randomUUID(),plan:id,event,actor,details:json(details)});
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
   next.audit=[...(p.audit||[]),{event,at:next.updatedAt,actor}].slice(-300);
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
     VALUES(:id,:revision,:state,:actor,:event)`,{
      id,revision:next.revision,state:json(next),actor,event});
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
       VALUES(:plan,:imo,:rank,:caseId,:scope)`,{
        plan:id,imo:item.imo,rank:item.planRank,caseId:item.caseId,
        scope:json({regimes:item.regimes})});
     for(const reason of item.inspectionReasons){
      await con.execute(`INSERT INTO SI_PLAN_ROLLING_REASON
       (PLAN_ID,IMO,EVENT_KEY,REASON_JSON)
       VALUES(:plan,:imo,:key,:reason)`,{
        plan:id,imo:item.imo,key:reason.eventKey,reason:json(reason)});
     }
    }
    await this.audit(con,id,'APPROVED',actor,{batchId,vessels:cases.length});
    await con.commit();return next;
   }catch(e){await con.rollback();throw e;}
  });
 }
}
