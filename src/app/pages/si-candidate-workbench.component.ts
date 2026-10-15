import {LanguageService} from '../services/language.service';
import {MoeiAuthService} from '../services/moei-auth.service';
import {CommonModule} from '@angular/common';
import {HttpClient} from '@angular/common/http';
import {Component,OnInit,OnDestroy,ViewChild,ElementRef} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {RouterLink} from '@angular/router';
import {NmcNavigationComponent} from '../components/nmc-navigation.component';
import {SiCandidate,SiCandidateStatus,SiCandidateTargetingService,
  SiDashboard,SiVesselCandidate,SiInspectionPlanState,SiInspectionPlanRow,SiRollingPlan,SiC01Run,SiC01Preview,SiDraftScope,SiC01Recommendation,SiPriorityStatus,SiPriorityPreview,SiPriorityRun,SiPriorityRecommendation,SiPriorityPreviewItem}
  from '../services/si-candidate-targeting.service';
import {SiPscSelectionService,PscSelectionPool} from '../services/si-psc-selection.service';

interface DraftVisitRequest {
 imo:string;portId:string;vesselType:string;regime:string;locationType:string;
 locationName:string;siteAccessConfirmed:boolean;durationMinutes:number;
 berthAtLocal?:string;berthConfirmed?:boolean;berthEvidenceReference?:string;
 earliestLocal:string;latestFinishLocal:string;windowSource:string;
 windowEvidenceReference:string;
}
interface DraftManualAlternative {
 imo:string;vesselName:string;sourceTypes:string[];
 priorityCriterion:string;periodStatus:string;
 eligibleBases:string[];requiredOfficerReason:boolean;aiAdvice:string;
}
interface DraftOfficerAdd {imo:string;basis:string;reason:string}
interface DraftIntegratedPreview {
 previewId:string;proposalHash:string;selectionHash:string;
 metadata:{title:string;startsOn:string;endsOn:string;notes:string;demoMode:boolean};
 provider:string;candidateCount:number;selectedCount:number;
 prioritizedCount:number;finalPlanCount:number;
 feasibleCount:number;unscheduledCount:number;demoOnly:boolean;
 outsidePlanCount:number;finalizedPlanImos:string[];
 pipelineStages:{stage:string;status:string;count:number;description:string}[];
 outsidePlan:{imo:string;originalPriority:number;reasonCode:string;
  disposition:string;remainsInCandidatePool:boolean;workOrderIssued:boolean}[];
 protectedCapacityExceptions:{imo:string;reasonCode:string}[];
 mandatoryUnscheduled:string[];outsidePlanPeriod:string[];
 readyForSupervisorReview:boolean;expiresInMinutes:number;
 manualAlternatives:DraftManualAlternative[];
 officerSelectedAlternatives:DraftOfficerAdd[];
 availablePlanSlots:number;
 visitRequests:DraftVisitRequest[];
 visitInputs:{imo:string;portSourceLocked:boolean;sourceArrivalLocked:boolean;
  sourceDepartureLocked:boolean}[];
 ports:{portId:string;name:string}[];
 items:{imo:string;planRank:number;vesselName:string;priorityReason:string|null;
  priorityCriterion:string;mandatory:boolean;status:string;blocker:string|null;
  inCurrentPlan:boolean;disposition:string;remainsCandidate:boolean;
  outsideReasonCode:string|null;
  inspectorName:string|null;portName:string|null;startLocal:string|null;
  endLocal:string|null;sourceTypes:string[];
  visitWindow?:{etaLocal:string;etdLocal:string;berthAtLocal:string|null;
   feasibleFromLocal:string;feasibleUntilLocal:string}|null}[];
}
interface IntegratedDraftJob {
 status:'QUEUED'|'RUNNING'|'COMPLETED'|'FAILED';
 jobId:string;phase:string;createdAt:string;
 expectedBatches:number;completedBatches:number;
 totalWorkflows:number;processedWorkflows:number;totalVessels:number;
 preview?:DraftIntegratedPreview;error?:string;
 reasonCode?:string;failureCounts?:Record<string,number>;
 batchIndex?:number;batchCount?:number;
}
const INTEGRATED_DRAFT_JOB_KEY='moei-si-integrated-draft-job-v1';
type SourceFilter='ALL'|'NMC_CASE'|'SERVICE_REQUEST'|'PSC_PORT_CALL';
type StatusFilter='ALL'|SiCandidateStatus;
@Component({
  selector:'app-si-candidate-workbench',
  standalone:true,imports:[CommonModule,FormsModule,RouterLink,NmcNavigationComponent ],
  templateUrl:'./si-candidate-workbench.component.html',
  styleUrl:'./si-candidate-workbench.component.css'
})
export class SiCandidateWorkbenchComponent implements OnInit,OnDestroy{
  loading=false;busy=false;error='';success='';
  dashboard:SiDashboard|null=null;
  pscQuota:PscSelectionPool|null=null;
  sourceFilter:SourceFilter='ALL';statusFilter:StatusFilter='ALL';search='';
  selectedKey='';selectedImo='';
  reviewer='admin';decisionNote='';editorKey='MOEI_SESSION';publisherKey='MOEI_SESSION';
  plan:SiInspectionPlanState|null=null;
  rollingPlans:SiRollingPlan[]=[];activePlanId:string|null=null;
  planningError='';planningBusy=false;newPlanVisible=false;
  newPlan={title:'',startsOn:'',endsOn:'',notes:''};
  newDraftDemoMode=true;newDraftAiConsent=false;
  newDraftProvider:'AIRIA'|'MOCK'|'UNKNOWN'='UNKNOWN';
  newDraftExpectedBatches=0;newDraftPreview:DraftIntegratedPreview|null=null;
  newDraftScope:SiDraftScope|null=null;newDraftScopeLoading=false;
  newDraftScopeError='';
  newDraftRequests:DraftVisitRequest[]=[];newDraftChanged=false;
  newDraftOfficerAdds:DraftOfficerAdd[]=[];
  newDraftAlternativeSearch='';
  newDraftBusy=false;newDraftNotice='';
  newDraftJobId='';newDraftJobPhase='';newDraftCompletedBatches=0;
  newDraftProcessedWorkflows=0;newDraftTotalWorkflows=0;newDraftTotalVessels=0;
  private draftPollTimer:ReturnType<typeof setTimeout>|null=null;
  get activePlan():SiRollingPlan|undefined{
    return this.rollingPlans.find(p=>p.id===this.activePlanId);
  }
  get activePlanEditable():boolean{
    return !!this.activePlan&&['DRAFT','READY_FOR_APPROVAL'].includes(this.activePlan.status);
  }
  private localDate():string{
    const date=new Date(),two=(n:number)=>String(n).padStart(2,'0');
    return [date.getFullYear(),two(date.getMonth()+1),two(date.getDate())].join('-');
  }
  private localDayOffset(days:number):string{
    const date=new Date();date.setDate(date.getDate()+days);
    const two=(n:number)=>String(n).padStart(2,'0');
    return [date.getFullYear(),two(date.getMonth()+1),two(date.getDate())].join('-');
  }
  openCreatePlan():void{
    this.newPlanVisible=true;this.planningError='';this.newDraftNotice='';
    this.newDraftPreview=null;this.newDraftRequests=[];
    this.newDraftChanged=false;this.newDraftAiConsent=false;
    const start=this.localDayOffset(1);
    this.newPlan={title:'Inspection Plan '+start,startsOn:start,
      endsOn:this.localDayOffset(7),notes:''};
    this.newDraftExpectedBatches=0;this.newDraftProvider='UNKNOWN';
    this.refreshDraftScope();
  }
  refreshDraftScope():void{
    if(this.newDraftBusy||this.newDraftScopeLoading)return;
    this.newDraftScope=null;this.newDraftScopeError='';
    this.newDraftScopeLoading=true;this.newDraftProvider='UNKNOWN';
    // Read-only exact source + published policy preflight; no AI or writes.
    this.api.candidateAiPreview(this.editorKey.trim()).subscribe({
      next:info=>{
        this.newDraftScopeLoading=false;
        this.newDraftExpectedBatches=info.expectedBatches||0;
        this.newDraftProvider=info.provider;
        this.newDraftScope=info.draftScope||null;
        if(this.newDraftScope?.requiresOfficerAction){
          this.newDraftAiConsent=false;
        }
      },
      error:e=>{
        this.newDraftScopeLoading=false;this.newDraftProvider='UNKNOWN';
        this.newDraftScopeError=this.draftIssue(e);
      }
    });
  }
  draftParametersChanged():void{
    this.newDraftPreview=null;this.newDraftRequests=[];
    this.newDraftChanged=false;this.newDraftNotice='';
    this.newDraftOfficerAdds=[];
  }
  draftVisitsChanged():void{
    this.newDraftChanged=true;this.newDraftNotice='';
  }
  private draftIssue(e:any):string{
    const code=e?.error?.error||e?.errorCode||'';
    const count=e?.error?.requiredBatches;
    if(e?.error?.scope&&typeof e.error.scope==='object'){
      this.newDraftScope=e.error.scope as SiDraftScope;
      this.newDraftAiConsent=false;
    }
    if(code==='SI_C01_BATCH_COUNT_CONFIRMATION_REQUIRED'&&
      Number.isInteger(count)&&count>0)this.newDraftExpectedBatches=count;
    const reasons=Object.entries(e?.error?.failureCounts||{})
      .filter(([,n])=>typeof n==='number'&&n>0)
      .map(([key,n])=>key+' ('+n+')').slice(0,3).join(', ');
    if(code)return code+(reasons?' · '+reasons:'')+
      (e?.error?.reasonCode?' · '+e.error.reasonCode:'')+
      (e?.error?.batchIndex?' · batch '+e.error.batchIndex+'/'+
        (e.error.batchCount||'?'):'');
    const status=Number(e?.status)||0;
    if(status===504||status===502||status===503){
      return this.copy(
        'HTTP '+status+' — proxy/backend connection failed. No confirmed draft was saved. Check the existing C01 job and server logs before requesting another analysis.',
        'HTTP '+status+' — تعذر اتصال الخادم. لم يُؤكد حفظ أي مسودة. راجع حالة التحليل الحالية قبل إعادة المحاولة.');
    }
    if(status===0)return this.copy(
      'Network request interrupted. Check the job status and connection; before starting another analysis.',
      'انقطع اتصال المتصفح. افحص حالة التشغيل والاتصال قبل بدء تحليل جديد.');
    return 'SI_INTEGRATED_DRAFT_REQUEST_FAILED · HTTP '+status+
      (e?.statusText?' · '+e.statusText:'');
  }
  private rememberIntegratedJob(id:string):void{
    try{sessionStorage.setItem(INTEGRATED_DRAFT_JOB_KEY,id);}catch{}
  }
  private forgetIntegratedJob():void{
    try{sessionStorage.removeItem(INTEGRATED_DRAFT_JOB_KEY);}catch{}
  }
  private stopIntegratedPolling():void{
    if(this.draftPollTimer!==null){clearTimeout(this.draftPollTimer);
      this.draftPollTimer=null;}
  }
  private adoptIntegratedPreview(draft:DraftIntegratedPreview):void{
    this.newDraftBusy=false;this.newDraftPreview=draft;
    this.newDraftJobId='';this.newDraftJobPhase='';
    this.newDraftCompletedBatches=this.newDraftExpectedBatches;
    this.newDraftRequests=draft.visitRequests.map(v=>({...v}));
    this.newDraftOfficerAdds=(draft.officerSelectedAlternatives||[]).map(v=>({...v}));
    this.newPlan={title:draft.metadata.title,startsOn:draft.metadata.startsOn,
      endsOn:draft.metadata.endsOn,notes:draft.metadata.notes};
    this.newDraftDemoMode=draft.demoOnly;
    this.newDraftChanged=false;
    this.forgetIntegratedJob();
    this.newDraftNotice=this.copy(
      'C01 selection, priority and qualified-inspector capacity finished. Review exceptions before saving this draft.',
      'اكتمل اختيار السفن والأولوية وحساب طاقة المهندسين. راجع الاستثناءات قبل حفظ المسودة.');
  }
  private handleIntegratedJob(data:IntegratedDraftJob):void{
    this.newDraftJobId=data.jobId;
    this.newDraftJobPhase=data.phase;
    this.newDraftCompletedBatches=data.completedBatches||0;
    this.newDraftTotalWorkflows=data.totalWorkflows||this.newDraftScope?.candidateWorkflows||0;
    this.newDraftTotalVessels=data.totalVessels||this.newDraftScope?.eligibleVessels||0;
    this.newDraftProcessedWorkflows=data.processedWorkflows||0;
    if(data.expectedBatches)this.newDraftExpectedBatches=data.expectedBatches;
    if(data.status==='COMPLETED'){
      this.stopIntegratedPolling();
      if(data.preview)this.adoptIntegratedPreview(data.preview);
      else{this.newDraftBusy=false;this.forgetIntegratedJob();
        this.planningError='SI_DRAFT_JOB_COMPLETED_WITHOUT_PREVIEW';}
      return;
    }
    if(data.status==='FAILED'){
      this.stopIntegratedPolling();this.newDraftBusy=false;
      this.forgetIntegratedJob();
      this.planningError=this.draftIssue({
        error:{error:data.error||'SI_DRAFT_JOB_FAILED',
          reasonCode:data.reasonCode,failureCounts:data.failureCounts,
          batchIndex:data.batchIndex,batchCount:data.batchCount}});
      this.newDraftNotice=this.copy(
        'This run is finished. Review the failed batch and logs before requesting another analysis.',
        'انتهى التشغيل؛ راجع الدفعة الفاشلة والسجلات قبل طلب تحليل جديد.');
      return;
    }
    this.newDraftBusy=true;
    this.stopIntegratedPolling();
    this.draftPollTimer=setTimeout(()=>this.pollIntegratedDraftJob(),2500);
  }
  private pollIntegratedDraftJob():void{
    if(!this.newDraftJobId)return;
    this.http.get<IntegratedDraftJob>(
      '/api/si/v1/inspection-plans/draft-jobs/'+this.newDraftJobId).subscribe({
      next:data=>this.handleIntegratedJob(data),
      error:e=>{
        this.stopIntegratedPolling();this.newDraftBusy=false;
        this.planningError=this.draftIssue(e);
        this.newDraftNotice=this.copy(
          'A browser/network error does not prove the Airia job stopped. Reload this page to resume checking the same job without restarting the analysis.',
          'خطأ المتصفح لا يعني توقف Airia؛ أعد تحميل الصفحة لاستكمال متابعة نفس Job دون بدء تحليل جديد.');
        // Keep sessionStorage ID: reload only polls the SAME existing job.
      }
    });
  }
  private restoreIntegratedJob():void{
    let existing:string|null=null;
    try{existing=sessionStorage.getItem(INTEGRATED_DRAFT_JOB_KEY);}catch{}
    if(!existing||!/^[a-f0-9-]{36}$/.test(existing))return;
    this.newPlanVisible=true;this.newDraftJobId=existing;
    this.newDraftBusy=true;this.newDraftNotice=this.copy(
      'Resuming an existing C01 draft job; no new Airia request will be made.',
      'استكمال متابعة Job قائم لإنشاء المسودة دون تشغيل Airia مرة أخرى.');
    this.pollIntegratedDraftJob();
  }
  generateIntegratedDraft():void{
    if(this.newDraftScopeLoading||!this.newDraftScope||
      this.newDraftScope.requiresOfficerAction||
      this.newDraftBusy||!this.newDraftAiConsent||!this.newPlan.title.trim()||
      !this.newPlan.startsOn||!this.newPlan.endsOn||
      this.newPlan.endsOn<this.newPlan.startsOn)return;
    if(this.newDraftProvider==='UNKNOWN'){
      this.planningError=this.copy(
        'Cannot verify C01 provider. Reload the preflight before running AI.',
        'تعذر معرفة مزود C01. أعد تحميل بيانات المرشحين قبل تشغيل AI.');return;
    }
    if(!window.confirm(this.copy(
      'Start one tracked C01 job with '+this.newDraftExpectedBatches+
      ' verified batches, followed by priority and inspector-capacity planning? Do not retry if you lose the browser connection; reload to resume.',
      'هل تريد بدء Job يتابع '+this.newDraftExpectedBatches+
      ' دفعات C01 ثم يحسب الأولويات وطاقة المهندسين؟ لو انقطع المتصفح أعد تحميل الصفحة للاستكمال دون إعادة Airia.')))return;
    this.newDraftBusy=true;this.planningError='';this.newDraftNotice='';
    this.newDraftPreview=null;this.newDraftRequests=[];this.newDraftChanged=false;
    this.newDraftCompletedBatches=0;this.newDraftJobPhase='QUEUED';
    this.newDraftTotalWorkflows=this.newDraftScope?.candidateWorkflows||0;
    this.newDraftTotalVessels=this.newDraftScope?.eligibleVessels||0;
    this.newDraftProcessedWorkflows=0;
    this.http.post<IntegratedDraftJob>('/api/si/v1/inspection-plans/draft-preview',{
      ...this.newPlan,demoMode:this.newDraftDemoMode,
      confirmAi:true,confirmCost:true,
      confirmBatchCount:this.newDraftExpectedBatches||1
    }).subscribe({
      next:data=>{
        this.newDraftJobId=data.jobId;
        this.rememberIntegratedJob(data.jobId);
        this.handleIntegratedJob(data);
      },
      error:e=>{
        this.newDraftBusy=false;
        this.planningError=this.draftIssue(e);
        this.newDraftNotice=this.copy(
          'If this request was interrupted, check the current analysis status before starting again.',
          'لو انقطع الطلب، راجع حالة التحليل الحالية قبل إعادة المحاولة.');
      }
    });
  }
  get filteredDraftAlternatives():DraftManualAlternative[]{
    const all=this.newDraftPreview?.manualAlternatives||[];
    const q=this.newDraftAlternativeSearch.trim().toLowerCase();
    return q?all.filter(v=>(v.imo+' '+v.vesselName).toLowerCase().includes(q)):all;
  }
  isDraftAlternativeSelected(imo:string):boolean{
    return this.newDraftOfficerAdds.some(v=>v.imo===imo);
  }
  toggleDraftAlternative(v:DraftManualAlternative,selected:boolean):void{
    this.planningError='';
    if(!selected){this.newDraftOfficerAdds=this.newDraftOfficerAdds.filter(x=>x.imo!==v.imo);}
    else if(!this.isDraftAlternativeSelected(v.imo)){
      this.newDraftOfficerAdds.push({imo:v.imo,basis:v.eligibleBases[0],reason:''});
    }
    this.draftVisitsChanged();
  }
  removeDraftAlternative(imo:string):void{
    this.newDraftOfficerAdds=this.newDraftOfficerAdds.filter(x=>x.imo!==imo);
    this.draftVisitsChanged();
  }
  recalculateIntegratedDraft():void{
    if(this.newDraftBusy||!this.newDraftPreview)return;
    this.planningError='';this.newDraftNotice='';
    if(this.newDraftOfficerAdds.some(x=>!x.reason.trim()||
      x.reason.trim().length<10)){
      this.planningError=this.copy(
        'Enter a specific operational reason (at least 10 characters) for each officer-selected alternative.',
        'اكتب سببًا تشغيليًا واضحًا لكل سفينة إضافية، لا يقل عن 10 أحرف.');
      return;
    }
    this.newDraftBusy=true;
    this.http.post<DraftIntegratedPreview>('/api/si/v1/inspection-plans/draft-recalculate',{
      previewId:this.newDraftPreview.previewId,
      officerAdds:this.newDraftOfficerAdds,
      ...(this.newDraftOfficerAdds.length===
        (this.newDraftPreview.officerSelectedAlternatives||[]).length&&
        this.newDraftOfficerAdds.every((x,i)=>
          x.imo===this.newDraftPreview!.officerSelectedAlternatives[i]?.imo)?
        {requests:this.newDraftRequests}:{})
    }).subscribe({
      next:x=>{this.newDraftBusy=false;this.newDraftPreview=x;
        this.newDraftRequests=x.visitRequests.map(v=>({...v}));
        this.newDraftOfficerAdds=(x.officerSelectedAlternatives||[]).map(v=>({...v}));
        this.newDraftChanged=false;
        this.newDraftNotice=this.copy(
          'Capacity recalculated under the source rules without another AI call.',
          'أُعيد حساب الطاقة وفق المصادر دون استدعاء AI جديد.');},
      error:e=>{this.newDraftBusy=false;this.planningError=this.draftIssue(e);}
    });
  }
  saveIntegratedDraft():void{
    if(this.newDraftBusy||!this.newDraftPreview||this.newDraftChanged)return;
    if(!window.confirm(this.copy(
      'Save this exact candidate, priority and capacity proposal as an UNAPPROVED draft? Inspector allocations are NOT ERP bookings.',
      'هل تريد حفظ السفن والأولويات وتكليفات المهندسين المقترحة كمسودة غير معتمدة؟ التخصيصات ليست حجوزات ERP رسمية.')))return;
    this.newDraftBusy=true;this.planningError='';
    this.http.post<{planId:string;planStatus:string;planNumber:string;
      selectedVessels:number;feasibleAssignments:number;capacityExceptions:number}>(
      '/api/si/v1/inspection-plans/draft-save',{
       previewId:this.newDraftPreview.previewId,
       proposalHash:this.newDraftPreview.proposalHash,
       selectionHash:this.newDraftPreview.selectionHash
      }).subscribe({
      next:r=>{
        this.newDraftBusy=false;this.newPlanVisible=false;
        this.newDraftPreview=null;this.activePlanId=r.planId;
        this.clearBulkSelection();this.plan=null;
        this.loadRollingPlans();this.loadInspectionPlan();
        this.success=this.copy(
          'Saved '+r.planNumber+' as '+r.planStatus+': '+r.feasibleAssignments+
          '/'+r.selectedVessels+' capacity-feasible vessels; '+r.capacityExceptions+
          ' exception(s). Supervisor approval remains separate.',
          'حُفظت الخطة '+r.planNumber+': '+r.feasibleAssignments+
          ' من '+r.selectedVessels+' سفينة قابلة للتنفيذ؛ '+r.capacityExceptions+
          ' استثناء. الاعتماد خطوة منفصلة.');
      },
      error:e=>{this.newDraftBusy=false;this.planningError=this.draftIssue(e);}
    });
  }
  loadRollingPlans():void{
    this.api.rollingPlans().subscribe({
      next:r=>{
        this.rollingPlans=r.plans;
        this.planningError='';
      },
      error:e=>{this.planningError=e?.error?.error||'SI_ROLLING_PLANS_UNAVAILABLE';}
    });
  }
  openRollingPlan(p:SiRollingPlan):void{
    this.activePlanId=p.id;this.plan=null;this.planEditingImo='';
    this.clearBulkSelection();
    this.loadInspectionPlan();
  }
  cancelRollingPlan(p:SiRollingPlan):void{
    const reason=window.prompt(this.copy(
      'Reason for cancelling this DRAFT plan (min 8 characters):',
      'سبب إلغاء الخطة غير المعتمدة (8 أحرف على الأقل):'));
    if(!reason||reason.trim().length<8)return;
    if(!window.confirm(this.copy('Cancel this draft plan? Existing cases will not be affected.',
      'إلغاء مسودة الخطة؟ لن تتغير حالات المعاينة المعتمدة.')))return;
    this.planningBusy=true;
    this.api.cancelRollingPlan(p.id,p.revision,reason.trim()).subscribe({
      next:()=>{this.planningBusy=false;this.loadRollingPlans();
        if(this.activePlanId===p.id){this.activePlanId=null;this.plan=null;
          this.clearBulkSelection();}},
      error:e=>{this.planningBusy=false;
        this.planningError=e?.error?.error||'SI_ROLLING_PLAN_CANCEL_FAILED';}
    });
  }

