import {Injectable} from '@angular/core';
import {HttpClient,HttpHeaders} from '@angular/common/http';
import {Observable} from 'rxjs';

export interface SiManagementCase {
 id:string;imo:string;vesselName:string;regime:string;stage:string;
 inspector:string|null;sourceEvents:{source:string;ref:string}[];
 priorityRisk:{score:number;level:string;assessmentId:string;policyRevision:number}|null;
 findings:number;major:number;critical:number;openActions:number;overdueActions:number;
 updatedAt:string|null;closedAt:string|null;caseVersion:number;
}
export interface SiManagementReport{
 status:'ok';source:'SAVED_SI_INSPECTION_LEDGER_AND_CURRENT_CANDIDATE_QUEUE';
 dataNature:'SYNTHETIC_POC_NOT_OFFICIAL';generatedAt:string;asOfDate:string;
 autoAiCalls:false;mutations:false;candidateSourceAvailable:boolean;
 limitations:string[];
 kpis:{
  uniqueCandidateVessels:number|null;pendingCandidateVessels:number|null;
  approvedCases:number;notStartedCases:number;inProgressCases:number;
  closedCases:number;pendingReportReview:number;returnedReports:number;
  openCorrectiveActions:number;overdueCorrectiveActions:number;
  findings:number;majorFindings:number;criticalFindings:number;
  repeatDeficiencyVessels:number;repeatedVesselCheckPairs:number;
  averageClosureHours:number|null;timedClosedCases:number;
 };
 byStage:{stage:string;count:number}[];
 byRegime:{regime:string;count:number}[];
 workload:{inspector:string;assigned:number;inField:number;
    pendingReports:number;openActions:number}[];
 recurringChecks:{checkId:string;title:string;findings:number;
    affectedCases:number;affectedVessels:number}[];
 cases:SiManagementCase[];
}
@Injectable({providedIn:'root'})
export class SiManagementService{
 private readonly url='/api/si/v1/management';
 constructor(private http:HttpClient){}
 load(key:string):Observable<SiManagementReport>{
  return this.http.get<SiManagementReport>(this.url,{
   headers:new HttpHeaders({'X-NMC-DASHBOARD-KEY':key})
  });
 }
}
