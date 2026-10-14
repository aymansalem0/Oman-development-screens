/**
 * SI-S01: Airia ranks only valid, complete ERP-constrained whole-plan
 * scheduling alternatives. It cannot invent an engineer, time, vessel,
 * change regulatory priority, or confirm a booking.
 */
import {createHash} from 'node:crypto';
import {SiPocAdvisorError} from './si-poc-workflow-advisors.mjs';
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const fail=(code,status=502)=>{throw new SiPocAdvisorError(code,status);};
function unwrap(value){
 for(let i=0;i<8;i++){
  if(typeof value==='string'){try{value=JSON.parse(value);}catch{
    fail('SI_S01_STRUCTURED_JSON_REQUIRED');}continue;}
  if(Array.isArray(value)&&value.length===1){value=value[0];continue;}
  if(!value||typeof value!=='object'||Array.isArray(value))
   fail('SI_S01_STRUCTURED_JSON_REQUIRED');
  if(Array.isArray(value.rankedOptions))return value;
  const child=['result','response','output','data','finalOutput','outputText','content','text']
   .find(k=>value[k]!==undefined);
  if(!child)break;
  value=value[child];
 }
 fail('SI_S01_STRUCTURED_JSON_REQUIRED');
}
export function prepareS01WholePlanRequest(proposal){
 if(proposal?.status!=='DRAFT_REQUIRES_SUPERVISOR_APPROVAL'||
   !proposal.proposalHash||!proposal.erpSnapshotId||
   !Array.isArray(proposal.variants)||!proposal.variants.length)
  fail('SI_S01_FEASIBLE_PLAN_ALTERNATIVES_REQUIRED',409);
 const feasibleSlots=proposal.variants.map(v=>({
  optionId:v.optionId,
  allocatedVessels:v.allocatedVessels,
  objectiveScore:v.objectiveScore,
  assignments:v.assignments.map(x=>({
   imo:x.imo,inspectorId:x.inspectorId,portId:x.portId,
   startUtc:x.startUtc,endUtc:x.endUtc,score:x.score
  }))
 }));
 const slotSetHash=sha({
  proposalHash:proposal.proposalHash,erpSnapshotId:proposal.erpSnapshotId,
  policyRevision:proposal.policyRevision,feasibleSlots
 });
 const allowedEvidence=[proposal.proposalHash,proposal.erpSnapshotId,
  ...feasibleSlots.map(x=>x.optionId)];
 return {
  schemaVersion:'MOEI-SI-S01-WHOLE-PLAN-v1',
  agentCode:'SI-S01',mode:'ADVISORY_ONLY',
  context:{planId:proposal.planId,planNumber:proposal.planNumber,
   planRevision:proposal.planRevision,policyRevision:proposal.policyRevision,
   approvedVesselCount:proposal.summary.total},
  currentSnapshot:{
   proposalHash:proposal.proposalHash,erpSnapshotId:proposal.erpSnapshotId,
   policyRevision:proposal.policyRevision,slotSetHash
  },
  feasibleSlots,allowedEvidence,
  outputContract:{
   format:'STRICT_JSON_OBJECT_NO_MARKDOWN',
   rankedOptions:'array of up to 3 distinct existing feasibleSlots optionIds',
   optionId:'exact source optionId',rank:'unique positive integer 1..3',
   confidence:'JSON number in [0,1]',
   rationale:'source-grounded explanation',
   evidenceRefs:'only values in allowedEvidence',
   slotSetHash:'must exactly equal currentSnapshot.slotSetHash',
   bookingConfirmed:false
  },
  businessGuardrails:{
   sameOrBetterCoverageOnly:true,
   noInventedEngineerTimeOrPort:true,
   preserveApprovedVessels:true,
   preserveStatutoryPriority:true,
   inspectionCasesCreated:false,erpBookingCreated:false,
   approvalByHumanSupervisor:true
  }
 };
}
export function validateS01WholePlanResponse(raw,proposal,request){
 const doc=unwrap(raw);
 if(doc.bookingConfirmed!==false||
    doc.slotSetHash!==request.currentSnapshot.slotSetHash||
    !doc.rankedOptions.length||doc.rankedOptions.length>proposal.variants.length||
    doc.rankedOptions.length>3)
  fail('SI_S01_AI_RESPONSE_CONTRACT_INVALID');
 const allowedIds=new Set(proposal.variants.map(x=>x.optionId));
 const evidence=new Set(request.allowedEvidence);
 const ids=new Set(),ranks=new Set();
 for(const opt of doc.rankedOptions){
  if(!opt||typeof opt!=='object'||
    !allowedIds.has(opt.optionId)||ids.has(opt.optionId)||
    !Number.isInteger(opt.rank)||opt.rank<1||opt.rank>3||
    ranks.has(opt.rank)||typeof opt.confidence!=='number'||
    !Number.isFinite(opt.confidence)||opt.confidence<0||opt.confidence>1||
    typeof opt.rationale!=='string'||opt.rationale.trim().length<10||
    opt.rationale.length>1800||
    !Array.isArray(opt.evidenceRefs)||opt.evidenceRefs.length>20||
    opt.evidenceRefs.some(x=>typeof x!=='string'||!evidence.has(x)))
   fail('SI_S01_AI_OPTION_NOT_SOURCE_VERIFIED');
  ids.add(opt.optionId);ranks.add(opt.rank);
 }
 const ranked=doc.rankedOptions.slice().sort((a,b)=>a.rank-b.rank);
 if(ranked[0].rank!==1)fail('SI_S01_AI_PRIMARY_RANK_REQUIRED');
 const chosen=proposal.variants.find(x=>x.optionId===ranked[0].optionId);
 if(!chosen)fail('SI_S01_AI_OPTION_NOT_SOURCE_VERIFIED');
 // Proposal is a READ-ONLY new projection. Original deterministic baseline
 // preserved for comparison and later fresh supervisor validation.
 return {
  status:'AI_ADVISORY_REVIEW_REQUIRED',
  agentCode:'SI-S01',provider:'AIRIA',externalCalls:1,
  proposalHash:proposal.proposalHash,
  erpSnapshotId:proposal.erpSnapshotId,
  slotSetHash:request.currentSnapshot.slotSetHash,
  chosenOptionId:chosen.optionId,
  rankedOptions:ranked.map(x=>({
   optionId:x.optionId,rank:x.rank,confidence:x.confidence,
   rationale:x.rationale.trim(),evidenceRefs:x.evidenceRefs
  })),
  proposal:{
   ...proposal,
   solver:'ERP_HARD_CONSTRAINTS_WITH_AIRIA_S01_VARIANT_SELECTION',
   status:'DRAFT_REQUIRES_SUPERVISOR_APPROVAL',
   rows:chosen.rows,board:chosen.board,
   summary:{...proposal.summary,proposed:chosen.allocatedVessels,
    unscheduled:proposal.summary.total-chosen.allocatedVessels},
   aiAdvisory:true,chosenOptionId:chosen.optionId
  },
  humanApprovalRequired:true,
  autoApproved:false,caseWrites:0,bookingWrites:0
 };
}
