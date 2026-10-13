import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSiAiriaRequest,validateSiAiriaReply,runSiAiriaAdvisor}
 from '../si-airia-workflow-advisors.mjs';

const cid='b221f1fa-7fea-47f4-b513-08e21e63ce62';
const rid='ref-001';
const view=()=>({inspectionCase:{id:cid,imo:'9328471',nmcReferralId:rid,
    inspectionReasons:[{sourceReference:'NMC-SAVED-001'}]},
  preparation:{provenance:'BASE-CHECKLIST-1'},
  record:{version:12,stage:'REPORT_PENDING_REVIEW',
    checks:[{id:'fire-safety',evidenceRefs:['EV-01']}],
    findings:[{id:'F-fire-safety',checkId:'fire-safety',description:'Inspected fire door failed to close fully',
      status:'CONFIRMED_BY_INSPECTOR',severity:'MAJOR',evidenceRefs:['EV-01']}]}
});
test('real report agent receives saved confirmed findings and returns draft only',async()=>{
 const source=view(),before=structuredClone(source),calls=[];
 const r=await runSiAiriaAdvisor({agentCode:'SI-R01',caseId:cid},source,{
  executeAgent:async(id,body)=>{
    calls.push([id,body]);
    return {response:{inspectionCaseId:cid,sourceCaseVersion:12,
      status:'DRAFT',summary:'Inspector recorded a door closure defect.',
      findings:[{findingId:'F-fire-safety',summary:'Door closure requires inspection',
        evidenceRefs:['EV-01']}],
      correctiveActionDrafts:[{findingId:'F-fire-safety',
        text:'Review the recorded defect and prepare a verified repair plan.',
        evidenceRefs:['EV-01'],requiresSupervisorInput:true}],
      nmcReturnSummary:'Inspector-confirmed evidence requires follow up.',
      requiresSupervisorApproval:true,officialRiskScore:null}};
  }});
 assert.equal(calls.length,1);
 assert.equal(calls[0][0],'r01');
 assert.equal(calls[0][1].confirmedChecks[0].inspectorConfirmed,true);
 assert.equal(r.provider,'AIRIA');
 assert.equal(r.draft.aiGenerated,true);
 assert.equal(r.draft.autoIssued,false);
 assert.equal(r.caseMutations,0);
 assert.deepEqual(source,before);
});
test('R01 fails if provider invents finding/evidence or changes official score',()=>{
 const ctx=buildSiAiriaRequest('SI-R01',view());
 const common={inspectionCaseId:cid,sourceCaseVersion:12,
   requiresSupervisorApproval:true,summary:'Review confirmed deficiency.',
   findings:[],correctiveActionDrafts:[]};
 assert.throws(()=>validateSiAiriaReply('SI-R01',{
    result:{...common,officialRiskScore:87}},ctx),/SI_R01_AIRIA_CONTRACT_INVALID/);
 assert.throws(()=>validateSiAiriaReply('SI-R01',{
   result:{...common,findings:[{findingId:'FABRICATED',evidenceRefs:['EV-01']}]}
 },ctx),/SI_R01_UNCONFIRMED_FINDING_IN_OUTPUT/);
});
test('S01 only ranks real non-expired deterministic options and never books',()=>{
 const proposal={status:'PROPOSED',erpSnapshotId:'ERP-SAVED',policyRevision:3,
   expiresAt:new Date(Date.now()+600000).toISOString(),referral:{id:rid,imo:'9328471'},
   input:{sourceLevel:'High',portId:'AEJEA',durationMinutes:180,vesselType:'CARGO'},
   options:[{optionId:'OPTION-1',inspectorId:'INSP-1',score:91,startUtc:'2026-10-15T09:00:00Z',
    endUtc:'2026-10-15T12:00:00Z',startLocal:'2026-10-15 13:00',
    portId:'AEJEA',travelMinutes:0,approval:'MANUAL_APPROVAL_REQUIRED'}]};
 const ctx=buildSiAiriaRequest('SI-S01',view(),{proposal});
 const out={slotSetHash:ctx.request.currentSnapshot.slotSetHash,
   bookingConfirmed:false,rankedOptions:[{optionId:'OPTION-1',rank:1,
    confidence:0.9,rationale:'Qualified saved inspector and the earliest feasible proposal.',
    evidenceRefs:['ERP-SAVED']}]};
 assert.equal(validateSiAiriaReply('SI-S01',{response:out},ctx).advice.length,1);
 assert.throws(()=>validateSiAiriaReply('SI-S01',{response:{
  ...out,rankedOptions:[{...out.rankedOptions[0],optionId:'INVENTED'}]}},ctx),
  /SI_S01_AIRIA_CONTRACT_INVALID/);
 assert.throws(()=>buildSiAiriaRequest('SI-S01',view(),{proposal:{
  ...proposal,expiresAt:'2020-01-01T00:00:00Z'}}),
 /SI_S01_FRESH_FEASIBLE_PROPOSAL_REQUIRED/);
});
test('V01 requires original case-owned image, model never issues finding',()=>{
 const media={caseId:cid,bytes:Buffer.from('image'),evidenceId:'photo-1',
   checklistItemId:'fire-safety',sha256:'abc123',mimeType:'image/png'};
 const ctx=buildSiAiriaRequest('SI-V01',view(),{media});
 const result={inspectionCaseId:cid,checklistItemId:'fire-safety',evidenceId:'photo-1',
   confidence:0.7,requiresInspectorConfirmation:true,officialFindingCreated:false,
   suggestion:'INCONCLUSIVE',candidateFinding:{reason:'Glare obscures latch',
     visibleFacts:['Partial door frame'],limitations:['Cannot infer closing force']}};
 assert.equal(validateSiAiriaReply('SI-V01',{output:result},ctx).advice.length,1);
 assert.throws(()=>validateSiAiriaReply('SI-V01',{output:{
   ...result,officialFindingCreated:true}},ctx),/SI_V01_AIRIA_CONTRACT_INVALID/);
 assert.throws(()=>buildSiAiriaRequest('SI-V01',view()),/SI_V01_CASE_OWNED_MEDIA_REQUIRED/);
});
test('X01 checks saved case history and rejects fabricated certificate/conflict flags',()=>{
 const history=[{caseId:'prior-1',imo:'9328471',checkId:'fire-safety',
   status:'CONFIRMED_BY_INSPECTOR',evidenceRefs:['OLD-EV-01']}];
 const ctx=buildSiAiriaRequest('SI-X01',view(),{history});
 assert.equal(ctx.request.historicalFindings.length,1);
 const out={requiresHumanReview:true,conflictAutomaticallyResolved:false,
   flags:[{code:'RECURRING_DEFICIENCY',severity:'HIGH',
     evidenceRefs:['EV-01','OLD-EV-01']}],recommendedVerification:['Retest door']};
 assert.equal(validateSiAiriaReply('SI-X01',{result:out},ctx).advice.length,1);
 assert.throws(()=>validateSiAiriaReply('SI-X01',{result:{...out,
  flags:[{code:'CERTIFICATE_NEAR_EXPIRY',evidenceRefs:['EV-01']}]}},ctx),
 /SI_X01_UNVERIFIED_FLAG_REJECTED/);
 assert.throws(()=>validateSiAiriaReply('SI-X01',{result:{...out,
  flags:[{code:'RECURRING_DEFICIENCY',evidenceRefs:['INVENTED']}]}},ctx),
 /SI_AIRIA_EVIDENCE_NOT_IN_CASE/);
});
test('real Airia route never sends synthetic exception scenario to the provider',async()=>{
 let count=0;
 await assert.rejects(runSiAiriaAdvisor({agentCode:'SI-X01',caseId:cid,
   scenario:'RECURRING_DEFICIENCY_CERT_EXPIRY_CONFLICT'},view(),
   {executeAgent:async()=>{count++;return {};}}),
 /SI_AIRIA_SYNTHETIC_SCENARIO_NOT_ALLOWED/);
 assert.equal(count,0);
});
