import test from 'node:test';
import assert from 'node:assert/strict';
import {selectIntegratedPlanVessels,makeCapacityDraftPlan,
 scopeIntegratedSelectionToSavedDraft,savedDraftCapacityCoverage,
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
   approval:sourceType==='NMC_CASE'?'APPROVED':'SOURCE_FINAL',
   evidenceIds:['EVD-'+v.imo],
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

test('current published small-plan C01 uses the AI service queue sample rather than all 60 requests',()=>{
 const ai={aiSelectionValidated:true,snapshotHash:inspectionPlan.sourceHash,
  policyRevision:9,
  pscRisk:{eligibleImos:4,cap:2,aiSelectedImos:['9400104'],missingRisk:1},
  uaeFlag:{eligibleImos:2,cap:2,aiSelectedImos:['9400105']},
  serviceRequests:{eligibleImos:60,cap:4,
   aiSelectedImos:['9400105'],waitingInBacklogImos:Array.from({length:59},
    (_,n)=>String(9500000+n))},
  maxPlannedVessels:12,overlappingImos:['9400105']};
 const result=selectIntegratedPlanVessels({plan,
  inspectionPlan:{...inspectionPlan,agentRunId:'C01-PROPOSAL',
   selectionProposal:ai},dashboard,
  pscRiskRatePercent:50,uaeFlagRatePercent:100});
 assert.deepEqual(result.quotas.serviceRequests.selectedImos,['9400105']);
 assert.equal(result.quotas.serviceRequests.planCap,4);
 assert.equal(result.quotas.serviceRequests.eligibleImos,60);
 assert.equal(result.quotas.serviceRequests.pendingInCandidateBacklog,59);
 assert.equal(result.quotas.maxPlannedVessels,12);
 assert.deepEqual(new Set(result.roster.map(v=>v.imo)),
   new Set(['9400104','9400105','9400106']));
 assert.equal(plan.status,'READY_FOR_APPROVAL');
 assert.throws(()=>selectIntegratedPlanVessels({plan,
  inspectionPlan:{...inspectionPlan,agentRunId:'C01-PROPOSAL',
   selectionProposal:{...ai,maxPlannedVessels:2}},dashboard,
  pscRiskRatePercent:50,uaeFlagRatePercent:100}),
  /SI_POC_PLAN_MAX_VESSELS_EXCEEDED_OFFICER_REVIEW/);
});

test('saved capacity Draft approves its 2 selected vessels, not all 4 original C01/PSC nominees',()=>{
 const full=select();
 assert.equal(full.roster.length,4);
 const selectedImos=['9400101','9400106'];
 const saved={...plan,capacityDraft:{
  status:'CAPACITY_VERIFIED_DRAFT',
  sourceHash:inspectionPlan.sourceHash,
  c01SelectedImos:full.roster.map(v=>v.imo),
  selectedImos,
  capacityExcluded:[{imo:'9400102',reasonCode:'ENGINEER_UNAVAILABLE'}]
 }};
 const scoped=scopeIntegratedSelectionToSavedDraft(full,saved);
 assert.equal(scoped.draftScope.locked,true);
 assert.equal(scoped.draftScope.c01OriginallySelectedCount,4);
 assert.equal(scoped.roster.length,2);
 assert.deepEqual(new Set(scoped.roster.map(v=>v.imo)),new Set(selectedImos));
 assert.deepEqual(scoped.roster.map(v=>v.planRank),[1,2]);
 assert.equal(scoped.quotas.pscRisk.targetedImos,full.quotas.pscRisk.targetedImos,
  'retain source C01 quota/audit, even though Draft has fewer vessels');
 assert.notEqual(scoped.selectionHash,full.selectionHash);
 const proposal={proposalHash:'c'.repeat(64),erpSnapshotId:'ERP-V',
  variants:[{optionId:'EXACT',allocatedVessels:2,
   assignments:scoped.roster.map(v=>({imo:v.imo})),
   rows:scoped.roster.map(v=>({imo:v.imo,status:'PROPOSED',blocker:null}))}]};
 const decision=validateIntegratedCapacityProposal(scoped,proposal,'EXACT');
 assert.deepEqual(new Set(decision.selected.map(v=>v.imo)),new Set(selectedImos));
 assert.equal(saved.capacityDraft.selectedImos.length,2,
  'source Oracle draft was not changed by the pure validation');
 assert.equal(saved.status,'READY_FOR_APPROVAL');
});
test('scope verifier blocks newly feasible overflow vessels without modifying the saved Draft',()=>{
 const full=select();
 const saved={...plan,capacityDraft:{
  status:'CAPACITY_VERIFIED_DRAFT',sourceHash:full.sourceHash,
  selectedImos:['9400101','9400106'],
  c01SelectedImos:full.roster.map(v=>v.imo)
 }};
 const scoped=scopeIntegratedSelectionToSavedDraft(full,saved);
 const extra=savedDraftCapacityCoverage(scoped,{
  assignments:[{imo:'9400101'},{imo:'9400106'},{imo:'9400102'}]});
 assert.equal(extra.matches,false);
 assert.deepEqual(extra.unexpectedImos,['9400102']);
 assert.equal(extra.missingImos.length,0);
 const changed=savedDraftCapacityCoverage(scoped,{
  assignments:[{imo:'9400106'}]});
 assert.equal(changed.matches,false);
 assert.deepEqual(changed.missingImos,['9400101']);
 const okay=savedDraftCapacityCoverage(scoped,{
  assignments:[{imo:'9400106'},{imo:'9400101'}]});
 assert.equal(okay.matches,true,'inspector/time alternative may change, roster may not');
});
test('source-selected shortlist changes, missing mandatory NMC, or stale capacity fail closed',()=>{
 const full=select();
 const good={...plan,capacityDraft:{
  status:'CAPACITY_VERIFIED_DRAFT',sourceHash:full.sourceHash,
  selectedImos:['9400106'],
  c01SelectedImos:full.roster.map(v=>v.imo)
 }};
 assert.equal(scopeIntegratedSelectionToSavedDraft(full,good).roster.length,1);
 assert.throws(()=>scopeIntegratedSelectionToSavedDraft(full,{
  ...good,capacityDraft:{...good.capacityDraft,selectedImos:['9400101']}}),
  /SI_DRAFT_SAVED_VESSELS_REQUIRE_REVIEW/);
 assert.throws(()=>scopeIntegratedSelectionToSavedDraft(full,{
  ...good,capacityDraft:{...good.capacityDraft,c01SelectedImos:['9400106']}}),
  /SI_DRAFT_C01_SCOPE_CHANGED_REVIEW_REQUIRED/);
 assert.throws(()=>scopeIntegratedSelectionToSavedDraft(full,{
  ...good,capacityDraft:{...good.capacityDraft,status:
   'STALE_AFTER_DRAFT_EDIT_RECALCULATE_CAPACITY'}}),
  /SI_DRAFT_CAPACITY_STALE_RECALCULATE_REQUIRED/);
 assert.throws(()=>scopeIntegratedSelectionToSavedDraft(full,{
  ...good,capacityDraft:{...good.capacityDraft,
   status:'CAPACITY_EXCEPTION_DRAFT'}}),
  /SI_DRAFT_CAPACITY_EXCEPTIONS_RESOLVE_BEFORE_APPROVAL/);
 const legacy=scopeIntegratedSelectionToSavedDraft(full,plan);
 assert.equal(legacy,full,'legacy no-capacity draft stays supported');
});
