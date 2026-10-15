/**
 * Capacity-first Smart Inspection plan (draft read model only).
 * All sources remain authoritative in the existing candidate dashboard.
 * This module does not change source decisions, regulatory risk or workflow.
 */
import {createHash} from 'node:crypto';
import {compareInspections} from './si-inspection-ranking.mjs';

export class SiIntegratedPlanError extends Error{
 constructor(code,status=409){super(code);this.code=code;this.status=status;}
}
const fail=(code,status=409)=>{throw new SiIntegratedPlanError(code,status);};
const sha=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const goodFlag=v=>['UAE','AE','ARE','UNITED ARAB EMIRATES',
 'الإمارات','الإمارات العربية المتحدة'].includes(String(v||'')
 .trim().toUpperCase().replace(/[\s._-]+/g,' '));
const validRate=value=>Number.isInteger(value)&&value>=0&&value<=100;
const eligible=c=>c?.status==='PENDING_REVIEW'||(
 c?.status==='EXTERNALLY_SCHEDULED'&&
 c.events?.some(e=>e.sourceType==='NMC_CASE'&&e.approval==='APPROVED'));
const mandatory=row=>row.mandatoryReferral===true||row.requiredInPlan===true;
const sourceVerified=e=>e.sourceType==='NMC_CASE'?
  e.approval==='APPROVED':['SOURCE_FINAL','SOURCE_REVIEWED'].includes(e.approval);
const isManualInclude=row=>row.selectionOrigin==='OFFICER_AMENDED'&&
 row.planSelected===true&&row.disposition==='INCLUDE';
function sourceEvidence(imo,dashboard){
 const workflows=(dashboard.candidates||[]).filter(c=>
   c.imo===imo&&eligible(c)&&c.events?.some(sourceVerified))
  .sort((a,b)=>Number(b.events.some(e=>e.sourceType==='NMC_CASE'))-
   Number(a.events.some(e=>e.sourceType==='NMC_CASE'))||
   a.regime.localeCompare(b.regime));
 const triggers=new Map();
 for(const workflow of workflows)for(const event of workflow.events||[]){
  if(!sourceVerified(event))continue; // UNVERIFIED is review-only evidence.
  const eventKey=event.eventKey||[event.sourceType,event.sourceEventId,
   workflow.regime].join(':');
  if(!triggers.has(eventKey))triggers.set(eventKey,{
   eventKey,candidateKey:workflow.key,
   sourceType:event.sourceType,sourceEventId:event.sourceEventId,
   sourceReference:event.sourceReference,
   inspectionRegime:workflow.regime,sourceApproval:event.approval,
   reason:event.contextNote||null,
   evidenceIds:[...new Set(event.evidenceIds||[])],
   sourceProvenance:event.provenance||null
  });
 }
 if(!workflows.length||!triggers.size)
  fail('SI_INTEGRATED_CANDIDATE_SOURCE_EVIDENCE_REQUIRED',409);
 return {regimes:[...new Set(workflows.map(x=>x.regime))],
  inspectionReasons:[...triggers.values()]};
}
/**
 * Four client-facing values are never weight-normalized: two independent
 * sampling percentages, the source plan hash and revision.
 * Selection is a new DRAFT proposal, never a new regulatory decision.
 */