  planBusy=false;planError='';planNotice='';
  // The API is synchronous per call; never pretend that intermediate AI steps
  // or a percentage are known. Indeterminate status remains truthful.
  planAiPhase:'idle'|'analyzing'|'updating'='idle';
  expandedImo='';planEditingImo='';
  planSelection=true;planReason='';planRequestedRank:number|null=null;
  get planLookup():Map<string,SiInspectionPlanRow>{
    return new Map((this.plan?.rows||[]).map(x=>[x.imo,x]));
  }
  planRow(v:SiVesselCandidate):SiInspectionPlanRow|null{
    return this.planLookup.get(v.imo)||null;
  }
  /** ETA may be a saved UAE-local time; ETD can be a UTC/offset ISO.
   * Never format a missing/conflicting date as a verified arrival/departure.
   */
  candidateMovementTime(raw:string|null|undefined):string{
    if(!raw)return '—';
    if(/(?:Z|[+-]\d\d:\d\d)$/.test(raw)){
      const d=new Date(raw);
      if(Number.isNaN(d.getTime()))return '—';
      return new Intl.DateTimeFormat('en-GB',{
        timeZone:'Asia/Dubai',year:'numeric',month:'2-digit',day:'2-digit',
        hour:'2-digit',minute:'2-digit',hourCycle:'h23'
      }).format(d);
    }
    const local=raw.replace('T',' ');
    return /^\d{4}-\d\d-\d\d \d\d:\d\d/.test(local)?
      local.slice(0,16):'—';
  }
  vesselOutsidePlan(v:SiVesselCandidate):boolean{
    return this.planRow(v)?.periodEligibility?.status==='OUTSIDE_EXECUTION_PLAN';
  }
  vesselPlanPeriodMessage(v:SiVesselCandidate):string{
    const p=this.planRow(v)?.periodEligibility;
    if(!p||p.status!=='OUTSIDE_EXECUTION_PLAN')return '';
    const name=v.vesselName+' (IMO '+v.imo+')';
    const dates=p.planStartsOn+' → '+p.planEndsOn;
    const reason=p.reasonCode==='ARRIVAL_AFTER_PLAN_END'?
      this.copy('verified vessel ETA is AFTER plan end',
        'موعد وصول السفينة المؤكد بعد انتهاء فترة الخطة'):
      this.copy('verified vessel ETD is BEFORE plan start',
        'موعد مغادرة السفينة المؤكد قبل بداية فترة الخطة');
    return this.copy(
      'Cannot include '+name+'. Its '+reason+
      '. Execution Plan: '+dates+'. Choose a plan covering the verified vessel visit window.',
      'لا يمكن إدراج السفينة '+name+'، لأن '+reason+
      '. فترة تنفيذ الخطة: '+dates+'. اختر خطة تشمل موعد وجود السفينة بالميناء.');
  }
  get aiSelectedCount():number|null{return this.plan?.aiRecommendedVessels??null;}
  get planSelectedCount():number|null{return this.plan?.selectedForPlan??null;}
  get providerLabel():string{return this.plan?.provider||'NOT LOADED';}
  get approvalReady():boolean{
    return !!this.activePlanId&&this.activePlan?.status==='READY_FOR_APPROVAL'&&
      !!this.plan?.selectedForPlan&&!this.plan.stale&&
      (Boolean(this.plan.agentRunId)||Boolean(this.plan.manualSelection));
  }
  // Independent from per-workflow approval: one checkbox represents ONE IMO
  // and all its source reasons in the current *draft* plan.
  bulkSelectedImos=new Set<string>();
  bulkAction:'NOT_SELECTED'|'DEFER'|null=null;
  bulkReason='';bulkReviewAfter='';
  get bulkSelectedCount():number{return this.bulkSelectedImos.size;}
  get bulkVisibleEligible():SiVesselCandidate[]{
    return this.vessels.filter(v=>this.bulkEligible(v));
  }
  get bulkAllVisibleSelected():boolean{
    const rows=this.bulkVisibleEligible;
    return !!rows.length&&rows.every(v=>this.bulkSelectedImos.has(v.imo));
  }
  bulkEligible(v:SiVesselCandidate):boolean{
    return this.activePlanEditable&&!!this.plan&&!this.plan.stale&&
      !!this.planRow(v)?.editable&&v.pendingWorkflows>0&&!this.planBusy&&
      this.auth.isAdmin;
  }
  toggleBulkVessel(v:SiVesselCandidate,checked:boolean):void{
    if(!this.bulkEligible(v))return;
    if(checked)this.bulkSelectedImos.add(v.imo);
    else this.bulkSelectedImos.delete(v.imo);
    this.bulkAction=null;this.bulkReason='';this.planError='';
  }
  toggleBulkVisible(checked:boolean):void{
    for(const v of this.bulkVisibleEligible){
      if(checked)this.bulkSelectedImos.add(v.imo);
      else this.bulkSelectedImos.delete(v.imo);
    }
    this.bulkAction=null;this.bulkReason='';this.planError='';
  }
  clearBulkSelection():void{
    this.bulkSelectedImos.clear();this.bulkAction=null;
    this.bulkReason='';this.bulkReviewAfter='';
  }
  startBulkAction(action:'NOT_SELECTED'|'DEFER'):void{
    if(!this.bulkSelectedCount||!this.activePlanEditable||!this.plan||
       this.plan.stale||this.planBusy||!this.auth.isAdmin)return;
    this.bulkAction=action;this.bulkReason='';
    this.bulkReviewAfter=this.localDate();this.planError='';
    this.closeManualDecision();this.cancelPlanEdit();
  }
  saveBulkAction():void{
    if(!this.bulkAction||!this.plan||!this.activePlanId||
       !this.activePlanEditable||this.plan.stale||this.planBusy||
       !this.auth.isAdmin)return;
    const ids=[...this.bulkSelectedImos].sort();
    const available=new Set((this.dashboard?.vesselCandidates||[])
      .filter(v=>v.pendingWorkflows>0&&this.planLookup.get(v.imo)?.editable)
      .map(v=>v.imo));
    if(!ids.length||ids.some(imo=>!available.has(imo))){
      this.planError=this.copy('Selection has changed. Reload the plan and select eligible vessels again.',
        'تغيرت قائمة السفن؛ أعد تحميل الخطة وحدد السفن المؤهلة من جديد.');
      this.clearBulkSelection();return;
    }
    if(this.bulkReason.trim().length<8||this.bulkReason.length>500){
      this.planError=this.copy('A shared reason of 8–500 characters is required.',
        'سبب موحد من 8 إلى 500 حرف مطلوب لهذا الإجراء.');return;
    }
    if(this.bulkAction==='DEFER'&&(!/^\d{4}-\d{2}-\d{2}$/.test(this.bulkReviewAfter)||
      !Number.isFinite(Date.parse(this.bulkReviewAfter+'T00:00:00Z')))){
      this.planError=this.copy('Choose a valid deferral review date.',
        'حدد تاريخًا صحيحًا لإعادة مراجعة السفن المؤجلة.');return;
    }
    const action=this.bulkAction;
    const verb=action==='DEFER'?this.copy('Defer','تأجيل'):this.copy('Exclude','استبعاد');
    if(!window.confirm(this.copy(
      'Apply '+verb+' to '+ids.length+' vessel(s) in this draft plan only? No source event or inspection case will be deleted.',
      'تأكيد '+verb+' '+ids.length+' سفينة من مسودة الخطة الحالية فقط؟ لن تُحذف أي مصادر أو حالات معاينة.')))return;
    this.planBusy=true;this.planError='';this.planNotice='';
    this.api.bulkSelectRollingVessels(this.activePlanId,{
      imos:ids,action,reason:this.bulkReason.trim(),
      reviewAfter:action==='DEFER'?this.bulkReviewAfter:null,
      expectedRevision:this.plan.revision,expectedSourceHash:this.plan.sourceHash
    }).subscribe({
      next:r=>{
        this.planBusy=false;this.clearBulkSelection();
        this.loadRollingPlans();this.loadInspectionPlan();
        this.planNotice=this.copy(
          'Saved '+verb+' for '+r.affectedCount+' vessels in this draft. No AI call or official inspection case change.',
          'تم تسجيل '+verb+' لعدد '+r.affectedCount+
          ' سفينة في المسودة دون تشغيل AI أو تغيير حالات المعاينة الرسمية.');
      },
      error:e=>{
        this.planBusy=false;
        this.planError=e?.error?.error||'SI_PLAN_BULK_SELECTION_FAILED';
        if(this.planError.includes('CHANGED')||
           this.planError.includes('CONFLICT'))this.loadInspectionPlan();
      }
    });
  }
  manualEditingImo='';
  manualAction:'INCLUDE'|'NOT_SELECTED'|'DEFER'|'NOT_APPLICABLE'='INCLUDE';
  manualReason='';manualReviewAfter='';
  openManualDecision(v:SiVesselCandidate,
    action:'INCLUDE'|'NOT_SELECTED'|'DEFER'|'NOT_APPLICABLE'):void{
    const row=this.planRow(v);
    if(!this.activePlanEditable||!this.activePlanId||!this.plan||!row?.editable||
       this.planBusy||!this.auth.isAdmin)return;
    if(action==='INCLUDE'&&this.vesselOutsidePlan(v)){
      this.planError=this.vesselPlanPeriodMessage(v);this.manualEditingImo='';
      return;
    }
    if(action==='NOT_APPLICABLE'&&row.mandatoryReferral){
      this.planError=this.copy('Mandatory NMC referrals cannot be marked Not Applicable.',
        'لا يمكن استبعاد إحالات NMC الإلزامية باعتبارها غير منطبقة.');return;
    }
    this.manualEditingImo=v.imo;this.manualAction=action;
    this.manualReason='';this.manualReviewAfter=this.localDate();
    this.planEditingImo='';this.planError='';
  }
  closeManualDecision():void{
    this.manualEditingImo='';this.manualReason='';this.manualReviewAfter='';
  }
  saveManualDecision():void{
    if(!this.manualEditingImo||!this.activePlanEditable||!this.activePlanId||
       !this.plan||this.planBusy||!this.auth.isAdmin)return;
    if(this.manualReason.trim().length<8){
      this.planError=this.copy('Provide an auditable reason of at least eight characters.',
        'يجب تسجيل سبب لا يقل عن 8 أحرف.');return;
    }
    const reviewAfter=this.manualAction==='DEFER'?this.manualReviewAfter:null;
    if(this.manualAction==='DEFER'&&
       (!/^\d{4}-\d{2}-\d{2}$/.test(this.manualReviewAfter)||
        Number.isNaN(Date.parse(this.manualReviewAfter+'T00:00:00Z')))){
      this.planError=this.copy('Choose a valid review date.',
        'اختر تاريخ مراجعة صحيحًا.');return;
    }
    if(this.manualAction==='INCLUDE'){
      const vessel=this.dashboard?.vesselCandidates.find(v=>v.imo===this.manualEditingImo);
      if(vessel&&this.vesselOutsidePlan(vessel)){
        this.planError=this.vesselPlanPeriodMessage(vessel);return;
      }
    }
    this.planBusy=true;this.planError='';
    this.api.selectRollingVessel(this.activePlanId,{
      imo:this.manualEditingImo,action:this.manualAction,
      reason:this.manualReason.trim(),reviewAfter,
      expectedRevision:this.plan.revision,expectedSourceHash:this.plan.sourceHash
    }).subscribe({
      next:()=>{
        this.planBusy=false;this.closeManualDecision();
        this.loadRollingPlans();this.loadInspectionPlan();
        this.planNotice=this.copy('Planning decision saved without an AI call.',
          'تم تسجيل قرار التخطيط دون استدعاء الذكاء الاصطناعي.');
      },
      error:e=>{
        this.planBusy=false;
        const code=e?.error?.error||'SI_PLAN_SELECTION_FAILED';
        if(code==='SI_VESSEL_OUTSIDE_EXECUTION_PLAN'){
          const vessel=this.dashboard?.vesselCandidates.find(v=>v.imo===this.manualEditingImo);
          this.planError=vessel?this.vesselPlanPeriodMessage(vessel):
           this.copy('Cannot include this vessel: confirmed visit window is outside the Execution Plan.',
            'لا يمكن إدراج هذه السفينة: موعد وجودها المؤكد خارج فترة تنفيذ الخطة.');
          this.loadInspectionPlan();
        }else{
          this.planError=code;
          if(code.includes('CHANGED'))this.loadInspectionPlan();
        }
      }
    });
  }
  loadInspectionPlan():void{
    if(!this.activePlanId){this.plan=null;return;}
    if(!this.editorKey.trim()){
      this.planError=this.copy('Enter the Editor Key above to load the inspection plan.',
        'أدخل مفتاح المحرر لعرض خطة المعاينات.');
      this.focusEditorAccess();return;
    }
    this.planBusy=true;this.planError='';
    this.api.inspectionPlan(this.editorKey.trim(),this.activePlanId).subscribe({
      next:x=>{this.plan=x;this.planBusy=false;
        if(x.stale||x.readOnlyHistorical||!this.activePlanEditable){
          this.clearBulkSelection();
        }else{
          const allowed=new Set(x.rows.filter(r=>r.editable).map(r=>r.imo));
          for(const imo of [...this.bulkSelectedImos]){
            if(!allowed.has(imo))this.bulkSelectedImos.delete(imo);
          }
        }
        if(this.planAiPhase==='updating')this.planAiPhase='idle';},
      error:e=>{this.planBusy=false;
        if(this.planAiPhase==='updating'){
          this.planAiPhase='idle';
          this.planError=this.copy(
            'AI results were received, but the saved plan could not be refreshed. Reload the plan before proceeding.',
            'وصلت نتيجة التحليل، لكن تعذر تحديث عرض الخطة المحفوظة. أعد تحميل الخطة قبل المتابعة.');
        }else this.planError=(e as {error?:{error?:string}})
          ?.error?.error||'SI_INSPECTION_PLAN_UNAVAILABLE';}
    });
  }
  generateInspectionPlan():void{
    if(this.planBusy||!this.activePlanEditable||!this.plan||!this.editorKey.trim()||!this.reviewer.trim()){
      this.planError=this.copy('Load plan and enter Operator Name and Editor Key before running C01.',
       'اعرض الخطة وأدخل اسم الموظف ومفتاح المحرر قبل تشغيل C01.');return;
    }
    this.submitPlanReevaluation(null);
  }
  openPlanEdit(v:SiVesselCandidate,selection:boolean,changePriority=false):void{
    if(!this.activePlanEditable||!this.plan?.agentRunId||!this.planRow(v)?.editable){
      this.planError=this.copy('Run initial C01 selection and choose a pending candidate first.',
        'شغّل توصية C01 الأولية واختر سفينة مرشحة بانتظار المراجعة.');return;
    }
    this.planEditingImo=v.imo;this.planSelection=selection;
    this.planRequestedRank=changePriority?(this.planRow(v)?.effectiveRank??null):null;
    this.planReason='';this.planError='';
  }
  cancelPlanEdit():void{this.planEditingImo='';this.planReason='';this.planRequestedRank=null;}
  savePlanEdit():void{
    if(!this.activePlanEditable||!this.plan||!this.planEditingImo||this.planBusy)return;
    if(this.planReason.trim().length<8){
      this.planError=this.copy('Enter an auditable reason with at least 8 characters.',
        'اكتب سبباً واضحاً لا يقل عن 8 أحرف.');return;
    }
    if(this.planSelection&&this.planRequestedRank!==null&&
       (!Number.isInteger(this.planRequestedRank)||this.planRequestedRank<1||this.planRequestedRank>100)){
      this.planError=this.copy('Requested priority position must be from 1 to 100.',
        'الترتيب المطلوب يجب أن يكون بين 1 و100.');return;
    }
    this.submitPlanReevaluation({
      imo:this.planEditingImo,selected:this.planSelection,
      requestedRank:this.planSelection?this.planRequestedRank:null,
      reason:this.planReason.trim()
    });
  }
  private submitPlanReevaluation(change:{
    imo:string;selected:boolean;requestedRank:number|null;reason:string
  }|null):void{
    if(!this.activePlanId||!this.activePlanEditable||!this.plan||!this.editorKey.trim()||!this.reviewer.trim())return;
    const mock=this.plan.provider==='MOCK';
    const calls=Math.max(1,Math.ceil((this.plan?.dataReadiness?.eligibleWorkflows||0)/
      (mock?100:25)));
    const message=mock?
      this.copy('Confirm officer planning change and re-run MOCK C01 with zero Airia calls? No official inspection case will be changed.',
        'تأكيد تعديل خطة المعاينات وإعادة ترتيب MOCK C01 دون اتصال Airia؟ لن تتغير حالات المعاينة الرسمية.'):
      this.copy('Run '+calls+' Airia SI-C01 analysis batches for the current source-verified workflows and apply the published small-plan selection caps? AI advice only, supervisor approves.',
        'تشغيل '+calls+' دفعات تحليل Airia لمسارات المرشحين الموثقة وتطبيق حدود الخطة الصغيرة المنشورة؟ التوصيات استشارية والاعتماد للمشرف.');
    if(!window.confirm(message))return;
    this.planBusy=true;this.planError='';this.planNotice='';
    this.planAiPhase='analyzing';
    this.api.rerankInspectionPlan(this.editorKey.trim(),{
      actor:this.reviewer.trim(),planId:this.activePlanId,expectedSourceHash:this.plan.sourceHash,
      expectedRevision:this.plan.revision,confirmRun:true,confirmCost:!mock,
      confirmBatchCount:calls,
      ...(change?{change}:{})
    }).subscribe({
      next:r=>{
        this.planAiPhase='updating';
        this.cancelPlanEdit();this.loadRollingPlans();
        const partial=r.manualReviewDueToAiContract||0;
        this.planNotice=partial?
          this.copy('C01 verified '+(r.verifiedAiRecommendations||0)+
            ' recommendations. '+partial+' candidates need officer review due to invalid AI output. No automatic selection for these candidates.',
            'تحقق C01 من '+(r.verifiedAiRecommendations||0)+
            ' توصية. تحتاج '+partial+' حالة إلى مراجعة المسؤول بسبب استجابة AI غير مطابقة. لم تُطبق عليها توصية إدراج تلقائية.'):
          this.copy('C01 '+r.provider+' completed '+(r.verifiedAiRecommendations||0)+
            ' verified advisory recommendations. Supervisor approval is still required.',
            'أكمل C01 عدد '+(r.verifiedAiRecommendations||0)+
            ' توصية تم التحقق منها. لا يزال اعتماد المشرف مطلوبًا.');
        this.loadInspectionPlan();
      },
      error:e=>{
        this.planAiPhase='idle';this.planBusy=false;
        const detail=(e as {error?:{
          error?:string;reasonCode?:string;failureCounts?:Record<string,number>;
          expectedCount?:number;returnedCount?:number;batchIndex?:number;batchCount?:number
        }})?.error;
        const code=detail?.error||'';
        const reason=detail?.reasonCode||'';
        const failures=Object.entries(detail?.failureCounts||{})
          .filter(([,count])=>Number.isInteger(count)&&count>0)
          .sort((a,b)=>b[1]-a[1])
          .slice(0,5).map(([key,count])=>key+' ('+count+')').join(', ');
        const batch=detail?.batchIndex?
          ' · Batch '+detail.batchIndex+'/'+(detail.batchCount||'?'):'';
        const diagnosis=(failures||reason||code)+batch;
        const changed=code.includes('CHANGED')||code.includes('STALE');
        this.planError=changed?
          this.copy('Source data changed during analysis. Reload the plan before retrying.',
            'تغيرت بيانات المصادر أثناء التحليل؛ أعد تحميل الخطة قبل إعادة المحاولة.'):
          this.copy('Airia C01 validation failure: '+diagnosis+
            '. The plan is unchanged. Check the indicated field in the Airia pipeline before retrying.',
            'فشل فحص Airia C01: '+diagnosis+
            '. الخطة لم تتغير. راجع الحقول المشار إليها في Airia قبل إعادة التشغيل.');
        if(changed)this.loadInspectionPlan();
      }
    });
  }
  toggleVesselDetail(v:SiVesselCandidate):void{
    if(this.expandedImo===v.imo){
      this.expandedImo='';return;
    }
    this.expandedImo=v.imo;
    this.selectVessel(v);
  }

