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
interface UnscheduledDiagnostics{
 code:string;category:string;source:string;scopeCodes:string[];
 portId:string|null;earliestLocal:string|null;deadlineLocal:string|null;
 durationMinutes:number|null;candidateOptions:number;candidateInspectors:number;
 timeOrTravelConflicts:number;dailyCapacityConflicts:number;
 optionsStillInsertable:number;nextAction:string;advisoryOnly:true;
 competingVisits:{imo:string;inspectorId:string;inspectorName:string;
  portId:string;startLocal:string;endLocal:string}[];
 inspectorExclusions:{inspectorId:string;reasonCodes:string[]}[];
}
interface ScheduleRow{
 imo:string;status:'PROPOSED'|'UNSCHEDULED';blocker:string|null;
 diagnostics?:UnscheduledDiagnostics|null;
 assignment:{inspectorName:string;inspectorId:string;startLocal:string;
 endLocal:string;portName:string;locationName:string;score:number;
 crossPort?:boolean;originPortId?:string;originPortName?:string;
 travelMinutes?:number;manualReasons?:string[]}|null;
}
interface BoardAssignment{
 imo:string;planRank:number;inspectorId:string;inspectorName:string;
 dateLocal:string;startLocal:string;endLocal:string;
 portId:string;portName:string;locationType:string;locationName:string;score:number;
 crossPort?:boolean;originPortId?:string;originPortName?:string;
 travelMinutes?:number;manualReasons?:string[];
}
interface ScheduleBoard{
 status:'UNAPPROVED_PREVIEW_ONLY';approvalRequired:true;
 allocatedVessels:number;caseWrites:0;bookingWrites:0;
 engineers:{inspectorId:string;inspectorName:string;vesselCount:number;
 dates:string[];assignments:BoardAssignment[]}[];
 days:{dateLocal:string;vesselCount:number;assignments:BoardAssignment[]}[];
 unscheduled:{imo:string;planRank:number;blocker:string;
  diagnostics?:UnscheduledDiagnostics|null}[];
}
interface Variant{optionId:string;allocatedVessels:number;objectiveScore:number;
 assignments:{imo:string;inspectorId:string;portId:string;startUtc:string;endUtc:string;
 crossPort?:boolean;originPortId?:string;originPortName?:string;
 travelMinutes?:number;manualReasons?:string[]}[];
 rows:ScheduleRow[];board:ScheduleBoard;}
interface Proposal{planRevision:number;summary:{total:number;proposed:number;unscheduled:number;
 caseWrites:number;bookingWrites:number};rows:ScheduleRow[];status:string;
 proposalHash:string;variants?:Variant[];
 board?:ScheduleBoard;warnings:string[];aiAdvisory?:boolean;chosenOptionId?:string;}
interface S01Response{status:string;agentCode:'SI-S01';provider:'AIRIA'|'POC_MOCK';
 externalCalls:0|1;chosenOptionId:string;proposalHash:string;proposal:Proposal;
 rankedOptions:{optionId:string;rank:number;confidence:number;
 rationale:string;evidenceRefs:string[]}[];
 humanApprovalRequired:true;bookingWrites:0;caseWrites:0;}
