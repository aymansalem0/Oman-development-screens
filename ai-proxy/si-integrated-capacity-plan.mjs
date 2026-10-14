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
const isManualInclude=row=>row.selectionOrigin==='OFFICER_AMENDED'&&
 row.planSelected===true&&row.disposition==='INCLUDE';
function sourceEvidence(imo,dashboard){
 const workflows=(dashboard.candidates||[]).filter(c=>c.imo===imo&&eligible(c))
  .sort((a,b)=>Number(b.events.some(e=>e.sourceType==='NMC_CASE'))-
   Number(a.events.some(e=>e.sourceType==='NMC_CASE'))||
   a.regime.localeCompare(b.regime));
 const triggers=new Map();
 for(const workflow of workflows)for(const event of workflow.events||[]){
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
 plan,inspectionPlan,dashboard,pscRiskRatePercent,uaeFlagRatePercent
}={}){
 if(!plan||!['DRAFT','READY_FOR_APPROVAL'].includes(plan.status)||
  !inspectionPlan||!dashboard)
  fail('SI_INTEGRATED_DRAFT_PLAN_REQUIRED');
 if(!validRate(pscRiskRatePercent)||!validRate(uaeFlagRatePercent))
  fail('SI_INTEGRATED_PERCENT_INVALID',422);
 if(inspectionPlan.planId!==plan.id||
  inspectionPlan.revision!==plan.revision||
  inspectionPlan.sourceHash!==plan.selectionSourceHash||
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
 const pscSelected=psc.slice(0,count(psc.length,pscRiskRatePercent));
 const uaeSelected=uae.slice(0,count(uae.length,uaeFlagRatePercent));
 const forced=rows.filter(x=>mandatory(x)||isManualInclude(x));
 const selectedImos=new Set([...forced,...pscSelected,...uaeSelected].map(x=>x.imo));
 const ordered=rows.filter(x=>selectedImos.has(x.imo)).sort((a,b)=>
  Number(mandatory(b))-Number(mandatory(a))||
  compareInspections(a,b)||a.imo.localeCompare(b.imo));
 const roster=ordered.map((row,index)=>({
  imo:row.imo,planRank:index+1,vesselType:row.vesselType||null,
  ...sourceEvidence(row.imo,dashboard)
 }));
 const quotas={
  pscRisk:{ratePercent:pscRiskRatePercent,eligibleImos:psc.length,
   targetedImos:pscSelected.length,selectedImos:pscSelected.map(x=>x.imo),
   savedRiskAvailable:psc.filter(x=>x.risk&&
    Number.isFinite(Number(x.risk.score))).length},
  uaeFlag:{ratePercent:uaeFlagRatePercent,eligibleImos:uae.length,
   targetedImos:uaeSelected.length,selectedImos:uaeSelected.map(x=>x.imo)},
  mandatoryOrManual:{count:forced.length,imos:forced.map(x=>x.imo)},
  selectedImos:roster.map(x=>x.imo),
  overlapImos:pscSelected.filter(x=>uaeSelected.some(y=>y.imo===x.imo))
   .map(x=>x.imo),
  availableCandidates:rows.length,advisoryOnly:true
 };
 return {planId:plan.id,sourceHash:inspectionPlan.sourceHash,
  planRevision:plan.revision,roster,quotas,
  mandatoryImos:rows.filter(mandatory).map(x=>x.imo),
  selectionHash:sha({sourceHash:inspectionPlan.sourceHash,
   revision:plan.revision,roster,quotas}),advisoryOnly:true};
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
