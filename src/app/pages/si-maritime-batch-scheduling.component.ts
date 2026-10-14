import {CommonModule} from '@angular/common';
import {Component,OnInit} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {HttpClient} from '@angular/common/http';
import {ActivatedRoute,RouterLink} from '@angular/router';
import {LanguageService} from '../services/language.service';
import {NmcNavigationComponent} from '../components/nmc-navigation.component';
interface SourceRow{
 imo:string;name:string;sourceTypes:string[];regimes:string[];
 regime:string;vesselType:string;portId:string;portName:string;portSourceLocked:boolean;
 demoFilled?:boolean;demoFieldNames?:string[];demoProvenance?:string;
 etaLocal:string;etdLocal:string;etdSource:string;dateEvidenceReference:string;
 nmcReferrals:{id:string;caseReference:string}[];
 locationType:string;locationName:string;siteAccessConfirmed:boolean;
 durationMinutes:number;earliestLocal:string;latestFinishLocal:string;
 windowSource:string;windowEvidenceReference:string;
}
interface Context{
 planId:string;approvedVessels:number;items:SourceRow[];
 ports:{portId:string;name:string}[];
 erpSnapshotId?:string;demoMode?:boolean;demoNotice?:string;
 demoFilledVessels?:number;
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
 planRevision:number;proposalHash:string;variants?:Variant[];
 board?:ScheduleBoard;warnings:string[];aiAdvisory?:boolean;chosenOptionId?:string;}
interface WorkOrder{imo:string;caseId:string|null;orderId:string;orderStatus:string;
 dossierStatus:string;assignment:{inspectorId:string;inspectorName:string;
 portName:string;startLocal:string;startUtc:string};}
interface ScheduleApproval{id:string;planId:string;planRevision:number;
 status:string;approvedBy:string;approvedAt:string;items:WorkOrder[];
 selectedOptionId?:string;lastIssue?:string;}
interface S01Response{status:string;agentCode:'SI-S01';provider:'AIRIA'|'POC_MOCK';
 externalCalls:0|1;chosenOptionId:string;proposalHash:string;proposal:Proposal;
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
 demoMode=true;
 aiAdvice:S01Response|null=null;loading=false;busy=false;aiBusy=false;
 error='';notice='';
 schedule:ScheduleApproval|null=null;scheduleBusy=false;
 scheduleReason='Confirmed ERP-qualified distribution, verified visit windows and whole-plan supervisory approval.';
 boardView:'VESSELS'|'ENGINEERS'|'DATES'='VESSELS';
 // A disabled AI action hides useful guidance. Keep it actionable: the
 // first click preflights the free ERP schedule; only confirmed second step
 // can make a charged Airia call.
 get readinessIssues():{imo:string;name:string;issues:string[]}[]{
  if(!this.context)return [];
  return this.context.items.map(v=>{
   const issues:string[]=[];
   if(!v.portId)issues.push(this.copy('inspection port','ميناء المعاينة'));
   if(!(v.etaLocal||v.earliestLocal))issues.push(this.copy('ETA / availability start','موعد الوصول أو بداية الإتاحة'));
   if(!(v.etdLocal||v.latestFinishLocal))issues.push(this.copy('ETD / inspection deadline','موعد المغادرة أو نهاية الإتاحة'));
   if(!v.locationName.trim())issues.push(this.copy('berth or site name','اسم الرصيف أو موقع المعاينة'));
   if(!v.siteAccessConfirmed)issues.push(this.copy('confirmed site access','تأكيد إتاحة الموقع'));
   if(!Number.isInteger(Number(v.durationMinutes))||Number(v.durationMinutes)<30||
      Number(v.durationMinutes)>720)issues.push(this.copy('valid inspection duration','مدة معاينة صحيحة'));
   return {imo:v.imo,name:v.name,issues};
  }).filter(row=>row.issues.length>0);
 }
 get aiBlockedReason():string{
  if(this.busy)return this.copy('Calculating ERP feasibility…','جارٍ حساب الإتاحة من ERP…');
  if(this.aiBusy)return this.copy('Waiting for Airia SI-S01…','جارٍ انتظار تحليل SI-S01…');
  if(!this.baselineProposal)return this.copy(
   'Click AI Schedule: the system will first calculate ERP-feasible alternatives without an Airia charge.',
   'اضغط الجدولة بالذكاء الاصطناعي: سيتم حساب البدائل الصالحة من ERP أولًا دون تكلفة Airia.');
  if(!this.canRunAi)return this.copy(
   'No feasible schedule available. Review the unscheduled vessels and missing visit details below; Airia will not be charged.',
   'لا توجد بدائل جدولة صالحة. راجع السفن غير المجدولة وبيانات الزيارة الناقصة أدناه؛ لن يتم استدعاء Airia.');
  return '';
 }

