import {CommonModule} from '@angular/common';
import {Component,OnInit} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {RouterLink} from '@angular/router';
import {NmcNavigationComponent} from '../components/nmc-navigation.component';
import {LanguageService} from '../services/language.service';
import {SiCandidateTargetingService,SiDashboard,SiImpact,SiPriorityWeights,SiTargetingPolicyConfig} from '../services/si-candidate-targeting.service';

/** Targeting priority belongs to Inspection Settings; no legal rules are edited here. */
@Component({
  selector:'app-si-targeting-settings',
  standalone:true,
  imports:[CommonModule,FormsModule,RouterLink,NmcNavigationComponent],
  template:`
    <div class="si-layout" [attr.dir]="lang.dir">
      <app-nmc-navigation></app-nmc-navigation>
      <main class="settings-main">
        <header class="heading">
          <div>
            <small>{{copy('SETTINGS / SMART INSPECTION','الإعدادات / المعاينة الذكية')}}</small>
            <h1>{{copy('Targeting & Priority Rules','قواعد الاستهداف والأولوية')}}</h1>
            <p>{{copy('Versioned operational priority configuration and fleet impact preview. The rules do not change statutory eligibility, inspection approvals or NMC risk scores.',
              'إعداد أولوية التشغيل مع نسخ محفوظة ومعاينة أثرها على الأسطول. لا تغيّر القواعد الأهلية التنظيمية أو قرارات الاعتماد أو نتائج المخاطر.')}}</p>
          </div>
          <div class="actions">
            <a routerLink="/moei/smart-inspection/candidates">{{copy('Candidate Center','مركز الترشيح')}}</a>
            <button type="button" [disabled]="busy||loading" (click)="refresh()">{{copy('Refresh','تحديث')}}</button>
          </div>
        </header>
        <p class="notice error" *ngIf="error" role="alert">{{error}}</p>
        <p class="notice success" *ngIf="success" role="status">{{success}}</p>
        <p class="notice" *ngIf="loading">{{copy('Loading central targeting configuration…','جارٍ تحميل إعدادات الاستهداف المركزية…')}}</p>
        <section class="stats" *ngIf="dashboard as d">
          <article><small>{{copy('PUBLISHED VERSION','الإصدار المنشور')}}</small><strong>v{{d.policy.version}}</strong></article>
          <article><small>{{copy('CURRENT PRIORITY THRESHOLD','حد الأولوية الحالي')}}</small><strong>{{d.policy.config.riskPriorityThreshold}}/100</strong></article>
          <article><small>{{copy('ACTIVE FLEET','الأسطول النشط')}}</small><strong>{{d.summary.evaluatedPopulation}}</strong></article>
          <article><small>{{copy('SAVED NMC RISK','تقييمات المخاطر المحفوظة')}}</small><strong>{{d.summary.assessedRiskVessels}}</strong></article>
        </section>
        <div class="form-grid">
          <section class="panel">
            <h2>{{copy('01 · Business Configuration','٠١ · إعدادات الأعمال')}}</h2>
            <p>{{copy('Adjust the candidate priority threshold only. Changes are reviewed and published by a supervisor.',
              'عدّل حد أولوية المرشحين فقط. يراجع المشرف التغييرات وينشرها.')}}</p>
            <label>{{copy('Proposed priority threshold (0–100)','حد الأولوية المقترح (٠–١٠٠)')}}
              <input type="number" min="0" max="100" step="1" [(ngModel)]="threshold" (ngModelChange)="impact=null"/>
            </label>
            <div class="priority-settings">
              <h3>{{copy('AI Prioritization Criteria — Published Weights','معايير ترتيب المعاينات باستخدام AI — الأوزان المنشورة')}}</h3>
              <p>{{copy('Configure the operational priority criteria sent to SI-P01. All five weights must total 100%. These do not modify official NMC Risk or legal eligibility.',
                'حدد معايير ترتيب الأولوية التشغيلية التي تُرسل للوكيل SI-P01. يجب أن يكون مجموع الأوزان ١٠٠٪ دون تغيير مخاطر NMC الرسمية أو الأهلية القانونية.')}}</p>
              <div class="weights-grid">
                <label>{{copy('Saved Vessel Risk','مخاطر السفينة المحفوظة')}} %
                  <input type="number" min="0" max="100" [(ngModel)]="weights.risk" (ngModelChange)="impact=null"/>
                </label>
                <label>{{copy('Inspection Trigger','سبب ترشيح المعاينة')}} %
                  <input type="number" min="0" max="100" [(ngModel)]="weights.trigger" (ngModelChange)="impact=null"/>
                </label>
                <label>{{copy('Inspection History','سجل المعاينات')}} %
                  <input type="number" min="0" max="100" [(ngModel)]="weights.history" (ngModelChange)="impact=null"/>
                </label>
                <label>{{copy('Inspection Deadline','موعد المعاينة')}} %
                  <input type="number" min="0" max="100" [(ngModel)]="weights.deadline" (ngModelChange)="impact=null"/>
                </label>
                <label>{{copy('Operational Urgency','الاستعجال التشغيلي')}} %
                  <input type="number" min="0" max="100" [(ngModel)]="weights.urgency" (ngModelChange)="impact=null"/>
                </label>
              </div>
              <p [class.invalid]="weightTotal!==100"><strong>{{copy('Total','الإجمالي')}}: {{weightTotal}}%</strong> ·
                {{copy('NMC-approved referrals remain first; missing risk requires manual review. Missing factors are never fabricated.',
                  'تظل إحالات NMC المعتمدة أولًا، وتحتاج المخاطر الناقصة مراجعة بشرية. لا يتم اختلاق عوامل غير متوفرة.')}}</p>
              <h3>{{copy('Inspection Trigger Reason Priorities','أولويات أسباب ترشيح المعاينة')}}</h3>
              <p>{{copy('Published source-severity indicators (0–100) affect advisory ordering only. An NMC-approved referral always keeps its protected tier.',
                'قيم أولوية مصادر الترشيح المنشورة (من ٠ إلى ١٠٠) تؤثر على الترتيب الاستشاري فقط، مع بقاء إحالات NMC المعتمدة في مستواها المحمي.')}}</p>
              <div class="weights-grid">
                <label>{{copy('NMC Approved Referral','إحالة NMC معتمدة')}}
                  <input type="number" min="0" max="100" [(ngModel)]="sourceScores.NMC_CASE" (ngModelChange)="impact=null"/>
                </label>
                <label>{{copy('Service Request','طلب خدمة بحرية')}}
                  <input type="number" min="0" max="100" [(ngModel)]="sourceScores.SERVICE_REQUEST" (ngModelChange)="impact=null"/>
                </label>
                <label>{{copy('PSC Port Call','إخطار نداء ميناء PSC')}}
                  <input type="number" min="0" max="100" [(ngModel)]="sourceScores.PSC_PORT_CALL" (ngModelChange)="impact=null"/>
                </label>
              </div>
              <p class="hint">{{copy('Illustrative POC weighting, not a Ministry-approved statutory targeting model.',
                'أوزان تجريبية وليست نموذج استهداف تنظيميًا معتمدًا من الوزارة.')}}</p>
            </div>
            <label>{{copy('Editor key','مفتاح المحرر')}}
              <input type="password" [(ngModel)]="editorKey" autocomplete="off"/>
            </label>
            <button class="primary" type="button" [disabled]="busy||!dashboard" (click)="preview()">
              {{copy('Preview Fleet Impact','معاينة أثر التغيير على الأسطول')}}
            </button>
            <div *ngIf="impact as p" class="impact">
              <strong>{{p.affectedCandidateCount}} {{copy('affected candidates','مرشح تأثر بالتغيير')}}</strong>
              <p>{{p.evaluatedPopulation}} {{copy('active vessels','سفينة نشطة')}} ·
                {{p.unevaluatedRiskVessels}} {{copy('without saved NMC risk','بدون تقييم مخاطر محفوظ')}}</p>
              <p *ngIf="p.aiSettingsChanged">
                <strong>{{p.potentialRankingCandidates}} {{copy('pending candidates may be reordered','مرشح مفتوح قد يتغير ترتيبه')}}</strong>
                · {{copy('Publishing does NOT call AI. Re-run SI-P01 explicitly when the settings are effective.',
                  'نشر الإعدادات لا يشغّل AI؛ يجب تشغيل SI-P01 يدويًا بعد النشر.')}}</p>
              <p>{{copy('Affected IMO numbers','أرقام IMO المتأثرة')}}:
                {{p.affectedImos.length?p.affectedImos.join(', '):copy('None','لا يوجد')}}</p>
              <small>{{copy('Preview does not call AI or change eligibility. Publish only after review.',
                'المعاينة لا تستدعي AI ولا تغيّر الأهلية. لا تنشر إلا بعد المراجعة.')}}</small>
            </div>
          </section>
          <section class="panel">
            <h2>{{copy('02 · Controlled Publication','٠٢ · النشر المنضبط')}}</h2>
            <p>{{copy('Publishing creates a new immutable priority-rules version. Previous cases and historical scoring remain unchanged.',
              'يُنشئ النشر إصدارًا جديدًا محفوظًا لقواعد الأولوية، دون تعديل الحالات السابقة أو التقييمات التاريخية.')}}</p>
            <label>{{copy('Business reviewer','اسم مسؤول المراجعة')}}
              <input [(ngModel)]="reviewer" maxlength="120" autocomplete="off"/>
            </label>
            <label>{{copy('Business justification','المبرر الإداري')}}
              <textarea [(ngModel)]="reason" rows="3" maxlength="500"></textarea>
            </label>
            <label>{{copy('Supervisor / Publisher key','مفتاح المشرف / الناشر')}}
              <input type="password" [(ngModel)]="publisherKey" autocomplete="off"/>
            </label>
            <button type="button" class="primary" [disabled]="busy||!impact" (click)="publish()">
              {{copy('Publish Priority Version','نشر إصدار قواعد الأولوية')}}
            </button>
            <p class="hint">{{copy('A new impact preview is required after each parameter change.',
              'يلزم إجراء معاينة أثر جديدة بعد أي تغيير في المعلمات.')}}</p>
          </section>
        </div>
      </main>
    </div>
  `,
  styles:[`
    :host{display:block;min-height:calc(100vh - 82px);background:#eef4f7;color:#203c52}
    .si-layout{display:flex;min-height:calc(100vh - 82px)}
    .settings-main{flex:1;min-width:0;max-width:1620px;margin:0 auto;padding:25px 28px 48px}
    .heading{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;
      border-bottom:1px solid #dce9ef;padding:12px 0 23px}
    .heading small{font-size:10px;color:#0f766e;font-weight:900;letter-spacing:1px}
    .heading h1{color:#17324d;font-size:25px;margin:8px 0}
    .heading p,.panel p{font-size:12px;color:#708697;line-height:1.75;margin:0}
    .actions{display:flex;align-items:center;gap:9px}
    .actions a,.actions button{border:1px solid #cbded9;background:white;border-radius:9px;
      color:#0f766e;padding:10px 12px;font-size:11px;font-weight:800;cursor:pointer;text-decoration:none}
    .stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:13px;margin:18px 0}
    .stats article,.panel{background:#fff;border:1px solid #dce9ef;border-radius:12px;
      box-shadow:0 3px 14px #18374b0c;padding:21px}
    .stats small{display:block;color:#597789;font-size:10px;font-weight:800}
    .stats strong{display:block;color:#096b7a;font-size:26px;margin-top:10px}
    .form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:15px}
    .panel h2{color:#18516b;font-size:17px;margin:0 0 9px}
    label{font-size:12px;font-weight:750;color:#385c6e;display:block;margin:18px 0}
    input,textarea{display:block;width:100%;box-sizing:border-box;margin:8px 0 0;
      padding:11px 12px;border:1px solid #cbdce4;border-radius:9px;color:#1c435a;font:inherit}
    .priority-settings{margin:17px 0;border:1px solid #dbe9eb;padding:16px;border-radius:10px;background:#f5faf9}
    .priority-settings h3{font-size:14px;color:#18516b;margin:0 0 8px}
    .priority-settings p{font-size:11px;margin:10px 0;line-height:1.55}
    .priority-settings p.invalid strong{color:#b63a2b}
    .weights-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 11px}
    @media(max-width:600px){.weights-grid{grid-template-columns:1fr}}
    .primary{padding:11px 14px;background:#087b93;border:1px solid #087b93;color:white;
      font-size:12px;border-radius:8px;font-weight:800;cursor:pointer}
    button:disabled{opacity:.5;cursor:not-allowed}
    .impact{padding:15px;border:1px solid #cae8d8;background:#edf9f3;border-radius:10px;margin-top:16px}
    .impact strong{color:#167854}.impact p{margin:9px 0}.impact small,.hint{color:#718a98;font-size:11px}
    .notice{padding:12px 15px;margin:13px 0;border-radius:9px;font-size:12px;background:#e9f4f7}
    .error{color:#a83131;background:#fff0ed}.success{color:#16764e;background:#e7f9ee}
    @media(max-width:1120px){.stats{grid-template-columns:repeat(2,minmax(0,1fr))}}
    @media(max-width:960px){.si-layout{display:block}.settings-main{padding:18px}
      .form-grid{grid-template-columns:1fr}.heading{flex-direction:column}}
    @media(max-width:560px){.stats{grid-template-columns:1fr}}
  `]
})
export class SiTargetingSettingsComponent implements OnInit{
  dashboard:SiDashboard|null=null;impact:SiImpact|null=null;
  loading=false;busy=false;error='';success='';
  threshold=65;reviewer='';reason='';editorKey='';publisherKey='';
  weights:SiPriorityWeights={risk:30,trigger:25,history:20,deadline:15,urgency:10};
  sourceScores={NMC_CASE:90,SERVICE_REQUEST:55,PSC_PORT_CALL:65};
  get weightTotal():number{return Object.values(this.weights).reduce((sum,x)=>sum+Number(x||0),0);}
  private proposedConfig():SiTargetingPolicyConfig{
    return {riskPriorityThreshold:Number(this.threshold),
      includeMissingRiskInReview:true,
      prioritization:{weights:{...this.weights},approvedNmcFirst:true,
        missingRiskAction:'REVIEW_REQUIRED',sourceTriggerScores:{...this.sourceScores}}};
  }
  constructor(private readonly api:SiCandidateTargetingService,public readonly lang:LanguageService){}
  copy(en:string,ar:string){return this.lang.pick(en,ar);}
  ngOnInit():void{this.refresh();}
  refresh():void{
    this.loading=true;this.error='';this.impact=null;
    this.api.dashboard().subscribe({
      next:d=>{this.dashboard=d;this.threshold=d.policy.config.riskPriorityThreshold;
        this.weights={...(d.policy.config.prioritization?.weights||
          {risk:30,trigger:25,history:20,deadline:15,urgency:10})};
        this.sourceScores={...(d.policy.config.prioritization?.sourceTriggerScores||
          {NMC_CASE:90,SERVICE_REQUEST:55,PSC_PORT_CALL:65})};
        this.loading=false;},
      error:e=>{this.showError(e);this.loading=false;}
    });
  }
  private showError(error:unknown):void{
    const e=error as {error?:{error?:string};status?:number};
    this.error=e?.error?.error||this.copy('Unable to load/save rules','تعذر تحميل القواعد أو حفظها');
    this.busy=false;this.success='';
  }
  preview():void{
    if(!this.editorKey.trim()){this.error=this.copy('Editor key required','مطلوب مفتاح المحرر');return;}
    if(!Number.isInteger(Number(this.threshold))||Number(this.threshold)<0||Number(this.threshold)>100){
      this.error=this.copy('Threshold must be an integer from 0 to 100','يجب أن يكون الحد عددًا صحيحًا بين ٠ و١٠٠');return;
    }
    if(this.weightTotal!==100||Object.values(this.weights).some(x=>!Number.isInteger(Number(x))||Number(x)<0||Number(x)>100)){
      this.error=this.copy('All criterion weights must be integers totaling 100%.',
        'يجب أن تكون الأوزان أعدادًا صحيحة ومجموعها ١٠٠٪.');return;
    }
    if(Object.values(this.sourceScores).some(x=>!Number.isInteger(Number(x))||
        Number(x)<0||Number(x)>100)){
      this.error=this.copy('All trigger reason scores must be whole numbers from 0 to 100.',
        'يجب أن تكون أولوية أسباب الترشيح عددًا صحيحًا بين ٠ و١٠٠.');return;
    }
    this.busy=true;this.error='';this.impact=null;this.success='';
    this.api.preview(this.proposedConfig(),this.editorKey.trim()).subscribe({
      next:impact=>{this.impact=impact;this.busy=false;},
      error:e=>this.showError(e)
    });
  }
  publish():void{
    if(!this.dashboard||!this.impact||this.busy)return;
    if(!this.publisherKey.trim()||!this.reviewer.trim()||this.reason.trim().length<8){
      this.error=this.copy('Publisher key, reviewer and reason (8+ characters) are required',
        'مطلوب مفتاح المشرف واسم المراجع ومبرر لا يقل عن ٨ أحرف');return;
    }
    if(!window.confirm(this.copy(
      'Publish a new targeting priority version? NMC risk, AI assessments and legal eligibility stay unchanged.',
      'نشر إصدار جديد للأولوية؟ لن تتغير تقييمات المخاطر أو نتائج AI أو الأهلية القانونية.')))return;
    this.busy=true;this.error='';
    this.api.publish({config:this.proposedConfig(),expectedVersion:this.dashboard.policy.version,
      publishedBy:this.reviewer.trim(),reason:this.reason.trim()},
      this.publisherKey.trim()).subscribe({
      next:()=>{
        this.busy=false;this.reason='';
        this.refreshAfterPublish();
      },
      error:e=>this.showError(e)
    });
  }
  private refreshAfterPublish():void{
    this.api.dashboard().subscribe({
      next:d=>{
        this.dashboard=d;this.threshold=d.policy.config.riskPriorityThreshold;
        this.impact=null;this.error='';
        this.success=this.copy('Priority rules published successfully','تم نشر قواعد الأولوية بنجاح');
      },
      error:e=>this.showError(e)
    });
  }
}
