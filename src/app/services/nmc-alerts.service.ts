import {Injectable} from '@angular/core';
import {HttpClient,HttpHeaders} from '@angular/common/http';
import {Observable,throwError} from 'rxjs';
import {catchError} from 'rxjs/operators';

export type AlertStatus='OPEN'|'ACKNOWLEDGED'|'IN_PROGRESS'|'ESCALATED'|'RESOLVED';
export type AlertSeverity='HIGH'|'CRITICAL';
export type AlertAction='ACKNOWLEDGE'|'START_FOLLOW_UP'|'ESCALATE'|'RESOLVE';
export interface NmcOperationalAlert {
  id:string;
  alertKey:string;
  imo:string;
  title:string;
  detail:string;
  severity:AlertSeverity;
  status:AlertStatus;
  assignedRole:'NMC_OFFICER'|'NMC_SUPERVISOR';
  source:'SAVED_AI_ASSESSMENT';
  sourceAssessmentId:string|null;
  sourceScore:number;
  sourceLevel:string;
  sourceRulesetVersion:string|null;
  actionHint:string;
  version:number;
  createdAt:string;
  updatedAt:string;
  provenance:'SYNTHETIC_POC_NON_REGULATORY';
}
export interface NmcAlertSummary {
  total:number;active:number;open:number;acknowledged:number;
  inProgress:number;escalated:number;critical:number;high:number;unread:number;
}
export interface NmcAlertsOverview{
  status:'ok';alerts:NmcOperationalAlert[];summary:NmcAlertSummary;updatedAt:string;
}
export interface NmcAlertAudit{
  version:number;
  action:'DETECTED'|AlertAction;
  role:'SYSTEM'|'OPERATOR'|'SUPERVISOR';
  note:string;at:string;
}
@Injectable({providedIn:'root'})
export class NmcAlertsService {
  private readonly root='/api/ai/alerts';
  private operatorKey='';
  private supervisorKey='';
  constructor(private readonly http:HttpClient){}

  overview():Observable<NmcAlertsOverview>{
    return this.http.get<NmcAlertsOverview>(this.root);
  }
  history(id:string):Observable<{status:'ok';history:NmcAlertAudit[]}>{
    return this.http.get<{status:'ok';history:NmcAlertAudit[]}>(
      this.root+'/'+encodeURIComponent(id)+'/history');
  }
  act(alert:NmcOperationalAlert,action:AlertAction,note:string):Observable<{
    status:'ok';alert:NmcOperationalAlert
  }>{
    const isSupervisor=action==='RESOLVE';
    const role=isSupervisor?'supervisor':'operator';
    let key=isSupervisor?this.supervisorKey:this.operatorKey;
    if(!key){
      const entered=window.prompt(isSupervisor
        ?'Supervisor approval key (POC access)'
        :'Operator action key (POC access)');
      if(!entered)return throwError(()=>new Error('ACTION_CANCELLED'));
      key=entered.trim();
      if(isSupervisor)this.supervisorKey=key;
      else this.operatorKey=key;
    }
    const slug:Record<AlertAction,string>={
      ACKNOWLEDGE:'acknowledge',START_FOLLOW_UP:'follow-up',
      ESCALATE:'escalate',RESOLVE:'resolve'
    };
    return this.http.post<{status:'ok';alert:NmcOperationalAlert}>(
      this.root+'/'+encodeURIComponent(alert.id)+'/'+slug[action],
      {version:alert.version,note},
      {headers:new HttpHeaders({'X-NMC-DASHBOARD-KEY':key})}
    ).pipe(catchError(err=>{
      if(err?.status===403||err?.status===503){
        if(isSupervisor)this.supervisorKey='';
        else this.operatorKey='';
      }
      return throwError(()=>err);
    }));
  }
  readableError(err:any,ar:boolean):string{
    if(err?.message==='ACTION_CANCELLED')return ar?'تم إلغاء الإجراء.':'Action cancelled.';
    const code=err?.error?.error||'';
    const messages:Record<string,[string,string]>={
      ALERT_SCHEMA_NOT_READY:['Alert database migration 003 is not applied.','يلزم تشغيل ترحيل قاعدة البيانات رقم 003.'],
      ALERT_STORE_UNAVAILABLE:['Alert service is unavailable.','خدمة التنبيهات غير متاحة حاليًا.'],
      ALERT_VERSION_CONFLICT:['Alert changed in another session. Refresh and retry.','تم تغيير التنبيه في جلسة أخرى. حدّث البيانات وأعد المحاولة.'],
      ALERT_TRANSITION_INVALID:['This action is not permitted in the current alert state.','هذا الإجراء غير مسموح في الحالة الحالية للتنبيه.'],
      ALERT_RESOLUTION_NOTE_REQUIRED:['Resolution reason is required.','يجب إدخال سبب إغلاق التنبيه.'],
      ALERT_SUPERVISOR_REQUIRED:['Supervisor approval is required.','يتطلب الإجراء موافقة المشرف.'],
      DASHBOARD_ACCESS_DENIED:['Incorrect access key.','مفتاح الصلاحية غير صحيح.'],
      DASHBOARD_WRITE_NOT_CONFIGURED:['Operator/supervisor keys are not configured on the server.','مفاتيح الصلاحيات غير مهيأة على الخادم.']
    };
    const v=messages[code];
    return v?(ar?v[1]:v[0]):(ar?'تعذر تنفيذ الإجراء. راجع الاتصال بالخادم.':'Unable to perform this action. Check service connectivity.');
  }
}
