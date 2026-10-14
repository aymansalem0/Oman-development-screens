import {CommonModule} from '@angular/common';
import {Component,OnInit} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {HttpClient} from '@angular/common/http';
import {ActivatedRoute,RouterLink} from '@angular/router';
import {LanguageService} from '../services/language.service';
import {NmcNavigationComponent} from '../components/nmc-navigation.component';
interface SourceRow{
 imo:string;name:string;sourceTypes:string[];regimes:string[];
 regime:string;vesselType:string;portId:string;portName:string;
 etaLocal:string;etdLocal:string;etdSource:string;dateEvidenceReference:string;
 nmcReferrals:{id:string;caseReference:string}[];
 locationType:string;locationName:string;siteAccessConfirmed:boolean;
 durationMinutes:number;earliestLocal:string;latestFinishLocal:string;
 windowSource:string;windowEvidenceReference:string;
}
interface Context{
 planId:string;approvedVessels:number;items:SourceRow[];
 ports:{portId:string;name:string}[];
 erpSnapshotId?:string;
 workforce?:{inspectorId:string;inspectorName:string;homePortId:string|null;
   dailyCapacity:number;qualifications:string[]}[];
}
interface ScheduleRow{
 imo:string;status:'PROPOSED'|'UNSCHEDULED';blocker:string|null;
 assignment:{inspectorName:string;inspectorId:string;startLocal:string;
 endLocal:string;portName:string;locationName:string;score:number}|null;
}
interface BoardAssignment{
 imo:string;planRank:number;inspectorId:string;inspectorName:string;
 dateLocal:string;startLocal:string;endLocal:string;
 portId:string;portName:string;locationType:string;locationName:string;score:number;
}
interface ScheduleBoard{
 status:'UNAPPROVED_PREVIEW_ONLY';approvalRequired:true;
 allocatedVessels:number;caseWrites:0;bookingWrites:0;
 engineers:{inspectorId:string;inspectorName:string;vesselCount:number;
 dates:string[];assignments:BoardAssignment[]}[];
 days:{dateLocal:string;vesselCount:number;assignments:BoardAssignment[]}[];
 unscheduled:{imo:string;planRank:number;blocker:string}[];
}
interface Proposal{summary:{total:number;proposed:number;unscheduled:number;
 caseWrites:number;bookingWrites:number};rows:ScheduleRow[];status:string;
 board?:ScheduleBoard;warnings:string[];}
@Component({
 selector:'app-si-maritime-batch-scheduling',standalone:true,
 imports:[CommonModule,FormsModule,RouterLink,NmcNavigationComponent],
 templateUrl:'./si-maritime-batch-scheduling.component.html',
 styleUrl:'./si-maritime-batch-scheduling.component.css'
})
export class SiMaritimeBatchSchedulingComponent implements OnInit{
 context:Context|null=null;proposal:Proposal|null=null;loading=false;busy=false;error='';
 boardView:'VESSELS'|'ENGINEERS'|'DATES'='VESSELS';
 get assignedEngineerCount():number{return this.proposal?.board?.engineers.length||0;}
 invalidateProposal():void{
  // The inputs changed after preview; never show obsolete slots as though
  // they were still valid, and never carry them into a future approval action.
  this.proposal=null;
 }

 private readonly api='/api/si/v1/maritime-scheduling/plans/';
 constructor(private readonly http:HttpClient,private readonly route:ActivatedRoute,
  public readonly lang:LanguageService){}
 copy(en:string,ar:string):string{return this.lang.pick(en,ar);}
 ngOnInit():void{
  const id=this.route.snapshot.paramMap.get('planId');
  if(!id){this.error='Approved plan ID is required';return;}
  this.loading=true;
  this.http.get<Context>(this.api+encodeURIComponent(id)+'/context').subscribe({
   next:data=>{this.context=data;this.loading=false;},
   error:err=>{this.loading=false;this.showError(err);}
  });
 }
 preview():void{
  if(!this.context||this.busy)return;
  this.busy=true;this.error='';this.proposal=null;
  const requests=this.context.items.map(x=>({
   imo:x.imo,portId:x.portId,vesselType:x.vesselType,regime:x.regime,
   locationType:x.locationType,locationName:x.locationName,
   siteAccessConfirmed:x.siteAccessConfirmed,durationMinutes:Number(x.durationMinutes),
   earliestLocal:x.etaLocal||x.earliestLocal,
   latestFinishLocal:x.etdLocal||x.latestFinishLocal,
   windowSource:x.etdLocal?'MSW_FINAL':x.windowSource||'OFFICER_FINAL',
   windowEvidenceReference:x.etdLocal?x.dateEvidenceReference:
    x.windowEvidenceReference||x.nmcReferrals[0]?.id||'POC_OPERATOR_FINAL_WINDOW'
  }));
  this.http.post<{status:string;proposal:Proposal}>(
    this.api+encodeURIComponent(this.context.planId)+'/preview',{requests})
   .subscribe({
    next:r=>{this.busy=false;this.proposal=r.proposal;},
    error:err=>{this.busy=false;this.showError(err);}
   });
 }
 private showError(err:{error?:{error?:string};status?:number}):void{
  this.error=err?.error?.error||(err.status===401?
   'Sign in with Google first.':'Could not produce schedule — check ERP snapshot and source fields.');
 }
}
