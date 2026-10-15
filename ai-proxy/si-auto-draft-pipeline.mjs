/**
 * MOEI Smart Inspection: one transparent automatic Draft pipeline.
 *   C01 source-verified selection -> published deterministic priority ->
 *   ERP/POC qualified-inspector capacity -> proposed Draft roster.
 *
 * Optional capacity overflow is explicitly NOT IN THIS PLAN; never silently
 * delete a source candidate or reject a protected NMC regulatory referral.
 * No agent schedules inspectors, books ERP shifts or approves inspections.
 */
export class SiAutoDraftPipelineError extends Error{
 constructor(code,status=409){super(code);this.code=code;this.status=status;}
}
const fail=code=>{throw new SiAutoDraftPipelineError(code);};

export function finalizeSiAutoDraftPipeline(selection,proposal,{
 candidateCount=null,aiRunId=null
}={}){
 if(!Array.isArray(selection?.roster)||!selection.roster.length||
    !Array.isArray(selection.mandatoryImos)||
    !Array.isArray(proposal?.rows)||!Array.isArray(proposal?.variants)||
    !proposal.proposalHash)
  fail('SI_AUTO_DRAFT_PIPELINE_INPUT_INVALID');
 const imos=new Set(selection.roster.map(r=>r.imo));
 if(imos.size!==selection.roster.length||
    new Set(proposal.rows.map(r=>r.imo)).size!==imos.size||
    proposal.rows.some(r=>!imos.has(r.imo)))
  fail('SI_AUTO_DRAFT_CAPACITY_ROSTER_MISMATCH');
 const main=proposal.variants[0]||null;
 const assignments=main?.assignments||[];
 if(new Set(assignments.map(a=>a.imo)).size!==assignments.length||
    assignments.some(a=>!imos.has(a.imo))||
    (main&&main.allocatedVessels!==assignments.length)||
    (proposal.summary?.proposed!==assignments.length))
  fail('SI_AUTO_DRAFT_ASSIGNMENTS_INVALID');
 const assigned=new Map(assignments.map(x=>[x.imo,x]));
 const byImo=new Map(proposal.rows.map(r=>[r.imo,r]));
 const mandatory=new Set(selection.mandatoryImos);
 const planned=[],outsidePlan=[],mandatoryUnscheduled=[];
 for(const candidate of selection.roster){
  const row=byImo.get(candidate.imo),visit=assigned.get(candidate.imo);
  if(visit){
   if(row?.status!=='PROPOSED')fail('SI_AUTO_DRAFT_CAPACITY_STATUS_MISMATCH');
   planned.push({...candidate,planRank:planned.length+1});
  }else{
   if(row?.status!=='UNSCHEDULED')fail('SI_AUTO_DRAFT_CAPACITY_STATUS_MISMATCH');
   const item={
    imo:candidate.imo,originalPriority:candidate.planRank,
    reasonCode:row.blocker||'GLOBAL_PLAN_CONFLICT_OR_CAPACITY',
    disposition:mandatory.has(candidate.imo)?
     'MANDATORY_EXCEPTION_REQUIRES_SUPERVISOR_RESOLUTION':
     'OUTSIDE_CURRENT_DRAFT_CAPACITY',
    remainsInCandidatePool:true,workOrderIssued:false
   };
   if(mandatory.has(candidate.imo))mandatoryUnscheduled.push(item);
   else outsidePlan.push(item);
  }
 }
 const stages=[
  {stage:'AI_SELECTION',status:'COMPLETED',count:selection.roster.length,
   description:'SOURCE_VERIFIED_C01_UNDER_PUBLISHED_SELECTION_LIMITS'},
  {stage:'EXECUTION_PRIORITY',status:'COMPLETED',
   count:selection.roster.length,
   description:'VERIFIED_ETD_THEN_HUMAN_REVIEWED_INCIDENT_SEVERITY'},
  {stage:'INSPECTOR_CAPACITY',status:'COMPLETED',count:planned.length,
   description:'QUALIFIED_SHIFTS_PORTS_TRAVEL_AND_VESSEL_VISIT_WINDOWS'}
 ];
 return {
  status:mandatoryUnscheduled.length?'BLOCKED_MANDATORY_CAPACITY':
   planned.length?'CAPACITY_FEASIBLE_DRAFT':'NO_FEASIBLE_VESSELS',
  sourceCandidateCount:candidateCount,
  aiRunId,stages,
  aiSelectedCount:selection.roster.length,
  prioritizedCount:selection.roster.length,
  inPlanCount:planned.length,
  excludedByCapacityCount:outsidePlan.length,
  mandatoryExceptionCount:mandatoryUnscheduled.length,
  planned,plannedImos:planned.map(r=>r.imo),
  outsidePlan,mandatoryUnscheduled,
  // Publishing/approval is separate and cannot waive missing mandatory visits.
  readyForSupervisorReview:planned.length>0&&mandatoryUnscheduled.length===0,
  noBookings:true,noCases:true,noRegulatoryApproval:true
 };
}
