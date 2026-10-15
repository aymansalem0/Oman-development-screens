import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareS01WholePlanRequest,validateS01WholePlanResponse}
 from '../si-plan-s01-advisor.mjs';
const variant=(id,engineer,score)=>({
 optionId:id,allocatedVessels:2,objectiveScore:score,
 assignments:[
  {imo:'9328471',inspectorId:engineer,portId:'FUJ',
   startUtc:'2026-10-20T05:00:00.000Z',endUtc:'2026-10-20T06:30:00.000Z',score},
  {imo:'9247813',inspectorId:'ENG2',portId:'DXB',
   startUtc:'2026-10-20T08:00:00.000Z',endUtc:'2026-10-20T09:30:00.000Z',score:80}
 ],rows:[{imo:'9328471',status:'PROPOSED'},{imo:'9247813',status:'PROPOSED'}],
 board:{status:'UNAPPROVED_PREVIEW_ONLY',allocatedVessels:2,
  caseWrites:0,bookingWrites:0}
});
const proposal=()=>({
 status:'DRAFT_REQUIRES_SUPERVISOR_APPROVAL',
 planId:'11111111-1111-4111-8111-111111111111',planNumber:'IP-S01',
 planRevision:2,proposalHash:'f'.repeat(64),
 erpSnapshotId:'ERP-POC-SAVED-20261014',policyRevision:3,
 summary:{total:2,proposed:2,unscheduled:0,caseWrites:0,bookingWrites:0},
 rows:variant('SOURCE-A','ENG1',90).rows,
 variants:[variant('SOURCE-A','ENG1',90),variant('SOURCE-B','ENG3',86)]
});
function reply(req,rankFirst='SOURCE-B'){
 return {bookingConfirmed:false,slotSetHash:req.currentSnapshot.slotSetHash,
  rankedOptions:[
   {optionId:rankFirst,rank:1,confidence:.84,
    rationale:'Both vessel visits are feasible and engineer shifts have been verified.',
    evidenceRefs:[req.currentSnapshot.erpSnapshotId]},
   {optionId:rankFirst==='SOURCE-A'?'SOURCE-B':'SOURCE-A',rank:2,confidence:.71,
    rationale:'Second viable whole-plan option preserves approved roster and qualifications.',
    evidenceRefs:[req.currentSnapshot.proposalHash]}
  ]};
}
test('S01 can choose a different full ERP-feasible plan and never book it',()=>{
 const original=proposal(),req=prepareS01WholePlanRequest(original);
 assert.equal(req.feasibleSlots.length,2);
 assert.equal(req.businessGuardrails.erpBookingCreated,false);
 assert.equal(req.currentSnapshot.erpSnapshotId,original.erpSnapshotId);
 const response=validateS01WholePlanResponse({result:JSON.stringify(reply(req))},original,req);
 assert.equal(response.status,'AI_ADVISORY_REVIEW_REQUIRED');
 assert.equal(response.provider,'AIRIA');
 assert.equal(response.chosenOptionId,'SOURCE-B');
 assert.equal(response.proposal.rows.length,2);
 assert.equal(response.proposal.solver,'ERP_HARD_CONSTRAINTS_WITH_AIRIA_S01_VARIANT_SELECTION');
 assert.equal(response.proposal.caseWrites,undefined);
 assert.equal(response.proposal.summary.bookingWrites,0);
 assert.equal(response.bookingWrites,0);
 assert.equal(response.caseWrites,0);
 assert.equal(response.humanApprovalRequired,true);
 assert.equal(original.rows[0].imo,'9328471','source proposal must remain unchanged');
});
test('S01 rejects hallucinated option, stale ERP slot-set hash and asserted booking',()=>{
 const original=proposal(),req=prepareS01WholePlanRequest(original);
 for(const update of [
  {rankedOptions:[{...reply(req).rankedOptions[0],optionId:'FAKE-ENGINEER-SLOT'}]},
  {slotSetHash:'outdated'},
  {bookingConfirmed:true},
  {rankedOptions:[{...reply(req).rankedOptions[0],evidenceRefs:['FAKE-EVIDENCE']}]},
  {rankedOptions:[{...reply(req).rankedOptions[0],confidence:'0.85'}]},
  {rankedOptions:[{...reply(req).rankedOptions[0],rank:2}]}
 ]){
  assert.throws(()=>validateS01WholePlanResponse({...reply(req),...update},
   original,req),e=>e.status===502&&e.code.startsWith('SI_S01_'));
 }
});
test('S01 never accepts prose as plan advice, or a source without vetted variants',()=>{
 const p=proposal(),req=prepareS01WholePlanRequest(p);
 assert.throws(()=>validateS01WholePlanResponse({result:'please book engineer'},p,req),
  e=>e.code==='SI_S01_STRUCTURED_JSON_REQUIRED');
 assert.throws(()=>prepareS01WholePlanRequest({...p,variants:[]}),
  e=>e.code==='SI_S01_FEASIBLE_PLAN_ALTERNATIVES_REQUIRED');
});
