import { NmcNavigationComponent } from '../components/nmc-navigation.component';
import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { NmcVesselProfile } from '../data/nmc-vessel-catalog';
import {
  NMC_OPERATIONAL_VESSELS,
  getOperationalVesselByImo
} from '../data/nmc-expanded-vessel-catalog';
import { LanguageService } from '../services/language.service';
import { NmcRiskEngineService } from '../services/nmc-risk-engine.service';
import {
  NmcCaseStateService,
  NmcInspectionOutcome
} from '../services/nmc-case-state.service';
import {NmcCasesService,NmcCentralCase,NmcCentralCaseAudit,NmcAiAction} from '../services/nmc-cases.service';

type CaseStatus = 'Open' | 'In Progress' | 'Pending Verification' | 'Resolved';
type TaskStatus = 'Pending' | 'Assigned' | 'In Progress' | 'Completed' | 'Escalated';
type TimelineType = 'Risk' | 'AI' | 'Decision' | 'Task' | 'Escalation' | 'Resolution' | 'Inspection';

interface CaseTask {
  id: string;
  title: string;
  owner: string;
  source: string;
  priority: 'Critical' | 'High' | 'Medium' | 'Continuous';
  slaMinutes?: number;
  dueLabel: string;
  status: TaskStatus;
  mandatory: boolean;
  evidence: string[];
  note: string;
  actionType?: string;
  actionId?: string;
}

interface CaseTimelineItem {
  time: string;
  type: TimelineType;
  title: string;
  detail: string;
  actor: string;
}

interface Stakeholder {
  role: string;
  unit: string;
  responsibility: string;
  state: 'Active' | 'Waiting' | 'Notified';
}

