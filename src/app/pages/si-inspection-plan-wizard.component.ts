import {CommonModule} from '@angular/common';
import {HttpClient,HttpParams} from '@angular/common/http';
import {Component,OnDestroy,OnInit} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {RouterLink,ActivatedRoute} from '@angular/router';
import {Subscription,interval,switchMap} from 'rxjs';
import {NmcNavigationComponent} from '../components/nmc-navigation.component';
import {LanguageService} from '../services/language.service';
import {MoeiAuthService} from '../services/moei-auth.service';
import {SiBulkJob,SiBulkPlanService,SiBulkPreview,SiBulkVessel} from '../services/si-bulk-plan.service';
import {SiCandidateTargetingService} from '../services/si-candidate-targeting.service';
import {calculateInspectionFactorQuotas,InspectionFactorQuotaPreview,
 InspectionQuotaCandidate} from './si-plan-factor-quotas';

interface CapacityItem{
 imo:string;name:string;portId:string;portName:string;portSourceLocked:boolean;
 vesselType:string;regime:string;regimes:string[];
 locationType:string;locationName:string;siteAccessConfirmed:boolean;
 berthAtLocal:string;berthConfirmed:boolean;berthEvidenceReference:string;
 durationMinutes:number;etaLocal:string;etdLocal:string;
 earliestLocal:string;latestFinishLocal:string;
 windowSource:string;windowEvidenceReference:string;dateEvidenceReference:string;
 nmcReferrals:{id:string}[];
}
interface CapacityContext{
 planId:string;sourceHash:string;planRevision:number;demoMode?:boolean;
 selection:{selectionHash:string;
  draftScope?:{locked:boolean;selectedImos:string[];
   c01OriginallySelectedCount:number;
   previouslyOutsideCapacity:{imo:string;reasonCode:string}[]};
  roster:{imo:string;planRank:number;inspectionReasons:{
   eventKey:string;sourceType:string;sourceReference:string;reason:string|null}[]}[];
  mandatoryImos:string[];
  quotas:{pscRisk:{targetedImos:number;eligibleImos:number};
   uaeFlag:{targetedImos:number;eligibleImos:number};
   overlapImos:string[];selectedImos:string[]}};
 items:CapacityItem[];ports:{portId:string;name:string}[];
}
interface CapacityAssignment{
 imo:string;inspectorId:string;inspectorName:string;portId:string;portName:string;
 startLocal:string;endLocal:string;crossPort:boolean;
 originPortName:string;travelMinutes:number;
}
interface CapacityVariant{
 optionId:string;allocatedVessels:number;objectiveScore:number;
 assignments:CapacityAssignment[];
 rows:{imo:string;status:string;blocker:string|null}[];
}
interface CapacitySchedule{
 proposalHash:string;planRevision:number;planId:string;
 summary:{total:number;proposed:number;unscheduled:number};
 variants:CapacityVariant[];
 rows:{imo:string;status:string;blocker:string|null}[];
}
interface CapacityPreview{
 proposal:CapacitySchedule;selection:CapacityContext['selection']&{
  capacity:{mandatoryUnscheduled:string[];unscheduledImos:{
   imo:string;blocker:string|null}[];
   exceptionActions:{imo:string;sourceReason:string|null;mandatory:boolean;
    actions:{code:string;status:string;inspectorIds:string[];
     prerequisiteCodes:string[];canExecuteAutomatically:false}[]}[]}};
}
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
     <h1>{{copy('Review & Approve Rolling Plan','مراجعة واعتماد خطة المعاينات')}}</h1>
     <p *ngIf="preview?.planNumber"><strong>{{preview?.planNumber}}</strong></p>
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
    <section class="plan-return-notice" *ngIf="returnedFromScheduling">
     <strong>{{copy('Scheduling follow-up · approved inspection plan','متابعة الجدولة · خطة المعاينات المعتمدة')}}</strong>
     <p>{{copy('Opened from the scheduling exceptions board. The source-backed vessel identity and inspection reasons below are read-only; changing an approved roster requires a new authorized plan.',
      'تم فتح تفاصيل السفينة من استثناءات الجدولة. هوية السفينة وأسباب معاينتها من المصادر للعرض فقط؛ تعديل قائمة معتمدة يتطلب خطة جديدة وإجراء اعتماد مخول.')}}</p>
     <a *ngIf="planId" [routerLink]="['/moei/smart-inspection/scheduling/plan',planId]">
      {{copy('← Back to scheduling diagnostics','← العودة إلى تفاصيل أسباب تعذر الجدولة')}}</a>
    </section>
    <p class="notice error" *ngIf="p.stale||(!p.agentRunId&&!p.manualSelection)">
     {{copy('Candidate selection is missing or source data has changed. Return to Candidate Center and review the current plan. AI is optional.',
     'لا توجد سفن مختارة أو تغير مصدر البيانات. عد إلى قائمة المرشحين وراجع الخطة الحالية. تشغيل AI اختياري.')}}
    </p>
    <section class="panel si-plan-weights" *ngIf="step===1&&!returnedFromScheduling">
     <div class="panel-head">
      <div>
       <p class="eyebrow">{{copy('INDEPENDENT TARGETING QUOTAS · DRAFT','نسب الاختيار المستقلة · مسودة')}}</p>
       <h2>{{copy('PSC Risk Screening & UAE-Flagged Vessels','اختيار PSC حسب المخاطر واختيار السفن الإماراتية')}}</h2>
       <p>{{copy(
        'Each percentage applies independently to the number of eligible candidate vessels in its own group. The two percentages do NOT have to add up to 100%.',
        'كل نسبة تُطبّق بمفردها على عدد السفن المرشحة المؤهلة في مجموعتها. لا يشترط أن يكون مجموع النسبتين 100%.')}}</p>
      </div>
     </div>
     <p class="notice" *ngIf="factorPoolLoading">{{copy(
       'Reading eligible source-backed candidates and their saved risk assessments…',
       'جارٍ قراءة المرشحين المؤهلين من المصادر وتقييمات المخاطر المحفوظة…')}}</p>
     <p class="notice error" *ngIf="factorPoolError" role="alert">{{factorPoolError}}</p>
     <p *ngIf="selectionPolicyPublished" class="notice">
       {{copy('Published selection rates are read-only here. Run SI-C01 in Candidate Center for an evidence-backed vessel selection; edit rates in Inspection Settings.',
         'نسب اختيار السفن المنشورة للقراءة فقط. شغّل SI-C01 من قائمة المرشحين للحصول على السفن المختارة بالأدلة، أو عدّل النسب من الإعدادات.')}} 
       <a routerLink="/moei/smart-inspection/settings/targeting">{{copy('Policy Settings','إعدادات الاختيار')}}</a> ·
       <a routerLink="/moei/smart-inspection/candidates">{{copy('Run AI Selection','تشغيل اختيار AI')}}</a>
      </p>
      <div class="si-weight-grid">
      <label *ngFor="let w of planningWeights" class="si-weight-control">
       <span class="si-weight-heading">
        <strong>{{copy(w.en,w.ar)}}</strong>
        <output>{{w.value}}%</output>
       </span>
       <small>{{copy(w.descriptionEn,w.descriptionAr)}}</small>
       <input type="range" min="0" max="100" step="1"
        [ngModel]="w.value" (ngModelChange)="changePlanningWeight(w.key,$event)" [disabled]="selectionPolicyPublished"
        [attr.aria-label]="copy(w.en,w.ar)"/>
       <ng-container *ngIf="quotaFactor(w.key) as q">
        <div class="si-quota-equation">
         <span>{{copy('Eligible vessels','السفن المؤهلة')}} <b>{{q.eligibleVessels}}</b></span>
         <span>{{copy('Proposed selection','العدد المقترح')}} <b>{{q.targetVessels}}</b></span>
        </div>
        <small>{{q.eligibleVessels}} × {{w.value}}% = {{q.targetVessels}}
         {{copy('vessels (rounded down)','سفينة (تقريب لأسفل)')}}</small>
        <small *ngIf="w.key==='PSC_RISK'">
         {{copy('Saved risk available','تقييم مخاطر محفوظ')}}:
         {{q.riskAvailableVessels}} /
         {{q.eligibleVessels}} ·
         {{copy('Missing risk','غير مقيمة')}}: {{q.riskMissingVessels}}
        </small>
       </ng-container>
      </label>
     </div>
     <div *ngIf="quotaPreview as q" class="si-quota-summary">
      <div><span>{{copy('Eligible distinct IMO candidates','إجمالي المرشحين بدون تكرار')}}</span><strong>{{q.overallEligibleCandidates}}</strong></div>
      <div><span>{{copy('Total uniquely proposed','السفن المقترحة بدون تكرار')}}</span><strong>{{q.uniqueSelectedCount}}</strong></div>
      <div><span>{{copy('Included in both factors','المشتركة بين المجموعتين')}}</span><strong>{{q.overlappingImos.length}}</strong></div>
     </div>
     <p class="hint">{{copy(
       'A vessel qualifying for both factors is counted once in the combined shortlist (one IMO). The PSC quota uses already eligible PSC candidates and saved vessel-risk assessment to rank them; it does not replace the published PSC Excel port-call event quota. UAE-flag eligibility is based on recorded flag state, not arrival port. Mandatory NMC referrals and legal service obligations remain outside these optional percentages.',
       'السفينة المشتركة بين العاملين تُحسب مرة واحدة عند دمج المقترحات (IMO واحد). تختار نسبة PSC من المرشحين المؤهلين وتُرتّبهم وفق تقييم المخاطر المحفوظ؛ ولا تحل محل حصة أحداث PSC المنشورة من Excel. السفن الإماراتية تُحدد وفق علم السفينة المسجل وليس ميناء الوصول. تظل إحالات NMC الإلزامية والتزامات الخدمات النظامية مستقلة عن نسب الاختيار الاختيارية.')}}</p>
     <p class="hint">{{copy(
       'The two independent percentages are applied to the candidate shortlist when you load the capacity plan in Step 3, then revalidated and saved with the single supervisor approval. They do not alter any official NMC risk score or published PSC quota.',
       'تُطبّق النسبتان المستقلتان على المرشحين عند تحميل خطة الطاقة في الخطوة الثالثة، ثم يُعاد التحقق منهما وحفظهما عند الاعتماد الموحد. لا يتغير تقييم مخاطر NMC الرسمي أو حصة PSC المنشورة.')}}</p>
    </section>
    <section class="panel" *ngIf="step===1">
     <div class="panel-head">
      <div><p class="eyebrow">{{copy('STEP 01 · INSPECTION PLAN','الخطوة ١ · خطة المعاينات')}}</p>
       <h2>{{copy('Existing manual selections in this draft',
        'السفن المختارة يدويًا في المسودة الحالية')}}</h2>
       <p>{{copy('The independent percentages above also screen eligible source-backed candidates directly. You do not need a previous C01 call or manual inclusion before checking capacity.',
        'تسمح النسبتان أعلاه باختيار مرشحين مؤهلين من المصادر مباشرة، دون اشتراط تشغيل C01 أو الاختيار اليدوي قبل حساب الطاقة.')}}</p></div>
       <span class="count">{{p.selectedVessels}} {{copy('vessels','سفن')}}</span>
     </div>
     <div class="summary">
      <div><strong>{{p.selectedVessels}}</strong><span>{{copy('Selected vessels','السفن المختارة')}}</span></div>
      <div><strong>v{{p.planRevision}}</strong><span>{{copy('Plan revision','إصدار الخطة')}}</span></div>
      <div><strong>{{p.agentRunId?p.provider:'MANUAL'}}</strong><span>{{copy('Selection method','طريقة الاختيار')}}</span></div>
     </div>
     <section *ngIf="returnedFromScheduling && focusedVessel as vessel" class="plan-focus-vessel">
      <h3>{{copy('Selected vessel in this approved plan','السفينة المطلوبة من خطة المعاينات المعتمدة')}} · IMO {{vessel.imo}}</h3>
      <p><strong>{{vessel.vesselName}}</strong> · #{{vessel.rank}} ·
       {{copy('Inspection scopes','نطاقات المعاينة')}}:
       {{vessel.inspectionRegimes.join(' · ')}}</p>
      <h4>{{copy('Authoritative source referral reasons','أسباب المعاينة الأصلية من المصادر')}}</h4>
      <article *ngFor="let source of vessel.reasons" class="plan-focus-reason">
       <strong>{{sourceLabel(source.sourceType)}}</strong> · {{source.inspectionRegime}}
       <p>{{source.reason||copy('No detailed description provided by source','المصدر لم يورد وصفًا تفصيليًا')}}</p>
       <small>{{copy('Reference','المرجع')}}: {{source.sourceReference||source.sourceEventId||'—'}}</small>
      </article>
      <p class="hint">{{copy('These are inclusion reasons from the approved plan, not an explanation of the scheduling exception. Detailed time and engineer conflicts are shown on the scheduling board.',
       'هذه أسباب إدراج السفينة بالخطة المعتمدة، وليست أسباب تعذر الجدولة. تفاصيل تعارض المواعيد والمهندسين موجودة في لوحة الجدولة.')}}</p>
     </section>
     <p *ngIf="returnedFromScheduling && focusedImo && !focusedVessel" class="notice error">
      {{copy('The requested IMO was not found in this plan preview. Verify the plan reference.',
       'لم يتم العثور على رقم IMO المطلوب في بيانات هذه الخطة؛ راجع رقم الخطة.')}}
     </p>
     <div class="table-scroll"><table>
      <thead><tr><th>{{copy('Priority','الأولوية')}}</th>
       <th>{{copy('Vessel','السفينة')}}</th><th>IMO</th>
       <th>{{copy('Referral reasons','أسباب المعاينة')}}</th>
       <th>{{copy('Inspection scopes','نطاقات المعاينة')}}</th></tr></thead>
      <tbody><tr *ngFor="let vessel of p.vessels" [class.plan-focused-row]="vessel.imo===focusedImo">
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
     <p *ngIf="!p.vessels.length&&capacityBusy" class="notice">
      {{copy('Verifying source reasons for percentage-based candidates…',
       'جارٍ التحقق من أسباب إحالة السفن المرشحة بالنسب…')}}</p>
     <p *ngIf="!p.vessels.length&&capacityError" class="notice error" role="alert">
      {{capacityError}}</p>
     <ng-container *ngIf="capacityContext as ctx">
      <div class="vessel-card" *ngFor="let selected of ctx.selection.roster">
       <header><div><strong>#{{selected.planRank}} · IMO {{selected.imo}}</strong>
        <span>{{copy('Capacity-first candidate, not yet approved',
         'مرشح وفق الطاقة التشغيلية، لم يُعتمد بعد')}}</span></div>
        <span class="reason-count">{{selected.inspectionReasons.length}}
         {{copy('reasons','أسباب')}}</span></header>
       <div class="reason-card" *ngFor="let reason of selected.inspectionReasons">
        <strong>{{sourceLabel(reason.sourceType)}}</strong>
        <p class="source-ref">{{reason.sourceReference||reason.eventKey}}</p>
        <p *ngIf="reason.reason">{{reason.reason}}</p>
       </div>
      </div>
     </ng-container>
     <div class="vessel-card" *ngFor="let vessel of (capacityContext ? [] : p.vessels)">
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
     <p class="eyebrow">{{copy('STEP 03 · CAPACITY-FIRST PLAN','الخطوة ٣ · إنشاء خطة حسب الطاقة')}}</p>
     <h2>{{copy('Build a single capacity-verified inspection plan','إعداد خطة معاينات واحدة متحققة من الطاقة')}}</h2>
     <p>{{copy('The two percentages separately shortlist eligible IMO candidates. Mandatory NMC referrals and legally required service inspections remain protected. Inspectors and time slots are checked before ANY plan approval.',
      'تختار النسبتان بشكل مستقل سفنًا مؤهلة دون تكرار IMO، مع حماية إحالات NMC والالتزامات النظامية. يتم التحقق من المهندسين والمواعيد قبل أي اعتماد للخطة.')}}</p>
     <label class="capacity-mode">
      <input type="checkbox" [(ngModel)]="capacityDemoMode"
       (ngModelChange)="invalidateCapacity()"/>
      {{copy('POC demo only: synthetic staff qualifications, shifts and travel (not official ERP)',
       'عرض POC تجريبي: مؤهلات وورديات وانتقالات افتراضية وليست ERP رسميًا')}}
     </label>
     <button class="secondary" type="button" [disabled]="capacityBusy||capacityAiBusy"
      (click)="loadCapacityContext()">
      {{capacityBusy?copy('Loading verified data…','تحميل البيانات…'):
       copy('01 · Load Candidates & Workforce','١ · تحميل السفن والطاقة التشغيلية')}}</button>
     <p class="notice error" *ngIf="capacityError" role="alert">{{capacityError}}</p>
     <p class="notice error" *ngIf="capacityRequiresRestore" role="alert">
      {{copy('This saved Draft was changed after its original C01 and inspector-capacity review. For safety, approval is blocked. Go back to Candidate Center, use “Restore Verified Draft Selection” on this plan, then recheck capacity. No plan is deleted or approved automatically.',
        'تغيّر اختيار السفن بعد تحقق C01 وطاقة المهندسين الأصلي. الاعتماد متوقف لحماية الخطة. ارجع إلى مركز المرشحين واختر «استعادة اختيار السفن المتحقق منه» من بطاقة الخطة، ثم أعد فحص الطاقة. لن تُحذف أو تُعتمد أي خطة تلقائيًا.')}}
      <a routerLink="/moei/smart-inspection/candidates">{{copy('Open Candidate Center →','فتح مركز المرشحين ←')}}</a>
     </p>
     <p class="notice" *ngIf="capacityRequiresC01">
      {{copy('Published C01 selection policy requires verified recommendations before capacity matching. Run C01 in Candidate Center, then return here.',
        'سياسة C01 المنشورة تشترط توصيات موثقة قبل حساب الطاقة. شغّل C01 في مركز المرشحين ثم عُد هنا.')}}
      <a routerLink="/moei/smart-inspection/candidates">{{copy('Open Candidate Center →','فتح مركز المرشحين ←')}}</a>
     </p>
     <ng-container *ngIf="capacityContext as ctx">
      <div class="review-stats">
       <p><b>{{ctx.selection.roster.length}}</b>
        <span>{{copy('Shortlisted candidates','مرشحون طبقًا للنسب والالتزامات')}}</span></p>
       <p><b>{{ctx.selection.quotas.pscRisk.targetedImos}}</b>
        <span>{{copy('PSC + Risk target','عدد PSC حسب المخاطر')}}</span></p>
       <p><b>{{ctx.selection.quotas.uaeFlag.targetedImos}}</b>
        <span>{{copy('UAE flag target','عدد السفن الإماراتية')}}</span></p>
      </div>
      <p class="notice" *ngIf="ctx.selection.draftScope?.locked">
       {{copy('This saved Draft contains '+ctx.selection.roster.length+
        ' vessels. Only their inspector availability is being rechecked; other C01 candidates will not be added automatically.',
        'هذه المسودة المحفوظة تشمل '+ctx.selection.roster.length+
        ' سفينة. سيعاد فحص إتاحة المهندسين لهذه السفن فقط، دون إضافة سفن C01 أخرى تلقائيًا.')}}
      </p>
      <p class="hint">{{copy('Source-backed mandatory candidates and separately recorded officer inclusions may add vessels beyond the two optional quota totals. The combined roster has one row per IMO.',
       'قد تزيد السفن الإلزامية والاختيارات اليدوية الموثقة عن إجمالي الحصتين الاختياريتين، مع عدم تكرار أي IMO.')}}</p>
      <details class="capacity-vessel-list" data-testid="si-capacity-vessel-list">
       <summary class="capacity-vessel-list-title">
        <strong>{{copy('Vessel visit & capacity inputs','بيانات زيارات السفن والطاقة التشغيلية')}}</strong>
        <span class="capacity-vessel-list-count">{{ctx.items.length}} {{copy('vessels','سفينة')}}</span>
        <span class="capacity-disclosure-label">
         <span class="capacity-when-closed">{{copy('Show vessels','عرض السفن')}}</span>
         <span class="capacity-when-open">{{copy('Hide vessels','إخفاء السفن')}}</span>
         <span class="capacity-disclosure-chevron" aria-hidden="true">▾</span>
        </span>
       </summary>
       <p class="hint">{{copy('Open any vessel to review or edit its visit and capacity inputs. Collapsing does not change entered values.',
         'افتح أي سفينة لمراجعة أو تعديل بيانات الزيارة والطاقة. إخفاء التفاصيل لا يغير القيم المدخلة.')}}</p>
       <details class="capacity-vessel-form" *ngFor="let v of ctx.items"
        [attr.data-vessel-imo]="v.imo" data-testid="si-capacity-vessel-disclosure">
        <summary class="capacity-vessel-title">
         <b>IMO {{v.imo}} · {{v.name}}</b>
         <span class="capacity-vessel-meta">
          <span>{{v.regimes.join(' · ')}}</span>
          <small>{{copy('Port','الميناء')}}: {{v.portId||'—'}} ·
           {{copy('Duration','المدة')}}: {{v.durationMinutes}} {{copy('min','دقيقة')}}</small>
         </span>
         <span class="capacity-disclosure-label">
          <span class="capacity-when-closed">{{copy('Show details','عرض التفاصيل')}}</span>
          <span class="capacity-when-open">{{copy('Hide details','إخفاء التفاصيل')}}</span>
          <span class="capacity-disclosure-chevron" aria-hidden="true">▾</span>
         </span>
        </summary>
        <div class="capacity-vessel-body">
         <div class="capacity-input-grid">
        <label>{{copy('Inspection port','ميناء المعاينة')}}
         <select [(ngModel)]="v.portId" [disabled]="v.portSourceLocked||capacityDemoMode"
          (ngModelChange)="invalidateCapacityPreview()">
          <option value="">—</option>
          <option *ngFor="let port of ctx.ports" [value]="port.portId">{{port.name}}</option>
         </select></label>
        <label>{{copy('Berth / location','الرصيف / الموقع')}}
         <input [(ngModel)]="v.locationName" [disabled]="capacityDemoMode"
          (ngModelChange)="invalidateCapacityPreview()"/></label>
        <label>{{copy('Inspection duration (min)','مدة المعاينة بالدقائق')}}
         <input type="number" min="30" max="720" step="30"
          [(ngModel)]="v.durationMinutes" [disabled]="capacityDemoMode"
          (ngModelChange)="invalidateCapacityPreview()"/></label>
        <label>{{copy('Confirmed berthing time (optional, UAE)','وقت التراكي المؤكد (اختياري، الإمارات)')}}
         <input [(ngModel)]="v.berthAtLocal" [disabled]="capacityDemoMode"
          (ngModelChange)="invalidateCapacityPreview()"
          placeholder="YYYY-MM-DD HH:mm"/></label>
        <label>{{copy('Berth event / evidence reference','مرجع إثبات التراكي')}}
         <input [(ngModel)]="v.berthEvidenceReference" [disabled]="capacityDemoMode"
          (ngModelChange)="invalidateCapacityPreview()"
          placeholder="Port berth movement reference"/></label>
        <label class="capacity-check">
         <input type="checkbox" [(ngModel)]="v.berthConfirmed"
          [disabled]="capacityDemoMode" (ngModelChange)="invalidateCapacityPreview()"/>
         {{copy('Berthing time checked by officer','تم تأكيد موعد التراكي بواسطة الموظف')}}</label>
        <label>{{copy('Vessel arrival ETA · earliest vessel access','وصول السفينة ETA · بداية نافذة الإتاحة')}}
         <input [(ngModel)]="v.earliestLocal"
          [disabled]="!!v.etaLocal||capacityDemoMode"
          (ngModelChange)="invalidateCapacityPreview()"
          placeholder="YYYY-MM-DD HH:mm"/></label>
        <label>{{copy('Final vessel departure ETD · latest completion','مغادرة السفينة ETD · آخر موعد لإنهاء المعاينة')}}
         <input [(ngModel)]="v.latestFinishLocal"
          [disabled]="!!v.etdLocal||capacityDemoMode"
          (ngModelChange)="invalidateCapacityPreview()"
          placeholder="YYYY-MM-DD HH:mm"/></label>
        <label class="capacity-check">
         <input type="checkbox" [(ngModel)]="v.siteAccessConfirmed"
          [disabled]="capacityDemoMode"
          (ngModelChange)="invalidateCapacityPreview()"/>
         {{copy('Confirmed berth/site access','تأكيد إتاحة موقع المعاينة')}}</label>
       </div>
       <div class="source-ref">{{copy('Source inspection reasons','أسباب المعاينة من المصادر')}}:
        <span *ngFor="let entry of ctx.selection.roster">
         <ng-container *ngIf="entry.imo===v.imo">
          <span *ngFor="let evidence of entry.inspectionReasons">
           {{evidence.sourceType}} · {{evidence.sourceReference||evidence.eventKey}} |
          </span>
         </ng-container>
        </span></div>
        </div>
       </details>
      </details>
      <button class="next" type="button" (click)="previewCapacity()"
       [disabled]="capacityBusy||capacityAiBusy">
       {{copy('02 · Verify Capacity & Create Plan Alternatives',
        '٢ · التحقق من الطاقة وإنشاء بدائل الخطة')}}</button>
     </ng-container>
     <ng-container *ngIf="capacityProposal as schedule">
      <div class="review-stats">
       <p><b>{{schedule.summary.total}}</b>
        <span>{{copy('Screened','فُحصت إتاحتها')}}</span></p>
       <p><b>{{schedule.summary.proposed}}</b>
        <span>{{copy('Feasible assignments','قابلة للتكليف')}}</span></p>
       <p><b>{{schedule.summary.unscheduled}}</b>
        <span>{{copy('Capacity exceptions','استثناءات الطاقة')}}</span></p>
      </div>
      <p class="notice error" *ngIf="!draftCapacityScopeMatches&&
        capacityContext?.selection?.draftScope?.locked">
       {{copy('Current inspector availability does not cover every saved Draft vessel. No vessel will be removed automatically. Review these IMOs:',
        'إتاحة المهندسين الحالية لا تغطي جميع سفن المسودة المحفوظة. لن يتم حذف سفن تلقائيًا. راجع السفن:')}}
       <b>{{missingDraftCapacityImos.join(', ')}}</b>
      </p>
      <p class="notice error" *ngIf="capacityPreview?.selection?.capacity?.mandatoryUnscheduled?.length">
       {{copy('Mandatory inspection(s) cannot be scheduled: approval is blocked until the constraints are resolved.',
        'توجد معاينات إلزامية لم تتوفر لها طاقة: الاعتماد موقوف حتى معالجة القيود.')}}
       {{capacityPreview?.selection?.capacity?.mandatoryUnscheduled?.join(', ')}}
      </p>
      <div class="table-scroll"><table>
       <thead><tr><th>IMO</th><th>{{copy('Status','الحالة')}}</th>
        <th>{{copy('Reason','السبب')}}</th></tr></thead>
       <tbody><tr *ngFor="let row of schedule.rows">
        <td>{{row.imo}}</td><td>{{row.status}}</td>
        <td>{{row.blocker||copy('Feasible','قابل للجدولة')}}</td></tr></tbody>
      </table></div>
      <ng-container *ngIf="approvedCapacityVariant as alt">
       <h3>{{copy('Qualified Inspectors & Feasible Slots — Preview',
         'المهندسون المؤهلون والمواعيد الممكنة — معاينة')}}</h3>
       <p class="hint">{{copy('Capacity has been checked, but no supervisor approval or real ERP booking has occurred.',
         'تم فحص الطاقة، لكن لم يحدث اعتماد من المشرف أو حجز ERP فعلي.')}}</p>
       <div class="table-scroll"><table>
        <thead><tr><th>IMO</th><th>{{copy('Qualified inspector','المهندس المؤهل')}}</th>
         <th>{{copy('Port','الميناء')}}</th><th>{{copy('Proposed visit','الموعد المقترح')}}</th></tr></thead>
        <tbody><tr *ngFor="let a of alt.assignments">
         <td>{{a.imo}}</td><td>{{a.inspectorName}}</td>
         <td>{{a.portName}}</td><td>{{a.startLocal}} → {{a.endLocal}}</td></tr></tbody>
       </table></div>
      </ng-container>
      <section class="capacity-exceptions" *ngIf="capacityPreview?.selection?.capacity?.exceptionActions as exceptions">
       <h3>{{copy('Exception resolution proposals (NOT approved assignments)',
        'بدائل علاج الاستثناءات (ليست تكليفات معتمدة)')}}</h3>
       <article *ngFor="let entry of exceptions">
        <h4>IMO {{entry.imo}} · {{entry.sourceReason||'—'}}</h4>
        <div *ngFor="let solution of entry.actions">
         <strong>{{capacityActionLabel(solution.code)}}</strong>
         <small>{{copy('Eligible inspector suggestions','مهندسون مرشحون')}}:
          {{solution.inspectorIds.join(' · ')||'—'}}</small>
         <small>{{copy('Requires prior authorization and revalidation','يتطلب موافقات وإعادة تحقق')}}:
          {{solution.prerequisiteCodes.join(' · ')}}</small>
         <small>{{solution.status}}</small>
        </div>
       </article>
       <p class="hint">{{copy('Outside-hours shifts require signed HR approval; neighboring-port reassignments require eligibility, travel and supervisor signoff. Cancellation/deferment is NEVER assumed legal without source-backed permission. Re-run capacity after obtaining new authorized source facts. SI-S01 AI ranks only already verified alternatives.',
        'التكليف خارج الدوام يحتاج موافقة الموارد البشرية؛ والنقل من ميناء مجاور يحتاج تحققًا من التأهيل والانتقال واعتماد المشرف. ولا يُفترض جواز الإلغاء أو التأجيل دون سند تنظيمي موثق. أعد حساب الطاقة بعد اعتماد أي تغيير. يرتّب AI SI-S01 البدائل المتحققة فقط.')}}</p>
      </section>
      <p class="hint">{{copy('Unscheduled optional candidates remain in the candidate pool with their reasons; they are not silently cancelled or added to the approved work-order roster.',
       'تظل السفن الاختيارية غير المجدولة في قائمة المرشحين مع أسباب التعذر، ولا تُلغى تلقائيًا أو تصدر لها أوامر تكليف.')}}</p>
      <button type="button" class="secondary" (click)="runCapacityAi()"
       [disabled]="capacityAiBusy||capacityBusy||!schedule.variants.length">
       {{capacityAiBusy?copy('AI evaluating…','جارٍ تحليل AI…'):
        copy('03 · Ask AI to Rank Verified Plan Alternatives',
         '٣ · استخدام AI لترتيب بدائل الخطة المتحققة')}}</button>
      <p class="notice" *ngIf="capacityAiMessage">{{capacityAiMessage}}</p>
     </ng-container>
    </section>
    <section class="panel" *ngIf="step===4">
     <p class="eyebrow">{{copy('STEP 04 · ONE SUPERVISOR APPROVAL','الخطوة ٤ · اعتماد واحد من المشرف')}}</p>
     <h2>{{copy('Approve vessels, verified inspectors, dates and work orders together',
      'اعتماد السفن والمهندسين والمواعيد وأوامر التكليف معًا')}}</h2>
     <ng-container *ngIf="approvedCapacityVariant as selected">
      <div class="review-stats">
       <p><b>{{capacityProposal?.summary?.total}}</b>
        <span>{{copy('Screened vessels','السفن محل التخطيط')}}</span></p>
       <p><b>{{selected.assignments.length}}</b>
        <span>{{copy('Ready to approve','معاينات جاهزة للاعتماد')}}</span></p>
       <p><b>{{capacityProposal?.summary?.unscheduled}}</b>
        <span>{{copy('Remain outside this plan','لم تدخل هذه الخطة')}}</span></p>
      </div>
      <div class="capacity-variant-choices" *ngIf="(capacityProposal?.variants?.length||0)>1">
       <label>{{copy('Verified plan alternative','بديل الخطة المتحقق')}}
        <select [ngModel]="preferredCapacityOptionId" (ngModelChange)="capacityAiOptionId=$event">
         <option *ngFor="let alt of capacityProposal?.variants" [value]="alt.optionId">
          {{alt.allocatedVessels}} {{copy('assignments','تكليف')}} · {{alt.optionId}}
         </option>
        </select></label>
      </div>
      <div class="table-scroll"><table>
       <thead><tr><th>IMO</th><th>{{copy('Inspector','المهندس')}}</th>
        <th>{{copy('Port','الميناء')}}</th><th>{{copy('Date/time','الموعد')}}</th>
        <th>{{copy('Travel','الانتقال')}}</th></tr></thead>
       <tbody><tr *ngFor="let a of selected.assignments">
        <td>{{a.imo}}</td><td>{{a.inspectorName}}</td>
        <td>{{a.portName}}</td><td>{{a.startLocal}} → {{a.endLocal}}</td>
        <td>{{a.crossPort?(a.originPortName+' · '+a.travelMinutes+' min'):'—'}}</td>
       </tr></tbody></table></div>
      <p class="notice" *ngIf="capacityDemoMode">{{copy(
       'POC DEMO: inspector skills/shifts, visit supplements and route travel times may be synthetic. This is not a live official ERP resource reservation.',
       'وضع POC: قد تكون مؤهلات المهندسين وورديّاتهم وبيانات الزيارة وأوقات الانتقال افتراضية؛ ولا يمثل ذلك حجز موارد ERP رسميًا.')}}</p>
     </ng-container>
     <label class="approval-notes">{{copy('Supervisor approval reason','سبب اعتماد المشرف')}}
      <textarea rows="3" maxlength="500" [(ngModel)]="reason"
       [placeholder]="copy('Document the combined capacity-verified plan approval',
        'وثّق سبب اعتماد الخطة متضمنة السفن والموارد والمواعيد')"></textarea>
     </label>
     <p class="notice error" *ngIf="!draftCapacityScopeMatches&&
       capacityContext?.selection?.draftScope?.locked">
       {{copy('Approval is blocked because the selected alternative does not cover all saved Draft vessels.',
        'الاعتماد متوقف لأن البديل المختار لا يغطي جميع سفن المسودة المحفوظة.')}}
       IMO {{missingDraftCapacityImos.join(', ')}}
     </p>
     <p class="notice error" *ngIf="capacityError" role="alert">{{capacityError}}</p>
     <button type="button" class="approve" (click)="approve()"
      [disabled]="!canApproveCapacity">
      {{submitting?copy('Saving atomic approval…','جارٍ حفظ الاعتماد الموحد…'):
       copy('Approve Capacity-Verified Plan & Issue Work Orders',
        'اعتماد خطة المعاينات والموارد وإصدار أوامر التكليف')}}</button>
     <p class="hint">{{copy(
      'One Oracle transaction persists the approved vessel/source roster and work orders. A failure rolls both back. AI cannot approve, change compulsory inspection obligations, or book live ERP resources.',
      'تُحفظ السفن والأدلة وأوامر التكليف في معاملة Oracle واحدة؛ وأي فشل يلغي العملية بالكامل. لا يعتمد AI المعاينات أو يغير الالتزامات أو يحجز موارد ERP فعليًا.')}}</p>
    </section>
    <section class="panel" *ngIf="step===5&&scheduleApproval as approval">
     <p class="eyebrow">{{copy('STEP 05 · APPROVED & READY FOR DOSSIERS',
      'الخطوة ٥ · الخطة معتمدة وجاهزة لملفات السفن')}}</p>
     <h2>{{copy('Capacity-verified plan and work orders issued',
      'تم اعتماد خطة المعاينات وإصدار أوامر التكليف')}}</h2>
     <p class="notice">{{copy('Approved vessels and issued work orders','السفن وأوامر التكليف المعتمدة')}}:
      <strong>{{approval.approvedVesselCount}}</strong></p>
     <p>{{copy('Open the work-order board. Each order prepares its mandatory checklist and source-evidence dossier; the optional Airia A04 analysis is requested explicitly and reviewed by a supervisor before additions are used.',
      'افتح أوامر التكليف. يُجهز لكل أمر ملف الأدلة وقائمة المعاينة الإلزامية، ويُطلب تحليل Airia A04 صراحةً ثم يراجعه المشرف قبل تطبيق أي إضافات.')}}</p>
     <div class="step-actions">
      <a class="next" [routerLink]="['/moei/smart-inspection/scheduling/plan',approval.planId]">
       {{copy('Open Approved Work Orders & AI Vessel Dossiers →',
        'فتح أوامر التكليف وملفات السفن بالذكاء الاصطناعي ←')}}</a>
     </div>
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
      <div><strong>{{copy('Published Rules','قواعد معتمدة')}}</strong><span>{{copy('Execution priority','ترتيب التنفيذ')}}</span></div>
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
 .si-layout{min-height:100vh}.wizard-main{margin-inline-start:240px;padding:20px 16px 48px;max-width:1700px}
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
 .plan-return-notice,.plan-focus-vessel{background:#f6fbfd;border:1px solid #bfdde7;
  border-inline-start:5px solid #078597;border-radius:12px;padding:16px 19px;margin-bottom:17px;
  color:#20556c;font-size:12px}
 .plan-return-notice p,.plan-focus-vessel p{line-height:1.7}
 .plan-return-notice a{color:#087a86;font-weight:800;text-decoration:underline}
 .plan-focus-vessel h3{margin:0 0 8px;font-size:15px}
 .plan-focus-vessel h4{margin:15px 0 8px;font-size:13px}
 .plan-focus-reason{border-top:1px solid #c6e1e8;padding:10px 0}
 .plan-focus-reason small{color:#63869a}
 tr.plan-focused-row{background:#e7f9ef;outline:2px solid #8fcfb0;outline-offset:-2px}
 .capacity-exceptions{padding:13px;background:#fffbf2;border:1px solid #eddbb8;
  border-radius:9px;margin:14px 0}
 .capacity-exceptions h3{font-size:14px;color:#81501f}
 .capacity-exceptions article{padding:12px;border-top:1px solid #e7d8c1}
 .capacity-exceptions h4{font-size:12px;margin:2px 0 9px;color:#81501f}
 .capacity-exceptions article>div{background:#fff;border:1px solid #ebdec9;border-radius:8px;
  margin:7px 0;padding:9px}
 .capacity-exceptions article>div strong,.capacity-exceptions article>div small{
  display:block;margin:4px 0;overflow-wrap:anywhere}
 .capacity-exceptions article>div small{font-size:10px;color:#667884}
 .capacity-mode{display:block;color:#975c1f;background:#fff4df;border:1px solid #e8d4b3;
  padding:12px;border-radius:8px;font-size:12px;font-weight:800;margin:13px 0}
 .capacity-vessel-form{border:1px solid #d7e7eb;border-radius:10px;padding:15px;margin:12px 0;background:#fcfefe}
 .capacity-vessel-title{display:flex;justify-content:space-between;gap:12px;
  flex-wrap:wrap;font-size:12px;color:#126e7e;margin-bottom:12px}

 /* Accessible, data-preserving two-level capacity form disclosures. */
 .capacity-vessel-list{border:1px solid #c9e0e6;background:#f6fafb;
  border-radius:11px;padding:11px 12px;margin:15px 0}
 .capacity-vessel-list-title,.capacity-vessel-form > summary{
  list-style:none;cursor:pointer;display:flex;align-items:center;gap:13px;flex-wrap:wrap}
 .capacity-vessel-list-title::-webkit-details-marker,
 .capacity-vessel-form > summary::-webkit-details-marker{display:none}
 .capacity-vessel-list-title > strong{font-size:13px;color:#1c5066}
 .capacity-vessel-list-count{font-size:11px;font-weight:850;color:#0b766d;
  padding:6px 10px;background:#e2f5ef;border-radius:999px}
 .capacity-vessel-list > summary:focus-visible,
 .capacity-vessel-form > summary:focus-visible{outline:3px solid #0e8d86;outline-offset:4px;border-radius:7px}
 .capacity-vessel-list > .hint{margin:12px 3px}
 .capacity-vessel-list .capacity-vessel-form{margin:10px 0;padding:11px 12px;background:#fff}
 .capacity-vessel-form > summary{margin-bottom:0}
 .capacity-vessel-form .capacity-vessel-body{margin-top:13px}
 .capacity-vessel-meta{display:grid;gap:4px;min-width:140px;flex:1}
 .capacity-vessel-meta > span{color:#648292}
 .capacity-vessel-meta small{font-size:10px;color:#537789;font-weight:650}
 .capacity-disclosure-label{display:inline-flex;align-items:center;gap:7px;
  margin-inline-start:auto;font-size:11px;font-weight:800;color:#0b766d;white-space:nowrap}
 .capacity-when-open{display:none}
 details[open] > summary > .capacity-disclosure-label .capacity-when-closed{display:none}
 details[open] > summary > .capacity-disclosure-label .capacity-when-open{display:inline}
 .capacity-disclosure-chevron{display:inline-block;font-size:16px;transition:transform .18s ease}
 details[open] > summary > .capacity-disclosure-label .capacity-disclosure-chevron{transform:rotate(180deg)}
 @media(prefers-reduced-motion:reduce){.capacity-disclosure-chevron{transition:none}}
 .capacity-vessel-title span{color:#648292}
 .capacity-input-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
 .capacity-input-grid label{display:grid;gap:5px;font-size:11px;color:#31546a;font-weight:800}
 .capacity-input-grid input:not([type=checkbox]),.capacity-input-grid select,
 .capacity-variant-choices select{width:100%;min-width:0;padding:9px;border:1px solid #c8dce3;
  border-radius:7px;background:#fff;font:inherit}
 .capacity-input-grid input:disabled,.capacity-input-grid select:disabled{
  background:#f1f6f6;color:#69838e}
 .capacity-input-grid .capacity-check{display:flex;align-items:center;gap:9px}
 .capacity-variant-choices{margin:14px 0}
 @media(max-width:900px){.capacity-input-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
 @media(max-width:580px){.capacity-input-grid{grid-template-columns:1fr}}
 .si-plan-weights{border-color:#b6d8e0}
 .si-weight-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
 .si-weight-control{display:block;background:#f7fbfd;border:1px solid #d8e7ed;
  border-radius:9px;padding:15px;min-width:0}
 .si-weight-heading{display:flex;justify-content:space-between;gap:8px;align-items:center;
  font-size:13px;color:#245269}
 .si-weight-heading output{font-size:18px;font-weight:850;color:#087d8b}
 .si-weight-control>small{display:block;color:#56788a;margin:8px 0;font-size:11px;line-height:1.5}
 .si-weight-control input[type=range]{display:block;width:100%;accent-color:#078597;
  margin:14px 0;cursor:pointer}
 .si-quota-equation{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;
  border-top:1px solid #d8e7ed;padding-top:11px;font-size:11px;color:#355967}
 .si-quota-equation b{color:#006f78;font-size:16px;margin-inline-start:6px}
 .si-quota-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px;margin:12px 0}
 .si-quota-summary>div{border:1px solid #d4e5eb;background:#fff;border-radius:8px;padding:12px;
  display:grid;gap:5px}
 .si-quota-summary span{font-size:11px;color:#5a7182}
 .si-quota-summary strong{font-size:20px;color:#067d79}
 @media(max-width:650px){.si-weight-grid,.si-quota-summary{grid-template-columns:1fr}}
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
 @media(min-width:961px) and (max-width:1220px){.wizard-main{margin-inline-start:66px;padding:18px 14px}}
 @media(max-width:960px){.wizard-main{margin-inline-start:0;padding:20px}.steps{grid-template-columns:repeat(2,1fr)}}
 @media(max-width:600px){.wizard-main{padding:13px}.wizard-hero,.panel-head{display:block}.steps{gap:4px}.step-item{font-size:10px;padding:7px}
 .panel{padding:15px}.summary,.review-stats{grid-template-columns:1fr}.step-actions{gap:7px}}
 `]
})
export class SiInspectionPlanWizardComponent implements OnInit,OnDestroy{
 readonly stages=[{en:'Candidates & Quotas',ar:'المرشحون ونسب الاختيار'},
  {en:'Verified Source Reasons',ar:'أسباب المعاينة الموثقة'},
  {en:'Capacity & AI Scheduling',ar:'الطاقة والجدولة بالذكاء الاصطناعي'},
  {en:'Single Plan Approval',ar:'اعتماد الخطة مرة واحدة'}];
 readonly planningWeights=[
  {key:'PSC_RISK',en:'PSC + Risk Factor',ar:'PSC + عامل المخاطر',
   descriptionEn:'Percentage of eligible PSC vessels, ranked by saved vessel risk.',
   descriptionAr:'نسبة من سفن PSC المؤهلة، تُرتّب حسب مخاطر السفينة المحفوظة.',value:15},
  {key:'UAE_FLAG',en:'UAE-Flagged Vessels',ar:'السفن التي تحمل علم الإمارات',
   descriptionEn:'Independent percentage of eligible UAE-flagged candidate vessels.',
   descriptionAr:'نسبة مستقلة من السفن المرشحة المؤهلة التي تحمل علم الإمارات.',value:0}
 ];
 factorPool:InspectionQuotaCandidate[]|null=null;
 selectionPolicyPublished=false;
 factorPoolLoading=false;
 factorPoolError='';
 get quotaPreview():InspectionFactorQuotaPreview|null{
  if(!this.factorPool)return null;
  return calculateInspectionFactorQuotas(this.factorPool,
   this.planningWeights[0].value,this.planningWeights[1].value);
 }
 quotaFactor(key:string){
  return this.quotaPreview?.factors.find(x=>x.key===key)||null;
 }
 changePlanningWeight(key:string,value:number):void{
   if(this.selectionPolicyPublished)return;
   const w=this.planningWeights.find(x=>x.key===key);const v=Number(value);
  if(w&&Number.isFinite(v)){
   w.value=Math.max(0,Math.min(100,Math.round(v)));
   this.invalidateCapacity();
  }
 }
 private loadFactorCandidatePool():void{
  this.factorPoolLoading=true;this.factorPoolError='';
  this.candidates.dashboard().subscribe({
   next:dashboard=>{
     if(dashboard.policy.config.selection){
       this.selectionPolicyPublished=true;
       this.planningWeights[0].value=dashboard.policy.config.selection.pscRiskRatePercent;
       this.planningWeights[1].value=dashboard.policy.config.selection.uaeFlagRatePercent;
       this.invalidateCapacity();
     }else this.selectionPolicyPublished=false;
     const eligibleByImo=new Map<string,Set<string>>();
    // Only backend-eligible candidate source workflows count, not every
    // vessel event present in a raw imported Excel sheet.
    for(const c of dashboard.candidates){
     // Count only already eligible source-backed workflows. The backend
     // recomputes the final numbers before approving any plan.
     const eligible=c.status==='PENDING_REVIEW'||
       (c.status==='EXTERNALLY_SCHEDULED'&&
        c.events.some(e=>e.sourceType==='NMC_CASE'&&e.approval==='APPROVED'));
     if(!eligible)continue;
     if(!eligibleByImo.has(c.imo))eligibleByImo.set(c.imo,new Set());
     for(const e of c.events)eligibleByImo.get(c.imo)!.add(e.sourceType);
    }
    this.factorPool=dashboard.vesselCandidates
     .filter(v=>eligibleByImo.has(v.imo))
     .map(v=>({
      imo:v.imo,flag:v.flag,
      sourceTypes:[...eligibleByImo.get(v.imo)!],
      currentRisk:v.currentRisk
     }));
    this.factorPoolLoading=false;
    // Apply the published rates before the automatic capacity request.
    if(this.capacityEntryFromCandidates)this.loadCapacityContext();
   },
   error:()=>{
    this.factorPool=null;this.factorPoolLoading=false;
    this.factorPoolError=this.copy(
     'Cannot verify the eligible candidate pools. Quota counts are unavailable; no percentage-based selection has been applied.',
     'تعذر التحقق من مجموعات السفن المرشحة المؤهلة. الأعداد غير متاحة ولم يتم تطبيق أي اختيار بالنسب.');
   }
  });
 }
 capacityDemoMode=true;capacityBusy=false;capacityAiBusy=false;
 capacityContext:CapacityContext|null=null;capacityPreview:CapacityPreview|null=null;
 capacityRequiresC01=false;capacityRequiresRestore=false;private capacityEntryFromCandidates=false;
 capacityProposal:CapacitySchedule|null=null;capacityAiOptionId='';
 capacityError='';capacityAiMessage='';
 step=1;preview:SiBulkPreview|null=null;planId:string|null=null;
 focusedImo='';returnedFromScheduling=false;
 get focusedVessel():SiBulkVessel|null{
  return this.preview?.vessels.find(v=>v.imo===this.focusedImo)||null;
 }
 job:SiBulkJob|null=null;loading=false;submitting=false;error='';
 scheduleApproval:{planId:string;approvedVesselCount:number;createdInspectionCases:number}|null=null;
 reason='';generateA04=false;private timer:Subscription|null=null;
 constructor(private api:SiBulkPlanService,private readonly route:ActivatedRoute,
  public lang:LanguageService,public auth:MoeiAuthService,
  private readonly candidates:SiCandidateTargetingService,
  private readonly http:HttpClient){}
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
 get v2RosterError():string{
  const p=this.preview;
  if(!p)return '';
  if(p.selectedVessels>500)return this.copy(
    'A roster can contain up to 500 vessels. Divide the draft into independently approved plans.',
    'يمكن اعتماد 500 سفينة بحد أقصى في القائمة الواحدة. قسّم المسودة إلى خطط مستقلة.');
  if(p.vessels.some(v=>!Number.isInteger(v.rank)||(v.rank??0)<1||
      (v.rank??0)>p.selectedVessels))
   return this.copy('A selected vessel has no valid plan rank. Reopen Candidate & Targeting and refresh.',
    'توجد سفينة دون ترتيب صحيح في الخطة. ارجع إلى شاشة المرشحين وحدّث بيانات الخطة.');
  if(p.vessels.some(v=>!v.inspectionRegimes?.length))
   return this.copy('Inspection scope is missing for one or more vessels. Refresh sources.',
    'نطاق المعاينة غير متاح لسفينة أو أكثر. حدّث مصادر البيانات.');
  if(p.vessels.some(v=>!v.reasons?.length||
      v.reasons.some(r=>!r.eventKey?.trim())))
   return this.copy('A selected vessel has no verified source reason/event key.',
    'توجد سفينة لا تحتوي على سبب إحالة موثق أو رمز الحدث الأصلي.');
  return '';
 }
 private v2ApprovalError(code:string):string{
  const items:Record<string,[string,string]>={
    SI_V2_PLAN_APPROVAL_INFORMATION_INVALID:[
      'Supervisor approval requires a valid plan version and an explanation of at least 8 characters.',
      'يتطلب اعتماد المشرف نسخة خطة صحيحة وسبب اعتماد لا يقل عن 8 أحرف.'],
    SI_V2_PLAN_APPROVAL_NO_VESSELS:[
      'No vessels were selected for this approval.',
      'لا توجد سفن محددة للاعتماد.'],
    SI_V2_PLAN_APPROVAL_ROSTER_LIMIT_500:[
      'Maximum 500 vessels per approval. Create another rolling plan for the remaining vessels.',
      'الحد الأقصى 500 سفينة في كل اعتماد. أنشئ خطة أخرى لباقي السفن.'],
    SI_V2_PLAN_APPROVAL_IMO_INVALID:[
      'A selected vessel has an invalid IMO.',
      'توجد سفينة محددة برقم IMO غير صالح.'],
    SI_V2_PLAN_APPROVAL_DUPLICATE_IMO:[
      'The same IMO was submitted more than once.',
      'تم إدراج نفس رقم IMO أكثر من مرة.'],
    SI_V2_PLAN_APPROVAL_RANK_INVALID:[
      'The proposed plan contains a missing, invalid or repeated priority rank. Refresh the plan.',
      'ترتيب الأولوية مفقود أو غير صالح أو مكرر. حدّث الخطة.'],
    SI_V2_PLAN_APPROVAL_REGIMES_MISSING:[
      'One or more selected vessels have no inspection regime. Verify source records.',
      'سفينة أو أكثر لا تحتوي على نوع المعاينة. تحقق من بيانات المصدر.'],
    SI_V2_PLAN_APPROVAL_SOURCE_REASONS_MISSING:[
      'One or more vessels are missing source event keys or inspection reasons.',
      'سفينة أو أكثر ينقصها رمز حدث المصدر أو أسباب المعاينة.'],
    SI_V2_PLAN_SOURCE_CHANGED_OR_MISSING:[
      'Saved source data changed or approval is not ready. Reload the plan before retrying.',
      'تغيرت البيانات المحفوظة أو الخطة غير جاهزة. أعد تحميلها قبل المحاولة.']
  };
  const row=items[code];
  return row?this.copy(row[0],row[1]):code;
 }
 get totalReasons():number{return this.preview?.vessels.reduce((n,v)=>n+v.reasons.length,0)||0;}
 get totalScopes():number{return this.preview?.vessels.reduce((n,v)=>n+v.inspectionRegimes.length,0)||0;}
 get canNext():boolean{
  if(!this.preview||this.loading||this.returnedFromScheduling)return false;
  if(this.step===1||this.step===2){
   const quota=this.quotaPreview;
   const maybeRequired=Boolean(this.factorPool?.some(v=>
    v.sourceTypes.includes('NMC_CASE')||
    v.sourceTypes.includes('SERVICE_REQUEST')));
   return !this.preview.stale&&!this.hasMissingReasons&&
    this.factorPool!==null&&!this.factorPoolLoading&&
    (this.preview.selectedVessels>0||
     (quota?.uniqueSelectedCount||0)>0||maybeRequired);
  }
  if(this.step===3)
   return this.draftCapacityScopeMatches&&!!this.capacityProposal&&!!this.capacityProposal.variants?.length&&
    this.capacityProposal.summary.proposed>0&&
    (this.capacityPreview?.selection.capacity.mandatoryUnscheduled.length||0)===0;
  return false;
 }
 ngOnInit():void{
  this.planId=this.route.snapshot.paramMap.get('planId');
  this.capacityEntryFromCandidates=this.route.snapshot.queryParamMap.get('stage')==='capacity';
  if(this.capacityEntryFromCandidates)this.step=3;
  const incoming=this.route.snapshot.queryParamMap.get('imo')||'';
  this.returnedFromScheduling=this.route.snapshot.queryParamMap.get('origin')==='scheduling';
  if(this.returnedFromScheduling){this.capacityEntryFromCandidates=false;this.step=1;}
  this.focusedImo=this.returnedFromScheduling&&/^[0-9]{7}$/.test(incoming)?incoming:'';
  if(!this.planId){
   this.error=this.copy('Select a numbered rolling plan from Candidate & Targeting first.',
     'اختر خطة مرقمة من شاشة السفن المرشحة أولًا.');
   return;
  }
  this.refresh();
  if(!this.returnedFromScheduling)this.loadFactorCandidatePool();
  this.api.latest().subscribe({next:r=>{
   const newest=r.batches?.find(b=>b.rollingPlanId===this.planId);
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
  if(this.submitting||!this.planId)return;this.loading=true;this.error='';
  this.api.preview(this.planId).subscribe({
   next:p=>{
    this.preview=p;this.loading=false;
    this.generateA04=p.a04Enabled&&p.a04Provider==='MOCK';
    // No SI-P01 in the current POC.
   },error:e=>{this.loading=false;
    this.error=e?.error?.error||this.copy('Plan preview could not be loaded.',
      'تعذر تحميل معاينة الخطة.');}
  });
 }
 previous():void{if(this.step>1&&this.step<5)this.step--;}
 next():void{
  if(!this.canNext)return;
  this.step++;
  if(this.step>=2&&!this.capacityContext)this.loadCapacityContext();
 }
 invalidateCapacityPreview():void{
  this.capacityPreview=null;this.capacityProposal=null;this.capacityAiOptionId='';
  this.capacityAiMessage='';
 }
 capacityActionLabel(code:string):string{
  const labels:Record<string,[string,string]>={
   CROSS_PORT_ALTERNATIVE_REVIEW:['Neighboring-port inspector review','بحث مهندس من ميناء مجاور'],
   OUT_OF_HOURS_SHIFT_APPROVAL_REVIEW:['Request approved out-of-hours shift','طلب اعتماد تكليف خارج الدوام الرسمي'],
   ESCALATE_MANDATORY_INSPECTION_CAPACITY:['Escalate compulsory inspection','تصعيد المعاينة الإلزامية'],
   CHECK_REGULATORY_CANCELLATION_OR_DEFERRAL_ELIGIBILITY:[
    'Check if legal cancellation / deferral is permitted',
    'التحقق من السماح التنظيمي بالإلغاء أو التأجيل']
  };
  const entry=labels[code];return entry?this.copy(entry[0],entry[1]):code;
 }
 get preferredCapacityOptionId():string{
  return this.capacityAiOptionId||this.capacityProposal?.variants?.[0]?.optionId||'';
 }
 get approvedCapacityVariant():CapacityVariant|null{
  return this.capacityProposal?.variants.find(v=>
   v.optionId===this.preferredCapacityOptionId)||null;
 }
 get draftCapacityScopeMatches():boolean{
  const scope=this.capacityContext?.selection.draftScope;
  if(!scope?.locked)return true;
  const expected=new Set(scope.selectedImos);
  const selected=this.approvedCapacityVariant?.assignments||[];
  return expected.size===selected.length&&
   new Set(selected.map(x=>x.imo)).size===selected.length&&
   selected.every(x=>expected.has(x.imo));
 }
 get missingDraftCapacityImos():string[]{
  const expected=this.capacityContext?.selection.draftScope?.selectedImos||[];
  const selected=new Set((this.approvedCapacityVariant?.assignments||[])
   .map(x=>x.imo));
  return expected.filter(imo=>!selected.has(imo));
 }
 get canApproveCapacity():boolean{
  return this.draftCapacityScopeMatches&&!!this.planId&&!this.returnedFromScheduling&&!this.submitting&&
   !this.capacityBusy&&!this.capacityAiBusy&&this.auth.isAdmin&&
   !!this.capacityContext&&!!this.capacityProposal&&
   !!this.approvedCapacityVariant&&this.reason.trim().length>=8&&
   (this.capacityPreview?.selection.capacity.mandatoryUnscheduled.length||0)===0;
 }
 get capacityUrl():string{
  return '/api/si/v1/inspection-plans/'+encodeURIComponent(this.planId||'')+'/capacity-';
 }
 invalidateCapacity():void{
  this.capacityContext=null;this.capacityPreview=null;this.capacityProposal=null;
  this.capacityAiOptionId='';this.capacityAiMessage='';
 }
 loadCapacityContext():void{
  if(!this.planId||this.capacityBusy||this.returnedFromScheduling)return;
  this.capacityBusy=true;this.capacityError='';this.capacityRequiresC01=false;
  this.capacityRequiresRestore=false;this.error='';
  const params=new HttpParams()
   .set('psc',String(this.planningWeights[0].value))
   .set('uae',String(this.planningWeights[1].value))
   .set('demo',this.capacityDemoMode?'1':'0');
  this.http.get<CapacityContext>(this.capacityUrl+'context',{params}).subscribe({
   next:r=>{
    this.capacityContext=r;this.capacityBusy=false;
    this.capacityPreview=null;this.capacityProposal=null;this.capacityAiOptionId='';
    // Read-only capacity calculation; AI and supervisor approval remain manual.
    if(this.capacityEntryFromCandidates){
     this.capacityEntryFromCandidates=false;this.previewCapacity();
    }
   },
   error:e=>{this.capacityBusy=false;
    this.capacityEntryFromCandidates=false;
    this.capacityRequiresC01=e?.error?.error==='SI_C01_CONFIGURED_SELECTION_REQUIRED_RUN_AI';
    this.capacityRequiresRestore=e?.error?.error==='SI_DRAFT_CAPACITY_STALE_RECALCULATE_REQUIRED';
    this.capacityError=e?.error?.error||
     this.copy('Unable to load verified capacity context.',
      'تعذر تحميل بيانات الطاقة التشغيلية الموثقة.');}
  });
 }
 private capacityRequests():object[]{
  return (this.capacityContext?.items||[]).map(v=>({
   imo:v.imo,portId:v.portId,vesselType:v.vesselType,regime:v.regime,
   locationType:v.locationType,locationName:v.locationName,
   siteAccessConfirmed:v.siteAccessConfirmed,
   berthAtLocal:v.berthAtLocal||'',berthConfirmed:v.berthConfirmed===true,
   berthEvidenceReference:v.berthEvidenceReference||'',
   durationMinutes:Number(v.durationMinutes),
   earliestLocal:v.etaLocal||v.earliestLocal,
   latestFinishLocal:v.etdLocal||v.latestFinishLocal,
   windowSource:v.etdLocal?'MSW_FINAL':v.windowSource||'OFFICER_FINAL',
   windowEvidenceReference:v.etdLocal?v.dateEvidenceReference:
    v.windowEvidenceReference||v.nmcReferrals?.[0]?.id||''
  }));
 }
 capacityParams():object{
  return {
   requests:this.capacityRequests(),demoMode:this.capacityDemoMode,
   pscRiskRatePercent:this.planningWeights[0].value,
   uaeFlagRatePercent:this.planningWeights[1].value,
   expectedSourceHash:this.capacityContext?.sourceHash,
   expectedPlanRevision:this.capacityContext?.planRevision,
   expectedSelectionHash:this.capacityContext?.selection.selectionHash
  };
 }
 previewCapacity():void{
  if(!this.capacityContext||this.capacityBusy||this.capacityAiBusy)return;
  this.capacityBusy=true;this.capacityError='';this.capacityAiOptionId='';
  this.http.post<CapacityPreview>(this.capacityUrl+'preview',
   this.capacityParams()).subscribe({
    next:r=>{this.capacityBusy=false;this.capacityPreview=r;
     this.capacityProposal=r.proposal;},
    error:e=>{this.capacityBusy=false;this.capacityError=
     e?.error?.error||'SI_INTEGRATED_CAPACITY_PREVIEW_FAILED';}
   });
 }
 runCapacityAi():void{
  if(!this.capacityContext||!this.capacityProposal||
     this.capacityBusy||this.capacityAiBusy)return;
  if(!window.confirm(this.copy(
    'Run SI-S01 to rank capacity-verified plan alternatives? Approval and resource booking remain separate.',
    'هل تريد تشغيل SI-S01 لترتيب بدائل الخطة المتحققة من الطاقة؟ الاعتماد وحجز الموارد إجراءان منفصلان.')))return;
  this.capacityAiBusy=true;this.capacityError='';
  this.http.post<{chosenOptionId:string;provider:string;
    proposal:CapacitySchedule;proposalHash:string}>(
     this.capacityUrl+'ai-recommend',{
     ...this.capacityParams(),
     expectedProposalHash:this.capacityProposal.proposalHash,
     confirmRun:true,confirmCost:true
  }).subscribe({
   next:r=>{
    this.capacityAiBusy=false;
    if(r.proposalHash!==this.capacityProposal?.proposalHash){
     this.invalidateCapacity();this.capacityError=
      'SI_INTEGRATED_AI_SOURCE_CHANGED_REPREVIEW';return;
    }
    this.capacityAiOptionId=r.chosenOptionId;
    this.capacityAiMessage=this.copy(
     r.provider==='POC_MOCK'?'POC MOCK ordering (no external AI request).':
      'Airia ranked verified alternatives (one explicit call).',
     r.provider==='POC_MOCK'?'ترتيب تجريبي دون استدعاء AI خارجي.':
      'رتّب Airia بدائل الطاقة الموثقة باستدعاء صريح واحد.');
   },
   error:e=>{this.capacityAiBusy=false;this.capacityError=
    e?.error?.error||'SI_INTEGRATED_AI_RECOMMENDATION_FAILED';}
  });
 }
 approve():void{
  if(!this.canApproveCapacity||!this.capacityContext||
    !this.capacityProposal||!this.approvedCapacityVariant)return;
  const variant=this.approvedCapacityVariant;
  const remote=variant.assignments.filter(x=>x.crossPort);
  if(remote.length&&!window.confirm(this.copy(
    'Explicitly approve '+remote.length+' cross-port engineer assignments with verified travel constraints?',
    'هل تعتمد صراحةً '+remote.length+' تكليفات لمهندسين من موانئ أخرى وفق قيود الانتقال؟')))return;
  if(!window.confirm(this.copy(
    'Final single approval: '+variant.assignments.length+
     ' vessels + inspectors + visit times + work orders. No live ERP booking. Continue?',
    'اعتماد واحد نهائي يشمل '+variant.assignments.length+
     ' سفينة والمهندسين والمواعيد وإصدار أوامر التكليف. لا ينشأ حجز ERP رسمي. متابعة؟')))return;
  this.submitting=true;this.error='';this.capacityError='';
  this.http.post<{planId:string;approvedVesselCount:number;
    createdInspectionCases:number;capacityExcludedImos:{imo:string}[]}>(
    this.capacityUrl+'approve',{
      ...this.capacityParams(),
      selectedOptionId:variant.optionId,
      expectedProposalHash:this.capacityProposal.proposalHash,
      reason:this.reason.trim(),confirmApproval:true,
      confirmCrossPort:remote.length>0
    }).subscribe({
     next:r=>{this.submitting=false;this.scheduleApproval={
      planId:r.planId,approvedVesselCount:r.approvedVesselCount,
      createdInspectionCases:r.createdInspectionCases};
      this.job=null;this.step=5;},
     error:e=>{
      this.submitting=false;
      if(e?.error?.error==='SI_DRAFT_SAVED_CAPACITY_CHANGED_REVIEW_REQUIRED'){
        this.capacityError=this.copy(
          'Inspector capacity changed for saved vessel(s): '+
            (e.error.missingImos||[]).join(', ')+
            '. The plan was not approved; please review and recheck capacity.',
          'تغيرت طاقة المهندسين للسفن المحفوظة: '+
            (e.error.missingImos||[]).join(', ')+
            '. لم تعتمد الخطة؛ يرجى مراجعة الإسناد وإعادة فحص الطاقة.'
        );
        this.invalidateCapacityPreview();
      }else if(e?.error?.error==='SI_APPROVAL_TRANSACTION_FAILED'){
        const diagnostic=e.error;
        const phase:Record<string,[string,string]>={
         'PLAN_STATE_LOCK':['loading saved plan','تحميل الخطة المحفوظة'],
         'PLAN_SOURCE_REVALIDATION':['reviewing source evidence','مراجعة مصادر السفن'],
         'PLAN_STATE_WRITE':['saving plan approval','حفظ اعتماد الخطة'],
         'PLAN_VERSION_WRITE':['recording plan revision','تسجيل إصدار الخطة'],
         'APPROVED_VESSEL_WRITE':['saving approved vessels','حفظ السفن المعتمدة'],
         'APPROVED_SOURCE_REASON_WRITE':['saving inspection reasons','حفظ أسباب المعاينات'],
         'PLAN_APPROVAL_AUDIT':['recording approval audit','تسجيل تدقيق الاعتماد'],
         'SCHEDULE_WORK_ORDER_WRITE':['issuing inspector work orders','إصدار أوامر تكليف المهندسين'],
         'ORACLE_COMMIT':['finalizing the transaction','إتمام معاملة Oracle'],
         'PREAPPROVAL_OR_DEPENDENCY':['verifying live dependencies','التحقق من البيانات والخدمات']
        };
        const operation:Record<string,[string,string]>={
         'SCHEDULE_HEADER_INSERT':['saving the schedule header','حفظ بيانات الجدول'],
         'WORK_ORDER_INSERT':['saving an inspector work order','حفظ أمر تكليف المهندس'],
         'SCHEDULE_AUDIT_INSERT':['saving the schedule audit','تسجيل تدقيق الجدول']
        };
        const step=operation[diagnostic.scheduleSqlStage]||
          phase[diagnostic.stage]||phase['PREAPPROVAL_OR_DEPENDENCY'];
        const ref=diagnostic.oracleCode?
          ' ('+diagnostic.oracleCode+')':'';
        this.capacityError=this.copy(
         'Approval was NOT confirmed while '+step[0]+ref+
          '. Review the server log entry [si-approval] before retrying.',
         'لم يتأكد اعتماد الخطة أثناء '+step[1]+ref+
          '. راجع سجل [si-approval] على الخادم قبل إعادة المحاولة.'
        );
      }else{
        this.capacityError=e?.error?.error||'SI_INTEGRATED_APPROVAL_FAILED';
      }
     }
    });
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
