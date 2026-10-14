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
interface Variant{optionId:string;allocatedVessels:number;objectiveScore:number;
 assignments:{imo:string;inspectorId:string;portId:string;startUtc:string;endUtc:string}[];
 rows:ScheduleRow[];board:ScheduleBoard;}
interface Proposal{summary:{total:number;proposed:number;unscheduled:number;
 caseWrites:number;bookingWrites:number};rows:ScheduleRow[];status:string;
 proposalHash:string;variants?:Variant[];
 board?:ScheduleBoard;warnings:string[];aiAdvisory?:boolean;chosenOptionId?:string;}
interface S01Response{status:string;agentCode:'SI-S01';provider:'AIRIA';
 externalCalls:1;chosenOptionId:string;proposal:Proposal;
 rankedOptions:{optionId:string;rank:number;confidence:number;
 rationale:string;evidenceRefs:string[]}[];
 humanApprovalRequired:true;bookingWrites:0;caseWrites:0;}
@Component({
 selector:'app-si-maritime-batch-scheduling',standalone:true,
 imports:[CommonModule,FormsModule,RouterLink,NmcNavigationComponent],
 templateUrl:'./si-maritime-batch-scheduling.component.html',
 styleUrl:'./si-maritime-batch-scheduling.component.css'
})
export class SiMaritimeBatchSchedulingComponent implements OnInit{
 context:Context|null=null;proposal:Proposal|null=null;baselineProposal:Proposal|null=null;
 aiAdvice:S01Response|null=null;loading=false;busy=false;aiBusy=false;error='';notice='';
 boardView:'VESSELS'|'ENGINEERS'|'DATES'='VESSELS';
 get assignedEngineerCount():number{return this.proposal?.board?.engineers.length||0;}
 invalidateProposal():void{
  // The inputs changed after preview; never show obsolete slots as though
  // they were still valid, and never carry them into a future approval action.
  this.proposal=null;this.baselineProposal=null;this.aiAdvice=null;
  this.notice='';
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
 private requests():object[]{
  if(!this.context)return [];
  return this.context.items.map(x=>({
   imo:x.imo,portId:x.portId,vesselType:x.vesselType,regime:x.regime,
   locationType:x.locationType,locationName:x.locationName,
   siteAccessConfirmed:x.siteAccessConfirmed,durationMinutes:Number(x.durationMinutes),
   earliestLocal:x.etaLocal||x.earliestLocal,
   latestFinishLocal:x.etdLocal||x.latestFinishLocal,
   windowSource:x.etdLocal?'MSW_FINAL':x.windowSource||'OFFICER_FINAL',
   windowEvidenceReference:x.etdLocal?x.dateEvidenceReference:
    x.windowEvidenceReference||x.nmcReferrals[0]?.id||'POC_OPERATOR_FINAL_WINDOW'
  }));
 }
 preview():void{
  if(!this.context||this.busy||this.aiBusy)return;
  this.busy=true;this.error='';this.notice='';
  this.proposal=null;this.baselineProposal=null;this.aiAdvice=null;
  this.http.post<{status:string;proposal:Proposal}>(
    this.api+encodeURIComponent(this.context.planId)+'/preview',
    {requests:this.requests()}).subscribe({
     next:r=>{this.busy=false;this.proposal=r.proposal;
      this.baselineProposal=r.proposal;
      this.notice=this.copy('ERP-constrained schedule is ready. You can request SI-S01 AI advice for the valid alternatives.',
       'مقترح الجدولة وفق قيود ERP جاهز. يمكنك تشغيل SI-S01 لترتيب البدائل الصالحة.');},
     error:err=>{this.busy=false;this.showError(err);}
    });
 }
 get canRunAi():boolean{
  return !!this.baselineProposal?.variants?.length&&
   (this.baselineProposal?.summary?.proposed||0)>0&&!this.busy&&!this.aiBusy;
 }
 runAi():void{
  if(!this.context||!this.baselineProposal||!this.canRunAi)return;
  const confirmed=window.confirm(this.copy(
   'Run ONE potentially billable SI-S01 Airia request to compare whole-plan feasible schedules? No booking, case or approval will be created.',
   'هل تؤكد تشغيل طلب Airia SI-S01 واحد قد يكون مدفوعًا لترتيب بدائل الجدولة الصالحة للخطة كاملة؟ لن ينشأ حجز أو حالة معاينة أو اعتماد تلقائي.'));
  if(!confirmed)return;
  this.aiBusy=true;this.error='';this.notice='';
  this.http.post<{status:string}&S01Response>(
   this.api+encodeURIComponent(this.context.planId)+'/ai-recommend',{
    requests:this.requests(),expectedProposalHash:this.baselineProposal.proposalHash,
    confirmRun:true,confirmCost:true
   }).subscribe({
    next:r=>{
     this.aiBusy=false;
     if(!this.baselineProposal||
        r.proposalHash!==this.baselineProposal.proposalHash){
       this.aiAdvice=null;
       this.error=this.copy(
        'The scheduling inputs changed while Airia was running. The old AI result was discarded; recalculate the feasible schedule.',
        'تغيرت بيانات الجدولة أثناء عمل Airia. تم تجاهل النتيجة القديمة؛ أعد حساب بدائل الجدولة أولًا.');
       return;
     }
     this.aiAdvice=r;this.proposal=r.proposal;
     this.notice=this.copy(
      'Airia SI-S01 ranked the valid schedule alternatives. This remains a draft for supervisor approval.',
      'رتّب Airia SI-S01 بدائل الجدولة الصالحة. النتيجة مقترح للمراجعة وليست جدولًا معتمدًا.');
    },
    error:err=>{this.aiBusy=false;this.showError(err);}
   });
 }
 restoreBaseline():void{
  if(!this.baselineProposal)return;
  this.proposal=this.baselineProposal;this.aiAdvice=null;
  this.notice=this.copy('Showing ERP-only baseline; no AI selection is applied.',
   'تعرض الآن الجدولة الأساسية الناتجة عن ERP دون اختيار AI.');
 }
 private showError(err:{error?:{error?:string};status?:number}):void{
  this.error=err?.error?.error||(err.status===401?
   'Sign in with Google first.':'Could not produce schedule — check ERP snapshot and source fields.');
 }
}
