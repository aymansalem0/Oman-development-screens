import {CommonModule} from '@angular/common';
import {Component,OnInit} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {HttpClient,HttpHeaders} from '@angular/common/http';
import {RouterLink} from '@angular/router';
import {NmcNavigationComponent} from '../components/nmc-navigation.component';
import {NmcMinistryLogoComponent} from '../components/nmc-ministry-logo.component';
import {LanguageService} from '../services/language.service';

interface SettingDescriptor {
  key:string;type:'boolean'|'number'|'url';group:string;
  min?:number;max?:number;description:string;cost?:boolean;
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
          <h1>{{tr('Runtime Configuration & AI Agents','إعدادات التشغيل ووكلاء الذكاء الاصطناعي')}}</h1>
          <p>{{tr('NMC Settings · Controlled agent execution and platform operations',
                  'إعدادات المركز البحري · التحكم في تشغيل الوكلاء وعمليات المنصة')}}</p>
        </div>
      </div>
      <div class="topbar-actions">
        <span class="admin-badge">⚙ {{tr('NMC Settings','إعدادات المركز البحري')}}</span>
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
        <p>{{tr('Values below override backend ENV defaults immediately for this single-instance POC and survive restarts in its /data volume. They do not alter Docker/OS variables. Secrets, passwords, API keys and arbitrary endpoints cannot be entered. Enabling paid agents or changing the Airia endpoint requires explicit confirmation.',
                 'هذه القيم تتجاوز إعدادات ENV الافتراضية فورًا داخل نسخة POC واحدة وتبقى بعد إعادة التشغيل في وحدة التخزين /data. لا تغير متغيرات Docker/OS. لا يمكن إدخال مفاتيح سرية أو روابط عشوائية. تفعيل تشغيل مدفوع أو تغيير عنوان Airia يتطلب تأكيدًا صريحًا.')}}</p>
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
                <span class="paid" *ngIf="item.cost">● {{tr('May incur AI costs','قد يستهلك تكلفة AI')}}</span>
                <button type="button" class="restore" (click)="draft[item.key]=snapshot.defaults[item.key]">
                  {{tr('Use ENV default','استعادة قيمة ENV')}}</button>
              </div>
            </article>
          </div>
        </section>
        <section class="publish-card">
          <h2>{{tr('Publish runtime settings','نشر إعدادات التشغيل')}}</h2>
          <p>{{tr('Publish only after checking agent costs, scheduler vessel limits and the Airia endpoint. The publisher key is not stored in the browser.',
                   'انشر بعد مراجعة تكلفة الوكلاء وحدود السفن المجدولة وعنوان Airia. مفتاح المشرف لا يتم تخزينه في المتصفح.')}}</p>
          <div class="publish-form">
            <label>{{tr('Publisher name','اسم المشرف')}}<input [(ngModel)]="actor" maxlength="100"
              [placeholder]="tr('Your name','اسم المستخدم')"/></label>
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
  groups=['agents','scheduler','alerts','connectivity'];
  actor='';reason='';error='';success='';loading=false;saving=false;
  constructor(private readonly http:HttpClient,public lang:LanguageService){}
  tr(en:string,ar:string){return this.lang.pick(en,ar);}
  ngOnInit(){this.load();}
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
  icon(g:string){return ({agents:'✦',scheduler:'◷',alerts:'♢',connectivity:'⛓'} as Record<string,string>)[g]||'⚙';}
  groupLabel(g:string){
    const s:Record<string,[string,string]>={
      agents:['AI Agents & Orchestration','وكلاء الذكاء الاصطناعي وتنسيق التشغيل'],
      scheduler:['Fleet Assessment Scheduler','جدولة تقييم مخاطر السفن'],
      alerts:['Alerts & Escalation','التنبيهات والتصعيد'],
      connectivity:['Airia Connectivity','الاتصال بخدمة Airia']
    };
    return this.tr(s[g][0],s[g][1]);
  }
  groupDescription(g:string){
    const s:Record<string,[string,string]>={
      agents:['Enable/disable A01, A02, A03, A04 and P01.','تفعيل وإيقاف A01 وA02 وA03 وA04 وP01.'],
      scheduler:['Pilot vessel limit, retry and periodic execution.','حدود السفن التجريبية وإعادة المحاولة والتشغيل الدوري.'],
      alerts:['Detection interval and unacknowledged-event escalation.','دورية فحص التنبيهات والتصعيد عند عدم الاستجابة.'],
      connectivity:['Allowlisted secure Airia endpoint; API key remains a server secret.','عنوان Airia آمن ومحدد مسبقًا؛ مفتاح API محفوظ كسر على الخادم.']
    };
    return this.tr(s[g][0],s[g][1]);
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
    const risky=keys.length>0||urlChanged;
    if(!window.confirm(this.tr(
      'Publish live backend configuration? '+(risky?'New paid AI/endpoint settings: '+keys.join(', ')+(urlChanged?' AIRIA_BASE_URL':'')+'. ':'')+
      'This may trigger paid fleet/A03 work when automatic options are enabled.',
      'هل تريد نشر إعدادات الخادم؟ '+(risky?'تغيير قد يؤدي إلى استدعاءات AI مدفوعة أو عنوان اتصال جديد. ':'')+
      'قد يبدأ التقييم التلقائي المدفوع بعد النشر.'
    )))return;
    const accessKey=window.prompt('Publisher access key / مفتاح صلاحية المشرف')?.trim();
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
