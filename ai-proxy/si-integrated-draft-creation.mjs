/**
 * Capacity-driven inspection draft creation.
 * Full candidate/priority/workforce planning is computed before the first
 * persistent plan write. No Airia call is made by this module; callers must
 * pass already validated C01 advice after explicit cost consent.
 * No inspector booking, case, work order or regulatory authorization is made.
 */
import {projectInspectionPlan} from './si-inspection-plan.mjs';
import {selectIntegratedPlanVessels,makeCapacityDraftPlan,
 SiIntegratedPlanError} from './si-integrated-capacity-plan.mjs';
import {maritimePlanSchedulingContext,
 validateOperatorScheduleAgainstSource} from './si-maritime-plan-source.mjs';
import {buildPocErpSchedulingOverlay,fillPocSchedulingVisitContext,
 validatePocSchedulingDemoRequest} from './si-scheduling-poc-fixtures.mjs';
import {proposeMaritimeBatchSchedule} from './si-maritime-batch-scheduling.mjs';
import {suggestCapacityExceptionActions} from './si-capacity-exception-alternatives.mjs';
import {inspectSiDraftScope,SI_DRAFT_SOLVER_MAX_VESSELS} from './si-draft-selection-preflight.mjs';

export class SiDraftCreationError extends Error{
 constructor(code,status=409){super(code);this.code=code;this.status=status;}
}
const fail=(code,status)=>{throw new SiDraftCreationError(code,status);};
const dateOK=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&
 !Number.isNaN(Date.parse(x+'T00:00:00Z'))&&
 new Date(x+'T00:00:00Z').toISOString().slice(0,10)===x;

export function validateDraftMetadata(x){
 if(!x||typeof x.title!=='string'||!x.title.trim()||x.title.trim().length>180||
  !dateOK(x.startsOn)||!dateOK(x.endsOn)||x.endsOn<x.startsOn||
  (x.notes!==undefined&&(typeof x.notes!=='string'||x.notes.length>1200))||
  typeof x.demoMode!=='boolean')
  fail('SI_DRAFT_PARAMETERS_INVALID',422);
 return {title:x.title.trim(),startsOn:x.startsOn,endsOn:x.endsOn,
  notes:(x.notes||'').trim(),demoMode:x.demoMode};
}

export function contextToRequests(context){
 return context.items.map(v=>({
  imo:v.imo,portId:v.portId,vesselType:v.vesselType,regime:v.regime,
  locationType:v.locationType,locationName:v.locationName,
  siteAccessConfirmed:v.siteAccessConfirmed,
  durationMinutes:Number(v.durationMinutes),
  earliestLocal:v.etaLocal||v.earliestLocal,
  latestFinishLocal:v.etdLocal||v.latestFinishLocal,
  windowSource:v.etdLocal?'MSW_FINAL':v.windowSource||'OFFICER_FINAL',
  windowEvidenceReference:v.etdLocal?v.dateEvidenceReference:
   v.windowEvidenceReference||v.nmcReferrals?.[0]?.id||''
 }));
}
const localDay=s=>typeof s==='string'?s.slice(0,10):'';
export function reportDraftPeriodExceptions(proposal,metadata){
 return (proposal?.variants?.[0]?.assignments||[]).filter(a=>
  localDay(a.startLocal)<metadata.startsOn||
  localDay(a.endLocal)>metadata.endsOn)
  .map(a=>a.imo);
}
/** One tested, source-bound C01 selection and a single bounded capacity solve.
 * Preserve mandatory referrals and their reasons; never truncate to 40.
 */
