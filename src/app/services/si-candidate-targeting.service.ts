import {Injectable} from '@angular/core';
import {HttpClient,HttpHeaders} from '@angular/common/http';
import {Observable} from 'rxjs';

export type SiRegime='FOCUSED_INSPECTION'|'FOLLOW_UP_INSPECTION'|'PORT_STATE_CONTROL'|'UAE_SERVICE_INSPECTION';
export type SiCandidateStatus='PENDING_REVIEW'|'DEFERRED'|'REJECTED'|'INSPECTION_CREATED'|'EXTERNALLY_SCHEDULED';
export interface SiCandidateEvent{
  eventKey:string;sourceType:'NMC_CASE'|'SERVICE_REQUEST'|'PSC_PORT_CALL';
  sourceEventId:string;sourceReference:string;provenance:string;
  approval:string;evidenceIds:string[];
  importFile?:string|null;importBatchId?:string|null;importExcelRow?:number|null;
}
export interface SiCandidate{
  key:string;imo:string;vesselName:string;flag:string;vesselType:string;
  regime:SiRegime;eligibility:'MANDATORY'|'MANUAL_REVIEW';priority:string;
  reasons:string[];status:SiCandidateStatus;events:SiCandidateEvent[];
  currentRisk:{score:number;level:string;assessmentId:string;policyRevision:number}|null;
  inspectionCase:{id:string;status:string;createdAt:string;approvedBy:string}|null;
  lastDecision:{id:string;action:string;actor:string;note:string;at:string}|null;
}
export interface SiPriorityWeights{
  risk:number;trigger:number;history:number;deadline:number;urgency:number;
}
export interface SiPriorityPolicy{
  weights:SiPriorityWeights;approvedNmcFirst:true;missingRiskAction:'REVIEW_REQUIRED';
}
export interface SiTargetingPolicyConfig{
  riskPriorityThreshold:number;includeMissingRiskInReview:boolean;
  prioritization?:SiPriorityPolicy;
}
export interface SiDashboard{
  status:string;source:string;fleetSnapshotId:string;evaluatedAt:string;
  policy:{version:number;config:SiTargetingPolicyConfig};
  riskPolicyRevision:number;
  summary:{
    evaluatedPopulation:number;assessedRiskVessels:number;candidates:number;
    pendingReview:number;inspectionsCreated:number;externalScheduled:number;
    bySource:Record<string,number>;
  };
  candidates:SiCandidate[];
}
export interface SiPriorityRecommendation{
  candidateKey:string;imo:string;vesselName:string;regime:string;
  effectiveRank:number;suggestedRank:number;ruleRank:number;
  rationale:string;evidenceRefs:string[];dataGaps:string[];confidence:number;
  rulePriority:string;protectedTier:number;missingRuleData:string[];
  officialRisk:SiCandidate['currentRisk'];
}
export interface SiPriorityRun{
  id:string;status:'SUCCEEDED'|'FAILED';startedAt:string;completedAt:string;
  actor:string;policyVersion:number;riskPolicyRevision:number;
  snapshotHash:string;source:string;errorCode?:string;requestedCandidates:number;
  recommendations:SiPriorityRecommendation[];isStale?:boolean;
}
export interface SiPriorityPreviewItem{
  candidateKey:string;imo:string;vesselName:string;ruleRank:number;
  protectedTier:number;rulePriority:string;provisionalScore:number|null;
  risk:SiCandidate['currentRisk'];missingData:string[];
}
export interface SiPriorityPreview{
  status:string;enabled:boolean;snapshotHash:string;eligibleCount:number;
  policyVersion:number;riskPolicyRevision:number;policy:SiPriorityPolicy;
  items:SiPriorityPreviewItem[];
}
export interface SiPriorityStatus{
  status:string;enabled:boolean;preview:{snapshotHash:string;eligibleCount:number;
    policyVersion:number;riskPolicyRevision:number};
  latest:SiPriorityRun|null;
}
export interface SiImpact{
  status:string;fleetSnapshotId:string;evaluatedPopulation:number;
  affectedImos:string[];affectedCandidateCount:number;unevaluatedRiskVessels:number;
  warning:string;
}
@Injectable({providedIn:'root'})
export class SiCandidateTargetingService{
  private readonly api='/api/si/v1';
  constructor(private http:HttpClient){}
  dashboard():Observable<SiDashboard>{
    return this.http.get<SiDashboard>(this.api+'/candidates/dashboard');
  }
  rules():Observable<{status:string;policy:{version:number;config:SiTargetingPolicyConfig}}>{
    return this.http.get<{status:string;policy:{version:number;config:SiTargetingPolicyConfig}}>(
      this.api+'/rules');
  }
  addEvent(body:Record<string,unknown>,key:string):Observable<unknown>{
    return this.http.post(this.api+'/candidates/source-events',body,{headers:this.headers(key)});
  }
  decision(body:{candidateKey:string;imo:string;action:string;actor:string;note:string},key:string):Observable<unknown>{
    return this.http.post(this.api+'/candidates/decision',body,{headers:this.headers(key)});
  }
  preview(config:SiTargetingPolicyConfig,key:string):Observable<SiImpact>{
    return this.http.post<SiImpact>(this.api+'/rules/impact-preview',{config},{headers:this.headers(key)});
  }
  publish(body:{config:SiTargetingPolicyConfig;
    expectedVersion:number;publishedBy:string;reason:string},key:string):Observable<unknown>{
    return this.http.post(this.api+'/rules/publish',body,{headers:this.headers(key)});
  }
  prioritizationStatus(key:string):Observable<SiPriorityStatus>{
    return this.http.get<SiPriorityStatus>(this.api+'/prioritization',{headers:this.headers(key)});
  }
  prioritizationPreview(key:string):Observable<SiPriorityPreview>{
    return this.http.post<SiPriorityPreview>(this.api+'/prioritization/preview',{},
      {headers:this.headers(key)});
  }
  runPrioritization(key:string,body:{actor:string;confirmCost:true;expectedSnapshotHash:string}):Observable<SiPriorityRun>{
    return this.http.post<SiPriorityRun>(this.api+'/prioritization/run',body,
      {headers:this.headers(key)});
  }
  prioritizationHistory(key:string):Observable<{status:string;runs:SiPriorityRun[]}>{
    return this.http.get<{status:string;runs:SiPriorityRun[]}>(
      this.api+'/prioritization/history',{headers:this.headers(key)});
  }
  private headers(key:string):HttpHeaders{
    return new HttpHeaders({'X-NMC-DASHBOARD-KEY':key});
  }
}
