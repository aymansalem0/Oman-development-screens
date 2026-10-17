import {Injectable} from '@angular/core';
import {HttpClient,HttpHeaders} from '@angular/common/http';
import {Observable,throwError} from 'rxjs';
import {catchError} from 'rxjs/operators';

export type NmcCentralCaseStatus='OPEN'|'IN_PROGRESS'|'PENDING_VERIFICATION'|'RESOLVED';
export type NmcCentralTaskStatus='Assigned'|'In Progress'|'Completed'|'Escalated';
export interface NmcCentralCaseTask {
  id:string;status:NmcCentralTaskStatus;
  assignedRole:string;mandatory:boolean;evidenceIds:string[];
  actionId?:string;actionType?:string;title?:string;priority?:string;
  reason?:string;provenance?:string;approvalMode?:'ACCEPT'|'MODIFY';
  workflowStepId?:string;titleAr?:string;regulatedEnforcement?:boolean;
}
export interface NmcAiAction {
  actionId:string;actionType:string;title:string;reason:string;
  priority:string;ownerRole:string;confidence:number;
  evidenceIds:string[];requiresHumanApproval:boolean;
  decision:'PENDING'|'ACCEPT'|'REJECT'|'MODIFY';decisionNote?:string;
  replacementActionType?:string;replacementTitle?:string;replacementOwnerRole?:string;
}
export interface NmcAiActionPlan {
  source:string;sourceAssessmentId:string|null;sourceScore:number;
  sourceLevel:string;configVersion:string|null;summary:string;whyItMatters:string;
  agentAssessmentId:string|null;createdAt:string;proposedActions:NmcAiAction[];
  primaryProposedDecision?:{decisionId:string;titleAr:string;titleEn:string;rationaleAr:string;rationaleEn:string;expectedOutcomeAr?:string;expectedOutcomeEn?:string;evidenceIds:string[];urgency?:string;confidence?:number;requestedActionIds?:string[]};
  sourceCurrency?:{
    historicalSource:boolean;originalAssessmentId:string|null;
    latestAssessmentId:string|null;latestRiskScore:number|null;
    latestRiskLevel:string|null;latestAssessedAt:string|null;
    explicitlyAcknowledged:boolean;acknowledgedAt:string|null;
  };
}
export interface NmcDecisionStep{
  id:string;titleEn:string;titleAr:string;role:string;
  kind:string;mandatory:boolean;
}
export interface NmcOperationalDecision{
  code:string;titleEn:string;titleAr:string;
  originalA01Proposal:{actionId:string;actionType:string;title:string;
    reason:string;priority:string;confidence:number;evidenceIds:string[]};
  selectedFromActionId:string;rationale:string;evidenceIds:string[];
  confidence:number;workflowSteps:NmcDecisionStep[];
  decisionStatus:'PENDING_HUMAN_REVIEW'|'APPROVED'|'REJECTED';
  rationaleSource?:'OFFICER_VALIDATED_LEGACY_A01'|'AIRIA_A01_ACTION';
  selectionSource:string;policyVersion:string;regulated:boolean;
  regulatoryEffect:'NONE_POC_ONLY';humanDecision?:'ACCEPT'|'MODIFY'|'REJECT';
  approvedCode?:string|null;approvedTitleEn?:string|null;approvedTitleAr?:string|null;
  approvedWorkflowSteps?:NmcDecisionStep[];
  decisionNote?:string;decidedBy?:string;decidedAt?:string;
}
export interface NmcDecisionCatalogueEntry{
  code:string;titleEn:string;titleAr:string;regulated:boolean;
  steps:NmcDecisionStep[];
}
export interface NmcPocRestriction{
  type:'PORT_ENTRY_RESTRICTION'|'DETENTION';
  status:'PENDING_AUTHORITY_APPROVAL'|'SIMULATED_ACTIVE'|'SIMULATED_RELEASED';
  pocOnly:true;legalAuthorityConfirmed:false;authorityReference:string|null;
  releaseEvidenceRef?:string|null;requestedAt:string;authorizedAt:string|null;
}
export interface NmcDecisionFeedback{
  id:string;originalA01Proposal:NmcOperationalDecision['originalA01Proposal'];
  originalNmcProposedCode:string;humanApprovedCode:string;
  status:string;at:string;reason:string;
}
export interface NmcInspectionReferral {
  id:string;caseId:string;imo:string;actionId:string;
  status:'PENDING_SCHEDULING'|'SCHEDULED'|'COMPLETED';
  priority:string;reason:string;evidenceIds:string[];sourceScore:number;
  sourceAssessmentId:string|null;port:string|null;scheduledAt:string|null;
  inspector:string|null;createdAt:string;version:number;caseStatus?:string;
  sourceLevel?:string;
}
export interface NmcCentralDecision {
  recommendationId:string;decision:'ACCEPT'|'MODIFY'|'REJECT';
  note:string;evidenceIds:string[];at:string;role:string;
}
export interface NmcCentralInspection {
  inspectionId:string;result:string;findingsCount:number;criticalFindings:number;
  summary:string;completedAt:string;
}
export interface NmcCaseIncident {
 incidentId:string;descriptionHash:string;sourceOrganization:string;sourceType:string;
 sourceReference:string;sourceIncidentStatus:string;sourceOperationalStatus:string;
 incidentType:string;portOrZone:string;sourceDescription:string;
 sourceReportedSeverity:string;evidenceIds:string[];
 incidentRiskScore:number;incidentRiskBand:string;incidentScoreSource:string;
 suggestedFollowup:string;suggestedFollowupState:string;
 sourceAssessmentId:string;a02ContextStatus:string;
 decisionStatus:'PENDING_HUMAN_REVIEW'|'OFFICER_APPROVED';
 approvedFollowup:string|null;officerName:string|null;officerReason:string|null;
 receivedAt:string|null;assessedAt:string;updatedAt:string;
 officerDecision?:'ACCEPT'|'MODIFY'|'REJECT';decidedAt?:string;
 workflowCode?:string;followupExecutionStatus?:string;
}
export interface NmcCentralCase {
  id:string;imo:string;status:NmcCentralCaseStatus;
  assignedRole:string;source:string;sourceAssessmentId:string|null;
  alertIds:string[];sourceScore:number;sourceLevel:string;
  createdAt:string;updatedAt:string;version:number;
  tasks:NmcCentralCaseTask[];decisions:NmcCentralDecision[];
  incidentEvents?:NmcCaseIncident[];
  siInspectionSources?:{eventId:string;inspectionId:string;reportId:string;
    summary:string;receivedAt:string;supervisor?:string;
    source?:'SI_APPROVED_REPORT';regulatoryDecision?:false}[];
  inspectionReviewHistory?:{eventId:string;inspectionId:string;reportId:string;
    decision:'APPROVED'|'RETURNED';summary:string;reviewedAt:string;
    source:'SI_HUMAN_SUPERVISOR';supervisor:string|null}[];
  operationalRisk?:{score:number;level:string;assessmentId:string;
    previousScore:number|null;previousLevel:string|null;sourceInspectionId:string;
    sourceReportId:string;evidenceId:string;policyVersion:string;updatedAt:string;
    provisional:true;regulatoryDecision:false}|null;
  postInspectionRiskHistory?:{eventId:string;inspectionId:string;reportId:string;
    assessmentId:string;previousAssessmentId:string|null;previousScore:number|null;
    previousLevel:string|null;newScore:number;newLevel:string;
    policyVersion:string;evidenceId:string;factorChanges:{
      factor:string;previous:number|null;current:number;evidenceIds:string[]}[];
    calculatedAt:string;officialRegulatoryDecision:false}[];
  actionPlan?:NmcAiActionPlan|null;
  operationalDecision?:NmcOperationalDecision|null;
  decisionFeedback?:NmcDecisionFeedback[];
  restriction?:NmcPocRestriction|null;
  inspectionRequests?:NmcInspectionReferral[];
  inspectionOutcome:NmcCentralInspection|null;
  resolutionNote:string|null;provenance:string;
}
export interface NmcCentralCaseAudit {
  version:number;action:string;role:string;note:string;
  details:{[key:string]:string|number|boolean|null};
  at:string;
}
export interface NmcCaseA01SourcePreview {
  status:'ok';caseId:string;caseVersion:number;
  ready:boolean;isHistorical:boolean;requiresHistoricalAcknowledgement:boolean;
  caseAssessmentId:string|null;latestAssessmentId:string|null;
  caseScore:number|null;latestScore:number|null;
  caseLevel:string|null;latestLevel:string|null;
  sourceAssessedAt:string|null;latestAssessedAt:string|null;
}
export interface NmcSiPostInspectionRiskStatus{
  status:'ok';caseId:string;source:'SI_APPROVED_INSPECTION'|'NOT_SI_APPROVED_INSPECTION';
  reportId:string|null;
  jobStatus:string;
  job:{status:string;aiExecutionStatus:string|null;errorCode:string|null;
    updatedAt:string|null;riskSaved:boolean;assessmentId:string|null}|null;
}
interface CaseResponse{
  status:'ok';case:NmcCentralCase|null;
  aiActionPlanStatus?:'READY'|'FAILED';
  aiActionPlanError?:{code:string;details?:{actionIndex?:number;actionType?:string;actionId?:string}};
}
interface CaseHistoryResponse{status:'ok';history:NmcCentralCaseAudit[]}