export function buildIntegratedDraft({
 id,metadata,source,dashboard,ai,erpSnapshot,actor,policy,
 nmcReferrals=[],existingBookings=[],scheduler,requests=null,
 clock=()=>Date.now()
}={}){
 if(!id||!source?.snapshotHash||!dashboard?.policy||!erpSnapshot?.snapshotId)
  fail('SI_DRAFT_SOURCE_CONTEXT_REQUIRED',409);
 // The saved initial DRAFT contains the source-bound C01 audit result even
 // when both optional percentage rates are zero. Reject mismatched AI output
 // instead of keeping a seemingly verified, unrelated recommendation.
 if(!ai?.agentRunId||ai.snapshotHash!==source.snapshotHash||
    (ai.selectionProposal&&
     ai.selectionProposal.snapshotHash!==source.snapshotHash))
  fail('SI_DRAFT_C01_SNAPSHOT_MISMATCH',409);
 const scope=inspectSiDraftScope(source);
 if(scope.status!=='READY')
  fail({
   SELECTION_POLICY_REPUBLICATION_REQUIRED:
    'SI_DRAFT_PUBLISH_SERVICE_AND_PLAN_CAP_BEFORE_AIRIA',
   PROTECTED_NMC_REFERRALS_EXCEED_PUBLISHED_PLAN_CAP:
    'SI_DRAFT_NMC_PROTECTED_REFERRALS_EXCEED_PUBLISHED_PLAN_CAP',
   PROTECTED_NMC_REFERRALS_EXCEED_SOLVER_MAX:
    'SI_DRAFT_NMC_PROTECTED_REFERRALS_EXCEED_SOLVER_MAX'
  }[scope.status]||'SI_DRAFT_POLICY_SCOPE_INVALID',409);
 const rates=source.selection;
 const requireAi=source.selectionPolicyActive&&
  (rates.pscRiskRatePercent>0||rates.uaeFlagRatePercent>0);
 if(requireAi&&(!ai?.selectionProposal?.aiSelectionValidated||
  ai.selectionProposal.snapshotHash!==source.snapshotHash||
  ai.selectionProposal.policyRevision!==dashboard.policy.version))
  fail('SI_C01_CONFIGURED_SELECTION_REQUIRED_RUN_AI',409);
 const plan={id,number:'NEW-DRAFT-PREVIEW',status:'DRAFT',revision:0,
  candidateSourceHash:source.snapshotHash,selectionSourceHash:source.snapshotHash};
 const rows=projectInspectionPlan(dashboard,source,ai,{},
  {});
 const selection=selectIntegratedPlanVessels({
  plan,inspectionPlan:{planId:id,revision:0,sourceHash:source.snapshotHash,
   rows,stale:false,selectionProposal:ai?.selectionProposal||null,
   agentRunId:ai?.agentRunId||null},dashboard,
  pscRiskRatePercent:rates.pscRiskRatePercent,
  uaeFlagRatePercent:rates.uaeFlagRatePercent
 });
 if(!selection.roster.length)fail('SI_DRAFT_NO_VERIFIED_SELECTED_VESSELS',409);
 if(selection.roster.length>SI_DRAFT_SOLVER_MAX_VESSELS)
  fail('SI_DRAFT_SCHEDULING_SOLVER_MAX_EXCEEDED',409);
 const workforce=metadata.demoMode?
  buildPocErpSchedulingOverlay(erpSnapshot,{operator:actor,clock}):erpSnapshot;
 const planDraft=makeCapacityDraftPlan(plan,selection);
 const originalContext=maritimePlanSchedulingContext(planDraft,dashboard,erpSnapshot);
 const context=metadata.demoMode?
  fillPocSchedulingVisitContext(originalContext,workforce,{clock}):originalContext;
 const requested=requests??contextToRequests(context);
 if(!Array.isArray(requested)||requested.length!==selection.roster.length||
  new Set(requested.map(x=>x?.imo)).size!==selection.roster.length||
  requested.some(x=>!selection.roster.some(y=>y.imo===x.imo)))
  fail('SI_DRAFT_REQUESTED_VESSELS_CHANGED',409);
 validateOperatorScheduleAgainstSource(originalContext,requested,
  {demo:metadata.demoMode,context});
 if(metadata.demoMode)validatePocSchedulingDemoRequest(context,requested);
 const proposal=proposeMaritimeBatchSchedule({
  plan:planDraft,erpSnapshot:workforce,policy,
  requests:metadata.demoMode?requested.map(x=>({...x,pocDemo:true})):requested,
  nmcReferrals,existingBookings:metadata.demoMode?[]:existingBookings,
  scheduler,clock
 });
 const exceptions=suggestCapacityExceptionActions({
  proposal,selection,erpSnapshot:workforce,policy
 });
 const mandatoryUnscheduled=selection.mandatoryImos.filter(imo=>
  proposal.rows.some(r=>r.imo===imo&&r.status==='UNSCHEDULED'));
 const outsidePeriod=reportDraftPeriodExceptions(proposal,metadata);
 const periodChecked=outsidePeriod.length===0;
 // Do not persist a READY draft if the chosen solver option violates the
 // requested plan execution window. No fabricated ETA/ETD to make it fit.
 const ready=proposal.summary.proposed>0&&
  mandatoryUnscheduled.length===0&&periodChecked&&proposal.variants.length>0;
 return {id,metadata,sourceHash:source.snapshotHash,
  policyRevision:dashboard.policy.version,riskPolicyRevision:source.riskPolicyRevision,
  erpSnapshotId:erpSnapshot.snapshotId,
  effectiveErpSnapshotId:workforce.snapshotId,ai,
  rows,selection,context,requests:requested,proposal,
  mandatoryUnscheduled,outsidePeriod,ready,
  exceptionActions:exceptions,generatedAt:new Date(clock()).toISOString(),
  candidateCount:new Set(source.candidates.map(c=>c.imo)).size};
}

