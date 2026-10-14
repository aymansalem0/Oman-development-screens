import test from 'node:test';
import assert from 'node:assert/strict';
import {assembleSiVesselDossier} from '../si-vessel-dossier.mjs';
const original=()=>({
 inspectionCase:{id:'00000001-0000-4000-8000-000000000000',imo:'9400796'},
 sourceHash:'1'.repeat(64),stale:false,a04Enabled:true,a04Provider:'AIRIA',
 context:{
  imo:'9400796',siCaseId:'00000001-0000-4000-8000-000000000000',
  vessel:{name:'Demo Vessel',flag:'UAE',vesselType:'CARGO'},
  approvedPlanId:'plan-01',targetRegime:'PORT_STATE_CONTROL',
  targetRegimes:['PORT_STATE_CONTROL','UAE_SERVICE_INSPECTION'],
  createdCaseApprovedBy:'supervisor@moei',
  inspectionReasons:[
   {eventKey:'EVT-1',sourceType:'PSC_PORT_CALL',sourceReference:'PSC-01',
    inspectionRegime:'PORT_STATE_CONTROL',reason:'Source referral',
    evidenceIds:['E-1','E-1']},
   {eventKey:'EVT-2',sourceType:'SERVICE_REQUEST',
    sourceReference:'SR-01',inspectionRegime:'UAE_SERVICE_INSPECTION',
    evidenceIds:['E-2'],reason:null}
  ],
  sourceInspectionObjectives:[{objectiveId:'SI-SRC-EVT-1'}],
  inspectionScopes:[{regime:'PORT_STATE_CONTROL'}],
  risk:{score:82,level:'High',evaluationId:'RISK-01',policyRevision:4},
  evidenceManifestRefs:['E-1','E-2','CERT-1'],
  bundleRef:'VBL-9400796',
  evidenceContext:{
   tracking:{lastPort:'Jebel Ali'},
   certificates:[{id:'CERT-1',status:'SOURCE_RECORDED'}],
   inspectionHistory:[{id:'PREV-1',result:'SOURCE_RECORDED'}],
   openDeficiencies:[{id:'DEF-1',status:'Open',description:'Source finding'}],
   documentManifest:{records:[{evidenceId:'DOC-1',
    documentType:'Certificate',reviewStatus:'HUMAN_REVIEWED'}]}
  },
  baseChecklistItemIds:['fire-safety','certificates','pollution'],
  externalDocumentsVerified:false,
  provenance:'SYNTHETIC_POC_NOT_OFFICIAL_SOURCE'
 },
 saved:{version:4,preparedAt:'2026-10-20T10:00:00Z',
  preparedBy:'officer@moei',status:'DRAFT_REVIEW',
  dossier:{mock:false,agentConfidence:.83,
   generatedAt:'2026-10-20T10:05:00Z',
   requestCorrelationId:'SI-A04-01',sourceHash:'1'.repeat(64),
   focusAreas:[{category:'pollution',evidenceIds:['E-1']}],
   checklistFocus:[{existingItemId:'pollution',focus:'REVIEW'}],
   predictedDeficiencies:[{category:'pollution',evidenceIds:['E-1']}],
   suggestedAdditionalItems:[{title:'Source-based follow-up',evidenceIds:['E-2']}],
   missingEvidence:['Original endorsed document unavailable']}},
  review:null}
});
const schedule={id:'SCHED-1',operationalBookingConfirmed:false};
const order={id:'WORK-1',status:'ISSUED',
 checklistStatus:'MANDATORY_PUBLISHED_TEMPLATE_SNAPSHOT',
 assignment:{inspectorId:'ENG-3',inspectorName:'Inspector 3',
  portId:'JEA',portName:'Jebel Ali',
  startLocal:'2026-10-22 10:00',endLocal:'2026-10-22 12:00'}};

test('full dossier links all source reasons, existing A04 and required checklist WITHOUT modifying inputs',()=>{
 const view=original(),before=structuredClone(view);
 const d=assembleSiVesselDossier({view,schedule,order,checklist:{saved:{id:'CHECK-1'}}});
 assert.deepEqual(view,before);
 assert.equal(d.imo,'9400796');
 assert.equal(d.sections.referrals.allSourceReasons.length,2);
 assert.deepEqual(d.sections.referrals.allSourceReasons[0].evidenceIds,['E-1']);
 assert.equal(d.sections.sourceEvidence.certificates.length,1);
 assert.equal(d.sections.sourceEvidence.inspectionHistory.length,1);
 assert.equal(d.sections.sourceEvidence.openDeficiencies.length,1);
 assert.equal(d.sections.sourceEvidence.documents[0].authenticityVerified,false);
 assert.equal(d.sections.assignments.inspectorName,'Inspector 3');
 assert.equal(d.sections.risk.score,82);
 assert.equal(d.sections.aiAnalysis.generated,true);
 assert.equal(d.sections.aiAnalysis.modelDraft.predictedDeficiencies[0].hypothesisOnly,true);
 assert.equal(d.sections.aiAnalysis.modelDraft.suggestedAdditionalItems[0].recommendationOnly,true);
 assert.equal(d.readiness.aiReviewed,false);
 assert.equal(d.readiness.regulatoryApprovalImplied,false);
 assert.equal(d.readOnly,true);
 assert.equal(d.aiCallsOnGet,0);assert.equal(d.caseWrites,0);
 assert.equal(d.bookingWrites,0);
 assert.ok(d.missingEvidence.includes('EXTERNAL_DOCUMENT_AUTHENTICITY_NOT_VERIFIED'));
});
test('no saved risk or AI is reported as missing, never fabricated',()=>{
 const view=original();
 view.context.risk=null;view.saved=null;
 view.context.evidenceContext.certificates=[];
 view.context.evidenceContext.inspectionHistory=[];
 const d=assembleSiVesselDossier({view});
 assert.equal(d.sections.risk,null);
 assert.equal(d.sections.aiAnalysis.generated,false);
 assert.equal(d.sections.aiAnalysis.modelDraft,null);
 assert.equal(d.sections.assignments,null);
 assert.ok(d.missingEvidence.includes('CURRENT_SAVED_NMC_RISK_NOT_AVAILABLE'));
 assert.ok(d.missingEvidence.includes('A04_AI_NOT_GENERATED_OR_NOT_ALLOWED'));
 assert.ok(d.missingEvidence.includes('INSPECTOR_WORK_ORDER_NOT_LINKED'));
 assert.ok(d.missingEvidence.includes('PUBLISHED_CHECKLIST_TEMPLATE_NOT_VERIFIED'));
});
test('reviewed A04 is separately recorded without marking vessel as legally inspected',()=>{
 const view=original();
 view.saved.status='APPROVED';
 view.saved.review={decision:'APPROVE',actor:'supervisor',
  reason:'Evidence reviewed',at:'2026-10-21'};
 const d=assembleSiVesselDossier({view,schedule,order,checklist:{saved:{}}});
 assert.equal(d.readiness.aiReviewed,true);
 assert.equal(d.sections.aiAnalysis.supervisorReview.decision,'APPROVE');
 assert.equal(d.readiness.regulatoryApprovalImplied,false);
 assert.equal(d.readiness.liveBookingConfirmed,false);
});
test('invalid or unapproved case cannot become a full dossier',()=>{
 assert.throws(()=>assembleSiVesselDossier({view:{context:{imo:'9400796'}}}),
  /SI_DOSSIER_APPROVED_CASE_CONTEXT_REQUIRED/);
});
