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
export type SiCapacityWeightKey='NMC_CASE'|'SERVICE_REQUEST'|'PSC_PORT_CALL'|'RISK_FACTOR';
export type SiCapacityWeights=Record<SiCapacityWeightKey,number>;
export interface SiCapacityAssignment{
 imo:string;inspectorId:string;inspectorName:string;portId:string;portName:string;
 startLocal:string;endLocal:string;startUtc:string;endUtc:string;score:number;
 crossPort?:boolean;originPortName?:string;travelMinutes?:number;
}
export interface SiCapacityPreview{
 status:string;planId:string;planRevision:number;sourceHash:string;capacityHash:string;
 weights:SiCapacityWeights;mode:'POC_MOCK'|'ERP_EXCEL_POC';readyForApproval:boolean;
 sourceFactsAreSynthetic:boolean;warnings:string[];
 proposedVesselCount:number;unmetCapacityCount:number;
 priorityAdvisory:{imo:string;rank:number;score:number;sourcePoints:number;
  riskPoints:number|null;riskStatus:string;sourceTypes:string[];
  statutoryPriorityProtected:boolean}[];
 proposal:{proposalHash:string;planRevision:number;
  summary:{total:number;proposed:number;unscheduled:number};
  rows:{imo:string;status:'PROPOSED'|'UNSCHEDULED';blocker:string|null;
   assignment:SiCapacityAssignment|null;diagnostics?:{code:string;category:string;
   nextAction?:string;candidateOptions?:number;candidateInspectors?:number;
   timeOrTravelConflicts?:number;dailyCapacityConflicts?:number;
   competingVisits?:{imo:string;inspectorName:string;inspectorId:string;
    startLocal:string;endLocal:string;portId:string}[];
   inspectorExclusions?:{inspectorId:string;reasonCodes:string[]}[]}|null}[];
  variants:{optionId:string;objectiveScore:number;allocatedVessels:number;
   assignments:SiCapacityAssignment[]}[]};
}
export interface SiCapacityApproval{
 status:string;planId:string;revision:number;approvedVesselCount:number;
 createdInspectionCases:number;createdDossiers:number;schedulingRoute:string;
 schedule:{id:string;orders:{imo:string;id:string;status:string}[]};
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
 capacityPreview(planId:string,weights:SiCapacityWeights):Observable<{status:string;capacity:SiCapacityPreview}>{
  return this.http.post<{status:string;capacity:SiCapacityPreview}>(
   '/api/si/v1/inspection-plans/'+encodeURIComponent(planId)+'/capacity-preview',
   {weights,demoMode:true});
 }
 capacityAiRecommend(planId:string,weights:SiCapacityWeights,expectedCapacityHash:string):
  Observable<{status:string;capacityHash:string;chosenOptionId:string;
   provider:'POC_MOCK'|'AIRIA';rankedOptions:{optionId:string;rank:number;
   rationale:string;confidence:number}[]}>{
  return this.http.post<{status:string;capacityHash:string;chosenOptionId:string;
   provider:'POC_MOCK'|'AIRIA';rankedOptions:{optionId:string;rank:number;
    rationale:string;confidence:number}[]}>(
   '/api/si/v1/inspection-plans/'+encodeURIComponent(planId)+'/capacity-ai-recommend',
   {weights,demoMode:true,expectedCapacityHash,confirmRun:true,confirmCost:true});
 }
 approveCapacityPlan(input:{planId:string;weights:SiCapacityWeights;
  expectedCapacityHash:string;selectedOptionId:string;expectedRevision:number;
  expectedSourceHash:string;reason:string;confirmApproval:true;
  confirmCrossPort:boolean}):Observable<SiCapacityApproval>{
  return this.http.post<SiCapacityApproval>(
   '/api/si/v1/inspection-plans/'+encodeURIComponent(input.planId)+'/approve-capacity',
   {...input,demoMode:true});
 }
 job(id:string):Observable<SiBulkJob>{
  return this.http.get<SiBulkJob>(this.url+'/'+encodeURIComponent(id));
 }
 latest():Observable<{batches:SiBulkJob[]}>{
  return this.http.get<{batches:SiBulkJob[]}>(this.url);
 }
}
