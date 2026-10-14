/**
 * MOEI SI-01: capacity-led, source-first inspection-plan draft.
 *
 * The source roster and inspection reasons come from reviewed SI-C01 data.
 * Source/risk weights are advisory scheduling-planning factors ONLY; they
 * never remove a statutory referral, override NMC priority, or generate risk.
 * No mutation, booking, paid AI call, or final plan approval occurs here.
 */
import {createHash} from 'node:crypto';
import {maritimePlanSchedulingContext} from './si-maritime-plan-source.mjs';
import {buildPocErpSchedulingOverlay,fillPocSchedulingVisitContext}
 from './si-scheduling-poc-fixtures.mjs';
import {proposeMaritimeBatchSchedule} from './si-maritime-batch-scheduling.mjs';

export const DEFAULT_CAPACITY_WEIGHTS=Object.freeze({
 NMC_CASE:30,SERVICE_REQUEST:25,PSC_PORT_CALL:20,RISK_FACTOR:25
});
const keys=Object.keys(DEFAULT_CAPACITY_WEIGHTS);
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const fail=(code,status=409)=>{const e=new Error(code);e.code=code;e.status=status;throw e;};
export function validateCapacityWeights(value){
 if(value===undefined||value===null)return {...DEFAULT_CAPACITY_WEIGHTS};
 if(!value||Array.isArray(value)||typeof value!=='object'||
  Object.keys(value).length!==keys.length||
  Object.keys(value).some(k=>!keys.includes(k))||
  keys.some(k=>!Number.isInteger(value[k])||value[k]<0||value[k]>100)||
  keys.reduce((s,k)=>s+value[k],0)!==100)
  fail('SI_CAPACITY_SOURCE_RISK_WEIGHTS_MUST_TOTAL_100',422);
 return Object.fromEntries(keys.map(k=>[k,value[k]]));
}
export function capacityDraftFromSelection(plan,selected){
 if(!plan||!['DRAFT','READY_FOR_APPROVAL'].includes(plan.status)||
  !selected||selected.stale||selected.planId!==plan.id||
  selected.planRevision!==plan.revision||
  !Array.isArray(selected.vessels)||!selected.vessels.length)
  fail('SI_CAPACITY_DRAFT_SELECTION_NOT_READY',409);
 if(selected.vessels.length>40)
  fail('SI_CAPACITY_PLAN_MAX_40_VESSELS_PER_SOLVER_RUN',422);
 const vessels=selected.vessels.map(v=>({
  imo:v.imo,planRank:v.rank,caseId:null,
  regimes:v.inspectionRegimes,inspectionReasons:v.reasons
 }));
 if(vessels.some(v=>!/^\d{7}$/.test(v.imo||'')||
  !Number.isInteger(v.planRank)||v.planRank<1||
  !Array.isArray(v.regimes)||!v.regimes.length||
  !Array.isArray(v.inspectionReasons)||!v.inspectionReasons.length||
  v.inspectionReasons.some(r=>!r?.eventKey))||
  new Set(vessels.map(v=>v.imo)).size!==vessels.length||
  new Set(vessels.map(v=>v.planRank)).size!==vessels.length)
  fail('SI_CAPACITY_DRAFT_SOURCE_ROSTER_INVALID',409);
 return {...plan,status:'APPROVED',approvedVessels:vessels};
}
export function capacityRequests(context){
 return context.items.map(x=>({
  imo:x.imo,portId:x.portId,vesselType:x.vesselType,regime:x.regime,
  locationType:x.locationType,locationName:x.locationName,
  siteAccessConfirmed:x.siteAccessConfirmed,
  durationMinutes:Number(x.durationMinutes),
  earliestLocal:x.etaLocal||x.earliestLocal,
  latestFinishLocal:x.etdLocal||x.latestFinishLocal,
  windowSource:x.etdLocal?'MSW_FINAL':x.windowSource||'',
  windowEvidenceReference:x.etdLocal?x.dateEvidenceReference:
   x.windowEvidenceReference||x.nmcReferrals?.[0]?.id||''
 }));
}
export function scoreCapacityCandidate(vessel,weights,currentRisk){
 const sources=[...new Set((vessel.reasons||[]).map(r=>r.sourceType))];
 const hasRisk=Number.isFinite(currentRisk?.score)&&currentRisk.score>=0&&
  currentRisk.score<=100;
 const sourcePoints=sources.reduce((n,k)=>n+(weights[k]||0),0);
 const riskPoints=hasRisk?Math.round(weights.RISK_FACTOR*currentRisk.score/100):null;
 return {
  imo:vessel.imo,rank:vessel.rank,
  score:sourcePoints+(riskPoints||0),sourcePoints,riskPoints,
  riskStatus:hasRisk?'SOURCE_ASSESSED':'NOT_ASSESSED',
  sourceTypes:sources,
  statutoryPriorityProtected:sources.includes('NMC_CASE'),
  advisorOnly:true
 };
}
export function previewCapacityPlan({plan,selection,dashboard,erpSnapshot,policy,
 scheduler,nmcReferrals=[],existingBookings=[],weights,clock=()=>Date.now(),
 demoMode=false}={}){
 const controlledWeights=validateCapacityWeights(weights);
 const draft=capacityDraftFromSelection(plan,selection);
 const snapshot=demoMode?
  buildPocErpSchedulingOverlay(erpSnapshot,{clock}):erpSnapshot;
 const original=maritimePlanSchedulingContext(draft,dashboard,erpSnapshot);
 const context=demoMode?
  fillPocSchedulingVisitContext(original,snapshot,{clock}):original;
 const requests=capacityRequests(context);
 const projection=proposeMaritimeBatchSchedule({
  plan:draft,erpSnapshot:snapshot,policy,requests:demoMode?
   requests.map(r=>({...r,pocDemo:true})):requests,
  nmcReferrals,existingBookings,scheduler,clock
 });
 const scored=selection.vessels.map(v=>{
  const source=dashboard.vesselCandidates.find(x=>x.imo===v.imo);
  return scoreCapacityCandidate(v,controlledWeights,source?.currentRisk);
 }).sort((a,b)=>Number(b.statutoryPriorityProtected)-
  Number(a.statutoryPriorityProtected)||b.score-a.score||
  a.rank-b.rank||a.imo.localeCompare(b.imo));
 const fingerprint=hash({
  id:plan.id,revision:plan.revision,sourceHash:selection.sourceHash,
  proposalHash:projection.proposalHash,weights:controlledWeights,
  mode:demoMode?'POC_MOCK':'ERP_EXCEL_POC'
 });
 return {status:'CAPACITY_ASSESSED_NOT_APPROVED',planId:plan.id,
  planRevision:plan.revision,sourceHash:selection.sourceHash,
  capacityHash:fingerprint,weights:controlledWeights,
  priorityAdvisory:scored,
  proposal:projection,
  approvedVesselCount:0,
  proposedVesselCount:projection.summary.proposed,
  unmetCapacityCount:projection.summary.unscheduled,
  readyForApproval:projection.summary.unscheduled===0&&
   projection.summary.proposed===selection.vessels.length&&
   projection.variants.some(v=>v.assignments.length===selection.vessels.length),
  mode:demoMode?'POC_MOCK':'ERP_EXCEL_POC',
  sourceFactsAreSynthetic:demoMode,
  planUnchanged:true,caseWrites:0,bookingWrites:0,
  warnings:[
   'SOURCE_WEIGHT_ADVISORY_ONLY_NMC_PRIORITY_PROTECTED',
   'UNKNOWN_RISK_IS_NOT_ASSUMED_ZERO_RISK',
   'C01_SELECTION_REMAINS_HUMAN_REVIEWED',
   'NO_AUTOMATIC_CANCELLATION_OF_MANDATORY_INSPECTIONS',
   'OUT_OF_HOURS_REQUIRES_SEPARATE_HR_AUTHORIZATION',
   ...(demoMode?['POC_DEMO_SYNTHETIC_WORKFORCE_NOT_REAL_CAPACITY']:[])
  ]};
}
