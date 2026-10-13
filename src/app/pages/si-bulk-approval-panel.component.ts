import {CommonModule} from '@angular/common';
import {Component,EventEmitter,Input,OnChanges,OnDestroy,OnInit,Output,SimpleChanges} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {RouterLink} from '@angular/router';
import {Subscription,interval,switchMap} from 'rxjs';
import {LanguageService} from '../services/language.service';
import {MoeiAuthService} from '../services/moei-auth.service';
import {SiInspectionPlanState} from '../services/si-candidate-targeting.service';
import {SiBulkJob,SiBulkPlanService,SiBulkPreview} from '../services/si-bulk-plan.service';

@Component({
 selector:'app-si-bulk-approval-panel',standalone:true,
 imports:[CommonModule,FormsModule,RouterLink],
 template:`
 <section class="bulk-shell" [attr.dir]="lang.dir">
  <header class="bulk-header">
   <div>
    <p class="eyebrow">{{copy('SI-01 → SI-02 · SUPERVISOR DECISION','SI-01 ← SI-02 · قرار المشرف')}}</p>
    <h2>{{copy('Approve the Inspection Plan','اعتماد خطة المعاينات بالكامل')}}</h2>
    <p class="subtitle">{{copy('One human approval for all selected vessels. Approved inspections are created per lawful regime, then an evidence-based preparation dossier is built for each case.',
    'اعتماد واحد لكل السفن المختارة بالخطة. تُنشأ حالة معاينة مستقلة طبقًا لنوعها، ثم يُبنى ملف تحضير موثق لكل حالة.')}}</p>
   </div>
   <button type="button" class="outline" [disabled]="loading||submitting" (click)="refresh()">
     {{copy('Review Plan','مراجعة الخطة')}}
   </button>
  </header>
  <p class="notice" *ngIf="loading">{{copy('Checking plan changes, inspection regimes and saved evidence…','جارٍ مراجعة تحديثات الخطة وأنواع المعاينة والأدلة المحفوظة…')}}</p>
  <p class="notice error" *ngIf="error" role="alert">{{error}}</p>
  <ng-container *ngIf="preview as p">
   <div class="summary-row">
    <div><strong>{{p.selectedVessels}}</strong><span>{{copy('Selected vessels','السفن المحددة')}}</span></div>
    <div><strong>{{p.planRevision}}</strong><span>{{copy('Plan version','نسخة الخطة')}}</span></div>
    <div><strong>{{p.a04Enabled?copy('Available','متاح'):copy('Not enabled','غير مفعل')}}</strong>
      <span>{{copy('A04 AI dossier','ملف AI A04')}}</span></div>
   </div>
   <p class="notice error" *ngIf="p.stale||!p.agentRunId">
    {{copy('The AI selection has changed or has not been generated yet. Re-run C01 and review the new plan before bulk approval.',
      'توصيات اختيار السفن قديمة أو لم تُولد بعد. أعد حساب C01 وراجع الخطة قبل الاعتماد الجماعي.')}}
   </p>
   <p class="notice" *ngIf="!p.selectedVessels&&p.agentRunId&&!p.stale">
    {{copy('No vessels are selected in the current plan. Include vessels before approval.',
      'لا توجد سفن مختارة في الخطة الحالية. أدرج السفن أولاً.')}}
   </p>
   <ng-container *ngIf="p.selectedVessels>0">
    <div class="table-scroll">
     <table>
      <thead><tr><th>{{copy('Rank','الترتيب')}}</th>
       <th>{{copy('Vessel','السفينة')}}</th><th>IMO</th>
       <th>{{copy('Approved inspection regime','نوع المعاينة للاعتماد')}}</th></tr></thead>
      <tbody><tr *ngFor="let vessel of p.vessels">
       <td><strong>#{{vessel.rank||'—'}}</strong></td><td>{{vessel.vesselName}}</td>
       <td>{{vessel.imo}}</td>
       <td>
        <select [ngModel]="choices[vessel.imo]||''"
          (ngModelChange)="choices[vessel.imo]=$event"
          [attr.aria-label]="copy('Inspection regime for ','نوع المعاينة للسفينة ')+vessel.vesselName"
          [disabled]="submitting||BooleanJobBusy">
         <option value="">{{copy('Choose inspection type','اختر نوع المعاينة')}}</option>
         <option *ngFor="let item of vessel.options" [value]="item.candidateKey">
          {{item.regime}} · {{item.eligibility}}</option>
        </select>
        <small *ngIf="vessel.requiresRegimeChoice" class="regime-note">
         {{copy('Explicit decision required: multiple regimes or no pending case.',
           'يتطلب اختيارًا صريحًا: تعدد أنواع المعاينة أو عدم وجود حالة متاحة.')}}
        </small>
       </td>
      </tr></tbody>
     </table>
    </div>
    <div class="approval-form">
     <label class="reason-label">
      <span>{{copy('Approval reason (recorded for every approved inspection)','سبب الاعتماد (يُحفظ لكل معاينة)')}}</span>
      <textarea [(ngModel)]="reason" [disabled]="submitting||BooleanJobBusy" rows="2"
        [placeholder]="copy('Reviewed source evidence and approved the selected plan as a single decision.',
        'بعد مراجعة الأدلة ومصادر البيانات، تم اعتماد خطة المعاينات المختارة بقرار واحد.')"></textarea>
     </label>
     <div class="options">
      <label><input type="checkbox" [(ngModel)]="generateA04"
       [disabled]="submitting||BooleanJobBusy||!p.a04Enabled"/>
       {{copy('Automatically generate an A04 AI dossier for every eligible approved case',
         'إنشاء ملف AI A04 تلقائيًا لكل حالة معتمدة مستوفية للشروط')}}</label>
      <label><input type="checkbox" [(ngModel)]="runP01"
       [disabled]="submitting||BooleanJobBusy||!p.p01Enabled"/>
       {{copy('Recalculate execution priority P01 after cases are approved',
         'إعادة حساب أولوية التنفيذ P01 بعد اعتماد الحالات')}}</label>
      <p class="caution">
       {{copy('Deterministic SI-02 preparation is ALWAYS created without AI charges. A04 is an optional AI draft (not an approved checklist). Real Airia calls require explicit cost confirmation.',
         'يُنشأ ملف التحضير الأساسي SI-02 دائمًا دون تكلفة AI. ملفات A04 مسودات غير معتمدة، واستخدام Airia الفعلي يتطلب موافقة صريحة على التكلفة.')}}
      </p>
     </div>
     <button class="bulk-approve" type="button" (click)="approve()"
      [disabled]="submitting||BooleanJobBusy||p.stale||!p.agentRunId||!p.selectedVessels||!allChosen||reason.trim().length<8||!auth.isAdmin">
      {{submitting?copy('Submitting approval…','جارٍ تسجيل الاعتماد…'):
        copy('Approve Complete Plan ('+p.selectedVessels+' Vessels) & Start Preparation',
          'اعتماد الخطة بالكامل ('+p.selectedVessels+' سفن) وبدء التحضير')}}
     </button>
     <small>{{copy('Supervisor/ADMIN permission is required. No vessel is officially approved by AI.',
       'يلزم صلاحية المشرف / ADMIN. لا يعتمد الذكاء الاصطناعي أي معاينة رسميًا.')}}</small>
    </div>
   </ng-container>
  </ng-container>

  <article class="batch-progress" *ngIf="job as j">
    <header class="progress-header"><h3>{{copy('Approved Plan Execution','تنفيذ خطة المعاينات المعتمدة')}}</h3>
      <span [class.good]="j.status==='COMPLETED'" [class.warn]="j.status==='PARTIAL'">{{j.status}}</span>
    </header>
    <p>{{copy('Batch','دفعة')}} {{j.id}} ·
      {{copy('Approved','تم اعتماد')}} {{j.approvedCount}} / {{j.totalSelected}} ·
      {{copy('P01 status','حالة P01')}}: {{j.priorityStatus}}</p>
    <div class="table-scroll"><table><thead><tr><th>{{copy('Vessel','السفينة')}}</th>
       <th>{{copy('Case','الحالة')}}</th><th>{{copy('Preparation','التحضير')}}</th>
       <th>{{copy('A04','ملف A04')}}</th><th>{{copy('Open','فتح')}}</th></tr></thead>
      <tbody><tr *ngFor="let x of j.items">
       <td>{{x.vesselName}}<small>{{x.imo}}</small></td>
       <td>{{x.state}}<small *ngIf="x.error" class="error-text">{{x.error}}</small></td>
       <td>{{x.dossierStatus}}</td><td>{{x.aiDossierStatus}}</td>
       <td><a *ngIf="x.inspectionCaseId"
        [routerLink]="['/moei/smart-inspection/preparation',x.inspectionCaseId]">
         {{copy('Open dossier','فتح الملف')}}</a><span *ngIf="!x.inspectionCaseId">—</span></td>
      </tr></tbody></table></div>
    <p class="caution" *ngIf="j.status==='PARTIAL'">
      {{copy('Partial completion: do not reapprove individual vessels. Review the saved case IDs and failures before recovery.',
       'اكتمال جزئي: لا تكرر اعتماد السفن؛ راجع الحالات المحفوظة والأخطاء قبل الاستكمال.')}}
    </p>
    <a routerLink="/moei/smart-inspection/preparation">
     {{copy('Open SI-02 Preparation Register →','فتح سجل التحضير SI-02 ←')}}</a>
  </article>
 </section>
 `,
 styles:[`
 :host{display:block}
 .bulk-shell{background:linear-gradient(120deg,#f7fcfc,#e8f3f4);border:1px solid #a9d4ce;
  border-inline-start:5px solid #048979;border-radius:12px;padding:21px;margin:16px 0 24px;
  color:#173d53}
 .bulk-header,.progress-header{display:flex;align-items:start;justify-content:space-between;gap:18px}
 .eyebrow{font-size:10px;letter-spacing:1.3px;font-weight:850;color:#06897d;margin:0 0 6px}
 h2{font-size:20px;margin:0 0 8px;color:#0a354b}h3{font-size:15px;margin:0 0 9px}
 .subtitle{font-size:12px;line-height:1.8;color:#587580;max-width:870px;margin:0 0 14px}
 button{border:0;padding:10px 14px;border-radius:8px;background:#087f7a;color:white;font-weight:750;cursor:pointer}
 button:disabled{opacity:.5;cursor:not-allowed}.outline{border:1px solid #7faaa9;background:white;color:#096f67;white-space:nowrap}
 .summary-row{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:10px 0 15px}
 .summary-row>div{display:grid;gap:4px;background:white;border:1px solid #d5e8e8;border-radius:10px;padding:13px}
 .summary-row strong{font-size:20px;color:#056c70}.summary-row span{font-size:11px;color:#56717e}
 .table-scroll{overflow-x:auto;background:white;border-radius:9px}
 table{border-collapse:collapse;width:100%;font-size:12px}
 th,td{padding:11px 10px;text-align:start;border-bottom:1px solid #e8f0f2;white-space:normal}
 th{color:#4f717f;background:#e9f3f5;text-transform:uppercase;font-size:10px}
 td small{display:block;margin-top:5px;color:#718694;font-size:10px}
 select{max-width:100%;min-width:195px;border:1px solid #bdcfd2;border-radius:7px;padding:8px;
  background:#fff;color:#183b4f}
 .regime-note{color:#ad6823}
 .approval-form{display:grid;gap:13px;margin-top:18px}
 .reason-label{font-weight:750;font-size:12px;display:grid;gap:7px}
 textarea{width:100%;min-height:62px;resize:vertical;border:1px solid #c5d8da;border-radius:8px;
  padding:10px;font:inherit;color:#184258}
 .options{display:grid;gap:9px}
 .options label{display:flex;gap:9px;align-items:start;font-size:12px;font-weight:650}
 .options input{accent-color:#008878;width:16px;height:16px}
 .caution{font-size:11px;color:#52747e;line-height:1.8;margin:0}
 .bulk-approve{width:100%;min-height:49px;font-size:13px}
 .approval-form>small{font-size:10px;color:#738992}
 .notice{padding:11px;background:#e8f4f8;border-radius:8px;font-size:12px;line-height:1.7}
 .notice.error{background:#fff1eb;color:#a34d2f}
 .batch-progress{background:#fff;border:1px solid #d7e5e5;padding:16px;border-radius:10px;margin-top:17px}
 .progress-header span{font-size:11px;border-radius:7px;padding:5px 8px;background:#dae8eb}
 .progress-header span.good{background:#d8f7e8;color:#087451}
 .progress-header span.warn{background:#ffecdb;color:#905524}
 .batch-progress>p{font-size:12px;color:#4e7283}
 a{color:#097a75;font-weight:800}.error-text{color:#af4937}
 @media(max-width:720px){.bulk-shell{padding:14px}.bulk-header{display:block}
  .summary-row{grid-template-columns:1fr}select{min-width:0}}
 `]
})
export class SiBulkApprovalPanelComponent implements OnChanges,OnDestroy,OnInit{
 @Input() plan:SiInspectionPlanState|null=null;
 @Output() batchCompleted=new EventEmitter<void>();
 preview:SiBulkPreview|null=null;
 choices:Record<string,string>={};
 reason='';generateA04=false;runP01=false;
 loading=false;submitting=false;error='';job:SiBulkJob|null=null;
 private timer:Subscription|null=null;
 private lastPlanKey='';
 constructor(private readonly api:SiBulkPlanService,
   public lang:LanguageService,public auth:MoeiAuthService){}
 copy(en:string,ar:string):string{return this.lang.pick(en,ar);}
 get BooleanJobBusy():boolean{return this.job?.status==='RUNNING'||this.job?.status==='QUEUED';}
 get allChosen():boolean{return Boolean(this.preview?.vessels.length)&&
   this.preview!.vessels.every(x=>Boolean(this.choices[x.imo]));}
 ngOnInit():void{
  // A browser refresh must not hide a batch that is still running on server.
  this.api.latest().subscribe({
   next:result=>{
    const recent=result.batches?.[0];
    if(recent){
     this.job=recent;
     if(recent.status==='QUEUED'||recent.status==='RUNNING')this.startPoll(recent.id);
    }
   },error:()=>{ /* The preview will separately display API connectivity errors. */ }
  });
 }
 ngOnChanges(_:SimpleChanges):void{
  const key=this.plan?this.plan.sourceHash+'|'+this.plan.revision+'|'+this.plan.agentRunId:'';
  if(key!==this.lastPlanKey){this.lastPlanKey=key;this.refresh();}
 }
 ngOnDestroy():void{this.timer?.unsubscribe();}
 refresh():void{
  if(this.submitting)return;
  this.loading=true;this.error='';
  this.api.preview().subscribe({
   next:p=>{
    this.preview=p;this.loading=false;
    const next:Record<string,string>={};
    for(const v of p.vessels)next[v.imo]=v.defaultCandidateKey||this.choices[v.imo]||'';
    this.choices=next;
    this.generateA04=p.a04Enabled&&p.a04Provider==='MOCK';
    this.runP01=p.p01Enabled&&p.p01Provider==='MOCK';
   },error:e=>{
    this.loading=false;this.error=e?.error?.error||
      this.copy('Cannot preview saved inspection plan.','تعذر عرض خطة المعاينات المحفوظة.');
   }
  });
 }
 approve():void{
  const p=this.preview;
  if(!p||p.stale||!p.agentRunId||!this.auth.isAdmin||!this.allChosen||
    this.reason.trim().length<8||this.submitting||this.BooleanJobBusy)return;
  const paid=(this.generateA04&&p.a04Provider==='AIRIA')||
    (this.runP01&&p.p01Provider==='AIRIA');
  const message=this.copy(
   'Approve all '+p.selectedVessels+' plan-selected vessels with one supervisor decision, create individual inspection cases and deterministic dossiers?'+
     (paid?' This also authorizes chargeable Airia operations for this batch.':' No paid AI calls will be made.'),
   'هل تعتمد السفن المختارة وعددها '+p.selectedVessels+
   ' بقرار واحد، مع إنشاء حالات معاينة وملفات تحضير لكل سفينة؟'+
   (paid?' يشمل هذا موافقة صريحة على استدعاءات Airia المدفوعة.':' لن يتم استدعاء AI مدفوع.')
  );
  if(!window.confirm(message))return;
  this.submitting=true;this.error='';
  this.api.approve({
   reason:this.reason.trim(),expectedRevision:p.planRevision,
   expectedSourceHash:p.sourceHash,expectedAgentRunId:p.agentRunId,
   confirmApproval:true,generateA04:this.generateA04,
   runP01:this.runP01,confirmAiCost:paid,
   choices:p.vessels.map(x=>({imo:x.imo,candidateKey:this.choices[x.imo]}))
  }).subscribe({
   next:job=>{this.submitting=false;this.job=job;this.startPoll(job.id);},
   error:e=>{
    this.submitting=false;this.error=e?.error?.error||
     this.copy('Batch approval rejected. Refresh the source plan and review changes.',
       'تعذر اعتماد الخطة. حدّث بيانات المصدر وراجع التغييرات.');
   }
  });
 }
 private startPoll(id:string):void{
  this.timer?.unsubscribe();
  this.timer=interval(1300).pipe(switchMap(()=>this.api.job(id)))
   .subscribe({
    next:j=>{
     this.job=j;
     if(j.status==='COMPLETED'||j.status==='PARTIAL'){
      this.timer?.unsubscribe();this.batchCompleted.emit();
     }
    },
    error:e=>{this.timer?.unsubscribe();this.error=e?.error?.error||
      this.copy('Cannot read batch status; approved cases may still exist. Do not resubmit.',
        'تعذر قراءة حالة الدفعة، وربما تم حفظ بعض الحالات. لا تكرر الاعتماد.');}
   });
 }
}
