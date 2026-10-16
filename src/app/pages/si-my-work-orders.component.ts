import {CommonModule} from '@angular/common';
import {Component,OnInit} from '@angular/core';
import {HttpClient} from '@angular/common/http';
import {Router,RouterLink} from '@angular/router';
import {NmcNavigationComponent} from '../components/nmc-navigation.component';
import {LanguageService} from '../services/language.service';
import {MoeiAuthService} from '../services/moei-auth.service';

interface AssignedOrder{
 planId:string;scheduleId:string;orderId:string;imo:string;vesselName?:string;
 status:string;caseId:string|null;checklistStatus:string;
 aiStatus:string;scopeStatus:string;mode:'POC_MOCK'|'ERP_EXCEL_POC';
 isMyPocEngineer?:boolean;
 assignment:{inspectorName:string;inspectorId:string;
  portName:string;startLocal:string;startUtc:string;locationName:string};
}
interface Dossier{
 status:string;schema:string;caseId:string|null;imo:string;readOnly:true;
 sections:{
  identity:{imo:string;vesselName:string|null;flag:string|null;
   vesselType:string|null;regimes?:string[];caseId?:string|null};
  assignments:{inspectorName:string|null;portName:string|null;
   startLocal:string|null;endLocal?:string|null;status:string;crossPort?:boolean;
   liveErpBookingConfirmed:boolean}|null;
  referrals:{allSourceReasons:unknown[];objectives?:unknown[];
   inspectionScopes?:unknown[];distinctSourceCount?:number};
  risk:{score:number;level:string;status:string}|null;
  sourceEvidence:{certificates:unknown[];inspectionHistory:unknown[];
   openDeficiencies:unknown[];documents:unknown[];tracking:unknown;
   evidenceManifestRefs:string[];externalDocumentsVerified:boolean};
  inspectionChecklist:{mandatoryBaseItemIds:string[];
   checklistStatus:string|null;publishedTemplateSnapshotPresent:boolean};
  aiAnalysis:{status:string;generated:boolean;
   modelDraft:{focusAreas:unknown[];checklistFocus:unknown[];
    predictedDeficiencies:{category:string;hypothesisOnly:true;evidenceIds:string[]}[];
    suggestedAdditionalItems:unknown[];missingEvidence:string[]}|null;
   supervisorReview:unknown};
 };
 missingEvidence:string[];
 readiness:{preparationSaved:boolean;aiGenerated:boolean;aiReviewed:boolean;
  liveBookingConfirmed:boolean};aiCallsOnGet:0;
}
@Component({
 selector:'app-si-my-work-orders',standalone:true,
 imports:[CommonModule,RouterLink,NmcNavigationComponent],
 template:`
 <div class="page" [attr.dir]="lang.dir"><app-nmc-navigation></app-nmc-navigation>
 <main class="main">
  <header class="hero">
   <div><small>MOEI · SMART INSPECTION · INSPECTOR WORK ORDERS</small>
    <h1>{{t('My Inspection Work Orders','أوامر تكليف المعاينات الخاصة بي')}}</h1>
    <p>{{t('Your signed-in identity controls which vessels you can view and execute. Preview any assigned vessel to open its evidence-backed dossier.',
     'حسابك المسجل هو الذي يحدد السفن المسندة إليك. قف على سفينة أو اخترها لعرض الدوسيه الكامل والأدلة قبل التنفيذ.')}}</p>
   </div>
   <div class="header-actions">
    <button type="button" (click)="load()" [disabled]="busy||loading">{{t('Refresh Assignments','تحديث أوامر التكليف')}}</button>
    <a routerLink="/moei/smart-inspection/scheduling">{{t('Scheduling','الجدولة')}}</a>
   </div>
  </header>
  <p *ngIf="error" class="status danger" role="alert">{{error}}</p>
  <p *ngIf="message" class="status good" role="status">{{message}}</p>
  <section class="overview">
   <div><small>{{t('Assigned to me','مسندة إليّ')}}</small><strong>{{orders.length}}</strong></div>
   <div><small>{{t('Ready for execution','جاهزة للتنفيذ')}}</small><strong>{{statusCount('READY_FOR_FIELD')}}</strong></div>
   <div><small>{{t('Awaiting preparation','بانتظار التجهيز')}}</small><strong>{{preparationCount}}</strong></div>
   <div><small>{{t('Awaiting supervisor','بانتظار اعتماد المشرف')}}</small><strong>{{statusCount('READY_FOR_SCOPE_REVIEW')}}</strong></div>
   <div><small>{{t('Field in progress','قيد المعاينة')}}</small><strong>{{statusCount('FIELD_STARTED')}}</strong></div>
  </section>
  <p class="poc" *ngIf="me?.inspectorPocId">
   <b>{{t('Your POC engineer identity','هويتك التجريبية كمهندس')}}</b>:
   <code>{{me?.inspectorPocId}}</code> ·
   {{t('Added only to synthetic scheduling when POC demo mode is used. Official ERP access still requires the authorised identity map.',
    'تدخل ضمن المهندسين التجريبيين عند تشغيل الجدولة بوضع POC فقط؛ الإسناد الرسمي يتطلب ربط حسابك برقم المفتش في ERP.')}}</p>
  <div class="workspace">
   <section class="assignments" aria-label="My assigned vessels">
    <h2>{{t('My Assigned Vessels','السفن المكلف بمعاينتها')}}</h2>
    <p *ngIf="loading">{{t('Loading orders…','جارٍ تحميل الأوامر…')}}</p>
    <button type="button" class="vessel"
     *ngFor="let o of orders;let i=index"
     [class.active]="selected?.orderId===o.orderId"
     (click)="select(o)">
      <span class="vessel-icon">🚢</span>
      <span class="vessel-body">
       <b>{{o.vesselName||('IMO '+o.imo)}}</b>
       <small>IMO {{o.imo}} · {{o.assignment.portName}}</small>
       <small>{{o.assignment.startLocal||o.assignment.startUtc}}</small>
       <em [class.progress]="o.status==='FIELD_STARTED'">{{statusLabel(o.status)}}</em>
      </span>
      <span class="number">{{i+1}}</span>
    </button>
    <p class="empty" *ngIf="!orders.length&&!loading">
     {{t('No approved work orders match your signed-in inspector ID yet. For this POC, use scheduling Demo Mode so your account appears as a synthetic qualified engineer, and issue a new approved work-order plan.',
      'لا توجد أوامر تكليف معتمدة مرتبطة بحسابك بعد. في الـPOC اختر Demo Mode عند توزيع المهندسين ثم اعتمد الجدولة؛ سيظهر حسابك كمهندس تجريبي لتوزيع الأوامر الجديدة.')}}</p>
   </section>
   <section class="dossier">
    <ng-container *ngIf="selected as o;else intro">
     <div class="dossier-top"><div>
      <small>{{t('SELECTED VESSEL · EVIDENCE DOSSIER','دوسيه السفينة المختارة')}}</small>
      <h2>{{o.vesselName||('IMO '+o.imo)}}</h2>
      <p>IMO {{o.imo}} · {{o.assignment.portName}} · {{o.assignment.startLocal||o.assignment.startUtc}}</p>
      <span class="status-pill">{{statusLabel(o.status)}}</span>
     </div><span class="meta">{{o.mode==='POC_MOCK'?'POC · DEMO ERP':'ERP · EXCEL POC'}}</span></div>
     <section class="prep-entry" aria-label="Inspection preparation actions">
      <div class="prep-entry-text">
       <small>{{t('INSPECTION PREPARATION · STEP 1','تجهيز المعاينة · الخطوة الأولى')}}</small>
       <strong>{{canActivate(o)?
        t('Prepare mandatory checklist and vessel evidence','تجهيز القائمة الإلزامية وأدلة السفينة'):
        t('Mandatory checklist and case preparation','القائمة الإلزامية وتجهيز ملف المعاينة')}}</strong>
       <p>{{t('The original mandatory checklist is prepared independently of AI. A04 suggestions remain optional hypotheses requiring human review.',
        'يتم تجهيز القائمة الإلزامية الأصلية دون الاعتماد على AI، وتظل مقترحات A04 احتمالات اختيارية تتطلب مراجعة بشرية.')}}</p>
      </div>
      <div class="prep-entry-actions">
       <button *ngIf="canActivate(o)" class="prep-primary" type="button"
        (click)="activate(o)" [disabled]="busy">
        {{t('1 · Prepare Inspection','١ · تجهيز المعاينة')}}
       </button>
       <a *ngIf="o.caseId&&auth.isAdmin" class="prep-primary"
        [routerLink]="['/moei/smart-inspection/preparation',o.caseId]">
        {{t('Open Preparation & A04 AI','فتح التجهيز وتحليل A04')}}
       </a>
       <span *ngIf="o.caseId&&!auth.isAdmin" class="prep-supervisor">
        {{t('A04 requires an authorized admin. Your assigned vessel dossier is available below.',
         'تحليل A04 يتطلب مسؤولًا مخوّلًا، ودوسيه السفينة المسندة متاح أدناه.')}}
       </span>
      </div>
     </section>
     <div class="buttons">
      <button *ngIf="o.status==='READY_FOR_FIELD'" type="button" (click)="execute(o)"
       [disabled]="busy">{{t('Execute Work Order','تنفيذ أمر التكليف')}}</button>
      <button *ngIf="o.status==='FIELD_STARTED'" type="button" (click)="continue(o)">
       {{t('Continue Guided Inspection','استكمال خطوات المعاينة')}}</button>
      <a *ngIf="o.status==='READY_FOR_SCOPE_REVIEW'"
       [routerLink]="['/moei/smart-inspection/scheduling/plan',o.planId]">
        {{t('Supervisor: Approve Scope','المشرف: اعتماد نطاق المعاينة')}}</a>
      <a *ngIf="o.caseId&&o.checklistStatus==='MANDATORY_PUBLISHED_TEMPLATE_SNAPSHOT'"
       [routerLink]="['/moei/smart-inspection/checklists',o.caseId]">
       {{t('Published Checklist Details','تفاصيل القائمة المنشورة')}}</a>
     </div>
     <p *ngIf="loadingDossier" class="status">{{t('Opening full vessel dossier…','جارٍ فتح ملف السفينة الكامل…')}}</p>
     <ng-container *ngIf="dossier as d">
      <div class="warning" *ngIf="!d.caseId">
       {{t('Work order issued, but inspection preparation has not started. No inspection case or mandatory checklist snapshot exists yet. Optional A04 analysis is a separate, explicitly confirmed step.',
         'صدر أمر التكليف لكن تجهيز المعاينة لم يبدأ. لم تُنشأ حالة المعاينة أو لقطة القائمة الإلزامية بعد. تحليل A04 اختياري ويتطلب تأكيدًا مستقلًا.')}}</div>
      <div class="process-guide" role="status">
       <strong>{{t('Next business step','الخطوة التالية')}}</strong>
       <p *ngIf="canActivate(o)">{{t('Prepare the source dossier and mandatory checklist first. No AI call will be made by this button.',
        'جهّز ملف المصادر والقائمة الإلزامية أولًا. هذا الزر لا يستدعي الذكاء الاصطناعي.')}}</p>
       <p *ngIf="o.status==='READY_FOR_SCOPE_REVIEW'">{{t('Preparation is complete. A supervisor must review and approve the inspection scope before field execution.',
        'اكتمل التجهيز. يجب أن يراجع المشرف نطاق المعاينة ويعتمده قبل التنفيذ الميداني.')}}</p>
       <p *ngIf="o.status==='READY_FOR_FIELD'">{{t('Scope approved. The assigned inspector can begin the field inspection.',
        'تم اعتماد النطاق. يمكن للمفتش المسند إليه بدء المعاينة الميدانية.')}}</p>
       <p *ngIf="o.status==='FIELD_STARTED'">{{t('Field inspection is in progress. Continue the guided checklist and record evidence.',
        'المعاينة الميدانية جارية. استكمل القائمة الإرشادية وسجل الأدلة.')}}</p>
      </div>
      <div class="dossier-grid">
       <div class="fact"><small>{{t('Flag','العلم')}}</small><b>{{d.sections.identity.flag||'—'}}</b></div>
       <div class="fact"><small>{{t('Vessel Type','نوع السفينة')}}</small><b>{{d.sections.identity.vesselType||'—'}}</b></div>
       <div class="fact"><small>{{t('Saved NMC Risk','المخاطر المحفوظة')}}</small>
         <b>{{d.sections.risk?.score??'—'}} · {{d.sections.risk?.level||''}}</b></div>
       <div class="fact"><small>{{t('AI A04','ذكاء A04')}}</small>
         <b>{{d.sections.aiAnalysis.status}}</b></div>
      </div>
      <div class="evidence">
       <details open>
        <summary>{{t('Inspection assignment and scope','التكليف ونطاق المعاينة')}}</summary>
        <div class="record-grid">
         <div class="record-field"><small>{{t('Inspector','المفتش')}}</small>
          <strong>{{d.sections.assignments?.inspectorName||o.assignment.inspectorName}}</strong></div>
         <div class="record-field"><small>{{t('Port','الميناء')}}</small>
          <strong>{{d.sections.assignments?.portName||o.assignment.portName}}</strong></div>
         <div class="record-field"><small>{{t('Scheduled visit','موعد الزيارة')}}</small>
          <strong>{{d.sections.assignments?.startLocal||o.assignment.startLocal||o.assignment.startUtc}}</strong></div>
         <div class="record-field"><small>{{t('End of visit','نهاية الزيارة')}}</small>
          <strong>{{d.sections.assignments?.endLocal||'—'}}</strong></div>
         <div class="record-field"><small>{{t('Work order','حالة أمر التكليف')}}</small>
          <strong>{{statusLabel(o.status)}}</strong></div>
         <div class="record-field"><small>{{t('Live ERP booking','حجز ERP فعلي')}}</small>
          <strong>{{d.sections.assignments?.liveErpBookingConfirmed?
            t('Confirmed by source','مؤكد من المصدر'):t('Not confirmed','غير مؤكد')}}</strong></div>
        </div>
       </details>
       <details open>
        <summary>{{t('Why this vessel was selected','أسباب اختيار السفينة للمعاينة')}}
         ({{d.sections.referrals.allSourceReasons.length}})</summary>
        <p class="empty" *ngIf="!d.sections.referrals.allSourceReasons.length">
         {{t('No source referral reasons were included in this dossier.',
          'لا توجد أسباب إحالة مسجلة في ملف المصادر هذا.')}}</p>
        <article class="record-item" *ngFor="let item of d.sections.referrals.allSourceReasons">
         <div class="record-row" *ngFor="let field of recordFields(item)">
          <span>{{field.label}}</span><strong>{{field.value}}</strong></div>
        </article>
        <ng-container *ngIf="d.sections.referrals.objectives?.length">
         <h4>{{t('Inspection objectives','أهداف المعاينة')}}</h4>
         <article class="record-item" *ngFor="let item of d.sections.referrals.objectives">
          <div class="record-row" *ngFor="let field of recordFields(item)">
           <span>{{field.label}}</span><strong>{{field.value}}</strong></div>
         </article>
        </ng-container>
       </details>
       <details>
        <summary>{{t('Certificates and validity','الشهادات وصلاحيتها')}}
         ({{d.sections.sourceEvidence.certificates.length}})</summary>
        <p class="empty" *ngIf="!d.sections.sourceEvidence.certificates.length">
         {{t('No certificates are available in the saved source bundle.',
          'لا توجد شهادات متاحة ضمن حزمة المصادر المحفوظة.')}}</p>
        <article class="record-item" *ngFor="let item of d.sections.sourceEvidence.certificates">
         <div class="record-row" *ngFor="let field of recordFields(item)">
          <span>{{field.label}}</span><strong>{{field.value}}</strong></div>
        </article>
       </details>
       <details>
        <summary>{{t('Historical inspections','المعاينات السابقة')}}
         ({{d.sections.sourceEvidence.inspectionHistory.length}})</summary>
        <p class="empty" *ngIf="!d.sections.sourceEvidence.inspectionHistory.length">
         {{t('No inspection history was supplied in this source bundle.',
          'لم يُقدّم سجل معاينات سابقة في حزمة المصادر هذه.')}}</p>
        <article class="record-item" *ngFor="let item of d.sections.sourceEvidence.inspectionHistory">
         <div class="record-row" *ngFor="let field of recordFields(item)">
          <span>{{field.label}}</span><strong>{{field.value}}</strong></div>
        </article>
       </details>
       <details>
        <summary>{{t('Open deficiencies / findings','الملاحظات السابقة المفتوحة')}}
         ({{d.sections.sourceEvidence.openDeficiencies.length}})</summary>
        <p class="empty" *ngIf="!d.sections.sourceEvidence.openDeficiencies.length">
         {{t('No open findings were supplied in this source bundle.',
          'لم تُقدّم ملاحظات مفتوحة في حزمة المصادر هذه.')}}</p>
        <article class="record-item" *ngFor="let item of d.sections.sourceEvidence.openDeficiencies">
         <div class="record-row" *ngFor="let field of recordFields(item)">
          <span>{{field.label}}</span><strong>{{field.value}}</strong></div>
        </article>
       </details>
       <details>
        <summary>{{t('Documents and evidence references','المستندات ومراجع الأدلة')}}
         ({{d.sections.sourceEvidence.documents.length}})</summary>
        <p class="empty" *ngIf="!d.sections.sourceEvidence.documents.length">
         {{t('No human-reviewed external documents are currently linked.',
          'لا توجد مستندات خارجية تمت مراجعتها بشريًا ومرتبطة حاليًا.')}}</p>
        <article class="record-item" *ngFor="let item of d.sections.sourceEvidence.documents">
         <div class="record-row" *ngFor="let field of recordFields(item)">
          <span>{{field.label}}</span><strong>{{field.value}}</strong></div>
        </article>
        <h4>{{t('Evidence references','مراجع الأدلة')}}</h4>
        <p class="empty" *ngIf="!d.sections.sourceEvidence.evidenceManifestRefs.length">
         {{t('No evidence references available.','لا تتوفر مراجع أدلة.')}}</p>
        <div class="evidence-tags">
         <span *ngFor="let ref of d.sections.sourceEvidence.evidenceManifestRefs">{{ref}}</span>
        </div>
        <p class="source-note">{{d.sections.sourceEvidence.externalDocumentsVerified?
         t('External document verification recorded','تم توثيق مراجعة المستندات الخارجية'):
         t('External document authenticity not verified','لم يتم توثيق صحة المستندات الخارجية')}}</p>
       </details>
       <details>
        <summary>{{t('Saved vessel movement & tracking','حركة السفينة والتتبع')}}</summary>
        <div class="record-item" *ngIf="d.sections.sourceEvidence.tracking;else noTracking">
         <div class="record-row" *ngFor="let field of recordFields(d.sections.sourceEvidence.tracking)">
          <span>{{field.label}}</span><strong>{{field.value}}</strong></div>
        </div>
        <ng-template #noTracking><p class="empty">
         {{t('No verified movement or tracking record is available in this dossier.',
          'لا يوجد سجل حركة أو تتبع موثق متاح في هذا الملف.')}}</p></ng-template>
       </details>
       <details>
        <summary>{{t('Mandatory checklist and optional A04','القائمة الإلزامية وA04 الاختياري')}}</summary>
        <div class="record-grid">
         <div class="record-field"><small>{{t('Published checklist snapshot','لقطة القائمة المنشورة')}}</small>
          <strong>{{d.sections.inspectionChecklist.publishedTemplateSnapshotPresent?
           t('Available','متاحة'):t('Not prepared','لم تُجهّز')}}</strong></div>
         <div class="record-field"><small>{{t('Checklist status','حالة القائمة')}}</small>
          <strong>{{d.sections.inspectionChecklist.checklistStatus||'—'}}</strong></div>
         <div class="record-field"><small>{{t('A04 analysis','تحليل A04')}}</small>
          <strong>{{d.sections.aiAnalysis.status}}</strong></div>
        </div>
        <p class="source-note">{{t('AI suggestions never replace mandatory inspection items or become findings without inspector verification.',
         'مقترحات الذكاء الاصطناعي لا تستبدل البنود الإلزامية ولا تصبح ملاحظات مؤكدة دون تحقق المفتش.')}}</p>
        <h4>{{t('Mandatory checklist references','مراجع القائمة الإلزامية')}}</h4>
        <p class="empty" *ngIf="!d.sections.inspectionChecklist.mandatoryBaseItemIds.length">
         {{t('Mandatory checklist will appear after preparation.',
          'ستظهر القائمة الإلزامية بعد التجهيز.')}}</p>
        <div class="evidence-tags">
         <span *ngFor="let ref of d.sections.inspectionChecklist.mandatoryBaseItemIds">{{ref}}</span>
        </div>
        <ng-container *ngIf="d.sections.aiAnalysis.modelDraft as ai">
         <h4>{{t('A04 suggested focus areas','مجالات التركيز المقترحة من A04')}}</h4>
         <p class="empty" *ngIf="!ai.focusAreas.length">
          {{t('No optional A04 focus areas.','لا توجد مجالات تركيز مقترحة.')}}</p>
         <article class="record-item" *ngFor="let item of ai.focusAreas">
          <div class="record-row" *ngFor="let field of recordFields(item)">
           <span>{{field.label}}</span><strong>{{field.value}}</strong></div>
         </article>
         <h4>{{t('A04 potential deficiencies — not confirmed findings',
           'ملاحظات محتملة من A04 — ليست مخالفات مؤكدة')}}</h4>
         <p class="empty" *ngIf="!ai.predictedDeficiencies?.length">
          {{t('No potential deficiencies suggested. The original mandatory checklist remains unchanged.',
           'لا توجد مخالفات محتملة مقترحة. تظل القائمة الإلزامية الأصلية كاملة دون تغيير.')}}</p>
         <article class="record-item" *ngFor="let item of ai.predictedDeficiencies">
          <strong>{{t('AI hypothesis only · Inspector verification required',
           'احتمال مقترح من AI فقط · يلزم تحقق المفتش')}}</strong>
          <div class="record-row" *ngFor="let field of recordFields(item)">
           <span>{{field.label}}</span><strong>{{field.value}}</strong></div>
         </article>
         <h4>{{t('A04 recommended checklist additions — review status above',
           'إضافات القائمة المقترحة من A04 — حالة المراجعة موضحة بالأعلى')}}</h4>
         <p class="empty" *ngIf="!ai.suggestedAdditionalItems.length">
          {{t('No optional checklist additions.','لا توجد إضافات مقترحة.')}}</p>
         <article class="record-item" *ngFor="let item of ai.suggestedAdditionalItems">
          <div class="record-row" *ngFor="let field of recordFields(item)">
           <span>{{field.label}}</span><strong>{{field.value}}</strong></div>
         </article>
        </ng-container>
       </details>
       <details *ngIf="d.missingEvidence.length">
        <summary>{{t('Missing / unverified source data','بيانات ناقصة أو غير موثقة')}}
         ({{d.missingEvidence.length}})</summary>
        <p class="source-note" *ngFor="let gap of d.missingEvidence">{{missingEvidenceLabel(gap)}}</p>
       </details>
      </div>
     </ng-container>
    </ng-container>
    <ng-template #intro><div class="placeholder"><span>⚓</span>
     <h2>{{t('Select or hover over an assigned vessel','اختر سفينة أو قف عليها بالمؤشر')}}</h2>
     <p>{{t('The read-only dossier will display vessel records, source referrals, saved risk, certificates, history, deficiencies, AI A04 and the frozen checklist when available.',
       'سيظهر الدوسيه للقراءة فقط شاملاً بيانات السفينة والمصادر والمخاطر والشهادات والتاريخ والملاحظات وتحليل A04 والقائمة المثبتة عند توفرها.')}}</p>
    </div></ng-template>
   </section>
  </div>
 </main></div>`,
 styles:[`
 :host{display:block;min-height:100vh;background:#edf4f7;color:#123a50}
 .main{margin-inline-start:240px;padding:26px;max-width:1640px}
 .hero{display:flex;justify-content:space-between;gap:20px;background:#fff;border:1px solid #d8e8ed;
  padding:25px;border-radius:15px;margin-bottom:15px}.hero small{font-size:11px;color:#168b83;font-weight:800}
 .hero h1{font-size:25px;margin:10px 0}.hero p{max-width:830px;font-size:12px;color:#688491}
 .header-actions,.buttons{display:flex;gap:9px;align-items:center;flex-wrap:wrap}
 button,.buttons a,.header-actions a{border:1px solid #bddadd;background:#eaf7f7;color:#096c75;
  border-radius:8px;padding:10px 12px;text-decoration:none;cursor:pointer;font-weight:700;font-size:12px}
 button:disabled{opacity:.5;cursor:not-allowed}.buttons button{background:#077e76;color:#fff}
 .overview{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px;margin-bottom:15px}
 .overview div{padding:14px;background:#fff;border:1px solid #d8e8ed;border-radius:12px}
 .overview small,.overview strong{display:block}.overview small{color:#8197a3;font-size:11px}
 .overview strong{font-size:27px;color:#116575;margin-top:7px}
 .poc,.status,.warning{padding:12px;background:#eff9f7;border:1px solid #abdcd3;border-radius:10px;
  font-size:12px;color:#17685f}.poc code{font-size:11px}
 .danger{background:#ffeded;color:#a03939;border-color:#e9b7b7}.good{background:#eaf9f0;color:#226e4c}
 .warning{background:#fff7e9;color:#805b26;border-color:#ead6ac}
 .process-guide{margin:12px 0;padding:12px 15px;border-radius:10px;
  background:#ecf7f7;border:1px solid #c7e4e3;font-size:12px;color:#1b5b63}
 .process-guide strong{display:block;font-size:12px}.process-guide p{margin:6px 0 0;line-height:1.6}
 .workspace{display:grid;grid-template-columns:370px minmax(0,1fr);align-items:start;gap:17px}
 .assignments,.dossier{background:#fff;border:1px solid #d8e8ed;border-radius:14px;padding:16px}
 .assignments h2{font-size:17px;margin:2px 0 14px}
 .vessel{display:flex;text-align:start;align-items:start;gap:12px;width:100%;padding:14px;background:#fff;
  color:inherit;border:1px solid #e2ecee;margin:0 0 9px;border-radius:10px}
 .vessel.active,.vessel:hover{background:#eaf8f7;border-color:#81c9c0}
 .vessel-icon{font-size:19px}.vessel-body{flex:1;min-width:0}.vessel-body b,.vessel-body small,
 .vessel-body em{display:block}.vessel-body b{font-size:13px}.vessel-body small{font-size:10px;
  color:#74919d;margin:5px 0}.vessel-body em{font-style:normal;font-size:10px;color:#b47824}
 .vessel-body em.progress{color:#068977}.number{font-size:11px;color:#9bb1b8}
 .dossier{padding:22px;min-height:450px}.dossier-top{display:flex;justify-content:space-between}
 .dossier-top small{font-size:11px;color:#118b82;font-weight:700}.dossier-top h2{font-size:21px;margin:8px 0}
 .dossier-top p{font-size:12px;color:#7193a0}.meta{font-size:11px;color:#849da5}
 .status-pill{font-size:11px;background:#eaf6ed;border-radius:12px;padding:5px 9px;color:#2b7653}
 .prep-entry{display:flex;align-items:center;justify-content:space-between;gap:18px;
  flex-wrap:wrap;padding:20px;margin:18px 0 12px;border-radius:12px;
  border:2px solid #0c827a;background:#f0fbfa}
 .prep-entry-text{flex:1;min-width:230px}.prep-entry-text small{color:#077e76;font-weight:800;font-size:11px}
 .prep-entry-text strong{display:block;margin:7px 0;font-size:16px;color:#124c57}
 .prep-entry-text p{margin:0;line-height:1.6;color:#567783;font-size:12px}
 .prep-entry-actions{display:flex;flex-direction:column;gap:8px;min-width:210px}
 .prep-entry-actions .prep-primary{display:block;text-align:center;padding:13px 17px;
  color:white;background:#087c75;border:1px solid #087c75;
  border-radius:9px;font-size:13px;font-weight:800;text-decoration:none}
 .prep-entry-actions button:disabled{opacity:.5;cursor:not-allowed}
 .prep-supervisor{color:#647a85;font-size:11px;line-height:1.6;max-width:290px}
 .buttons{margin:18px 0}.dossier-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:15px 0}
 .fact{background:#f3f9fa;padding:13px;border-radius:10px}.fact small,.fact b{display:block}
 .fact small{font-size:10px;color:#7899a2}.fact b{font-size:12px;margin-top:7px;color:#17566d}
 details{border:1px solid #dae8ed;border-radius:10px;margin:9px 0;padding:11px 14px}
 summary{font-size:12px;font-weight:800;color:#216b79;cursor:pointer}
 details p{font-size:12px;color:#6b8392}
 .record-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:10px}
 .record-field{padding:11px 12px;border-radius:8px;background:#f4f9fa;min-width:0}
 .record-field small,.record-field strong{display:block;overflow-wrap:anywhere}
 .record-field small{font-size:11px;color:#6c8998;margin-bottom:6px}
 .record-field strong{font-size:12px;color:#255a6a}
 .record-item{background:#f7fbfc;border:1px solid #e2edf0;border-radius:9px;
  padding:10px 13px;margin:8px 0}
 .record-row{display:grid;grid-template-columns:minmax(110px,170px) minmax(0,1fr);
  align-items:start;gap:12px;padding:6px 0;border-bottom:1px solid #e9eff2}
 .record-row:last-child{border-bottom:none}
 .record-row span{font-size:11px;color:#708999}
 .record-row strong{font-size:12px;overflow-wrap:anywhere;font-weight:600;color:#245668}
 .evidence h4{font-size:12px;color:#286b75;margin:16px 0 8px}
 .evidence-tags{display:flex;gap:7px;flex-wrap:wrap;margin:8px 0 12px}
 .evidence-tags span{font-size:11px;overflow-wrap:anywhere;padding:5px 8px;
  border-radius:7px;border:1px solid #c9e2e7;background:#edf7f9;color:#246977}
 .source-note{font-size:11px;line-height:1.7;overflow-wrap:anywhere;color:#637f8c}
 @media(max-width:600px){.record-grid{grid-template-columns:1fr}
  .record-row{grid-template-columns:1fr;gap:2px}}
 .empty{font-size:12px;color:#637f8c;line-height:1.8}
 .placeholder{text-align:center;margin:75px auto;color:#7291a0;max-width:400px}
 .placeholder span{font-size:45px}.placeholder h2{font-size:19px;color:#28536a}
 .placeholder p{font-size:12px;line-height:1.8}
 @media(max-width:1180px){.workspace{grid-template-columns:300px 1fr}.dossier-grid{grid-template-columns:repeat(2,1fr)}.overview{grid-template-columns:repeat(3,minmax(0,1fr))}}
 @media(max-width:980px){.main{margin:0;padding:13px}.workspace{grid-template-columns:1fr}
  .overview{grid-template-columns:repeat(2,1fr)}.hero{flex-wrap:wrap}}
 `]
})
export class SiMyWorkOrdersComponent implements OnInit{
 orders:AssignedOrder[]=[];selected:AssignedOrder|null=null;
 dossier:Dossier|null=null;me:{session:string;inspectorPocId:string|null}|null=null;
 loading=false;busy=false;loadingDossier=false;error='';message='';
 private readonly api='/api/si/v1/maritime-scheduling/';
 private cache:Record<string,Dossier>={};
 private dossierRequestId=0;
 constructor(private readonly http:HttpClient,private readonly router:Router,
  public readonly lang:LanguageService,public readonly auth:MoeiAuthService){}
 t(en:string,ar:string):string{return this.lang.pick(en,ar);}
 ngOnInit():void{this.load();}
 statusCount(s:string):number{return this.orders.filter(x=>x.status===s).length;}

