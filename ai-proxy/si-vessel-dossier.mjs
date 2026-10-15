/**
 * Full, source-grounded Smart Inspection vessel dossier projection.
 * Deterministic vessel file + optional, explicitly requested A04 overlay.
 *
 * Only stored source-backed facts can be described as evidence. AI-suggested
 * deficiencies are ALWAYS hypotheses. No read operation triggers Airia,
 * changes a statutory checklist, creates a case or confirms an ERP booking.
 */
const unique=xs=>[...new Set((xs||[]).filter(x=>typeof x==='string'&&x))];
const list=x=>Array.isArray(x)?x:[];
const scalar=(x,fallback=null)=>typeof x==='string'&&x.trim()?x:fallback;
export function assembleSiVesselDossier({view,schedule=null,
 order=null,checklist=null}={}){
 if(!view?.inspectionCase?.id||!view?.context?.imo)
  throw Error('SI_DOSSIER_APPROVED_CASE_CONTEXT_REQUIRED');
 const c=view.context,record=view.saved||null;
 const ai=record?.dossier||null;
 const sourceReasons=list(c.inspectionReasons).map(r=>({
  eventKey:r.eventKey,sourceType:r.sourceType,
  sourceReference:r.sourceReference,inspectionRegime:r.inspectionRegime,
  narrative:r.reason||null,evidenceIds:unique(r.evidenceIds),
  sourceApproval:r.sourceApproval||null
 }));
 const approvedDocuments=list(c.evidenceContext?.documentManifest?.records)
  .map(d=>({evidenceId:d.evidenceId||null,
   source:d.source||'HUMAN_REVIEWED_DOCUMENT_MANIFEST',
   documentType:d.documentType||d.type||null,
   reviewStatus:d.reviewStatus||d.status||null,
   authenticityVerified:false}));
 const openFindings=list(c.evidenceContext?.openDeficiencies).map(d=>({
  id:d.id||null,description:d.description||d.note||null,
  status:d.status||'SOURCE_OPEN',evidenceId:unique([d.id])[0]||null
 }));
 const sections={
  identity:{imo:c.imo,vesselName:scalar(c.vessel?.name),
   flag:scalar(c.vessel?.flag),vesselType:scalar(c.vessel?.vesselType),
   caseId:view.inspectionCase.id,planId:c.approvedPlanId||null,
   regime:c.targetRegime,regimes:unique(c.targetRegimes),
   approvedBy:c.createdCaseApprovedBy||null},
  assignments:order?{orderId:order.id,status:order.status,
   scheduleId:schedule?.id||null,
   inspectorId:order.assignment?.inspectorId||null,
   inspectorName:order.assignment?.inspectorName||null,
   portId:order.assignment?.portId||null,
   portName:order.assignment?.portName||null,
   startLocal:order.assignment?.startLocal||null,
   endLocal:order.assignment?.endLocal||null,
   crossPort:order.assignment?.crossPort===true,
   liveErpBookingConfirmed:schedule?.operationalBookingConfirmed===true}:null,
  referrals:{allSourceReasons:sourceReasons,
   objectives:list(c.sourceInspectionObjectives),
   inspectionScopes:list(c.inspectionScopes),
   distinctSourceCount:new Set(sourceReasons.map(r=>r.sourceType)).size},
  risk:c.risk?{
   score:c.risk.score,level:c.risk.level,
   evaluationId:c.risk.evaluationId,policyRevision:c.risk.policyRevision,
   rulesetVersion:c.risk.rulesetVersion,
   status:'SAVED_NMC_SOURCE_ASSESSMENT_NOT_AI_RECALCULATED'
  }:null,
  sourceEvidence:{
   bundleRef:c.bundleRef,
   evidenceManifestRefs:unique(c.evidenceManifestRefs),
   currentSourceHash:view.sourceHash,
   tracking:c.evidenceContext?.tracking||null,
   certificates:list(c.evidenceContext?.certificates),
   inspectionHistory:list(c.evidenceContext?.inspectionHistory),
   openDeficiencies:openFindings,
   documents:approvedDocuments,
   externalDocumentsVerified:c.externalDocumentsVerified===true,
   evidenceProvenance:c.provenance
  },
  inspectionChecklist:{
   mandatoryBaseItemIds:unique(c.baseChecklistItemIds),
   publishedTemplateSnapshotPresent:Boolean(checklist?.saved),
   checklistStatus:order?.checklistStatus||null,
   itemsPrepared:Boolean(record),
   aiCannotDeleteMandatoryItems:true,
   manualScopeApprovalRequired:true
  },
  aiAnalysis:{
   status:record?.status||'NOT_PREPARED',
   provider:view.a04Provider||null,
   enabled:view.a04Enabled===true,
   generated:!!ai,
   mock:ai?.mock===true,
   modelDraft:ai?{
    generatedAt:ai.generatedAt,agentConfidence:ai.agentConfidence,
    correlationId:ai.requestCorrelationId,
    evidenceSourceHash:ai.sourceHash,
    focusAreas:list(ai.focusAreas),
    checklistFocus:list(ai.checklistFocus),
    predictedDeficiencies:list(ai.predictedDeficiencies).map(x=>({
     ...x,hypothesisOnly:true})),
    suggestedAdditionalItems:list(ai.suggestedAdditionalItems).map(x=>({
     ...x,recommendationOnly:true})),
    missingEvidence:list(ai.missingEvidence)
   }:null,
   supervisorReview:record?.review||null,
   aiNotStatutoryFinding:true
  }
 };
 const missing=[];
 if(!sections.risk)missing.push('CURRENT_SAVED_NMC_RISK_NOT_AVAILABLE');
 if(!sections.assignments)missing.push('INSPECTOR_WORK_ORDER_NOT_LINKED');
 if(!sections.sourceEvidence.certificates.length)
  missing.push('NO_CERTIFICATE_RECORDS_IN_SOURCE_BUNDLE');
 if(!sections.sourceEvidence.inspectionHistory.length)
  missing.push('NO_HISTORICAL_INSPECTIONS_IN_SOURCE_BUNDLE');
 if(!sections.sourceEvidence.documents.length)
  missing.push('NO_HUMAN_REVIEWED_EXTERNAL_DOCUMENTS');
 if(!sections.sourceEvidence.externalDocumentsVerified)
  missing.push('EXTERNAL_DOCUMENT_AUTHENTICITY_NOT_VERIFIED');
 if(!sections.inspectionChecklist.publishedTemplateSnapshotPresent)
  missing.push('PUBLISHED_CHECKLIST_TEMPLATE_NOT_VERIFIED');
 if(!sections.aiAnalysis.generated)
  missing.push('A04_AI_NOT_GENERATED_OR_NOT_ALLOWED');
 else if(record?.status!=='APPROVED')
  missing.push('A04_AI_SUPERVISOR_REVIEW_PENDING');
 if(view.stale)missing.push('DOSSIER_SOURCE_SNAPSHOT_STALE');
 return {
  status:'SOURCE_GROUNDED_VESSEL_DOSSIER',
  schema:'MOEI-SI-VESSEL-DOSSIER-V1',
  caseId:view.inspectionCase.id,imo:c.imo,
  revision:record?.version||0,
  preparedAt:record?.preparedAt||null,
  preparedBy:record?.preparedBy||null,
  sections,missingEvidence:missing,
  readiness:{
   preparationSaved:Boolean(record),aiGenerated:!!ai,
   aiReviewed:record?.status==='APPROVED',
   mandatoryChecklistPreserved:true,
   regulatoryApprovalImplied:false,
   liveBookingConfirmed:sections.assignments?.liveErpBookingConfirmed===true
  },
  readOnly:true,aiCallsOnGet:0,caseWrites:0,bookingWrites:0
 };
}

