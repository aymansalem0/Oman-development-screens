import {Injectable} from '@angular/core';
import {HttpClient,HttpHeaders} from '@angular/common/http';
import {Observable,throwError} from 'rxjs';
import {catchError} from 'rxjs/operators';

export type NmcKpiMetricId=
  'vesselContacts'|'assessedVessels'|'highRiskVessels'|'criticalRiskVessels'|
  'requiresAttention'|'activeAlerts'|'openCases'|'activeIncidents';
export type NmcKpiValues=Record<NmcKpiMetricId,number|null>;
export interface NmcAiFocusStatus {
  status:'ok';configured:boolean;assessmentContextReady:boolean;
  sourceImo:string|null;automaticAiCalls:false;
  agentIds:['A02','A01'];potentialAgentCalls:2;
  requestContracts:'EXISTING_A02_SIGNALS_AND_A01_SITUATION_ASSESSMENT';
  requiresExplicitOperatorConfirmation:true;
  dataNature:'SYNTHETIC_POC_ADVISORY_ONLY';
}
export interface NmcAiFocusResult {
  status:'ok';provider:'AIRIA_EXISTING_A01_A02';
  modelBased:true;reused:boolean;analyzedAt:string;
  snapshot:NmcKpiValues;snapshotHash:string;
  selection:{metricId:NmcKpiMetricId;value:number;reasonEn:string;
    reasonAr:string;confidence:number|null;a01Priority:string;
    a01Summary:string;evidenceIds:string[];
    a01Evidence?:{title:string;evidenceIds:string[]}[];
    a01Actions?:{actionType:string;summary:string;priority:string;
      evidenceIds:string[];requiresHumanApproval:true}[]};
  sourceImo:string;sourceAssessmentId:string;a02VerifiedFactors:string[];
  requiresHumanReview:true;dataNature:'SYNTHETIC_POC_ADVISORY_ONLY';
}

@Injectable({providedIn:'root'})
export class NmcAiFocusService{
  private readonly base='/api/ai/nmc/dashboard-focus';
  private operatorKey='MOEI_SESSION';
  constructor(private http:HttpClient){}
  status():Observable<NmcAiFocusStatus>{
    return this.http.get<NmcAiFocusStatus>(this.base+'/status');
  }
  run(metrics:NmcKpiValues):Observable<NmcAiFocusResult>{
    if(!this.operatorKey){
      this.operatorKey='MOEI_SESSION';
    }
    return this.http.post<NmcAiFocusResult>(this.base+'/run',
      {metrics,confirmCost:true},
      {headers:new HttpHeaders({'X-NMC-DASHBOARD-KEY':this.operatorKey})}).pipe(
        catchError(e=>{
          if(e?.status===403)this.operatorKey='MOEI_SESSION';
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
      DASHBOARD_FOCUS_A01_A02_NOT_ENABLED:[
        'Enable the existing A01 and A02 agents and opt in dashboard focus. No new pipeline is needed.',
        'فعّل الوكيلين A01 وA02 وخيار تحليل مؤشرات لوحة القيادة؛ لا يلزم مسار جديد.'
      ],
      DASHBOARD_FOCUS_VESSEL_EVIDENCE_UNAVAILABLE:[
        'A completed saved vessel AI assessment with evidence is required to ground the existing A01/A02 request.',
        'يلزم تقييم سفينة محفوظ ومكتمل مع أدلة حتى يعمل طلب A01/A02 الأصلي.'
      ],
      DASHBOARD_FOCUS_A01_MARKER_MISSING:[
        'Existing A01 response did not specify exactly one KPI in whyItMatters. No number was highlighted.',
        'لم تحدد استجابة A01 مؤشراً واحداً بوضوح في whyItMatters؛ لم يتم تمييز أي رقم.'
      ],
      DASHBOARD_FOCUS_A01_MARKER_INVALID:[
        'The A01 response selected an unavailable or unknown KPI. No number was highlighted.',
        'اختارت استجابة A01 مؤشراً غير معروف أو غير متاح؛ لم يتم تمييز أي رقم.'
      ],
      DASHBOARD_FOCUS_A01_INVALID:[
        'The A01 situation assessment response did not match its existing contract.',
        'استجابة تقييم الموقف A01 لا تطابق العقد الأصلي.'
      ],
      DASHBOARD_FOCUS_A02_INVALID:[
        'The A02 compliance risk-signals response did not match its existing contract.',
        'استجابة مؤشرات المخاطر A02 لا تطابق العقد الأصلي.'
      ],
      DASHBOARD_FOCUS_A01_EVIDENCE_INVALID:[
        'A01 did not cite valid underlying vessel evidence; no KPI was highlighted.',
        'لم يستشهد A01 بأدلة سفينة سليمة؛ لم يتم تمييز أي مؤشر.'
      ],
      DASHBOARD_FOCUS_INSUFFICIENT_DATA:[
        'Wait for current dashboard sources before requesting AI focus.',
        'انتظر اكتمال تحميل بيانات لوحة القيادة قبل طلب تحليل AI.'
      ],
      DASHBOARD_FOCUS_CONFIRM_REQUIRED:[
        'Explicit AI execution confirmation required.',
        'يلزم التأكيد صراحةً قبل تشغيل وكيل AI.'
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
        'Dashboard A01/A02 focus is temporarily unavailable; no KPI was selected.',
        'تحليل A01/A02 لأولوية المؤشرات غير متاح مؤقتاً؛ لم يتم اختيار مؤشر.'
      ],
      DASHBOARD_FOCUS_A01_UNAVAILABLE:[
        'A01 situation assessment failed; A02 may already have been invoked. No KPI was highlighted.',
        'تعذر تحليل الموقف A01 وقد يكون A02 قد تم استدعاؤه؛ لم يتم تمييز مؤشر.'
      ],
      DASHBOARD_FOCUS_A02_UNAVAILABLE:[
        'A02 risk-signals assessment failed; no A01 was started and no KPI was highlighted.',
        'تعذر تقييم مؤشرات المخاطر A02؛ لم يبدأ A01 ولم يتم تمييز مؤشر.'
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
