import {CommonModule} from '@angular/common';
import {Component,OnDestroy,OnInit} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {RouterLink} from '@angular/router';
import {Subscription,interval,switchMap} from 'rxjs';
import {NmcNavigationComponent} from '../components/nmc-navigation.component';
import {LanguageService} from '../services/language.service';
import {MoeiAuthService} from '../services/moei-auth.service';
import {SiBulkJob,SiBulkPlanService,SiBulkPreview,SiBulkVessel} from '../services/si-bulk-plan.service';

@Component({
 selector:'app-si-inspection-plan-wizard',
 standalone:true,imports:[CommonModule,FormsModule,RouterLink,NmcNavigationComponent],
 template:`
 <div class="si-layout" [attr.dir]="lang.dir">
  <app-nmc-navigation></app-nmc-navigation>
  <main class="wizard-main">
   <header class="wizard-hero">
    <div>
     <p class="eyebrow">MOEI · SMART INSPECTION · SI-01 → SI-02</p>
     <h1>{{copy('Create Inspection Plan','إنشاء خطة المعاينات')}}</h1>
     <p>{{copy('One approval for all selected vessels. Every source reason is automatically captured.',
       'اعتماد واحد للسفن المختارة، مع إدراج جميع أسباب إحالة كل سفينة تلقائيًا.')}}</p>
    </div>
    <a class="back-link" routerLink="/moei/smart-inspection/candidates">
     {{copy('← Candidate & Targeting','← العودة إلى السفن المرشحة')}}
    </a>
   </header>
   <nav class="steps" [attr.aria-label]="copy('Inspection plan creation steps','خطوات إنشاء الخطة')">
    <div *ngFor="let s of stages;let i=index" class="step-item"
        [class.active]="step===i+1" [class.done]="step>i+1">
     <span class="step-index">{{step>i+1?'✓':i+1}}</span>
     <span>{{copy(s.en,s.ar)}}</span>
    </div>
   </nav>
   <p class="notice" *ngIf="loading">{{copy('Loading the saved inspection plan and all approved source events…',
     'جارٍ تحميل الخطة المحفوظة وجميع أحداث المصادر المعتمدة…')}}</p>
   <p class="notice error" role="alert" *ngIf="error">{{error}}</p>

   <ng-container *ngIf="preview as p">
    <p class="notice error" *ngIf="p.stale||!p.agentRunId">
     {{copy('Current C01 recommendations are missing or out of date. Return to Candidate Center, refresh AI selection, then reopen this wizard.',
     'توصيات C01 قديمة أو غير موجودة. ارجع لمركز المرشحين وأعد حساب اختيار AI ثم افتح معالج الخطة من جديد.')}}
    </p>
    <section class="panel" *ngIf="step===1">
     <div class="panel-head">
      <div><p class="eyebrow">{{copy('STEP 01 · INSPECTION PLAN','الخطوة ١ · خطة المعاينات')}}</p>
       <h2>{{copy('Vessels included in the plan','السفن التي ستدخل خطة المعاينات')}}</h2>
       <p>{{copy('The current officer-amended C01 plan is the selection source. To include, exclude or reprioritize vessels, return to Candidate Center.',
         'مصدر الاختيار هو خطة C01 بعد تعديلات الموظف. لتعديل السفن أو ترتيبها، ارجع إلى شاشة الترشيح.')}}</p></div>
       <span class="count">{{p.selectedVessels}} {{copy('vessels','سفن')}}</span>
     </div>
     <div class="summary">
      <div><strong>{{p.selectedVessels}}</strong><span>{{copy('Selected vessels','السفن المختارة')}}</span></div>
      <div><strong>v{{p.planRevision}}</strong><span>{{copy('Plan revision','إصدار الخطة')}}</span></div>
      <div><strong>{{p.provider}}</strong><span>{{copy('C01 provider','مزود C01')}}</span></div>
     </div>
     <div class="table-scroll"><table>
      <thead><tr><th>{{copy('Priority','الأولوية')}}</th>
       <th>{{copy('Vessel','السفينة')}}</th><th>IMO</th>
       <th>{{copy('Referral reasons','أسباب المعاينة')}}</th>
       <th>{{copy('Inspection scopes','نطاقات المعاينة')}}</th></tr></thead>
      <tbody><tr *ngFor="let vessel of p.vessels">
       <td><span class="rank">#{{vessel.rank||'—'}}</span></td>
       <td><strong>{{vessel.vesselName}}</strong></td>
       <td class="mono">{{vessel.imo}}</td>
       <td><span class="reason-count">{{vessel.reasons.length}}
        {{copy('linked source events','أسباب مرتبطة بالمصادر')}}</span></td>
       <td>{{vessel.inspectionRegimes.length}} {{copy('scope(s)','نطاق/نطاقات')}}</td>
      </tr></tbody></table></div>
      <p class="hint">{{copy('One row per IMO. Even when multiple organizations refer the same vessel, no source reason is lost.',
        'صف واحد لكل رقم IMO. حتى لو تعددت إحالات السفينة من جهات مختلفة، لا يتم فقد أي سبب معاينة.')}}</p>
    </section>

    <section class="panel" *ngIf="step===2">
     <div class="panel-head"><div>
      <p class="eyebrow">{{copy('STEP 02 · SOURCE REASONS','الخطوة ٢ · أسباب الإحالة')}}</p>
      <h2>{{copy('All reasons collected automatically','جميع أسباب المعاينة مجمعة تلقائيًا')}}</h2>
      <p>{{copy('No inspection-type dropdown. All source-backed reasons and their distinct statutory scopes flow into the inspection case and dossier.',
        'لا توجد قائمة لاختيار نوع واحد. جميع أسباب الإحالة الموثقة ونطاقاتها النظامية تدخل حالة المعاينة وملف التحضير.')}}</p>
     </div></div>
     <div class="vessel-card" *ngFor="let vessel of p.vessels">
      <header><div><strong>#{{vessel.rank}} · {{vessel.vesselName}}</strong>
       <span>IMO {{vessel.imo}}</span></div>
       <span class="reason-count">{{vessel.reasons.length}} {{copy('reasons','أسباب')}}</span></header>
      <p *ngIf="!vessel.reasons.length" class="notice error">
       {{copy('No actionable source event: approval is blocked until the source is reviewed.',
         'لا توجد إحالة مصدر قابلة للتنفيذ؛ الاعتماد ممنوع حتى مراجعة المصدر.')}}</p>
      <div class="reason-card" *ngFor="let source of vessel.reasons">
       <div class="reason-heading">
        <strong>{{sourceLabel(source.sourceType)}}</strong>
        <span class="scope-label">{{source.inspectionRegime}}</span>
       </div>
       <p class="source-ref">{{copy('Source reference','مرجع المصدر')}}:
        <b>{{source.sourceReference||source.sourceEventId||'—'}}</b></p>
       <p *ngIf="source.reason">{{source.reason}}</p>
       <p *ngIf="!source.reason" class="muted">
        {{copy('No detailed reason supplied by this source; the referral and evidence references are preserved without inventing a reason.',
          'لم يرد وصف تفصيلي للسبب من هذا المصدر؛ سيتم حفظ مرجع الإحالة والأدلة دون اختلاق سبب.')}}</p>
       <small>{{source.evidenceIds.length}} {{copy('evidence reference(s)','مراجع أدلة')}} ·
        {{source.sourceApproval||'—'}}</small>
      </div>
      <p class="scopes">{{copy('Derived inspection scopes','نطاقات الفحص المستنتجة')}}:
       <span *ngFor="let regime of vessel.inspectionRegimes" class="scope-pill">{{regime}}</span>
      </p>
     </div>
     <p class="hint">{{copy('Different statutory regimes stay separately traceable; one combined field preparation does not replace any independent regulatory obligation.',
       'تظل المتطلبات النظامية المستقلة قابلة للتتبع؛ جمع التحضير لا يلغي أي إجراء تنظيمي مستقل.')}}</p>
    </section>

    <section class="panel" *ngIf="step===3">
     <p class="eyebrow">{{copy('STEP 03 · AUTOMATION','الخطوة ٣ · التحضير الآلي')}}</p>
     <h2>{{copy('What happens after plan approval?','ماذا سيحدث بعد اعتماد الخطة؟')}}</h2>
     <div class="workflow">
      <div><span class="flow-icon">✓</span><div><b>{{copy('Create approved plan + inspection cases','إنشاء الخطة المعتمدة وحالات المعاينة')}}</b>
       <p>{{copy('One approved plan and one coordinated case per selected IMO; all referral reasons remain linked.',
         'خطة معتمدة وحالة منسقة لكل سفينة مختارة، مرتبطة بجميع أسباب الإحالة.')}}</p></div></div>
      <div><span class="flow-icon">✓</span><div><b>{{copy('Build SI-02 preparation dossier','إنشاء ملف التحضير SI-02')}}</b>
       <p>{{copy('Deterministic evidence, current saved risk and baseline checklist for every case. No AI charges.',
         'الأدلة والمخاطر الحالية المحفوظة وقائمة الفحص الأساسية لكل حالة، دون رسوم AI.')}}</p></div></div>
      <div><span class="flow-icon">AI</span><div><b>{{copy('A04 vessel-specific AI dossier','ملف A04 الذكي لكل سفينة')}}</b>
       <label class="check"><input type="checkbox" [(ngModel)]="generateA04"
         [disabled]="!p.a04Enabled"/>
        {{copy('Generate A04 drafts automatically after approval','إنشاء مسودات A04 تلقائيًا بعد الاعتماد')}}
       </label><small>{{p.a04Provider}} · {{p.a04Enabled?copy('Available','متاح'):copy('Unavailable','غير متاح')}}</small>
      </div></div>
      <div><span class="flow-icon">AI</span><div><b>{{copy('P01 approved-case execution priority','ترتيب تنفيذ الحالات المعتمدة P01')}}</b>
       <label class="check"><input type="checkbox" [(ngModel)]="runP01"
        [disabled]="!p.p01Enabled"/>
        {{copy('Re-evaluate execution priority after cases are created','إعادة ترتيب التنفيذ بعد إنشاء الحالات')}}
       </label><small>{{p.p01Provider}} · {{p.p01Enabled?copy('Available','متاح'):copy('Unavailable','غير متاح')}}</small>
      </div></div>
     </div>
     <p class="notice">{{copy('A04 suggestions require inspector review. No automatic scheduling, detention or final report approval.',
       'توصيات A04 تحتاج مراجعة المفتش. لا تتم جدولة أو احتجاز سفينة أو اعتماد تقرير نهائي تلقائيًا.')}}</p>
    </section>

    <section class="panel" *ngIf="step===4">
     <p class="eyebrow">{{copy('STEP 04 · SUPERVISOR APPROVAL','الخطوة ٤ · اعتماد المسؤول')}}</p>
     <h2>{{copy('Review and approve the whole plan','مراجعة واعتماد الخطة بالكامل')}}</h2>
     <div class="review-stats">
      <p><b>{{p.selectedVessels}}</b><span>{{copy('Vessels / cases','سفن / حالات')}}</span></p>
      <p><b>{{totalReasons}}</b><span>{{copy('Source reasons preserved','أسباب إحالة محفوظة')}}</span></p>
      <p><b>{{totalScopes}}</b><span>{{copy('Regulatory inspection scopes','نطاقات معاينة نظامية')}}</span></p>
     </div>
     <p class="notice">{{copy('All collected reasons and scopes were shown in Step 2. Approval covers the entire currently selected plan, not a single referral per vessel.',
       'تم عرض جميع الأسباب والنطاقات في الخطوة الثانية. الاعتماد يشمل الخطة الحالية بالكامل وليس إحالة واحدة لكل سفينة.')}}</p>
     <label class="approval-notes">{{copy('Supervisor approval notes','ملاحظات اعتماد المشرف')}}
      <textarea rows="3" maxlength="500" [(ngModel)]="reason"
        [placeholder]="copy('Document why the selected plan is approved','سجل سبب اعتماد الخطة المختارة')"></textarea>
     </label>
     <div class="review-options">
      <span>{{copy('SI-02 baseline preparation','التحضير الأساسي SI-02')}}: <b>{{copy('Automatic','تلقائي')}}</b></span>
      <span>A04: <b>{{generateA04?copy('Generate drafts','إنشاء مسودات'):copy('Not requested','غير مطلوب')}}</b></span>
      <span>P01: <b>{{runP01?copy('Reprioritize','إعادة ترتيب'):copy('Not requested','غير مطلوب')}}</b></span>
     </div>
     <button type="button" class="approve" (click)="approve()"
      [disabled]="submitting||jobBusy||!auth.isAdmin||reason.trim().length<8||p.stale||!p.agentRunId||hasMissingReasons">
      {{submitting?copy('Submitting approval…','جارٍ إرسال الاعتماد…'):
       copy('Approve Full Plan & Create '+p.selectedVessels+' Dossiers',
        'اعتماد الخطة وإنشاء '+p.selectedVessels+' ملفات تحضير')}}
     </button>
     <p class="hint">{{copy('Approval is one human-authorized decision. The AI never approves inspections.',
       'الاعتماد قرار واحد يصدر من مستخدم مخول، وليس من الذكاء الاصطناعي.')}}</p>
    </section>
    <section class="panel" *ngIf="step===5&&job as j">
     <p class="eyebrow">{{copy('STEP 05 · EXECUTION','الخطوة ٥ · التنفيذ')}}</p>
     <div class="panel-head"><div><h2>{{copy('Approved plan processing','جاري تنفيذ الخطة المعتمدة')}}</h2>
       <p class="muted">{{copy('Plan ID','معرف الخطة')}}: {{j.id}}</p></div>
       <span class="job-chip" [class.warning]="j.status==='PARTIAL'">{{j.status}}</span>
     </div>
     <div class="summary">
      <div><strong>{{j.totalSelected}}</strong><span>{{copy('Vessels in approved plan','سفن بالخطة')}}</span></div>
      <div><strong>{{j.approvedCount}}</strong><span>{{copy('Cases committed','حالات تم إنشاؤها')}}</span></div>
      <div><strong>{{j.priorityStatus}}</strong><span>P01</span></div>
     </div>
     <div class="table-scroll"><table>
      <thead><tr><th>{{copy('Vessel','السفينة')}}</th>
       <th>{{copy('Sources','الإحالات')}}</th>
       <th>{{copy('Case / Status','الحالة')}}</th>
       <th>SI-02</th><th>A04</th><th>{{copy('Open','فتح')}}</th></tr></thead>
      <tbody><tr *ngFor="let item of j.items">
       <td><b>{{item.vesselName}}</b><small>{{item.imo}}</small></td>
       <td>{{item.reasonCount}}</td>
       <td><b>{{item.state}}</b><small *ngIf="item.error" class="error-text">{{item.error}}</small></td>
       <td>{{item.dossierStatus}}</td><td>{{item.aiDossierStatus}}</td>
       <td><a *ngIf="item.inspectionCaseId"
        [routerLink]="['/moei/smart-inspection/preparation',item.inspectionCaseId]">
        {{copy('Open dossier','فتح الملف')}}</a></td>
      </tr></tbody></table></div>
      <p *ngIf="j.status==='PARTIAL'" class="notice error">
       {{copy('Some preparations failed. Existing approved cases remain valid. Check each error instead of submitting approval twice.',
         'تعذر إكمال بعض التحضيرات. الحالات المعتمدة ما زالت محفوظة؛ راجع الأخطاء ولا تكرر الاعتماد.')}}</p>
      <div class="step-actions">
       <a routerLink="/moei/smart-inspection/preparation" class="next">
        {{copy('Open SI-02 Preparation Register →','فتح سجل تحضير SI-02 ←')}}</a>
       <a routerLink="/moei/smart-inspection/candidates" class="secondary">
        {{copy('Back to Candidate Center','العودة لمركز الترشيح')}}</a>
      </div>
    </section>
    <footer class="step-actions" *ngIf="step<5">
      <button type="button" class="secondary" (click)="previous()" [disabled]="step===1">
       {{copy('← Previous','← السابق')}}</button>
      <span>{{step}} / 4</span>
      <button type="button" class="next" (click)="next()" [disabled]="!canNext">
       {{copy('Continue →','التالي ←')}}</button>
    </footer>
   </ng-container>
  </main>
 </div>
 `,
 styles:[`
 :host{display:block;min-height:100vh;background:#edf4f7;color:#143c53}
 .si-layout{min-height:100vh}.wizard-main{margin-inline-start:264px;padding:28px 36px 55px;max-width:1700px}
 .wizard-hero{display:flex;justify-content:space-between;align-items:center;gap:22px;margin:10px 0 23px}
 .eyebrow{font-size:11px;letter-spacing:1.3px;color:#04887f;font-weight:850;margin:0 0 8px}
 h1{font-size:29px;color:#0d3651;margin:0 0 9px}h2{font-size:21px;margin:0 0 9px}
 .wizard-hero p:not(.eyebrow),.panel-head p,.muted{font-size:12px;color:#648190;line-height:1.8}
 .back-link,.secondary{font-weight:750;text-decoration:none;background:#fff;color:#087f77;border:1px solid #bad1d5;border-radius:9px;padding:12px 16px}
 .steps{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-bottom:23px}
 .step-item{display:flex;gap:10px;align-items:center;min-height:62px;padding:11px 12px;border:1px solid #d4e2e5;border-radius:10px;
  color:#6a8290;background:#fff;font-weight:700;font-size:12px}
 .step-item.active{background:#e1f5f1;color:#006c68;border-color:#5ebcae}
 .step-item.done{color:#0b836d;background:#f4fbf8}
 .step-index{display:flex;align-items:center;justify-content:center;width:28px;height:28px;min-width:28px;border-radius:50%;
  background:#e9f0f1;color:#4e7484;font-weight:900}
 .step-item.active .step-index,.step-item.done .step-index{background:#087c75;color:#fff}
 .panel{background:#fff;border:1px solid #dae8eb;box-shadow:0 6px 18px #06364d0b;border-radius:14px;padding:25px;margin-bottom:17px}
 .panel-head{display:flex;justify-content:space-between;align-items:center;gap:17px;margin-bottom:16px}
 .panel-head p{margin:0}.count,.reason-count{display:inline-flex;background:#e5f6ed;color:#08735b;padding:7px 12px;border-radius:20px;font-size:11px;font-weight:800;white-space:nowrap}
 .summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:17px 0}
 .summary>div{background:#f1f8f9;padding:14px;border:1px solid #dfeded;border-radius:10px;display:grid;gap:4px}
 .summary strong{font-size:22px;color:#0e7180}.summary span{font-size:11px;color:#627e8d}
 .table-scroll{overflow-x:auto}table{width:100%;border-collapse:collapse;font-size:12px}
 th{text-transform:uppercase;background:#eef5f6;color:#516e7e;text-align:start;font-size:10px}
 td,th{padding:13px 12px;border-bottom:1px solid #e5edef;text-align:start}
 td small{display:block;color:#6c8692;margin-top:6px}
 .rank{font-weight:900;color:#067e86}.mono{font-family:monospace}
 .hint{font-size:11px;color:#6c8792;line-height:1.7;margin:14px 0 0}
 .vessel-card{border:1px solid #d8e6e9;border-radius:11px;margin:13px 0;padding:18px;background:#f9fcfd}
 .vessel-card>header{display:flex;justify-content:space-between;align-items:center;margin-bottom:15px}
 .vessel-card>header strong{font-size:15px}.vessel-card>header span:not(.reason-count){display:block;margin-top:5px;font-size:11px;color:#728994}
 .reason-card{border-inline-start:3px solid #08a394;padding:10px 13px;margin:8px 0;background:#fff;border-radius:7px;font-size:12px}
 .reason-card p{margin:8px 0;line-height:1.65}.reason-card small{color:#75909a}
 .reason-heading{display:flex;align-items:center;gap:15px;justify-content:space-between}
 .scope-label{color:#5f7b88;font-size:11px}.source-ref{color:#355d6b}
 .scopes{margin:13px 0 0;color:#365e6c;font-size:12px}
 .scope-pill{display:inline-block;background:#e6f4f1;border-radius:20px;padding:6px 10px;margin:5px;font-size:10px}
 .workflow{display:grid;gap:13px;margin:19px 0}
 .workflow>div{display:flex;gap:15px;background:#f7fbfc;border:1px solid #e2edef;border-radius:9px;padding:15px}
 .workflow p,.workflow small{font-size:12px;color:#637f8c;line-height:1.6;margin:6px 0}
 .flow-icon{display:grid;place-items:center;width:37px;height:37px;min-width:37px;background:#e0f3e9;
  color:#097457;border-radius:10px;font-size:12px;font-weight:850}
 .check{display:flex;gap:10px;align-items:start;margin:12px 0 6px;font-size:12px;font-weight:750}
 .check input{accent-color:#078a7a;width:17px;height:17px}
 .notice{padding:13px 16px;background:#e7f3f8;border-radius:9px;color:#28617a;font-size:12px;line-height:1.7;margin:15px 0}
 .notice.error{background:#fff0ec;color:#a74c39}
 .review-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
 .review-stats p{display:grid;gap:5px;padding:15px;background:#f3f9f9;border-radius:9px}
 .review-stats b{color:#067883;font-size:22px}.review-stats span{font-size:11px;color:#587985}
 .approval-notes{display:grid;gap:9px;margin:20px 0;font-size:12px;font-weight:800}
 textarea{font:inherit;padding:11px 14px;border:1px solid #bdd5d7;border-radius:8px;resize:vertical}
 .review-options{display:flex;gap:20px;flex-wrap:wrap;font-size:12px;margin-bottom:19px}
 .review-options span{padding:10px 13px;border:1px solid #d6e8e8;border-radius:8px;background:#f7fbfb}
 button{font:inherit;cursor:pointer;font-size:12px;font-weight:800;border-radius:8px;padding:12px 15px;border:0}
 button:disabled{opacity:.46;cursor:not-allowed}
 .approve,.next{background:#078075;color:#fff;border-radius:8px;padding:13px 18px;font-weight:800;text-decoration:none}
 .approve{width:100%;min-height:49px;font-size:13px}
 .step-actions{display:flex;justify-content:space-between;align-items:center;gap:15px;margin:22px 0}
 .step-actions span{color:#607988;font-weight:850}.job-chip{padding:8px 12px;border-radius:16px;background:#dcf5e6;color:#087450}
 .job-chip.warning{background:#fff1de;color:#935e25}
 .error-text{color:#aa503b}
 @media(max-width:1220px){.wizard-main{margin-inline-start:90px;padding:24px}}
 @media(max-width:960px){.wizard-main{margin-inline-start:0;padding:20px}.steps{grid-template-columns:repeat(2,1fr)}}
 @media(max-width:600px){.wizard-main{padding:13px}.wizard-hero,.panel-head{display:block}.steps{gap:4px}.step-item{font-size:10px;padding:7px}
 .panel{padding:15px}.summary,.review-stats{grid-template-columns:1fr}.step-actions{gap:7px}}
 `]
})
export class SiInspectionPlanWizardComponent implements OnInit,OnDestroy{
 readonly stages=[{en:'Selected Vessels',ar:'السفن المختارة'},
  {en:'All Referral Reasons',ar:'أسباب المعاينة'},{en:'AI & Preparation',ar:'التحضير والذكاء الاصطناعي'},
  {en:'Review & Approval',ar:'المراجعة والاعتماد'}];
 step=1;preview:SiBulkPreview|null=null;
 job:SiBulkJob|null=null;loading=false;submitting=false;error='';
 reason='';generateA04=false;runP01=false;private timer:Subscription|null=null;
 constructor(private api:SiBulkPlanService,public lang:LanguageService,public auth:MoeiAuthService){}
 copy(en:string,ar:string):string{return this.lang.pick(en,ar);}
 sourceLabel(source:string):string{
  const labels:Record<string,[string,string]>={
   NMC_CASE:['NMC Referral','إحالة المركز البحري'],
   SERVICE_REQUEST:['Maritime Service Request','طلب خدمة بحرية'],
   PSC_PORT_CALL:['PSC Port Call','نداء ميناء PSC']
  };
  const name=labels[source]||[source,source];return this.copy(name[0],name[1]);
 }
 get jobBusy():boolean{return this.job?.status==='QUEUED'||this.job?.status==='RUNNING';}
 get hasMissingReasons():boolean{return this.preview?.vessels.some(x=>x.missingSource)||false;}
 get totalReasons():number{return this.preview?.vessels.reduce((n,v)=>n+v.reasons.length,0)||0;}
 get totalScopes():number{return this.preview?.vessels.reduce((n,v)=>n+v.inspectionRegimes.length,0)||0;}
 get canNext():boolean{return !!this.preview&&this.step<4&&this.preview.selectedVessels>0&&
  !!this.preview.agentRunId&&!this.preview.stale&&!this.hasMissingReasons&&!this.loading;}
 ngOnInit():void{
  this.refresh();
  this.api.latest().subscribe({next:r=>{
   const newest=r.batches?.[0];
   if(newest){
    this.job=newest;
    if(newest.status==='QUEUED'||newest.status==='RUNNING'){
     this.step=5;this.poll(newest.id);
    }
   }
  },error:()=>{}});
 }
 ngOnDestroy():void{this.timer?.unsubscribe();}
 refresh():void{
  if(this.submitting)return;this.loading=true;this.error='';
  this.api.preview().subscribe({
   next:p=>{
    this.preview=p;this.loading=false;
    this.generateA04=p.a04Enabled&&p.a04Provider==='MOCK';
    this.runP01=p.p01Enabled&&p.p01Provider==='MOCK';
   },error:e=>{this.loading=false;
    this.error=e?.error?.error||this.copy('Plan preview could not be loaded.',
      'تعذر تحميل معاينة الخطة.');}
  });
 }
 previous():void{if(this.step>1&&this.step<5)this.step--;}
 next():void{if(this.canNext)this.step++;}
 approve():void{
  const p=this.preview;if(!p||this.submitting||this.jobBusy||!this.auth.isAdmin||
   !p.agentRunId||p.stale||this.hasMissingReasons||this.reason.trim().length<8)return;
  const paid=(this.generateA04&&p.a04Provider==='AIRIA')||
   (this.runP01&&p.p01Provider==='AIRIA');
  const message=this.copy(
   'Approve the complete plan ('+p.selectedVessels+' vessels), preserving all '+
    this.totalReasons+' source reasons, then create preparation dossiers?'+
    (paid?' This batch may call paid Airia agents.':' No paid Airia calls.'),
   'هل تعتمد الخطة بالكامل ('+p.selectedVessels+' سفن) وتحفظ جميع أسباب الإحالة ('+
    this.totalReasons+') وتبدأ ملفات التحضير؟'+
    (paid?' قد يتم استدعاء Airia المدفوع.':' بدون استدعاء Airia مدفوع.')
  );
  if(!window.confirm(message))return;
  this.submitting=true;this.error='';
  this.api.approve({
   reason:this.reason.trim(),expectedRevision:p.planRevision,
   expectedSourceHash:p.sourceHash,expectedAgentRunId:p.agentRunId,
   confirmApproval:true,generateA04:this.generateA04,
   runP01:this.runP01,confirmAiCost:paid
  }).subscribe({next:j=>{this.submitting=false;this.job=j;this.step=5;this.poll(j.id);},
   error:e=>{this.submitting=false;this.error=e?.error?.error||
    this.copy('Approval rejected. Review the current source plan again.',
      'تم رفض الاعتماد؛ راجع الخطة الحالية من جديد.');}});
 }
 private poll(id:string):void{
  this.timer?.unsubscribe();
  this.timer=interval(1300).pipe(switchMap(()=>this.api.job(id)))
   .subscribe({
    next:j=>{this.job=j;
     if(j.status==='COMPLETED'||j.status==='PARTIAL')this.timer?.unsubscribe();},
    error:e=>{this.timer?.unsubscribe();this.error=e?.error?.error||
     this.copy('Cannot read job status. Do not submit the same approval again.',
       'تعذر قراءة حالة التنفيذ، لا تكرر الاعتماد.');}
   });
 }
}