 get assignedEngineerCount():number{return this.proposal?.board?.engineers.length||0;}
 get canApproveSchedule():boolean{
  return !this.demoMode&&!this.schedule&&!this.scheduleBusy&&!this.busy&&
   !!this.context&&!!this.baselineProposal&&!!this.proposal&&
   this.proposal.summary.unscheduled===0&&this.scheduleReason.trim().length>=8;
 }
 loadSchedule():void{
  if(!this.context)return;
  this.http.get<{status:string;schedule:ScheduleApproval|null}>(
   this.api+encodeURIComponent(this.context.planId)+'/orders').subscribe({
    next:r=>{this.schedule=r.schedule;},
    error:e=>{
     const code=e?.error?.error||'';
     if(code==='SI_V2_MIGRATION_019_REQUIRED')this.notice=this.copy(
      'Schedule approval requires additive Oracle Migration 019.',
      'اعتماد الجدولة يتطلب تنفيذ Oracle Migration 019 أولًا.');
    }
   });
 }
 approveSchedule():void{
  if(!this.canApproveSchedule||!this.context||!this.baselineProposal)return;
  if(!window.confirm(this.copy(
   'Approve the entire inspected ERP schedule and issue engineer work orders? This is a supervisory decision; it cannot be based on POC synthetic availability.',
   'تأكيد اعتماد الجدولة الكاملة وإصدار أوامر التكليف للمهندسين؟ هذا قرار مسؤول ولا يجوز اعتماده بناءً على إتاحة تجريبية افتراضية.')))return;
  this.scheduleBusy=true;this.error='';
  this.http.post<{status:string;schedule:ScheduleApproval}>(
   this.api+encodeURIComponent(this.context.planId)+'/approval',{
    requests:this.requests(),demoMode:this.demoMode,
    expectedProposalHash:this.baselineProposal.proposalHash,
    expectedPlanRevision:this.proposal.planRevision,
    selectedOptionId:this.proposal.chosenOptionId||
      this.baselineProposal.variants?.[0]?.optionId||null,
    reason:this.scheduleReason.trim(),confirmApproval:true
   }).subscribe({
    next:r=>{
     this.scheduleBusy=false;this.schedule=r.schedule;
     this.notice=this.copy('Supervisor-approved schedule saved. Dispatch work orders and prepare the inspection dossiers.',
      'تم حفظ الجدول المعتمد. يمكنك الآن إصدار أوامر التكليف وتجهيز ملفات المعاينات.');
    },
    error:e=>{this.scheduleBusy=false;this.showError(e);}
   });
 }
 dispatchOrders():void{
  if(!this.context||!this.schedule||this.scheduleBusy)return;
  if(!window.confirm(this.copy(
   'Issue inspection work orders and prepare case dossiers? NMC referrals must already have a separately confirmed appointment.',
   'إصدار أوامر التكليف وتجهيز دوسيهات المعاينة؟ يجب أن تكون مواعيد إحالات NMC معتمدة بشكل مستقل.')))return;
  this.scheduleBusy=true;this.error='';
  this.http.post<{status:string;schedule:ScheduleApproval}>(
   this.api+encodeURIComponent(this.context.planId)+'/dispatch',{}).subscribe({
    next:r=>{
     this.scheduleBusy=false;this.schedule=r.schedule;
     this.notice=this.copy(
      'Work orders: '+r.schedule.items.filter(x=>x.orderStatus==='ISSUED').length+
      ' issued; review pending cases and dossier status.',
      'أوامر التكليف الصادرة: '+r.schedule.items.filter(x=>x.orderStatus==='ISSUED').length+
      '؛ راجع الحالات المعلقة وحالة الدوسيه.');
    },
    error:e=>{this.scheduleBusy=false;this.showError(e);}
   });
 }

 invalidateProposal():void{
  // The inputs changed after preview; never show obsolete slots as though
  // they were still valid, and never carry them into a future approval action.
  this.proposal=null;this.baselineProposal=null;this.aiAdvice=null;
  this.notice='';this.error='';
 }

