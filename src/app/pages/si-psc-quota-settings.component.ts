import {CommonModule} from '@angular/common';
import {Component,OnInit} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {RouterLink} from '@angular/router';
import {NmcNavigationComponent} from '../components/nmc-navigation.component';
import {LanguageService} from '../services/language.service';
import {SiPscSelectionService,PscQuotaConfig,PscQuotaPolicy}
  from '../services/si-psc-selection.service';

@Component({
  selector:'app-si-psc-quota-settings',standalone:true,
  imports:[CommonModule,FormsModule,RouterLink,NmcNavigationComponent],
  template:`
    <div class="si-layout" [attr.dir]="lang.dir"><app-nmc-navigation></app-nmc-navigation>
    <main class="quota-main">
      <header><div><small>MOEI MARITIME UNIFIED PLATFORM · INSPECTION SETTINGS</small>
        <h1>{{copy('PSC Inspection Targeting & Quota Settings','إعدادات استهداف وحصص تفتيش دولة الميناء')}}</h1>
        <p>{{copy('Stage 1: configure the percentage of eligible Port Calls reviewed for selection. This does not rank already-approved inspections and does not change NMC Risk.',
          'المرحلة الأولى: حدد نسبة إخطارات الوصول المؤهلة للاختيار للمعاينة. هذا لا يرتب المعاينات المعتمدة ولا يغيّر مخاطر NMC.')}}</p></div>
        <div class="header-actions">
          <button type="button" (click)="load()" [disabled]="busy"
            [attr.aria-label]="copy('Refresh published PSC quota','تحديث الحصة المنشورة لـ PSC')">
            ↻ {{copy('Refresh Published Policy','تحديث السياسة المنشورة')}}
          </button>
          <a routerLink="/moei/smart-inspection/psc-targeting">{{copy('Open Targeting Pool →','فتح قائمة الاستهداف ←')}}</a>
        </div>
      </header>

      <p class="alert err" *ngIf="error" role="alert">{{error}}</p>
      <p class="alert ok" *ngIf="success" role="status">{{success}}</p>
      <p class="alert" *ngIf="busy">{{copy('Processing…','جارٍ المعالجة…')}}</p>
      <section *ngIf="!policy&&!busy&&!error" class="card load-hint">
        <strong>{{copy('PSC quota policy is being loaded','جارٍ تجهيز سياسة حصص PSC')}}</strong>
        <p class="hint">{{copy('The published settings will appear automatically. No credentials are needed just to view them.',
          'ستظهر الإعدادات المنشورة تلقائيًا، ولا تحتاج إلى إدخال مفاتيح لمجرد الاطلاع عليها.')}}</p>
      </section>
      <section *ngIf="!policy&&!busy&&error" class="card load-hint">
        <strong>{{copy('Published PSC quota could not be loaded','تعذر تحميل سياسة حصص PSC المنشورة')}}</strong>
        <p class="hint">{{copy('Verify the backend is running and Oracle migration 012 is applied. Reload after resolving the issue.',
          'تحقق من تشغيل الخدمة الخلفية وتطبيق ترحيل Oracle رقم 012، ثم أعد التحميل بعد حل المشكلة.')}}</p>
        <button type="button" (click)="load()">{{copy('Retry Loading Policy','إعادة محاولة التحميل')}}</button>
      </section>
      <section class="card" *ngIf="policy as p">
        <div class="section-head"><h2>{{copy('01 · Monthly Selection Policy','٠١ · سياسة الاختيار الشهرية')}}</h2>
          <span class="badge">{{copy('PUBLISHED VERSION','إصدار منشور')}} v{{p.version}}</span></div>
        <p class="hint">{{copy('A Port Call is an EVENT, not a unique vessel. The quota denominator is validated recorded POC Port Calls in the chosen monthly scope. A 15% example is not an official MOEI target.',
          'إخطار الوصول حدث مستقل وليس سفينة فريدة. مقام الحصة هو أحداث الوصول التجريبية الصالحة خلال الشهر والنطاق المختار. نسبة ١٥٪ مثال وليست مستهدفًا رسميًا.')}}</p>
        <div class="config-row">
          <div><strong>{{copy('Targeting Period','فترة الاستهداف')}}</strong>
            <small>{{copy('Monthly (fixed in POC)','شهري (ثابت في POC)')}}</small></div>
          <strong>MONTHLY</strong>
        </div>
        <div class="config-row">
          <div><strong>{{copy('Quota Calculation Scope','نطاق حساب الحصة')}}</strong>
            <small>{{copy('National or separate quota for every port','حصة عامة أو حصة مستقلة لكل ميناء')}}</small></div>
          <select [(ngModel)]="config.scope" (ngModelChange)="changed()">
            <option value="NATIONAL">{{copy('All UAE Ports Combined','جميع موانئ الإمارات مجتمعة')}}</option>
            <option value="PER_PORT">{{copy('Separate Quota Per Port','حصة مستقلة لكل ميناء')}}</option>
          </select>
        </div>
        <div class="config-row">
          <div><strong>{{copy('Target Inspection Selection Rate','نسبة الاستهداف المقترحة')}}</strong>
            <small>{{copy('Percentage of eligible Port Call events (rounded down)','نسبة أحداث الوصول المؤهلة (تقريب لأسفل)')}}</small></div>
          <div class="slider-row">
            <input type="range" min="0" max="100" step="1" [(ngModel)]="config.ratePercent"
              (ngModelChange)="changed()" [attr.aria-label]="copy('Selection percentage slider','شريط نسبة الاستهداف')"/>
            <div class="num"><input type="number" min="0" max="100" step="1"
              [(ngModel)]="config.ratePercent" (ngModelChange)="changed()"
              [attr.aria-label]="copy('Selection percentage','نسبة الاستهداف')"/><span>%</span></div>
          </div>
        </div>
        <div *ngIf="config.scope==='PER_PORT'" class="overrides">
          <h3>{{copy('Optional Port-Specific Overrides','نسب استهداف خاصة بالموانئ (اختياري)')}}</h3>
          <p class="hint">{{copy('A port with no override uses the default percentage. Names must match source Excel port labels (case-insensitive).',
            'الميناء دون استثناء يستخدم النسبة العامة. يجب أن يطابق الاسم اسم الميناء في Excel دون حساسية لحالة الأحرف.')}}</p>
          <div class="override" *ngFor="let row of config.portOverrides;let i=index">
            <input [(ngModel)]="row.port" (ngModelChange)="changed()"
              [placeholder]="copy('Port name','اسم الميناء')" [attr.aria-label]="copy('Port name','اسم الميناء')"/>
            <input type="number" min="0" max="100" [(ngModel)]="row.ratePercent"
              (ngModelChange)="changed()" [attr.aria-label]="copy('Port quota percentage','نسبة حصة الميناء')"/>
            <button type="button" (click)="removePort(i)">{{copy('Remove','حذف')}}</button>
          </div>
          <button type="button" (click)="addPort()" [disabled]="config.portOverrides.length>=60">
            {{copy('+ Add Port Override','+ إضافة استثناء ميناء')}}</button>
        </div>
        <p class="protected">{{copy('Safety guard: approved NMC referrals and Maritime Service Requests are NOT limited by PSC quota. There is no automatic AI selection or legal determination.',
          'ضابط حماية: إحالات NMC المعتمدة وطلبات الخدمات البحرية ليست ضمن حصة PSC. لا يوجد اختيار تلقائي بواسطة AI أو حكم تنظيمي.')}}</p>
        <section class="edit-access">
          <h3>{{copy('Preview & Approval Access','صلاحيات المعاينة والاعتماد')}}</h3>
          <p class="hint">{{copy('The published policy is visible automatically. Enter an Editor key only to preview changes; a Publisher key is required only when publishing a new version.',
            'تظهر السياسة المنشورة تلقائيًا. استخدم مفتاح المحرر فقط لمعاينة أثر التعديلات، ومفتاح المشرف فقط لاعتماد ونشر إصدار جديد.')}}</p>
          <div class="keys">
            <label>{{copy('Editor key · Preview','مفتاح المحرر · معاينة الأثر')}}
              <input type="password" [(ngModel)]="editorKey" autocomplete="off"/></label>
            <label>{{copy('Publisher key · Publish','مفتاح المشرف · النشر')}}
              <input type="password" [(ngModel)]="publisherKey" autocomplete="off"/></label>
          </div>
        </section>
        <div class="actions">
          <button class="primary" (click)="previewPolicy()" [disabled]="busy">
            {{copy('Preview Quota Impact (No AI)','معاينة أثر الحصة (بدون AI)')}}</button>
        </div>
      </section>
      <section class="card" *ngIf="impact as preview">
        <h2>{{copy('02 · Proposed Target vs. Current Selection','٠٢ · مقارنة المستهدف المقترح مع الاختيارات الحالية')}}</h2>
        <p class="hint">{{copy('Preview does not save settings, select ships, or call Airia. Targets are calculated from currently imported PSC events.',
          'المعاينة لا تحفظ الإعدادات ولا تختار السفن ولا تشغّل Airia. يتم الحساب من إخطارات PSC المستوردة حاليًا.')}}</p>
        <div class="scroll"><table><thead><tr>
          <th>{{copy('Month / Scope','الشهر / النطاق')}}</th>
          <th>{{copy('Eligible Port Calls','إخطارات مؤهلة')}}</th>
          <th>{{copy('Proposed Rate','النسبة')}}</th>
          <th>{{copy('Target (floor)','المستهدف')}}</th>
          <th>{{copy('Already Selected','المختارة')}}</th></tr></thead><tbody>
          <tr *ngFor="let bucket of preview.summary" [class.over]="bucket.overQuota">
            <td>{{bucket.bucket}}</td><td>{{bucket.eligiblePortCalls}}</td>
            <td>{{bucket.selectionRate}}%</td><td>{{bucket.targetCount}}</td>
            <td>{{bucket.selectedCount}}</td>
          </tr>
          <tr *ngIf="!preview.summary.length"><td colspan="5">
            {{copy('No PSC events imported yet','لم تُستورد أحداث PSC بعد')}}</td></tr>
        </tbody></table></div>
        <p class="alert" *ngIf="hasOverQuota">
          {{copy('Some existing selections exceed the proposed quota. No approved inspection will be deleted; supervisor review is required.',
            'بعض الاختيارات السابقة تتجاوز الحصة المقترحة؛ لن تُحذف أي معاينة معتمدة ويلزم مراجعة المشرف.')}}</p>
        <h3>{{copy('Controlled Publication','النشر المنضبط')}}</h3>
        <div class="publish-row">
          <label>{{copy('Publisher / reviewer','المراجع / المشرف')}}
            <input [(ngModel)]="reviewer" maxlength="120"/></label>
          <label>{{copy('Business justification','المبرر الإداري')}}
            <textarea [(ngModel)]="reason" rows="2" maxlength="500"></textarea></label>
        </div>
        <button class="primary" (click)="publish()" [disabled]="busy">
          {{copy('Publish New PSC Quota Version','نشر إصدار جديد لحصص PSC')}}</button>
      </section>
    </main></div>`,
  styles:[`
    :host{display:block;background:#eef4f7;min-height:calc(100vh - 82px);color:#244458}
    .si-layout{display:flex;min-height:calc(100vh - 82px)}
    .quota-main{flex:1;min-width:0;max-width:1510px;margin:0 auto;padding:25px 28px 55px}
    header,.section-head{display:flex;align-items:start;justify-content:space-between;gap:18px}
    header{border-bottom:1px solid #d8e7ec;padding:12px 0 20px}
    header small{color:#0c786b;letter-spacing:1px;font-size:10px;font-weight:850}
    h1{font-size:24px;color:#16394f;margin:8px 0}h2{font-size:18px;color:#13506b;margin:0 0 12px}
    h3{font-size:14px;color:#125c72}header p,.hint{font-size:12px;color:#6b8795;line-height:1.75}
    header a{color:#086d78;text-decoration:none;font-size:12px;font-weight:800;
      border:1px solid #b8dcd9;background:white;padding:10px;border-radius:8px;white-space:nowrap}
    .card{margin:15px 0;padding:20px;background:white;border:1px solid #d7e6ed;border-radius:12px}
    .keys{display:flex;flex-wrap:wrap;gap:12px;align-items:end;margin-top:13px}
    .edit-access{margin-top:18px;border:1px solid #cce8e3;border-radius:10px;
      padding:15px;background:#f5fbf9}
    .edit-access h3{margin:0 0 6px;color:#0c706b}
    .header-actions{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
    .header-actions button{white-space:nowrap}
    .load-hint{background:#f8fcfb;border-color:#cfe2dd}
    .load-hint strong{color:#15526b;font-size:13px}
    label{display:block;font-size:11px;font-weight:800;color:#3e697d;min-width:200px}
    input,select,textarea{border:1px solid #c4dae3;border-radius:8px;padding:10px;
      box-sizing:border-box;width:100%;margin-top:7px;font:inherit;font-size:12px;background:white}
    button{padding:10px 14px;border:1px solid #afd5da;border-radius:8px;
      background:#eff9fa;color:#076a7f;font-size:12px;font-weight:850;cursor:pointer}
    .primary{background:#087d91;color:white;border-color:#087d91}
    button:disabled{opacity:.5;cursor:not-allowed}
    .alert{font-size:12px;padding:12px 15px;background:#e7f4f7;border-radius:9px}
    .alert.err{color:#a43732;background:#ffe8e5}.alert.ok{color:#176943;background:#e4f6eb}
    .badge{font-size:11px;padding:7px 11px;background:#e7f6ed;color:#166e53;border-radius:8px}
    .config-row{display:grid;grid-template-columns:minmax(0,1fr) minmax(240px,1fr);
      align-items:center;gap:20px;border-bottom:1px solid #eaf1f4;padding:16px 0}
    .config-row strong,.config-row small{display:block}.config-row strong{font-size:12px}
    .config-row small{color:#718e9c;font-size:10px;margin-top:6px}
    .slider-row{display:flex;align-items:center;gap:12px}.slider-row input[type=range]{
      accent-color:#087d91;cursor:pointer;border:0;padding:0;margin:0;flex:1}
    .num{display:flex;align-items:center;gap:3px;width:100px;border:1px solid #c4dce4;border-radius:8px}
    .num input{margin:0;padding:9px 3px;border:0;text-align:center}.num span{margin:0 7px;font-size:11px}
    .overrides{background:#f7fbfc;border-radius:10px;padding:18px;margin-top:16px}
    .override{display:grid;grid-template-columns:1fr 110px auto;gap:11px;align-items:end;margin:10px 0}
    .protected{border-inline-start:3px solid #168b7f;padding:12px;background:#ebf9f5;font-size:11px}
    .actions{margin-top:17px}.scroll{overflow:auto}
    table{width:100%;border-collapse:collapse;min-width:670px;font-size:12px}
    th,td{text-align:start;padding:11px;border-bottom:1px solid #e4edf0}
    th{background:#f0f6f8;color:#3e6e84;font-size:10px}tr.over{background:#fff0e8}
    .publish-row{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:15px}
    @media(max-width:960px){.si-layout{display:block}.quota-main{padding:16px}
      header{display:block}.config-row,.publish-row{grid-template-columns:1fr}}
  `]
})
export class SiPscQuotaSettingsComponent implements OnInit{
  policy:PscQuotaPolicy|null=null;
  config:PscQuotaConfig={period:'MONTHLY',scope:'NATIONAL',ratePercent:15,
    portOverrides:[],mandatoryOutsideQuota:true};
  impact:{status:string;summary:{bucket:string;eligiblePortCalls:number;
    selectionRate:number;targetCount:number;selectedCount:number;overQuota:boolean}[]}|null=null;
  editorKey='';publisherKey='';reviewer='';reason='';busy=false;error='';success='';
  constructor(private readonly api:SiPscSelectionService,public readonly lang:LanguageService){}
  ngOnInit():void{this.load();}
  copy(en:string,ar:string){return this.lang.pick(en,ar);}
  changed():void{this.impact=null;this.success='';}
  addPort():void{this.config.portOverrides.push({port:'',ratePercent:this.config.ratePercent});this.changed();}
  removePort(i:number):void{this.config.portOverrides.splice(i,1);this.changed();}
  get hasOverQuota(){return Boolean(this.impact?.summary.some(x=>x.overQuota));}
  load():void{
    if(this.busy)return;
    this.busy=true;this.error='';
    this.api.policy().subscribe({
      next:r=>{this.policy=r.policy;this.config=JSON.parse(JSON.stringify(r.policy.config));
        this.impact=null;this.busy=false;},error:e=>{
          this.policy=null;this.fail(e);
        }
    });
  }
  previewPolicy():void{
    if(!this.editorKey.trim()){this.error=this.copy('Editor key required','مطلوب مفتاح المحرر');return;}
    this.busy=true;this.error='';
    const config=JSON.parse(JSON.stringify(this.config)) as PscQuotaConfig;
    if(config.scope==='NATIONAL')config.portOverrides=[];
    this.api.preview(this.editorKey.trim(),config).subscribe({
      next:r=>{this.config=config;this.impact=r;this.busy=false;},
      error:e=>this.fail(e)
    });
  }
  publish():void{
    if(!this.policy||!this.impact||!this.publisherKey.trim()||this.reviewer.trim().length<3||
      this.reason.trim().length<8){
      this.error=this.copy('Preview, publisher key, reviewer and reason (8+ characters) required.',
        'يلزم معاينة الأثر ومفتاح المشرف واسم المراجع ومبرر لا يقل عن ٨ أحرف.');return;
    }
    if(!window.confirm(this.copy('Publish a new PSC targeting quota policy? Existing selections are retained.',
      'نشر سياسة حصص PSC جديدة؟ ستظل الاختيارات السابقة محفوظة.')))return;
    this.busy=true;this.error='';
    this.api.publish(this.publisherKey.trim(),{
      config:this.config,expectedVersion:this.policy.version,
      publishedBy:this.reviewer.trim(),reason:this.reason.trim()
    }).subscribe({
      next:r=>{this.busy=false;this.reason='';
        this.policy=r.policy;this.config=JSON.parse(JSON.stringify(r.policy.config));
        this.impact=null;this.error='';
        this.success=this.copy('PSC quota policy published successfully.',
          'تم نشر سياسة حصص PSC بنجاح.');},
      error:e=>this.fail(e)
    });
  }
  private fail(e:any){this.busy=false;this.error=e?.error?.error||'PSC_QUOTA_REQUEST_FAILED';}
}
