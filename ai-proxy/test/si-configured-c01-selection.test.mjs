import test from 'node:test';
import assert from 'node:assert/strict';
import {getSiSelectionPolicy,SI_SELECTION_POLICY_DEFAULT,SiTargetingError}
 from '../si-candidate-targeting.mjs';
import {projectC01ConfiguredSelection} from '../si-ai-selection-projection.mjs';
import {SiCandidateAgent} from '../si-candidate-agent.mjs';
import {mockSiC01} from '../si-agent-mock.mjs';
import {projectInspectionPlan} from '../si-inspection-plan.mjs';

const configured={...SI_SELECTION_POLICY_DEFAULT,pscRiskRatePercent:50,
 uaeFlagRatePercent:100};
const testCandidate=(imo,{flag='PANAMA',sources=['PSC_PORT_CALL'],risk=60,
 mandatory=false}={})=>({
  candidateKey:'c-'+imo,imo,regime:sources.includes('PSC_PORT_CALL')?
   'PORT_STATE_CONTROL':'UAE_SERVICE_INSPECTION',
  flag,sourceTypes:sources,requiredInPlan:mandatory,
  currentRisk:risk===null?null:{score:risk,level:'High',assessmentId:'ass-'+imo},
  departureVerified:false,departureAt:null,
  incidentHumanReviewed:false,incidentSeverity:null,
  allowedEvidence:['ev-'+imo],missingData:[]
 });
const fleet=[
 testCandidate('9400101',{risk:95}),
 testCandidate('9400102',{risk:65,flag:'UAE'}),
 testCandidate('9400103',{risk:null}),
 testCandidate('9400104',{risk:20}),
 testCandidate('9400105',{flag:'UNITED ARAB EMIRATES',sources:['SERVICE_REQUEST'],
  mandatory:true}),
 testCandidate('9400106',{sources:['NMC_CASE'],mandatory:true,risk:null})
];
const recommendation=(c,kind='SELECT_RECOMMENDED')=>({
 candidateKey:c.candidateKey,imo:c.imo,regime:c.regime,
 recommendation:kind,confidence:0.9,
 evidenceRefs:c.allowedEvidence,reason:'Verified POC source evidence for review.',
 dataGaps:[],priorityRationale:'Deterministic policy order still applies.'
});
const source={candidates:fleet,selection:configured,policyRevision:7,
 snapshotHash:'s'.repeat(64)};
