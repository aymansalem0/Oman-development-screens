/**
 * SI-01 -> SI-02 bulk business orchestration, POC single-process implementation.
 *
 * One human-approved selection of an entire proposed inspection PLAN. Each
 * selected IMO/regime becomes a distinct SI case, after which deterministic
 * SI-02 preparation is built. Optional A04 and post-approval P01 require a
 * separately visible batch cost consent and never authorize/approve scope.
 *
 * IMPORTANT: jobs persist to the Docker /data volume; Oracle cases/dossiers
 * stay authoritative in Oracle mode. This is not an XA transaction, so each
 * item exposes its real outcome and retries are explicitly operator initiated.
 */
import {randomUUID,createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,renameSync,writeFileSync} from 'node:fs';
import {dirname} from 'node:path';

const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const text=(x,max=500)=>typeof x==='string'&&x.trim().length>0&&x.trim().length<=max?x.trim():null;
const clone=x=>JSON.parse(JSON.stringify(x));
const now=()=>new Date().toISOString();
const QUEUED='QUEUED',RUNNING='RUNNING',COMPLETED='COMPLETED',PARTIAL='PARTIAL';
const MAX_BATCH=40;
const MAX_AI_PER_BATCH=15;
export class SiBulkApprovalError extends Error{
 constructor(code,status=422){super(code);this.code=code;this.status=status;}
}
const empty=()=>({version:1,jobs:[]});
function saveAtomic(file,state){
 mkdirSync(dirname(file),{recursive:true});
 const tmp=file+'.'+randomUUID()+'.tmp';
 writeFileSync(tmp,JSON.stringify(state,null,2),{mode:0o600});
 renameSync(tmp,file);
}

