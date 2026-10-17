import {CommonModule} from '@angular/common';
import {HttpClient,HttpHeaders} from '@angular/common/http';
import {Component,OnInit} from '@angular/core';
import {forkJoin} from 'rxjs';
import {FormsModule} from '@angular/forms';
import {RouterLink} from '@angular/router';
import {NmcNavigationComponent} from '../components/nmc-navigation.component';
import {LanguageService} from '../services/language.service';
import {SiLifecycleCase,SiLifecycleView} from '../services/si-lifecycle.service';

type Decision='APPROVE_REPORT'|'RETURN_REPORT'|'CLOSE'|'ISSUE_ACTIONS';
type ReviewTab='DOSSIER'|'REPORT'|'CAPA'|'DECISION';
interface DetailAnswer{source:string;title:string;itemId:string;answerStatus:string;
 answers:Record<string,unknown>;answeredBy:string|null;answerUpdatedAt:string|null;
 evidenceRefs:string[];templateTitle:string;groupTitle:string|null;}
interface DossierItem{[key:string]:unknown;}
interface FullReview{
 caseId:string;imo:string;
 dossier:{status:string;revision:number|null;missingEvidence:string[];
  sections:{
   identity?:{vesselName?:string;imo?:string;flag?:string;vesselType?:string;
     regime?:string;regimes?:string[];approvedBy?:string};
   risk?:{score?:number;level?:string;evaluationId?:string;status?:string}|null;
   assignments?:{inspectorName?:string;portName?:string;startLocal?:string;
     operationalBookingConfirmed?:boolean}|null;
   referrals?:{allSourceReasons?:DossierItem[];objectives?:string[];inspectionScopes?:string[]};
   sourceEvidence?:{certificates?:DossierItem[];inspectionHistory?:DossierItem[];
     documents?:DossierItem[];openDeficiencies?:DossierItem[];
     externalDocumentsVerified?:boolean};
   aiAnalysis?:{status:string;generated:boolean;modelDraft?:{focusAreas?:DossierItem[];
     predictedDeficiencies?:DossierItem[]}|null};
  }|null;
 };
 inspector:{checks:{checkId:string;title:string;decision:string;mandatory:boolean;
  inspectorNote:string;naReason:string;severity:string|null;evidenceRefs:string[]}[];
  publishedChecklist:DetailAnswer[];evidenceFiles:{id:string;filename:string|null;
   itemId:string|null;mimeType:string|null}[];
  confirmedFindings:{id:string;title:string;severity:string;description:string;
   evidenceRefs:string[]}[];
  publishedChecklistState:string;
  signatures:{submittedBy:string|null;submittedAt:string|null;
   supervisor:string|null;approvedAt:string|null};
  counts:{checked:number;passed:number;deficiencies:number;notApplicable:number;dynamicQuestions:number}};
 nmc:{linked:boolean;referralId:string|null;linkedCaseId:string|null;
   booking:{id:string;status:string}|null};
 regulatory:{riyadhMouReportingPotentiallyApplicable:boolean;
  officialRiyadhIntegrationConfirmed:false;transmissionStatus:string};
 audit:{id:string;version:number;action:string;actor:string;at:string;reason:string}[];
}
type RegulatoryType='PREPARE_RIYADH_MOU_REPORT'|'REFER_DETENTION_REVIEW'|
 'REQUEST_ADDITIONAL_INSPECTION'|'PREPARE_NMC_NOTIFICATION';
interface DraftRow{type:RegulatoryType;state:string;preparedBy:string;
 preparedAt:string;reason:string;officialSubmission:false;}

