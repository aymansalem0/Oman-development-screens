import {Injectable} from '@angular/core';
import {HttpClient,HttpHeaders} from '@angular/common/http';
import {Observable,throwError} from 'rxjs';
import {catchError} from 'rxjs/operators';

export type NmcCentralCaseStatus='OPEN'|'IN_PROGRESS'|'PENDING_VERIFICATION'|'RESOLVED';
export type NmcCentralTaskStatus='Assigned'|'In Progress'|'Completed'|'Escalated';
export interface NmcCentralCaseTask {
  id:string;status:NmcCentralTaskStatus;
  assignedRole:string;mandatory:boolean;evidenceIds:string[];
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
    const messages:Record<string,[string,string]>={
      CASE_SCHEMA_NOT_READY:['Case database migration 004 is required.','يجب تطبيق تحديث قاعدة البيانات رقم 004.'],
      CASE_STORE_UNAVAILABLE:['Case service is unavailable.','خدمة إدارة الحالات غير متاحة.'],
      CASE_ALERT_ACK_REQUIRED:['Acknowledge this alert before creating a case.','يجب استلام التنبيه قبل فتح حالة.'],
      CASE_VERSION_CONFLICT:['The case has been updated in another session. Reload it.','تم تعديل الحالة في جلسة أخرى. أعد تحميلها.'],
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
