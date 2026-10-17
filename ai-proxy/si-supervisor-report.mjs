/**
 * Human supervisor read-only join of stored inspection sources.
 * AI proposals never become official findings without inspector confirmation.
 * All evidence is represented by traceable metadata; no fabricated binaries.
 */
const arr=x=>Array.isArray(x)?x:[];
export function buildSiSupervisorFullReport({view,dossier=null,checklist=null}={}){
 if(!view?.inspectionCase?.id)throw Error('SI_SUPERVISOR_CASE_REQUIRED');
 const record=view.record||null;
 const approved=record?.report?.status==='APPROVED';
 const published=arr(checklist?.saved?.templates).flatMap(template=>
  arr(template.groups).flatMap(group=>arr(group.items).map(item=>({
   source:'PUBLISHED_CHECKLIST',templateId:template.templateId,
   templateTitle:template.title,groupTitle:group.title||group.name||null,
   itemId:item.instanceId||item.id,title:item.title||item.question||item.name||item.id,
   answerStatus:item.answerStatus||'PENDING',
   answers:item.answers||{},answeredBy:item.answeredBy||null,
   answerUpdatedAt:item.answerUpdatedAt||null,
   evidenceRefs:arr(item.evidenceRefs),aiAdvisoryOnly:item.ai?.enabled===true
  }))));
 const lifecycle=arr(record?.checks).map(x=>({
  source:'LIFECYCLE_INSPECTOR_VERIFIED',checkId:x.id,
  title:x.title||x.id,decision:x.status,
  mandatory:x.mandatory,inspectorNote:x.note||'',
  naReason:x.naReason||'',severity:x.severity||null,
  evidenceRefs:arr(x.evidenceRefs)
 }));
 const evidenceFiles=arr(checklist?.saved?.evidenceFiles).map(x=>({
  id:x.id,filename:x.filename||null,mimeType:x.mimeType||null,
  itemId:x.itemId||null,sha256:x.sha256||null,
  // Intentionally never return bytes or local filesystem paths.
  evidenceUploaded:true
 }));
 const sections=dossier?.sections||null;
 const status=dossier?.status||'DOSSIER_SOURCE_UNAVAILABLE';
 return {
  status:'SUPERVISOR_FULL_REPORT_READ_ONLY',
  caseId:view.inspectionCase.id,imo:view.inspectionCase.imo,
  report:record?.report||null,
  dossier:{status,sections,missingEvidence:arr(dossier?.missingEvidence),
   revision:dossier?.revision??null},
  inspector:{checks:lifecycle,publishedChecklist:published,
   confirmedFindings:arr(record?.findings),evidenceFiles,
   publishedChecklistState:checklist?.saved?.status||'NOT_SUBMITTED',
   sourceReadiness:checklist?.status||'UNAVAILABLE',
   signatures:{submittedBy:record?.report?.submittedBy||null,
    submittedAt:record?.report?.generatedAt||null,
    supervisor:record?.report?.supervisor||null,
    approvedAt:record?.report?.approvedAt||null},
   counts:{checked:lifecycle.length,
    passed:lifecycle.filter(x=>x.decision==='PASS').length,
    deficiencies:lifecycle.filter(x=>x.decision==='DEFICIENCY').length,
    notApplicable:lifecycle.filter(x=>x.decision==='NOT_APPLICABLE').length,
    dynamicQuestions:published.length}},
  correctiveActions:arr(record?.actions),
  followUps:arr(record?.followUps),audit:arr(record?.audit),
  nmc:{linked:Boolean(view.inspectionCase.nmcReferralId),
   referralId:view.inspectionCase.nmcReferralId||null,
   linkedCaseId:view.inspectionCase.nmcCaseId||null,
   booking:view.nmcBooking||null,
   closureUpdatesNmcCase:true,closeRequiresApprovedReport:!approved},
  regulatory:{
   riyadhMouReportingPotentiallyApplicable:
    /(?:^|[^A-Z])PSC(?:[^A-Z]|$)|PORT.STATE.CONTROL/i.test(
     [view.inspectionCase.regime,sections?.identity?.regime,
      ...arr(sections?.identity?.regimes)].join(' ')),
   officialRiyadhIntegrationConfirmed:false,
   transmissionStatus:'NOT_SUBMITTED',
   detentionIsIndependentHumanDecision:true
  }
 };
}