@Component({
 selector:'app-si-supervisor-review',standalone:true,
 imports:[CommonModule,FormsModule,RouterLink,NmcNavigationComponent],
 template:`
 <div class="supervisor-shell" [attr.dir]="lang.dir">
  <app-nmc-navigation></app-nmc-navigation>
  <main class="supervisor-main">
   <header class="si-title">
    <div><span class="kicker">MOEI · SMART INSPECTION</span>
     <h1>{{copy('Supervisor Approval & Closure','اعتماد المشرف وإغلاق المعاينات')}}</h1>
     <p>{{copy('Approve inspector reports, return reports for correction, and close only eligible cases.',
                 'اعتماد تقارير المفتشين وإعادتها للتعديل وإغلاق الحالات المستوفية فقط.')}}</p></div>
    <button class="button" (click)="load()" [disabled]="busy">{{copy('Refresh','تحديث')}}</button>
   </header>
   <div class="notice" *ngIf="notice">{{notice}}</div>
   <div class="error" role="alert" *ngIf="error">{{error}}</div>
   <div class="si-review-grid">
    <section class="panel queue">
      <header><h2>{{copy('Review Queue','قائمة التقارير')}}</h2>
        <span class="count">{{filtered.length}}</span></header>
      <input type="search" [(ngModel)]="search"
       [placeholder]="copy('Search vessel, IMO or inspection case','بحث بالسفينة أو IMO أو رقم المعاينة')"/>
      <div *ngIf="busy&&cases.length===0" class="muted">{{copy('Loading…','جاري التحميل…')}}</div>
      <p *ngIf="!busy&&filtered.length===0" class="muted">{{copy('No submitted inspection reports found.','لا توجد تقارير معاينات بانتظار المراجعة.')}}</p>
      <button *ngFor="let item of filtered" type="button" class="queue-item"
        [class.selected]="item.id===selectedId" (click)="open(item.id)" [disabled]="busy">
       <strong>{{item.vesselName}}</strong>
       <small>IMO {{item.imo}} · {{item.regime}}</small>
       <span class="status">{{item.stage.replaceAll('_',' ')}}</span>
       <small *ngIf="isNmc(item)">{{copy('From NMC Case','واردة من NMC Case')}}</small>
      </button>
    </section>
    <section class="panel details">
     <ng-container *ngIf="view as v;else noSelection">
      <div class="detail-head">
       <div><span class="kicker">{{copy('Vessel & Inspection','السفينة والمعاينة')}}</span>
        <h2>{{currentVesselName}}</h2>
        <p>IMO {{v.inspectionCase.imo}} · {{v.inspectionCase.regime}}</p></div>
       <span class="status">{{v.record?.stage?.replaceAll('_',' ')||'NOT_STARTED'}}</span>
      </div>
      <div class="attributes">
       <div><span>{{copy('Inspector','المفتش')}}</span>
        <strong>{{v.record?.assignment?.inspector||'—'}}</strong></div>
       <div><span>{{copy('Port','الميناء')}}</span>
        <strong>{{v.record?.assignment?.port||'—'}}</strong></div>
       <div><span>{{copy('Source','المصدر')}}</span>
        <strong>{{v.inspectionCase.nmcReferralId?'NMC Case Referral':'Smart Inspection'}}</strong></div>
       <div><span>{{copy('Inspection ID','رقم المعاينة')}}</span>
        <strong>{{v.inspectionCase.id}}</strong></div>
      </div>
      <nav class="review-tabs" role="tablist" aria-label="Supervisor inspection review sections">
       <button type="button" *ngFor="let section of reviewTabs"
        [class.selected]="tab===section.id" [attr.aria-selected]="tab===section.id"
        (click)="tab=section.id">
        {{copy(section.en,section.ar)}}
       </button>
      </nav>
      <section *ngIf="tab==='DOSSIER'" class="review-section" data-testid="si-supervisor-vessel-dossier">
       <ng-container *ngIf="full as detail;else sourceLoading">
        <h3>{{copy('Complete Vessel Dossier','ملف السفينة الكامل')}}</h3>
        <p class="muted">{{copy('Source-grounded vessel information. Missing evidence is shown explicitly.',
          'بيانات السفينة من المصادر المحفوظة؛ الأدلة غير المتاحة موضحة بشكل صريح.')}}</p>
        <div class="source-chip">{{detail.dossier.status}} · v{{detail.dossier.revision||'—'}}</div>
        <ng-container *ngIf="detail.dossier.sections as d">
         <div class="attributes dossier-grid">
          <div><span>{{copy('Vessel / IMO','السفينة / IMO')}}</span>
           <strong>{{d.identity?.vesselName||currentVesselName}} · {{detail.imo}}</strong></div>
          <div><span>{{copy('Flag / Vessel Type','العلم / نوع السفينة')}}</span>
           <strong>{{d.identity?.flag||'—'}} / {{d.identity?.vesselType||'—'}}</strong></div>
          <div><span>{{copy('Regime / Scopes','نوع المعاينة / النطاقات')}}</span>
           <strong>{{d.identity?.regime||v.inspectionCase.regime}} · {{d.identity?.regimes?.join(', ')||'—'}}</strong></div>
          <div><span>{{copy('Saved Risk Assessment','تقييم المخاطر المحفوظ')}}</span>
           <strong>{{d.risk?.level||'—'}} · {{d.risk?.score??'—'}}</strong></div>
          <div><span>{{copy('Assigned Inspector','المعاين المكلف')}}</span>
           <strong>{{d.assignments?.inspectorName||v.record?.assignment?.inspector||'—'}}</strong></div>
          <div><span>{{copy('Port / Schedule','الميناء / الجدولة')}}</span>
           <strong>{{d.assignments?.portName||v.record?.assignment?.port||'—'}}
            · {{d.assignments?.startLocal||'—'}}</strong></div>
         </div>
         <div class="dossier-collections">
          <div class="dossier-box"><h3>{{copy('Certificates & Documents','الشهادات والمستندات')}}</h3>
           <small>{{copy('Certificates','الشهادات')}}: {{d.sourceEvidence?.certificates?.length||0}}
            · {{copy('Documents','المستندات')}}: {{d.sourceEvidence?.documents?.length||0}}</small>
           <div class="finding" *ngFor="let item of d.sourceEvidence?.certificates">
            {{sourceTitle(item)}}</div>
           <div class="finding" *ngFor="let item of d.sourceEvidence?.documents">
            {{sourceTitle(item)}}</div>
           <p class="muted" *ngIf="!d.sourceEvidence?.certificates?.length&&!d.sourceEvidence?.documents?.length">
            {{copy('No verified certificates or documents in the available source bundle.',
             'لا توجد شهادات أو مستندات مؤكدة ضمن المصدر المتاح.')}}</p>
          </div>
          <div class="dossier-box"><h3>{{copy('Prior Inspections & Open Deficiencies','المعاينات السابقة والملاحظات المفتوحة')}}</h3>
           <div class="finding" *ngFor="let item of d.sourceEvidence?.inspectionHistory">
            {{sourceTitle(item)}}</div>
           <div class="finding" *ngFor="let item of d.sourceEvidence?.openDeficiencies">
            {{sourceTitle(item)}}</div>
           <p *ngIf="!d.sourceEvidence?.inspectionHistory?.length&&!d.sourceEvidence?.openDeficiencies?.length" class="muted">
            {{copy('No inspection history or open deficiencies in the available source.',
             'لا يوجد سجل معاينات أو مخالفات مفتوحة في البيانات المتاحة.')}}</p>
          </div>
          <div class="dossier-box"><h3>{{copy('Inspection Referrals & Intelligence','الإحالات وأسباب الاختيار')}}</h3>
           <div class="finding" *ngFor="let source of d.referrals?.allSourceReasons">
            {{sourceTitle(source)}}</div>
           <p class="muted" *ngIf="!d.referrals?.allSourceReasons?.length">
            {{copy('No source referrals recorded.','لا توجد إحالات محفوظة.')}}</p>
           <p *ngIf="d.aiAnalysis?.modelDraft?.predictedDeficiencies?.length" class="origin">
            {{copy('A04 AI hypotheses are advisory only; they are not confirmed deficiencies.',
             'توقعات A04 استشارية فقط، ولا تمثل مخالفات مثبتة.')}}</p>
          </div>
         </div>
        </ng-container>
        <div class="origin" *ngIf="detail.dossier.missingEvidence.length">
         <b>{{copy('Missing / Unverified Data','بيانات ناقصة أو غير متحقق منها')}}</b>
         <ul><li *ngFor="let gap of detail.dossier.missingEvidence">{{gap}}</li></ul>
        </div>
       </ng-container>
      </section>
      <article class="report review-section" *ngIf="tab==='REPORT'&&v.record?.report as report;else noReport">
       <h3>{{copy('Inspector Report','تقرير المفتش')}}</h3>
       <p>{{report.summary}}</p>
       <div class="attributes">
        <div><span>{{copy('Report status','حالة التقرير')}}</span><b>{{report.status}}</b></div>
        <div><span>{{copy('Inspected checks','البنود المفحوصة')}}</span><b>{{report.checksCompleted??v.record?.checks?.length}}</b></div>
        <div><span>{{copy('Confirmed findings','الملاحظات المؤكدة')}}</span><b>{{report.findingsCount}}</b></div>
        <div><span>{{copy('Major / Critical','كبيرة / حرجة')}}</span><b>{{report.majorCount}} / {{report.criticalCount}}</b></div>
       </div>
       <h3>{{copy('Inspector Checklist · Item by Item','قائمة المعاينة · قرار المفتش في كل بند')}}</h3>
       <p class="muted">{{copy('These are recorded human inspector decisions, not AI-generated compliance findings.',
        'القرارات المعروضة مسجلة بواسطة المفتش، وليست مخالفات تم إنشاؤها تلقائيًا بواسطة AI.')}}</p>
       <div class="review-table-wrap"><table class="review-table">
        <thead><tr><th>{{copy('Inspection Item','بند المعاينة')}}</th>
         <th>{{copy('Decision','قرار المفتش')}}</th>
         <th>{{copy('Inspector Note','ملاحظات المفتش')}}</th>
         <th>{{copy('Evidence','الأدلة')}}</th></tr></thead>
        <tbody><tr *ngFor="let check of full?.inspector?.checks">
         <td>{{check.title}}<small>{{check.checkId}}</small></td>
         <td><span class="decision-chip">{{check.decision}}</span>
          <small *ngIf="check.severity">{{check.severity}}</small></td>
         <td>{{check.inspectorNote||check.naReason||'—'}}</td>
         <td>{{check.evidenceRefs.join(', ')||'—'}}</td>
        </tr></tbody>
       </table></div>
       <h3>{{copy('Dynamic Checklist Answers','إجابات قوائم المعاينة الديناميكية')}}</h3>
       <small *ngIf="full">{{copy('Checklist status','حالة القائمة')}}:
        {{full.inspector.publishedChecklistState}}</small>
       <div *ngFor="let answer of full?.inspector?.publishedChecklist" class="question-answer">
        <div class="question-head"><b>{{answer.title}}</b><span class="status">{{answer.answerStatus}}</span></div>
        <small>{{answer.templateTitle}} · {{answer.groupTitle||'—'}} · {{answer.answeredBy||'—'}}</small>
        <div class="answer-fields">
         <span *ngFor="let field of answer.answers|keyvalue">
          <b>{{field.key}}:</b> {{field.value}}</span>
        </div>
        <small>{{copy('Evidence','الأدلة')}}: {{answer.evidenceRefs.join(', ')||'—'}}</small>
       </div>
       <div *ngIf="full?.inspector?.evidenceFiles?.length" class="dossier-box">
        <h3>{{copy('Uploaded Evidence Register','سجل الملفات والمرفقات')}}</h3>
        <p *ngFor="let evidence of full?.inspector?.evidenceFiles" class="evidence-row">
         <b>{{evidence.filename||evidence.id}}</b>
         <small>{{evidence.mimeType||'—'}} · {{evidence.id}} · {{evidence.itemId||'—'}}</small>
        </p>
        <small>{{copy('Evidence metadata is shown. Opening restricted original files requires a separate authorized evidence viewer.',
         'تُعرض بيانات المرفقات؛ فتح الملفات الأصلية يتطلب عارض أدلة مُصرحًا به.')}}</small>
       </div>
       <p *ngIf="full?.inspector?.signatures as signatures" class="origin">
        {{copy('Submitted by','مقدم التقرير')}}: {{signatures.submittedBy||'—'}}
        · {{copy('Submitted at','وقت التقديم')}}: {{signatures.submittedAt||'—'}}
        · {{copy('Supervisor','المشرف')}}: {{signatures.supervisor||'—'}}
       </p>
       <h3>{{copy('Inspector Findings','ملاحظات المفتش')}}</h3>
       <p *ngIf="!v.record?.findings?.length" class="muted">{{copy('No deficiencies recorded','لم يسجل المفتش مخالفات')}}</p>
       <div class="finding" *ngFor="let finding of v.record?.findings">
        <b>{{finding.title}} · {{finding.severity}}</b><p>{{finding.description}}</p>
        <small>{{copy('Evidence references','مراجع الأدلة')}}: {{finding.evidenceRefs.join(', ')||'—'}}</small>
       </div>
      </article>
      <section *ngIf="tab==='CAPA'" class="review-section" data-testid="si-supervisor-capa">
       <h3>{{copy('Corrective Action Plan (CAPA)','خطة الإجراءات التصحيحية')}}</h3>
       <p class="muted">{{copy('An approved inspector finding requires a traceable corrective owner, due date and follow-up verification before closure.',
        'كل مخالفة معتمدة تتطلب مسؤولًا عن التصحيح وموعدًا نهائيًا ومتابعة قبل الإغلاق.')}}</p>
       <p *ngIf="!v.record?.findings?.length" class="origin">
        {{copy('No confirmed findings: CAPA is not required for this report.',
          'لا توجد مخالفات مؤكدة؛ لا يلزم إصدار خطة إجراءات تصحيحية لهذا التقرير.')}}</p>
       <div *ngFor="let finding of v.record?.findings" class="finding">
        <b>{{finding.title}} · {{finding.severity}}</b>
        <p>{{finding.description}}</p>
        <small>{{copy('Evidence','الأدلة')}}: {{finding.evidenceRefs.join(', ')||'—'}}</small>
        <div class="capa-form" *ngIf="v.record?.stage==='REPORT_APPROVED'">
         <label>{{copy('Action Owner','المسؤول عن التصحيح')}}
          <input [(ngModel)]="capaDraft[finding.id].owner" maxlength="120"/></label>
         <label>{{copy('Due Date','التاريخ المستهدف')}}
          <input type="date" [(ngModel)]="capaDraft[finding.id].dueDate"/></label>
         <label>{{copy('Corrective Instruction','تعليمات التصحيح')}}
          <textarea rows="2" [(ngModel)]="capaDraft[finding.id].instruction" maxlength="900"></textarea></label>
        </div>
       </div>
       <div *ngFor="let action of v.record?.actions" class="finding">
        <b>{{action.instruction}}</b><small>{{action.status}} · {{action.owner}} · {{action.dueDate}}</small>
        <p>{{copy('Evidence','الأدلة')}}: {{action.evidenceRefs.join(', ')||'—'}}</p>
       </div>
       <button type="button" class="button approve" (click)="issueActions()"
        *ngIf="v.record?.stage==='REPORT_APPROVED'&&v.record?.findings?.length"
        [disabled]="busy||!canIssueActions">
         {{copy('Issue Corrective Actions','إصدار الإجراءات التصحيحية')}}</button>
       <h3>{{copy('Follow-Up Inspections','معاينات المتابعة')}}</h3>
       <div *ngFor="let follow of v.record?.followUps" class="finding">
        <b>{{follow.mode}} · {{follow.result}}</b><p>{{follow.note}}</p>
        <small>{{follow.inspector}} · {{follow.at}}</small>
       </div>
       <p *ngIf="!v.record?.followUps?.length" class="muted">
        {{copy('No follow-up verification has been recorded yet.','لم يتم تسجيل معاينة متابعة حتى الآن.')}}</p>
      </section>
      <section *ngIf="tab==='DECISION'" class="review-section" data-testid="si-supervisor-regulatory-actions">
       <h3>{{copy('Supervisor Decision & Regulatory Routing','قرار المشرف ومسارات الإبلاغ الرقابي')}}</h3>
       <div class="origin" *ngIf="v.inspectionCase.nmcReferralId">
        {{copy('This inspection originates from NMC referral','هذه المعاينة واردة من إحالة NMC')}}
        <b>{{v.inspectionCase.nmcReferralId}}</b>.
        {{copy('Approval / return is recorded in the linked NMC Case. Closing records the final inspection outcome.',
         'يتم تسجيل الاعتماد أو الإرجاع في NMC Case المرتبطة، ثم تُسجَّل النتيجة النهائية بعد إغلاق المعاينة.')}}</div>
       <div class="review-form">
        <label for="supervisor-reason">{{copy('Decision reason (at least 8 characters)','سبب القرار (8 أحرف على الأقل)')}}</label>
        <textarea id="supervisor-reason" rows="3" [(ngModel)]="reason"></textarea>
        <label class="si-nmc-ai-forward">
          <input type="checkbox" [(ngModel)]="forwardToNmcOnApprove"
           [disabled]="busy||v.record?.stage!=='REPORT_PENDING_REVIEW'"/>
          {{copy('Forward approved report to NMC and automatically reassess vessel risk with A01/A02',
           'إحالة التقرير المعتمد إلى NMC وإعادة تقييم مخاطر السفينة تلقائيًا عبر A01/A02')}}
        </label>
        <div class="actions">
         <button type="button" class="button approve" (click)="decide('APPROVE_REPORT')"
          [disabled]="busy||v.record?.stage!=='REPORT_PENDING_REVIEW'||reason.trim().length<8">
          {{copy('Approve Inspector Report','اعتماد تقرير المفتش')}}</button>
         <button type="button" class="button return" (click)="decide('RETURN_REPORT')"
          [disabled]="busy||v.record?.stage!=='REPORT_PENDING_REVIEW'||reason.trim().length<8">
          {{copy('Return to Inspector','إرجاع للمفتش')}}</button>
         <button type="button" class="button close" (click)="decide('CLOSE')"
          [disabled]="busy||!canClose||reason.trim().length<8">
          {{copy('Close Inspection Case','إغلاق المعاينة')}}</button>
        </div>
        <p class="muted">{{copy('Approve is not close. A confirmed deficiency needs verified CAPA and follow-up before closure.',
         'الاعتماد غير الإغلاق؛ المخالفات المؤكدة تتطلب تصحيحًا متحققًا منه ومتابعة قبل الإغلاق.')}}</p>
       </div>
       <div class="dossier-box regulation">
        <h3>{{copy('Prepare Regulatory / Interagency Action','تجهيز إجراء رقابي أو إخطار جهة')}}</h3>
        <p>{{copy('These actions create tracked drafts for human authorization only. They do not transmit to Riyadh MoU, detain a vessel, or create an official case.',
          'هذه الإجراءات تنشئ مسودات مراجعة بشرية فقط؛ ولا ترسل إلى مذكرة الرياض، ولا تحتجز سفينة، ولا تنشئ قضية رسمية.')}}</p>
        <label>{{copy('Proposed action','الإجراء المقترح')}}</label>
        <select [(ngModel)]="regulatoryType">
         <option value="REQUEST_ADDITIONAL_INSPECTION">{{copy('Request Additional Inspection','طلب معاينة إضافية')}}</option>
         <option value="REFER_DETENTION_REVIEW">{{copy('Refer for Detention Review','إحالة لمراجعة الاحتجاز')}}</option>
         <option value="PREPARE_NMC_NOTIFICATION">{{copy('Prepare NMC Notification','إعداد إخطار إلى NMC')}}</option>
         <option value="PREPARE_RIYADH_MOU_REPORT"
          [disabled]="!full?.regulatory?.riyadhMouReportingPotentiallyApplicable">
          {{copy('Prepare Riyadh MoU PSC Report','تجهيز تقرير PSC لمذكرة الرياض')}}</option>
        </select>
        <label>{{copy('Regulatory review reason','مبررات الإحالة أو التقرير')}}</label>
        <textarea rows="3" [(ngModel)]="regulatoryReason" maxlength="1200"></textarea>
        <button type="button" class="button approve" (click)="prepareRegulatory()"
          [disabled]="busy||v.record?.report?.status!=='APPROVED'||regulatoryReason.trim().length<8">
          {{copy('Prepare for Human Review','تجهيز للمراجعة البشرية')}}</button>
        <p class="muted">{{copy('Riyadh MoU transmission: NOT CONNECTED / NOT SENT.',
          'الإرسال إلى مذكرة الرياض: غير متصل / لم يتم الإرسال.')}}</p>
        <div *ngFor="let draft of regulatoryDrafts" class="finding">
         <b>{{draft.type}}</b><small>{{draft.state}} · {{draft.preparedBy}} · {{draft.preparedAt}}</small>
         <p>{{draft.reason}}</p>
        </div>
       </div>
       <div class="dossier-box">
        <h3>{{copy('NMC Case Notification & Reconciliation','إخطار NMC وتسوية الحالة')}}</h3>
        <div *ngIf="full?.nmc?.linked;else noNmc">
         <p>{{copy('Linked NMC Case','حالة NMC المرتبطة')}}: {{full?.nmc?.linkedCaseId||'—'}}</p>
         <p>{{copy('Referral','الإحالة')}}: {{full?.nmc?.referralId||'—'}}</p>
         <button type="button" class="button" (click)="retryNmcReview()"
          *ngIf="v.record?.report?.status==='APPROVED'||v.record?.report?.status==='RETURNED'"
          [disabled]="busy">{{copy('Verify / Retry NMC Review Notification','فحص / إعادة إخطار NMC بقرار المشرف')}}</button>
         <button type="button" class="button" (click)="retryNmc()"
          *ngIf="v.record?.stage==='CLOSED'" [disabled]="busy">
          {{copy('Verify / Retry NMC Closure','فحص / إعادة إغلاق إحالة NMC')}}</button>
        </div>
        <ng-template #noNmc><p class="muted">{{copy('No linked NMC Case. A notification draft is not a delivered NMC message.',
         'لا توجد حالة NMC مرتبطة؛ إعداد مسودة إخطار لا يعني وصول إخطار فعلي للمركز.')}}</p></ng-template>
        <p *ngIf="nmcFeedback" class="notice">{{nmcFeedback}}</p>
        <p *ngIf="latestRiskStatus" class="notice" role="status">
          {{copy('Automatic A01/A02 risk reassessment','إعادة تقييم المخاطر تلقائيًا باستخدام A01/A02')}}:
          {{latestRiskStatus}}
        </p>
       </div>
       <details class="audit"><summary>{{copy('Review Audit Trail','سجل المراجعة')}}</summary>
        <div *ngFor="let event of full?.audit" class="finding">
         {{event.action}} · {{event.actor}} · {{event.at}}<small>{{event.reason}}</small>
        </div>
       </details>
      </section>
      <ng-template #sourceLoading>
       <p class="muted">{{busy?copy('Loading source dossier…','جاري تحميل ملف السفينة…'):
         copy('Source dossier is currently unavailable.','ملف السفينة غير متاح حاليًا.')}}</p>
      </ng-template>
      <ng-template #noReport><p *ngIf="tab==='REPORT'" class="muted">
       {{copy('No submitted inspector report yet.','لم يتم تقديم تقرير المعاينة بعد.')}}</p></ng-template>
     </ng-container>
     <ng-template #noSelection><div class="empty">{{copy('Choose a returned inspection to review its vessel and report.','اختر معاينة لعرض بيانات السفينة وتقرير المفتش.')}}</div></ng-template>
    </section>
   </div>
  </main>
 </div>`,
 styles:[`
 :host{display:block;font-family:Inter,"Segoe UI",Tahoma,Arial,sans-serif;color:#113b4d}
 /* NMC navigation is fixed and outside document flow. Reserve its exact
    desktop width before the main content so report and queue never go under it. */
 .supervisor-shell{display:flex;min-height:calc(100vh - 82px);width:100%;
  background:#f0f7fa;padding-inline-start:240px;box-sizing:border-box}
 .supervisor-main{flex:1 1 auto;width:100%;min-width:0;
  padding:28px 32px 50px;max-width:1700px;margin:0 auto;box-sizing:border-box}
 .si-title{display:flex;justify-content:space-between;gap:15px;align-items:center;margin-bottom:19px}
 h1{font-size:23px;margin:7px 0;color:#09354b}
 h2{font-size:16px;color:#103c50;margin:0 0 12px}
 h3{font-size:14px;color:#154459}
 p{font-size:12px;line-height:1.7}
 .kicker{font-weight:800;color:#008878;font-size:10px;letter-spacing:1px}
 .si-review-grid{display:grid;grid-template-columns:minmax(275px,335px) 1fr;gap:18px}
 .panel{background:white;border:1px solid #d8e8ed;border-radius:14px;padding:19px;min-width:0}
 .queue header{display:flex;justify-content:space-between;align-items:center}
 .count{background:#dff5f0;color:#087e76;border-radius:20px;padding:4px 10px;font-size:11px}
 input,textarea{width:100%;padding:10px 12px;border:1px solid #cedfe4;border-radius:9px;font:inherit}
 .queue-item{width:100%;text-align:start;display:grid;gap:6px;padding:13px;margin-top:10px;
   border:1px solid #e1edef;background:#fafdfd;border-radius:10px;cursor:pointer}
 .queue-item.selected{border-color:#00a499;background:#edf9f5}
 .queue-item strong{font-size:13px}.queue-item small{font-size:10px;color:#507b88}
 .status{display:inline-flex;background:#e8f3f7;color:#1a6675;border-radius:14px;padding:5px 9px;font-size:10px}
 .detail-head{display:flex;justify-content:space-between;gap:15px;flex-wrap:wrap}
 .attributes{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:13px;padding:16px 0}
 .attributes div{display:grid;gap:5px;font-size:11px;overflow-wrap:anywhere}
 .attributes span{color:#66858d}.attributes strong{font-size:12px;color:#13475a}
 .review-tabs{display:flex;gap:7px;flex-wrap:wrap;border-bottom:1px solid #d7e7e9;padding:11px 0;margin:10px 0 20px}
 .review-tabs button{border:1px solid #c9e1e5;border-radius:9px;padding:10px 13px;
  color:#1d6575;background:#f5fbfb;font-size:11px;font-weight:700;cursor:pointer}
 .review-tabs button.selected{background:#087f83;color:#fff;border-color:#087f83}
 .review-section{padding:4px 0 15px;min-height:230px}
 .source-chip,.decision-chip{display:inline-block;background:#e9f5f5;border:1px solid #c3e3e7;
  padding:5px 8px;border-radius:8px;color:#18747b;font-size:10px}
 .dossier-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
 .dossier-collections{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
 .dossier-box{padding:14px;border:1px solid #dae9ed;border-radius:12px;margin:10px 0;background:#fcfefe}
 .dossier-box h3{margin-top:0}
 .review-table-wrap{overflow-x:auto;margin:13px 0}
 .review-table{border-collapse:collapse;min-width:650px;width:100%}
 .review-table th,.review-table td{padding:10px;border:1px solid #e1ecef;text-align:start;
  vertical-align:top;font-size:11px;overflow-wrap:anywhere}
 .review-table th{background:#edf7f7;color:#1d596b}
 .review-table small,.question-answer small,.evidence-row small{display:block;font-size:10px;color:#647c8a;margin:4px 0}
 .question-answer{border:1px solid #e0eeef;background:#fbfefe;border-radius:10px;padding:12px;margin:10px 0}
 .question-head{display:flex;justify-content:space-between;gap:14px;align-items:center}
 .answer-fields{display:flex;gap:6px;flex-wrap:wrap;padding:8px 0}
 .answer-fields span{background:#f1f8f9;padding:5px 8px;border-radius:7px;font-size:11px;overflow-wrap:anywhere}
 .evidence-row{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap}
 .capa-form{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px}
 .capa-form label:last-child{grid-column:1 / -1}
 .capa-form label,.regulation label{font-size:11px;font-weight:700;display:grid;gap:6px}
 .regulation select{width:100%;margin:8px 0 12px;padding:9px;border:1px solid #cadfe2;border-radius:8px}
 .regulation textarea{margin:8px 0 12px}
 .audit{margin-top:18px;font-size:12px}
 .report{border-top:1px solid #e0eef1;padding-top:13px}
 .finding{border:1px solid #e4eff0;border-radius:10px;padding:12px;margin:9px 0;font-size:12px}
 .finding p{margin:4px 0}.finding small{color:#66858d}
 .origin{background:#eef8fb;padding:13px;border-radius:8px;font-size:12px;margin-top:17px}
 .review-form{margin-top:18px;padding-top:17px;border-top:1px solid #e1eded}
 .review-form label{font-size:12px;font-weight:700;display:block;margin-bottom:8px}
 .actions{display:flex;gap:9px;flex-wrap:wrap;margin-top:12px}
 .button{border:1px solid #cadfe2;background:white;color:#176a70;border-radius:8px;
  padding:9px 13px;font-weight:700;font-size:11px;cursor:pointer}
 .button.approve{background:#008779;color:white}.button.return{color:#986322}
 .button.close{background:#103d50;color:#fff}
 .button:disabled{opacity:.45;cursor:not-allowed}
 .notice,.error{margin:12px 0;padding:12px;border-radius:9px;font-size:12px}
 .notice{background:#e9f9f3;color:#126350}.error{background:#fff1ed;color:#a13b36}
 .muted,.empty{color:#718b95;font-size:12px;line-height:1.65}
 .empty{padding:100px 20px;text-align:center}
 @media (min-width:961px) and (max-width:1220px){
   .supervisor-shell{padding-inline-start:66px}
 }
 @media (max-width:960px){
   /* The sidebar becomes an off-canvas overlay with a mobile toggle. */
   .supervisor-shell{padding-inline-start:0}
   .si-review-grid{grid-template-columns:1fr}
   .supervisor-main{padding:18px}
 }
 @media (max-width:560px){
   .supervisor-main{padding:15px 12px}
   .panel{padding:13px}
   .attributes{grid-template-columns:1fr}
   .dossier-collections,.capa-form{grid-template-columns:1fr}
   .si-title{align-items:flex-start;flex-wrap:wrap}
 }
 `]
})
export class SiSupervisorReviewComponent implements OnInit{
 readonly reviewTabs:{id:ReviewTab;en:string;ar:string}[]=[
  {id:'DOSSIER',en:'Vessel Dossier',ar:'ملف السفينة'},
  {id:'REPORT',en:'Inspector Report',ar:'تقرير المفتش'},
  {id:'CAPA',en:'Corrective Actions',ar:'الإجراءات التصحيحية'},
  {id:'DECISION',en:'Decision & Notifications',ar:'القرار والإخطارات'}
 ];
 tab:ReviewTab='REPORT';
 full:FullReview|null=null;
 nmcFeedback='';
 forwardToNmcOnApprove=true;
 latestRiskStatus='';
 regulatoryType:RegulatoryType='REQUEST_ADDITIONAL_INSPECTION';
 regulatoryReason='';
 regulatoryDrafts:DraftRow[]=[];
 capaDraft:Record<string,{owner:string;dueDate:string;instruction:string}>={};
 cases:SiLifecycleCase[]=[];view:SiLifecycleView|null=null;
 search='';selectedId='';reason='';notice='';error='';busy=false;
 private readonly key='MOEI_SESSION';
 private readonly base='/api/si/v1/supervisor/reviews';
 constructor(private readonly http:HttpClient,public readonly lang:LanguageService){}
 ngOnInit():void{this.load();}
 copy(en:string,ar:string){return this.lang.pick(en,ar);}
 private headers(write=false):HttpHeaders{
  let h=new HttpHeaders({'X-NMC-DASHBOARD-KEY':this.key});
  if(write)h=h.set('X-Moei-Csrf','1');
  return h;
 }
 get filtered():SiLifecycleCase[]{
  const needle=this.search.toLowerCase().trim();
  return this.cases.filter(c=>!needle||
   [c.vesselName,c.imo,c.id,c.regime].some(v=>String(v||'').toLowerCase().includes(needle)));
 }
 get currentVesselName():string{
  return this.cases.find(x=>x.id===this.selectedId)?.vesselName||
   this.view?.inspectionCase.imo||'';
 }
 sourceTitle(row:DossierItem):string{
  return String(row['title']||row['name']||row['description']||
   row['reference']||row['sourceReference']||row['id']||
   this.copy('Source record available','السجل متاح من المصدر'));
 }
 get canIssueActions():boolean{
  const r=this.view?.record;
  return !!r?.findings?.length&&r.stage==='REPORT_APPROVED'&&
   r.findings.every(f=>{
    const d=this.capaDraft[f.id];
    return !!d?.owner.trim()&&/^\d{4}-\d{2}-\d{2}$/.test(d.dueDate)&&
     !!d?.instruction.trim();
   });
 }
 get canClose():boolean{
  const v=this.view?.record;
  if(!v||!['REPORT_APPROVED','READY_TO_CLOSE'].includes(v.stage)||v.report?.status!=='APPROVED')
   return false;
  return !v.findings.length||(v.actions.length===v.findings.length&&
   v.actions.every(x=>x.status==='VERIFIED')&&
   v.followUps.some(x=>x.result==='PASS'));
 }
 isNmc(c:SiLifecycleCase):boolean{
  return c.sourceEvents?.some(x=>x.source==='NMC_CASE')||false;
 }
 load():void{
  this.busy=true;this.error='';
  this.http.get<{cases:SiLifecycleCase[]}>(this.base,{headers:this.headers()})
   .subscribe({next:r=>{
     this.cases=r.cases;this.busy=false;
     if(this.selectedId&&this.cases.some(x=>x.id===this.selectedId))
       this.open(this.selectedId);
    },error:e=>{this.busy=false;this.error=e?.error?.error||'SI_SUPERVISOR_QUEUE_UNAVAILABLE';}});
 }
 open(id:string):void{
  this.busy=true;this.error='';this.selectedId=id;this.reason='';
  this.full=null;
  const base=this.base+'/'+encodeURIComponent(id);
  forkJoin({
    view:this.http.get<SiLifecycleView>(base,{headers:this.headers()}),
    full:this.http.get<FullReview>(base+'/full-report',{headers:this.headers()}),
    regulatory:this.http.get<{drafts:DraftRow[]}>(base+'/regulatory',{headers:this.headers()})
  }).subscribe({next:r=>{
    if(id!==this.selectedId)return;
    this.busy=false;this.view=r.view;this.full=r.full;
    this.regulatoryDrafts=r.regulatory.drafts||[];
    this.capaDraft=Object.fromEntries((r.view.record?.findings||[]).map(f=>[
      f.id,{owner:'',dueDate:'',instruction:'Rectify '+f.title}
    ]));
  },error:e=>{
    this.busy=false;this.error=e?.error?.error||'SI_SUPERVISOR_FULL_REVIEW_UNAVAILABLE';
  }});
 }
 decide(action:Decision):void{
  const v=this.view?.record;
  if(!v||this.reason.trim().length<8||this.busy)return;
  if(!window.confirm(this.copy(
   'Confirm supervisor action: '+action+'?','هل تؤكد إجراء المشرف: '+action+'؟')))return;
  this.busy=true;this.error='';this.notice='';
  this.http.post<{record:unknown;nmcSync?:{status:string;error?:string};
    riskReassessment?:{status:string;errorCode?:string}}>(
   this.base+'/'+encodeURIComponent(this.selectedId)+'/decision',
   {action,expectedVersion:v.version,reason:this.reason.trim(),
    forwardToNmc:action==='APPROVE_REPORT'&&this.forwardToNmcOnApprove},
   {headers:this.headers(true)})
  .subscribe({next:r=>{
    this.busy=false;
    this.notice=this.copy('Supervisor decision saved: ','تم تسجيل قرار المشرف: ')+action+
      (r.nmcSync?' · NMC: '+r.nmcSync.status:'')+
      (r.riskReassessment?' · A01/A02 Risk: '+r.riskReassessment.status:'');
    this.latestRiskStatus=r.riskReassessment?.status||'';
    this.load();
   },error:e=>{this.busy=false;this.error=e?.error?.error||'SI_SUPERVISOR_ACTION_FAILED';}});
 }
 issueActions():void{
  if(!this.canIssueActions||!this.view?.record||this.busy)return;
  if(!window.confirm(this.copy('Issue corrective actions for all confirmed deficiencies?',
    'هل تؤكد إصدار الإجراءات التصحيحية لكل المخالفات المؤكدة؟')))return;
  const actions=this.view.record.findings.map(f=>({
    findingId:f.id,...this.capaDraft[f.id]
  }));
  this.busy=true;this.error='';this.notice='';
  this.http.post<{status:string}>(this.base+'/'+encodeURIComponent(this.selectedId)+'/decision',
   {action:'ISSUE_ACTIONS',expectedVersion:this.view.record.version,
    reason:'Human supervisor approved the corrective action plan',actions},
   {headers:this.headers(true)}).subscribe({
    next:()=>{
      this.busy=false;this.notice=this.copy(
        'Corrective actions issued and assigned to owners.','تم إصدار الإجراءات التصحيحية وإسنادها.');
      this.load();
    },error:e=>{
      this.busy=false;this.error=e?.error?.error||'SI_CAPA_ISSUE_FAILED';
    }
   });
 }
 prepareRegulatory():void{
  if(this.busy||!this.view?.record||
     this.view.record.report?.status!=='APPROVED'||
     this.regulatoryReason.trim().length<8)return;
  if(!window.confirm(this.copy(
    'Prepare an internal regulatory draft? This does not send data externally.',
    'تجهيز مسودة داخلية؟ لن يتم إرسال أي بيانات إلى جهة خارجية.')))return;
  this.busy=true;this.error='';this.notice='';
  this.http.post<{status:string;draft:DraftRow}>(
    this.base+'/'+encodeURIComponent(this.selectedId)+'/regulatory',
    {type:this.regulatoryType,reason:this.regulatoryReason.trim()},
    {headers:this.headers(true)}).subscribe({
     next:r=>{
      this.busy=false;this.regulatoryDrafts=[...this.regulatoryDrafts,r.draft];
      this.notice=this.copy('Draft prepared; no regulatory transmission was made.',
       'تم إعداد المسودة دون إرسال أي تقرير رقابي.');
      this.regulatoryReason='';
     },error:e=>{
      this.busy=false;this.error=e?.error?.error||'SI_REGULATORY_DRAFT_UNAVAILABLE';
     }
    });
 }
 retryNmcReview():void{
  if(!this.view?.record?.report||this.busy||!this.full?.nmc.linked)return;
  this.busy=true;this.error='';this.nmcFeedback='';
  this.http.post<{status:string}>(
    '/api/si/v1/supervisor/cases/'+encodeURIComponent(this.selectedId)+'/sync-nmc-review',
    {},{headers:this.headers(true)}).subscribe({
      next:r=>{
        this.busy=false;this.nmcFeedback='NMC: '+r.status;
      },error:e=>{
        this.busy=false;this.error=e?.error?.error||'SI_NMC_REVIEW_NOTIFICATION_RETRY_REQUIRED';
      }
    });
 }
 retryNmc():void{
  if(!this.view?.record||this.view.record.stage!=='CLOSED'||this.busy)return;
  this.busy=true;this.error='';this.notice='';
  this.http.post<{status:string}>(
   '/api/si/v1/supervisor/cases/'+encodeURIComponent(this.selectedId)+'/sync-nmc',
   {},{headers:this.headers(true)})
  .subscribe({next:r=>{this.busy=false;this.notice='NMC: '+r.status;this.load();},
   error:e=>{this.busy=false;this.error=e?.error?.error||'SI_NMC_SYNC_RETRY_REQUIRED';}});
 }
}