  @ViewChild('editorAccessKey') private editorAccessKey?:ElementRef<HTMLInputElement>;
  private focusEditorAccess():void{
    this.editorAccessKey?.nativeElement.scrollIntoView({behavior:'smooth',block:'center'});
    this.editorAccessKey?.nativeElement.focus({preventScroll:true});
  }
  c01Preview:SiC01Preview|null=null;
  c01Run:SiC01Run|null=null;
  c01Busy=false;c01Error='';c01Message='';
  get c01Map():Map<string,SiC01Recommendation>{
    return new Map((this.c01Run?.recommendations||[]).map(r=>[r.candidateKey,r]));
  }
  c01Advice(candidate:SiCandidate|null):SiC01Recommendation|null{
    return candidate?(this.c01Map.get(candidate.key)||null):null;
  }
  c01BestVesselAdvice(v:SiVesselCandidate):SiC01Recommendation|null{
    const values=v.candidateKeys.map(k=>this.c01Map.get(k))
      .filter((x):x is SiC01Recommendation=>Boolean(x));
    return values.find(x=>x.recommendation==='SELECT_RECOMMENDED')||values[0]||null;
  }
  previewCandidateAi():void{
    if(!this.editorKey.trim()){
      this.c01Error=this.copy('Enter the Editor Key in the Operator & Access fields directly above.',
        'أدخل مفتاح المحرر في حقول المستخدم والصلاحيات الموجودة بالأعلى.');
      this.focusEditorAccess();return;
    }
    this.c01Busy=true;this.c01Error='';this.c01Message='';this.c01Run=null;
    this.api.candidateAiPreview(this.editorKey.trim()).subscribe({
      next:r=>{this.c01Preview=r;this.c01Busy=false;
        this.c01Message=this.copy('Saved candidate snapshot verified, no AI call.',
          'تم التحقق من قائمة المرشحين المحفوظة بدون تشغيل AI.');},
      error:e=>{this.c01Busy=false;this.c01Error=(e as {error?:{error?:string}})
        ?.error?.error||'SI_C01_PREVIEW_UNAVAILABLE';}
    });
  }
  runCandidateAi():void{
    if(this.c01Busy||!this.c01Preview||!this.reviewer.trim()||!this.editorKey.trim())return;
    const isMock=this.c01Preview.provider==='MOCK';
    const calls=this.c01Preview.expectedBatches||
      Math.max(1,Math.ceil(this.c01Preview.eligibleCount/100));
    const prompt=isMock?
      this.copy('Generate a MOCK C01 advisory with zero Airia calls? It cannot approve an inspection.',
        'إنشاء توصية C01 تجريبية دون تشغيل Airia؟ لا تعتمد أي معاينة.'):
      this.copy('Run '+calls+' Airia SI-C01 analysis batches for all verified candidate workflows and select a small draft roster within published quotas? No automatic inspection approval.',
        'تشغيل '+calls+' دفعات Airia SI-C01 لجميع مسارات المرشحين الموثقة واختيار عدد محدود لخطة مسودة ضمن القواعد المنشورة؟ لا يتم اعتماد المعاينات تلقائيًا.');
    if(!window.confirm(prompt))return;
    this.c01Busy=true;this.c01Error='';this.c01Message='';
    this.api.candidateAiRun(this.editorKey.trim(),{
      actor:this.reviewer.trim(),expectedSnapshotHash:this.c01Preview.snapshotHash,
      confirmRun:true,confirmCost:!isMock,confirmBatchCount:calls
    }).subscribe({
      next:r=>{this.c01Busy=false;this.c01Run=r;this.c01Preview=null;
        const quarantine=r.manualReviewDueToAiContract||0;
        this.c01Message=quarantine?
          this.copy((r.verifiedAiRecommendations||0)+' verified Airia recommendations; '+
            quarantine+' candidates require manual officer review.',
            (r.verifiedAiRecommendations||0)+' توصية Airia موثقة، و'+
            quarantine+' مرشح يحتاج مراجعة بشرية.'):
          this.copy('C01 verified '+(r.verifiedAiRecommendations||0)+
            ' recommendations. Official approval remains with the supervisor.',
            'تحقق C01 من '+(r.verifiedAiRecommendations||0)+
            ' توصية. يبقى الاعتماد الرسمي من صلاحية المسؤول.');},
      error:e=>{this.c01Busy=false;
        const issue=(e as {error?:{error?:string;reasonCode?:string}})?.error;
        this.c01Error=(issue?.error||'SI_C01_RUN_FAILED')+
          (issue?.reasonCode?' · '+issue.reasonCode:'');}
    });
  }
  priorityStatus:SiPriorityStatus|null=null;
  priorityPreview:SiPriorityPreview|null=null;
  priorityBusy=false;aiError='';aiSuccess='';confirmAiCost=false;
  /** The rule preview also groups workflows by IMO: one visible vessel row. */
  get rulePreviewVessels():{
    imo:string;vesselName:string;minRank:number;regimes:string[];
    workflows:SiPriorityPreviewItem[]
  }[]{
    const vessels=new Map<string,{
      imo:string;vesselName:string;minRank:number;regimes:string[];
      workflows:SiPriorityPreviewItem[]
    }>();
    const byKey=new Map((this.dashboard?.candidates||[]).map(c=>[c.key,c]));
    for(const item of this.priorityPreview?.items||[]){
      const workflow=byKey.get(item.candidateKey);
      let vessel=vessels.get(item.imo);
      if(!vessel){
        vessel={imo:item.imo,vesselName:item.vesselName,
          minRank:item.ruleRank,regimes:[],workflows:[]};
        vessels.set(item.imo,vessel);
      }
      vessel.minRank=Math.min(vessel.minRank,item.ruleRank);
      if(workflow&&!vessel.regimes.includes(workflow.regime))vessel.regimes.push(workflow.regime);
      vessel.workflows.push(item);
    }
    return [...vessels.values()].sort((a,b)=>a.minRank-b.minRank||a.imo.localeCompare(b.imo));
  }
  get savedAiRun():SiPriorityRun|null{
    const r=this.priorityStatus?.latest;
    return r?.status==='SUCCEEDED'&&!r.isStale?r:null;
  }
  get rankingMap():Map<string,SiPriorityRecommendation>{
    return new Map((this.savedAiRun?.recommendations||[]).map(r=>[r.candidateKey,r]));
  }
  aiRecommendation(candidate:SiCandidate|null):SiPriorityRecommendation|null{
    return candidate?(this.rankingMap.get(candidate.key)||null):null;
  }
  ruleRank(candidate:SiCandidate):number|null{
    return this.priorityPreview?.items.find(x=>x.candidateKey===candidate.key)?.ruleRank||null;
  }
  refreshAiStatus():void{
    if(!this.editorKey.trim()){
      this.aiError=this.copy('Enter the Editor Key in the Operator & Access fields above.',
        'أدخل مفتاح المحرر في حقول المستخدم والصلاحيات الموجودة بالأعلى.');
      this.focusEditorAccess();return;
    }
    this.priorityBusy=true;this.aiError='';
    this.api.prioritizationStatus(this.editorKey.trim()).subscribe({
      next:r=>{this.priorityStatus=r;this.priorityBusy=false;},
      error:e=>this.aiFailure(e)
    });
  }
  previewPriority():void{
    if(!this.editorKey.trim()){
      this.aiError=this.copy('Enter Editor Key in the Operator & Access fields above.',
        'أدخل مفتاح المحرر في حقول المستخدم والصلاحيات الموجودة بالأعلى.');
      this.focusEditorAccess();return;
    }
    this.priorityBusy=true;this.aiError='';this.aiSuccess='';this.confirmAiCost=false;
    this.api.prioritizationPreview(this.editorKey.trim()).subscribe({
      next:r=>{
        this.priorityPreview=r;this.priorityBusy=false;
        this.aiSuccess=this.copy('Rule order preview ready. No AI call made.',
          'تم تجهيز ترتيب القواعد دون تشغيل AI.');
        this.refreshAiStatus();
      },
      error:e=>this.aiFailure(e)
    });
  }
  runAiPriority():void{
    if(!this.priorityPreview||!this.confirmAiCost||!this.editorKey.trim()||
      !this.reviewer.trim()||this.priorityBusy)return;
    if(!window.confirm(this.copy(
      this.priorityStatus?.provider==='MOCK'?
        'Run MOCK SI-P01 ranking (0 Airia calls)? The result is not model analysis.':
        'Analyze the current candidate snapshot using SI-P01 on Airia? Recommendations require officer review.',
      this.priorityStatus?.provider==='MOCK'?
        'تشغيل ترتيب SI-P01 التجريبي دون استدعاء Airia؟ ليس تحليلاً ذكياً حقيقياً.':
        'تحليل المرشحين باستخدام SI-P01 على Airia؟ التوصيات للمراجعة البشرية فقط.')))return;
    this.priorityBusy=true;this.aiError='';this.aiSuccess='';
    this.api.runPrioritization(this.editorKey.trim(),{
      actor:this.reviewer.trim(),expectedSnapshotHash:this.priorityPreview.snapshotHash,
      confirmCost:true
    }).subscribe({
      next:r=>{
        this.priorityBusy=false;this.priorityPreview=null;this.confirmAiCost=false;
        this.aiSuccess=this.copy('AI recommendations saved for human review.',
          'تم حفظ توصيات AI للمراجعة البشرية.');
        this.refreshAiStatus();
      },error:e=>{
        this.aiFailure(e);
        this.refreshAiStatus();
      }
    });
  }
  private aiFailure(e:unknown):void{
    const x=e as {error?:{error?:string};status?:number};
    this.aiError=x?.error?.error||'SI_P01_UNAVAILABLE';
    this.priorityBusy=false;this.aiSuccess='';
  }