export function selectIntegratedPlanVessels({
 plan,inspectionPlan,dashboard,pscRiskRatePercent,uaeFlagRatePercent,
 officerAdds=[]
}={}){
 if(!plan||!['DRAFT','READY_FOR_APPROVAL'].includes(plan.status)||
  !inspectionPlan||!dashboard)
  fail('SI_INTEGRATED_DRAFT_PLAN_REQUIRED');
 if(!validRate(pscRiskRatePercent)||!validRate(uaeFlagRatePercent))
  fail('SI_INTEGRATED_PERCENT_INVALID',422);
 if(inspectionPlan.planId!==plan.id||
  inspectionPlan.revision!==plan.revision||
  inspectionPlan.sourceHash!==(plan.selectionSourceHash||
   plan.candidateSourceHash)||
  inspectionPlan.stale)
  fail('SI_INTEGRATED_PLAN_SOURCE_STALE_REVIEW',409);
 const sourceRows=new Map((inspectionPlan.rows||[]).map(x=>[x.imo,x]));
 const verified=new Map();
 for(const v of dashboard.vesselCandidates||[]){
  const r=sourceRows.get(v.imo);
  if(!r?.editable)continue;
  if(!(dashboard.candidates||[]).some(c=>c.imo===v.imo&&eligible(c)))continue;
  verified.set(v.imo,{...r,
   flag:v.flag,sources:r.sources||v.sourceTypes,
   risk:r.risk||v.currentRisk||null});
 }
 const rows=[...verified.values()];
 // The previously *published* PSC port-call quota is independent and
 // authoritative; only its shortlist is eligible here (not raw Excel).
 const psc=rows.filter(x=>x.sources?.includes('PSC_PORT_CALL'))
  .sort((a,b)=>{
   const ar=Number(a.risk?.score),br=Number(b.risk?.score);
   const av=Boolean(a.risk)&&Number.isFinite(ar)&&ar>=0&&ar<=100;
   const bv=Boolean(b.risk)&&Number.isFinite(br)&&br>=0&&br<=100;
   return Number(bv)-Number(av)||(av&&bv?br-ar:0)||
    compareInspections(a,b)||a.imo.localeCompare(b.imo);
  });
 const uae=rows.filter(x=>goodFlag(x.flag))
  .sort((a,b)=>compareInspections(a,b)||a.imo.localeCompare(b.imo));
 const count=(n,p)=>Math.floor(n*p/100);
 // A saved, source-hash-bound C01 result controls WHICH vessels fill the
 // quotas. Never backfill an AI rejection with deterministic risk ranking.
 // Existing legacy drafts without a published configured AI selection policy
 // keep their original source-backed deterministic behavior.
 const ai=inspectionPlan.selectionProposal?.aiSelectionValidated===true&&
   inspectionPlan.selectionProposal.snapshotHash===inspectionPlan.sourceHash?
   inspectionPlan.selectionProposal:null;
 // Published C01 provides global source-verified factor cohorts.
 // Never re-run deterministic risk sampling to fill a rejected AI candidate.
 if(ai){
   psc.splice(0,psc.length,...psc.filter(v=>!mandatory(v)));
   uae.splice(0,uae.length,...uae.filter(v=>!mandatory(v)));
 }
 const pscAi=ai?new Set(ai.pscRisk.aiSelectedImos):null;
 const uaeAi=ai?new Set(ai.uaeFlag.aiSelectedImos):null;
 const serviceAi=ai?.serviceRequests?.aiSelectedImos?
   new Set(ai.serviceRequests.aiSelectedImos):null;
 const service=rows.filter(x=>x.sources?.includes('SERVICE_REQUEST')&&!mandatory(x));
 const pscSelected=ai?
   psc.filter(v=>pscAi.has(v.imo)):
   psc.slice(0,count(psc.length,pscRiskRatePercent));
 const uaeSelected=ai?
   uae.filter(v=>uaeAi.has(v.imo)):
   uae.slice(0,count(uae.length,uaeFlagRatePercent));
 const serviceSelected=ai&&serviceAi?
   service.filter(v=>serviceAi.has(v.imo)):[];
 const forced=rows.filter(x=>mandatory(x)||isManualInclude(x));
 // Human-selected alternative additions to the CURRENT DRAFT are distinct
 // from verified Airia advice. Validate every choice against original C01
 // MANUAL_REVIEW, saved vessel evidence and independent published quotas.
 const manualSelected=[];
 if(!Array.isArray(officerAdds)||officerAdds.length>50)
  fail('SI_DRAFT_OFFICER_ALTERNATIVES_INVALID',422);
 const verifiedReasons=new Map((dashboard.candidates||[]).map(c=>[c.imo,c]));
 const recommendedMap=new Map((inspectionPlan.aiRecommendations||[])
  .map(r=>[r.candidateKey,r]));
 const aiCandidateKeys=new Map();
 for(const c of inspectionPlan.aiCandidates||[]){
  const list=aiCandidateKeys.get(c.imo)||[];
  list.push(c.candidateKey);aiCandidateKeys.set(c.imo,list);
 }
 const choices=new Set();
 for(const change of officerAdds){
  if(!change||typeof change.imo!=='string'||choices.has(change.imo)||
   typeof change.reason!=='string'||change.reason.trim().length<10||
   change.reason.length>500||
   !['SERVICE_REQUEST','PSC_RISK','UAE_FLAG'].includes(change.basis))
   fail('SI_DRAFT_OFFICER_ALTERNATIVE_REASON_OR_BASIS_INVALID',422);
  choices.add(change.imo);
  const row=verified.get(change.imo),keys=aiCandidateKeys.get(change.imo)||[];
  if(!ai||!row||mandatory(row)||!keys.length||
   !keys.some(k=>recommendedMap.get(k)?.recommendation==='MANUAL_REVIEW')||
   keys.some(k=>recommendedMap.get(k)?.recommendation==='DEFER_RECOMMENDED'))
   fail('SI_DRAFT_ALTERNATIVE_C01_OR_SOURCE_NOT_ELIGIBLE',409);
  if(change.basis==='SERVICE_REQUEST'){
   if(!row.sources?.includes('SERVICE_REQUEST')||
     ai?.serviceRequests?.cap===null||
     serviceSelected.length+manualSelected.filter(x=>x.basis==='SERVICE_REQUEST').length
      >=ai.serviceRequests.cap)
    fail('SI_DRAFT_SERVICE_QUOTA_EXCEEDED',409);
  }else if(change.basis==='PSC_RISK'){
   if(!row.sources?.includes('PSC_PORT_CALL')||
     !Number.isFinite(Number(row.risk?.score))||
     pscSelected.length+manualSelected.filter(x=>x.basis==='PSC_RISK').length>=ai.pscRisk.cap)
    fail('SI_DRAFT_PSC_QUOTA_EXCEEDED',409);
  }else{
   if(!goodFlag(row.flag)||
     uaeSelected.length+manualSelected.filter(x=>x.basis==='UAE_FLAG').length>=ai.uaeFlag.cap)
    fail('SI_DRAFT_UAE_QUOTA_EXCEEDED',409);
  }
  manualSelected.push({imo:change.imo,basis:change.basis,
   reason:change.reason.trim()});
 }
 const selectedImos=new Set([...forced,...serviceSelected,
   ...pscSelected,...uaeSelected,...manualSelected.map(x=>verified.get(x.imo))].map(x=>x.imo));
 const maxPlan=ai?.maxPlannedVessels??null;
 if(maxPlan!==null&&selectedImos.size>maxPlan)
   fail('SI_POC_PLAN_MAX_VESSELS_EXCEEDED_OFFICER_REVIEW',409);
 const ordered=rows.filter(x=>selectedImos.has(x.imo)).sort((a,b)=>
   Number(mandatory(b))-Number(mandatory(a))||
   compareInspections(a,b)||a.imo.localeCompare(b.imo));
 const roster=ordered.map((row,index)=>({
  imo:row.imo,planRank:index+1,vesselType:row.vesselType||null,
  ...sourceEvidence(row.imo,dashboard)
 }));
 const quotas={
  pscRisk:{ratePercent:pscRiskRatePercent,
   eligibleImos:ai?.pscRisk?.eligibleImos??psc.length,
   targetedImos:pscSelected.length,selectedImos:pscSelected.map(x=>x.imo),
   savedRiskAvailable:psc.filter(x=>x.risk&&
    Number.isFinite(Number(x.risk.score))).length},
  uaeFlag:{ratePercent:uaeFlagRatePercent,
   eligibleImos:ai?.uaeFlag?.eligibleImos??uae.length,
   targetedImos:uaeSelected.length,selectedImos:uaeSelected.map(x=>x.imo)},
  serviceRequests:{eligibleImos:ai?.serviceRequests?.eligibleImos??service.length,
   planCap:ai?.serviceRequests?.cap??null,
   selectedImos:serviceSelected.map(x=>x.imo),
   pendingInCandidateBacklog:ai?.serviceRequests?.waitingInBacklogImos.length??null},
  maxPlannedVessels:maxPlan,
  mandatoryOrManual:{count:forced.length,imos:forced.map(x=>x.imo)},
  officerSelectedAlternatives:manualSelected,
  selectedImos:roster.map(x=>x.imo),
  overlapImos:ai?.overlappingImos||pscSelected.filter(x=>
    uaeSelected.some(y=>y.imo===x.imo)).map(x=>x.imo),
  availableCandidates:rows.length,advisoryOnly:true,
   selectionMethod:ai?
     (manualSelected.length?'VERIFIED_C01_WITH_EXPLICIT_OFFICER_ALTERNATIVES':
      'VERIFIED_C01_AI_WITH_PUBLISHED_QUOTAS'):
     'LEGACY_RULE_BASED_FALLBACK_NO_AI_SELECTION',
   aiAgentRunId:ai?inspectionPlan.agentRunId:null,
   selectionPolicyRevision:ai?.policyRevision??null
 };
 return {planId:plan.id,sourceHash:inspectionPlan.sourceHash,
  planRevision:plan.revision,roster,quotas,
  mandatoryImos:rows.filter(mandatory).map(x=>x.imo),
  selectionHash:sha({sourceHash:inspectionPlan.sourceHash,
   revision:plan.revision,roster,quotas}),advisoryOnly:true};
}
/**
 * Freeze the saved pre-approval vessel scope during capacity revalidation.
 *
 * Integrated draft creation has ALREADY run the full C01 → priority →
 * capacity pipeline, and its final capacity-feasible vessel set is the
 * operator-visible saved Draft. A fresh unscoped capacity search would
 * opportunistically re-add earlier overflow vessels. It must never do that.
 *
 * Keep the full C01 quota/evidence audit, but evaluate inspector assignments
 * ONLY for those saved IMOs. A changed source, new shortlist or an unknown
 * saved vessel requires an explicit human draft review, not a silent rewrite.
 */