 recordFields(record:unknown):Array<{label:string;value:string}>{
  if(record===null||record===undefined)return [];
  if(Array.isArray(record))return record.map((v,i)=>({
   label:this.t('Item '+(i+1),'بند '+(i+1)),value:this.readable(v)}));
  if(typeof record!=='object')return [{
   label:this.t('Value','القيمة'),value:this.readable(record)}];
  return Object.entries(record as Record<string,unknown>)
   .filter(([,value])=>value!==null&&value!==undefined)
   .map(([key,value])=>({label:this.fieldLabel(key),value:this.readable(value)}));
 }
 private fieldLabel(key:string):string{
  const labels:Record<string,[string,string]>={
   sourceType:['Source','المصدر'],sourceReference:['Source reference','مرجع المصدر'],
   inspectionRegime:['Inspection type','نوع المعاينة'],
   narrative:['Inspection reason','سبب المعاينة'],
   evidenceIds:['Evidence IDs','معرفات الأدلة'],
   sourceApproval:['Source approval','اعتماد المصدر'],
   eventKey:['Source event key','معرف حدث المصدر'],
   documentType:['Document type','نوع المستند'],reviewStatus:['Review status','حالة المراجعة'],
   startLocal:['Start (UAE)','البداية (الإمارات)'],
   endLocal:['End (UAE)','النهاية (الإمارات)'],
   status:['Status','الحالة'],description:['Description','الوصف'],
   id:['Record ID','معرف السجل'],imo:['IMO','رقم IMO'],
   departureAt:['Departure','المغادرة'],arrivalAt:['Arrival','الوصول']
  };
  const known=labels[key];if(known)return this.t(known[0],known[1]);
  return key.replace(/([a-z])([A-Z])/g,'$1 $2').replaceAll('_',' ')
   .replace(/\b[a-z]/g,x=>x.toUpperCase());
 }
 private readable(value:unknown,depth=0):string{
  if(value===null||value===undefined||value==='')return '—';
  if(typeof value==='boolean')return value?this.t('Yes','نعم'):this.t('No','لا');
  if(typeof value==='string'||typeof value==='number')return String(value);
  if(depth>3)return this.t('Nested source detail','بيانات مصدر متداخلة');
  if(Array.isArray(value))return value.length?
   value.map(item=>this.readable(item,depth+1)).join(' · '):'—';
  if(typeof value==='object'){
   const fields=Object.entries(value as Record<string,unknown>)
    .filter(([,v])=>v!==null&&v!==undefined);
   return fields.length?fields.map(([k,v])=>
    this.fieldLabel(k)+': '+this.readable(v,depth+1)).join(' · '):'—';
  }
  return '—';
 }
 missingEvidenceLabel(code:string):string{
  const descriptions:Record<string,[string,string]>={
   INSPECTION_CASE_NOT_ACTIVATED:['Inspection case not prepared','لم يتم تجهيز حالة المعاينة'],
   PREPARATION_AND_PINNED_CHECKLIST_NOT_CREATED:['Mandatory checklist not prepared','لم يتم تجهيز القائمة الإلزامية'],
   A04_ADVISORY_NOT_YET_PREPARED:['Optional A04 analysis not requested','لم يُطلب تحليل A04 الاختياري'],
   NO_CERTIFICATE_RECORDS_IN_SOURCE_BUNDLE:['No certificates in saved sources','لا توجد شهادات في المصادر المحفوظة'],
   NO_HISTORICAL_INSPECTIONS_IN_SOURCE_BUNDLE:['No historical inspections in saved sources','لا توجد معاينات سابقة في المصادر'],
   NO_HUMAN_REVIEWED_EXTERNAL_DOCUMENTS:['No externally reviewed documents','لا توجد مستندات تمت مراجعتها بشريًا'],
   EXTERNAL_DOCUMENT_AUTHENTICITY_NOT_VERIFIED:['External documents not verified','لم يتم التحقق من صحة المستندات الخارجية'],
   PUBLISHED_CHECKLIST_TEMPLATE_NOT_VERIFIED:['Published mandatory checklist not yet verified','لم يتم التحقق من القائمة الإلزامية المنشورة'],
   A04_AI_NOT_GENERATED_OR_NOT_ALLOWED:['A04 not generated or unavailable','لم يتم إنشاء تحليل A04 أو أنه غير متاح'],
   A04_AI_SUPERVISOR_REVIEW_PENDING:['A04 needs supervisor review','تحليل A04 يحتاج مراجعة المشرف'],
   DOSSIER_SOURCE_SNAPSHOT_STALE:['Source dossier requires refresh','ملف المصادر يحتاج تحديثًا'],
   CURRENT_SAVED_NMC_RISK_NOT_AVAILABLE:['Saved vessel risk unavailable','مخاطر السفينة المحفوظة غير متاحة']
  };
  const pair=descriptions[code];return pair?this.t(pair[0],pair[1]):
   code.replaceAll('_',' ').toLowerCase();
 }

