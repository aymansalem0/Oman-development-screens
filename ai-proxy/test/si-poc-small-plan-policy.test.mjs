/**
 * MOEI SI POC data-shaping regression.
 * 112 pathways / 99 unique IMO mimic the demonstration data profile,
 * while preserving all unselected service requests in the source queue.
 * Everything is synthetic, with ZERO Oracle / Airia mutations.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {SI_SELECTION_POLICY_DEFAULT,getSiSelectionPolicy}
  from '../si-candidate-targeting.mjs';
import {buildC01Source} from '../si-candidate-agent.mjs';
import {projectC01ConfiguredSelection} from '../si-ai-selection-projection.mjs';
import {projectInspectionPlan} from '../si-inspection-plan.mjs';

const imo=n=>String(9000000+n);
const selection={...SI_SELECTION_POLICY_DEFAULT,
  pscRiskRatePercent:10,uaeFlagRatePercent:25,
  serviceRequestPlanCap:4,maxPlannedVessels:12};
const candidates=[];
const flags=new Map(Array.from({length:99},(_,i)=>[
  imo(i),i<15?'UAE':'PANAMA'
]));
let counter=0;
const append=(n,sourceType,approval='SOURCE_FINAL')=>{
 const key=sourceType+'-'+n+'-'+counter++;
 candidates.push({key,imo:imo(n),
  regime:sourceType==='NMC_CASE'?'FOCUSED_INSPECTION':
    sourceType==='PSC_PORT_CALL'?'PORT_STATE_CONTROL':'UAE_SERVICE_INSPECTION',
  vesselName:'POC Vessel '+n,flag:flags.get(imo(n)),
  status:'PENDING_REVIEW',inspectionCase:null,eligibility:
    sourceType==='NMC_CASE'?'MANDATORY':'MANUAL_REVIEW',
  currentRisk:{score:100-(n%80),level:'High',
    assessmentId:'SAVED-RISK-'+n,policyRevision:7},
  events:[{sourceType,approval,sourceEventId:'SOURCE-'+key,
   sourceReference:'REFERENCE-'+key,eventKey:'EV-'+key,
   evidenceIds:['EVIDENCE-'+key],provenance:'POC_SIMULATOR'}]});
};
// 60 actionable Service Requests; 45 PSC, 6 IMO overlap; 1 NMC
// approved referral on a PSC vessel: 106 source-verified pathways.
for(let i=0;i<60;i++)append(i,'SERVICE_REQUEST');
for(let i=0;i<45;i++)append(i<6?i:i+54,'PSC_PORT_CALL');
append(60,'NMC_CASE','APPROVED');
// Six UNVERIFIED input rows stay visible in the queue for human review.
for(let i=0;i<6;i++)append(i,'PSC_PORT_CALL','UNVERIFIED');
const vesselCandidates=Array.from({length:99},(_,n)=>({
 imo:imo(n),vesselName:'POC Vessel '+n,flag:flags.get(imo(n)),
 vesselType:'CARGO',departureAt:null,departureVerified:false,
 departureStatus:'MISSING',incidentHumanReviewed:false,
 incidentSeverity:null,currentRisk:{score:100-(n%80),level:'High',
   assessmentId:'SAVED-RISK-'+n,policyRevision:7},
 sourceTypes:[...new Set(candidates.filter(c=>c.imo===imo(n))
   .map(c=>c.events[0].sourceType))],
 regimes:[...new Set(candidates.filter(c=>c.imo===imo(n)).map(c=>c.regime))],
 sourceEvents:[],pendingWorkflows:1,createdWorkflows:0,scheduledWorkflows:0
}));
const dashboard={
 policy:{version:7,config:{
  ranking:{criteria:['DEPARTURE_SOON','INCIDENT_SEVERITY']},selection
 }},
 riskPolicyRevision:7,fleetSnapshotId:'POC-FLEET-99',
 candidates,vesselCandidates
};
test('100+ candidate paths remain in Candidate Center, but only verified paths reach C01',()=>{
 const source=buildC01Source(dashboard,{version:2});
 assert.equal(candidates.length,112);
 assert.equal(new Set(candidates.map(c=>c.imo)).size,99);
 assert.equal(source.candidates.length,106);
 assert.equal(new Set(source.candidates.map(c=>c.imo)).size,99);
 assert.equal(source.candidates.filter(c=>c.requiredInPlan).length,1);
 assert.equal(source.candidates.filter(c=>c.actionableServiceRequest).length,60);
 assert.equal(source.candidates.some(c=>c.sourceEvents.some(e=>
   e.approval==='UNVERIFIED')),false);
});
test('published Pool B small plan: service cap 4; total <=12; source backlog intact',()=>{
 const source=buildC01Source(dashboard,{version:2});
 const recommendations=source.candidates.map(c=>({
   candidateKey:c.candidateKey,imo:c.imo,regime:c.regime,
   recommendation:'SELECT_RECOMMENDED',confidence:0.9,
   reason:'Evidence-backed mock fixture only; source remains stored.',
   evidenceRefs:c.allowedEvidence.slice(0,1),dataGaps:[]
 }));
 const selected=projectC01ConfiguredSelection(source,recommendations);
 assert.equal(selected.serviceRequests.eligibleImos,60);
 assert.equal(selected.serviceRequests.cap,4);
 assert.equal(selected.serviceRequests.aiSelectedImos.length,4);
 assert.equal(selected.pscRisk.eligibleImos,44);
 assert.equal(selected.pscRisk.cap,4);
 assert.equal(selected.uaeFlag.eligibleImos,15);
 assert.equal(selected.uaeFlag.cap,3);
 assert.deepEqual(selected.mandatoryImos,[imo(60)]);
 assert.ok(selected.selectedImos.length<=12);
 assert.ok(selected.selectedImos.length>=1);
 assert.equal(selected.maxPlannedVessels,12);
 assert.equal(new Set(selected.selectedImos).size,selected.selectedImos.length);
 assert.ok(selected.serviceRequests.waitingInBacklogImos.length>=56);
 assert.equal(selected.approved,false);
 assert.equal(dashboard.candidates.length,112,'no source deletions');
 const plan=projectInspectionPlan(dashboard,source,{
   selectionProposal:selected,recommendations,agentRunId:'MOCK-POC',
   snapshotHash:source.snapshotHash
 });
 assert.equal(plan.filter(r=>r.planSelected).length,selected.selectedImos.length);
 assert.ok(plan.filter(r=>r.planSelected).every(r=>
   selected.selectedImos.includes(r.imo)));
 assert.equal(plan.find(r=>r.imo===imo(60)).planSelected,true,
   'approved NMC referral cannot be dropped');
 assert.equal(dashboard.candidates.length,112);
});
test('legacy published five-field selection remains readable until explicitly republished',()=>{
 const old={pscRiskRatePercent:10,uaeFlagRatePercent:25,
  uaePoolMode:'ELIGIBLE_CANDIDATES_ONLY',
  pscPoolMode:'PUBLISHED_PSC_SHORTLIST_ONLY',
  aiSelectionMode:'RECOMMEND_WITHIN_ELIGIBLE_QUOTAS'};
 const migrated=getSiSelectionPolicy({selection:old});
 assert.equal(migrated.serviceRequestPlanCap,null);
 assert.equal(migrated.maxPlannedVessels,null);
 assert.equal(getSiSelectionPolicy({selection}).serviceRequestPlanCap,4);
});