export function scopeIntegratedSelectionToSavedDraft(selection,plan){
 const saved=plan?.capacityDraft;
 if(!saved)return selection; // legacy draft: original approval flow
 if(String(saved.status||'').startsWith('STALE_'))
  fail('SI_DRAFT_CAPACITY_STALE_RECALCULATE_REQUIRED',409);
 if(saved.status==='CAPACITY_EXCEPTION_DRAFT')
  fail('SI_DRAFT_CAPACITY_EXCEPTIONS_RESOLVE_BEFORE_APPROVAL',409);
 if(saved.status!=='CAPACITY_VERIFIED_DRAFT')return selection;
 if(saved.sourceHash!==selection.sourceHash)
  fail('SI_DRAFT_SOURCE_CHANGED_REVIEW_REQUIRED',409);
 const originalImos=selection.roster.map(v=>v.imo);
 const originalSet=new Set(originalImos);
 const archived=Array.isArray(saved.c01SelectedImos)?
  saved.c01SelectedImos:originalImos;
 if(archived.length!==originalImos.length||
  new Set(archived).size!==archived.length||
  archived.some(imo=>!originalSet.has(imo)))
  fail('SI_DRAFT_C01_SCOPE_CHANGED_REVIEW_REQUIRED',409);
 if(!Array.isArray(saved.selectedImos)||!saved.selectedImos.length||
   new Set(saved.selectedImos).size!==saved.selectedImos.length||
   saved.selectedImos.some(imo=>!originalSet.has(imo))||
   selection.mandatoryImos.some(imo=>!saved.selectedImos.includes(imo)))
  fail('SI_DRAFT_SAVED_VESSELS_REQUIRE_REVIEW',409);
 const approved=new Set(saved.selectedImos);
 const roster=selection.roster.filter(v=>approved.has(v.imo))
  .map((v,index)=>({...v,planRank:index+1}));
 if(roster.length!==saved.selectedImos.length)
  fail('SI_DRAFT_SAVED_VESSELS_REQUIRE_REVIEW',409);
 const finalImos=roster.map(v=>v.imo);
 const draftScope={
   locked:true,mode:'SAVED_CAPACITY_FEASIBLE_IMOS',
   selectedImos:finalImos,
   c01OriginallySelectedCount:originalImos.length,
   previouslyOutsideCapacity:(saved.capacityExcluded||[]).map(x=>({
     imo:x.imo,reasonCode:x.reasonCode
   }))
 };
 return {...selection,roster,draftScope,
  quotas:{...selection.quotas,selectedImos:finalImos,
   savedDraftScope:'CAPACITY_VERIFIED_DRAFT_NO_SILENT_ADDITIONS'},
  selectionHash:sha({
   sourceHash:selection.sourceHash,planRevision:selection.planRevision,
   fullC01SelectionHash:selection.selectionHash,savedDraftImos:finalImos,
   draftScope:'CAPACITY_VERIFIED_DRAFT_NO_SILENT_ADDITIONS'
  })
 };
}

