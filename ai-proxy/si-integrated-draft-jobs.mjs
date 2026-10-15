/**
 * Asynchronous, actor-scoped integrated draft generation.
 * Avoids Nginx 130-second read timeouts for multiple serial paid C01 batches.
 * In-process only: restart loses pending previews; never auto-restarts Airia.
 * Starting an identical pending/completed request within TTL reuses its job.
 */
import {randomUUID,createHash} from 'node:crypto';

export class SiDraftJobError extends Error{
 constructor(code,status=409){super(code);this.code=code;this.status=status;}
}
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const cleanCode=x=>typeof x==='string'&&/^[A-Z][A-Z0-9_]{2,110}$/.test(x)?
 x:'SI_DRAFT_INTERNAL_PROCESSING_ERROR';
const positiveInt=x=>Number.isInteger(x)&&x>0?x:null;
export class SiIntegratedDraftJobs{
 constructor({ttlMs=45*60*1000,maxJobs=60,clock=Date.now,logger=console}={}){
  this.ttlMs=ttlMs;this.maxJobs=maxJobs;this.clock=clock;this.logger=logger;
  this.jobs=new Map();
 }
 get(id,actor){
  const job=this.jobs.get(id);
  if(!job||job.actor!==actor||
   (['COMPLETED','FAILED'].includes(job.status)&&
    this.clock()-job.finishedAt>this.ttlMs))
   throw new SiDraftJobError('SI_DRAFT_JOB_NOT_FOUND_OR_EXPIRED',404);
  return job;
 }
 view(job){
  return {status:job.status,jobId:job.id,phase:job.phase,
   createdAt:job.createdAt,
   expectedBatches:job.expectedBatches,
   completedBatches:job.completedBatches,
   ...(job.status==='COMPLETED'?{preview:job.preview}:{ }),
   ...(job.status==='FAILED'?{error:job.failure.error,
     ...(job.failure.reasonCode?{reasonCode:job.failure.reasonCode}:{}),
     ...(job.failure.failureCounts?{failureCounts:job.failure.failureCounts}:{}),
     ...(job.failure.batchIndex?{batchIndex:job.failure.batchIndex}:{}),
     ...(job.failure.batchCount?{batchCount:job.failure.batchCount}:{})}:{})};
 }
 start({actor,metadata,sourceHash,expectedBatches,execute}){
  if(typeof actor!=='string'||!actor||typeof sourceHash!=='string'||
   !Number.isInteger(expectedBatches)||expectedBatches<1||
   typeof execute!=='function')
   throw new SiDraftJobError('SI_DRAFT_JOB_INPUT_INVALID',422);
  // A refresh/retry during an in-flight paid run must not start another.
  const signature=hash({actor,metadata,sourceHash});
  for(const job of this.jobs.values())
   if(job.actor===actor&&['QUEUED','RUNNING'].includes(job.status))
    return this.view(job);
  for(const job of this.jobs.values())
   if(job.actor===actor&&job.signature===signature&&job.status==='COMPLETED'&&
    this.clock()-job.finishedAt<this.ttlMs)
    return this.view(job);
  this.cleanup();
  if(this.jobs.size>=this.maxJobs)
   throw new SiDraftJobError('SI_DRAFT_JOB_QUEUE_FULL',503);
  const id=randomUUID(),started=this.clock();
  const job={id,actor,signature,status:'QUEUED',phase:'WAITING_TO_START',
   createdAt:new Date(started).toISOString(),startedAt:started,
   expectedBatches,completedBatches:0,finishedAt:null,
   preview:null,failure:null};
  this.jobs.set(id,job);
  queueMicrotask(()=>{
   job.status='RUNNING';job.phase='VALIDATING_C01_SOURCE';
   const progress=info=>{
    if(job.status!=='RUNNING')return;
    job.phase='VALIDATING_C01_BATCHES';
    const done=Number(info?.completedBatches);
    if(Number.isInteger(done)&&done>=0&&done<=job.expectedBatches)
     job.completedBatches=done;
   };
   Promise.resolve().then(()=>execute(progress,phase=>{
    if(job.status==='RUNNING')job.phase=phase;
   })).then(preview=>{
    if(!preview||typeof preview!=='object'||!preview.previewId)
     throw new SiDraftJobError('SI_DRAFT_JOB_PREVIEW_INVALID',500);
    job.preview=preview;job.completedBatches=job.expectedBatches;
    job.status='COMPLETED';job.phase='READY_FOR_OPERATOR_REVIEW';
    job.finishedAt=this.clock();
   }).catch(e=>{
    const code=cleanCode(e?.code);
    const counts=e?.failureCounts&&typeof e.failureCounts==='object'?
     Object.fromEntries(Object.entries(e.failureCounts)
      .filter(([key,value])=>/^[A-Z][A-Z0-9_]{2,100}$/.test(key)&&
       positiveInt(value)!==null).slice(0,8)):null;
    job.failure={error:code,reasonCode:cleanCode(e?.diagnosticCode),
     failureCounts:counts&&Object.keys(counts).length?counts:null,
     batchIndex:positiveInt(e?.batchIndex),
     batchCount:positiveInt(e?.batchCount)};
    if(job.failure.reasonCode==='SI_DRAFT_INTERNAL_PROCESSING_ERROR')
     job.failure.reasonCode=null;
    job.status='FAILED';job.phase='FAILED_NO_DRAFT_SAVED';
    job.finishedAt=this.clock();
    // Never log the raw exception: upstream response may contain PII/secrets.
    this.logger.error('[si-draft-job] failure',
     {jobId:id,error:code,batchIndex:job.failure.batchIndex,
      batchCount:job.failure.batchCount});
   });
  });
  return this.view(job);
 }
 cleanup(){
  for(const [id,j] of this.jobs)
   if(['COMPLETED','FAILED'].includes(j.status)&&
     this.clock()-j.finishedAt>this.ttlMs)this.jobs.delete(id);
  // Never delete an active job (it may be running charged AI requests).
 }
}
