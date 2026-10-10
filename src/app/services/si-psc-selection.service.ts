import {Injectable} from '@angular/core';
import {HttpClient,HttpHeaders,HttpParams} from '@angular/common/http';
import {Observable} from 'rxjs';

export interface PscQuotaConfig {
  period:'MONTHLY';scope:'PER_PORT'|'NATIONAL';ratePercent:number;
  portOverrides:{port:string;ratePercent:number}[];mandatoryOutsideQuota:true;
}
export interface PscQuotaPolicy {
  version:number;config:PscQuotaConfig;publishedBy:string;
  publishedAt:string;reason:string;
}
export interface PscSelectionRecord {
  id:string;eventKey:string;imo:string;action:'SELECT'|'NOT_SELECT';
  actor:string;reason:string;decidedAt:string;policyVersion:number;
}
export interface PscPoolItem {
  eventKey:string;imo:string;vesselName:string;port:string;
  sourceReference:string;eta:string;period:string;bucket:string;
  importedAt:string;sourceFile:string|null;sourceExcelRow:number|null;
  nmcRisk:{score:number;level:string;assessmentId:string}|null;
  selectionStatus:'SELECTED'|'NOT_SELECTED'|'IN_POOL';
  selectionDecision:PscSelectionRecord|null;
  ruleRank:number;ruleRecommended:boolean;missingRisk:boolean;
}
export interface PscQuotaBucket {
  bucket:string;period:string;port:string;eligiblePortCalls:number;
  selectionRate:number;targetCount:number;selectedCount:number;
  remainingSlots:number;overQuota:boolean;
}
export interface PscSelectionPool {
  status:string;source:string;policy:PscQuotaPolicy;
  scope:string;periodMode:string;
  summary:{eligiblePortCalls:number;selectedPortCalls:number;
    inPoolPortCalls:number;notSelectedPortCalls:number;
    distinctVessels:number;buckets:PscQuotaBucket[]};
  items:PscPoolItem[];
}
@Injectable({providedIn:'root'})
export class SiPscSelectionService {
  private readonly base='/api/si/v1/psc-selection';
  constructor(private readonly http:HttpClient){}
  private hdr(key:string){return {headers:new HttpHeaders({'X-NMC-DASHBOARD-KEY':key})};}
  pool(key:string,period:string|null=null,port:string|null=null):Observable<PscSelectionPool>{
    let params=new HttpParams();
    if(period)params=params.set('period',period);
    if(port)params=params.set('port',port);
    return this.http.get<PscSelectionPool>(this.base+'/pool',
      {...this.hdr(key),params});
  }
  policy(key:string):Observable<{status:string;policy:PscQuotaPolicy}>{
    return this.http.get<{status:string;policy:PscQuotaPolicy}>(
      this.base+'/policy',this.hdr(key));
  }
  preview(key:string,config:PscQuotaConfig):Observable<{status:string;
    currentVersion:number;proposed:PscQuotaConfig;
    summary:{bucket:string;eligiblePortCalls:number;selectionRate:number;
      targetCount:number;selectedCount:number;overQuota:boolean}[]}>{
    return this.http.post<any>(this.base+'/policy/preview',{config},this.hdr(key));
  }
  publish(key:string,payload:{expectedVersion:number;config:PscQuotaConfig;
    publishedBy:string;reason:string}):Observable<{policy:PscQuotaPolicy}>{
    return this.http.post<{policy:PscQuotaPolicy}>(this.base+'/policy/publish',
      payload,this.hdr(key));
  }
  decide(key:string,payload:{eventKey:string;action:'SELECT'|'NOT_SELECT';
    actor:string;reason:string;expectedPolicyVersion:number}):Observable<any>{
    return this.http.post(this.base+'/decision',payload,this.hdr(key));
  }
}
