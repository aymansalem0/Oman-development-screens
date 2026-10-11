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
  private editorKey='';
  constructor(private readonly http:HttpClient){}
  list():Observable<IncidentFeedResponse>{
    return this.http.get<IncidentFeedResponse>(this.base);
  }
  health():Observable<IncidentFeedHealth>{
    return this.http.get<IncidentFeedHealth>(this.base+'/health');
  }
  analyze(id:string,force=false):Observable<{status:'ok';reused:boolean;assessment:IncidentAiAssessment}>{
    if(!this.editorKey){
      const key=window.prompt('NMC POC operator action key (not your AI API key)');
      if(!key?.trim())return throwError(()=>new Error('ACTION_CANCELLED'));
      this.editorKey=key.trim();
    }
    return this.http.post<{status:'ok';reused:boolean;assessment:IncidentAiAssessment}>(
      this.base+'/'+encodeURIComponent(id)+'/analyze',
      {confirmCost:true,force},{
        headers:new HttpHeaders({'X-NMC-DASHBOARD-KEY':this.editorKey})
      }).pipe(catchError(e=>{
        if(e?.status===403)this.editorKey='';
        return throwError(()=>e);
      }));
  }
  review(id:string,assessmentId:string,decision:'ACCEPT'|'MODIFY'|'REJECT',
    approvedFollowup:IncidentFollowup,note:string,officer:string):
      Observable<{status:'ok';saved:boolean}>{
    if(!this.editorKey){
      const key=window.prompt('NMC POC operator action key (not your AI API key)');
      if(!key?.trim())return throwError(()=>new Error('ACTION_CANCELLED'));
      this.editorKey=key.trim();
    }
    return this.http.post<{status:'ok';saved:boolean}>(
      this.base+'/'+encodeURIComponent(id)+'/review',
      {assessmentId,decision,approvedFollowup,note,officer},
      {headers:new HttpHeaders({'X-NMC-DASHBOARD-KEY':this.editorKey})}
    ).pipe(catchError(e=>{
      if(e?.status===403)this.editorKey='';
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
      INCIDENT_SAVED_VESSEL_EVIDENCE_REQUIRED:['A01/A02 saved vessel assessment is required before extending it to incident triage.','يجب توفر تقييم A01/A02 محفوظ للسفينة قبل تحليل الحادث.'],
      INCIDENT_A02_CONTRACT_EXTENSION_REQUIRED:['A02 pipeline did not return the required incidentCompliance extension. Update and test the existing A02 prompt/schema. No score was saved.','A02 الحالي لا يعيد عقد incidentCompliance المطلوب. يلزم تحديث الـPrompt والـSchema واختبارهما، ولم تحفظ درجة الحادث.'],
      INCIDENT_A01_CONTRACT_EXTENSION_REQUIRED:['A01 pipeline did not return the required incidentTriage extension. Update and test the existing A01 prompt/schema. No score was saved.','A01 الحالي لا يعيد عقد incidentTriage المطلوب. يلزم تحديث الـPrompt والـSchema واختبارهما، ولم تحفظ درجة الحادث.'],
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
