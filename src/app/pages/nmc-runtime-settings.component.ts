import {CommonModule} from '@angular/common';
import {Component,OnInit} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {HttpClient,HttpHeaders} from '@angular/common/http';
import {RouterLink} from '@angular/router';
import {NmcNavigationComponent} from '../components/nmc-navigation.component';
import {NmcMinistryLogoComponent} from '../components/nmc-ministry-logo.component';
import {LanguageService} from '../services/language.service';

interface SettingDescriptor {
  key:string;type:'boolean'|'number'|'url'|'pipeline'|'choice';group:string;options?:string[];
  min?:number;max?:number;description:string;cost?:boolean;
}
interface AiriaCredentialStatus{
 provider:'AIRIA';configured:boolean;rotatable:boolean;
 source:string;valueExposed:false;note:string;
}
interface RuntimeSnapshot {
  status:'ok';version:number;
  values:Record<string,boolean|number|string>;
  defaults:Record<string,boolean|number|string>;
  descriptors:SettingDescriptor[];
  sources:Record<string,string>;
  updatedAt:string|null;updatedBy:string|null;
  secretsExposed:false;note:string;
}
@Component({
  selector:'app-nmc-runtime-settings',
  standalone:true,
  imports:[CommonModule,FormsModule,RouterLink,NmcNavigationComponent,NmcMinistryLogoComponent],
  template:`
  <div class="runtime-shell" [attr.dir]="lang.dir">
    <!-- Match the established MOEI/NMC 82px white maritime platform top bar.
         Unified sidebar starts directly BELOW this header at the same 82px offset. -->
    <header class="runtime-topbar">
      <div class="brand-block">
        <app-nmc-ministry-logo class="runtime-ministry-logo"></app-nmc-ministry-logo>
        <div class="brand-copy">
          <span class="eyebrow">{{tr('MOEI Maritime Unified Platform','المنصة البحرية الموحدة لوزارة الطاقة والبنية التحتية')}}</span>
          <h1>{{tr('AI Settings & Governance','إعدادات وحوكمة الذكاء الاصطناعي')}}</h1>
          <p>{{tr('Unified NMC + Smart Inspection AI configuration · pipelines, costs, security and human approvals',
                  'إعدادات موحدة لـNMC وSmart Inspection · الوكلاء والتكلفة والحوكمة والصلاحيات')}}</p>
        </div>
      </div>
      <div class="topbar-actions">
        <span class="admin-badge">✦ {{tr('AI Governance','حوكمة الذكاء الاصطناعي')}}</span>
        <a class="topbar-link" routerLink="/moei/nmc">
          {{tr('← Back to Command Center','العودة إلى مركز القيادة →')}}
        </a>
        <button type="button" class="language-btn" (click)="lang.toggle()"
                [attr.aria-label]="tr('Switch language','تغيير اللغة')">
          {{lang.isArabic?'English':'العربية'}}
        </button>
      </div>
    </header>
    <app-nmc-navigation></app-nmc-navigation>
    <main class="runtime-main">
      <div class="runtime-status">
        <div><span>{{tr('Active configuration','الإعدادات النشطة')}}</span>
          <b>{{snapshot?'Version '+snapshot.version:'—'}}</b>
          <small>{{snapshot?.updatedAt ? (snapshot?.updatedAt|date:'medium') : tr('Environment defaults','قيم البيئة الافتراضية')}}</small></div>
        <div><span>{{tr('Last published by','آخر ناشر')}}</span>
          <b>{{snapshot?.updatedBy||tr('System defaults','الإعدادات الافتراضية')}}</b>
          <small>{{tr('Publisher permissions required to save','يتطلب النشر صلاحيات المشرف')}}</small></div>
        <button class="outline" (click)="load()" [disabled]="loading||saving">↻ {{tr('Refresh','تحديث')}}</button>
      </div>
      <div class="banner alert" role="alert" *ngIf="error">{{error}}</div>
      <div class="banner success" role="status" *ngIf="success">{{success}}</div>
      <p *ngIf="loading">{{tr('Loading effective backend settings…','جارٍ تحميل إعدادات التشغيل الفعلية…')}}</p>
      <div class="runtime-info">
        <strong>{{tr('Safety & operating model','الأمان وطريقة التشغيل')}}</strong>
        <p>{{tr('All NMC and Smart Inspection AI agent IDs, activation switches, checklist Builder/Vision pipelines, image transport and usage limits are managed here and persisted as versioned backend overrides. Credentials can be rotated only in the encrypted write-only vault below. The model used inside an Airia pipeline is controlled by that Airia pipeline, not by a text field here. Paid runs and human-inspector decisions remain governed separately.',
                 'تدار هنا إعدادات وكلاء NMC وSmart Inspection ومعرفات Pipelines وطرق الصور وحدود الاستهلاك، مع سجل للإصدارات. يمكن تغيير مفتاح Airia فقط عبر مخزن الأسرار المشفر أدناه. نموذج الذكاء المستخدم يُحدد داخل Airia نفسه. التشغيل المدفوع والقرارات المؤثرة يحتاجان ضوابط وموافقة بشرية.')}}</p>
      </div>
      <ng-container *ngIf="snapshot">
        <section *ngFor="let group of groups" class="group-card">
          <div class="group-title">
            <span class="group-icon">{{icon(group)}}</span>
            <div><h2>{{groupLabel(group)}}</h2>
              <p>{{groupDescription(group)}}</p></div>
          </div>
          <div class="settings-grid">
            <article class="setting-row" *ngFor="let item of byGroup(group)">
              <div class="setting-heading">
                <div><code>{{item.key}}</code>
                  <p>{{item.description}}</p></div>
                <span class="source-tag" [class.override]="snapshot.sources[item.key]==='RUNTIME_OVERRIDE'">
                  {{snapshot.sources[item.key]==='RUNTIME_OVERRIDE'?'RUNTIME':'ENV'}}</span>
              </div>
              <div class="setting-input">
                <label *ngIf="item.type==='boolean'" class="switch-row">
                  <input type="checkbox" [ngModel]="draft[item.key]"
                         (ngModelChange)="draft[item.key]=$event"/>
                  <strong [class.enabled]="draft[item.key]">{{draft[item.key]?
                    tr('Enabled','مفعّل'):tr('Disabled','معطّل')}}</strong>
                </label>
                <ng-container *ngIf="item.type==='number'">
                  <input type="number" [min]="item.min ?? null" [max]="item.max ?? null"
                    [ngModel]="draft[item.key]" (ngModelChange)="draft[item.key]=+$event"/>
                  <small>{{tr('Allowed range','النطاق المسموح')}}: {{item.min}}–{{item.max}}</small>
                </ng-container>
                <ng-container *ngIf="item.type==='url'">
                  <input class="url-field" type="url"
                     [ngModel]="draft[item.key]"
                     (ngModelChange)="draft[item.key]=$event"/>
                  <small>https://api.mena.airia.ai / https://mena.api.airia.ai</small>
                </ng-container>
                <ng-container *ngIf="item.type==='pipeline'">
                  <input class="url-field" type="text" spellcheck="false"
                    [attr.aria-label]="item.description" [ngModel]="draft[item.key]"
                    (ngModelChange)="draft[item.key]=$event"
                    placeholder="Airia Pipeline UUID — leave blank if not verified"/>
                  <small>{{tr('Use a real pipeline ID. A01–A04 default IDs follow the partner guide; Builder/Vision output contracts must be tested before activation.',
                   'استخدم المعرف الحقيقي. قيم A01–A04 من دليل Airia، ويجب اختبار مخرجات Builder وVision قبل التفعيل.')}}</small>
                  <button class="restore" type="button"
                    *ngIf="item.key==='AIRIA_SI_CHECKLIST_VISION_PIPELINE_ID'"
                    (click)="selectKnownAgent('vision')">
                    {{tr('Use existing A04 as Vision candidate','استخدام A04 الحالي كمرشح لتحليل الصور')}}</button>
                  <button class="restore" type="button"
                    *ngIf="item.key==='AIRIA_SI_CHECKLIST_BUILDER_PIPELINE_ID'"
                    (click)="selectKnownAgent('builder')">
                    {{tr('Use existing Conversational SI as Builder candidate',
                      'استخدام المساعد الحواري الحالي كمرشح لإنشاء القوائم')}}</button>
                </ng-container>
                <ng-container *ngIf="item.type==='choice'">
                  <select [ngModel]="draft[item.key]" (ngModelChange)="draft[item.key]=$event">
                    <option *ngFor="let choice of item.options" [value]="choice">{{choice}}</option>
                  </select>
                </ng-container>
                <span class="paid" *ngIf="item.cost">● {{tr('AI invocation · operator confirmation','استدعاء AI · يتطلب تأكيد المستخدم')}}</span>
                <button type="button" class="restore" (click)="draft[item.key]=snapshot.defaults[item.key]">
                  {{tr('Use ENV default','استعادة قيمة ENV')}}</button>
              </div>
            </article>
          </div>
        </section>
        <section class="publish-card">
          <h2>{{tr('AI Governance Controls · Always Enforced',
            'ضوابط حوكمة الذكاء الاصطناعي · إلزامية دائمًا')}}</h2>
          <div class="governance-grid">
            <span>✓ {{tr('Human approval for inspection cases, checklists and AI recommendations',
              'اعتماد بشري للحالات والقوائم وتوصيات الذكاء الاصطناعي')}}</span>
            <span>✓ {{tr('AI never overwrites deterministic official risk or statutory checks',
              'الذكاء الاصطناعي لا يغير التقييم الرسمي للمخاطر أو البنود النظامية')}}</span>
            <span>✓ {{tr('Paid calls require deliberate confirmation; no AI on GET',
              'لا تُنفذ المكالمات المدفوعة دون تأكيد؛ ولا تشغيل AI عند فتح الشاشة')}}</span>
            <span>✓ {{tr('Source evidence, inspector decisions and setting revisions audited',
              'تدقيق الأدلة وقرارات المفتش وإصدارات الإعدادات')}}</span>
          </div>
          <p class="governance-hint">{{tr('A01–A04 pipeline IDs are sourced from the 8 October 2026 Airia Partner Guide. Existing Conversational Smart Inspection may be evaluated as a Builder, but prose is not a validated checklist JSON contract.',
            'معرفات A01–A04 مأخوذة من دليل Airia بتاريخ ٨ أكتوبر ٢٠٢٦. يمكن تقييم المساعد الحواري كمرشح لـBuilder، لكن النص الحواري ليس نموذج JSON معتمدًا للقائمة.')}}</p>
        </section>
        <section class="publish-card">
          <h2>{{tr('Airia API Key · Encrypted Credential Governance','مفتاح Airia · إدارة الأسرار المشفرة')}}</h2>
          <p>{{tr('The saved key is NEVER shown. Rotation is separate from pipeline settings and requires Admin, an audit reason, explicit approval and a host-provisioned encryption master key.',
           'لا يتم عرض المفتاح المخزن مطلقًا. تغييره يتطلب صلاحية Admin وسببًا موثقًا وموافقة صريحة ومفتاح تشفير على الخادم.')}}</p>
          <div class="credential-status" *ngIf="credentialStatus">
            <strong>{{credentialStatus.configured?tr('API key configured','مفتاح API مُجهز'):
              tr('API key not configured','مفتاح API غير مُجهز')}}</strong>
            <small>{{tr('Source','المصدر')}}: {{credentialStatus.source}}</small>
            <small *ngIf="!credentialStatus.rotatable">{{credentialStatus.note}}</small>
          </div>
          <label>{{tr('Replace Airia API Key (write-only)','استبدال مفتاح Airia API (كتابة فقط)')}}
            <input [(ngModel)]="newApiKey" type="password" autocomplete="new-password"
              [disabled]="!credentialStatus?.rotatable" maxlength="2048"
              [placeholder]="tr('Enter replacement key; existing key never displayed',
               'اكتب المفتاح البديل؛ لن يتم عرض المفتاح الحالي')"/></label>
          <label>{{tr('Credential rotation reason','سبب تغيير المفتاح')}}
            <input [(ngModel)]="credentialReason" maxlength="500"
              [disabled]="!credentialStatus?.rotatable"/></label>
          <div class="publish-actions">
            <button class="primary" type="button" (click)="rotateKey()"
             [disabled]="credentialSaving||!credentialStatus?.rotatable||newApiKey.trim().length<16||credentialReason.trim().length<8">
             {{credentialSaving?tr('Saving securely…','جارٍ الحفظ المشفر…'):
              tr('Rotate API Key Securely','تغيير مفتاح API بأمان')}}</button>
          </div>
        </section>
        <section class="publish-card">
          <h2>{{tr('Publish runtime settings','نشر إعدادات التشغيل')}}</h2>
          <p>{{tr('Publish only after reviewing agent usage, scheduler vessel limits and the Airia endpoint. The logged Admin session is used for approval, and no extra key is required.',
                   'انشر بعد مراجعة تكلفة الوكلاء وحدود السفن المجدولة وعنوان Airia. يُستخدم تسجيل دخول المدير الموحد للاعتماد دون إدخال مفتاح إضافي.')}}</p>
          <div class="publish-form">

            <label>{{tr('Change reason (min. 8 characters)','سبب التعديل (8 أحرف على الأقل)')}}
              <input [(ngModel)]="reason" maxlength="500"/></label>
          </div>
          <div class="publish-actions">
            <button class="outline" (click)="reset()" [disabled]="saving">{{tr('Discard edits','إلغاء التعديلات')}}</button>
            <button class="primary" (click)="publish()"
              [disabled]="saving||!changed||actor.trim().length<3||reason.trim().length<8">
              {{saving?tr('Publishing…','جارٍ النشر…'):tr('Publish to backend','نشر الإعدادات على الخادم')}}
            </button>
          </div>
        </section>
      </ng-container>
    </main>
  </div>
  `,
  styles:[`
    :host{display:block;position:fixed;inset:0;z-index:10000;overflow:auto;
      color:#17324d;font-family:Inter,"Segoe UI",Tahoma,Arial,sans-serif}
    *{box-sizing:border-box}
    .runtime-shell{min-height:100vh;background:radial-gradient(circle at 85% 6%,rgba(14,165,233,.05),transparent 23%),
      linear-gradient(180deg,#f8fbfd 0%,#f2f7fa 100%);color:#17324d}
    .runtime-topbar{position:fixed;inset:0 0 auto 0;height:82px;z-index:40;
      display:flex;align-items:center;justify-content:space-between;gap:20px;padding:0 24px;
      background:rgba(255,255,255,.97);border-bottom:1px solid #e6edf3;
      box-shadow:0 4px 18px rgba(23,50,77,.05);backdrop-filter:blur(14px)}
    .brand-block{display:flex;align-items:center;gap:13px;min-width:0}
    .runtime-ministry-logo{flex-shrink:0}
    .brand-block{max-width:min(100%,760px)}
    .brand-copy{min-width:0}
    .eyebrow{display:block;color:#0f766e;font-size:9px;font-weight:800;
      letter-spacing:1.2px;text-transform:uppercase;line-height:1.3}
    .brand-copy h1{margin:3px 0 0;color:#17324d;font-size:18px;line-height:1.3;font-weight:750}
    .brand-copy p{margin:3px 0 0;color:#8191a4;font-size:10px;line-height:1.3}
    .topbar-actions{display:flex;align-items:center;justify-content:flex-end;gap:10px;flex-shrink:0}
    .admin-badge{display:inline-flex;align-items:center;gap:6px;padding:9px 12px;
      border:1px solid #ccefe8;border-radius:999px;background:#ecfdf9;
      color:#0f766e;font-size:10px;font-weight:800;white-space:nowrap}
    .topbar-link,.language-btn{display:inline-flex;align-items:center;justify-content:center;
      min-height:36px;border:1px solid #dce5ed;border-radius:10px;
      background:#fff;color:#52687b;font-size:10px;font-weight:750;
      padding:0 12px;text-decoration:none;white-space:nowrap;cursor:pointer}
    .language-btn{border-color:#cfe5e2;background:#f1faf8;color:#0f766e}
    .topbar-link:hover,.language-btn:hover{border-color:#9fd9d2;background:#effbf8;color:#0f766e}
    .group-icon{display:grid;place-items:center;border-radius:12px}
    /* Match the unified fixed navigation: 82px top bar, 240px desktop sidebar. */
    .runtime-main{margin-inline-start:240px;width:calc(100% - 240px);
      padding:106px 28px 44px;max-width:none}
    .runtime-status{display:flex;align-items:center;gap:30px;flex-wrap:wrap;background:white;border:1px solid #dce6eb;padding:20px 26px;border-radius:14px}
    .runtime-status>div{display:flex;flex-direction:column;gap:7px;flex:1}
    .runtime-status span{font-size:10px;text-transform:uppercase;color:#607f90;font-weight:700}
    .runtime-status b{font-size:15px}.runtime-status small{font-size:10px;color:#8198a6}
    .runtime-status>button{margin-inline-start:auto}
    .runtime-info{background:#eaf6f4;border-inline-start:4px solid #0e9a90;padding:18px;border-radius:11px;margin:19px 0}
    .runtime-info strong{font-size:12px}.runtime-info p{line-height:1.8;font-size:11px;margin:7px 0 0;color:#4b7078}
    .group-card,.publish-card{background:white;border:1px solid #dee9ed;border-radius:15px;margin-top:20px;padding:23px}
    .group-title{display:flex;gap:12px;align-items:center;padding-bottom:17px;border-bottom:1px solid #e8eff2}
    .group-icon{width:46px;height:46px;color:#057d80;background:#e9f7f5;font-size:24px}
    .group-title h2,.publish-card h2{font-size:17px;margin:0;color:#173d54}
    .group-title p,.publish-card p{font-size:11px;color:#738995;line-height:1.7;margin:7px 0}
    .settings-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;margin-top:18px}
    .setting-row{padding:16px;border:1px solid #e4edf0;border-radius:10px;background:#fbfdfd}
    .setting-heading{display:flex;justify-content:space-between;gap:6px;align-items:start}
    .setting-heading code{font-size:11px;font-weight:800;overflow-wrap:anywhere;color:#1c6876}
    .setting-heading p{font-size:11px;color:#6d8794;margin:8px 0 14px}
    .source-tag{background:#eff3f6;color:#788e9c;font-size:9px;font-weight:800;border-radius:30px;padding:4px 9px;white-space:nowrap}
    .source-tag.override{color:#167b62;background:#e5f6ee}
    .setting-input{display:flex;gap:12px;align-items:center;flex-wrap:wrap}
    .setting-input input:not([type=checkbox]),.publish-form input{border:1px solid #cbdae2;border-radius:8px;padding:10px 12px;color:#164055;min-width:125px}
    .setting-input .url-field{width:100%;min-width:0}
    .setting-input small{font-size:10px;color:#76919d}
    .switch-row{display:flex;align-items:center;gap:9px;font-size:11px;cursor:pointer}
    .switch-row input{width:18px;height:18px;accent-color:#079588}
    .switch-row strong{color:#8b99a2}.switch-row strong.enabled{color:#008376}
    .paid{font-size:10px;color:#ac6c20;background:#fdf4e5;border-radius:8px;padding:6px}
    .restore{margin-inline-start:auto;background:none;color:#257d82;border:0;font-size:10px;cursor:pointer}
    .publish-form{display:flex;gap:15px;flex-wrap:wrap;margin:18px 0}
    .publish-form label{display:flex;flex-direction:column;gap:7px;font-size:11px;font-weight:800;flex:1;min-width:230px}
    .publish-actions{display:flex;gap:12px;justify-content:flex-end}
    button.primary,.outline{border-radius:8px;padding:10px 16px;cursor:pointer;font-weight:750;font-size:12px}
    button.primary{background:#078a83;color:white;border:1px solid #078a83}
    .outline{background:transparent;color:#186c77;border:1px solid #a8c7cf}
    button:disabled{opacity:.45;cursor:not-allowed}
    .banner{padding:13px;border-radius:9px;margin:15px 0;font-size:12px}
    .governance-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin:15px 0}
    .governance-grid span{background:#eef9f6;padding:12px;border-radius:9px;font-size:12px;color:#0b675f}
    .governance-hint{font-size:11px;color:#66828c;line-height:1.7}
    .credential-status{display:flex;gap:18px;align-items:center;flex-wrap:wrap;margin:16px 0;color:#126d63;font-size:12px}
    .credential-status small{color:#658190}
    select{width:100%;padding:10px;border:1px solid #bfdae0;border-radius:8px}
    @media(max-width:850px){.governance-grid{grid-template-columns:1fr}}
    .banner.alert{color:#a54930;background:#fff0ec}.banner.success{color:#23774d;background:#e6f7ee}
    @media (min-width:961px) and (max-width:1220px){
      .runtime-main{margin-inline-start:66px;width:calc(100% - 66px);padding-inline:20px}
      .admin-badge{display:none}
    }
    @media(max-width:960px){
      .runtime-main{margin-inline-start:0;width:100%;padding:142px 18px 32px}
      .settings-grid{grid-template-columns:1fr}
      .runtime-status{gap:15px}
      .admin-badge{display:none}
    }
    @media(max-width:650px){
      .runtime-topbar{padding:0 12px;gap:8px}
      .brand-copy{max-width:220px}
      .brand-block{gap:8px}
      .brand-copy h1{font-size:13px}
      .brand-copy p{display:none}
      .eyebrow{font-size:7px;letter-spacing:.5px}
      .topbar-actions{gap:5px}
      .topbar-link{display:none}
      .language-btn{min-height:32px;padding:0 8px;font-size:9px}
      .runtime-status{padding:16px}
      .group-card,.publish-card{padding:16px}
    }
  `]
})
export class NmcRuntimeSettingsComponent implements OnInit{
  snapshot:RuntimeSnapshot|null=null;
  draft:Record<string,boolean|number|string>={};
  groups=['agents','pipelines','checklist','scheduler','alerts','connectivity'];
  credentialStatus:AiriaCredentialStatus|null=null;
  newApiKey='';credentialReason='';credentialSaving=false;
  actor='admin';reason='';error='';success='';loading=false;saving=false;
  constructor(private readonly http:HttpClient,public lang:LanguageService){}
  tr(en:string,ar:string){return this.lang.pick(en,ar);}
  ngOnInit(){this.load();this.loadCredentialStatus();}
  load(){
    this.loading=true;this.error='';
    this.http.get<RuntimeSnapshot>('/api/ai/admin/runtime-settings').subscribe({
      next:r=>{this.snapshot=r;this.draft={...r.values};this.loading=false;},
      error:e=>{this.loading=false;this.error=this.tr('Unable to read runtime settings: ','تعذر تحميل الإعدادات: ')+(e?.error?.error||e?.status||'UNKNOWN');}
    });
  }
  get changed():boolean{
    if(!this.snapshot)return false;
    return this.snapshot.descriptors.some(d=>this.draft[d.key]!==this.snapshot?.values[d.key]);
  }
  byGroup(g:string){return this.snapshot?.descriptors.filter(d=>d.group===g)||[];}
  icon(g:string){return ({agents:'✦',pipelines:'⛓',checklist:'☑',scheduler:'◷',alerts:'♢',connectivity:'⛓'} as Record<string,string>)[g]||'⚙';}
  groupLabel(g:string){
    const s:Record<string,[string,string]>={
      agents:['AI Agents & Orchestration','وكلاء الذكاء الاصطناعي وتنسيق التشغيل'],
      pipelines:['Airia Pipeline Registry','سجل مسارات Airia'],
      checklist:['Smart Inspection Checklist AI','الذكاء الاصطناعي لقوائم المعاينة'],
      scheduler:['Fleet Assessment Scheduler','جدولة تقييم مخاطر السفن'],
      alerts:['Alerts & Escalation','التنبيهات والتصعيد'],
      connectivity:['Airia Connectivity','الاتصال بخدمة Airia']
    };
    return this.tr(s[g][0],s[g][1]);
  }
  groupDescription(g:string){
    const s:Record<string,[string,string]>={
      agents:['Enable/disable A01, A02, A03, A04 and P01.','تفعيل وإيقاف A01 وA02 وA03 وA04 وP01.'],
      pipelines:['Map real A01/A02/A03/A04 and C01/P01 Airia agent IDs.','ربط المعرفات الحقيقية لوكلاء A01–A04 وC01/P01.'],
      checklist:['Configure Checklist Builder, Vision/Review, image transport, cost and per-case AI usage.','تهيئة مساعد إنشاء القوائم وتحليل الصور وطريقة الرفع وحدود الاستخدام.'],
      scheduler:['Pilot vessel limit, retry and periodic execution.','حدود السفن التجريبية وإعادة المحاولة والتشغيل الدوري.'],
      alerts:['Detection interval and unacknowledged-event escalation.','دورية فحص التنبيهات والتصعيد عند عدم الاستجابة.'],
      connectivity:['Allowlisted secure Airia endpoint; API key remains a server secret.','عنوان Airia آمن ومحدد مسبقًا؛ مفتاح API محفوظ كسر على الخادم.']
    };
    return this.tr(s[g][0],s[g][1]);
  }
  loadCredentialStatus():void{
    this.http.get<AiriaCredentialStatus>('/api/ai/admin/governance/credentials')
      .subscribe({next:x=>this.credentialStatus=x,
        error:()=>this.credentialStatus=null});
  }
  rotateKey():void{
    if(this.credentialSaving||!this.credentialStatus?.rotatable||
      this.newApiKey.trim().length<16||this.credentialReason.trim().length<8)return;
    if(!window.confirm(this.tr(
      'Rotate Airia API key? Active NMC and Smart Inspection requests will use the new key immediately.',
      'هل تؤكد تغيير مفتاح Airia؟ ستستخدم خدمات NMC والمعاينات المفتاح الجديد فورًا.')))return;
    this.credentialSaving=true;this.error='';this.success='';
    this.http.post<AiriaCredentialStatus>('/api/ai/admin/governance/credentials',{
      apiKey:this.newApiKey.trim(),reason:this.credentialReason.trim(),confirm:true
    }).subscribe({next:status=>{
      this.credentialSaving=false;this.newApiKey='';this.credentialReason='';
      this.credentialStatus=status;
      this.success=this.tr('Airia API key securely rotated; no secret was displayed.',
        'تم تغيير مفتاح Airia وحفظه مشفرًا دون عرض قيمته.');
    },error:e=>{this.credentialSaving=false;this.newApiKey='';
      this.error=e?.error?.error||'AI_CREDENTIAL_ROTATION_FAILED';}});
  }
  selectKnownAgent(which:'builder'|'vision'):void{
    if(!this.snapshot)return;
    const key=which==='builder'?'AIRIA_SI_CHECKLIST_BUILDER_PIPELINE_ID':
      'AIRIA_SI_CHECKLIST_VISION_PIPELINE_ID';
    const from=which==='builder'?'AIRIA_CONVERSATIONAL_SI_PIPELINE_ID':
      'AIRIA_A04_PIPELINE_ID';
    if(!window.confirm(this.tr(
      'Reuse this existing Airia pipeline as a TEST CANDIDATE only. Its typed checklist JSON contract must be verified with an actual controlled request before activation.',
      'هل تريد ربط المسار الموجود كمرشح للاختبار فقط؟ يجب التحقق من توافق مخرجات JSON مع قوائم الفحص قبل تفعيل التشغيل.')))return;
    this.draft[key]=this.draft[from];
    this.draft['SI_CHECKLIST_AIRIA_ENABLED']=false;
    this.success=this.tr(
      'Candidate pipeline mapped; checklist Airia remains OFF until the output contract is verified.',
      'تم ربط المسار المرشح، وسيظل AI الخاص بالقوائم متوقفًا حتى اختبار شكل المخرجات.');
  }
  reset(){if(this.snapshot){this.draft={...this.snapshot.values};this.error='';this.success='';}}
  publish(){
    if(!this.snapshot||!this.changed||this.saving)return;
    const docAuto=this.draft['NMC_A03_AUTO_ENABLED'];
    if(docAuto===true&&this.draft['NMC_A03_ENABLED']!==true){
      this.error=this.tr('Enable A03 before enabling automatic A03.','فعّل A03 أولًا قبل تشغيله التلقائي.');return;
    }
    const auto=this.draft['NMC_FLEET_AUTO_ENABLED'];
    if(auto===true&&(this.draft['NMC_A01_ENABLED']!==true||this.draft['NMC_A02_ENABLED']!==true)){
      this.error=this.tr('Fleet auto mode requires A01 and A02.','التشغيل التلقائي للسفن يتطلب تفعيل A01 وA02.');return;
    }
    const keys=this.snapshot.descriptors.filter(d=>d.cost&&
      this.draft[d.key]===true&&this.snapshot?.values[d.key]!==true).map(x=>x.key);
    const urlChanged=this.draft['AIRIA_BASE_URL']!==this.snapshot.values['AIRIA_BASE_URL'];
    const risky=keys.length>0||urlChanged||
      this.draft['SI_AI_PROVIDER']!==this.snapshot.values['SI_AI_PROVIDER']||
      (this.draft['SI_CHECKLIST_AIRIA_ENABLED']===true&&
      ['AIRIA_SI_CHECKLIST_BUILDER_PIPELINE_ID','AIRIA_SI_CHECKLIST_VISION_PIPELINE_ID',
       'SI_CHECKLIST_VISION_TRANSPORT'].some(k=>this.draft[k]!==this.snapshot?.values[k]));
    if(!window.confirm(this.tr(
      'Publish live backend configuration? '+(risky?'New paid AI/endpoint settings: '+keys.join(', ')+(urlChanged?' AIRIA_BASE_URL':'')+'. ':'')+
      'This may trigger paid fleet/A03 work when automatic options are enabled.',
      'هل تريد نشر إعدادات الخادم؟ '+(risky?'تغيير قد يؤدي إلى استدعاءات AI مدفوعة أو عنوان اتصال جديد. ':'')+
      'قد يبدأ التقييم التلقائي المدفوع بعد النشر.'
    )))return;
    const accessKey='MOEI_SESSION';
    if(!accessKey)return;
    this.saving=true;this.error='';this.success='';
    const body={expectedVersion:this.snapshot.version,values:{...this.draft},
      actor:this.actor.trim(),reason:this.reason.trim(),confirmCost:true};
    this.http.put<RuntimeSnapshot>('/api/ai/admin/runtime-settings',body,{
      headers:new HttpHeaders({'X-NMC-DASHBOARD-KEY':accessKey})
    }).subscribe({
      next:r=>{this.snapshot=r;this.draft={...r.values};this.saving=false;this.reason='';
        this.success=this.tr('Configuration published and applied. Version ','تم نشر الإعدادات وتطبيقها. الإصدار ')+r.version;},
      error:e=>{this.saving=false;
        this.error=this.tr('Publish rejected: ','تم رفض النشر: ')+(e?.error?.error||e?.status||'UNKNOWN');
        if(e?.status===409)this.load();}
    });
  }
}
