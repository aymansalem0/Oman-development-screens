import {CommonModule} from '@angular/common';
import {Component,OnInit} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {RouterLink} from '@angular/router';
import {NmcNavigationComponent} from '../components/nmc-navigation.component';
import {LanguageService} from '../services/language.service';
import {SiCandidateTargetingService,SiDashboard,SiImpact,SiTargetingPolicyConfig} from '../services/si-candidate-targeting.service';

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
            <h1>{{copy('Inspection Execution Priority Rules','قواعد أولوية تنفيذ المعاينات')}}</h1>
            <p>{{copy('Only the three published source-trigger scores determine inspection planning priority. No risk thresholds, factor weights or official risk changes.',
              'ثلاث درجات مصادر فقط تحدد أولوية التخطيط؛ بدون حد مخاطر أو أوزان إضافية، ولا تتغير قواعد الأهلية والاعتماد وتقييم NMC.')}}</p>
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
          <article><small>{{copy('NMC APPROVED REFERRAL','إحالة NMC المعتمدة')}}</small><strong>{{sourceScores.NMC_CASE}}/100</strong></article>
          <article><small>{{copy('MARITIME SERVICE REQUEST','طلب الخدمة البحرية')}}</small><strong>{{sourceScores.SERVICE_REQUEST}}/100</strong></article>
          <article><small>{{copy('PSC PORT CALL','نداء ميناء PSC')}}</small><strong>{{sourceScores.PSC_PORT_CALL}}/100</strong></article>
        </section>
        <div class="form-grid">
          <section class="panel">
            <h2>{{copy('01 · Inspection Source Priority','٠١ · أولوية مصادر المعاينة')}}</h2>
            <p>{{copy('The only editable priority configuration is the score (0–100) for each source. Higher means earlier priority, not a percentage share. No 100% normalization, risk threshold or factor weighting.',
              'الإعداد الوحيد للأولوية هو درجة كل مصدر (٠–١٠٠). الدرجة الأعلى تعني أولوية أكبر وليست نسبة مئوية، ولا يوجد تطبيع أو حد للمخاطر أو أوزان عوامل أخرى.')}}</p>
            <div class="priority-settings">
              <div class="priority-section-head reason-head">
                <div>
                  <small class="section-kicker">{{copy('INSPECTION SOURCE TRIGGERS','أسباب ترشيح المعاينات')}}</small>
                  <h3>{{copy('Inspection Trigger Reason Priorities','أولويات أسباب ترشيح المعاينة')}}</h3>
                  <p>{{copy('Use only these published scores for C01 planning priority. All actionable Service Requests remain candidates even with low NMC risk. PSC first passes its separate quota/selection gate.',
                    'استخدم درجات المصادر المنشورة فقط في أولوية خطة C01. تدخل طلبات الخدمات المستوفية للشروط مهما كانت مخاطر NMC منخفضة، ويُطبق على PSC اختيار الحصة أولًا.')}}</p>
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
            
            <button class="primary" type="button" [disabled]="busy||!dashboard" (click)="preview()">
              {{copy('Preview Fleet Impact','معاينة أثر التغيير على الأسطول')}}
            </button>
            <div *ngIf="impact as p" class="impact">
              <strong>{{p.affectedCandidateCount}} {{copy('affected candidates','مرشح تأثر بالتغيير')}}</strong>
              <p>{{p.evaluatedPopulation}} {{copy('active vessels','سفينة نشطة')}} ·
                {{p.unevaluatedRiskVessels}} {{copy('without saved NMC risk','بدون تقييم مخاطر محفوظ')}}</p>
              <p *ngIf="p.aiSettingsChanged">
                <strong>{{p.potentialRankingCandidates}} {{copy('pending candidates may be reordered','مرشح مفتوح قد يتغير ترتيبه')}}</strong>
                · {{copy('Publishing does NOT call AI. Re-run SI-C01 explicitly on an editable draft to use the new priority scores.',
                  'النشر لا يشغّل AI؛ أعد تشغيل SI-C01 على مسودة قابلة للتعديل لتطبيق الدرجات الجديدة.')}}</p>
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
            
            <label>{{copy('Business justification','المبرر الإداري')}}
              <textarea [(ngModel)]="reason" rows="3" maxlength="500"></textarea>
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
    .priority-settings .policy-note{padding:13px 18px;color:#678392;background:#f9fcfb;
      font-size:11px;line-height:1.65}
    .reason-head{border-top:1px solid #dfebeb}
    @media(max-width:660px){
      .risk-style-factor{grid-template-columns:1fr;gap:12px;padding:15px}
      .priority-section-head{flex-wrap:wrap}
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
  reviewer='admin';reason='';editorKey='MOEI_SESSION';publisherKey='MOEI_SESSION';
  sourceScores={NMC_CASE:100,SERVICE_REQUEST:100,PSC_PORT_CALL:20};
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
  onPriorityEdit():void{this.impact=null;this.success='';this.error='';}
  private proposedConfig():SiTargetingPolicyConfig{
    return {sourceTriggerScores:{...this.sourceScores}};
  }
  constructor(private readonly api:SiCandidateTargetingService,public readonly lang:LanguageService){}
  copy(en:string,ar:string){return this.lang.pick(en,ar);}
  ngOnInit():void{this.refresh();}
  refresh():void{
    this.loading=true;this.error='';this.impact=null;
    this.api.dashboard().subscribe({
      next:d=>{this.dashboard=d;
        this.sourceScores={...(d.policy.config.sourceTriggerScores||
          d.policy.config.prioritization?.sourceTriggerScores||
          {NMC_CASE:100,SERVICE_REQUEST:100,PSC_PORT_CALL:20})};
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
        this.dashboard=d;
        this.sourceScores={...(d.policy.config.sourceTriggerScores||
          d.policy.config.prioritization?.sourceTriggerScores||
          {NMC_CASE:100,SERVICE_REQUEST:100,PSC_PORT_CALL:20})};
        this.impact=null;this.error='';
        this.success=this.copy('Priority rules published successfully','تم نشر قواعد الأولوية بنجاح');
      },
      error:e=>this.showError(e)
    });
  }
}
