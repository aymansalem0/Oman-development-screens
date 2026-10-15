import test from 'node:test';
import assert from 'node:assert/strict';
import {selectIntegratedPlanVessels,makeCapacityDraftPlan,
 validateIntegratedCapacityProposal} from '../si-integrated-capacity-plan.mjs';

const plan={id:'00000001-0000-4000-8000-000000000000',
 status:'READY_FOR_APPROVAL',revision:3,
 selectionSourceHash:'s'.repeat(64)};
const sample=[
 {imo:'9400101',flag:'PANAMA',sources:['PSC_PORT_CALL'],
  risk:{score:85,level:'HIGH'},mandatory:false},
 {imo:'9400102',flag:'UAE',sources:['PSC_PORT_CALL'],
  risk:{score:65,level:'WATCH'},mandatory:false},
 {imo:'9400103',flag:'PANAMA',sources:['PSC_PORT_CALL'],
  risk:null,mandatory:false},
 {imo:'9400104',flag:'PANAMA',sources:['PSC_PORT_CALL'],
  risk:{score:11,level:'NORMAL'},mandatory:false},
 {imo:'9400105',flag:'UNITED ARAB EMIRATES',sources:['SERVICE_REQUEST'],
  risk:null,mandatory:false},
 {imo:'9400106',flag:'LIBERIA',sources:['NMC_CASE'],
  risk:null,mandatory:true}
];
const rows=sample.map((v,i)=>({
 imo:v.imo,vesselName:'Vessel '+v.imo,
 flag:v.flag,risk:v.risk,sources:v.sources,editable:true,
 mandatoryReferral:v.mandatory,requiredInPlan:v.mandatory,
 selectionOrigin:i===5?'PUBLISHED_SOURCE_RULE':'AI_ADVISORY',
 planSelected:v.mandatory,effectiveRank:i+1,
 disposition:'AVAILABLE',rankingGroup:2
}));
const inspectionPlan={planId:plan.id,revision:plan.revision,
 sourceHash:plan.selectionSourceHash,rows,stale:false};
