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
            <div class="risk-style-factor threshold-factor">
              <div class="factor-info">
                <strong>{{copy('Proposed Priority Threshold','حد الأولوية المقترح')}}</strong>
                <small>{{copy('Published rule threshold · 0–100','حد قاعدة الأولوية المنشورة · من ٠ إلى ١٠٠')}}</small>
              </div>
              <div class="factor-control">
                <input class="weight-slider" type="range" min="0" max="100" step="1"
                  [(ngModel)]="threshold" (ngModelChange)="onPriorityEdit()"
                  [attr.aria-label]="copy('Proposed priority threshold slider','شريط تعديل حد الأولوية المقترح')"/>
                <div class="number-input">
                  <input type="number" min="0" max="100" step="1"
                    [(ngModel)]="threshold" (ngModelChange)="onPriorityEdit()"
                    [attr.aria-label]="copy('Proposed priority threshold value','قيمة حد الأولوية المقترح')"/>
                  <span>/100</span>
                </div>
              </div>
            </div>
            <div class="priority-settings">
              <div class="priority-section-head">
                <div>
                  <small class="section-kicker">{{copy('SI-P01 / PUBLISHED BUSINESS POLICY','SI-P01 / سياسة الأعمال المنشورة')}}</small>
                  <h3>{{copy('AI Prioritization Criteria — Published Weights','معايير ترتيب المعاينات باستخدام AI — الأوزان المنشورة')}}</h3>
                  <p>{{copy('Set the operational weight of each criterion, using the same sliders as NMC Risk Configuration. The five weights must total 100%. No official NMC risk score or legal eligibility is changed.',
                    'اضبط الأوزان التشغيلية بشريط التمرير مثل إعدادات مخاطر NMC. يجب أن يساوي مجموع الأوزان ١٠٠٪، دون تغيير المخاطر الرسمية أو الأهلية القانونية.')}}</p>
                </div>
                <div class="weight-total" [class.invalid]="!weightsValid" role="status" aria-live="polite">
                  <small>{{copy('TOTAL WEIGHT','مجموع الأوزان')}}</small>
                  <strong>{{weightTotal}}%</strong>
                </div>
              </div>
              <div class="risk-style-list">
                <div class="risk-style-factor" *ngFor="let factor of weightFactors">
                  <div class="factor-info">
                    <strong>{{copy(factor.en,factor.ar)}}</strong>
                    <small>{{copy(factor.hintEn,factor.hintAr)}}</small>
                  </div>
                  <div class="factor-control">
                    <input class="weight-slider" type="range" min="0" max="100" step="1"
                      [(ngModel)]="weights[factor.key]" (ngModelChange)="onPriorityEdit()"
                      [attr.aria-label]="copy(factor.en+' weight slider',factor.ar+' شريط الوزن')"
                      [attr.aria-valuetext]="weights[factor.key]+'%'"/>
                    <div class="number-input">
                      <input type="number" min="0" max="100" step="1"
                        [(ngModel)]="weights[factor.key]" (ngModelChange)="onPriorityEdit()"
                        [attr.aria-label]="copy(factor.en+' weight percentage',factor.ar+' النسبة المئوية')"/>
                      <span>%</span>
                    </div>
                  </div>
                </div>
              </div>
              <div class="weight-footer">
                <button type="button" class="normalize-btn"
                  (click)="normalizeWeights()" [disabled]="!canNormalize||busy||loading">
                  ↻ {{copy('Normalize to 100%','ضبط الأوزان إلى ١٠٠٪')}}
                </button>
                <p class="weight-validation" [class.invalid]="!weightsValid">
                  <strong>{{weightsValid?copy('✓ Total is valid','✓ المجموع صحيح'):
                    copy('Total must equal 100% before Preview or Publish','يجب أن يكون المجموع ١٠٠٪ قبل المعاينة أو النشر')}}</strong>
                </p>
              </div>
              <p class="policy-note">{{copy('NMC-approved referrals retain their protected tier. Missing risk, inspection history and other factors are never invented.',
                'تحتفظ إحالات NMC المعتمدة بمستواها المحمي، ولا يتم اختلاق تقييم مخاطر أو سجل معاينات أو عوامل غير موجودة.')}}</p>

              <div class="priority-section-head reason-head">
                <div>
                  <small class="section-kicker">{{copy('INSPECTION SOURCE TRIGGERS','أسباب ترشيح المعاينات')}}</small>
                  <h3>{{copy('Inspection Trigger Reason Priorities','أولويات أسباب ترشيح المعاينة')}}</h3>
                  <p>{{copy('Set the advisory trigger score for each candidate source (0–100). These values are distinct from the five percentage weights and do not need to total 100.',
                    'حدد درجة أولوية كل مصدر (من ٠ إلى ١٠٠). هذه درجات مستقلة عن نسب الأوزان الخمسة ولا يلزم أن يكون مجموعها ١٠٠.')}}</p>
                </div>
              </div>
              <div class="risk-style-list">
                <div class="risk-style-factor" *ngFor="let reason of triggerReasons">
                  <div class="factor-info">
                    <strong>{{copy(reason.en,reason.ar)}}</strong>
                    <small>{{copy(reason.hintEn,reason.hintAr)}}</small>
                  </div>
                  <div class="factor-control">
                    <input class="weight-slider" type="range" min="0" max="100" step="1"
                      [(ngModel)]="sourceScores[reason.key]" (ngModelChange)="onPriorityEdit()"
                      [attr.aria-label]="copy(reason.en+' priority slider',reason.ar+' شريط الأولوية')"/>
                    <div class="number-input">
                      <input type="number" min="0" max="100" step="1"
                        [(ngModel)]="sourceScores[reason.key]" (ngModelChange)="onPriorityEdit()"
                        [attr.aria-label]="copy(reason.en+' priority score',reason.ar+' درجة الأولوية')"/>
                      <span>/100</span>
                    </div>
                  </div>
                </div>
              </div>
              <p class="policy-note">{{copy('POC example values — not an officially approved regulatory targeting model. Any change requires a new impact preview and supervisor publication.',
                'قيم تجريبية للـPOC وليست نموذجًا تنظيميًا معتمدًا. أي تغيير يحتاج معاينة أثر جديدة ونشرًا معتمدًا من المشرف.')}}</p>
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
    .priority-settings{margin:20px 0;border:1px solid #dbe9eb;padding:0;border-radius:12px;
      background:#f9fcfb;overflow:hidden}
    .priority-section-head{display:flex;justify-content:space-between;align-items:flex-start;
      gap:18px;padding:18px 18px 15px;background:#f3f9f7}
    .section-kicker{display:block;font-size:10px;letter-spacing:.8px;font-weight:900;
      color:#0f766e;margin-bottom:8px}
    .priority-settings h3{font-size:15px;color:#18516b;margin:0 0 9px}
    .priority-settings p{font-size:11px;margin:0;line-height:1.65;color:#6b8592}
    .weight-total{background:#e8f7f1;border:1px solid #c8e8dc;border-radius:11px;
      padding:10px 14px;min-width:92px;text-align:center;flex:none}
    .weight-total small{display:block;font-size:9px;font-weight:900;color:#4e8475}
    .weight-total strong{display:block;margin-top:6px;color:#0f766e;font-size:25px}
    .weight-total.invalid{background:#fff1ee;border-color:#efc8c3}
    .weight-total.invalid strong{color:#ba453c}
    .risk-style-list{background:#fff}
    .risk-style-factor{display:grid;grid-template-columns:minmax(0,1fr) minmax(230px,1fr);
      align-items:center;gap:18px;padding:17px 18px;border-bottom:1px solid #ebf2f4}
    .factor-info{min-width:0}
    .factor-info strong{display:block;color:#21465b;font-size:12px;font-weight:850}
    .factor-info small{display:block;color:#7892a0;font-size:10px;line-height:1.5;margin-top:5px}
    .factor-control{display:grid;grid-template-columns:minmax(0,1fr) 86px;gap:13px;align-items:center}
    .factor-control input.weight-slider{width:100%;height:22px;min-width:0;display:block;
      accent-color:#0f766e;cursor:pointer;padding:0;border:0;margin:0;background:transparent;
      box-shadow:none;border-radius:0}
    .factor-control input.weight-slider:focus-visible{outline:2px solid #17a78a;outline-offset:3px}
    .number-input{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;
      border:1px solid #cbdde2;border-radius:9px;overflow:hidden;background:#fff}
    .number-input input[type="number"]{width:100%;min-width:0;height:39px;border:0;outline:0;
      padding:0 4px 0 10px;margin:0;background:transparent;text-align:center;
      color:#1a4a60;font-size:13px;font-weight:850}
    .number-input input[type="number"]:focus-visible{outline:2px solid #17a78a;outline-offset:-2px}
    .number-input span{font-size:10px;font-weight:750;color:#72909c;margin-inline-end:9px;white-space:nowrap}
    .weight-footer{display:flex;align-items:center;justify-content:space-between;gap:15px;
      flex-wrap:wrap;padding:12px 18px;background:#f7fbfa;border-bottom:1px solid #e4efeb}
    .normalize-btn{border:0;background:transparent;color:#087769;font-size:12px;
      font-weight:850;cursor:pointer;padding:7px 0;text-align:start}
    .normalize-btn:hover:not(:disabled){color:#045e54;text-decoration:underline}
    .weight-validation strong{font-size:11px;color:#0c7656}
    .weight-validation.invalid strong{color:#b63a2b}
    .priority-settings .policy-note{padding:13px 18px;color:#678392;background:#f9fcfb;
      font-size:11px;line-height:1.65}
    .reason-head{border-top:1px solid #dfebeb}
    .threshold-factor{border:1px solid #deebee;border-radius:10px;background:#f8fcfb;
      margin:16px 0 18px}
    @media(max-width:660px){
      .risk-style-factor{grid-template-columns:1fr;gap:12px;padding:15px}
      .priority-section-head{flex-wrap:wrap}
      .weight-total{margin-inline-start:auto}
      .factor-control{grid-template-columns:minmax(0,1fr) 92px}
    }
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
  readonly weightFactors:{
    key:keyof SiPriorityWeights;en:string;ar:string;hintEn:string;hintAr:string
  }[]=[
    {key:'risk',en:'Saved Vessel Risk',ar:'مخاطر السفينة المحفوظة',
      hintEn:'Weight given to an existing NMC risk assessment.',
      hintAr:'وزن تقييم المخاطر المحفوظ بالفعل في NMC.'},
    {key:'trigger',en:'Inspection Trigger',ar:'سبب ترشيح المعاينة',
      hintEn:'Importance of the actual event prompting review.',
      hintAr:'أهمية الحدث الفعلي الذي أدى للترشيح.'},
    {key:'history',en:'Inspection History',ar:'سجل المعاينات',
      hintEn:'Only verified historical inspection evidence is considered.',
      hintAr:'يُستخدم فقط سجل المعاينات الموثق عند توفره.'},
    {key:'deadline',en:'Inspection Deadline',ar:'موعد المعاينة',
      hintEn:'Timing and confirmed port arrival when available.',
      hintAr:'الوقت وموعد وصول السفينة عندما تتوفر البيانات.'},
    {key:'urgency',en:'Operational Urgency',ar:'الاستعجال التشغيلي',
      hintEn:'Documented operational urgency; missing inputs stay missing.',
      hintAr:'الاستعجال التشغيلي الموثق دون اختلاق بيانات ناقصة.'}
  ];
  readonly triggerReasons:{
    key:'NMC_CASE'|'SERVICE_REQUEST'|'PSC_PORT_CALL';
    en:string;ar:string;hintEn:string;hintAr:string
  }[]=[
    {key:'NMC_CASE',en:'NMC Approved Referral',ar:'إحالة NMC معتمدة',
      hintEn:'Direct, human-approved NMC source.',
      hintAr:'مصدر NMC المباشر بعد الاعتماد البشري.'},
    {key:'SERVICE_REQUEST',en:'Maritime Service Request',ar:'طلب خدمة بحرية',
      hintEn:'A service request imported from the dedicated Excel feed.',
      hintAr:'طلب خدمة مستورد من ملف Excel الخاص بالمصدر.'},
    {key:'PSC_PORT_CALL',en:'PSC Port Call',ar:'إخطار نداء ميناء PSC',
      hintEn:'PSC port-call event imported from its own Excel feed.',
      hintAr:'حدث وصول سفينة مستورد من ملف PSC المخصص.'}
  ];
  get weightsValid():boolean{
    return this.weightTotal===100 &&
      Object.values(this.weights).every(v=>Number.isInteger(Number(v))&&
        Number(v)>=0&&Number(v)<=100);
  }
  get canNormalize():boolean{
    return Object.values(this.weights).every(v=>Number.isFinite(Number(v))&&
      Number(v)>=0&&Number(v)<=100)&&this.weightTotal>0;
  }
  onPriorityEdit():void{this.impact=null;this.success='';this.error='';}
  normalizeWeights():void{
    if(!this.canNormalize)return;
    const keys:(keyof SiPriorityWeights)[]=['risk','trigger','history','deadline','urgency'];
    const total=this.weightTotal;
    const proportions=keys.map((key,index)=>{
      const exact=Number(this.weights[key])/total*100;
      return {key,index,integer:Math.floor(exact),fraction:exact-Math.floor(exact)};
    });
    let remainder=100-proportions.reduce((sum,x)=>sum+x.integer,0);
    const sorted=[...proportions].sort((a,b)=>b.fraction-a.fraction||a.index-b.index);
    for(let i=0;i<remainder;i++)sorted[i].integer++;
    for(const part of proportions)this.weights[part.key]=part.integer;
    this.onPriorityEdit();
  }

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