interface WorkOrder{
 id:string;imo:string;status:string;caseId:string|null;checklistStatus:string;
 aiStatus:string;scopeStatus:string;error:string|null;pocDelegated?:boolean;
 assignment:{inspectorId:string;inspectorName:string;portName:string;portId:string;
 startLocal:string;startUtc:string;endUtc:string;crossPort?:boolean;
 originPortId?:string;originPortName?:string;travelMinutes?:number;
 manualReasons?:string[]};
}
interface ApprovedSchedule{
 id:string;planId:string;mode:'POC_MOCK'|'ERP_EXCEL_POC';status:string;
 approvedBy:string;approvedAt:string;operationalBookingConfirmed:boolean;
 orders:WorkOrder[];
}
@Component({
 selector:'app-si-maritime-batch-scheduling',standalone:true,
 imports:[CommonModule,FormsModule,RouterLink,NmcNavigationComponent],
 templateUrl:'./si-maritime-batch-scheduling.component.html',
 styleUrl:'./si-maritime-batch-scheduling.component.css'
})
export class SiMaritimeBatchSchedulingComponent implements OnInit{
 context:Context|null=null;proposal:Proposal|null=null;baselineProposal:Proposal|null=null;
 readonly demoMode=true; // POC demo data always enabled on this presentation screen.
 aiAdvice:S01Response|null=null;loading=false;busy=false;aiBusy=false;
 scheduleBusy=false;orderBusyId:string|null=null;error='';notice='';
 workOrdersError='';approvedSchedule:ApprovedSchedule|null=null;
 boardView:'VESSELS'|'ENGINEERS'|'DATES'='VESSELS';
 selectedUnscheduledImo:string|null=null;
 get selectedUnscheduled():ScheduleRow|null{
  return this.proposal?.rows.find(x=>x.imo===this.selectedUnscheduledImo&&
   x.status==='UNSCHEDULED')||null;
 }
 inspectUnscheduled(imo:string):void{
  this.selectedUnscheduledImo=this.selectedUnscheduledImo===imo?null:imo;
 }
 visitDetails(imo:string):SourceRow|null{
  return this.context?.items.find(x=>x.imo===imo)||null;
 }
 diagnosticsLabel(d:UnscheduledDiagnostics|null|undefined):string{
  if(!d)return this.copy('Scheduling details unavailable; recalculate preview.',
   'تفاصيل أسباب التعذر غير متاحة؛ أعد حساب الجدولة.');
  if(d.category==='OPTIMIZER_SEARCH_LIMIT')
   return this.copy('A candidate slot still fits the chosen plan; the bounded solver did not select it.',
    'يوجد موعد مرشح لا يتعارض مع الجدول الحالي، لكن محرك البحث المحدود لم يختره.');
  if(d.category==='PLAN_RESOURCE_CONTENTION')
   return this.copy('Candidate slots conflict with selected inspections, engineer daily capacity or inter-port travel.',
    'تتعارض المواعيد المرشحة مع معاينات مجدولة أو الطاقة اليومية للمهندس أو وقت الانتقال بين الموانئ.');
  if(d.code==='NO_FEASIBLE_ERP_SHIFT_QUALIFICATION_PORT_OR_WINDOW')
   return this.copy('No qualified engineer/shift/window combination was returned.',
    'لم يجد المحرك مهندسًا مؤهلًا بوردية وموعد مناسبين ضمن الفترة المتاحة.');
  const reasons:Record<string,[string,string]>={
   VESSEL_SCHEDULING_DATA_REQUIRED:['Visit details have not been provided.','بيانات زيارة السفينة غير مستكملة.'],
   VALID_INSPECTION_PORT_REQUIRED:['Inspection port is missing or inactive.','ميناء المعاينة غير محدد أو غير نشط.'],
   BERTH_ANCHORAGE_AND_ACCESS_CONFIRMATION_REQUIRED:['Visit site and site-access confirmation are required.','يلزم تحديد موقع المعاينة وتأكيد إتاحته.'],
   FINAL_VESSEL_ARRIVAL_DEPARTURE_WINDOW_REQUIRED:['A final evidenced visit window is required.','يلزم تحديد فترة زيارة نهائية موثقة.'],
   VESSEL_WINDOW_OR_DURATION_INVALID:['Visit window or inspection duration is invalid.','فترة الزيارة أو مدة المعاينة غير صحيحة.'],
   VESSEL_WINDOW_SHORTER_THAN_INSPECTION:['Visit window is shorter than inspection duration.','الوقت المتاح للسفينة أقصر من مدة المعاينة.'],
   NMC_APPROVED_REFERRAL_MISSING_OR_CLOSED:['The approved NMC referral is unavailable or closed.','إحالة المركز البحري المعتمدة غير متاحة أو مغلقة.'],
   NMC_REFERRAL_ALREADY_SCHEDULED_RECONCILE:['NMC referral already scheduled; reconcile before assigning again.','إحالة المركز البحري مجدولة بالفعل؛ راجع الربط قبل إعادة الإسناد.']
  };
  const txt=reasons[d.code];
  return txt?this.copy(txt[0],txt[1]):this.copy(
   'Review source and inspector eligibility details below.',
   'راجع بيانات المصدر وأهلية المهندسين بالتفصيل أدناه.');
 }
 exclusionLabel(code:string):string{
  const m:Record<string,[string,string]>={
   QUALIFICATION_MISSING_OR_EXPIRED:['Qualification missing/expired','التخصص غير متاح أو منتهي'],
   NO_WORKING_SHIFT:['No matching work shift','لا توجد وردية مناسبة'],
   BOOKING_CONFLICT:['Conflicting booking','يوجد تعارض مع تكليف آخر'],
   CAPACITY_EXCEEDED:['Daily capacity exceeded','تجاوز الطاقة اليومية'],
   PORT_NOT_ELIGIBLE:['Port or travel route not eligible','الميناء أو مسار الانتقال غير مسموح'],
   APPROVED_LEAVE:['Approved leave','إجازة معتمدة'],
   PORT_BLACKOUT:['Port access blackout','الميناء مغلق خلال الفترة'],
   EMPLOYEE_INACTIVE:['Inactive inspector','المهندس غير نشط'],
   CROSS_PORT_TRAVEL_TIME_UNAVAILABLE:['Travel duration unavailable','وقت الانتقال غير معروف'],
   NO_FEASIBLE_SLOT:['No matching slot','لا يوجد موعد مناسب']
  };
  const txt=m[code];return txt?this.copy(txt[0],txt[1]):code;
 }

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
 invalidateProposal():void{
  // The inputs changed after preview; never show obsolete slots as though
  // they were still valid, and never carry them into a future approval action.
  this.proposal=null;this.baselineProposal=null;this.aiAdvice=null;
  this.selectedUnscheduledImo=null;
  this.notice='';this.error='';
 }