const dashboard={
 vesselCandidates:sample.map(v=>({
  imo:v.imo,flag:v.flag,sourceTypes:v.sources,
  vesselName:'Vessel '+v.imo,currentRisk:v.risk
 })),
 candidates:sample.map(v=>({
  imo:v.imo,key:'KEY-'+v.imo,
  status:'PENDING_REVIEW',
  regime:v.sources.includes('PSC_PORT_CALL')?
   'PORT_STATE_CONTROL':'UAE_SERVICE_INSPECTION',
  events:v.sources.map((sourceType,i)=>({
   sourceType,eventKey:'EVENT-'+v.imo+'-'+i,
   sourceEventId:'ID-'+v.imo,
   sourceReference:'REF-'+v.imo,
   approval:'SOURCE_FINAL',evidenceIds:['EVD-'+v.imo],
   contextNote:'Saved source fact '+v.imo
  }))
 }))
};
const select=(psc=50,uae=100)=>selectIntegratedPlanVessels({
 plan,inspectionPlan,dashboard,pscRiskRatePercent:psc,
 uaeFlagRatePercent:uae
});
test('two independent denominators select PSC via saved risk and UAE flag on its own, plus compulsory NMC',()=>{
 const out=select();
 assert.equal(out.quotas.pscRisk.eligibleImos,4);
 assert.equal(out.quotas.pscRisk.targetedImos,2);
 assert.deepEqual(out.quotas.pscRisk.selectedImos,['9400101','9400102']);
 assert.equal(out.quotas.uaeFlag.eligibleImos,2);
 assert.equal(out.quotas.uaeFlag.targetedImos,2);
 assert.deepEqual(out.quotas.overlapImos,['9400102']);
 assert.equal(out.roster.length,4);
 assert.equal(new Set(out.roster.map(x=>x.imo)).size,4);
 assert.deepEqual(out.mandatoryImos,['9400106']);
 assert.ok(out.roster.every(x=>x.inspectionReasons.length===1));
 assert.ok(out.roster.every(x=>x.inspectionReasons[0].evidenceIds.length));
 assert.equal(out.advisoryOnly,true);
 assert.equal(plan.status,'READY_FOR_APPROVAL','pure selection cannot approve');
});
test('factor changes alter selectionHash and preserve source revision',()=>{
 const a=select(50,100),b=select(75,100);
 assert.notEqual(a.selectionHash,b.selectionHash);
 assert.equal(a.planRevision,3);
 const draft=makeCapacityDraftPlan(plan,a);
 assert.equal(draft.capacityDraftOnly,true);
 assert.equal(draft.status,'APPROVED','scheduler compatibility is IN-MEMORY only');
 assert.equal(plan.status,'READY_FOR_APPROVAL');
});
test('verified option must not silently drop a compulsory NMC referral',()=>{
 const out=select();
 const assignments=out.roster.filter(v=>v.imo!=='9400106')
  .map(v=>({imo:v.imo}));
 const proposal={proposalHash:'a'.repeat(64),erpSnapshotId:'ERP-A',
  variants:[{optionId:'PLAN-A',assignments,
   allocatedVessels:assignments.length,rows:out.roster.map(v=>({
    imo:v.imo,status:assignments.some(a=>a.imo===v.imo)?
     'PROPOSED':'UNSCHEDULED',blocker:'NO_FEASIBLE_SLOT'
   }))}]};
 assert.throws(()=>validateIntegratedCapacityProposal(out,proposal,'PLAN-A'),
  /SI_INTEGRATED_MANDATORY_OR_CAPACITY_UNRESOLVED/);
});
test('feasible subset excludes optional candidates without cancelling or creating cases',()=>{
 const out=select();
 const assignments=out.roster.filter(v=>v.imo!=='9400105')
  .map(v=>({imo:v.imo}));
 const proposal={proposalHash:'b'.repeat(64),erpSnapshotId:'ERP-A',
  variants:[{optionId:'PLAN-B',assignments,
   allocatedVessels:assignments.length,rows:out.roster.map(v=>({
    imo:v.imo,status:assignments.some(a=>a.imo===v.imo)?
     'PROPOSED':'UNSCHEDULED',blocker:'GLOBAL_PLAN_CONFLICT_OR_CAPACITY'
   }))}]};
 const decision=validateIntegratedCapacityProposal(out,proposal,'PLAN-B');
 assert.equal(decision.selected.length,3);
 assert.deepEqual(decision.rejected.map(v=>v.imo),['9400105']);
 assert.equal(decision.rejected[0].status,'NOT_INCLUDED_CAPACITY_LIMITED');
 assert.deepEqual(decision.selected.map(v=>v.planRank),[1,2,3]);
});
test('invalid rates and stale source data fail closed',()=>{
 assert.throws(()=>select(-1,10),/SI_INTEGRATED_PERCENT_INVALID/);
 assert.throws(()=>select(10,101),/SI_INTEGRATED_PERCENT_INVALID/);
 assert.throws(()=>selectIntegratedPlanVessels({
  plan,inspectionPlan:{...inspectionPlan,stale:true},dashboard,
  pscRiskRatePercent:50,uaeFlagRatePercent:100
 }),/SI_INTEGRATED_PLAN_SOURCE_STALE_REVIEW/);
});

test('published verified C01 IMO selection overrides deterministic PSC fallback and excludes mandatory from optional caps',()=>{
 const ai={aiSelectionValidated:true,snapshotHash:inspectionPlan.sourceHash,
  policyRevision:8,
  pscRisk:{aiSelectedImos:['9400104'],cap:2},
  uaeFlag:{aiSelectedImos:['9400105'],cap:1}};
 const result=selectIntegratedPlanVessels({
  plan,inspectionPlan:{...inspectionPlan,agentRunId:'C01-verified',
   selectionProposal:ai},dashboard,
  pscRiskRatePercent:50,uaeFlagRatePercent:100});
 assert.equal(result.quotas.selectionMethod,'VERIFIED_C01_AI_WITH_PUBLISHED_QUOTAS');
 assert.equal(result.quotas.aiAgentRunId,'C01-verified');
 assert.deepEqual(result.quotas.pscRisk.selectedImos,['9400104']);
 assert.deepEqual(result.quotas.uaeFlag.selectedImos,['9400105']);
 assert.equal(result.roster.some(v=>v.imo==='9400101'),false,
  'high risk without C01 model recommendation is NOT silently filled in');
 assert.deepEqual(new Set(result.roster.map(v=>v.imo)),
  new Set(['9400104','9400105','9400106']));
 assert.equal(result.quotas.pscRisk.eligibleImos,4);
 assert.equal(result.quotas.uaeFlag.eligibleImos,2);
 assert.equal(result.quotas.mandatoryOrManual.count,1);
});
