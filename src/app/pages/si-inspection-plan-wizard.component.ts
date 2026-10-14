import {CommonModule} from '@angular/common';
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
     <div class="si-weight-grid">
      <label *ngFor="let w of planningWeights" class="si-weight-control">
       <span class="si-weight-heading">
        <strong>{{copy(w.en,w.ar)}}</strong>
        <output>{{w.value}}%</output>
       </span>
       <small>{{copy(w.descriptionEn,w.descriptionAr)}}</small>
       <input type="range" min="0" max="100" step="1"
        [ngModel]="w.value" (ngModelChange)="changePlanningWeight(w.key,$event)"
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
       'Planning preview only: percentages are not yet saved or applied to final AI selection, capacity optimization or plan approval. No official risk score, approved source decision or work order is changed.',
       'معاينة تخطيط فقط: لم تُحفظ النسب أو تُطبّق بعد على اختيار AI النهائي أو تحسين الطاقة أو اعتماد الخطة. لا يتم تغيير تقييم المخاطر الرسمي أو قرارات المصادر أو أوامر التكليف.')}}</p>
    </section>
    <section class="panel" *ngIf="step===1">
     <div class="panel-head">
      <div><p class="eyebrow">{{copy('STEP 01 · INSPECTION PLAN','الخطوة ١ · خطة المعاينات')}}</p>
       <h2>{{copy('Vessels included in the plan','السفن التي ستدخل خطة المعاينات')}}</h2>
       <p>{{copy('The current officer-reviewed plan is the source. Selection may be manual or C01-assisted; each decision has human accountability.',
         'مصدر الاعتماد هو الخطة بعد مراجعة الموظف. يمكن الاختيار يدويًا أو بمساعدة C01، والمسؤولية البشرية محفوظة.')}}</p></div>
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
     <p class="eyebrow">{{copy('STEP 03 · AI-PROPOSED SCHEDULING','الخطوة ٣ · الجدولة المقترحة')}}</p>
     <h2>{{copy('Approval freezes the selected vessels, not inspection cases',
       'اعتماد قائمة السفن دون إنشاء حالات معاينة')}}</h2>
     <div class="workflow">
      <div><span class="flow-icon">1</span><div><b>{{copy('Freeze approved vessel roster','تثبيت السفن المعتمدة')}}</b>
       <p>{{copy('Store all PSC, Service Request and approved NMC referral reasons. No cases or inspector dossiers are created now.',
        'حفظ كل أسباب إحالة PSC وطلبات الخدمات وNMC. لا تنشأ حالات أو دوسيهات للمفتش في هذه المرحلة.')}}</p></div></div>
      <div><span class="flow-icon">2</span><div><b>{{copy('Generate comprehensive maritime schedule','إنشاء جدولة بحرية شاملة')}}</b>
       <p>{{copy('Source-final ETD needs no separate approval. Feasible inspectors are matched by vessel type, inspection regime, port and ERP availability. GT limits are not a requirement.',
        'تاريخ المغادرة النهائي لا يتطلب اعتمادًا إضافيًا. يتم اختيار المهندس طبقًا لنوع السفينة والمعاينة والموقع والإتاحة، دون شرط نطاقات الحمولة.')}}</p></div></div>
      <div><span class="flow-icon">3</span><div><b>{{copy('Supervisor approves the proposed schedule','المشرف يعتمد توزيع المواعيد والمهندسين')}}</b>
       <p>{{copy('Schedule approval is independent of date finality. No auto-booking, case creation or NMC closure before the approved execution workflow.',
        'اعتماد الجدولة مستقل عن نهائية تاريخ المغادرة. لا يتم الحجز أو إنشاء حالات أو إغلاق NMC قبل إتمام المسار المعتمد.')}}</p></div></div>
     </div>
     <p class="notice">{{copy('The ERP workforce import is a POC simulator; missing berth access, final departure date or qualified available inspector causes UNSCHEDULED, never a fabricated booking.',
       'بيانات ERP في الـPOC تجريبية. غياب معلومات الرصيف أو تاريخ المغادرة أو المهندس المؤهل يؤدي لعرض السفينة كغير مجدولة، وليس اختراع حجز.')}}</p>
    </section>
    <section class="panel" *ngIf="step===4">
     <p class="eyebrow">{{copy('STEP 04 · SUPERVISOR APPROVAL','الخطوة ٤ · اعتماد المسؤول')}}</p>
     <h2>{{copy('Review and approve the whole plan','مراجعة واعتماد الخطة بالكامل')}}</h2>
     <div class="review-stats">
      <p><b>{{p.selectedVessels}}</b><span>{{copy('Selected vessels','السفن المختارة')}}</span></p>
      <p><b>{{totalReasons}}</b><span>{{copy('Source reasons preserved','أسباب إحالة محفوظة')}}</span></p>
      <p><b>{{totalScopes}}</b><span>{{copy('Regulatory inspection scopes','نطاقات معاينة نظامية')}}</span></p>
     </div>
     <p class="notice">{{copy('All collected reasons and scopes were shown in Step 2. Approval covers the entire currently selected plan, not a single referral per vessel.',
       'تم عرض جميع الأسباب والنطاقات في الخطوة الثانية. الاعتماد يشمل الخطة الحالية بالكامل وليس إحالة واحدة لكل سفينة.')}}</p>
     <label class="approval-notes">{{copy('Supervisor approval notes','ملاحظات اعتماد المشرف')}}
      <textarea rows="3" maxlength="500" [(ngModel)]="reason"
        [placeholder]="copy('Document why the selected plan is approved','سجل سبب اعتماد الخطة المختارة')"></textarea>
     </label>
     <p class="notice">{{copy('Only the selected vessel roster is approved now. Electronic scheduling is the next independent step.',
        'سيتم اعتماد قائمة السفن فقط؛ الخطوة التالية هي الجدولة الإلكترونية واعتماد توزيع المهندسين.')}}</p>
     <p *ngIf="v2RosterError" class="notice error" role="alert">{{v2RosterError}}</p>
     <button type="button" class="approve" (click)="approve()"
      [disabled]="returnedFromScheduling||submitting||jobBusy||!auth.isAdmin||reason.trim().length<8||p.stale||(!p.agentRunId&&!p.manualSelection)||hasMissingReasons||!!v2RosterError">
      {{submitting?copy('Submitting approval…','جارٍ إرسال الاعتماد…'):
       copy('Approve '+p.selectedVessels+' Vessels for Scheduling',
        'اعتماد '+p.selectedVessels+' سفن للجدولة')}}
     </button>
     <p class="hint">{{copy('Approval is one human-authorized decision. The AI never approves inspections.',
       'الاعتماد قرار واحد يصدر من مستخدم مخول، وليس من الذكاء الاصطناعي.')}}</p>
    </section>
    <section class="panel" *ngIf="step===5&&scheduleApproval as approval">
     <p class="eyebrow">{{copy('STEP 05 · AWAITING MARITIME SCHEDULING','الخطوة الخامسة · في انتظار الجدولة البحرية')}}</p>
     <h2>{{copy('Plan approved — No inspection cases were created','اعتمدت الخطة دون إنشاء حالات معاينة')}}</h2>
     <p class="notice">{{copy('Approved vessels','السفن المعتمدة')}}: <b>{{approval.approvedVesselCount}}</b> ·
      {{copy('Inspection cases created','حالات معاينة منشأة')}}: <b>{{approval.createdInspectionCases}}</b></p>
     <p>{{copy('All referral reasons are retained. Continue to the comprehensive scheduling board to assign time, location and an available qualified engineer.',
      'تم الاحتفاظ بجميع أسباب المعاينة. انتقل للجدولة الشاملة لتحديد الموعد والمكان والمهندس المؤهل والمتاح.')}}</p>
     <div class="step-actions">
      <a class="next" [routerLink]="['/moei/smart-inspection/scheduling/plan',approval.planId]">
       {{copy('Open Maritime Scheduling Board →','فتح لوحة الجدولة البحرية ←')}}</a>
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
 @media(max-width:1220px){.wizard-main{margin-inline-start:90px;padding:24px}}
 @media(max-width:960px){.wizard-main{margin-inline-start:0;padding:20px}.steps{grid-template-columns:repeat(2,1fr)}}
 @media(max-width:600px){.wizard-main{padding:13px}.wizard-hero,.panel-head{display:block}.steps{gap:4px}.step-item{font-size:10px;padding:7px}
 .panel{padding:15px}.summary,.review-stats{grid-template-columns:1fr}.step-actions{gap:7px}}
 `]
})
export class SiInspectionPlanWizardComponent implements OnInit,OnDestroy{
 readonly stages=[{en:'Selected Vessels',ar:'السفن المختارة'},
  {en:'All Referral Reasons',ar:'أسباب المعاينة'},{en:'Electronic Scheduling',ar:'الجدولة الإلكترونية'},
  {en:'Review & Approval',ar:'المراجعة والاعتماد'}];
 readonly planningWeights=[
  {key:'PSC_RISK',en:'PSC + Risk Factor',ar:'PSC + عامل المخاطر',
   descriptionEn:'Percentage of eligible PSC vessels, ranked by saved vessel risk.',
   descriptionAr:'نسبة من سفن PSC المؤهلة، تُرتّب حسب مخاطر السفينة المحفوظة.',value:15},
  {key:'UAE_FLAG',en:'UAE-Flagged Vessels',ar:'السفن التي تحمل علم الإمارات',
   descriptionEn:'Independent percentage of eligible UAE-flagged candidate vessels.',
   descriptionAr:'نسبة مستقلة من السفن المرشحة المؤهلة التي تحمل علم الإمارات.',value:0}
 ];
 factorPool:InspectionQuotaCandidate[]|null=null;
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
  const w=this.planningWeights.find(x=>x.key===key);const v=Number(value);
  if(w&&Number.isFinite(v))w.value=Math.max(0,Math.min(100,Math.round(v)));
 }
 private loadFactorCandidatePool():void{
  this.factorPoolLoading=true;this.factorPoolError='';
  this.candidates.dashboard().subscribe({
   next:dashboard=>{
    const eligibleByImo=new Map<string,Set<string>>();
    // Only backend-eligible candidate source workflows count, not every
    // vessel event present in a raw imported Excel sheet.
    for(const c of dashboard.candidates){
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
   },
   error:()=>{
    this.factorPool=null;this.factorPoolLoading=false;
    this.factorPoolError=this.copy(
     'Cannot verify the eligible candidate pools. Quota counts are unavailable; no percentage-based selection has been applied.',
     'تعذر التحقق من مجموعات السفن المرشحة المؤهلة. الأعداد غير متاحة ولم يتم تطبيق أي اختيار بالنسب.');
   }
  });
 }
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
  private readonly candidates:SiCandidateTargetingService){}
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
 get canNext():boolean{return !!this.preview&&this.step<4&&this.preview.selectedVessels>0&&
  (!!this.preview.agentRunId||!!this.preview.manualSelection)&&
  !this.preview.stale&&!this.hasMissingReasons&&!this.loading;}
 ngOnInit():void{
  this.planId=this.route.snapshot.paramMap.get('planId');
  const incoming=this.route.snapshot.queryParamMap.get('imo')||'';
  this.returnedFromScheduling=this.route.snapshot.queryParamMap.get('origin')==='scheduling';
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
 next():void{if(this.canNext)this.step++;}
 approve():void{
  if(this.returnedFromScheduling)return;
  const p=this.preview;if(!this.planId||!p||this.submitting||this.jobBusy||!this.auth.isAdmin||
   (!p.agentRunId&&!p.manualSelection)||p.stale||this.hasMissingReasons||this.reason.trim().length<8||!!this.v2RosterError)return;
  const message=this.copy(
   'Approve the roster of '+p.selectedVessels+' vessels for comprehensive scheduling? No inspection case or dossier will be created at plan approval.',
   'اعتماد قائمة '+p.selectedVessels+' سفن لجدولتها إلكترونيًا؟ لن يتم إنشاء أي حالة معاينة أو دوسيه الآن.'
  );
  if(!window.confirm(message))return;
  this.submitting=true;this.error='';
  this.api.approveForScheduling({
    planId:this.planId!,reason:this.reason.trim(),expectedRevision:p.planRevision,
    expectedSourceHash:p.sourceHash,confirmApproval:true
  }).subscribe({
    next:result=>{
      this.submitting=false;this.scheduleApproval={
        planId:result.planId,approvedVesselCount:result.approvedVesselCount,
        createdInspectionCases:result.createdInspectionCases};
      this.job=null;this.step=5;
    },
    error:e=>{
      this.submitting=false;this.error=this.v2ApprovalError(
        e?.error?.error||'SI_V2_PLAN_APPROVAL_UNAVAILABLE');
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