/** Compare refreshed plan alternatives to the exact saved Draft vessel set.
 * Changing staff/times is permitted; changing vessel scope is NOT.
 */
export function savedDraftCapacityCoverage(selection,variant){
 if(!selection?.draftScope?.locked)return {
  locked:false,matches:true,missingImos:[],unexpectedImos:[]};
 const required=new Set(selection.draftScope.selectedImos);
 const offered=(variant?.assignments||[]).map(x=>x.imo);
 const assigned=new Set(offered);
 const missingImos=[...required].filter(imo=>!assigned.has(imo));
 const unexpectedImos=[...assigned].filter(imo=>!required.has(imo));
 return {locked:true,matches:missingImos.length===0&&
   unexpectedImos.length===0&&offered.length===required.size,
  missingImos,unexpectedImos,savedCount:required.size,
  feasibleNow:assigned.size};
}

export function makeCapacityDraftPlan(plan,selection){
 if(plan.id!==selection.planId||plan.revision!==selection.planRevision)
  fail('SI_INTEGRATED_PLAN_CHANGED_REPREVIEW',409);
 // In-memory scheduling compatibility only. Never persist 'APPROVED' here.
 return {...plan,status:'APPROVED',approvedVessels:selection.roster,
  capacityDraftOnly:true};
}
export function validateIntegratedCapacityProposal(selection,proposal,optionId){
 const variant=proposal?.variants?.find(x=>x.optionId===optionId);
 if(!variant||!Array.isArray(variant.assignments)||
  !Array.isArray(variant.rows)||
  !proposal.proposalHash||!proposal.erpSnapshotId)
  fail('SI_INTEGRATED_VERIFIED_SCHEDULING_OPTION_REQUIRED',409);
 const permitted=new Set(selection.roster.map(x=>x.imo));
 const assigned=new Set(variant.assignments.map(x=>x.imo));
 if(assigned.size!==variant.assignments.length||
  variant.assignments.some(x=>!permitted.has(x.imo))||
  variant.assignments.length!==variant.allocatedVessels||
  variant.assignments.length<1||
  selection.mandatoryImos.some(imo=>!assigned.has(imo)))
  fail('SI_INTEGRATED_MANDATORY_OR_CAPACITY_UNRESOLVED',409);
 const selected=selection.roster.filter(v=>assigned.has(v.imo)).map((v,i)=>({
  ...v,planRank:i+1
 }));
 const rejected=selection.roster.filter(v=>!assigned.has(v.imo)).map(v=>({
  imo:v.imo,reasonCode:variant.rows.find(r=>r.imo===v.imo)?.blocker||
   'GLOBAL_PLAN_CONFLICT_OR_CAPACITY',
  status:'NOT_INCLUDED_CAPACITY_LIMITED'
 }));
 // The review must show exactly the assignments this option will approve.
 return {selected,rejected,variant,
  disposition:{
   candidateCount:selection.quotas.availableCandidates,
   screenedCount:selection.roster.length,
   assignedCount:selected.length,rejectedCount:rejected.length,
   selectedImos:selected.map(v=>v.imo),rejected
  }};
}
