import test from 'node:test';
import assert from 'node:assert/strict';
import {
 validateDraftMetadata,contextToRequests,reportDraftPeriodExceptions,
 buildIntegratedDraft,publicDraftPreview
} from '../si-integrated-draft-creation.mjs';

const metadata={title:'Inspection capacity plan',startsOn:'2026-10-16',
 endsOn:'2026-10-22',notes:'POC integrated plan',demoMode:true};
const dayMs=Date.parse('2026-10-15T10:00:00Z');
const imo='9412001';
const event={sourceType:'NMC_CASE',eventKey:'EVENT-'+imo,
 sourceEventId:'REF-NMC-1',sourceReference:'CASE-NMC-1',
 approval:'APPROVED',contextNote:'Approved NMC inspection referral',
 evidenceIds:['EVIDENCE-'+imo]};
const record={imo,vesselName:'Synthetic vessel',flag:'AE',
 vesselType:'Cargo',sourceTypes:['NMC_CASE'],regimes:['FOCUSED_INSPECTION'],
 sourceEvents:[event],pendingWorkflows:1,createdWorkflows:0,
 scheduledWorkflows:0,departureVerified:false,incidentHumanReviewed:false};
const dashboard={policy:{version:4},vesselCandidates:[record],
 candidates:[{imo,key:'K-'+imo,status:'PENDING_REVIEW',
  regime:'FOCUSED_INSPECTION',events:[event]}]};
const source={snapshotHash:'a'.repeat(64),selectionPolicyActive:true,
 selection:{pscRiskRatePercent:0,uaeFlagRatePercent:0,
  maxPlannedVessels:12,serviceRequestPlanCap:4},
 riskPolicyRevision:1,
 candidates:[{candidateKey:'K-'+imo,imo,regime:'FOCUSED_INSPECTION',
  requiredInPlan:true,sourceTypes:['NMC_CASE'],sourceEvents:[event],
  currentRisk:null}]};
const ai={agentRunId:'AI-RUN',provider:'MOCK',mock:true,
 recommendations:[{candidateKey:'K-'+imo,imo,
  recommendation:'SELECT_RECOMMENDED',confidence:0.9,
  reason:'Approved maritime NMC inspection referral with evidence.',
  evidenceRefs:['EVIDENCE-'+imo],dataGaps:[]}],
 selectionProposal:{aiSelectionValidated:true,snapshotHash:source.snapshotHash,
  policyRevision:4,maxPlannedVessels:12,
  pscRisk:{eligibleImos:0,cap:0,aiSelectedImos:[]},
  uaeFlag:{eligibleImos:0,cap:0,aiSelectedImos:[]},
  serviceRequests:{eligibleImos:0,cap:4,aiSelectedImos:[],
   waitingInBacklogImos:[]},overlappingImos:[],
  selectedRows:[{imo,selectionBasis:['PROTECTED_NMC_REFERRAL'],
   evidenceRefs:['EVIDENCE-'+imo]}]}};
const erpSnapshot={snapshotId:'ERP-POC-SAVED',
 data:{Ports:[{port_id:'PORT1',port_name:'POC Port',active:'Y',
   window_start:'06:00',window_end:'23:00'}],Inspectors:[],
  Inspector_Ports:[],Qualifications:[],Shifts:[],Leaves:[],Blackouts:[],
  Bookings:[],Travel_Matrix:[]}};
