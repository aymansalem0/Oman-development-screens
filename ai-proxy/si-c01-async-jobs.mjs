/**
 * Bounded asynchronous C01 execution for multi-batch Airia/Oracle POC.
 *
 * HTTP must not wait for 5 sequential ~120s Airia calls when Nginx/Browser
 * has a shorter reverse-proxy timeout. The user explicitly initiates the
 * run; this class NEVER auto-retries and never calls Airia on GET.
 *
 * Job state is intentionally IN-MEMORY only: a container restart loses the
 * status. Reconcile with source/plan BEFORE any manual re-run; this job API
 * never claims persistent or crash-resumable task execution.
 */
import {randomUUID,createHash} from 'node:crypto';

const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const copy=x=>structuredClone(x);
const MAX=16,EXPIRE_MS=30*60*1000;
const CODE=/^[A-Z][A-Z0-9_]{2,100}$/;
const errorCode=v=>typeof v==='string'&&CODE.test(v)?v:'SI_C01_ASYNC_EXECUTION_FAILED';
const errorDetails=e=>({
 error:errorCode(e?.code),
 ...(typeof e?.diagnosticCode==='string'&&CODE.test(e.diagnosticCode)?
   {reasonCode:e.diagnosticCode}:{}),
 ...(e?.failureCounts&&typeof e.failureCounts==='object'?
   {failureCounts:Object.fromEntries(Object.entries(e.failureCounts)
     .filter(([key,value])=>CODE.test(key)&&Number.isInteger(value)&&value>=0))}:{}),
 ...(Number.isInteger(e?.expectedCount)?{expectedCount:e.expectedCount}:{}),
 ...(Number.isInteger(e?.returnedCount)?{returnedCount:e.returnedCount}:{}),
 ...(Number.isInteger(e?.batchIndex)?{batchIndex:e.batchIndex}:{}),
 ...(Number.isInteger(e?.batchCount)?{batchCount:e.batchCount}:{})
});
export class SiC01JobError extends Error{
 constructor(code,status=409){super(code);this.code=code;this.status=status;}
}
export class SiC01AsyncJobs{
 constructor({clock=()=>Date.now(),limit=MAX,ttl=EXPIRE_MS}={}){
  this.jobs=new Map();this.clock=clock;this.limit=limit;this.ttl=ttl;
 }
 purge(){
  for(const [id,job] of this.jobs){
   if(job.state!=='RUNNING'&&this.clock()-job.finishedAt>this.ttl)
    this.jobs.delete(id);
  }
 }
 visible(job){
  const {id,kind,state,startedAt,finishedAt,progress,result,error}=job;
  return {status:state,jobId:id,kind,startedAt,finishedAt,
   progress:copy(progress),
   ...(state==='COMPLETED'?{result:copy(result)}:{}),
   ...(state==='FAILED'?{error:copy(error)}:{})};
 }
 active(owner,kind='PLAN_RERANK'){
  this.purge();
  const found=[...this.jobs.values()].find(x=>
   x.owner===owner&&x.kind===kind&&x.state==='RUNNING');
  return found?this.visible(found):null;
 }
 status(owner,id){
  this.purge();
  const job=this.jobs.get(id);
  if(!job)throw new SiC01JobError('SI_C01_JOB_NOT_FOUND_OR_EXPIRED',404);
  if(job.owner!==owner)throw new SiC01JobError('SI_C01_JOB_ACCESS_DENIED',403);
  return this.visible(job);
 }
 submit({owner,kind,request,run,expectedBatches=null}){
  if(typeof owner!=='string'||owner.length<10||
   !['PLAN_RERANK','CANDIDATE_SELECTION'].includes(kind)||
   !request||typeof run!=='function')
   throw new SiC01JobError('SI_C01_JOB_INPUT_INVALID',422);
  this.purge();
  const fingerprint=sha({kind,request});
  const active=[...this.jobs.values()].find(x=>x.state==='RUNNING');
  if(active){
   if(active.owner===owner&&active.fingerprint===fingerprint)
    return {status:'ACCEPTED',...this.visible(active),
      message:'ALREADY_RUNNING_NO_DUPLICATE_AIRIA_CALL'};
   throw new SiC01JobError('SI_C01_JOB_ALREADY_RUNNING',409);
  }
  if(this.jobs.size>=this.limit){
   // Evict oldest completed jobs only, never running, before refusing.
   const evict=[...this.jobs.values()].filter(x=>x.state!=='RUNNING')
    .sort((a,b)=>a.finishedAt-b.finishedAt);
   while(this.jobs.size>=this.limit&&evict.length)
    this.jobs.delete(evict.shift().id);
   if(this.jobs.size>=this.limit)
    throw new SiC01JobError('SI_C01_JOB_CAPACITY_REACHED',503);
  }
  const job={id:randomUUID(),owner,kind,fingerprint,state:'RUNNING',
   startedAt:new Date(this.clock()).toISOString(),finishedAt:null,
   progress:{batchIndex:0,batchCount:expectedBatches,
    verified:0,quarantined:0,stage:'STARTING'},
   result:null,error:null};
  this.jobs.set(job.id,job);
  // Intentionally don't await AI/Oracle; the caller receives HTTP 202 now.
  queueMicrotask(async()=>{
   try{
    const result=await run({
     onBatch:report=>{
      if(job.state!=='RUNNING')return;
      if(!report||!Number.isInteger(report.batchIndex))return;
      job.progress={batchIndex:report.batchIndex,
       batchCount:report.batchCount,
       verified:report.verified,
       quarantined:report.quarantined,
       stage:'AIRIA_BATCH_VALIDATED'};
     }
    });
    job.result=result;job.state='COMPLETED';
   }catch(e){
    job.error=errorDetails(e);job.state='FAILED';
    // Stable enum-only logs: no maritime source payload, credentials or model text.
    console.warn('[si-c01-jobs] FAILED code='+job.error.error+
      ' reason='+(job.error.reasonCode||'UNKNOWN')+
      ' batch='+(job.error.batchIndex||0));
   }finally{
    job.finishedAt=this.clock();
    job.progress.stage=job.state;
   }
  });
  return {status:'ACCEPTED',...this.visible(job),
   message:'C01_RUNNING_IN_SERVER_POLL_JOB_STATUS_NO_AUTOMATIC_RETRY'};
 }
}
export function c01JobOwner(req,session){
 const raw=typeof session?.email==='string'&&session.email.trim()?
   session.email.trim().toLowerCase():
   typeof session?.username==='string'&&session.username.trim()?
    session.username.trim().toLowerCase():null;
 if(raw)return 'MOEI:'+sha(raw);
 const access=req?.headers?.['x-nmc-dashboard-key'];
 if(typeof access==='string'&&access.length>=24)
  return 'EDITOR:'+sha(access);
 throw new SiC01JobError('SI_C01_JOB_AUTHENTICATED_EDITOR_REQUIRED',403);
}
