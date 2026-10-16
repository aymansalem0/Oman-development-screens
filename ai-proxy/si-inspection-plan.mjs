/**
 * SI POC inspection PLAN, not an inspection authorisation.
 * Single unified grid: saved C01 recommendations + auditable officer amendments.
 * One explicit POST re-runs the current C01 adapter, applies legally protected
 * ordering and atomically stores the new POC plan snapshot.
 *
 * POC storage: existing /data Docker volume (JSON), independently of the
 * Oracle-backed REGULATORY inspection case registry. It must be migrated to
 * an Oracle audit table before production/multi-instance deployment.
 */
import {readFileSync,writeFileSync,existsSync,mkdirSync,renameSync} from 'node:fs';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {SiCandidateAgentError,summarizeC01Readiness} from './si-candidate-agent.mjs';
import {compareInspections,inspectionRanking} from './si-inspection-ranking.mjs';
import {checkVesselPlanPeriod} from './si-plan-period-eligibility.mjs';

const iso=()=>new Date().toISOString();
const empty=()=>({revision:0,overrides:{},latest:null,audit:[]});
const priorityTier=x=>x.sourceTypes?.includes('NMC_CASE')&&
  x.sourceEvents?.some(e=>e.sourceType==='NMC_CASE'&&e.approval==='APPROVED')?0:1;
