/**
 * End-to-end MOCK/UAT smoke test of the actual targeting repository pipeline:
 * source event -> candidate gate -> preview -> publish -> C01 request ->
 * verified AI shortlist -> draft plan -> stale-policy protection.
 * TEMP JSON STORE ONLY: NO ORACLE, NO AIRIA, NO INSPECTION APPROVAL.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {SiCandidateTargeting,SI_SELECTION_POLICY_DEFAULT}
  from '../si-candidate-targeting.mjs';
import {SiCandidateAgent} from '../si-candidate-agent.mjs';
import {mockSiC01} from '../si-agent-mock.mjs';
import {projectInspectionPlan} from '../si-inspection-plan.mjs';

const imos=['9400101','9400102','9400103','9400104','9400105','9400106'];
const flags=['PANAMA','UAE','LIBERIA','BAHAMAS','UNITED ARAB EMIRATES','LIBERIA'];
const bundles=imos.map((imo,i)=>({imo,
 inlineContext:{vessel:{name:'UAT Vessel '+(i+1),flag:flags[i],vesselType:'CARGO'}}}));
const riskScores=new Map([
 ['9400101',90],['9400102',70],['9400103',50]
]);
const published={
 ranking:{criteria:['DEPARTURE_SOON','INCIDENT_SEVERITY']},
 aiAdvisory:{
   selectionSignals:['SOURCE_EVENT_EVIDENCE','SAVED_VESSEL_RISK'],
   minimumSelectionConfidence:0.75,
   selectionInstructions:'Select source-eligible candidates within independent published quotas.',
   priorityInstructions:'Explain missing verified ETD and reviewed incident.'
 },
 selection:{...SI_SELECTION_POLICY_DEFAULT,
   pscRiskRatePercent:50,uaeFlagRatePercent:100}
};
const referrals=[{
 id:'d311aaa0-5bde-4ae1-b44c-000000000001',
 caseId:'d311aaa0-5bde-4ae1-b44c-000000000002',
 imo:'9400106',status:'PENDING_SCHEDULING',caseStatus:'IN_PROGRESS',
 createdAt:'2026-10-15T00:00:00Z',reason:'Approved NMC referral for mock UAT',
 evidenceIds:['NMC-UAT-EVIDENCE'],sourceAssessmentId:'NMC-UAT-SAVED-ASSESSMENT'
}];
test('MOEI Pool B UAT: published selection policy drives SI-C01 selection and plan, never approvals',async()=>{
 const folder=mkdtempSync(join(tmpdir(),'moei-c01-uat-'));
 let aiCalls=0;
 try{
   const targeting=new SiCandidateTargeting({
     mode:'json',file:join(folder,'uat-targeting.json'),bundles,
     cases:{listInspectionRequests:async()=>referrals},
     riskPolicy:{ready:true,projectCurrent:async()=>({
       policyRevision:7,projections:[...riskScores].map(([imo,riskScore])=>({
         imo,riskScore,riskLevel:'HIGH',
         sourceAssessmentId:'SAVED-RISK-'+imo,policyRevision:7
       }))
     })}
   });
   const pscKeys=new Set();
   for(const imo of imos.slice(0,4)){
     const item=await targeting.receiveEvent({
       sourceType:'PSC_PORT_CALL',sourceEventId:'UAT-PSC-'+imo,
       sourceReference:'UAT-PC-'+imo,imo,requestedRegime:'PORT_STATE_CONTROL',
       port:'Jebel Ali',sourceApprovalStatus:'SOURCE_FINAL',
       provenance:'POC_SIMULATOR',createdBy:'MOEI UAT Test',
       evidenceIds:['PSC-EVIDENCE-'+imo]
     });
     pscKeys.add(item.event.eventKey);
   }
   // In production the PSC source gate is a separately published selection.
   targeting.pscSelection={selectedEventKeys:async()=>pscKeys};
   await targeting.receiveEvent({
     sourceType:'SERVICE_REQUEST',sourceEventId:'UAT-SVC-9400105',
     sourceReference:'UAT-SVC-REQUEST',imo:'9400105',
     requestedRegime:'UAE_SERVICE_INSPECTION',port:'Jebel Ali',
     sourceApprovalStatus:'SOURCE_REVIEWED',provenance:'POC_SIMULATOR',
     evidenceIds:['SVC-EVIDENCE-9400105'],createdBy:'MOEI UAT Test'
   });
   const initial=await targeting.dashboard();
   assert.equal(initial.summary.candidateVessels,6);
   assert.equal(initial.summary.inspectionsCreated,0);
   assert.equal(initial.policy.version,1);
   assert.equal(initial.policy.config.selection,undefined,
     'new selection policy is opt-in; initial setup cannot silently impose quotas');
   // The published PSC event gate MUST prevent unselected raw Port Calls.
   const pscEvents=await targeting.receiveEvent({
     sourceType:'PSC_PORT_CALL',sourceEventId:'UAT-UNSELECTED-PSC',
     sourceReference:'UAT-UNSELECTED',imo:'9400101',
     requestedRegime:'PORT_STATE_CONTROL',port:'Jebel Ali',
     sourceApprovalStatus:'SOURCE_FINAL',provenance:'POC_SIMULATOR',
     evidenceIds:['NON-SELECTED-EVIDENCE'],createdBy:'MOEI UAT Test'
   });
   assert.equal(pscKeys.has(pscEvents.event.eventKey),false);
   assert.equal((await targeting.dashboard()).candidates.length,6,
     'raw PSC events outside published gate never enter SI-C01');
   const agent=new SiCandidateAgent({
     targeting,pscPolicy:async()=>({version:4}),
     provider:'mock',executeAgent:async payload=>{
       aiCalls++;
       assert.equal(payload.schemaVersion,'SI-C01-v1');
       assert.equal(payload.configuredSelectionPolicy.pscRiskRatePercent,50);
       assert.equal(payload.configuredSelectionPolicy.uaeFlagRatePercent,100);
       assert.equal(payload.configuredSelectionPolicy.eligibleSelectionPool.pscEligibleImos,4);
       assert.equal(payload.configuredSelectionPolicy.eligibleSelectionPool.uaeEligibleImos,2);
       assert.equal(payload.configuredSelectionPolicy.eligibleSelectionPool.serviceRequestEligibleImos,1);
       assert.equal(payload.configuredSelectionPolicy.eligibleSelectionPool.serviceRequestPlanCap,1);
       assert.equal(payload.configuredSelectionPolicy.eligibleSelectionPool.maxPlannedVessels,12);
       assert.equal(payload.configuredSelectionPolicy.eligibleSelectionPool.mandatoryOutsideCaps,1);
       assert.ok(payload.candidates.every(c=>c.allowedEvidence.length>0));
       return mockSiC01(payload);
     }
   });
   const oldPreview=await agent.preview();
   assert.equal(oldPreview.externalCalls,0);
   const impact=await targeting.previewRules(published);
   assert.equal(impact.selectionImpact.candidatePoolImos,6);
   assert.equal(impact.selectionImpact.pscEligibleImos,4);
   assert.equal(impact.selectionImpact.pscTargetImos,2);
   assert.equal(impact.selectionImpact.uaeEligibleImos,2);
   assert.equal(impact.selectionImpact.serviceEligibleImos,1);
   assert.equal(impact.selectionImpact.serviceTargetImos,1);
   assert.equal(impact.selectionImpact.maxPlannedVessels,12);
   assert.equal(impact.selectionImpact.uaeTargetImos,2);
   assert.equal(impact.selectionImpact.mandatoryImos,1);
   assert.equal((await targeting.policy()).version,1,
     'impact preview must not publish');
   const next=await targeting.publishRules({
     config:published,expectedVersion:1,publishedBy:'UAT Supervisor',
     reason:'Approve test selection percentage settings'
   });
   assert.equal(next.version,2);
   await assert.rejects(agent.run({
     actor:'UAT Supervisor',confirmRun:true,
     expectedSnapshotHash:oldPreview.snapshotHash
   }),/SI_C01_SOURCE_CHANGED_REPREVIEW/);
   assert.equal(aiCalls,0,'stale policy may not invoke AI');
   const fresh=await agent.preview();
   assert.equal(fresh.selectionPolicy.uaePoolMode,'ELIGIBLE_CANDIDATES_ONLY');
   assert.equal(fresh.policyRevision,2);
   assert.equal(fresh.eligibleCount,6);
   const output=await agent.run({
     actor:'UAT Supervisor',confirmRun:true,
     expectedSnapshotHash:fresh.snapshotHash
   });
   assert.equal(aiCalls,1);
   assert.equal(output.mock,true);
   assert.equal(output.externalCalls,0);
   assert.equal(output.mutations,false);
   assert.equal(output.humanDecisionRequired,true);
   assert.equal(output.selectionProposal.policyRevision,2);
   assert.deepEqual(output.selectionProposal.pscRisk.aiSelectedImos,
     ['9400101','9400102']);
   assert.deepEqual(output.selectionProposal.uaeFlag.aiSelectedImos,['9400102','9400105']);
   assert.deepEqual([...output.selectionProposal.overlappingImos].sort(),['9400102','9400105']);
   assert.deepEqual(output.selectionProposal.serviceRequests.aiSelectedImos,['9400105']);
   assert.deepEqual([...output.selectionProposal.mandatoryImos].sort(),
     ['9400106']);
   assert.deepEqual([...output.selectionProposal.selectedImos].sort(),
     ['9400101','9400102','9400105','9400106']);
   const inspected=projectInspectionPlan(
     await targeting.dashboard(),await agent.source(),output);
   assert.equal(inspected.filter(x=>x.planSelected).length,4);
   assert.ok(inspected.filter(x=>x.planSelected)
     .every(x=>x.editable&&x.evidenceRefs.length>0));
   assert.equal((await targeting.dashboard()).summary.inspectionsCreated,0);
   assert.equal((await targeting.inspectionCaseRegistry()).cases.length,0);
   assert.equal((await targeting.policy()).version,2);
   // Previously generated results cannot survive a later policy publication.
   await targeting.publishRules({
     config:{...published,selection:{...published.selection,pscRiskRatePercent:25}},
     expectedVersion:2,publishedBy:'UAT Supervisor',
     reason:'Modify published selection rate for stale-policy regression'
   });
   const newer=await agent.preview();
   assert.notEqual(newer.snapshotHash,fresh.snapshotHash);
   assert.equal(newer.latest.isStale,true);
   assert.equal(aiCalls,1,'policy re-publication never runs AI automatically');
 }finally{
   rmSync(folder,{force:true,recursive:true,maxRetries:12,retryDelay:100});
 }
});
