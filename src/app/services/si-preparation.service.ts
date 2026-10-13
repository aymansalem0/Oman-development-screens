import {Injectable} from '@angular/core';
import {HttpClient,HttpHeaders} from '@angular/common/http';
import {Observable} from 'rxjs';

export type SiPrepStatus='PREPARED'|'GENERATING'|'DRAFT_REVIEW'|'APPROVED'|'REJECTED'|'FAILED';
export interface SiRiskSnapshot{
  evaluationId:string;score:number;level:string;policyRevision:number;
  rulesetVersion:string;
}
export interface SiPreparationContext{
  siCaseId:string;inspectionId:string;caseId:string;imo:string;
  vessel:{imo:string;name:string;flag:string;vesselType:string};
  targetRegime:string;targetRegimes?:string[];
  inspectionReasons?:{eventKey:string;sourceType:string;sourceReference:string;
    inspectionRegime:string;reason:string|null;evidenceIds:string[]}[];
  inspectionScopes?:{regime:string;reasonEventKeys:string[];requiresRegulatoryReview:boolean}[];
  sourceInspectionObjectives?:{objectiveId:string;sourceType:string;
    sourceReference:string;inspectionRegime:string;inspectionReason:string|null;
    evidenceIds:string[];status:'TO_BE_VERIFIED_BY_INSPECTOR';
    advisory:false;legallyConfirmed:false}[];
  approvedPlanId?:string|null;
  bundleRef:string;baseChecklistItemIds:string[];
  risk:SiRiskSnapshot|null;sourceAssessmentId:string|null;
  evidenceManifestRefs:string[];openFindingRefs:string[];
  provenance:string;externalDocumentsVerified:boolean;
  createdCaseApprovedBy:string;targetingPolicyVersion:number;
  evidenceContext:{documentManifest:{contentAvailable?:boolean}|null};
}
export interface SiDossier{
  externalDossierId:string|null;
  focusAreas:{category:string;priority:string;reason:string;evidenceIds:string[]}[];
  checklistFocus:{existingItemId:string;focus:string;reason:string;reasonEvidenceIds:string[]}[];
  predictedDeficiencies:{category:string;hypothesisOnly:true;evidenceIds:string[]}[];
  suggestedAdditionalItems:{title:string;reason:string;evidenceIds:string[];recommendationOnly:true}[];
  missingEvidence:string[];agentConfidence:number;requiresInspectorReview:true;
  agentRunId:string|null;source:string;status:'DRAFT_REVIEW';mock?:boolean;externalCalls?:number;
  generatedAt:string;requestCorrelationId:string;sourceHash:string;
}
export interface SiPreparedRecord{
  caseId:string;version:number;status:SiPrepStatus;sourceHash:string;
  context:SiPreparationContext;preparedAt:string;preparedBy:string;
  dossier:SiDossier|null;lastFailure:string|null;
  review:{decision:string;actor:string;reason:string;at:string}|null;
}
export interface SiPreparationView{
  status:string;inspectionCase:{id:string;imo:string;regime:string;approvedBy:string};
  context:SiPreparationContext;sourceHash:string;saved:SiPreparedRecord|null;
  stale:boolean;canGenerate:boolean;a04Enabled:boolean;a04Provider?:'MOCK'|'AIRIA';message:string;
  requiresHumanApproval:boolean;
}
export interface SiPreparationCaseSummary{
  id:string;imo:string;regime:string;vesselName:string;flag:string|null;
  approvedBy:string|null;approvedAt:string|null;
  riskAtApproval:{score:number;level:string;assessmentId:string;policyRevision:number}|null;
  preparationStatus:SiPrepStatus|'NOT_PREPARED';
  preparationVersion:number;preparedAt:string|null;dossierSource:string|null;
}
export interface SiPreparationRegister{
  status:'ok';count:number;cases:SiPreparationCaseSummary[];
  preparationAvailable:boolean;warning:string|null;
}
@Injectable({providedIn:'root'})
export class SiPreparationService{
  private base='/api/si/v1/preparations/';
  constructor(private http:HttpClient){}
  private headers(key:string){return new HttpHeaders({'X-NMC-DASHBOARD-KEY':key});}
  list(key:string):Observable<SiPreparationRegister>{
    return this.http.get<SiPreparationRegister>('/api/si/v1/preparations',
      {headers:this.headers(key)});
  }
  get(id:string,key:string):Observable<SiPreparationView>{
    return this.http.get<SiPreparationView>(this.base+encodeURIComponent(id),{
      headers:this.headers(key)});
  }
  prepare(id:string,key:string,body:{actor:string;expectedVersion:number}):Observable<unknown>{
    return this.http.post(this.base+encodeURIComponent(id)+'/prepare',body,{headers:this.headers(key)});
  }
  generate(id:string,key:string,body:{actor:string;expectedVersion:number;confirmCost:true;language:'en'|'ar'}):Observable<unknown>{
    return this.http.post(this.base+encodeURIComponent(id)+'/generate',body,{headers:this.headers(key)});
  }
  review(id:string,key:string,body:{actor:string;expectedVersion:number;decision:'APPROVE'|'REJECT';reason:string}):Observable<unknown>{
    return this.http.post(this.base+encodeURIComponent(id)+'/review',body,{headers:this.headers(key)});
  }
}
