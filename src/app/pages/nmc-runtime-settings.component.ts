import {CommonModule} from '@angular/common';
import {DomSanitizer,SafeResourceUrl} from '@angular/platform-browser';
import {Component,OnInit} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {HttpClient,HttpHeaders} from '@angular/common/http';
import {RouterLink} from '@angular/router';
import {NmcNavigationComponent} from '../components/nmc-navigation.component';
import {NmcMinistryLogoComponent} from '../components/nmc-ministry-logo.component';
import {LanguageService} from '../services/language.service';

interface SettingDescriptor {
  key:string;type:'boolean'|'number'|'url'|'pipeline'|'choice'|'ui-template';group:string;options?:string[];
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
/** Each backend runtime descriptor appears under exactly one governed section.
 * UI ownership only: no changes to stored setting keys, values, secrets or APIs.
 */
export const AI_GOVERNANCE_SECTIONS=[
 {id:'agent-a01',en:'NMC A01 · Maritime Intelligence',ar:'NMC A01 · الاستخبارات البحرية',keys:['NMC_A01_ENABLED','AIRIA_A01_PIPELINE_ID'],desc:'Situation intelligence · evidence and risk advice only'},
 {id:'agent-a02',en:'NMC A02 · Vessel Compliance',ar:'NMC A02 · امتثال السفن',keys:['NMC_A02_ENABLED','AIRIA_A02_PIPELINE_ID'],desc:'Compliance factors · deterministic official risk'},
 {id:'agent-a03',en:'NMC A03 · Document Intelligence',ar:'NMC A03 · ذكاء الوثائق',keys:['NMC_A03_ENABLED','AIRIA_A03_PIPELINE_ID','AIRIA_A03_TRANSPORT','NMC_A03_AUTO_ENABLED'],desc:'Document extraction · media transport and auto-run'},
 {id:'agent-a04',en:'SI-A04 · Dossier & Checklist Preparation',ar:'SI-A04 · تجهيز الدوسيه وقوائم المعاينة',keys:['SI_A04_ENABLED','AIRIA_A04_PIPELINE_ID'],desc:'Advisory scope · optional checklist items only'},
 {id:'agent-dq01',en:'NMC DQ-01 · Data Quality',ar:'NMC DQ-01 · جودة البيانات',keys:['NMC_DQ01_ENABLED','AIRIA_NMC_DQ01_PIPELINE_ID'],desc:'Factor signals · never calculates final quality score'},
 {id:'agent-c01',en:'SI-C01 · Candidate Selection & Priority',ar:'SI-C01 · اختيار السفن والأولوية',keys:['SI_C01_ENABLED','AIRIA_SI_C01_PIPELINE_ID'],desc:'Pre-approval source-grounded selection · supervisor confirmation'},
 {id:'agent-p01',en:'SI-P01 · Approved Case Priority (Retired)',ar:'SI-P01 · أولوية الحالات المعتمدة (متوقف)',keys:['SI_P01_ENABLED','AIRIA_SI_P01_PIPELINE_ID'],desc:'Historical only · no current POC activation'},
 {id:'agent-s01',en:'SI-S01 · Inspection Scheduling',ar:'SI-S01 · جدولة المعاينات',keys:['SI_S01_ENABLED','AIRIA_SI_S01_PIPELINE_ID'],desc:'Ranks only feasible ERP slots · never books'},
 {id:'agent-v01',en:'SI-V01 · Field Evidence Vision',ar:'SI-V01 · تحليل الصور والأدلة الميدانية',keys:['SI_V01_ENABLED','AIRIA_SI_V01_PIPELINE_ID'],desc:'Candidate findings only · inspector confirmation'},
 {id:'agent-r01',en:'SI-R01 · Report & CAPA Draft',ar:'SI-R01 · مسودة التقرير والإجراءات التصحيحية',keys:['SI_R01_ENABLED','AIRIA_SI_R01_PIPELINE_ID'],desc:'Confirmed findings only · supervisor signs report'},
 {id:'agent-x01',en:'SI-X01 · Repeat Deficiency & Conflicts',ar:'SI-X01 · تكرار العيوب وتعارض الأدلة',keys:['SI_X01_ENABLED','AIRIA_SI_X01_PIPELINE_ID'],desc:'Repeat and conflict advisory · human verification'},
 {id:'agent-checklist-builder',en:'Checklist Builder · AI Assistant',ar:'مساعد الذكاء لإنشاء قوائم المعاينة',keys:['SI_CHECKLIST_AIRIA_ENABLED','AIRIA_SI_CHECKLIST_BUILDER_PIPELINE_ID','SI_CHECKLIST_AI_MAX_CALLS_PER_CASE'],desc:'Controlled opt-in checklist design and per-case budget'},
 {id:'agent-checklist-vision',en:'Checklist Vision · Inspector Review',ar:'مساعد تحليل صور بنود المعاينة',keys:['AIRIA_SI_CHECKLIST_VISION_PIPELINE_ID','SI_CHECKLIST_VISION_TRANSPORT'],desc:'Shares Checklist AI enable switch above · evidence review'},
 {id:'agent-conversational-si',en:'Conversational Smart Inspection',ar:'المساعد الحواري للمعاينة الذكية',keys:['AIRIA_CONVERSATIONAL_SI_PIPELINE_ID'],desc:'Prose-only catalogue · not a structured SI agent'},
 {id:'agent-nmc-desk',en:'NMC Situational Desk',ar:'مساعد المركز البحري الوطني',keys:['AIRIA_NMC_DESK_PIPELINE_ID'],desc:'Conversational operator assistant'},
 {id:'agent-dashboard-designer',en:'NMC Dashboard AI Designer',ar:'مصمم لوحات المعلومات بالذكاء الاصطناعي',keys:['NMC_DASHBOARD_AI_DESIGN_ENABLED'],desc:'On-demand AI blueprint from catalog metrics and source-aware novel KPI proposals; explicit cost confirmation'},
 {id:'agent-sdb',en:'SDB Journey · Seafarer',ar:'مساعد رحلة دفتر البحار',keys:['AIRIA_SDB_JOURNEY_PIPELINE_ID'],desc:'Conversational service journey'},
 {id:'platform-orchestration',en:'Platform · Orchestration & Providers',ar:'المنصة · التنسيق ومزود الذكاء',keys:['SI_AI_PROVIDER','NMC_DASHBOARD_AI_FOCUS_ENABLED'],desc:'Shared settings · not a separate agent'},
 {id:'platform-fleet',en:'Platform · Fleet Assessment Schedule',ar:'المنصة · جدولة تقييم الأسطول',keys:['NMC_FLEET_AUTO_ENABLED','NMC_FLEET_AUTO_MAX_VESSELS','NMC_FLEET_AUTO_RETRY_FAILED','NMC_FLEET_REFRESH_SECONDS'],desc:'Background cost and vessel limits'},
 {id:'platform-alerts',en:'Platform · Alerts & Escalation',ar:'المنصة · التنبيهات والتصعيد',keys:['NMC_ALERT_SCAN_ENABLED','NMC_ALERT_SCAN_SECONDS','NMC_ALERT_ESCALATE_MINUTES'],desc:'Saved risk alerts and incident escalation'},
 {id:'platform-connectivity',en:'Platform · Airia Connection',ar:'المنصة · اتصال Airia',keys:['AIRIA_BASE_URL','AIRIA_CONSOLE_PIPELINE_URL_TEMPLATE','AIRIA_TIMEOUT_MS'],desc:'Shared endpoint / timeout; credentials are below'}
] as const;
export function auditAiGovernanceGrouping(descriptors:ReadonlyArray<{key:string}>):string[]{
 const names=AI_GOVERNANCE_SECTIONS.flatMap(s=>[...s.keys]);
 return descriptors.map(d=>d.key).filter(k=>names.filter(n=>n===k).length!==1)
  .concat([...new Set(names)].filter(k=>!descriptors.some(d=>d.key===k)));
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
        <div class="agent-directory">
          <strong>{{tr('Agentic AI configuration','إعدادات وكلاء الذكاء الاصطناعي')}}</strong>
          <p>{{tr('Each agent has its own section and its own currently saved settings. Open a heading to edit; publish remains one audited operation.',
            'كل وكيل له قسم مستقل يحتوي على إعداداته المحفوظة. افتح اسم الوكيل للتعديل ثم انشر جميع التغييرات في عملية موثقة واحدة.')}}</p>
        </div>
        <details *ngFor="let group of groups" class="group-card agent-accordion"
          [open]="group==='agent-c01'">
          <summary class="group-title">
            <span class="group-icon">{{group.startsWith('agent-')?'✦':'⚙'}}</span>
            <div><h2>{{groupLabel(group)}}</h2>
              <p>{{groupDescription(group)}}</p>
              <small class="group-count">{{byGroup(group).length}} {{tr('settings','إعدادات')}}</small></div>
            <span class="agent-chevron" aria-hidden="true">⌄</span>
          </summary>
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
                         [disabled]="item.key==='SI_P01_ENABLED'"
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
                <ng-container *ngIf="item.type==='ui-template'">
                  <input class="url-field" type="text" spellcheck="false"
                    [ngModel]="draft[item.key]" (ngModelChange)="draft[item.key]=$event"
                    placeholder="https://your-airia-console.airia.ai/.../{pipelineId}"/>
                  <small>{{tr('Paste an actual Airia console Pipeline URL and replace its pipeline UUID with {pipelineId}. This is a website link, NOT the Airia API endpoint.',
                    'ضع رابط شاشة Pipeline الحقيقية في Airia، واستبدل معرّف Pipeline بـ {pipelineId}. هذا رابط للواجهة وليس API.')}}</small>
                </ng-container>
                <ng-container *ngIf="item.type==='pipeline'">
                  <input class="url-field" type="text" spellcheck="false"
                    [attr.aria-label]="item.description" [ngModel]="draft[item.key]"
                    (ngModelChange)="draft[item.key]=$event"
                    placeholder="Airia Pipeline UUID — leave blank if not verified"/>
                  <small>{{tr('Use a real pipeline ID. A01–A04 default IDs follow the partner guide; Builder/Vision output contracts must be tested before activation.',
                   'استخدم المعرف الحقيقي. قيم A01–A04 من دليل Airia، ويجب اختبار مخرجات Builder وVision قبل التفعيل.')}}</small>
                  <div class="airia-link-actions" *ngIf="airiaConsoleUrl(item.key) as consoleUrl">
                    <button class="restore" type="button" (click)="openAiriaEmbedded(item.key)">
                      {{tr('Open in Airia panel','فتح داخل المنصة')}}</button>
                    <button class="restore" type="button" (click)="openAiriaExternal(item.key)">
                      {{tr('Open in Airia ↗','فتح Airia في تبويب جديد ↗')}}</button>
                  </div>
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
        </details>
        <section class="publish-card airia-embed-panel" *ngIf="airiaEmbedUrl">
          <div class="airia-embed-heading">
            <div>
              <h2>{{tr('Airia Agent Workspace','مساحة عمل Agent على Airia')}}</h2>
              <p>{{airiaEmbedAgent}} · {{tr('You may need to log in to Airia separately. Some providers block embedded frames; use New Tab if blank.',
                'قد يلزم تسجيل الدخول إلى Airia. بعض الجهات تمنع فتح الواجهة داخل إطار؛ استخدم تبويب جديد إن لم تظهر.')}}</p>
            </div>
            <div class="airia-link-actions">
              <button type="button" class="restore" (click)="openAiriaExternal(airiaEmbedAgent)">
                {{tr('Open in new tab ↗','فتح في تبويب جديد ↗')}}</button>
              <button type="button" class="restore" (click)="closeAiriaEmbedded()">
                {{tr('Close panel','إغلاق')}}</button>
            </div>
          </div>
          <iframe [src]="airiaEmbedUrl"
                  sandbox="allow-forms allow-scripts allow-same-origin allow-popups"
                  referrerpolicy="no-referrer"
                  title="Airia Agent Workspace"
                  class="airia-embed-frame"></iframe>
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
          <p class="governance-hint">{{tr('Structured SI-C01/S01/V01/R01/X01 pipeline IDs and A01–A04 come from the Airia Partner API Guide updated 14 October 2026. Existing Conversational Smart Inspection may be evaluated as a Builder, but prose is not a validated checklist JSON contract.',
            'معرفات A01–A04 ووكلاء SI-C01/S01/V01/R01/X01 مأخوذة من دليل Airia المحدث ١٤ أكتوبر ٢٠٢٦. يمكن تقييم المساعد الحواري كمرشح لـBuilder، لكن النص الحواري ليس نموذج JSON معتمدًا للقائمة.')}}</p>
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
    .airia-link-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}
    .airia-embed-panel{padding:18px}
    .airia-embed-heading{display:flex;gap:12px;justify-content:space-between;align-items:center;flex-wrap:wrap}
    .airia-embed-frame{display:block;width:100%;height:min(75vh,800px);min-height:480px;
      margin-top:14px;border:1px solid #dbe8ef;border-radius:12px;background:#f4f8fb}
    .group-card,.publish-card{background:white;border:1px solid #dee9ed;border-radius:15px;margin-top:20px;padding:23px}
    .agent-directory{margin-top:18px;border:1px solid #c7dfe5;border-radius:14px;background:#f0f9fa;padding:16px}
    .agent-directory strong{color:#0b6471;font-size:15px}
    .agent-directory p{font-size:11px;color:#668391;line-height:1.65;margin:7px 0 0}
    .agent-accordion{padding:0;overflow:hidden}
    .agent-accordion summary{cursor:pointer;list-style:none;padding:18px 22px;margin:0}
    .agent-accordion summary::-webkit-details-marker{display:none}
    .agent-accordion[open] summary{border-bottom:1px solid #e8eff2}
    .agent-accordion .settings-grid{padding:0 22px 18px}
    .group-count{display:inline-block;color:#098483;background:#e7f6f3;border-radius:9px;padding:3px 9px;font-size:10px;font-weight:800;margin-top:4px}
    .agent-chevron{margin-inline-start:auto;font-size:21px;color:#078682;transition:transform .15s}
    .agent-accordion[open] .agent-chevron{transform:rotate(180deg)}
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
  airiaEmbedUrl:SafeResourceUrl|null=null;
  airiaEmbedAgent='';
  snapshot:RuntimeSnapshot|null=null;
  draft:Record<string,boolean|number|string>={};
  readonly groups=AI_GOVERNANCE_SECTIONS.map(s=>s.id);
  credentialStatus:AiriaCredentialStatus|null=null;
  newApiKey='';credentialReason='';credentialSaving=false;
  actor='admin';reason='';error='';success='';loading=false;saving=false;
  constructor(private readonly http:HttpClient,public lang:LanguageService,
    private readonly sanitizer:DomSanitizer){}
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
  byGroup(g:string):SettingDescriptor[]{
    const section=AI_GOVERNANCE_SECTIONS.find(x=>x.id===g);
    return section?section.keys.map(key=>
      this.snapshot?.descriptors.find(d=>d.key===key))
      .filter((d):d is SettingDescriptor=>!!d):[];
  }
  groupLabel(g:string):string{
    const section=AI_GOVERNANCE_SECTIONS.find(x=>x.id===g);
    return section?this.tr(section.en,section.ar):g;
  }
  groupDescription(g:string):string{
    const section=AI_GOVERNANCE_SECTIONS.find(x=>x.id===g);
    const arabic:Record<string,string>={
      'agent-a01':'تحليل الوضع البحري بمصادر موثقة دون اتخاذ قرار تنظيمي',
      'agent-a02':'إشارات الامتثال مع بقاء التقييم الرسمي وفق القواعد المحددة',
      'agent-a03':'استخراج البيانات من الوثائق وخيارات الرفع والتشغيل التلقائي',
      'agent-a04':'تجهيز ملف المعاينة واقتراح بنود إضافية بعد المراجعة',
      'agent-dq01':'مؤشرات جودة البيانات دون تغيير الدرجة الإجمالية الرسمية',
      'agent-c01':'توصيات ترشيح السفن قبل الاعتماد والقرار النهائي للمشرف',
      'agent-p01':'سجل تاريخي فقط؛ الوكيل متوقف في النسخة التجريبية الحالية',
      'agent-s01':'ترتيب مواعيد ERP المتاحة فقط دون تأكيد الحجز',
      'agent-v01':'تحليل الأدلة بالصور دون إنشاء ملاحظات رسمية آليًا',
      'agent-r01':'صياغة التقرير والإجراءات من الملاحظات المؤكدة فقط',
      'agent-x01':'كشف التكرار وتعارض الأدلة مع مراجعة بشرية',
      'agent-checklist-builder':'إنشاء القوائم عند الطلب وحدود استدعاءات الذكاء لكل حالة',
      'agent-checklist-vision':'يشارك تفعيل مساعد القوائم ويخصص إعدادات نقل الصور',
      'agent-conversational-si':'مساعد حواري نصي؛ ليس بديلًا لعقد JSON المنظم',
      'agent-nmc-desk':'مساعد حواري لموظفي المركز البحري',
      'agent-dashboard-designer':'اقتراح لوحات ومؤشرات جديدة من مصادر موثقة، مع مراجعة وربط مصدر البيانات قبل النشر',
      'agent-sdb':'مساعد حواري لدورة خدمة دفتر البحار',
      'platform-orchestration':'إعدادات المزود والتنسيق المشتركة بين الوكلاء',
      'platform-fleet':'حدود التشغيل التلقائي وتكلفة تقييم الأسطول',
      'platform-alerts':'تنبيهات المخاطر المحفوظة والتصعيد',
      'platform-connectivity':'عنوان Airia والمهلة المشتركة؛ المفتاح محفوظ بصورة آمنة'
    };
    return section?this.tr(section.desc,arabic[g]||section.desc):'';
  }
  /** Only allow Airia HTTPS console hosts. The link is navigation, not an API call.
   * Use published backend configuration to prevent unreviewed draft links.
   */
  airiaConsoleUrl(pipelineSettingKey:string):string|null{
    if(!pipelineSettingKey.startsWith('AIRIA_')||
       !pipelineSettingKey.endsWith('_PIPELINE_ID')||!this.snapshot)return null;
    const template=this.snapshot.values['AIRIA_CONSOLE_PIPELINE_URL_TEMPLATE'];
    const id=this.snapshot.values[pipelineSettingKey];
    if(typeof template!=='string'||typeof id!=='string'||
       !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(id)||
       (template.match(/\\{pipelineId\\}/g)||[]).length!==1)return null;
    const link=template.replace('{pipelineId}',encodeURIComponent(id));
    try{
      const u=new URL(link);
      const hostname=u.hostname.toLowerCase();
      if(u.protocol!=='https:'||u.username||u.password||u.port||
         !(hostname==='airia.ai'||hostname.endsWith('.airia.ai')||
           hostname==='airia.com'||hostname.endsWith('.airia.com'))||
         u.pathname.startsWith('/v1/'))return null;
      return u.toString();
    }catch{return null;}
  }
  openAiriaEmbedded(key:string):void{
    const link=this.airiaConsoleUrl(key);
    if(!link)return;
    this.airiaEmbedAgent=key;
    this.airiaEmbedUrl=this.sanitizer.bypassSecurityTrustResourceUrl(link);
  }
  openAiriaExternal(key:string):void{
    const link=this.airiaConsoleUrl(key);
    if(link)window.open(link,'_blank','noopener,noreferrer');
  }
  closeAiriaEmbedded():void{
    this.airiaEmbedUrl=null;this.airiaEmbedAgent='';
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
