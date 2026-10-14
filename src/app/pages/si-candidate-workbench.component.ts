import {LanguageService} from '../services/language.service';
import {MoeiAuthService} from '../services/moei-auth.service';
import {CommonModule} from '@angular/common';
import {Component,OnInit,ViewChild,ElementRef} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {RouterLink} from '@angular/router';
import {NmcNavigationComponent} from '../components/nmc-navigation.component';
import {SiCandidate,SiCandidateStatus,SiCandidateTargetingService,
  SiDashboard,SiVesselCandidate,SiInspectionPlanState,SiInspectionPlanRow,SiRollingPlan,SiC01Run,SiC01Preview,SiC01Recommendation,SiPriorityStatus,SiPriorityPreview,SiPriorityRun,SiPriorityRecommendation,SiPriorityPreviewItem}
  from '../services/si-candidate-targeting.service';
import {SiPscSelectionService,PscSelectionPool} from '../services/si-psc-selection.service';

type SourceFilter='ALL'|'NMC_CASE'|'SERVICE_REQUEST'|'PSC_PORT_CALL';
type StatusFilter='ALL'|SiCandidateStatus;
@Component({
  selector:'app-si-candidate-workbench',
  standalone:true,imports:[CommonModule,FormsModule,RouterLink,NmcNavigationComponent ],
  templateUrl:'./si-candidate-workbench.component.html',
  styleUrl:'./si-candidate-workbench.component.css'
})
export class SiCandidateWorkbenchComponent implements OnInit{
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
  openCreatePlan():void{
    this.newPlanVisible=true;this.planningError='';
    const day=this.localDate();
    this.newPlan={title:'Inspection Plan '+day,startsOn:day,endsOn:day,
      notes:''};
  }
  loadRollingPlans():void{
    this.api.rollingPlans().subscribe({
      next:r=>{
        this.rollingPlans=r.plans;
        // An earlier transient API failure must not keep a misleading red
        // error banner visible after the rolling-plan catalog has recovered.
        this.planningError='';
      },
      error:e=>{this.planningError=e?.error?.error||'SI_ROLLING_PLANS_UNAVAILABLE';}
    });
  }
  createRollingPlan():void{
    if(this.planningBusy)return;
    if(!this.newPlan.title.trim()||!this.newPlan.startsOn||!this.newPlan.endsOn||
       this.newPlan.endsOn<this.newPlan.startsOn){
      this.planningError=this.copy('Enter a title and valid execution period.',
       'أدخل اسم الخطة وفترة تنفيذ صحيحة.');return;
    }
    this.planningBusy=true;this.planningError='';
    this.api.createRollingPlan(this.newPlan).subscribe({
      next:p=>{
       this.planningBusy=false;this.newPlanVisible=false;
       this.activePlanId=p.id;this.plan=null;this.loadRollingPlans();
       this.loadInspectionPlan();
      },
      error:e=>{this.planningBusy=false;
        this.planningError=e?.error?.error||'SI_ROLLING_PLAN_CREATE_FAILED';}
    });
  }
  openRollingPlan(p:SiRollingPlan):void{
    this.activePlanId=p.id;this.plan=null;this.planEditingImo='';
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
        if(this.activePlanId===p.id){this.activePlanId=null;this.plan=null;}},
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
  get aiSelectedCount():number|null{return this.plan?.aiRecommendedVessels??null;}
  get planSelectedCount():number|null{return this.plan?.selectedForPlan??null;}
  get providerLabel():string{return this.plan?.provider||'NOT LOADED';}
  get approvalReady():boolean{
    return !!this.activePlanId&&this.activePlan?.status==='READY_FOR_APPROVAL'&&
      !!this.plan?.selectedForPlan&&!this.plan.stale&&
      (Boolean(this.plan.agentRunId)||Boolean(this.plan.manualSelection));
  }
  manualEditingImo='';
  manualAction:'INCLUDE'|'NOT_SELECTED'|'DEFER'|'NOT_APPLICABLE'='INCLUDE';
  manualReason='';manualReviewAfter='';
  openManualDecision(v:SiVesselCandidate,
    action:'INCLUDE'|'NOT_SELECTED'|'DEFER'|'NOT_APPLICABLE'):void{
    const row=this.planRow(v);
    if(!this.activePlanEditable||!this.activePlanId||!this.plan||!row?.editable||
       this.planBusy||!this.auth.isAdmin)return;
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
        this.planError=e?.error?.error||'SI_PLAN_SELECTION_FAILED';
        if(this.planError.includes('CHANGED'))this.loadInspectionPlan();
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
    const message=mock?
      this.copy('Confirm officer planning change and re-run MOCK C01 with zero Airia calls? No official inspection case will be changed.',
        'تأكيد تعديل خطة المعاينات وإعادة ترتيب MOCK C01 دون اتصال Airia؟ لن تتغير حالات المعاينة الرسمية.'):
      this.copy('Run ONE real Airia SI-C01 analysis of the current saved candidates? This provides advice only; continue?',
        'تشغيل تحليل Airia الحقيقي مرة واحدة للسفن المرشحة المحفوظة؟ التوصيات استشارية فقط، هل تستمر؟');
    if(!window.confirm(message))return;
    this.planBusy=true;this.planError='';this.planNotice='';
    this.planAiPhase='analyzing';
    this.api.rerankInspectionPlan(this.editorKey.trim(),{
      actor:this.reviewer.trim(),planId:this.activePlanId,expectedSourceHash:this.plan.sourceHash,
      expectedRevision:this.plan.revision,confirmRun:true,confirmCost:!mock,
      ...(change?{change}:{})
    }).subscribe({
      next:r=>{
        this.planAiPhase='updating';
        this.cancelPlanEdit();this.loadRollingPlans();
        this.planNotice=this.copy(
         'C01 '+r.provider+' completed the advisory analysis. Supervisor approval is still required.',
         'أكمل C01 التحليل الاستشاري. لا تزال موافقة المشرف مطلوبة.');
        this.loadInspectionPlan();
      },
      error:e=>{
        this.planAiPhase='idle';this.planBusy=false;
        const code=(e as {error?:{error?:string}})?.error?.error||'';
        const changed=code.includes('CHANGED')||code.includes('STALE');
        this.planError=changed?
          this.copy('Source data changed during analysis. Reload the plan before retrying.',
            'تغيرت بيانات المصادر أثناء التحليل؛ أعد تحميل الخطة قبل إعادة المحاولة.'):
          this.copy('The AI recommendation could not be verified against the saved vessel sources. No plan was changed. Review source data or ask the administrator to check the Airia contract before retrying.',
            'تعذر التحقق من توصيات الذكاء الاصطناعي مقابل مصادر بيانات السفن المحفوظة. لم تتغير الخطة. راجع بيانات المصادر أو اطلب فحص تكامل Airia قبل إعادة المحاولة.');
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
    const prompt=isMock?
      this.copy('Generate a MOCK C01 advisory with zero Airia calls? It cannot approve an inspection.',
        'إنشاء توصية C01 تجريبية دون تشغيل Airia؟ لا تعتمد أي معاينة.'):
      this.copy('Run one real SI-C01 Airia analysis? Advice only; human approval required.',
        'تشغيل تحليل SI-C01 الحقيقي على Airia؟ يتطلب اعتماداً بشرياً.');
    if(!window.confirm(prompt))return;
    this.c01Busy=true;this.c01Error='';this.c01Message='';
    this.api.candidateAiRun(this.editorKey.trim(),{
      actor:this.reviewer.trim(),expectedSnapshotHash:this.c01Preview.snapshotHash,
      confirmRun:true,confirmCost:!isMock
    }).subscribe({
      next:r=>{this.c01Busy=false;this.c01Run=r;this.c01Preview=null;
        this.c01Message=this.copy('C01 advisory ready: verify each regime and decide manually.',
          'توصيات C01 جاهزة: راجع كل نوع معاينة واتخذ القرار بنفسك.');},
      error:e=>{this.c01Busy=false;this.c01Error=(e as {error?:{error?:string}})
        ?.error?.error||'SI_C01_RUN_FAILED';}
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
        'Call the paid SI-P01 Airia pipeline ONCE for the current candidate snapshot? The result is advisory only.',
      this.priorityStatus?.provider==='MOCK'?
        'تشغيل ترتيب SI-P01 التجريبي دون استدعاء Airia؟ ليس تحليلاً ذكياً حقيقياً.':
        'تشغيل وكيل SI-P01 على Airia مرة واحدة مع احتمال تكلفة تشغيل؟ النتيجة استشارية فقط.')))return;
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
  public readonly auth:MoeiAuthService,private readonly pscSelection:SiPscSelectionService){}
  copy(en:string,ar:string):string{return this.lang.pick(en,ar);}
  ngOnInit():void{this.refresh();}
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
