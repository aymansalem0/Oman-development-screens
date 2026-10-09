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
import {NmcCasesService,NmcCentralCase,NmcCentralCaseAudit} from '../services/nmc-cases.service';

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
        this.centralError='';
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
    const level = this.riskEngine.levelForScore(this.currentRisk);
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
    return this.centralCase
      ?this.centralCase.tasks.filter(t=>t.mandatory).every(t=>t.status==='Completed')
      :this.tasks.filter(task=>task.mandatory).every(task=>task.status==='Completed');
  }

  get inspectionOutcome(): NmcInspectionOutcome | undefined {
    if(this.centralCase){
      const item=this.centralCase.inspectionOutcome;
      return item?{...item,riskReduction:0,inspector:'Smart Inspection',
        result:item.result as NmcInspectionOutcome['result']}:undefined;
    }
    return this.caseState.getInspectionOutcome(this.vessel.imo);
  }

  get currentRisk(): number {
    if(this.centralCase)return this.centralCase.sourceScore;
    let score = this.vessel.risk;
    if (this.isTaskCompleted('verify-certificate')) score -= this.vessel.risk >= 80 ? 12 : 6;

    if (this.isTaskCompleted('priority-inspection')) {
      score -= this.inspectionOutcome?.riskReduction ?? (['High','Critical'].includes(this.riskEngine.levelForScore(this.vessel.risk)) ? 18 : 8);
    }

    if (this.isTaskCompleted('enhanced-monitoring')) score -= 3;
    if (this.isTaskCompleted('restriction-review')) score -= 5;
    if (this.caseStatus === 'Resolved') score -= 6;
    return Math.max(12, score);
  }

  get riskDelta(): number {
    return this.centralCase?0:this.currentRisk - this.vessel.risk;
  }

  get nextAction(): string {
    const next = this.tasks.find(task => task.status !== 'Completed');
    if (!next) return this.copy('Ready for case resolution', 'جاهزة لإغلاق الحالة');
    return next.title;
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
    if(task.id==='priority-inspection'){this.openSmartInspection();return;}
    this.updateTask(task,'START');
  }
  completeTask(task:CaseTask):void{
    if(task.id==='priority-inspection'){
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
    if(!this.centralCase||!this.mandatoryComplete||this.centralBusy)return;
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
    if(!this.centralCase||this.centralBusy)return;
    const inspection=this.centralCase.tasks.find(task=>task.id==='priority-inspection');
    if(inspection?.status==='Assigned'){
      this.updateTask(this.tasks.find(task=>task.id==='priority-inspection')!, 'START',true);
      return;
    }
    this.navigateInspection();
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

  private buildCase(preserveState = false): void {
    const persistedStates = this.centralCase
      ?Object.fromEntries(this.centralCase.tasks.map(t=>[t.id,t.status]))
      :this.caseState.getTaskStates(this.vessel.imo);
    const previous = preserveState
      ? new Map(this.tasks.map(task => [task.id, task.status]))
      : new Map<string, TaskStatus>();

    Object.entries(persistedStates).forEach(([id, status]) => {
      previous.set(id, status as TaskStatus);
    });

    const level = this.centralCase?.sourceLevel||this.riskEngine.levelForScore(this.vessel.risk);
    const critical = level === 'Critical';
    const high = level === 'Critical' || level === 'High';
    const watch = level !== 'Normal';
    const conflict = this.riskEngine.evaluate(this.vessel).baseScore >= 80;

    const tasks: CaseTask[] = [];

    if ((this.centralCase?.sourceScore??this.vessel.risk) >= 55) {
      tasks.push({
        id: 'verify-certificate',
        title: this.copy('Verify certificate status', 'التحقق من حالة الشهادة'),
        owner: this.copy('Certificate Compliance Officer', 'مسؤول امتثال الشهادات'),
        source: this.copy('AI recommendation + certificate evidence', 'توصية الذكاء الاصطناعي + أدلة الشهادة'),
        priority: conflict ? 'Critical' : 'High',
        slaMinutes: conflict ? 15 : 60,
        dueLabel: conflict ? this.copy('15 min', '15 دقيقة') : this.copy('60 min', '60 دقيقة'),
        status: previous.get('verify-certificate') || 'Assigned',
        mandatory: true,
        evidence: [`CERT-SC-${this.vessel.imo}`, `DQC-${this.vessel.imo}`],
        note: conflict
          ? this.copy('Resolve the conflict between the primary certificate record and trusted external source.', 'حل التعارض بين سجل الشهادة الأساسي والمصدر الخارجي الموثوق.')
          : this.copy('Confirm certificate validity and applicable conditions.', 'تأكيد صلاحية الشهادة والشروط المطبقة.')
      });
    }

    if (watch) {
      tasks.push({
        id: 'enhanced-monitoring',
        title: this.copy('Maintain enhanced AIS / LRIT monitoring', 'استمرار المراقبة المعززة عبر AIS / LRIT'),
        owner: this.copy('NMC Operations', 'عمليات المركز البحري الوطني'),
        source: this.copy('Movement risk indicator', 'مؤشر مخاطر الحركة'),
        priority: critical ? 'Critical' : 'Continuous',
        dueLabel: this.copy('Continuous', 'مستمرة'),
        status: previous.get('enhanced-monitoring') || 'In Progress',
        mandatory: true,
        evidence: [`AIS-${this.vessel.mmsi}`],
        note: this.copy('Maintain active monitoring until the case is resolved or risk returns to normal monitored range.', 'استمرار المراقبة النشطة حتى إغلاق الحالة أو عودة المخاطر إلى النطاق الطبيعي للمراقبة.')
      });
    }

    if (high) {
      tasks.push({
        id: 'priority-inspection',
        title: this.copy('Create priority follow-up inspection', 'إنشاء معاينة متابعة ذات أولوية'),
        owner: this.copy('Smart Inspection Team', 'فريق المعاينة الذكية'),
        source: this.copy('Open inspection deficiency', 'ملاحظة معاينة مفتوحة'),
        priority: critical ? 'Critical' : 'High',
        slaMinutes: 120,
        dueLabel: this.copy('2 hrs', 'ساعتان'),
        status: previous.get('priority-inspection') || 'Assigned',
        mandatory: true,
        evidence: [`INS-2026-${String(1300 + this.vessel.id).padStart(5,'0')}`],
        note: this.copy('Carry forward the current vessel risk context and open deficiency into the inspection task.', 'نقل سياق مخاطر السفينة الحالي والملاحظة المفتوحة إلى مهمة المعاينة.')
      });
    }

    if (critical) {
      tasks.push({
        id: 'restriction-review',
        title: this.copy('Review need for regulatory restriction', 'مراجعة الحاجة إلى قيد تنظيمي'),
        owner: this.copy('Maritime Compliance Supervisor', 'مشرف الامتثال البحري'),
        source: this.copy('Human-approved conditional action', 'إجراء مشروط معتمد بشرياً'),
        priority: 'High',
        dueLabel: this.copy('After verification', 'بعد التحقق'),
        status: previous.get('restriction-review') || 'Pending',
        mandatory: false,
        evidence: [`CERT-SC-${this.vessel.imo}`, `INS-2026-${String(1300 + this.vessel.id).padStart(5,'0')}`],
        note: this.copy('Restriction remains conditional and cannot be imposed automatically by AI.', 'يظل القيد مشروطاً ولا يمكن فرضه تلقائياً بواسطة الذكاء الاصطناعي.')
      });
    }

    if (!tasks.length) {
      tasks.push({
        id: 'routine-monitoring',
        title: this.copy('Continue routine monitoring', 'استمرار المراقبة الاعتيادية'),
        owner: this.copy('NMC Operations', 'عمليات المركز البحري الوطني'),
        source: this.copy('Normal operational monitoring', 'المراقبة التشغيلية الاعتيادية'),
        priority: 'Continuous',
        dueLabel: this.copy('Continuous', 'مستمرة'),
        status: previous.get('routine-monitoring') || 'In Progress',
        mandatory: true,
        evidence: [`AIS-${this.vessel.mmsi}`],
        note: this.copy('No priority intervention is currently required.', 'لا يوجد تدخل ذو أولوية مطلوب حالياً.')
      });
    }

    this.tasks = this.centralCase ? this.centralCase.tasks.map(stored=>{
      const draft=tasks.find(item=>item.id===stored.id);
      return draft?{
        ...draft,status:stored.status as TaskStatus,
        mandatory:stored.mandatory,evidence:stored.evidenceIds,
        owner:stored.assignedRole
      }:{
        id:stored.id,title:stored.id.replaceAll('-',' '),
        owner:stored.assignedRole,source:'Operational follow-up',
        priority:'High' as const,dueLabel:'Follow-up',
        status:stored.status as TaskStatus,mandatory:stored.mandatory,
        evidence:stored.evidenceIds,note:''
      };
    }):tasks;

    if (this.mandatoryComplete) {
      this.caseStatus = 'Pending Verification';
    } else if (this.completedTasks > 0 || this.tasks.some(task => task.status === 'In Progress' || task.status === 'Escalated')) {
      this.caseStatus = 'In Progress';
    } else {
      this.caseStatus = 'Open';
    }

    if(this.centralCase){
      const states:Record<string,CaseStatus>={
        OPEN:'Open',IN_PROGRESS:'In Progress',
        PENDING_VERIFICATION:'Pending Verification',RESOLVED:'Resolved'
      };
      this.caseStatus=states[this.centralCase.status]||'Open';
    }
    this.stakeholders = [
      {
        role: this.copy('Case Owner', 'مالك الحالة'),
        unit: this.copy('NMC Duty Officer', 'ضابط مناوبة المركز البحري'),
        responsibility: this.copy('Own case coordination and operational decision tracking.', 'امتلاك تنسيق الحالة ومتابعة القرارات التشغيلية.'),
        state: 'Active'
      },
      {
        role: this.copy('Compliance', 'الامتثال'),
        unit: this.copy('Maritime Compliance', 'الامتثال البحري'),
        responsibility: this.copy('Verify regulatory and certificate conditions.', 'التحقق من الشروط التنظيمية وشروط الشهادات.'),
        state: conflict ? 'Active' : 'Notified'
      },
      {
        role: this.copy('Inspection', 'المعاينة'),
        unit: this.copy('Smart Inspection', 'المعاينة الذكية'),
        responsibility: this.copy('Execute priority inspection and return findings to NMC.', 'تنفيذ المعاينة ذات الأولوية وإعادة النتائج إلى المركز البحري الوطني.'),
        state: high ? 'Active' : 'Waiting'
      },
      {
        role: this.copy('Supervisor', 'المشرف'),
        unit: this.copy('NMC Supervisor', 'مشرف المركز البحري الوطني'),
        responsibility: this.copy('Receive SLA escalation and approve case resolution.', 'استقبال تصعيدات SLA واعتماد إغلاق الحالة.'),
        state: critical ? 'Notified' : 'Waiting'
      }
    ];

    if (!preserveState) {
      this.timeline = [
        {
          time: '22:45',
          type: 'Decision',
          title: this.copy('NMC case created', 'تم إنشاء حالة بالمركز البحري الوطني'),
          detail: this.copy('Officer approved operational follow-up and opened a coordinated maritime case.', 'اعتمد المسؤول المتابعة التشغيلية وتم فتح حالة بحرية منسقة.'),
          actor: this.copy('NMC Duty Officer', 'ضابط مناوبة المركز البحري')
        },
        {
          time: '22:44',
          type: 'AI',
          title: this.copy('AI recommendations reviewed', 'تمت مراجعة توصيات الذكاء الاصطناعي'),
          detail: this.copy('Evidence-grounded recommendations were presented for human decision.', 'تم عرض توصيات مبنية على الأدلة لاتخاذ القرار البشري.'),
          actor: this.copy('Maritime Situation Intelligence', 'استخبارات الموقف البحري')
        },
        {
          time: '22:43',
          type: 'AI',
          title: this.copy('AI situation assessment generated', 'تم إنشاء تقييم الموقف بالذكاء الاصطناعي'),
          detail: this.copy('Movement, inspection, certificate, data-quality and historical indicators were correlated.', 'تم ربط مؤشرات الحركة والمعاينة والشهادات وجودة البيانات والسجل التاريخي.'),
          actor: this.copy('NMC AI', 'ذكاء المركز البحري')
        },
        {
          time: '22:42',
          type: 'Risk',
          title: this.copy(`Risk assessed as ${this.riskEngine.levelForScore(this.vessel.risk)}`, `تم تقييم المخاطر عند المستوى ${this.riskLevelLabel}`),
          detail: this.copy(`Composite vessel score reached ${this.vessel.risk}/100.`, `وصلت الدرجة المركبة لمخاطر السفينة إلى ${this.vessel.risk}/100.`),
          actor: this.copy('NMC Risk Engine', 'محرك مخاطر المركز البحري')
        }
      ];

      const persistedTimeline = this.caseState.getTimeline(this.vessel.imo).map(item => ({
        time: item.time,
        type: item.type as TimelineType,
        title: item.title,
        detail: item.detail,
        actor: item.actor
      }));

      if (persistedTimeline.length) {
        this.timeline = [...persistedTimeline, ...this.timeline];
      }
    }
  }
}