  constructor(private readonly api:SiCandidateTargetingService,public readonly lang:LanguageService,
  public readonly auth:MoeiAuthService,private readonly pscSelection:SiPscSelectionService,
  private readonly http:HttpClient){}
  copy(en:string,ar:string):string{return this.lang.pick(en,ar);}
  ngOnInit():void{this.refresh();this.restoreIntegratedJob();}
  ngOnDestroy():void{this.stopIntegratedPolling();}
  refresh():void{
    if(this.loading)return;
    // Refresh both independent data sources. Previously this button only
    // retried candidate targeting, leaving a recovered planning API stuck
    // on SI_TARGETING_UNAVAILABLE until a full browser reload.
    this.loadRollingPlans();
    // One published-rule quota projection from the SAME persisted Excel events
    // used by the server's candidate list. No separate PSC approval screen.
    this.pscSelection.pool(this.editorKey).subscribe({
      next:data=>{this.pscQuota=data;},
      error:()=>{this.pscQuota=null;}
    });
    this.loading=true;this.error='';
    this.api.dashboard().subscribe({
      next:data=>{
        this.dashboard=data;
        // C01 advisories are snapshot-scoped. Never present old advice as current.
        this.c01Preview=null;this.c01Run=null;
        if(!data.vesselCandidates.some(v=>v.imo===this.selectedImo)){
          this.selectedImo='';this.selectedKey='';
        }else if(!data.candidates.some(x=>x.key===this.selectedKey)){
          this.selectedKey='';
        }
        this.loading=false;
        if(this.editorKey.trim()){
          this.loadInspectionPlan();
        }
      },error:e=>{this.loading=false;this.showError(e);}
    });
  }
  /** One visible row per IMO — sources/events accumulate on the vessel. */
  get vessels():SiVesselCandidate[]{
    const term=this.search.toLowerCase().trim();
    const rank=this.planLookup;
    return (this.dashboard?.vesselCandidates||[]).filter(v=>
      (this.sourceFilter==='ALL'||v.sourceTypes.includes(this.sourceFilter))&&
      (this.statusFilter==='ALL'||v.workflows.some(w=>w.status===this.statusFilter))&&
      (!term||[v.imo,v.vesselName,v.flag,v.vesselType,...v.regimes,
        ...v.sourceEvents.map(e=>e.sourceReference)].some(text=>
          String(text||'').toLowerCase().includes(term))))
      .sort((a,b)=>{
        const ar=rank.get(a.imo),br=rank.get(b.imo);
        return Number(Boolean(br?.planSelected))-Number(Boolean(ar?.planSelected))||
          (ar?.effectiveRank??99999)-(br?.effectiveRank??99999)||
          b.pendingWorkflows-a.pendingWorkflows||a.imo.localeCompare(b.imo);
      });
  }
  get selectedVessel():SiVesselCandidate|null{
    return this.dashboard?.vesselCandidates.find(v=>v.imo===this.selectedImo)||null;
  }
  get selected():SiCandidate|null{
    return this.dashboard?.candidates.find(c=>c.key===this.selectedKey)||null;
  }
  selectVessel(v:SiVesselCandidate):void{
    this.selectedImo=v.imo;
    // Never implicitly approve the wrong legal inspection regime.
    this.selectedKey=v.candidateKeys.length===1?v.candidateKeys[0]:'';
    this.success='';this.decisionNote='';
  }
  selectWorkflow(key:string):void{
    if(!this.selectedVessel?.candidateKeys.includes(key))return;
    this.selectedKey=key;this.decisionNote='';this.success='';
  }
  bestAiRecommendation(v:SiVesselCandidate):SiPriorityRecommendation|null{
    const rankings=v.candidateKeys.map(key=>this.rankingMap.get(key))
      .filter((r):r is SiPriorityRecommendation=>Boolean(r));
    return rankings.sort((a,b)=>a.effectiveRank-b.effectiveRank)[0]||null;
  }
  getWorkflow(key:string):SiCandidate|null{
    return this.dashboard?.candidates.find(c=>c.key===key)||null;
  }
  trackVessel(_:number,v:SiVesselCandidate):string{return v.imo;}
  private showError(e:unknown):void{
    const v=e as {error?:{error?:string};status?:number};
    this.error=v?.error?.error||'Request failed. Check API, Oracle migration 009 and access permissions.';
    this.success='';this.busy=false;
  }
  decide(action:'APPROVE'|'DEFER'|'REJECT'):void{
    const c=this.selected;
    if(!c||this.busy)return;
    if(!this.reviewer.trim()||this.decisionNote.trim().length<4){
      this.error='Enter reviewer name and an auditable reason (at least 4 characters).';return;
    }
    const key=action==='APPROVE'?this.publisherKey:this.editorKey;
    if(!key.trim()){this.error=action==='APPROVE'?
      'Publisher / supervisor key is required to create an inspection case.':
      'Editor key is required to record a deferral or rejection.';return;}
    if(!window.confirm(action==='APPROVE'?
      'Create an approved Smart Inspection POC case? This will NOT trigger Airia or change NMC risk.':
      'Record the '+action.toLowerCase()+' decision with its audit trail?'))return;
    this.busy=true;this.error='';this.success='';
    this.api.decision({candidateKey:c.key,imo:c.imo,action,actor:this.reviewer.trim(),
      note:this.decisionNote.trim()},key.trim()).subscribe({
      next:()=>{this.busy=false;this.success='Decision saved centrally: '+action;
        this.decisionNote='';this.refresh();},
      error:e=>this.showError(e)
    });
  }
  statusText(x:string):string{
    const labels:Record<string,string>={
      'PENDING_REVIEW':'بانتظار المراجعة',
      'DEFERRED':'مؤجلة',
      'REJECTED':'مرفوضة',
      'INSPECTION_CREATED':'تم إنشاء المعاينة',
      'EXTERNALLY_SCHEDULED':'مجدولة مسبقًا',
      'MANUAL_REVIEW':'تتطلب مراجعة بشرية',
      'MANDATORY':'إلزامية',
      'PRIORITY':'ذات أولوية',
      'STANDARD':'عادية',
      'RISK_UNASSESSED':'بدون تقييم مخاطر',
      'NMC_CASE':'إحالة المركز البحري',
      'SERVICE_REQUEST':'طلب خدمة',
      'PSC_PORT_CALL':'نداء ميناء PSC',
      'PORT_STATE_CONTROL':'تفتيش دولة الميناء',
      'FOCUSED_INSPECTION':'معاينة مركزة',
      'UAE_SERVICE_INSPECTION':'معاينة خدمة بحرية',
      'FOLLOW_UP_INSPECTION':'معاينة متابعة',
      'High':'مرتفع','Critical':'حرج','Watch':'مراقبة','Normal':'عادي',
      'APPROVE':'اعتماد','DEFER':'تأجيل','REJECT':'رفض',
      'REVIEW_REQUIRED':'تتطلب مراجعة',
      'SUCCEEDED':'مكتمل','FAILED':'فشل'
    };
    return this.lang.isArabic?(labels[x]||x.replaceAll('_',' ')):x.replaceAll('_',' ');
  }
  short(id:string|null|undefined):string{return (id||'—').slice(0,12);}
  trackKey(_:number,c:SiCandidate):string{return c.key;}
}