export class SiBulkInspectionPlan{
 constructor({inspectionPlan,targeting,preparation,priority,
   file=process.env.SI_BATCH_PLAN_PATH||'/data/si-approved-batch-plans.json',
   submitTask=fn=>setImmediate(fn),maxBatch=MAX_BATCH}={}){
  if(!inspectionPlan||!targeting||!preparation||!priority)
   throw Error('SI_BULK_ORCHESTRATOR_CONFIGURATION_INVALID');
  this.plan=inspectionPlan;this.targeting=targeting;
  this.preparation=preparation;this.priority=priority;this.file=file;
  this.submitTask=submitTask;this.maxBatch=maxBatch;
  this.active=new Set();
 }
 read(){
  if(!existsSync(this.file))return empty();
  let state;
  try{state=JSON.parse(readFileSync(this.file,'utf8'));}
  catch{throw new SiBulkApprovalError('SI_BULK_STORE_INVALID',503);}
  if(state?.version!==1||!Array.isArray(state.jobs))
   throw new SiBulkApprovalError('SI_BULK_STORE_INVALID',503);
  return state;
 }
 put(job){
  const state=this.read();
  const ix=state.jobs.findIndex(x=>x.id===job.id);
  if(ix>=0)state.jobs[ix]=clone(job);else state.jobs.push(clone(job));
  state.jobs=state.jobs.slice(-100);saveAtomic(this.file,state);
 }
 get(id){
  const job=this.read().jobs.find(x=>x.id===id);
  if(!job)throw new SiBulkApprovalError('SI_BULK_PLAN_NOT_FOUND',404);
  const {id:jobId,status,createdAt,updatedAt,approvedBy,approvedCount,
    totalSelected,items,priorityStatus,sourceHash,planRevision,planId,
    approvalReason,mode,finishedAt,progressMessage}=job;
  return {id:jobId,rollingPlanId:planId??null,status,createdAt,updatedAt,approvedBy,approvedCount,
   totalSelected,sourceHash,planRevision,approvalReason,mode,finishedAt,
   progressMessage,priorityStatus,
   items:items.map(x=>({imo:x.imo,candidateKey:x.candidateKey,
     regime:x.regime,regimes:x.regimes||[x.regime],
     reasonCount:x.inspectionReasons?.length||0,
     vesselName:x.vesselName,planRank:x.planRank,
     state:x.state,inspectionCaseId:x.inspectionCaseId,
     dossierStatus:x.dossierStatus,aiDossierStatus:x.aiDossierStatus,
     error:x.error||null}))};
 }
 latest(){return this.read().jobs.slice(-5).reverse().map(x=>this.get(x.id));}
 async preview(planId=null){
  const plan=await this.plan.snapshot(planId);
  if(planId&&!['DRAFT','READY_FOR_APPROVAL'].includes(plan.planStatus))
   throw new SiBulkApprovalError('SI_ROLLING_PLAN_NOT_READY_FOR_APPROVAL',409);
  const dashboard=await this.targeting.dashboard();
  const eligible=c=>c.status==='PENDING_REVIEW'||
    (c.status==='EXTERNALLY_SCHEDULED'&&
     c.events.some(e=>e.sourceType==='NMC_CASE'&&e.approval==='APPROVED'));
  const selected=(plan.stale||(!plan.agentRunId&&!plan.manualSelection))?[]:
    plan.rows.filter(x=>x.planSelected);
  const vessels=selected.map(row=>{
    // One vessel, ALL eligible approval triggers. Never choose just one
    // regulatory regime or discard the second NMC/service/PSC reason.
    const workflows=(dashboard.candidates||[])
      .filter(c=>c.imo===row.imo&&eligible(c))
      .sort((a,b)=>Number(b.events.some(e=>e.sourceType==='NMC_CASE'))-
        Number(a.events.some(e=>e.sourceType==='NMC_CASE'))||
        a.regime.localeCompare(b.regime));
    const triggers=new Map();
    for(const workflow of workflows){
      for(const event of workflow.events||[]){
        const key=event.eventKey||
          [event.sourceType,event.sourceEventId,workflow.regime].join(':');
        if(!triggers.has(key))triggers.set(key,{
          eventKey:key,candidateKey:workflow.key,
          sourceType:event.sourceType,sourceEventId:event.sourceEventId,
          sourceReference:event.sourceReference,inspectionRegime:workflow.regime,
          sourceApproval:event.approval,
          reason:event.contextNote||null,
          evidenceIds:[...new Set(event.evidenceIds||[])],
          sourceProvenance:event.provenance||null
        });
      }
    }
    return {imo:row.imo,vesselName:row.vesselName,rank:row.effectiveRank,
      candidateKeys:workflows.map(c=>c.key),
      primaryCandidateKey:workflows[0]?.key||null,
      inspectionRegimes:[...new Set(workflows.map(c=>c.regime))],
      reasons:[...triggers.values()],
      missingSource:workflows.length===0||triggers.size===0};
  });
  const warnings=[];
  if(plan.stale)warnings.push('SI_PLAN_STALE_RERUN_C01');
  if(!plan.agentRunId&&!plan.manualSelection)warnings.push('SI_SELECTION_NOT_REVIEWED');
  if(!vessels.length)warnings.push('SI_PLAN_NO_SELECTED_VESSELS');
  if(vessels.some(v=>v.missingSource))warnings.push('SI_INSPECTION_SOURCE_UNAVAILABLE_REVIEW');
  return {status:'PREVIEW',planId,planNumber:plan.planNumber||null,
   sourceHash:plan.sourceHash,
    planRevision:plan.revision,agentRunId:plan.agentRunId,
    planGeneratedAt:plan.generatedAt,provider:plan.provider,
    selectionMode:plan.selectionMode,manualSelection:plan.manualSelection,
    stale:plan.stale,selectedVessels:vessels.length,vessels,
    mandatoryChecksPreserved:true,
    a04Enabled:this.preparation.enabled&&this.preparation.ready,
    p01Enabled:false, // retired regardless of mock/provider/runtime settings
    a04Provider:this.preparation.provider.toUpperCase(),
    p01Provider:this.priority.provider.toUpperCase(),
    maxAiPerBatch:MAX_AI_PER_BATCH,
    warnings,requiresSupervisorApproval:true};
 }
 async approve(input){
  const reason=text(input?.reason,500),actor=text(input?.actor,120);
  if(!actor||!reason||reason.length<8)
   throw new SiBulkApprovalError('SI_BULK_APPROVAL_REASON_REQUIRED',422);
  if(input.confirmApproval!==true||input.choices!==undefined||
     !Number.isInteger(input.expectedRevision)||typeof input.expectedSourceHash!=='string')
   throw new SiBulkApprovalError('SI_BULK_APPROVAL_INVALID',422);
  if(input.generateA04!==true&&input.generateA04!==false||
     input.runP01!==true&&input.runP01!==false)
   throw new SiBulkApprovalError('SI_BULK_AI_SELECTION_REQUIRED',422);
  if(input.runP01===true)
   throw new SiBulkApprovalError('SI_P01_OUT_OF_CURRENT_POC_SCOPE',409);
  const rollingId=input.planId||null;
  const preview=await this.preview(rollingId);
  if(preview.stale||(!preview.agentRunId&&!(rollingId&&preview.manualSelection))||
     preview.sourceHash!==input.expectedSourceHash||
     preview.planRevision!==input.expectedRevision||
     input.expectedAgentRunId!==preview.agentRunId)
   throw new SiBulkApprovalError('SI_BULK_SNAPSHOT_CHANGED_REVIEW_AGAIN',409);
  if(!preview.vessels.length||preview.vessels.length>this.maxBatch)
   throw new SiBulkApprovalError('SI_BULK_SIZE_INVALID',422);
  if(preview.vessels.length>MAX_AI_PER_BATCH&&
    (input.generateA04||input.runP01))
   throw new SiBulkApprovalError('SI_BULK_AI_LIMIT_REVIEW_REQUIRED',422);
  if(preview.vessels.some(v=>v.missingSource||!v.primaryCandidateKey||
    v.candidateKeys.length===0||v.reasons.length===0))
    throw new SiBulkApprovalError('SI_BULK_MISSING_SOURCE_REASONS',409);
  // ALL provenance and ALL eligible candidate workflows are part of each
  // single vessel approval; no dropdown, no lossy primary-only selection.
  const items=preview.vessels.map(v=>({
    imo:v.imo,vesselName:v.vesselName,
    candidateKey:v.primaryCandidateKey,
    candidateKeys:v.candidateKeys,
    regimes:v.inspectionRegimes,
    inspectionReasons:v.reasons,
    regime:v.inspectionRegimes[0],planRank:v.rank,
    inspectionCaseId:null,state:QUEUED,dossierStatus:'PENDING',
    aiDossierStatus:input.generateA04?'PENDING':'NOT_REQUESTED',
    error:null
  }));
  const needsPaid=input.generateA04&&preview.a04Provider==='AIRIA';
  if(needsPaid&&input.confirmAiCost!==true)
   throw new SiBulkApprovalError('SI_BULK_EXPLICIT_AI_COST_CONFIRMATION_REQUIRED',422);
  if(input.generateA04&&!preview.a04Enabled)
   throw new SiBulkApprovalError('SI_BULK_A04_NOT_ENABLED',409);
  const fingerprint=hash({planId:rollingId,sourceHash:preview.sourceHash,
    revision:preview.planRevision,sources:items.map(x=>({imo:x.imo,keys:x.candidateKeys,
      eventKeys:x.inspectionReasons.map(r=>r.eventKey)}))});
  // Approval plans are unique per saved source/revision/approved selection.
  // Concurrent submissions are also guarded with a local process lock.
  const existing=this.read().jobs.find(x=>x.fingerprint===fingerprint);
  if(existing)return this.get(existing.id);
  const at=now();
  const job={id:randomUUID(),planId:rollingId,fingerprint,status:QUEUED,createdAt:at,
    updatedAt:at,finishedAt:null,approvedBy:actor,approvalReason:reason,
    approvedCount:0,totalSelected:items.length,
    sourceHash:preview.sourceHash,planRevision:preview.planRevision,
    agentRunId:preview.agentRunId,mode:'ONE_HUMAN_PLAN_APPROVAL',
    generateA04:input.generateA04,runP01:input.runP01,
    confirmedAiCost:input.confirmAiCost===true,priorityStatus:'WAITING',
    progressMessage:'BATCH_ACCEPTED_PREPARATION_PENDING',items};
  this.put(job);
  this.submitTask(()=>this.process(job.id));
  return this.get(job.id);
 }
 async process(id){
  if(this.active.has(id))return;
  this.active.add(id);
  try{
   let job=this.read().jobs.find(x=>x.id===id);
   if(!job||job.status===COMPLETED)return;
   job.status=RUNNING;job.updatedAt=now();this.put(job);
   // One supervisor approval is all-or-nothing at case creation level.
   // Dossier preparation is deliberately asynchronous and tracked per case.
   // On process recovery, only reuse cases carrying THIS batch's planId.
   if(job.items.some(x=>!x.inspectionCaseId)){
    const registry=await this.targeting.inspectionCaseRegistry();
    const prior=job.items.map(item=>registry.cases.find(c=>
      c.candidateKey===item.candidateKey));
    if(prior.some(Boolean)&&!prior.every(c=>c&&c.approvedPlanId===job.id))
      throw new SiBulkApprovalError('SI_BULK_EXISTING_CASE_CONFLICT_REVIEW',409);
    let cases;
    if(prior.every(c=>c&&c.approvedPlanId===job.id))cases=prior;
    else{
      const current=await this.plan.snapshot(job.planId||null);
      if(current.stale||current.sourceHash!==job.sourceHash||
         current.revision!==job.planRevision||current.agentRunId!==job.agentRunId)
        throw new SiBulkApprovalError('SI_BULK_SOURCE_CHANGED_BEFORE_COMMIT',409);
      const approved=await this.targeting.decideBatch({
        items:job.items.map(x=>({imo:x.imo,candidateKey:x.candidateKey,
          candidateKeys:x.candidateKeys,inspectionReasons:x.inspectionReasons,
          regimes:x.regimes})),
        actor:job.approvedBy,note:job.approvalReason,approvedPlanId:job.id
      });
      cases=approved.cases;
    }
    const byKey=new Map(cases.map(c=>[c.candidateKey,c]));
    for(const item of job.items){
      item.inspectionCaseId=byKey.get(item.candidateKey)?.id||null;
      item.state=item.inspectionCaseId?'APPROVED':'APPROVAL_FAILED';
      item.error=item.inspectionCaseId?null:'SI_BULK_COMMIT_INCOMPLETE';
    }
    job.approvedCount=job.items.filter(x=>Boolean(x.inspectionCaseId)).length;
    job.updatedAt=now();job.progressMessage='BATCH_APPROVAL_COMMITTED';
    this.put(job);
    if(job.planId&&this.plan.rolling){
     await this.plan.rolling.approve(job.planId,{
      expectedRevision:job.planRevision,batchId:job.id,actor:job.approvedBy,
      cases:job.items.map(item=>({
       imo:item.imo,caseId:item.inspectionCaseId,
       planRank:item.planRank,regimes:item.regimes,
       inspectionReasons:item.inspectionReasons}))
     });
    }
   }
   for(const item of job.items){
    if(item.state==='READY')continue;
    try{
     if(!item.inspectionCaseId)throw new SiBulkApprovalError('SI_BULK_CASE_NOT_APPROVED',409);
     // The approved plan snapshot is now linked to the distinct SI case.
     // Build deterministic vessel dossier even if A04 AI is disabled.
     const snapshot=await this.preparation.get(item.inspectionCaseId);
     let saved=snapshot.saved;
     if(!saved){
      const result=await this.preparation.prepare(item.inspectionCaseId,
       {actor:job.approvedBy,expectedVersion:0});
      saved=result.saved;
     }else if(snapshot.stale&&saved.status!=='APPROVED'){
      const result=await this.preparation.prepare(item.inspectionCaseId,
       {actor:job.approvedBy,expectedVersion:saved.version});
      saved=result.saved;
     }
     item.dossierStatus=saved.status;
     item.state='PREPARED';item.error=null;
     this.put({...job,updatedAt:now()});
     if(job.generateA04){
      if(saved.status==='PREPARED'||saved.status==='FAILED'||saved.status==='REJECTED'){
       const result=await this.preparation.generate(item.inspectionCaseId,{
        actor:job.approvedBy,expectedVersion:saved.version,
        confirmCost:job.confirmedAiCost||this.preparation.provider==='mock'});
       item.aiDossierStatus=result.saved?.status||'DRAFT_REVIEW';
      }else item.aiDossierStatus=saved.status;
     }
     item.state='READY';item.error=null;
    }catch(e){
     item.state=item.inspectionCaseId?'PREPARATION_FAILED':'APPROVAL_FAILED';
     item.error=e.code||e.message||'SI_BULK_ITEM_FAILED';
     if(!item.inspectionCaseId)item.dossierStatus='NOT_STARTED';
     else if(item.aiDossierStatus==='PENDING')item.aiDossierStatus='FAILED_OR_SKIPPED';
    }
    job.approvedCount=job.items.filter(x=>Boolean(x.inspectionCaseId)).length;
    job.updatedAt=now();this.put(job);
   }
   // Do not execute P01 from legacy queued batches; keep existing approval/cases.
   job.priorityStatus=job.runP01?'SKIPPED_OUT_OF_CURRENT_POC_SCOPE':'NOT_REQUESTED';
   job.status=job.items.every(x=>x.state==='READY')&&
     !job.priorityStatus.startsWith('FAILED')?COMPLETED:PARTIAL;
   // Plan is now in operational execution (even if a dossier needs review).
   // Case IDs and prior approved scope are frozen; this is a state-only version.
   if(job.planId&&job.approvedCount>0&&this.plan.rolling){
    try{await this.plan.rolling.setExecutionState(job.planId,'IN_EXECUTION',
      job.approvedBy);}
    catch(e){
     job.status=PARTIAL;
     job.progressMessage='SI_ROLLING_EXECUTION_STATE_REVIEW_REQUIRED';
     job.priorityStatus=job.priorityStatus+';PLAN_SYNC_'+(e.code||'FAILED');
    }
   }
   job.finishedAt=now();job.updatedAt=now();
   job.progressMessage=job.status===COMPLETED?'BATCH_COMPLETED':
      'BATCH_PARTIALLY_COMPLETED_REVIEW_ITEMS';
   this.put(job);
  }catch(e){
   // Never conceal already committed cases, and never replay paid model calls.
   const job=this.read().jobs.find(x=>x.id===id);
   if(job){job.status=PARTIAL;job.progressMessage=e.code||'SI_BULK_PROCESS_FAILED';
    job.updatedAt=now();this.put(job);}
  }finally{this.active.delete(id);}
 }
}