 private readonly api='/api/si/v1/maritime-scheduling/plans/';
 constructor(private readonly http:HttpClient,private readonly route:ActivatedRoute,
  public readonly lang:LanguageService){}
 copy(en:string,ar:string):string{return this.lang.pick(en,ar);}
 ngOnInit():void{this.loadContext();}
 useDemoMode(enabled:boolean):void{
  if(this.busy||this.aiBusy||this.loading)return;
  this.demoMode=enabled;this.loadContext();
 }
 loadContext():void{
  const id=this.route.snapshot.paramMap.get('planId');
  if(!id){this.error='Approved plan ID is required';return;}
  this.loading=true;this.error='';this.notice='';this.context=null;
  this.proposal=null;this.baselineProposal=null;this.aiAdvice=null;
  this.http.get<Context>(this.api+encodeURIComponent(id)+
    '/context'+(this.demoMode?'?demo=1':'')).subscribe({
   next:data=>{this.context=data;this.loading=false;
    if(!data.demoMode)this.loadSchedule();
    this.notice=data.demoMode?this.copy(
     'POC DEMO: '+(data.demoFilledVessels||0)+
      ' vessels had missing visit data supplemented; engineer availability, qualifications, shifts and access are synthetic and NOT official.',
     'وضع العرض التجريبي: استُكملت بيانات زيارة '+(data.demoFilledVessels||0)+
      ' سفينة، وإتاحة المهندسين والتخصصات والورديات وإتاحة المواقع افتراضية وليست بيانات رسمية.'):'';},
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
 preview():void{this.calculateFeasible(false);}
 private calculateFeasible(continueToAi:boolean):void{
  if(!this.context||this.busy||this.aiBusy)return;
  this.busy=true;this.error='';this.notice='';
  this.proposal=null;this.baselineProposal=null;this.aiAdvice=null;
  this.http.post<{status:string;proposal:Proposal}>(
    this.api+encodeURIComponent(this.context.planId)+'/preview',
    {requests:this.requests(),demoMode:this.demoMode}).subscribe({
     next:r=>{
      this.busy=false;this.proposal=r.proposal;
      this.baselineProposal=r.proposal;
      const proposed=r.proposal.summary?.proposed||0;
      const unscheduled=r.proposal.summary?.unscheduled||0;
      if(!proposed||!r.proposal.variants?.length){
       this.notice=this.copy(
        'ERP found 0 feasible inspections. Review missing port, visit window, site access, engineer availability or scheduling blockers below. No Airia call was made.',
        'لم يجد ERP أي معاينة قابلة للجدولة. راجع الميناء والمواعيد وإتاحة الموقع وتوفر المهندسين وأسباب عدم الجدولة أدناه. لم يتم استدعاء Airia.');
       this.boardView='VESSELS';
       return;
      }
      this.notice=this.copy(
       'ERP found '+proposed+' feasible vessel(s)'+(unscheduled?
        ' and '+unscheduled+' unscheduled; blocked vessels remain visible.':'')+
        ' No AI call yet.',
       'وجد ERP عدد '+proposed+' سفينة قابلة للجدولة'+(unscheduled?
        ' و'+unscheduled+' سفينة غير مجدولة تظهر أسباب تعذر جدولتها.':'')+
        ' لم يتم استدعاء AI بعد.');
      if(continueToAi)this.runAi();
     },
     error:err=>{this.busy=false;this.showError(err);}
    });
 }

 get canRunAi():boolean{
  return !!this.baselineProposal?.variants?.length&&
   (this.baselineProposal?.summary?.proposed||0)>0&&!this.busy&&!this.aiBusy;
 }
 runAi():void{
  if(!this.context||this.busy||this.aiBusy)return;
  // One-click user flow: a FREE source-validated ERP preview comes first;
  // the charged Airia request still requires its own explicit confirmation.
  if(!this.baselineProposal){
   this.calculateFeasible(true);
   return;
  }
  if(!this.canRunAi){
   this.error=this.copy(
    'No valid scheduling alternative exists yet. Complete missing visit details and review the ERP scheduling blockers. Airia has not been called.',
    'لا يوجد بديل جدولة صالح بعد. أكمل بيانات زيارة السفن وراجع أسباب التعذر من ERP. لم يتم استدعاء Airia.');
   this.boardView='VESSELS';
   return;
  }
  const confirmed=window.confirm(this.copy(
   this.demoMode?
    'Continue SI-S01 scheduling? MOCK provider generates a labelled zero-cost simulated ranking; AIRIA provider makes ONE potentially billable real AI call on synthetic data. Neither creates a booking.':
    'Run ONE potentially billable SI-S01 Airia request on verified ERP scheduling alternatives? No booking, case or approval will be created.',
   this.demoMode?
    'هل تؤكد جدولة SI-S01؟ عند استخدام MOCK ستكون النتيجة محاكاة واضحة دون تكلفة، أما Airia فيشغّل استدعاء AI حقيقيًا قد يكون مدفوعًا على بيانات تجريبية. لن ينشأ أي حجز.':
    'هل تؤكد تشغيل طلب Airia SI-S01 واحد قد يكون مدفوعًا على بدائل ERP المتحقَّق منها؟ لن ينشأ حجز أو حالة أو اعتماد تلقائي.'));
  if(!confirmed)return;
  this.aiBusy=true;this.error='';this.notice='';
  this.http.post<{status:string}&S01Response>(
   this.api+encodeURIComponent(this.context.planId)+'/ai-recommend',{
    requests:this.requests(),demoMode:this.demoMode,
    expectedProposalHash:this.baselineProposal.proposalHash,
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
     this.notice=r.provider==='POC_MOCK'?
      this.copy('POC MOCK: Simulated SI-S01 ranking, zero Airia calls. The proposed schedule is not approved or booked.',
       'محاكاة POC: ترتيب تجريبي لبدائل SI-S01 دون استدعاء Airia. الجدول ليس معتمدًا أو محجوزًا.'):
      this.copy('Airia SI-S01 ranked verified alternatives. Supervisor approval remains required.',
       'رتب Airia SI-S01 البدائل الصالحة، ولا يزال اعتماد المشرف مطلوبًا.');
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