@Injectable({providedIn:'root'})
export class NmcCasesService {
  private readonly root='/api/ai/cases';
  private editorKey='MOEI_SESSION';
  private publisherKey='MOEI_SESSION';
  constructor(private readonly http:HttpClient){}

  byImo(imo:string):Observable<CaseResponse>{
    return this.http.get<CaseResponse>(this.root+'/by-imo/'+encodeURIComponent(imo));
  }
  byId(id:string):Observable<CaseResponse>{
    return this.http.get<CaseResponse>(this.root+'/'+encodeURIComponent(id));
  }
  history(id:string):Observable<CaseHistoryResponse>{
    return this.http.get<CaseHistoryResponse>(this.root+'/'+encodeURIComponent(id)+'/history');
  }
  list():Observable<{status:'ok';cases:NmcCentralCase[]}>{
    return this.http.get<{status:'ok';cases:NmcCentralCase[]}>(this.root);
  }
  createFromAlert(alertId:string):Observable<CaseResponse>{
    return this.mutate(this.root+'/from-alert',{alertId,withAiActionPlan:true},false);
  }
  decideIncident(current:NmcCentralCase,incidentId:string,
    decision:'ACCEPT'|'MODIFY'|'REJECT',approvedFollowup:string,
    note:string,officer:string):Observable<CaseResponse>{
    return this.mutate(this.path(current.id)+'/incidents/'+encodeURIComponent(incidentId)+'/decision',{
      version:current.version,decision,approvedFollowup,note,officer
    },false);
  }
  decisionCatalogue():Observable<{status:'ok';policyVersion:string;
    pocOnly:boolean;decisions:NmcDecisionCatalogueEntry[]}>{
    return this.http.get<{status:'ok';policyVersion:string;
      pocOnly:boolean;decisions:NmcDecisionCatalogueEntry[]}>(this.root+'/decision-catalogue');
  }
  initializeOperational(current:NmcCentralCase):Observable<CaseResponse>{
    return this.mutate(this.path(current.id)+'/operational-decision/initialize',
      {version:current.version},false);
  }
  decideOperational(current:NmcCentralCase,decision:'ACCEPT'|'MODIFY'|'REJECT',
    newDecisionCode='',note=''):Observable<CaseResponse>{
    return this.mutate(this.path(current.id)+'/operational-decision',
      {version:current.version,decision,
        ...(decision==='MODIFY'?{newDecisionCode}:{}),note},false);
  }
  authorizeRestriction(current:NmcCentralCase,
    authorityReference:string,legalBasis:string):Observable<CaseResponse>{
    return this.mutate(this.path(current.id)+'/restriction/authorize',
      {version:current.version,authorityReference,legalBasis},true);
  }
  releaseRestriction(current:NmcCentralCase,
    authorityReference:string,rectificationEvidenceRef:string):Observable<CaseResponse>{
    return this.mutate(this.path(current.id)+'/restriction/release',
      {version:current.version,authorityReference,rectificationEvidenceRef},true);
  }
  actionPlanSourcePreview(id:string):Observable<NmcCaseA01SourcePreview>{
    return this.http.get<NmcCaseA01SourcePreview>(
      this.path(id)+'/action-plan-source');
  }
  /** Read-only: never queues A01/A02 or retries potentially billable calls. */
  siPostInspectionRiskStatus(caseId:string):Observable<NmcSiPostInspectionRiskStatus>{
    return this.http.get<NmcSiPostInspectionRiskStatus>(
      this.path(caseId)+'/post-inspection-risk-status');
  }
  generateActionPlan(current:NmcCentralCase,acknowledgeHistoricalAssessment=false,
    reviewedLatestAssessmentId?:string|null):Observable<CaseResponse>{
    return this.mutate(this.path(current.id)+'/action-plan/generate',{
      version:current.version,acknowledgeHistoricalAssessment,
      ...(acknowledgeHistoricalAssessment?{reviewedLatestAssessmentId}: {})
    },false);
  }
  decideAiAction(current:NmcCentralCase,actionId:string,
    decision:'ACCEPT'|'MODIFY'|'REJECT',note='',replacementActionType?:string):Observable<CaseResponse>{
    return this.mutate(this.path(current.id)+'/actions/'+encodeURIComponent(actionId)+'/decision',
      {version:current.version,decision,note,...(replacementActionType?{replacementActionType}:{})},false);
  }
  inspectionReferrals():Observable<{status:'ok';requests:NmcInspectionReferral[]}>{
    return this.http.get<{status:'ok';requests:NmcInspectionReferral[]}>('/api/ai/inspection-referrals');
  }
  scheduleInspection(current:NmcCentralCase,requestId:string,
    scheduledAt:string,port:string,inspector:string):Observable<CaseResponse>{
    return this.mutate(this.path(current.id)+'/inspections/'+encodeURIComponent(requestId)+'/schedule',
      {version:current.version,scheduledAt,port,inspector},false);
  }
  task(current:NmcCentralCase,taskId:string,action:'START'|'COMPLETE'|'ESCALATE',note=''):Observable<CaseResponse>{
    return this.mutate(this.path(current.id)+'/task',
      {version:current.version,taskId,action,note},false);
  }
  decision(current:NmcCentralCase,
    recommendationId:string,decision:'ACCEPT'|'MODIFY'|'REJECT',
    note:string,evidenceIds:string[]):Observable<CaseResponse>{
    return this.mutate(this.path(current.id)+'/decision',
      {version:current.version,recommendationId,decision,note,evidenceIds},false);
  }
  inspection(current:NmcCentralCase,outcome:{
    inspectionId:string;result:string;findingsCount:number;criticalFindings:number;summary:string;
  }):Observable<CaseResponse>{
    return this.mutate(this.path(current.id)+'/inspection',
      {version:current.version,outcome},false);
  }
  resolve(current:NmcCentralCase,note:string):Observable<CaseResponse>{
    return this.mutate(this.path(current.id)+'/resolve',
      {version:current.version,note},true);
  }
  private path(id:string):string{return this.root+'/'+encodeURIComponent(id);}
  private mutate(path:string,body:object,publisher:boolean):Observable<CaseResponse>{
    let key=publisher?this.publisherKey:this.editorKey;
    if(!key){
      const value='MOEI_SESSION';
      if(!value?.trim())return throwError(()=>new Error('ACTION_CANCELLED'));
      key=value.trim();
      if(publisher)this.publisherKey=key;
      else this.editorKey=key;
    }
    return this.http.post<CaseResponse>(path,body,{
      headers:new HttpHeaders({'X-NMC-DASHBOARD-KEY':key})
    }).pipe(catchError(err=>{
      if(err?.status===403){
        if(publisher)this.publisherKey='MOEI_SESSION';
        else this.editorKey='MOEI_SESSION';
      }
      return throwError(()=>err);
    }));
  }
  readableError(error:any,ar:boolean):string{
    if(error?.message==='ACTION_CANCELLED')
      return ar?'تم إلغاء العملية.':'Action cancelled.';
    const code=error?.error?.error||'';
    // Action metadata is a safe, bounded diagnostic (type/id and position only).
    // The backend never sends the full Airia response or maritime evidence.
    const details=error?.error?.details;
    const actionNumber=Number.isInteger(details?.actionIndex)&&details.actionIndex>=1
      ?details.actionIndex:'?';
    if(code==='A01_ACTION_TYPE_UNSUPPORTED'){
      const type=String(details?.actionType||'(missing)').slice(0,80);
      return ar
        ?`رفض A01 نوع الإجراء ${type} في البند رقم ${actionNumber}. يجب مطابقة نوع الإجراء مع قائمة الأنواع المعتمدة لدى المنصة، ولم تُنشأ مهام.`
        :`A01 action #${actionNumber} has unsupported actionType: "${type}". Align the Airia pipeline action type with the platform contract. No tasks were created.`;
    }
    if(code==='A01_ACTION_ID_INVALID'){
      const id=String(details?.actionId||'(missing)').slice(0,80);
      return ar
        ?`معرف إجراء A01 غير صالح في البند رقم ${actionNumber}: "${id}". يُقبل معرف لاتيني آمن بطول 1-60 حرفًا.`
        :`A01 action #${actionNumber} has an invalid actionId: "${id}". Use a 1-60 character alphanumeric identifier.`;
    }
    if(code==='A01_ACTION_ID_DUPLICATE'){
      const id=String(details?.actionId||'(missing)').slice(0,80);
      return ar
        ?`كرر A01 معرف الإجراء "${id}" عند البند رقم ${actionNumber}. يجب أن يكون لكل إجراء معرف فريد.`
        :`A01 action #${actionNumber} duplicates normalized actionId "${id}". Each proposal must have a unique ID.`;
    }
    const messages:Record<string,[string,string]>={
      CASE_INCIDENT_DECISION_INVALID:['Provide a valid incident action, officer and documented reason (15–500 characters).','أدخل متابعة صحيحة للبلاغ واسم الموظف وسببًا موثقًا (15–500 حرف).'],
      CASE_INCIDENT_DECISION_MISMATCH:['Accept must retain AI recommendation, Modify must select a different route, and Reject requires verification.','الاعتماد يحتفظ بالتوصية، والتعديل يختار متابعة مختلفة، والرفض يتطلب التحقق.'],
      CASE_INCIDENT_ALREADY_DECIDED:['Incident follow-up was already reviewed in this case.','تم اعتماد متابعة الحادث بالفعل داخل الحالة.'],
      CASE_INCIDENT_NEW_VERSION_REQUIRES_REVIEW:['Source incident description changed after approval. Review the source and existing case manually.','تغير وصف الحادث بعد اعتماده؛ راجع البلاغ والحالة يدويًا.'],
      CASE_INCIDENT_SCHEMA_REQUIRES_NULL_ALERT:['The Oracle NMC_CASE schema must allow an incident case without a source alert ID. Database migration required.','يجب السماح في قاعدة Oracle بإنشاء حالة مرتبطة بحادث بدون تنبيه سابق؛ يلزم تحديث الـSchema.'],
      CASE_INCIDENT_DECISION_PENDING:['Review all incident follow-ups before closing this case.','يجب اعتماد أو رفض كل المتابعات المقترحة للحوادث قبل إغلاق الحالة.'],
      CASE_DECISION_RATIONALE_UNAVAILABLE:['A01 supplied no action-specific rationale. Enter your own verified business justification to accept, or modify/reject.','لم يقدم A01 مبررًا محددًا للإجراء؛ أدخل مبررًا تشغيليًا موثقًا للاعتماد أو عدّل القرار أو ارفضه.'],
      CASE_DECISION_EVIDENCE_REQUIRED:['This inspection or regulated route requires verified saved evidence.','يتطلب مسار المعاينة أو المنع وجود أدلة محفوظة تم التحقق منها.'],
      CASE_SINGLE_DECISION_EXISTS:['A single decision is already recorded. Reload the case.','يوجد قرار واحد محفوظ بالفعل. أعد تحميل الحالة.'],
      CASE_LEGACY_REVIEW_ALREADY_STARTED:['This case already contains human decisions or execution activity. Migration is disabled to protect the audit history.','تحتوي الحالة على قرارات أو تنفيذ سابق؛ لا يمكن تحويلها حفاظًا على سجل المراجعة.'],
      CASE_SINGLE_DECISION_UNAVAILABLE:['A01-derived decision is not ready.','القرار المبني على A01 غير متاح بعد.'],
      CASE_DECISION_CODE_UNSUPPORTED:['Unknown decision. Choose an allowed POC catalogue option.','قرار غير معروف؛ اختر من قائمة القرارات المسموحة.'],
      CASE_SINGLE_DECISION_MODE:['Use the single operational decision review rather than legacy action buttons.','استخدم مراجعة القرار التشغيلي الموحد بدلًا من أزرار الإجراءات القديمة.'],
      CASE_RESTRICTION_AUTHORITY_EVIDENCE_REQUIRED:['Add a supervisor demo reference (6–80 safe characters) and legal review rationale (10–500). No restriction applied.','أدخل مرجع اعتماد تجريبي ومبرر المراجعة القانونية؛ لم يُطبق أي منع.'],
      CASE_RESTRICTION_RELEASE_EVIDENCE_REQUIRED:['Provide a release reference and rectification evidence reference.','أدخل مرجع الإفراج ومرجع أدلة الإصلاح.'],
      CASE_RESTRICTION_AUTHORIZATION_REQUIRED:['The POC restriction needs explicit supervisor simulation authorization.','يتطلب المنع التجريبي اعتماد مشرف صريحًا.'],
      CASE_RESTRICTION_STILL_ACTIVE:['A pending/active restriction blocks case closure until simulated release.','لا يمكن إغلاق الحالة حتى رفع القيد التجريبي.'],
      CASE_RESTRICTION_NOT_PENDING:['Restriction is not awaiting simulation authorization.','القيد ليس في انتظار الاعتماد التجريبي.'],
      CASE_RESTRICTION_NOT_ACTIVE:['No active simulated restriction to release.','لا يوجد قيد تجريبي نشط لرفعه.'],
      CASE_CREATION_AI_REQUIRED:['AI action generation must be explicitly requested when creating the case.','يجب طلب توصيات A01 ضمن إجراء إنشاء الحالة.'],
      CASE_SCHEMA_NOT_READY:['Case database migration 004 is required.','يجب تطبيق تحديث قاعدة البيانات رقم 004.'],
      CASE_STORE_UNAVAILABLE:['Case service is unavailable.','خدمة إدارة الحالات غير متاحة.'],
      CASE_ALERT_ACK_REQUIRED:['Acknowledge this alert before creating a case.','يجب استلام التنبيه قبل فتح حالة.'],
      CASE_VERSION_CONFLICT:['The case has been updated in another session. Reload it.','تم تعديل الحالة في جلسة أخرى. أعد تحميلها.'],
      A01_ACTIONS_NOT_AVAILABLE:['A01 did not provide a valid situation action plan. Verify the Airia pipeline contract.','لم يرجع A01 خطة إجراءات صحيحة. راجع مخرجات Airia.'],
      A01_UNSUPPORTED_RESPONSE:['A01 response format is unsupported; no tasks were created.','تنسيق استجابة A01 غير مدعوم ولم يتم إنشاء مهام.'],
      A01_ACTION_EVIDENCE_MISSING:['A01 proposal lacks verified source evidence.','اقتراح A01 لا يحتوي أدلة مصدر تم التحقق منها.'],
      A01_ACTION_INVALID:['A01 returned an unsupported action type or duplicate identifier.','أعاد A01 نوع إجراء غير مدعوم أو معرفًا مكررًا.'],
      CASE_SOURCE_ASSESSMENT_UNAVAILABLE:['The original assessment or its exact risk evidence could not be verified. No AI call was made.','تعذر التحقق من التقييم الأصلي أو أدلة المخاطر المرتبطة به؛ لم يتم استدعاء AI.'],
      CASE_HISTORICAL_ASSESSMENT_REVIEW_REQUIRED:['A newer risk assessment exists. Review and explicitly acknowledge use of the ORIGINAL case assessment before requesting A01.','يوجد تقييم مخاطر أحدث. راجع وأكد صراحةً استخدام التقييم الأصلي للحالة قبل طلب توصيات A01.'],
      CASE_HISTORICAL_ASSESSMENT_CONTEXT_CHANGED:['The latest risk assessment changed during your review. Refresh and review the assessment comparison again. No AI call was made.','تغير أحدث تقييم للمخاطر أثناء المراجعة. حدّث مقارنة التقييمات وراجعها مجدداً؛ لم يتم استدعاء AI.'],
      CASE_RISK_REASSESSMENT_PENDING:['Case closure is blocked: the completed inspection requires verified A02 evidence refresh and a new saved risk assessment. Original risk remains unchanged.','لا يمكن إغلاق الحالة: المعاينة المكتملة تتطلب تحديث أدلة A02 وإعادة تقييم مخاطر جديدة ومحفوظة؛ درجة المخاطر الأصلية لم تتغير.'],
      CASE_ACTION_DECISIONS_PENDING:['Review all A01 proposals before closing the case.','يجب اتخاذ قرار بشأن جميع توصيات A01 قبل إغلاق الحالة.'],
      CASE_ACTION_PLAN_REQUIRED:['Generate and review an A01 action plan before completion.','يجب إنشاء خطة إجراءات A01 ومراجعتها قبل الإغلاق.'],
      CASE_ACTION_PLAN_EXISTS:['The action plan already exists; refresh this case.','خطة الإجراءات موجودة بالفعل. حدث الحالة.'],
      CASE_ACTION_ALREADY_DECIDED:['This AI proposal has already been decided.','تم اتخاذ قرار بشأن هذا الاقتراح بالفعل.'],
      CASE_INSPECTION_NOT_SCHEDULED:['Schedule the inspection from Smart Inspection before submitting its results.','يجب جدولة المعاينة في المعاينة الذكية قبل تسجيل النتائج.'],
      CASE_INSPECTION_SCHEDULE_CONFLICT:['Inspection request was already scheduled; refresh the queue.','تمت جدولة طلب المعاينة. حدث القائمة.'],
      CASE_SCHEDULE_INVALID:['Select a future date/time, inspection port and inspector.','حدد موعدًا مستقبليًا وميناءً ومعاينًا.'],
      A01_ACTION_PLAN_UNAVAILABLE:['Airia A01 action plan call failed. Nothing was created.','تعذر تنفيذ خطة إجراءات Airia A01؛ لم يتم إنشاء أي شيء.'],
      AIRIA_NOT_CONFIGURED:['Airia API is not configured for the POC.','لم يتم إعداد اتصال Airia لهذا الاختبار.'],
      CASE_TASK_TRANSITION_INVALID:['This task action is unavailable in its current state.','الإجراء غير متاح في الحالة الحالية للمهمة.'],
      CASE_INSPECTION_EVIDENCE_REQUIRED:['Record the inspection outcome before completing this task.','يجب تسجيل نتيجة المعاينة قبل استكمال المهمة.'],
      CASE_RESOLUTION_NOTE_REQUIRED:['A resolution reason is required.','يجب إدخال سبب الإغلاق.'],
      CASE_MANDATORY_TASKS_INCOMPLETE:['Complete all mandatory tasks before resolution.','يجب استكمال المهام الإلزامية قبل الإغلاق.'],
      CASE_DECISION_REASON_REQUIRED:['Provide a reason for modifying or rejecting a recommendation.','يجب تسجيل سبب تعديل أو رفض التوصية.'],
      CASE_MODIFICATION_ROUTE_REQUIRED:['Select an allowed replacement route for Modify.','اختر مسار إجراء بديل مسموح عند التعديل.'],
      CASE_MODIFICATION_MUST_CHANGE_ROUTE:['Modified action must differ from the original.','يجب أن يختلف الإجراء المعدل عن الإجراء الأصلي.'],
      CASE_MODIFICATION_ROUTE_UNEXPECTED:['Replacement is only valid with Modify.','لا يجوز استخدام المسار البديل إلا عند التعديل.'],
      CASE_SUPERVISOR_REQUIRED:['Supervisor authorization is required.','تتطلب العملية اعتماد المشرف.'],
      DASHBOARD_ACCESS_DENIED:['Invalid access key.','مفتاح الصلاحية غير صحيح.']
    };
    const pair=messages[code];return pair?(ar?pair[1]:pair[0]):(ar?
      'تعذر تنفيذ الإجراء. راجع البيانات والاتصال بالخادم.':
      'Unable to complete the action. Check the data and server connection.');
  }
}
