import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_CAPACITY_WEIGHTS,validateCapacityWeights,
 capacityDraftFromSelection,scoreCapacityCandidate,previewCapacityPlan}
 from '../si-capacity-plan.mjs';
import {SiElectronicScheduler} from '../si-electronic-scheduling.mjs';

const now=Date.parse('2026-10-14T08:00:00+04:00');
const id='33333333-3333-4333-8333-333333333333';
const vessel={imo:'9400796',vesselName:'POC service vessel',rank:1,
 inspectionRegimes:['UAE_SERVICE_INSPECTION'],
 reasons:[{eventKey:'SERVICE-9400796',sourceType:'SERVICE_REQUEST',
  sourceEventId:'SR-2026-01',sourceReference:'SR-2026-01',
  inspectionRegime:'UAE_SERVICE_INSPECTION',reason:'Service inspection'}]};
const plan={id,number:'IP-TEST-CAPACITY',status:'READY_FOR_APPROVAL',
 revision:4,approvedVessels:[],savedPlanRows:[
  {imo:'9400796',planSelected:true}]};
const selected={planId:id,planRevision:4,sourceHash:'source-hash',
 stale:false,vessels:[vessel]};
const dashboard={vesselCandidates:[{
 imo:vessel.imo,vesselName:vessel.vesselName,vesselType:'CARGO',
 currentRisk:{score:62,level:'Watch'},
 sourceEvents:[{eventKey:'SERVICE-9400796',
  sourceType:'SERVICE_REQUEST',approval:'SOURCE_FINAL',
  sourceReference:'SR-2026-01'}]
}]};
const erp={snapshotId:'ERP-POC-CAPACITY',
 data:{Ports:[{port_id:'JEA',port_name:'Jebel Ali',
 active:'Y',city:'Dubai',window_start:'06:00',window_end:'22:00'}],
 Inspectors:[],Qualifications:[],Inspector_Ports:[],Shifts:[],
 Leaves:[],Blackouts:[],Bookings:[],Travel_Matrix:[]}};
const scheduler=()=>new SiElectronicScheduler({erp:{},cases:{},
 path:'/tmp/si-capacity-plan-test-non-mutating.json',clock:()=>now});
test('source/risk scroll weights are four integer percentages totaling 100',()=>{
 assert.deepEqual(validateCapacityWeights(),DEFAULT_CAPACITY_WEIGHTS);
 assert.deepEqual(validateCapacityWeights({
  NMC_CASE:40,SERVICE_REQUEST:20,PSC_PORT_CALL:10,RISK_FACTOR:30
 }),{NMC_CASE:40,SERVICE_REQUEST:20,PSC_PORT_CALL:10,RISK_FACTOR:30});
 for(const weights of [
  {...DEFAULT_CAPACITY_WEIGHTS,RISK_FACTOR:26},
  {...DEFAULT_CAPACITY_WEIGHTS,NMC_CASE:-1},
  {...DEFAULT_CAPACITY_WEIGHTS,RISK_FACTOR:'25'},
  {...DEFAULT_CAPACITY_WEIGHTS,UNKNOWN:0}
 ])assert.throws(()=>validateCapacityWeights(weights),
  e=>e.code==='SI_CAPACITY_SOURCE_RISK_WEIGHTS_MUST_TOTAL_100');
});
test('source scoring preserves mandatory NMC and treats missing risk as unknown',()=>{
 const withRisk=scoreCapacityCandidate(vessel,validateCapacityWeights(),
  {score:62});
 assert.equal(withRisk.sourcePoints,25);
 assert.equal(withRisk.riskPoints,16);
 const unknown=scoreCapacityCandidate(vessel,validateCapacityWeights(),null);
 assert.equal(unknown.riskPoints,null);
 assert.equal(unknown.riskStatus,'NOT_ASSESSED');
 const statutory={...vessel,reasons:[
  ...vessel.reasons,{eventKey:'NMC-1',sourceType:'NMC_CASE'}]};
 assert.equal(scoreCapacityCandidate(statutory,validateCapacityWeights(),null)
  .statutoryPriorityProtected,true);
});
test('candidate draft is still unapproved and retains full source evidence',()=>{
 const p=capacityDraftFromSelection(plan,selected);
 assert.equal(p.status,'APPROVED','internal projection only, not stored');
 assert.equal(plan.status,'READY_FOR_APPROVAL');
 assert.equal(p.approvedVessels[0].imo,'9400796');
 assert.equal(p.approvedVessels[0].inspectionReasons[0].eventKey,'SERVICE-9400796');
 assert.throws(()=>capacityDraftFromSelection({...plan,status:'APPROVED'},selected),
  e=>e.code==='SI_CAPACITY_DRAFT_SELECTION_NOT_READY');
});
test('capacity-first preview can allocate synthetic qualified engineer but cannot approve/book',()=>{
 const result=previewCapacityPlan({
  plan,selection:selected,dashboard,erpSnapshot:erp,
  policy:scheduler().getPolicy(),scheduler:scheduler(),
  clock:()=>now,demoMode:true
 });
 assert.equal(result.status,'CAPACITY_ASSESSED_NOT_APPROVED');
 assert.equal(result.readyForApproval,true,JSON.stringify(result.proposal.rows));
 assert.equal(result.proposedVesselCount,1);
 assert.equal(result.unmetCapacityCount,0);
 assert.equal(result.priorityAdvisory[0].riskPoints,16);
 assert.equal(result.proposal.variants[0].assignments[0].imo,'9400796');
 assert.equal(result.caseWrites,0);
 assert.equal(result.bookingWrites,0);
 assert.equal(plan.status,'READY_FOR_APPROVAL');
 assert.equal(erp.data.Inspectors.length,0);
 assert.equal(result.sourceFactsAreSynthetic,true);
 const repeated=previewCapacityPlan({
  plan,selection:selected,dashboard,erpSnapshot:erp,
  policy:scheduler().getPolicy(),scheduler:scheduler(),
  clock:()=>now,demoMode:true
 });
 assert.equal(repeated.capacityHash,result.capacityHash);
});
test('zero qualified slots blocks unified plan approval and reports exception',()=>{
 const impossible={buildOptions:()=>({options:[],exclusions:[{
  inspectorId:'DEMO-INS-01',reasons:['NO_WORKING_SHIFT']} ]})};
 const result=previewCapacityPlan({
  plan,selection:selected,dashboard,erpSnapshot:erp,
  policy:scheduler().getPolicy(),scheduler:impossible,
  clock:()=>now,demoMode:true
 });
 assert.equal(result.readyForApproval,false);
 assert.equal(result.proposal.summary.unscheduled,1);
 assert.equal(result.proposal.rows[0].status,'UNSCHEDULED');
});