export function publicDraftPreview(p,previewId){
 const assigned=new Map((p.proposal.variants[0]?.assignments||[]).map(a=>[a.imo,a]));
 const rank=new Map(p.rows.map(r=>[r.imo,r]));
 return {previewId,metadata:p.metadata,generatedAt:p.generatedAt,
  expiresInMinutes:30,sourceHash:p.sourceHash,
  selectionHash:p.selection.selectionHash,
  proposalHash:p.proposal.proposalHash,erpSnapshotId:p.erpSnapshotId,
  provider:p.ai?.provider||'NONE',aiRunId:p.ai?.agentRunId||null,
  aiVerifiedCount:p.ai?.verifiedAiRecommendations??0,
  candidateCount:p.candidateCount,
  selectedCount:p.selection.roster.length,
  feasibleCount:p.proposal.summary.proposed,
  unscheduledCount:p.proposal.summary.unscheduled,
  mandatoryUnscheduled:p.mandatoryUnscheduled,
  outsidePlanPeriod:p.outsidePeriod,
  readyForSupervisorReview:p.ready,
  quotas:p.selection.quotas,
  demoOnly:p.metadata.demoMode,
  items:p.selection.roster.map(v=>{
   const advice=rank.get(v.imo),a=assigned.get(v.imo);
   const issue=p.proposal.rows.find(r=>r.imo===v.imo);
   return {imo:v.imo,planRank:v.planRank,vesselName:advice?.vesselName||v.imo,
    priorityReason:advice?.priorityReason||null,
    priorityCriterion:advice?.rankingCriterion||'PENDING_ADDITIONAL_RULES',
    sourceTypes:advice?.sources||[],sourceReasons:v.inspectionReasons,
    mandatory:p.selection.mandatoryImos.includes(v.imo),
    status:issue?.status||'UNSCHEDULED',
    blocker:issue?.blocker||null,
    inspectorId:a?.inspectorId||null,inspectorName:a?.inspectorName||null,
    portName:a?.portName||null,startLocal:a?.startLocal||null,
    endLocal:a?.endLocal||null,
    crossPort:a?.crossPort===true};
  }),
  visitRequests:p.requests.map(x=>({...x})),
  ports:p.context.ports||[],
  visitInputs:p.context.items.map(v=>({
   imo:v.imo,portId:v.portId,portName:v.portName,portSourceLocked:v.portSourceLocked,
   locationName:v.locationName,siteAccessConfirmed:v.siteAccessConfirmed,
   durationMinutes:v.durationMinutes,
   earliestLocal:v.etaLocal||v.earliestLocal,
   latestFinishLocal:v.etdLocal||v.latestFinishLocal,
   sourceArrivalLocked:!!v.etaLocal,sourceDepartureLocked:!!v.etdLocal,
   windowSource:v.windowSource||null
  })),
  workforce:p.context.workforce||[],
  selectedOptionId:p.proposal.variants[0]?.optionId||null,
  optionCount:p.proposal.variants.length,
  exceptionActions:p.exceptionActions,
  noWrites:true,noOfficialBooking:true,noCaseCreation:true};
}
