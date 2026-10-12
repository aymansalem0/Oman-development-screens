import {Injectable} from '@angular/core';
import {HttpClient,HttpHeaders} from '@angular/common/http';
import {Observable,throwError} from 'rxjs';
import {catchError} from 'rxjs/operators';

export type IncidentFollowup='VERIFY_INFORMATION'|'ACTIVE_MONITORING'|
  'REFER_SMART_INSPECTION'|'ESCALATE_TO_AUTHORITY'|
  'INCIDENT_RESPONSE'|'CLOSE_AFTER_VERIFICATION';
export interface IncidentAiAssessment {
  incidentId:string;descriptionHash:string;assessmentId:string;assessedAt:string;
  aiProvider:string;aiModel:string;category:string;
  impact:number;urgency:number;exposure:number;recurrence:number;
  incidentRiskScore:number;incidentRiskBand:'LOW'|'MODERATE'|'HIGH'|'CRITICAL';
  aiProposedFollowup:IncidentFollowup;aiReasoning:string;confidence:number;
  missingInformation:string[];officerDecision?:string|null;
  approvedFollowupStatus?:IncidentFollowup|null;officerName?:string|null;
  suggestedFollowupState?:string;approvedFollowupState?:string|null;
  officerReviewReason?:string|null;
  aiEvidenceIds?:string[];
  a02IncidentCompliance?:{status:string;evidenceIds:string[];reasoning:string;authoritative:false};
  contractVersion?:string|null;
  assessmentStatus:string;
}
export interface NmcMaritimeIncident {
  incidentId:string;sourceType:'PORT_AUTHORITY'|'REPORTING_PLATFORM';
  sourceOrganization:string;sourceReference:string;reportedAt:string;
  occurredAt:string;imo:string|null;vesselName:string;incidentType:string;
  portOrZone:string;latitude:string;longitude:string;description:string;
  sourceIncidentStatus:string;operationalStatus:string;reportedSeverity:string;
  personsAffected:string;pollutionReported:string;evidenceReference:string;
  receivedAt:string;updatedAt:string;assignedOfficer:string;
  dataNature:'SYNTHETIC_POC';aiReviewRequested:boolean;rowNumber:number;
  aiAssessment:IncidentAiAssessment|null;aiAssessmentStale:boolean;
  nextFollowup?:{status:string;approval:'AI_PROPOSED'|'OFFICER_APPROVED';reason:string}|null;
  linkedCaseId?:string|null;linkedCaseStatus?:string|null;
  caseIncidentDecisionStatus?:'PENDING_HUMAN_REVIEW'|'OFFICER_APPROVED'|null;
}
export interface IncidentFeedResponse{
  status:'ok';source:string;incidents:NmcMaritimeIncident[];
  summary:{total:number;unresolved:number;pendingAi:number;aiAnalyzed:number};
  sourceValidationWarnings?:number;
  rejectedRows?:{rowNumber:number;code:string}[];
  aiEnabled:boolean;riskMode:string;
}
export interface IncidentFeedHealth{
  status:'ok';sourceConfigured:boolean;aiConfigured:boolean;
  aiProvider:string;scorePolicy:string;realEnforcementEnabled:false;
  automaticTriageEnabled?:boolean;autoMaxPerCycle?:number;
  lastAutoRun?:{at:string;assessed:number;failed:number;skipped:number}|null;
}
@Injectable({providedIn:'root'})
export class NmcIncidentsService {
  private readonly base='/api/ai/nmc/incidents';
  private editorKey='MOEI_SESSION';
  constructor(private readonly http:HttpClient){}
  list():Observable<IncidentFeedResponse>{
    return this.http.get<IncidentFeedResponse>(this.base);
  }
  health():Observable<IncidentFeedHealth>{
    return this.http.get<IncidentFeedHealth>(this.base+'/health');
  }
  analyze(id:string,force=false):Observable<{status:'ok';reused:boolean;assessment:IncidentAiAssessment}>{
    if(!this.editorKey){
      this.editorKey='MOEI_SESSION';
    }
    return this.http.post<{status:'ok';reused:boolean;assessment:IncidentAiAssessment}>(
      this.base+'/'+encodeURIComponent(id)+'/analyze',
      {confirmCost:true,force},{
        headers:new HttpHeaders({'X-NMC-DASHBOARD-KEY':this.editorKey})
      }).pipe(catchError(e=>{
        if(e?.status===403)this.editorKey='MOEI_SESSION';
        return throwError(()=>e);
      }));
  }
  review(id:string,assessmentId:string,decision:'ACCEPT'|'MODIFY'|'REJECT',
    approvedFollowup:IncidentFollowup,note:string,officer:string):
      Observable<{status:'ok';saved:boolean}>{
    if(!this.editorKey){
      this.editorKey='MOEI_SESSION';
    }
    return this.http.post<{status:'ok';saved:boolean}>(
      this.base+'/'+encodeURIComponent(id)+'/review',
      {assessmentId,decision,approvedFollowup,note,officer},
      {headers:new HttpHeaders({'X-NMC-DASHBOARD-KEY':this.editorKey})}
    ).pipe(catchError(e=>{
      if(e?.status===403)this.editorKey='MOEI_SESSION';
      return throwError(()=>e);
    }));
  }
  message(e:unknown,ar:boolean):string{
    const error=e as {message?:string;error?:{error?:string}}|null;
    if(error?.message==='ACTION_CANCELLED')return ar?'تم إلغاء العملية.':'Cancelled.';
    const code=error?.error?.error||error?.message||'INCIDENT_SOURCE_UNAVAILABLE';
    const labels:Record<string,[string,string]>={
      INCIDENT_SHEET_NOT_CONFIGURED:['Incident Google Sheet is not configured in Docker.','يجب تهيئة ملف حوادث Google Sheet داخل Docker.'],
      INCIDENT_GOOGLE_CREDENTIALS_MISSING:['Mount read/write incident Google service account key.','أضف مفتاح Google Service Account بصلاحية قراءة وكتابة.'],
      INCIDENT_SHEET_ACCESS_DENIED:['Share the dedicated sheet with the service account as Editor.','شارك الشيت مع حساب الخدمة بصلاحية محرر.'],
      INCIDENT_AI_NOT_CONFIGURED:['Enable the existing A01/A02 agents and AIRIA_MENA_KEY.','فعّل نفس A01 وA02 ومفتاح AIRIA_MENA_KEY الحالي.'],
      AIRIA_A01_A02_NOT_ENABLED:['Existing Airia A01 and A02 pipelines or shared AIRIA_MENA_KEY are disabled.','مفتاح Airia الحالي أو A01/A02 غير مفعّل.'],
      INCIDENT_VESSEL_CONTEXT_REQUIRED:['A valid vessel IMO is needed to reuse existing A01/A02 maritime evidence.','يجب إدخال IMO صحيح لربط البلاغ بأدلة السفينة الموجودة في A01/A02.'],
      INCIDENT_SAVED_VESSEL_EVIDENCE_REQUIRED:['A completed saved A01/A02 vessel assessment is needed for the original situation context.','يجب توفر تقييم سفينة مكتمل ومحفوظ من A01/A02 لتكوين سياق الموقف الحالي.'],
      INCIDENT_A02_EXISTING_RESPONSE_INVALID:['A02 did not return the documented vessel risk-signals response; no incident assessment was saved.','A02 لم يرجع Risk Signals بالصورة المعتمدة، ولم يُحفظ تقييم للحادث.'],
      INCIDENT_A01_EXISTING_RESPONSE_INVALID:['A01 did not return its existing situation-assessment response; no incident score was saved.','A01 لم يرجع تحليل الموقف بالصورة الحالية المعتمدة، ولم تُحفظ درجة الحادث.'],
      INCIDENT_A01_DID_NOT_CITE_REPORT:['A01 did not cite the incident report evidence. Cannot claim AI analyzed the incident. No incident score was saved.','A01 لم يستشهد بدليل البلاغ؛ لا يمكن اعتبار أنه حلّل الحادث ولم تُحفظ درجة مخاطر.'],
      INCIDENT_A01_UNVERIFIED_EVIDENCE:['A01 cited evidence that was not supplied by the platform. No incident score was saved.','A01 استشهد بدليل غير وارد من المنصة، ولم تُحفظ درجة الحادث.'],
      INCIDENT_VESSEL_BUNDLE_REQUIRED:['The existing vessel evidence bundle could not be loaded for this IMO.','لم يتم العثور على ملف أدلة السفينة الموجود للـIMO.'],
      INCIDENT_HISTORY_SIGNAL_REQUIRED:['The saved history evidence is missing and cannot safely carry the incident report.','إشارة التاريخ المحفوظة غير موجودة؛ لا يمكن تمرير وصف البلاغ في الطلب الحالي.'],
      INCIDENT_A01_AGENT_UNAVAILABLE:['Existing A01 situation assessment could not be completed.','تعذر تنفيذ A01 لتحليل الموقف البحري.'],
      INCIDENT_A02_AGENT_UNAVAILABLE:['Existing A02 compliance review could not be completed.','تعذر تنفيذ A02 لمراجعة الامتثال.'],
      INCIDENT_AI_OPTIN_REQUIRED:['Enable AI_Review_Request=YES for this incident in the Google Sheet.','اجعل AI_Review_Request بقيمة YES في الشيت.'],
      INCIDENT_AI_RESPONSE_INVALID:['The model returned an invalid incident schema; nothing was saved.','استجابة نموذج AI غير مطابقة؛ لم تحفظ نتيجة.'],
      INCIDENT_SOURCE_CHANGED_DURING_AI:['Description changed while AI was analyzing. Refresh and retry.','وصف الحادث تغيّر أثناء التحليل؛ حدث البيانات ثم حاول ثانية.'],
      INCIDENT_ALREADY_REVIEWED:['The officer-reviewed assessment is immutable. Edit the source report to request a fresh assessment.','التقييم الذي اعتمده الموظف محفوظ وغير قابل للاستبدال. عدّل وصف البلاغ لإجراء تقييم جديد.'],
      INCIDENT_AI_ALREADY_RUNNING:['The incident AI review is already running; wait for completion.','تحليل هذا الحادث قيد التنفيذ بالفعل؛ انتظر إتمامه.']
    };
    return labels[code]?.[ar?1:0]||code;
  }
}
