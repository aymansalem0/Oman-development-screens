import {Injectable} from '@angular/core';
import {HttpClient,HttpHeaders} from '@angular/common/http';
import {Observable} from 'rxjs';

export type SiLifecycleStage=
  'NOT_STARTED'|'PREPARATION_READY'|'SCOPE_APPROVED'|'ASSIGNED'|'IN_FIELD'|
  'REPORT_PENDING_REVIEW'|'REPORT_RETURNED'|'REPORT_APPROVED'|'ACTIONS_OPEN'|
  'FOLLOW_UP_PENDING'|'READY_TO_CLOSE'|'CLOSED';
export interface SiInspectionCheck {
  id:string;title?:string;mandatory:boolean;
  status:'PENDING'|'PASS'|'DEFICIENCY'|'NOT_APPLICABLE';
  severity:'MINOR'|'MAJOR'|'CRITICAL'|null;
  note:string;naReason:string;evidenceRefs:string[];
}
export interface SiCorrection{
  id:string;findingId:string;owner:string;dueDate:string;instruction:string;
  status:'OPEN'|'PENDING_VERIFICATION'|'VERIFIED'|'REJECTED';
  evidenceRefs:string[];
  review?:{decision:string;reason:string;by:string;at:string}|null;
}
export interface SiLifecycleRecord {
  caseId:string;imo:string;regime:string;stage:SiLifecycleStage;version:number;
  preparationVersion:number;scopeApprovedBy:string|null;
  assignment:{inspector:string;port:string;startLocal:string;mode:string;
    operationalValidity:string;assignedBy:string;assignedAt:string}|null;
  startedAt:string|null;completedAt:string|null;closedAt?:string;
  checks:SiInspectionCheck[];
  findings:{id:string;checkId:string;title:string;severity:string;description:string;
    evidenceRefs:string[];status:string}[];
  report:{id:string;status:string;source:string;summary:string;aiGenerated:false;
    submittedBy:string;findingsCount:number;criticalCount:number;majorCount:number;
    supervisor:string|null;approvedAt?:string;returnReason?:string}|null;
  actions:SiCorrection[];
  followUps:{id:string;mode:string;result:string;note:string;inspector:string;
    at:string;evidenceRefs:string[]}[];
  audit:{id:string;version:number;action:string;actor:string;at:string;reason:string}[];
  closure?:{by:string;reason:string;at:string;nmcRiskRecalculated:false;
    regulatoryEnforcementTriggered:false;officialComplianceUpdated:false};
}
export interface SiLifecycleCase{
  id:string;imo:string;vesselName:string;regime:string;
  approvedBy:string;sourceEvents:{source:string;ref:string}[];
  risk:{score:number;level:string;assessmentId:string;policyRevision:number}|null;
  stage:SiLifecycleStage;version:number;updatedAt:string|null;
  findings:number;actions:number;
}
export interface SiLifecycleVersion {
  version:number;at:string;action:string;actor:string;reason:string;
  snapshot:SiLifecycleRecord;
}
export interface SiLifecycleView{
  status:string;inspectionCase:{id:string;imo:string;regime:string;approvedBy:string;nmcReferralId?:string|null};
  preparation:{status:string;version:number;stale:boolean;baseChecklistIds:string[];
    dossier:{focusAreas:unknown[];suggestedAdditionalItems:{title:string;reason:string}[]}|null;
    provenance:string;externalDocumentsVerified:boolean};
  record:SiLifecycleRecord|null;stages:SiLifecycleStage[];
  readyForInitialization:boolean;limitations:string[];
}
@Injectable({providedIn:'root'})
export class SiLifecycleService{
  private url='/api/si/v1/lifecycle';
  constructor(private http:HttpClient){}
  private headers(key:string){return new HttpHeaders({'X-NMC-DASHBOARD-KEY':key});}
  list(key:string):Observable<{status:string;count:number;cases:SiLifecycleCase[]}>{
    return this.http.get<{status:string;count:number;cases:SiLifecycleCase[]}>(this.url,
      {headers:this.headers(key)});
  }
  get(caseId:string,key:string):Observable<SiLifecycleView>{
    return this.http.get<SiLifecycleView>(this.url+'/'+encodeURIComponent(caseId),
      {headers:this.headers(key)});
  }
  history(caseId:string,key:string):Observable<{status:string;versions:SiLifecycleVersion[]}>{
    return this.http.get<{status:string;versions:SiLifecycleVersion[]}>(
      this.url+'/'+encodeURIComponent(caseId)+'/history',{headers:this.headers(key)});
  }
  apply(caseId:string,key:string,body:{
    action:string;expectedVersion:number;actor:string;data?:Record<string,unknown>
  }):Observable<{status:string;record:SiLifecycleRecord}>{
    return this.http.post<{status:string;record:SiLifecycleRecord}>(
      this.url+'/'+encodeURIComponent(caseId)+'/actions',body,
      {headers:this.headers(key)});
  }
}
