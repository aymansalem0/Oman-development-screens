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
  reason?:string;provenance?:string;
}
export interface NmcAiAction {
  actionId:string;actionType:string;title:string;reason:string;
  priority:string;ownerRole:string;confidence:number;
  evidenceIds:string[];requiresHumanApproval:boolean;
  decision:'PENDING'|'ACCEPT'|'REJECT'|'MODIFY';decisionNote?:string;
}
export interface NmcAiActionPlan {
  source:string;sourceAssessmentId:string|null;sourceScore:number;
  sourceLevel:string;configVersion:string|null;summary:string;whyItMatters:string;
  agentAssessmentId:string|null;createdAt:string;proposedActions:NmcAiAction[];
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
export interface NmcCentralCase {
  id:string;imo:string;status:NmcCentralCaseStatus;
  assignedRole:string;source:string;sourceAssessmentId:string|null;
  alertIds:string[];sourceScore:number;sourceLevel:string;
  createdAt:string;updatedAt:string;version:number;
  tasks:NmcCentralCaseTask[];decisions:NmcCentralDecision[];
  actionPlan?:NmcAiActionPlan|null;
  inspectionRequests?:NmcInspectionReferral[];
  inspectionOutcome:NmcCentralInspection|null;
  resolutionNote:string|null;provenance:string;
}
export interface NmcCentralCaseAudit {
  version:number;action:string;role:string;note:string;
  details:{[key:string]:string|number|boolean|null};
  at:string;
}
interface CaseResponse{status:'ok';case:NmcCentralCase|null}
interface CaseHistoryResponse{status:'ok';history:NmcCentralCaseAudit[]}

@Injectable({providedIn:'root'})
export class NmcCasesService {
  private readonly root='/api/ai/cases';
  private editorKey='';
  private publisherKey='';
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
    return this.mutate(this.root+'/from-alert',{alertId},false);
  }
  generateActionPlan(current:NmcCentralCase):Observable<CaseResponse>{
    return this.mutate(this.path(current.id)+'/action-plan/generate',
      {version:current.version},false);
  }
  decideAiAction(current:NmcCentralCase,actionId:string,
    decision:'ACCEPT'|'MODIFY'|'REJECT',note=''):Observable<CaseResponse>{
    return this.mutate(this.path(current.id)+'/actions/'+encodeURIComponent(actionId)+'/decision',
      {version:current.version,decision,note},false);
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
      const value=window.prompt(publisher?'Supervisor approval key':'Operator action key');
      if(!value?.trim())return throwError(()=>new Error('ACTION_CANCELLED'));
      key=value.trim();
      if(publisher)this.publisherKey=key;
      else this.editorKey=key;
    }
    return this.http.post<CaseResponse>(path,body,{
      headers:new HttpHeaders({'X-NMC-DASHBOARD-KEY':key})
    }).pipe(catchError(err=>{
      if(err?.status===403){
        if(publisher)this.publisherKey='';
        else this.editorKey='';
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
      CASE_SCHEMA_NOT_READY:['Case database migration 004 is required.','يجب تطبيق تحديث قاعدة البيانات رقم 004.'],
      CASE_STORE_UNAVAILABLE:['Case service is unavailable.','خدمة إدارة الحالات غير متاحة.'],
      CASE_ALERT_ACK_REQUIRED:['Acknowledge this alert before creating a case.','يجب استلام التنبيه قبل فتح حالة.'],
      CASE_VERSION_CONFLICT:['The case has been updated in another session. Reload it.','تم تعديل الحالة في جلسة أخرى. أعد تحميلها.'],
      A01_ACTIONS_NOT_AVAILABLE:['A01 did not provide a valid situation action plan. Verify the Airia pipeline contract.','لم يرجع A01 خطة إجراءات صحيحة. راجع مخرجات Airia.'],
      A01_UNSUPPORTED_RESPONSE:['A01 response format is unsupported; no tasks were created.','تنسيق استجابة A01 غير مدعوم ولم يتم إنشاء مهام.'],
      A01_ACTION_EVIDENCE_MISSING:['A01 proposal lacks verified source evidence.','اقتراح A01 لا يحتوي أدلة مصدر تم التحقق منها.'],
      A01_ACTION_INVALID:['A01 returned an unsupported action type or duplicate identifier.','أعاد A01 نوع إجراء غير مدعوم أو معرفًا مكررًا.'],
      CASE_SOURCE_ASSESSMENT_UNAVAILABLE:['The original saved assessment is unavailable or was superseded. No AI run was made.','التقييم الأصلي غير متاح أو تم استبداله؛ لم يتم استدعاء AI.'],
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
      CASE_SUPERVISOR_REQUIRED:['Supervisor authorization is required.','تتطلب العملية اعتماد المشرف.'],
      DASHBOARD_ACCESS_DENIED:['Invalid access key.','مفتاح الصلاحية غير صحيح.']
    };
    const pair=messages[code];return pair?(ar?pair[1]:pair[0]):(ar?
      'تعذر تنفيذ الإجراء. راجع البيانات والاتصال بالخادم.':
      'Unable to complete the action. Check the data and server connection.');
  }
}
