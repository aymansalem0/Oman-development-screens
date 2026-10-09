import {Injectable} from '@angular/core';
import {HttpClient,HttpErrorResponse,HttpHeaders} from '@angular/common/http';
import {Observable,throwError} from 'rxjs';
import {catchError} from 'rxjs/operators';

export type GuidanceField='criticalOpenFinding'|'inspectionSeverity'|'certificateSeverity'|
  'historySeverity'|'movementSeverity'|'dataQualitySeverity'|'riskScore'|'riskLevel'|
  'operationalPriority'|'dataConflictDetected';
export interface GuidanceCondition {
  field:GuidanceField;
  operator:'EQUALS'|'GTE';
  value:boolean|number|string;
}
export interface GuidancePolicy {
  id:string;title:string;titleAr:string;
  enabled:boolean;priority:'ROUTINE'|'WATCH'|'HIGH'|'PRIORITY_REVIEW';
  ownerRole:string;condition:GuidanceCondition;additionalConditions?:GuidanceCondition[];
}
export interface GuidanceRuleState {
  id:string;revision:number;status:'ACTIVE'|'INACTIVE'|'DRAFT';
  publishedRevision:number;updatedAt:string;
  published:GuidancePolicy|null;draft:GuidancePolicy|null;
}
export interface GuidanceResult {
  id:string;ruleId:string;ruleRevision:number;title:string;titleAr:string;
  priority:string;ownerRole:string;source:'PLATFORM_BUSINESS_RULE';
  status:'ADVISORY_ONLY';condition:GuidanceCondition;observedValue:boolean|number|string;
  evidenceIds:string[];assessmentId:string;factor:string;agent:string|null;
  generatedAt:string;
  matchedConditions?:Array<{condition:GuidanceCondition;observedValue:boolean|number|string}>;
}
export interface GuidanceEvaluation {
  status:'ok';imo:string;assessmentId:string;assessedAt:string;
  riskScore:number;riskLevel:string;operationalPriority:string;
  source:'SYNTHETIC_POC_NOT_REGULATORY';policyCount:number;rules:GuidanceResult[];
}
@Injectable({providedIn:'root'})
export class NmcOperationalGuidanceService {
  private readonly base='/api/ai/guidance';
  private editorKey='';private publisherKey='';
  constructor(private readonly http:HttpClient){}
  forVessel(imo:string):Observable<GuidanceEvaluation>{
    return this.http.get<GuidanceEvaluation>(this.base+'/vessels/'+encodeURIComponent(imo));
  }
  list():Observable<{status:'ok';rules:GuidanceRuleState[]}>{
    return this.http.get<{status:'ok';rules:GuidanceRuleState[]}>(this.base+'/rules');
  }
  history(ruleId:string):Observable<{status:'ok';history:Array<{revision:number;action:string;role:string;at:string}>}>{
    return this.http.get<{status:'ok';history:Array<{revision:number;action:string;role:string;at:string}>}>(
      this.base+'/rules/'+encodeURIComponent(ruleId)+'/history');
  }
  createDraft(rule:GuidancePolicy):Observable<{status:'ok';rule:GuidanceRuleState}>{
    return this.http.post<{status:'ok';rule:GuidanceRuleState}>(
      this.base+'/rules',{rule},{headers:this.auth('editor')})
      .pipe(catchError(e=>this.resetOnAuth(e,'editor')));
  }
  saveDraft(rule:GuidanceRuleState,draft:GuidancePolicy):Observable<{status:'ok';rule:GuidanceRuleState}>{
    return this.http.put<{status:'ok';rule:GuidanceRuleState}>(
      this.base+'/rules/'+encodeURIComponent(rule.id),{revision:rule.revision,rule:draft},
      {headers:this.auth('editor')}).pipe(catchError(e=>this.resetOnAuth(e,'editor')));
  }
  publish(rule:GuidanceRuleState):Observable<{status:'ok';rule:GuidanceRuleState}>{
    return this.http.post<{status:'ok';rule:GuidanceRuleState}>(
      this.base+'/rules/'+encodeURIComponent(rule.id)+'/publish',{revision:rule.revision},
      {headers:this.auth('publisher')}).pipe(catchError(e=>this.resetOnAuth(e,'publisher')));
  }
  materialize(imo:string):Observable<GuidanceEvaluation>{
    return this.http.post<GuidanceEvaluation>(
      this.base+'/vessels/'+encodeURIComponent(imo)+'/materialize',{},
      {headers:this.auth('publisher')}).pipe(catchError(e=>this.resetOnAuth(e,'publisher')));
  }
  private auth(role:'editor'|'publisher'):HttpHeaders{
    let key=role==='editor'?this.editorKey:this.publisherKey;
    if(!key){
      key=window.prompt(role==='editor'
        ?'Operational Guidance editor access key (held in this tab only)'
        :'Operational Guidance supervisor publishing key (held in this tab only)')?.trim()||'';
      if(!key)throw new Error('ACCESS_KEY_REQUIRED');
      if(role==='editor')this.editorKey=key;else this.publisherKey=key;
    }
    return new HttpHeaders({'X-NMC-DASHBOARD-KEY':key});
  }
  private resetOnAuth(e:unknown,role:'editor'|'publisher'):Observable<never>{
    if(e instanceof HttpErrorResponse&&e.status===403){
      if(role==='editor')this.editorKey='';else this.publisherKey='';
    }
    return throwError(()=>e);
  }
  message(error:unknown,arabic=false):string{
    const code=error instanceof HttpErrorResponse?(error.error as {error?:string}|null)?.error:
      error instanceof Error?error.message:null;
    const lookup:Record<string,[string,string]>={
      GUIDANCE_ASSESSMENT_NOT_FOUND:['No saved A01/A02 risk assessment for this vessel.','لا يوجد تقييم مخاطر A01/A02 محفوظ لهذه السفينة.'],
      GUIDANCE_SCHEMA_NOT_READY:['Apply Oracle migration 006 before using Guidance Settings.','يلزم تطبيق ترحيل Oracle رقم 006 قبل استخدام إعدادات الإرشاد.'],
      GUIDANCE_VERSION_CONFLICT:['Rule was changed in another session. Reload the rules.','تغيرت القاعدة في جلسة أخرى؛ حدّث القائمة.'],
      GUIDANCE_NO_DRAFT:['Save a draft before publishing.','احفظ المسودة قبل النشر.'],
      GUIDANCE_RULE_INVALID:['Check title, priority and rule condition.','راجع اسم القاعدة وأولويتها وشروطها.'],
      GUIDANCE_RULE_EXISTS:['A guidance rule already exists with this ID.','توجد قاعدة إرشاد بالفعل بنفس المعرف.'],
      DASHBOARD_ACCESS_DENIED:['Management key was rejected.','مفتاح الإدارة غير صحيح.'],
      DASHBOARD_WRITE_NOT_CONFIGURED:['Management keys are not configured on the backend.','لم يتم ضبط مفاتيح الإدارة على الخادم.'],
      ACCESS_KEY_REQUIRED:['Action cancelled: an access key is required.','تم إلغاء العملية؛ يلزم مفتاح الوصول.'],
      GUIDANCE_UNAVAILABLE:['Guidance service is unavailable.','خدمة الإرشاد غير متاحة.']
    };
    const value=lookup[code||''];
    return value?(arabic?value[1]:value[0]):(arabic?'تعذر إكمال العملية.':'Operation failed: '+(code||'SERVICE_UNAVAILABLE'));
  }
}