@Component({
  selector: 'app-nmc-case-workspace',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, NmcNavigationComponent],
  templateUrl: './nmc-case-workspace.component.html',
  styleUrl: './nmc-case-workspace.component.css'
})
export class NmcCaseWorkspaceComponent implements OnInit {
  vessel!: NmcVesselProfile;
  caseStatus: CaseStatus = 'Open';
  selectedTask?: CaseTask;
  resolutionNote = '';
  centralCase:NmcCentralCase|null=null;
  centralLoading=true;
  centralBusy=false;
  centralError='';
  centralSuccess='';
  actionNotes:Record<string,string>={};
  tasks: CaseTask[] = [];
  timeline: CaseTimelineItem[] = [];
  stakeholders: Stakeholder[] = [];

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    public lang: LanguageService,
    private caseState: NmcCaseStateService,
    private riskEngine: NmcRiskEngineService,
    private readonly cases: NmcCasesService
  ) {}

  ngOnInit(): void {
    const imo = this.route.snapshot.paramMap.get('imo') || NMC_OPERATIONAL_VESSELS[0].imo;
    const profile = getOperationalVesselByImo(imo) || NMC_OPERATIONAL_VESSELS[0];
    this.vessel = this.riskEngine.applyToVessel(profile);
    this.loadCentralCase();
  }

  loadCentralCase():void {
    this.centralLoading=true;
    this.cases.byImo(this.vessel.imo).subscribe({
      next:response=>{
        this.centralCase=response.case;
        this.centralLoading=false;
        const aiError=this.route.snapshot.queryParamMap.get('aiError');
        this.centralError=aiError&&!this.centralCase?.actionPlan
          ?this.cases.readableError({error:{error:aiError}},this.lang.isArabic)
          :'';
        this.buildCase();
        if(this.centralCase)this.loadCentralHistory();
      },
      error:error=>{
        this.centralLoading=false;
        this.centralError=this.cases.readableError(error,this.lang.isArabic);
      }
    });
  }

  private loadCentralHistory():void{
    if(!this.centralCase)return;
    this.cases.history(this.centralCase.id).subscribe({
      next:response=>{
        this.timeline=response.history.map(event=>({
          time:new Date(event.at).toLocaleString(),
          type:event.action==='RESOLVED'?'Resolution':
            event.action.includes('ESCALATE')?'Escalation':
            event.action==='DECISION_RECORDED'?'Decision':
            event.action==='INSPECTION_RECORDED'?'Inspection':'Task',
          title:event.action.replaceAll('_',' '),
          detail:event.note||this.copy('Action recorded','تم تسجيل الإجراء'),
          actor:event.role
        }));
      },
      error:()=>{
        this.centralError=this.copy('Case history is unavailable.','سجل أنشطة الحالة غير متاح.');
      }
    });
  }

  copy(en: string, ar: string): string {
    return this.lang.pick(en, ar);
  }

  toggleLanguage(): void {
    this.lang.toggle();
    this.buildCase(true);
  }

  get caseId(): string {
    return this.centralCase?'NMC-'+this.centralCase.id.slice(0,8).toUpperCase():this.copy('Not opened','لم تُفتح');
  }

  get riskLevelLabel(): string {
    const level = this.centralCase?.sourceLevel||this.riskEngine.levelForScore(this.currentRisk);
    const labels: Record<string,string> = {
      Critical: this.copy('Critical', 'حرج'),
      High: this.copy('High', 'مرتفع'),
      Watch: this.copy('Watch', 'مراقبة'),
      Normal: this.copy('Normal', 'طبيعي')
    };
    return labels[level] || level;
  }

  get riskClass(): string {
    return (this.centralCase?.sourceLevel||this.riskEngine.levelForScore(this.currentRisk)).toLowerCase();
  }

  get completedTasks(): number {
    return this.tasks.filter(task => task.status === 'Completed').length;
  }

  get openTasks(): number {
    return this.tasks.filter(task => task.status !== 'Completed').length;
  }

  get overdueTasks(): number {
    return this.tasks.filter(task => task.status === 'Escalated').length;
  }

  get progressPercent(): number {
    return this.tasks.length ? Math.round((this.completedTasks / this.tasks.length) * 100) : 0;
  }

  get mandatoryComplete(): boolean {
    if(!this.centralCase)return false;
    // A reviewed plan with every action rejected / NO_ACTION may have zero
    // tasks. That is a deliberate human decision, not an empty-case default.
    if(!this.centralCase.actionPlan)return false;
    if(this.pendingAiActionCount>0)return false;
    return this.tasks.filter(t=>t.mandatory)
      .every(t=>t.status==='Completed');
  }

  get pendingAiActionCount():number{
    return this.centralCase?.actionPlan?.proposedActions.filter(
      a=>a.decision==='PENDING').length||0;
  }

  get approvedAiTaskCount():number{
    return this.tasks.length;
  }

  get readyForResolution():boolean{
    return !!this.centralCase&&this.centralCase.status!=='RESOLVED'&&
      this.mandatoryComplete&&this.pendingAiActionCount===0&&
      !this.riskReassessmentPending;
  }

  get inspectionOutcome(): NmcInspectionOutcome | undefined {
    if(this.centralCase){
      const item=this.centralCase.inspectionOutcome;
      return item?{...item,riskReduction:0,inspector:'Smart Inspection',
        result:item.result as NmcInspectionOutcome['result']}:undefined;
    }
    return this.caseState.getInspectionOutcome(this.vessel.imo);
  }

  // Immutable source assessment carried by the case. Human task/inspection completion
  // must never fabricate an updated risk score or subtract fixed points.
  get currentRisk(): number {
    return this.centralCase?.sourceScore ?? this.vessel.risk;
  }

  get riskReassessmentPending(): boolean {
    return !!this.centralCase?.inspectionOutcome;
  }

  get nextAction(): string {
    const next = this.tasks.find(task => task.status !== 'Completed');
    if(!this.centralCase?.actionPlan)return this.copy(
      'A01 recommendations were unavailable at case creation · retry',
      'توصيات A01 لم تتوفر عند إنشاء الحالة · إعادة المحاولة');
    if(this.centralCase.actionPlan.proposedActions.some(a=>a.decision==='PENDING'))
      return this.copy('Review proposed AI actions', 'مراجعة الإجراءات المقترحة من AI');
    if(this.riskReassessmentPending)
      return this.copy('Await verified post-inspection risk reassessment',
        'في انتظار إعادة تقييم المخاطر بأدلة المعاينة');
    if (!next) return this.copy('Ready for case resolution', 'جاهزة لإغلاق الحالة');
    return next.title;
  }

  generateAiActions():void{
    if(!this.centralCase||this.centralBusy||this.centralCase.actionPlan)return;
    if(!window.confirm(this.copy(
      'Retry the unsuccessful A01 step from case creation? This makes one explicit Airia call.',
      'إعادة محاولة خطوة A01 التي لم تكتمل عند إنشاء الحالة؟ سيتم استدعاء Airia مرة واحدة.')))return;
    this.centralBusy=true;this.centralError='';this.centralSuccess='';
    this.cases.generateActionPlan(this.centralCase).subscribe({
      next:res=>{
        this.centralBusy=false;
        if(res.case)this.applyCase(res.case);
        this.centralSuccess=this.copy(
          'A01 proposals are ready. Only your approved A01 actions appear as case tasks.',
          'توصيات A01 جاهزة. لن تظهر كمهام إلا توصيات A01 التي اعتمدتها.');
      },
      error:error=>{
        this.centralBusy=false;
        this.centralError=this.cases.readableError(error,this.lang.isArabic);
        if(error?.status===409)this.loadCentralCase();
      }
    });
  }

  decideAiAction(item:NmcAiAction,decision:'ACCEPT'|'REJECT'|'MODIFY'):void{
    if(!this.centralCase||this.centralBusy||item.decision!=='PENDING')return;
    const note=(this.actionNotes[item.actionId]||'').trim();
    if(decision!=='ACCEPT'&&!note){
      this.centralError=this.copy('Enter a reason for modification or rejection.','ادخل سبب التعديل أو الرفض.');
      return;
    }
    if(!window.confirm(this.copy(
      'Save this human decision? Accepted actions become central tasks; inspection actions enter the scheduling queue.',
      'حفظ القرار البشري؟ الإجراءات المقبولة تتحول إلى مهام، والمعاينات إلى قائمة الجدولة.')))return;
    this.centralBusy=true;this.centralError='';
    this.cases.decideAiAction(this.centralCase,item.actionId,decision,note).subscribe({
      next:res=>{
        this.centralBusy=false;
        if(res.case)this.applyCase(res.case);
        this.centralSuccess=this.copy(
          'Decision audited. Approved actions are now saved as case tasks.',
          'تم توثيق القرار وإنشاء المهام المعتمدة في الحالة.');
      },
      error:error=>{
        this.centralBusy=false;
        this.centralError=this.cases.readableError(error,this.lang.isArabic);
        if(error?.status===409)this.loadCentralCase();
      }
    });
  }

  get pendingInspection():boolean{
    return !!this.centralCase?.inspectionRequests?.some(
      r=>r.status==='PENDING_SCHEDULING');
  }
  inspectionTask(task:CaseTask):boolean{
    return task.actionType==='PRIORITY_INSPECTION'||
      (!task.actionType&&task.id==='priority-inspection');
  }
  openInspectionForTask(task:CaseTask):void{
    // Historical inspections are not automatically tied to newly generated
    // Airia requests even if their old task IDs resemble A01 action IDs.
    if(!task.actionId){
      this.navigateInspection();return;
    }
    const referral=this.centralCase?.inspectionRequests?.find(
      r=>r.actionId===task.actionId);
    if(referral?.status==='PENDING_SCHEDULING'){
      void this.router.navigate(['/moei/smart-inspection/candidates']);
      return;
    }
    if(!referral||!['SCHEDULED','COMPLETED'].includes(referral.status)){
      this.centralError=this.copy('Schedule the accepted NMC inspection request first.',
        'يجب جدولة طلب المعاينة المعتمد أولًا.');
      return;
    }
    this.navigateInspection();
  }

  openTask(task: CaseTask): void {
    this.selectedTask = task;
  }

  closeTask(): void {
    this.selectedTask = undefined;
  }

  private applyCase(value:NmcCentralCase):void{
    this.centralCase=value;
    this.buildCase(true);
    this.selectedTask=this.selectedTask?
      this.tasks.find(item=>item.id===this.selectedTask?.id):undefined;
    this.loadCentralHistory();
  }
  private updateTask(task:CaseTask,action:'START'|'COMPLETE'|'ESCALATE',openInspection=false):void{
    if(!this.centralCase||this.centralBusy||this.centralCase.status==='RESOLVED')return;
    this.centralBusy=true;this.centralError='';this.centralSuccess='';
    this.cases.task(this.centralCase,task.id,action).subscribe({
      next:response=>{
        this.centralBusy=false;
        if(response.case)this.applyCase(response.case);
        this.centralSuccess=this.copy('Action saved to case history.','تم حفظ الإجراء في سجل الحالة.');
        if(openInspection)this.navigateInspection();
      },
      error:error=>{
        this.centralBusy=false;
        this.centralError=this.cases.readableError(error,this.lang.isArabic);
        if(error?.status===409)this.loadCentralCase();
      }
    });
  }

  startTask(task:CaseTask):void{
    if(this.inspectionTask(task)){this.openInspectionForTask(task);return;}
    this.updateTask(task,'START');
  }
  completeTask(task:CaseTask):void{
    if(this.inspectionTask(task)){
      this.centralError=this.copy(
        'Inspection completion must be recorded from Smart Inspection.',
        'يجب تسجيل نتيجة المعاينة داخل المعاينة الذكية.');
      return;
    }
    this.updateTask(task,'COMPLETE');
  }
  escalateTask(task:CaseTask):void{
    if(!window.confirm(this.copy(
      'Escalate this task to the NMC Supervisor?',
      'هل تريد تصعيد هذه المهمة إلى مشرف المركز البحري؟')))return;
    this.updateTask(task,'ESCALATE');
  }
  resolveCase():void{
    if(!this.centralCase||!this.readyForResolution||this.centralBusy)return;
    if(!this.resolutionNote.trim()){
      this.centralError=this.copy('Resolution reason is required.','يجب إدخال سبب الإغلاق.');
      return;
    }
    if(!window.confirm(this.copy(
      'Submit this maritime case for supervisor-approved resolution?',
      'هل تريد اعتماد إغلاق هذه الحالة بواسطة المشرف؟')))return;
    this.centralBusy=true;this.centralError='';
    this.cases.resolve(this.centralCase,this.resolutionNote.trim()).subscribe({
      next:response=>{
        this.centralBusy=false;
        if(response.case)this.applyCase(response.case);
        this.centralSuccess=this.copy('Case resolved and audited.','تم إغلاق الحالة وتسجيل قرار الاعتماد.');
      },
      error:error=>{
        this.centralBusy=false;
        this.centralError=this.cases.readableError(error,this.lang.isArabic);
        if(error?.status===409)this.loadCentralCase();
      }
    });
  }
  private navigateInspection():void{
    void this.router.navigate(['/moei/nmc/vessel',this.vessel.imo,'smart-inspection']);
  }
  openSmartInspection():void{
    const task=this.tasks.find(t=>this.inspectionTask(t));
    if(task)this.openInspectionForTask(task);
  }

  statusLabel(status: CaseStatus | TaskStatus): string {
    const labels: Record<string,string> = {
      Open: this.copy('Open', 'مفتوحة'),
      'In Progress': this.copy('In Progress', 'قيد التنفيذ'),
      'Pending Verification': this.copy('Pending Verification', 'بانتظار التحقق'),
      Resolved: this.copy('Resolved', 'مغلقة'),
      Pending: this.copy('Pending', 'معلقة'),
      Assigned: this.copy('Assigned', 'تم الإسناد'),
      Completed: this.copy('Completed', 'مكتملة'),
      Escalated: this.copy('Escalated', 'مصعدة')
    };
    return labels[status] || status;
  }

  priorityLabel(priority: CaseTask['priority']): string {
    const labels: Record<CaseTask['priority'],string> = {
      Critical: this.copy('Critical', 'حرجة'),
      High: this.copy('High', 'مرتفعة'),
      Medium: this.copy('Medium', 'متوسطة'),
      Continuous: this.copy('Continuous', 'مستمرة')
    };
    return labels[priority];
  }

  stateLabel(state: Stakeholder['state']): string {
    const labels: Record<Stakeholder['state'],string> = {
      Active: this.copy('Active', 'نشط'),
      Waiting: this.copy('Waiting', 'بانتظار الإجراء'),
      Notified: this.copy('Notified', 'تم الإخطار')
    };
    return labels[state];
  }

  private isTaskCompleted(id: string): boolean {
    return this.tasks.some(task => task.id === id && task.status === 'Completed');
  }

  private addTimeline(type: TimelineType, title: string, detail: string, actor: string): void {
    this.timeline.unshift({
      time: this.copy('Now', 'الآن'),
      type,
      title,
      detail,
      actor
    });
  }

  private persistTimelineEvent(type: 'Task' | 'Escalation', task: CaseTask, title: string): void {
    this.caseState.appendTimeline(this.vessel.imo, {
      id: `${type.toLowerCase()}-${task.id}-${task.status}`,
      time: this.copy('Now', 'الآن'),
      type,
      title,
      detail: `${task.title} · ${task.owner}`,
      actor: task.owner
    });
  }

  private buildCase(_preserveState = false): void {
    // Central Oracle case is the only task source. Historic hardcoded tasks
    // remain stored for audit but never appear as current recommendations.
    const current=this.centralCase;
    this.tasks=(current?.tasks||[])
      .filter(t=>t.provenance==='AIRIA_A01_HUMAN_APPROVED')
      .map(stored=>{
        const priority:CaseTask['priority']=stored.priority==='CRITICAL'||
          stored.priority==='IMMEDIATE'?'Critical':
          stored.priority==='MEDIUM'?'Medium':
          stored.priority==='MONITOR'||stored.priority==='ROUTINE'?'Continuous':'High';
        return {
          id:stored.id,
          actionId:stored.actionId,
          title:stored.title||stored.actionType||stored.id,
          owner:stored.assignedRole,
          source:this.copy('Airia A01 · approved by an officer',
            'Airia A01 · معتمدة من الموظف'),
          priority,
          dueLabel:this.copy('Operational follow-up','متابعة تشغيلية'),
          status:stored.status as TaskStatus,
          mandatory:stored.mandatory,
          evidence:stored.evidenceIds||[],
          note:stored.reason||'',
          actionType:stored.actionType
        };
      });
    const states:Record<string,CaseStatus>={
      OPEN:'Open',IN_PROGRESS:'In Progress',
      PENDING_VERIFICATION:'Pending Verification',RESOLVED:'Resolved'
    };
    this.caseStatus=current?states[current.status]||'Open':'Open';
    if(this.caseStatus==='Pending Verification'&&!this.readyForResolution)
      this.caseStatus='In Progress';

    const actions=current?.actionPlan?.proposedActions||[];
    const roles=[...new Set(actions.map(a=>a.ownerRole).filter(Boolean))];
    this.stakeholders=[
      {
        role:this.copy('Case Owner','مالك الحالة'),
        unit:this.copy('NMC Duty Officer','ضابط مناوبة المركز البحري'),
        responsibility:this.copy('Review AI recommendations and coordinate the approved work.',
          'مراجعة توصيات AI وتنسيق الأعمال المعتمدة.'),
        state:'Active'
      },
      ...roles.map(role=>({
        role:this.copy('A01 recommended owner','المسؤول المقترح من A01'),
        unit:role.replaceAll('_',' '),
        responsibility:this.copy('Participates only when the officer approves the linked A01 action.',
          'يشارك عند اعتماد الموظف الإجراء المرتبط بتوصية A01.'),
        state:(actions.some(a=>a.ownerRole===role&&a.decision==='ACCEPT')
          ?'Active':'Waiting') as Stakeholder['state']
      }))
    ];
    // No synthetic timeline. loadCentralHistory() provides actual server audit.
    if(!current)this.timeline=[];
  }
}