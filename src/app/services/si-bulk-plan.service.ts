import {Injectable} from '@angular/core';
import {HttpClient} from '@angular/common/http';
import {Observable} from 'rxjs';

export interface SiBulkSourceReason{
 eventKey:string;candidateKey:string;sourceType:string;
 sourceEventId:string;sourceReference:string;inspectionRegime:string;
 sourceApproval:string;reason:string|null;evidenceIds:string[];
 sourceProvenance:string|null;
}
export interface SiBulkVessel{
 imo:string;vesselName:string;rank:number|null;
 candidateKeys:string[];primaryCandidateKey:string|null;
 inspectionRegimes:string[];reasons:SiBulkSourceReason[];
 missingSource:boolean;
}
export interface SiBulkPreview{
 status:'PREVIEW';planId?:string|null;planNumber?:string|null;sourceHash:string;planRevision:number;
 agentRunId:string|null;planGeneratedAt:string|null;
 provider:'MOCK'|'AIRIA';stale:boolean;selectedVessels:number;
 selectionMode?:'MANUAL'|'AI_ASSISTED';manualSelection?:boolean;
 vessels:SiBulkVessel[];
 mandatoryChecksPreserved:true;a04Enabled:boolean;p01Enabled:boolean;
 a04Provider:'MOCK'|'AIRIA';p01Provider:'MOCK'|'AIRIA';
 maxAiPerBatch:number;warnings:string[];requiresSupervisorApproval:true;
}
export type SiBulkItemState='QUEUED'|'APPROVED'|'PREPARED'|'READY'|'APPROVAL_FAILED'|'PREPARATION_FAILED';
export interface SiBulkItem{
 imo:string;candidateKey:string;regime:string;regimes:string[];reasonCount:number;vesselName:string;
 planRank:number|null;state:SiBulkItemState;
 inspectionCaseId:string|null;dossierStatus:string;aiDossierStatus:string;
 error:string|null;
}
export interface SiBulkJob{
 id:string;status:'QUEUED'|'RUNNING'|'COMPLETED'|'PARTIAL';
 createdAt:string;updatedAt:string;finishedAt?:string|null;
 rollingPlanId?:string|null;
 approvedBy:string;approvedCount:number;totalSelected:number;
 sourceHash:string;planRevision:number;approvalReason:string;
 priorityStatus:string;mode:string;progressMessage:string;items:SiBulkItem[];
}
@Injectable({providedIn:'root'})
export class SiBulkPlanService{
 private readonly url='/api/si/v1/inspection-batches';
 constructor(private readonly http:HttpClient){}
 preview(planId?:string|null):Observable<SiBulkPreview>{
  return this.http.get<SiBulkPreview>(this.url+'/preview',
   {params:planId?{planId}:{}});
 }
 approve(input:{
  reason:string;planId?:string;expectedRevision:number;expectedSourceHash:string;
  expectedAgentRunId:string|null;confirmApproval:true;
  generateA04:boolean;runP01:boolean;confirmAiCost:boolean;
 }):Observable<SiBulkJob>{
  return this.http.post<SiBulkJob>(this.url,input);
 }
 approveForScheduling(input:{
  planId:string;reason:string;expectedRevision:number;expectedSourceHash:string;confirmApproval:true
 }):Observable<{status:string;planId:string;revision:number;approvedVesselCount:number;
  createdInspectionCases:number;createdDossiers:number;schedulingRoute:string}>{
  return this.http.post<{status:string;planId:string;revision:number;
   approvedVesselCount:number;createdInspectionCases:number;createdDossiers:number;
   schedulingRoute:string}>('/api/si/v1/inspection-plans/'+encodeURIComponent(input.planId)+
    '/approve-for-scheduling',input);
 }
 job(id:string):Observable<SiBulkJob>{
  return this.http.get<SiBulkJob>(this.url+'/'+encodeURIComponent(id));
 }
 latest():Observable<{batches:SiBulkJob[]}>{
  return this.http.get<{batches:SiBulkJob[]}>(this.url);
 }
}