 private readonly api='/api/si/v1/maritime-scheduling/plans/';
 constructor(private readonly http:HttpClient,private readonly route:ActivatedRoute,
  public readonly lang:LanguageService){}
 copy(en:string,ar:string):string{return this.lang.pick(en,ar);}
 ngOnInit():void{this.loadContext();this.loadWorkOrders();}
 get canApproveSchedule():boolean{
  return !!this.context&&!!this.proposal&&
   this.proposal.summary.total>0&&this.proposal.summary.unscheduled===0&&
   !!(this.baselineProposal?.variants?.length)&&
   !this.approvedSchedule&&!this.workOrdersError&&
   !this.busy&&!this.aiBusy&&!this.scheduleBusy;
 }
 get preferredOptionId():string{
  return this.aiAdvice?.chosenOptionId||
   this.baselineProposal?.variants?.[0]?.optionId||'';
 }
 private baseUrl():string{
  return this.api+encodeURIComponent(this.route.snapshot.paramMap.get('planId')||'');
 }
 loadWorkOrders():void{
  const planId=this.route.snapshot.paramMap.get('planId');
  if(!planId)return;
  this.http.get<{schedule:ApprovedSchedule|null}>(
   this.api+encodeURIComponent(planId)+'/work-orders').subscribe({
   next:r=>{this.approvedSchedule=r.schedule;this.workOrdersError='';},
   error:e=>{this.workOrdersError=e?.error?.error||
    'SI_SCHED_WORK_ORDERS_NOT_READY';
    if(e?.status!==503)this.error=this.workOrdersError;}
  });
 }
 approveSchedule():void{
  if(!this.canApproveSchedule||!this.baselineProposal||!this.context||
   !this.proposal)return;
  const reason=window.prompt(this.copy(
   'Reason for approving the complete schedule (minimum 8 characters):',
   'أدخل سبب اعتماد جدول توزيع المهندسين بالكامل (٨ أحرف على الأقل):'),
   this.copy('Reviewed feasible vessel visits and POC engineer assignments.',
    'تمت مراجعة الجدولة الممكنة وتوزيع المهندسين لأوامر التكليف التجريبية.'));
  if(!reason||reason.trim().length<8)return;
  const selected=this.baselineProposal.variants?.find(v=>
   v.optionId===this.preferredOptionId);
  if(!selected)return;
  const crossPort=selected.assignments.filter(a=>a.crossPort===true);
  // Extra explicit sign-off for all cross-port assignments. Never imply
  // synthetic travel or mock inspector availability is an ERP booking.
  if(crossPort.length&&!window.confirm(this.copy(
   crossPort.length+' cross-port inspector assignment(s) are proposed. '+
    'These qualified engineers travel from another port with POC travel times. '+
    'Do you explicitly approve the cross-port reassignments?',
   'توجد '+crossPort.length+' معاينة مقترحة لمهندسين من موانئ أخرى، '+
    'مع زمن انتقال تجريبي. هل تعتمد الإسناد بين الموانئ صراحةً؟')))return;
  const confirmed=window.confirm(this.copy(
   'Approve '+this.proposal.summary.total+
    ' assignments and issue work orders? No live ERP booking or regulatory decision is created.',
   'تأكيد اعتماد جدول '+this.proposal.summary.total+
    ' سفينة وإصدار أوامر تكليف؟ لا ينشأ حجز ERP فعلي أو قرار تنظيمي تلقائي.'));
  if(!confirmed)return;
  this.scheduleBusy=true;this.error='';this.notice='';
  this.http.post<{schedule:ApprovedSchedule}>(
   this.baseUrl()+'/approve',{
    requests:this.requests(),demoMode:this.demoMode,
    selectedOptionId:this.preferredOptionId,
    expectedProposalHash:this.baselineProposal.proposalHash,
    expectedPlanRevision:this.baselineProposal.planRevision,
    reason:reason.trim(),confirmApproval:true,
    confirmCrossPort:crossPort.length>0
   }).subscribe({
    next:r=>{this.scheduleBusy=false;this.approvedSchedule=r.schedule;
     this.notice=this.copy('Schedule and inspector work orders saved. No live ERP booking. Activate orders to prepare checklists.',
      'تم اعتماد الجدولة وحفظ أوامر التكليف دون حجز ERP فعلي. نفّذ الأوامر لتجهيز القوائم.');},
    error:e=>{this.scheduleBusy=false;this.showError(e);}
   });
 }
 workOrderAction(order:WorkOrder,action:'activate'|'scope'|'start'):void{
  if(this.orderBusyId||!this.approvedSchedule)return;
  let request:{[key:string]:unknown}={};
  if(action==='activate'){
   const generateAi=window.confirm(this.copy(
    'Prepare mandatory checklist now. Also request optional A04 AI checklist additions if sources permit? A real Airia call may cost money.',
    'سيتم تجهيز القائمة الإلزامية الآن. هل تريد أيضًا مقترحات A04 AI إذا سمحت المصادر؟ قد يكون استدعاء Airia مدفوعًا.'));
   request={generateAi,confirmAiCost:generateAi};
  }else if(action==='scope'){
   const reason=window.prompt(this.copy(
    'Supervisor: reason for mandatory checklist scope approval:',
    'المشرف: سبب اعتماد نطاق قوائم المعاينة الإلزامية:'));
   if(!reason||reason.trim().length<8)return;
   // A04 review happens in the separate preparation page after the
   // order is issued. The order's earlier status can still show DRAFT even
   // when a publisher has approved the overlay in that page. The server
   // checks the LATEST preparation revision before accepting additions.
   const includeAiSuggestions=order.aiStatus.startsWith('A04_')&&
    window.confirm(this.copy(
     'Include A04 additions ONLY if a supervisor has already approved their draft in Dossier Review? Otherwise choose Cancel and approve mandatory scope alone.',
     'هل تريد ضم إضافات A04 بعد اعتماد مسودتها من المسؤول في شاشة الدوسيه؟ اضغط إلغاء لاعتماد البنود الإلزامية فقط.'));
   request={reason:reason.trim(),includeAiSuggestions};
  }else{
   const poc=this.approvedSchedule.mode==='POC_MOCK';
   if(!window.confirm(poc?
    this.copy('POC DEMO: start on behalf of the assigned mock engineer? Audited delegation, not official inspector authentication.',
     'محاكاة POC: بدء المعاينة نيابة عن المهندس التجريبي؟ سيتم توثيق التفويض وليس إثبات دخول رسمي للمفتش.'):
    this.copy('Start as the authenticated assigned inspector?',
     'هل تبدأ المعاينة بهوية المفتش المسند إليه الأمر؟')))return;
   request={confirmPocDelegation:poc};
  }
  this.orderBusyId=order.id;this.error='';this.notice='';
  this.http.post<{order:WorkOrder}>(
   this.baseUrl()+'/work-orders/'+encodeURIComponent(order.id)+'/'+action,
   request).subscribe({
    next:r=>{
     this.orderBusyId=null;
     const idx=this.approvedSchedule?.orders.findIndex(x=>x.id===order.id)??-1;
     if(this.approvedSchedule&&idx>=0)this.approvedSchedule.orders[idx]=r.order;
     this.notice=action==='activate'?
      this.copy('Mandatory checklist prepared. A04 AI additions, if generated, need separate review. Supervisor must approve scope.',
       'تم تجهيز القائمة الإلزامية. بنود A04 الإضافية تحتاج مراجعة، ثم يعتمد المشرف نطاق المعاينة.'):
      action==='scope'?
       this.copy('Scope approved and engineer assigned; inspector may start the field visit.',
        'تم اعتماد النطاق وإسناد المهندس؛ يمكن الآن بدء المعاينة الميدانية.'):
       this.copy('Inspection started; open its case checklist.',
        'بدأت المعاينة؛ افتح قائمة المعاينة الخاصة بالحالة.');
    },
    error:e=>{this.orderBusyId=null;this.showError(e);this.loadWorkOrders();}
   });
 }
 loadContext():void{
  const id=this.route.snapshot.paramMap.get('planId');
  if(!id){this.error='Approved plan ID is required';return;}
  this.loading=true;this.error='';this.notice='';this.context=null;
  this.proposal=null;this.baselineProposal=null;this.aiAdvice=null;
  this.http.get<Context>(this.api+encodeURIComponent(id)+
    '/context'+(this.demoMode?'?demo=1':'')).subscribe({
   next:data=>{this.context=data;this.loading=false;
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
  this.selectedUnscheduledImo=null;
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
