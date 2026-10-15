import test from 'node:test';
import assert from 'node:assert/strict';
import {finalizeSiAutoDraftPipeline} from '../si-auto-draft-pipeline.mjs';

const selection={roster:[
 {imo:'9401201',planRank:1,inspectionReasons:[{sourceType:'NMC_CASE'}]},
 {imo:'9401202',planRank:2,inspectionReasons:[{sourceType:'PSC_PORT_CALL'}]},
 {imo:'9401203',planRank:3,inspectionReasons:[{sourceType:'SERVICE_REQUEST'}]}
],mandatoryImos:['9401201']};
const make=(allocated=['9401201','9401202'])=>({
 proposalHash:'a'.repeat(64),
 summary:{total:3,proposed:allocated.length,unscheduled:3-allocated.length},
 rows:selection.roster.map(v=>({
  imo:v.imo,status:allocated.includes(v.imo)?'PROPOSED':'UNSCHEDULED',
  blocker:allocated.includes(v.imo)?null:'ENGINEER_FULLY_BOOKED'})),
 variants:[{optionId:'PLAN-A',allocatedVessels:allocated.length,
  assignments:allocated.map(imo=>({imo,inspectorName:'POC Engineer',
   startLocal:'2026-10-20 09:00',endLocal:'2026-10-20 11:00'}))}]
});
test('automatic sequence selects, prioritizes and assigns capacity; surplus is OUTSIDE draft',()=>{
 const r=finalizeSiAutoDraftPipeline(selection,make(),{
  candidateCount:99,aiRunId:'C01-ALL-112'});
 assert.deepEqual(r.stages.map(s=>s.stage),[
  'AI_SELECTION','EXECUTION_PRIORITY','INSPECTOR_CAPACITY']);
 assert.deepEqual(r.stages.map(s=>s.count),[3,3,2]);
 assert.equal(r.sourceCandidateCount,99);
 assert.equal(r.aiSelectedCount,3);
 assert.equal(r.inPlanCount,2);
 assert.equal(r.excludedByCapacityCount,1);
 assert.deepEqual(r.plannedImos,['9401201','9401202']);
 assert.deepEqual(r.planned.map(v=>v.planRank),[1,2]);
 assert.deepEqual(r.outsidePlan.map(v=>v.imo),['9401203']);
 assert.equal(r.outsidePlan[0].reasonCode,'ENGINEER_FULLY_BOOKED');
 assert.equal(r.outsidePlan[0].remainsInCandidatePool,true);
 assert.equal(r.outsidePlan[0].disposition,'OUTSIDE_CURRENT_DRAFT_CAPACITY');
 assert.equal(r.readyForSupervisorReview,true);
 assert.equal(r.noRegulatoryApproval,true);
 assert.equal(r.noBookings,true);
});
test('protected NMC source referral without capacity is separately BLOCKED, never silently excluded',()=>{
 const r=finalizeSiAutoDraftPipeline(selection,make(['9401202']));
 assert.equal(r.status,'BLOCKED_MANDATORY_CAPACITY');
 assert.equal(r.readyForSupervisorReview,false);
 assert.deepEqual(r.mandatoryUnscheduled.map(x=>x.imo),['9401201']);
 assert.equal(r.mandatoryUnscheduled[0].disposition,
  'MANDATORY_EXCEPTION_REQUIRES_SUPERVISOR_RESOLUTION');
 assert.equal(r.outsidePlan[0].imo,'9401203');
 assert.equal(r.mandatoryExceptionCount,1);
});
test('when nobody can be assigned, no ready plan; preserve all source-based candidates',()=>{
 const r=finalizeSiAutoDraftPipeline(selection,make([]));
 assert.equal(r.inPlanCount,0);
 assert.equal(r.readyForSupervisorReview,false);
 assert.equal(r.mandatoryExceptionCount,1);
 assert.equal(r.excludedByCapacityCount,2);
 assert.equal(r.noCases,true);
});
test('a fabricated capacity IMO or mismatched number is never published as a valid plan',()=>{
 const p=make();
 p.rows[2].imo='9999999';
 assert.throws(()=>finalizeSiAutoDraftPipeline(selection,p),
  /SI_AUTO_DRAFT_CAPACITY_ROSTER_MISMATCH/);
 const q=make();q.variants[0].assignments.push({imo:'8888888'});
 assert.throws(()=>finalizeSiAutoDraftPipeline(selection,q),
  /SI_AUTO_DRAFT_ASSIGNMENTS_INVALID/);
});
