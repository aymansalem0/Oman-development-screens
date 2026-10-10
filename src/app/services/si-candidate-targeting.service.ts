import {Injectable} from '@angular/core';
import {HttpClient,HttpHeaders} from '@angular/common/http';
import {Observable} from 'rxjs';

export type SiRegime='FOCUSED_INSPECTION'|'FOLLOW_UP_INSPECTION'|'PORT_STATE_CONTROL'|'UAE_SERVICE_INSPECTION';
export type SiCandidateStatus='PENDING_REVIEW'|'DEFERRED'|'REJECTED'|'INSPECTION_CREATED'|'EXTERNALLY_SCHEDULED';
export interface SiCandidateEvent{
  eventKey:string;sourceType:'NMC_CASE'|'SERVICE_REQUEST'|'PSC_PORT_CALL';
  sourceEventId:string;sourceReference:string;provenance:string;
  approval:string;evidenceIds:string[];
}
export interface SiCandidate{
  key:string;imo:string;vesselName:string;flag:string;vesselType:string;
  regime:SiRegime;eligibility:'MANDATORY'|'MANUAL_REVIEW';priority:string;
  reasons:string[];status:SiCandidateStatus;events:SiCandidateEvent[];
  currentRisk:{score:number;level:string;assessmentId:string;policyRevision:number}|null;
  inspectionCase:{id:string;status:string;createdAt:string;approvedBy:string}|null;
  lastDecision:{id:string;action:string;actor:string;note:string;at:string}|null;
}
export interface SiDashboard{
  status:string;source:string;fleetSnapshotId:string;evaluatedAt:string;
  policy:{version:number;config:{riskPriorityThreshold:number;includeMissingRiskInReview:boolean}};
  riskPolicyRevision:number;
  summary:{
    evaluatedPopulation:number;assessedRiskVessels:number;candidates:number;
    pendingReview:number;inspectionsCreated:number;externalScheduled:number;
    bySource:Record<string,number>;
  };
  candidates:SiCandidate[];
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
  rules():Observable<{status:string;policy:{version:number;config:{riskPriorityThreshold:number;includeMissingRiskInReview:boolean}}}>{
    return this.http.get<{status:string;policy:{version:number;config:{riskPriorityThreshold:number;includeMissingRiskInReview:boolean}}}>(
      this.api+'/rules');
  }
  addEvent(body:Record<string,unknown>,key:string):Observable<unknown>{
    return this.http.post(this.api+'/candidates/source-events',body,{headers:this.headers(key)});
  }
  decision(body:{candidateKey:string;imo:string;action:string;actor:string;note:string},key:string):Observable<unknown>{
    return this.http.post(this.api+'/candidates/decision',body,{headers:this.headers(key)});
  }
  preview(config:{riskPriorityThreshold:number;includeMissingRiskInReview:boolean},key:string):Observable<SiImpact>{
    return this.http.post<SiImpact>(this.api+'/rules/impact-preview',{config},{headers:this.headers(key)});
  }
  publish(body:{config:{riskPriorityThreshold:number;includeMissingRiskInReview:boolean};
    expectedVersion:number;publishedBy:string;reason:string},key:string):Observable<unknown>{
    return this.http.post(this.api+'/rules/publish',body,{headers:this.headers(key)});
  }
  private headers(key:string):HttpHeaders{
    return new HttpHeaders({'X-NMC-DASHBOARD-KEY':key});
  }
}