/**
 * BEFORE activation there is no SI_INSPECTION_CASE, so present a SOURCE
 * dossier rather than pretending that an A04 dossier/checklist already exists.
 * This is a pure projection of the stored fleet bundle and approved roster.
 */
export function assemblePendingWorkOrderDossier({
 order,schedule,bundle,plan,risk=null
}={}){
 if(!order?.imo||!order?.id)throw Error('SI_PENDING_ORDER_REQUIRED');
 const v=bundle?.inlineContext?.vessel||{};
 const context=bundle?.inlineContext||{};
 const planVessel=plan?.approvedVessels?.find(x=>x.imo===order.imo)||null;
 const reasons=list(planVessel?.inspectionReasons).map(r=>({
  sourceType:r.sourceType,sourceReference:r.sourceReference,
  inspectionRegime:r.inspectionRegime,
  narrative:r.reason||null,evidenceIds:unique(r.evidenceIds),
  sourceApproval:r.sourceApproval||null
 }));
 return {status:'SOURCE_ONLY_PENDING_WORK_ORDER_ACTIVATION',
  schema:'MOEI-SI-VESSEL-DOSSIER-V1',caseId:null,imo:order.imo,
  revision:0,preparedAt:null,preparedBy:null,
  sections:{
   identity:{imo:order.imo,vesselName:v.name||v.vesselName||null,
    flag:v.flag||null,vesselType:v.vesselType||null,caseId:null,
    planId:order.planId,regimes:unique(list(planVessel?.regimes)),
    approvedBy:plan?.approvedBy||null},
   assignments:{
    orderId:order.id,status:order.status,scheduleId:schedule?.id||null,
    inspectorId:order.assignment?.inspectorId||null,
    inspectorName:order.assignment?.inspectorName||null,
    portName:order.assignment?.portName||null,
    startLocal:order.assignment?.startLocal||null,
    crossPort:order.assignment?.crossPort===true,
    liveErpBookingConfirmed:false
   },
   referrals:{allSourceReasons:reasons,objectives:[],inspectionScopes:[],
    distinctSourceCount:new Set(reasons.map(x=>x.sourceType)).size},
   risk:risk?{score:risk.riskScore,level:risk.riskLevel,
    evaluationId:risk.sourceAssessmentId,policyRevision:risk.policyRevision,
    status:'SAVED_NMC_SOURCE_ASSESSMENT_NOT_AI_RECALCULATED'}:null,
   sourceEvidence:{
    bundleRef:bundle?'VBL-'+order.imo:null,
    evidenceManifestRefs:unique(list(bundle?.evidenceIds)),
    tracking:context.tracking||null,
    certificates:list(context.certificates),
    inspectionHistory:list(context.inspections),
    openDeficiencies:list(context.deficiencies).filter(x=>
      String(x.status||'').toUpperCase()==='OPEN'),
    documents:[],
    externalDocumentsVerified:false,
    evidenceProvenance:'SAVED_VESSEL_BUNDLE_READ_ONLY'
   },
   inspectionChecklist:{
    mandatoryBaseItemIds:[],
    publishedTemplateSnapshotPresent:false,checklistStatus:'NOT_PREPARED',
    itemsPrepared:false,aiCannotDeleteMandatoryItems:true,
    manualScopeApprovalRequired:true
   },
   aiAnalysis:{
    status:'NOT_PREPARED',enabled:false,generated:false,mock:false,
    modelDraft:null,supervisorReview:null,aiNotStatutoryFinding:true
   }
  },
  missingEvidence:['INSPECTION_CASE_NOT_ACTIVATED',
   'PREPARATION_AND_PINNED_CHECKLIST_NOT_CREATED',
   'A04_ADVISORY_NOT_YET_PREPARED'],
  readiness:{preparationSaved:false,aiGenerated:false,aiReviewed:false,
   mandatoryChecklistPreserved:true,regulatoryApprovalImplied:false,
   liveBookingConfirmed:false},
  readOnly:true,aiCallsOnGet:0,caseWrites:0,bookingWrites:0};
}