 get preparationCount():number{
  return this.orders.filter(x=>['ISSUED','PREPARING','PREPARATION_NEEDS_REVIEW'].includes(x.status)).length;
 }
 statusLabel(status:string):string{
  return ({ISSUED:this.t('Issued','صدر الأمر'),
   PREPARING:this.t('Preparing','جارٍ التجهيز'),
   PREPARATION_NEEDS_REVIEW:this.t('Preparation needs review','التجهيز يحتاج مراجعة'),
   READY_FOR_SCOPE_REVIEW:this.t('Scope approval needed','في انتظار اعتماد النطاق'),
   READY_FOR_FIELD:this.t('Ready for inspection','جاهز للمعاينة'),
   FIELD_STARTED:this.t('In field','المعاينة جارية')} as Record<string,string>)[status]||status;
 }
 canActivate(o:AssignedOrder):boolean{
  return ['ISSUED','PREPARING','PREPARATION_NEEDS_REVIEW'].includes(o.status);
 }
 load():void{
  if(this.loading)return;
  this.loading=true;this.error='';
  const previousOrderId=this.selected?.orderId||null;
  this.http.get<{orders:AssignedOrder[];me:{session:string;inspectorPocId:string|null}}>(
    this.api+'my-work-orders').subscribe({
   next:r=>{
    this.loading=false;this.orders=r.orders||[];this.me=r.me||null;
    // Refresh also refreshes the selected dossier rather than continuing
    // to display a cached pre-activation or pre-supervisor snapshot.
    this.dossierRequestId++;this.cache={};this.dossier=null;
    this.selected=null;this.loadingDossier=false;
    const previous=previousOrderId?this.orders.find(x=>x.orderId===previousOrderId):null;
    if(previous)this.select(previous);
   },
   error:e=>{this.loading=false;this.error=e?.error?.error||'SI_ORDERS_UNAVAILABLE';}
  });
 }
 select(o:AssignedOrder):void{
  if(this.selected?.orderId===o.orderId&&(this.dossier||this.loadingDossier))return;
  const requestId=++this.dossierRequestId;
  this.selected=o;this.error='';this.dossier=this.cache[o.orderId]||null;
  if(this.dossier){this.loadingDossier=false;return;}
  this.loadingDossier=true;
  this.http.get<Dossier>(this.api+'my-work-orders/'+o.orderId+'/dossier').subscribe({
   next:d=>{
    this.cache[o.orderId]=d;
    if(requestId!==this.dossierRequestId)return;
    this.dossier=d;this.loadingDossier=false;
   },
   error:e=>{
    if(requestId!==this.dossierRequestId)return;
    this.loadingDossier=false;
    this.error=e?.error?.error||'SI_DOSSIER_UNAVAILABLE';
   }
  });
 }
 activate(o:AssignedOrder):void{
  if(this.busy||!this.canActivate(o)||!window.confirm(this.t(
   'Prepare this assigned inspection: create/link its POC case and pin the mandatory published checklist? This action makes NO A04 AI call. Optional A04 can be requested later on the Preparation page with separate consent; supervisor scope approval remains required.',
   'هل تريد تجهيز المعاينة المسندة إليك بإنشاء/ربط حالة POC وتثبيت القائمة الإلزامية المنشورة؟ لن يستدعي هذا الإجراء A04. يمكن طلب A04 لاحقًا من شاشة التجهيز بموافقة مستقلة، ويظل اعتماد النطاق من اختصاص المشرف.')))return;
  this.busy=true;this.error='';
  this.http.post<{order:AssignedOrder}>(
   this.api+'my-work-orders/'+o.orderId+'/activate',
   {generateAi:false,confirmAiCost:false}
  ).subscribe({
   next:r=>{this.busy=false;const updated=this.replaceOrder(r.order);
    this.message=this.t('Inspection dossier and mandatory checklist prepared. A04 remains optional. Supervisor approval of the scope is required before field start.',
      'تم تجهيز ملف المعاينة والقائمة الإلزامية، وA04 يظل اختياريًا. يلزم اعتماد نطاق المعاينة من المشرف قبل التنفيذ.');
    if(updated)this.loadDossierFresh(updated);},
   error:e=>{this.busy=false;this.error=e?.error?.error||'SI_ORDER_PREPARATION_FAILED';}
  });
 }
 execute(o:AssignedOrder):void{
  if(this.busy||o.status!=='READY_FOR_FIELD'||!window.confirm(this.t(
   'Start this assigned inspection under your signed-in engineer identity?',
   'بدء تنفيذ أمر التكليف بهويتك المرتبطة بالمهندس المسند إليه؟')))return;
  this.busy=true;this.error='';
  this.http.post<{order:AssignedOrder}>(
   this.api+'my-work-orders/'+o.orderId+'/start',
   {confirmPocDelegation:false}
  ).subscribe({
   next:r=>{this.busy=false;this.replaceOrder(r.order);
    void this.router.navigate(['/moei/smart-inspection/my-work-orders',
      o.orderId,'execute']);},
   error:e=>{this.busy=false;this.error=e?.error?.error||'SI_ORDER_EXECUTION_FAILED';}
  });
 }
 continue(o:AssignedOrder):void{
  void this.router.navigate(['/moei/smart-inspection/my-work-orders',
   o.orderId,'execute']);
 }
 private replaceOrder(server:AssignedOrder&{id?:string}):AssignedOrder|null{
  // Work-order write APIs return the canonical Oracle object with "id";
  // the inspector read roster exposes the same reference as "orderId".
  const key=server.orderId||server.id;
  const at=this.orders.findIndex(x=>x.orderId===key);
  if(at<0)return null;
  const updated={...this.orders[at],...server,orderId:key!};
  this.orders[at]=updated;
  if(this.selected?.orderId===key)this.selected=updated;
  delete this.cache[key!];return updated;
 }
 private loadDossierFresh(o:AssignedOrder):void{
  this.selected=null;this.dossier=null;delete this.cache[o.orderId];
  this.select(o);
 }
}