test('B pool: separately cap PSC and UAE eligible candidate IMOs, dedupe overlap and retain mandatory',()=>{
 const result=projectC01ConfiguredSelection(source,fleet.map(c=>recommendation(c)));
 assert.equal(result.pscRisk.eligibleImos,4);
 assert.equal(result.pscRisk.cap,2);
 assert.deepEqual(result.pscRisk.aiSelectedImos,['9400101','9400102']);
 assert.equal(result.uaeFlag.eligibleImos,1);
 assert.equal(result.uaeFlag.cap,1);
 assert.deepEqual(result.uaeFlag.aiSelectedImos,['9400102']);
 assert.deepEqual(result.overlappingImos,['9400102']);
 assert.deepEqual(result.mandatoryImos,['9400105','9400106']);
 assert.deepEqual(new Set(result.selectedImos).size,4);
 assert.equal(result.approved,false);
});
test('model deferral and manual review do not trigger deterministic quota backfill',()=>{
 const rec=fleet.map(c=>recommendation(c));
 rec[0].recommendation='DEFER_RECOMMENDED';
 rec[1].recommendation='MANUAL_REVIEW';
 const result=projectC01ConfiguredSelection(source,rec);
 assert.equal(result.pscRisk.aiSelectedImos.length,1);
 assert.deepEqual(result.pscRisk.aiSelectedImos,['9400104']);
 assert.equal(result.manualReviewImos.includes('9400103'),true);
 assert.equal(result.uaeFlag.aiSelectedImos.length,0);
 assert.equal(result.manualReviewImos.includes('9400102'),true);
 assert.equal(result.selectedImos.includes('9400105'),true);
 assert.equal(result.selectedImos.includes('9400106'),true);
});
test('rate zero blocks optional entries, never mandatory NMC/services',()=>{
 const result=projectC01ConfiguredSelection({...source,selection:{
  ...configured,pscRiskRatePercent:0,uaeFlagRatePercent:0
 }},fleet.map(c=>recommendation(c)));
 assert.deepEqual(result.selectedImos.sort(),['9400105','9400106']);
});
test('published selection policy rejects unsupported pools and fractional rates',()=>{
 assert.equal(getSiSelectionPolicy({selection:configured}).uaePoolMode,
  'ELIGIBLE_CANDIDATES_ONLY');
 assert.throws(()=>getSiSelectionPolicy({selection:{...configured,
  uaePoolMode:'ALL_REGISTERED_UAE_VESSELS'}}),e=>e instanceof SiTargetingError);
 assert.throws(()=>getSiSelectionPolicy({selection:{...configured,
  pscRiskRatePercent:18.7}}),e=>e instanceof SiTargetingError);
});
test('C01 request actually receives configured publisher rules, returns evidence-backed selection',async()=>{
 const inputs=fleet.map(c=>({
  key:c.candidateKey,imo:c.imo,regime:c.regime,vesselName:'Vessel '+c.imo,
  events:[{eventKey:'evt-'+c.imo,sourceEventId:'ev-'+c.imo,
   sourceReference:'ref-'+c.imo,sourceType:c.sourceTypes[0],
   approval:'APPROVED',evidenceIds:['ev-'+c.imo]}],
  eligibility:c.mandatory?'MANDATORY':'MANUAL_REVIEW',priority:'SOURCE_ELIGIBLE',
  currentRisk:c.currentRisk,status:'PENDING_REVIEW',inspectionCase:null
 }));
 const dashboard={
  policy:{version:7,config:{selection:configured}},
  riskPolicyRevision:3,fleetSnapshotId:'fleet-immutable',
  candidates:inputs,
  vesselCandidates:fleet.map(c=>({
   imo:c.imo,flag:c.flag,departureVerified:false,
   incidentHumanReviewed:false,incidentSeverity:null
  }))
 };
 let called=0,seenPolicy=null;
 const agent=new SiCandidateAgent({
  targeting:{dashboard:async()=>dashboard},
  pscPolicy:async()=>({version:2}),
  provider:'mock',executeAgent:async payload=>{
   called++;
   seenPolicy=payload.configuredSelectionPolicy;
   assert.equal(payload.schemaVersion,'SI-C01-v1');
   assert.equal(payload.outputContract.topLevel.recommendations,
    'array: exactly one per supplied candidateKey');
   return mockSiC01(payload);
  }
 });
 const preview=await agent.preview();
 assert.equal(preview.externalCalls,0);
 assert.equal(preview.selectionPolicy.uaeFlagRatePercent,100);
 const run=await agent.run({actor:'Supervisor',confirmRun:true,
  expectedSnapshotHash:preview.snapshotHash});
 assert.equal(called,1);
 assert.equal(run.externalCalls,0);
 assert.equal(seenPolicy.uaePoolMode,'ELIGIBLE_CANDIDATES_ONLY');
 assert.equal(run.selectionProposal.pscRisk.cap,2);
 assert.equal(run.selectionProposal.uaeFlag.cap,1);
 assert.equal(run.selectionProposal.selectedImos.length,4);
 assert.equal(run.humanDecisionRequired,true);
 assert.equal(run.mutations,false);
 // A selected AI recommendation without quota is not automatically a plan row.
 const display=projectInspectionPlan({
  vesselCandidates:fleet.map(c=>({
   imo:c.imo,vesselName:'Vessel',flag:c.flag,vesselType:'CARGO',
   sourceTypes:c.sourceTypes,regimes:[c.regime],
   sourceEvents:[],pendingWorkflows:1,
   currentRisk:c.currentRisk,createdWorkflows:0,scheduledWorkflows:0
  }))
 },await agent.source(),run);
 assert.equal(display.filter(r=>r.planSelected).length,4);
 assert.equal(display.find(r=>r.imo==='9400103').planSelected,false);
});