const scheduler={buildOptions(input,{snapshot}){
 const p=snapshot.data.Inspectors[0];
 const at=Date.parse(input.earliestLocal.replace(' ','T')+':00+04:00');
 const end=at+input.durationMinutes*60000;
 const local=x=>new Date(x+4*3600000).toISOString().slice(0,16).replace('T',' ');
 return {options:[{optionId:'OPT-1',inspectorId:p.inspector_id,
  inspectorName:p.display_name,portId:'PORT1',portName:'POC Port',
  startUtc:new Date(at).toISOString(),endUtc:new Date(end).toISOString(),
  startLocal:local(at),endLocal:local(end),score:80,travelMinutes:0,
  crossPort:false,originPortName:'POC Port'}],exclusions:[]};
}};
const policy={revision:1,config:{maxDailyInspections:5,travelBufferMinutes:0}};
const build=()=>buildIntegratedDraft({id:'00000000-0000-4000-8000-000000000011',
 metadata,source,dashboard,ai,erpSnapshot,
 actor:{username:'poc.operator',displayName:'POC Operator'},
 policy,nmcReferrals:[{id:'REF-NMC-1',imo,
  status:'PENDING_SCHEDULING',caseStatus:'OPEN'}],scheduler,
 clock:()=>dayMs});

test('metadata is validated before running paid C01',()=>{
 assert.deepEqual(validateDraftMetadata(metadata),metadata);
 for(const invalid of [
  {...metadata,title:''},{...metadata,startsOn:'2026-02-30'},
  {...metadata,endsOn:'2026-10-14'}, {...metadata,demoMode:'true'}
 ])assert.throws(()=>validateDraftMetadata(invalid),/SI_DRAFT_PARAMETERS_INVALID/);
});
test('pre-draft integrated engine preserves source decisions without an official booking',()=>{
 const x=build(),publicView=publicDraftPreview(x,'PREVIEW1');
 assert.equal(x.selection.roster.length,1);
 assert.deepEqual(x.selection.mandatoryImos,[imo]);
 assert.equal(x.sourceHash,source.snapshotHash);
 assert.equal(x.ai.agentRunId,'AI-RUN');
 assert.equal(x.metadata.demoMode,true);
 assert.equal(publicView.candidateCount,1);
 assert.equal(publicView.selectedCount,1);
 assert.equal(publicView.feasibleCount,1,
  'qualified POC engineer must be matched before first draft is saved');
 assert.equal(x.ready,true,'capacity verified plan must be ready for a separate human approval');
 assert.equal(publicView.noWrites,true);
 assert.equal(publicView.noCaseCreation,true);
 assert.equal(publicView.noOfficialBooking,true);
 assert.equal(publicView.visitRequests.length,1);
 assert.equal(publicView.items[0].imo,imo);
 assert.ok(publicView.items[0].sourceTypes.includes('NMC_CASE'));
});
test('source-final ETA/ETD is never synthesized in client scheduling request',()=>{
 const req=contextToRequests({items:[{
  imo,vesselType:'CARGO',regime:'FOCUSED',portId:'PORT1',
  locationType:'BERTH',locationName:'Berth 1',siteAccessConfirmed:true,
  durationMinutes:120,etaLocal:'2026-10-16 06:00',
  etdLocal:'2026-10-16 18:00',earliestLocal:'',
  latestFinishLocal:'',dateEvidenceReference:'MSW-EVID-1',
  windowSource:'POC_DEMO',windowEvidenceReference:'MOCK-WIN'
 }]})[0];
 assert.equal(req.earliestLocal,'2026-10-16 06:00');
 assert.equal(req.latestFinishLocal,'2026-10-16 18:00');
 assert.equal(req.windowSource,'MSW_FINAL');
 assert.equal(req.windowEvidenceReference,'MSW-EVID-1');
});
test('visit outside the requested draft period cannot mark plan capacity ready',()=>{
 const bad=reportDraftPeriodExceptions({variants:[{assignments:[
  {imo,startLocal:'2026-10-25 10:00',endLocal:'2026-10-25 12:00'}
 ]}]},metadata);
 assert.deepEqual(bad,[imo]);
});
test('capacity rejects a C01 result that is not bound to the source snapshot',()=>{
 assert.throws(()=>buildIntegratedDraft({id:'P',metadata,source,dashboard,
  ai:{...ai,selectionProposal:{...ai.selectionProposal,snapshotHash:'stale'}},
  erpSnapshot,policy,scheduler}),/SI_C01_CONFIGURED_SELECTION_REQUIRED_RUN_AI/);
});