function safeRecord(data){
 if(!data||!Number.isInteger(data.revision)||data.revision<0||
   !data.overrides||typeof data.overrides!=='object'||Array.isArray(data.overrides)||
   !Array.isArray(data.audit))throw new SiCandidateAgentError('SI_PLAN_STORE_CORRUPT',503);
 return data;
}
function atomicSave(file,data){
 mkdirSync(dirname(file),{recursive:true});
 const tmp=file+'.'+randomUUID()+'.tmp';
 writeFileSync(tmp,JSON.stringify(data,null,2),{mode:0o600});
 renameSync(tmp,file);
}
/** Build IMO-level rows; C01 advice is per inspection regime, not regulatory approval. */
export function projectInspectionPlan(dashboard,source,run,overrides={},carryForward={}){
 const recMap=new Map((run?.recommendations||[]).map(r=>[r.candidateKey,r]));
 // An optional source-backed vessel must be in the VERIFIED C01 selection
 // proposal after configured quota validation, not just have model praise.
 const c01Selection=run?.selectionProposal?.aiSelectionValidated===true&&
   run.selectionProposal.snapshotHash===source.snapshotHash?
   new Set(run.selectionProposal.selectedImos):null;
 const basisByImo=new Map((run?.selectionProposal?.selectedRows||[])
   .map(x=>[x.imo,x]));
 const grouped=new Map();
 const all=dashboard.vesselCandidates||[];
 const availableKeys=new Set(source.candidates.map(c=>c.candidateKey));
 for(const v of all){
  const c=source.candidates.filter(x=>x.imo===v.imo&&availableKeys.has(x.candidateKey));
  const advice=c.map(x=>recMap.get(x.candidateKey)).filter(Boolean);
  const aiSelected=advice.some(x=>x.recommendation==='SELECT_RECOMMENDED');
  // A valid, pending maritime service request must not be excluded by a low
  // saved NMC risk score or by an untrusted/optional AI recommendation.
  const requiredInPlan=c.some(x=>x.requiredInPlan===true);
  const rankSignal=inspectionRanking(v);
  const note=overrides[v.imo]||null;
  const prior=carryForward[v.imo]||null;
  const waitingOnDeferred=prior?.disposition==='DEFER'&&prior.reviewAfter&&
   prior.reviewAfter>new Date().toISOString().slice(0,10);
  const eligible=c.length>0;
  // Human inclusion is permitted *before* a provider C01 response exists.
  // The model is advisory, not an authorization gate.
  const planSelected=eligible?
   (typeof note?.selected==='boolean'?note.selected:
    run!==null?(requiredInPlan||
     (c01Selection?c01Selection.has(v.imo):aiSelected))&&
     !waitingOnDeferred:false):false;
  const locked=!eligible;
  grouped.set(v.imo,{
   imo:v.imo,vesselName:v.vesselName,flag:v.flag,vesselType:v.vesselType,
   sources:v.sourceTypes,regimes:v.regimes,sourceEvents:v.sourceEvents,
   risk:v.currentRisk||null,requiredInPlan,
   departureAt:rankSignal.departureAt,
   departureVerified:rankSignal.criterion==='DEPARTURE_SOON',
   incidentSeverity:rankSignal.incidentSeverity,
   incidentHumanReviewed:rankSignal.criterion==='INCIDENT_SEVERITY',
   incidentEvidenceRef:v.incidentEvidenceRef||null,
   rankingCriterion:rankSignal.criterion,rankingGroup:rankSignal.group,
   pendingWorkflows:v.pendingWorkflows,
   approvedCases:v.createdWorkflows,externalScheduled:v.scheduledWorkflows,
   aiRecommended:run?aiSelected:null,
   aiQuotaSelected:c01Selection?c01Selection.has(v.imo):null,
   aiSelectionBasis:basisByImo.get(v.imo)?.selectionBasis||[],
   planSelected:run||typeof note?.selected==='boolean'?planSelected:null,
   selectionOrigin:note?'OFFICER_AMENDED':run&&requiredInPlan?'PUBLISHED_SOURCE_RULE':
    run&&c01Selection?'AI_SELECTION_WITHIN_PUBLISHED_QUOTAS':
    run?'AI_ADVISORY':'NOT_EVALUATED',
   disposition:note?.disposition||'AVAILABLE',
   reviewAfter:note?.reviewAfter||prior?.reviewAfter||null,
   previousDisposition:prior?.disposition||null,
   previousPlan:prior?.fromPlan||null,
   reviewDue:Boolean(prior?.disposition==='DEFER'&&prior.reviewAfter&&
     prior.reviewAfter<=new Date().toISOString().slice(0,10)),
   officerReason:note?.reason||null,officerActor:note?.actor||null,
   requestedRank:note?.requestedRank??null,
   modelRank:advice.length?Math.min(...advice.filter(x=>Number.isInteger(x.suggestedRank))
     .map(x=>x.suggestedRank).concat([999999])):null,
   effectiveRank:null,priorityReason:null,
   selectionReason:advice.find(x=>x.recommendation==='SELECT_RECOMMENDED')?.reason||
     advice[0]?.reason||null,
   evidenceRefs:[...new Set(advice.flatMap(x=>x.evidenceRefs||[]))],
   dataGaps:[...new Set(advice.flatMap(x=>x.dataGaps||[]))],
   confidence:advice.length?Math.max(...advice.map(x=>x.confidence)):null,
   editable:eligible,locked,regimeAdvisories:advice,
   mandatoryReferral:priorityTier(v)===0
  });
 }
 if(run||[...grouped.values()].some(x=>x.planSelected)){
  const ranked=[...grouped.values()].filter(v=>v.planSelected);
  // Selection is a separate decision. Order follows the first TWO confirmed
  // business criteria: earliest verified future ETD; then officer-reviewed
  // incident-specific severity (desc). Remaining criteria are NOT yet defined.
  const groups=[0,1,2].map(n=>ranked.filter(x=>x.rankingGroup===n)
    .sort(compareInspections));
  const reposition=(rows,start)=>{
    // Audited manual rank requests may reorder WITHIN a defined group only;
    // they may never move an unverified vessel above a verified ETD/incident.
    for(const row of rows.filter(x=>x.requestedRank!==null)
      .sort((a,b)=>a.requestedRank-b.requestedRank||a.imo.localeCompare(b.imo))){
      rows.splice(rows.indexOf(row),1);
      const pos=Math.max(0,Math.min(rows.length,row.requestedRank-1-start));
      rows.splice(pos,0,row);
    }
  };
  let offset=0;
  for(const group of groups){reposition(group,offset);offset+=group.length;}
  ranked.splice(0,ranked.length,...groups.flat());
  for(let i=0;i<ranked.length;i++){
   const row=ranked[i];
   row.effectiveRank=i+1;
   const sourceAdvice=row.regimeAdvisories.find(x=>x.recommendation==='SELECT_RECOMMENDED');
   const signal=inspectionRanking(row);
   const modelExplanation=signal.reason+'. '+(sourceAdvice?.priorityRationale||
     'No AI reasoning available; officer must review.');
   row.priorityReason=row.requestedRank!==null?
     'Officer requested position '+row.requestedRank+' (within '+signal.criterion+
       ') with auditable reason. '+modelExplanation:
     modelExplanation;
  }
 }
 return [...grouped.values()].sort((a,b)=>
   Number(Boolean(b.planSelected))-Number(Boolean(a.planSelected))||
   (a.effectiveRank??999999)-(b.effectiveRank??999999)||
   compareInspections(a,b));
}
export class SiInspectionPlan{
 constructor({targeting,candidateAgent,rollingPlans=null,
    file=process.env.SI_INSPECTION_PLAN_PATH||'/data/si-inspection-plan.json'}={}){
  if(!targeting||!candidateAgent)throw Error('SI_PLAN_CONFIGURATION_INVALID');
  this.targeting=targeting;this.agent=candidateAgent;this.file=file;this.busy=false;
  this.rolling=rollingPlans;
 }
 read(){return existsSync(this.file)?safeRecord(JSON.parse(readFileSync(this.file,'utf8'))):empty();}
 async snapshot(planId=null){
  const cycle=planId?await this.rolling?.get(planId):null;
  if(planId&&!cycle)throw new SiCandidateAgentError('SI_ROLLING_PLAN_NOT_FOUND',404);
  const [source,dashboard]=await Promise.all([this.agent.source(),this.targeting.dashboard()]);
  const state=cycle||this.read();
  // Historical approval records are snapshots, NOT live C01 proposals:
  // opening last month's plan must not erase its vessel selection just
  // because the current PSC queue/NMC risk has changed overnight.
  const historical=Boolean(cycle&&
    ['APPROVED','IN_EXECUTION','COMPLETED','CANCELLED'].includes(cycle.status));
  const changed=Boolean(state.latest&&state.latest.snapshotHash!==source.snapshotHash);
  const current=historical?state.latest:
    changed?null:state.latest;
  const rows=historical&&Array.isArray(state.approvedRows)?
    structuredClone(state.approvedRows):
    historical&&Array.isArray(state.latest?.rows)?
    structuredClone(state.latest.rows):
    projectInspectionPlan(dashboard,source,current,state.overrides,
      state.carryForward||{});
  // The saved, source-bound initial Draft MUST show the final
  // capacity-feasible roster, not all C01 recommendations as 'in plan'.
  // Source/advisory recommendation remains visible separately. If officer
  // edits invalidate the draft capacity snapshot, do NOT claim a valid
  // inspector assignment until capacity is recalculated.
  const cap=cycle?.capacityDraft;
  if(!historical&&cap&&!String(cap.status||'').startsWith('STALE_')&&
     Array.isArray(cap.selectedImos)){
    const included=new Set(cap.selectedImos),excluded=new Map(
      (cap.capacityExcluded||[]).map(x=>[x.imo,x]));
    for(const row of rows){
      row.planSelected=included.has(row.imo);
      if(excluded.has(row.imo)){
        row.capacityDisposition='OUTSIDE_CURRENT_DRAFT_CAPACITY';
        row.capacityBlocker=excluded.get(row.imo).reasonCode;
        row.selectionOrigin='C01_SELECTED_BUT_OUTSIDE_DRAFT_CAPACITY';
        row.effectiveRank=null;
      }else if(included.has(row.imo)){
        row.capacityDisposition='IN_CURRENT_DRAFT';
      }
    }
  }
  const manualSelection=rows.some(r=>r.planSelected)&&
    Object.values(state.overrides||{}).some(x=>x?.selected===true);
  const availableCount=rows.filter(r=>r.editable).length;
  const deferredCount=rows.filter(r=>r.disposition==='DEFER').length;
  const notSelectedCount=rows.filter(r=>r.editable&&!r.planSelected).length;
  return {status:'ok',planId:cycle?.id||null,
   planNumber:cycle?.number||null,planStatus:cycle?.status||null,
   planPeriod:cycle?{startsOn:cycle.startsOn,endsOn:cycle.endsOn}:null,
   provider:this.agent.provider.toUpperCase(),
   mock:this.agent.provider==='mock',sourceHash:source.snapshotHash,
   revision:state.revision,generatedAt:current?.generatedAt||null,
   agentRunId:current?.agentRunId||null,
   selectionMode:current?.agentRunId?'AI_ASSISTED':'MANUAL',
   selectionProposal:current?.selectionProposal||null,
   capacityDraft:cycle?.capacityDraft||null,
   manualSelection,availableCount,deferredCount,notSelectedCount,
   dataReadiness:historical?null:summarizeC01Readiness(source),
   candidatesAtCreation:cycle?.candidateSnapshot?.length??null,
   stale:!historical&&(changed||
     Boolean(cycle?.selectionSourceHash&&cycle.selectionSourceHash!==source.snapshotHash)),
   historicalSourceChanged:historical&&changed,readOnlyHistorical:historical,
   externalCallsOnRead:0,aiRecommendedVessels:current?
    rows.filter(r=>r.aiRecommended).length:null,
   selectedForPlan:cycle||current?rows.filter(r=>r.planSelected).length:null,
   approvedCases:dashboard.summary.inspectionsCreated,
   warning:historical?
    'HISTORICAL APPROVED/CANCELLED PLAN: showing saved selection; new live source does not rewrite history.':
    'ADVISORY INSPECTION PLAN ONLY: not regulatory approval, PSC quota selection or scheduling.',
   // A source-backed precheck: only confirmed impossible windows block manual
   // Include. Missing ETA/ETD stays pending capacity verification, not guessed.
   rows:cycle&&!historical?rows.map(row=>({
    ...row,periodEligibility:checkVesselPlanPeriod(
     dashboard.vesselCandidates?.find(v=>v.imo===row.imo)||row,
     {startsOn:cycle.startsOn,endsOn:cycle.endsOn})
   })):rows};
 }
 /**
  * Official-free planning amendment. This is a DRAFT-level selection, not an
  * inspection case, AI call or statutory defer/rejection decision.
  * Unselected source events remain in the central candidate pool.
  */
 async select({planId,imo,action,reason,reviewAfter=null,expectedRevision,
               expectedSourceHash,actor}={}){
  if(!planId||!/^\d{7}$/.test(imo||'')||
    !['INCLUDE','NOT_SELECTED','DEFER','NOT_APPLICABLE'].includes(action)||
    !Number.isInteger(expectedRevision)||typeof actor!=='string'||
    !actor.trim()||actor.length>120||typeof reason!=='string'||
    reason.trim().length<8||reason.length>500)
   throw new SiCandidateAgentError('SI_PLAN_SELECTION_INVALID',422);
  if(action==='DEFER'&&
    (typeof reviewAfter!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(reviewAfter)||
     Number.isNaN(Date.parse(reviewAfter+'T00:00:00Z'))))
   throw new SiCandidateAgentError('SI_PLAN_REVIEW_DATE_REQUIRED',422);
  const state=await this.rolling.get(planId);
  if(!['DRAFT','READY_FOR_APPROVAL'].includes(state.status))
   throw new SiCandidateAgentError('SI_ROLLING_APPROVED_PLAN_IMMUTABLE',409);
   // An integrated Draft's C01/inspector-capacity roster is frozen at save.
   // The legacy C01 editor cannot invalidate it behind the supervisor.
   if(state.capacityDraft)
    throw new SiCandidateAgentError('SI_INTEGRATED_DRAFT_SELECTION_LOCKED_START_NEW_PLAN',409);
  const [source,dashboard]=await Promise.all([this.agent.source(),this.targeting.dashboard()]);
  if(source.snapshotHash!==expectedSourceHash||state.revision!==expectedRevision)
   throw new SiCandidateAgentError('SI_PLAN_CHANGED_REFRESH_REQUIRED',409);
  const eligible=source.candidates.filter(c=>c.imo===imo);
  const vessel=dashboard.vesselCandidates?.find(v=>v.imo===imo);
  if(!eligible.length||!vessel)
   throw new SiCandidateAgentError('SI_PLAN_CANDIDATE_NOT_PENDING',409);
  if(action==='INCLUDE'){
   const period=checkVesselPlanPeriod(vessel,{
    startsOn:state.startsOn,endsOn:state.endsOn});
   if(period.status==='OUTSIDE_EXECUTION_PLAN'){
    const err=new SiCandidateAgentError('SI_VESSEL_OUTSIDE_EXECUTION_PLAN',409);
    err.periodEligibility=period;
    throw err;
   }
  }
  // Binding NMC referrals cannot be made Not Applicable by a planning UI.
  if(action==='NOT_APPLICABLE'&&
     eligible.some(c=>c.sourceTypes.includes('NMC_CASE')))
   throw new SiCandidateAgentError('SI_MANDATORY_REFERRAL_PROTECTED',409);
  const change={imo,selected:action==='INCLUDE',
   disposition:action,reviewAfter:action==='DEFER'?reviewAfter:null,
   requestedRank:null,reason:reason.trim(),actor:actor.trim(),at:iso()};
  const next=await this.rolling.mutate(planId,expectedRevision,actor.trim(),p=>{
    p.overrides={...(p.overrides||{}),[imo]:change};
    p.selectionSourceHash=source.snapshotHash;
    p.latest?.rows&&(p.latest.rows=projectInspectionPlan(
      dashboard,source,p.latest,p.overrides,p.carryForward||{}));
    const rows=projectInspectionPlan(dashboard,source,p.latest,p.overrides,
      p.carryForward||{});
    p.savedPlanRows=rows;
    p.status=rows.some(r=>r.planSelected)?'READY_FOR_APPROVAL':'DRAFT';
    return p;
  },'OFFICER_'+action);
  return {status:'SAVED',planId,revision:next.revision,
    included:next.savedPlanRows.filter(x=>x.planSelected).length,
    disposition:action,externalCalls:0};
 }
 /**
  * Bulk, all-or-nothing officer dispositions for an editable draft.
  * A single Oracle revision + plan audit event contains every individual IMO,
  * reason and review date. No AI call, case write or regulatory rejection.
  */
 async selectBulk({planId,imos,action,reason,reviewAfter=null,
                   expectedRevision,expectedSourceHash,actor}={}){
  const ids=Array.isArray(imos)?imos:null;
  if(!planId||!ids||ids.length<1||ids.length>200||
     ids.some(imo=>typeof imo!=='string'||!/^\d{7}$/.test(imo))||
     new Set(ids).size!==ids.length||
     !['NOT_SELECTED','DEFER'].includes(action)||
     !Number.isInteger(expectedRevision)||!actor||typeof actor!=='string'||
     !actor.trim()||actor.length>120||
     typeof reason!=='string'||reason.trim().length<8||reason.length>500)
   throw new SiCandidateAgentError('SI_PLAN_BULK_SELECTION_INVALID',422);
  if(action==='DEFER'&&
     (typeof reviewAfter!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(reviewAfter)||
      Number.isNaN(Date.parse(reviewAfter+'T00:00:00Z'))||
      new Date(reviewAfter+'T00:00:00Z').toISOString().slice(0,10)!==reviewAfter))
   throw new SiCandidateAgentError('SI_PLAN_REVIEW_DATE_REQUIRED',422);
  const state=await this.rolling.get(planId);
  if(!['DRAFT','READY_FOR_APPROVAL'].includes(state.status))
   throw new SiCandidateAgentError('SI_ROLLING_APPROVED_PLAN_IMMUTABLE',409);
   // An integrated Draft's C01/inspector-capacity roster is frozen at save.
   // The legacy C01 editor cannot invalidate it behind the supervisor.
   if(state.capacityDraft)
    throw new SiCandidateAgentError('SI_INTEGRATED_DRAFT_SELECTION_LOCKED_START_NEW_PLAN',409);
  const [source,dashboard]=await Promise.all([
   this.agent.source(),this.targeting.dashboard()
  ]);
  if(source.snapshotHash!==expectedSourceHash||
     state.revision!==expectedRevision)
   throw new SiCandidateAgentError('SI_PLAN_CHANGED_REFRESH_REQUIRED',409);
  const eligible=new Set(source.candidates.map(c=>c.imo));
  const available=new Set((dashboard.vesselCandidates||[])
   .filter(v=>v.pendingWorkflows>0).map(v=>v.imo));
  // Validate the entire selection before any mutation. No partial outcome.
  if(ids.some(imo=>!eligible.has(imo)||!available.has(imo)))
   throw new SiCandidateAgentError('SI_PLAN_BULK_CANDIDATE_NOT_PENDING',409);
  const timestamp=iso(),operator=actor.trim(),why=reason.trim();
  const ordered=[...ids].sort();
  const next=await this.rolling.mutate(planId,expectedRevision,operator,p=>{
   p.overrides={...(p.overrides||{})};
   for(const imo of ordered)p.overrides[imo]={
    imo,selected:false,disposition:action,
    reviewAfter:action==='DEFER'?reviewAfter:null,
    requestedRank:null,reason:why,actor:operator,at:timestamp,
    batchAction:'OFFICER_BULK_'+action
   };
   p.selectionSourceHash=source.snapshotHash;
   p.latest?.rows&&(p.latest.rows=projectInspectionPlan(
    dashboard,source,p.latest,p.overrides,p.carryForward||{}));
   const rows=projectInspectionPlan(dashboard,source,p.latest,p.overrides,
    p.carryForward||{});
   p.savedPlanRows=rows;
   p.status=rows.some(r=>r.planSelected)?'READY_FOR_APPROVAL':'DRAFT';
   p.audit=[...(p.audit||[]),{
    event:'BULK_DISPOSITION_DETAILS',at:timestamp,actor:operator,
    action,imos:ordered,reason:why,
    reviewAfter:action==='DEFER'?reviewAfter:null
   }].slice(-300);
   return p;
  },'OFFICER_BULK_'+action);
  return {status:'SAVED',planId,revision:next.revision,
   affectedCount:ordered.length,imos:ordered,disposition:action,
   included:next.savedPlanRows.filter(x=>x.planSelected).length,
   externalCalls:0,inspectionCasesChanged:0};
 }
 async rerank(input={}){
  if(this.busy)throw new SiCandidateAgentError('SI_PLAN_RECALCULATION_IN_PROGRESS',409);
  const actor=input?.actor?.trim?.();
  if(!actor||actor.length>120||input.confirmRun!==true||
     (this.agent.provider==='airia'&&input.confirmCost!==true))
   throw new SiCandidateAgentError('SI_PLAN_CONFIRMATION_REQUIRED',422);
  this.busy=true;
  try{
   const cycleId=input.planId||null;
   const state=cycleId?await this.rolling?.get(cycleId):this.read();
   if(!state)throw new SiCandidateAgentError('SI_ROLLING_PLAN_NOT_FOUND',404);
   if(cycleId&&!['DRAFT','READY_FOR_APPROVAL'].includes(state.status))
    throw new SiCandidateAgentError('SI_ROLLING_APPROVED_PLAN_IMMUTABLE',409);
   // An integrated Draft's C01/inspector-capacity roster is frozen at save.
   // The legacy C01 editor cannot invalidate it behind the supervisor.
   if(state.capacityDraft)
    throw new SiCandidateAgentError('SI_INTEGRATED_DRAFT_SELECTION_LOCKED_START_NEW_PLAN',409);
   const source=await this.agent.source();
   if(input.expectedSourceHash!==source.snapshotHash||
      input.expectedRevision!==state.revision)
    throw new SiCandidateAgentError('SI_PLAN_CHANGED_REFRESH_REQUIRED',409);
   let changes={...state.overrides},change=null;
   if(input.change!==undefined&&input.change!==null){
    const x=input.change;
    const reason=x.reason?.trim?.();
    if(!/^\d{7}$/.test(x.imo||'')||typeof x.selected!=='boolean'||
       !reason||reason.length<8||reason.length>500||
       (x.requestedRank!==null&&x.requestedRank!==undefined&&
         (!Number.isInteger(x.requestedRank)||x.requestedRank<1||x.requestedRank>100)))
     throw new SiCandidateAgentError('SI_PLAN_CHANGE_INVALID',422);
    if(!source.candidates.some(c=>c.imo===x.imo))
     throw new SiCandidateAgentError('SI_PLAN_CANDIDATE_NOT_PENDING',409);
    if(x.selected&&cycleId){
     const dashboard=await this.targeting.dashboard();
     const vessel=dashboard.vesselCandidates?.find(v=>v.imo===x.imo);
     if(!vessel)throw new SiCandidateAgentError('SI_PLAN_CANDIDATE_NOT_PENDING',409);
     const period=checkVesselPlanPeriod(vessel,{
      startsOn:state.startsOn,endsOn:state.endsOn});
     if(period.status==='OUTSIDE_EXECUTION_PLAN')
      throw new SiCandidateAgentError('SI_VESSEL_OUTSIDE_EXECUTION_PLAN',409);
    }
    change={imo:x.imo,selected:x.selected,requestedRank:x.selected?
      (x.requestedRank??null):null,reason,actor,at:iso()};
    changes[x.imo]=change;
   }
   // A single explicit mock/real C01 run. No provider calls from GET or page load.
   // If Airia/validation fails, NOT EVEN the officer change is committed.
   const ai=await this.agent.run({actor,confirmRun:true,confirmCost:input.confirmCost===true,
     confirmBatchCount:input.confirmBatchCount,
     expectedSnapshotHash:source.snapshotHash,
     // The C01 provider sees each human amendment before generating new advice.
     officerPlanChanges:Object.values(changes).map(x=>({
       imo:x.imo,selected:x.selected,requestedRank:x.requestedRank,
       reason:x.reason,actor:x.actor,at:x.at
     }))});
   const current=await this.agent.source();
   if(current.snapshotHash!==source.snapshotHash||
      (cycleId?(await this.rolling.get(cycleId)).revision:this.read().revision)!==state.revision)
    throw new SiCandidateAgentError('SI_PLAN_SOURCE_CHANGED_RETRY',409);
   const dashboard=await this.targeting.dashboard();
   const rows=projectInspectionPlan(dashboard,source,ai,changes,
     state.carryForward||{});
   const next={revision:state.revision+1,overrides:changes,
    latest:{...ai,rows,generatedAt:iso()},
    audit:[...state.audit,{id:randomUUID(),at:iso(),actor,
      action:change?'OFFICER_CHANGE_AND_C01_REEVALUATION':'C01_INITIAL_EVALUATION',
      sourceHash:source.snapshotHash,runId:ai.agentRunId,change}].slice(-200)};
   if(cycleId){
    await this.rolling.saveDraft(cycleId,state.revision,actor,p=>{
     p.overrides=next.overrides;p.latest=next.latest;
     p.savedPlanRows=rows;p.selectionSourceHash=source.snapshotHash;
     p.status=rows.some(r=>r.planSelected)?'READY_FOR_APPROVAL':'DRAFT';
     return p;
    });
   }else atomicSave(this.file,next);
   return {status:'RECALCULATED',planId:cycleId,provider:ai.provider,mock:ai.mock,
    agentRunId:ai.agentRunId,externalCalls:ai.externalCalls,
    verifiedAiRecommendations:ai.verifiedAiRecommendations,
    manualReviewDueToAiContract:ai.manualReviewDueToAiContract,
    ignoredUnknownRecommendations:ai.ignoredUnknownRecommendations,
    verificationFailures:ai.verificationFailures,
    revision:next.revision,sourceHash:source.snapshotHash,
    aiRecommendedVessels:rows.filter(r=>r.aiRecommended).length,
    selectedForPlan:rows.filter(r=>r.planSelected).length,
    selectionProposal:ai.selectionProposal,
    humanApprovalStillRequired:true,rows};
  }finally{this.busy=false;}
 }
}
