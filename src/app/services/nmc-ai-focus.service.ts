import {Injectable} from '@angular/core';
import {HttpClient,HttpHeaders} from '@angular/common/http';
import {Observable,throwError} from 'rxjs';
import {catchError} from 'rxjs/operators';

export type NmcKpiMetricId=
  'vesselContacts'|'assessedVessels'|'highRiskVessels'|'criticalRiskVessels'|
  'requiresAttention'|'activeAlerts'|'openCases'|'activeIncidents';
export type NmcKpiValues=Record<NmcKpiMetricId,number|null>;
export interface NmcAiFocusStatus {
  status:'ok';configured:boolean;automaticAiCalls:false;
  requiresExplicitOperatorConfirmation:true;
  dataNature:'SYNTHETIC_POC_ADVISORY_ONLY';
}
export interface NmcAiFocusResult {
  status:'ok';provider:'AIRIA_DEDICATED_DASHBOARD_PIPELINE';
  modelBased:true;reused:boolean;analyzedAt:string;
  snapshot:NmcKpiValues;snapshotHash:string;
  selection:{metricId:NmcKpiMetricId;value:number;reasonEn:string;
    reasonAr:string;confidence:number|null};
  requiresHumanReview:true;dataNature:'SYNTHETIC_POC_ADVISORY_ONLY';
}

@Injectable({providedIn:'root'})
export class NmcAiFocusService{
  private readonly base='/api/ai/nmc/dashboard-focus';
  private operatorKey='';
  constructor(private http:HttpClient){}
  status():Observable<NmcAiFocusStatus>{
    return this.http.get<NmcAiFocusStatus>(this.base+'/status');
  }
  run(metrics:NmcKpiValues):Observable<NmcAiFocusResult>{
    if(!this.operatorKey){
      const key=window.prompt('NMC Dashboard Editor action key (not the Airia API key)');
      if(!key?.trim())return throwError(()=>new Error('ACTION_CANCELLED'));
      this.operatorKey=key.trim();
    }
    return this.http.post<NmcAiFocusResult>(this.base+'/run',
      {metrics,confirmCost:true},
      {headers:new HttpHeaders({'X-NMC-DASHBOARD-KEY':this.operatorKey})}).pipe(
        catchError(e=>{
          if(e?.status===403)this.operatorKey='';
          return throwError(()=>e);
        })
      );
  }
  readableError(e:unknown,ar:boolean):string{
    const err=e as {message?:string;error?:{error?:string}}|null;
    if(err?.message==='ACTION_CANCELLED')
      return ar?'تم إلغاء الطلب.':'Request cancelled.';
    const code=err?.error?.error||'DASHBOARD_FOCUS_AI_UNAVAILABLE';
    const messages:Record<string,[string,string]>={
      DASHBOARD_FOCUS_PIPELINE_NOT_CONFIGURED:[
        'The dedicated dashboard KPI AI pipeline is not configured. No Airia request was made.',
        'مسار Airia المخصص لترتيب مؤشرات لوحة القيادة غير مهيأ. لم يتم استدعاء AI.'
      ],
      DASHBOARD_FOCUS_INSUFFICIENT_DATA:[
        'Wait for current dashboard sources before requesting AI focus.',
        'انتظر اكتمال تحميل بيانات لوحة القيادة قبل طلب تحليل AI.'
      ],
      DASHBOARD_FOCUS_CONFIRM_REQUIRED:[
        'Explicit AI cost confirmation required.',
        'يلزم تأكيد تكلفة استدعاء AI صراحةً.'
      ],
      DASHBOARD_FOCUS_AI_RESPONSE_INVALID:[
        'Airia did not return the required KPI focus contract. No indicator was highlighted.',
        'لم يرجع Airia استجابة مطابقة لترتيب المؤشرات؛ لم يتم تمييز أي رقم.'
      ],
      DASHBOARD_FOCUS_IN_PROGRESS:[
        'The dashboard focus AI request is already running.',
        'طلب تحليل مؤشرات لوحة القيادة ما زال قيد التنفيذ.'
      ],
      DASHBOARD_FOCUS_AI_UNAVAILABLE:[
        'Dashboard focus AI is temporarily unavailable; no metric was selected.',
        'تحليل AI الخاص بأولوية المؤشرات غير متاح مؤقتاً؛ لم يتم اختيار رقم.'
      ],
      DASHBOARD_FOCUS_METRICS_INVALID:[
        'The KPI snapshot is invalid. Refresh the dashboard and try again.',
        'قيم مؤشرات لوحة القيادة غير صالحة؛ حدث الصفحة ثم حاول مجدداً.'
      ],
      DASHBOARD_ACCESS_DENIED:[
        'Dashboard Editor key is incorrect.',
        'مفتاح محرر لوحة القيادة غير صحيح.'
      ],
      DASHBOARD_WRITE_NOT_CONFIGURED:[
        'Dashboard Editor access key is not configured on the server.',
        'لم يتم تهيئة مفتاح محرر لوحة القيادة على الخادم.'
      ]
    };
    return messages[code]?.[ar?1:0]||code;
  }
}
