import {CommonModule} from '@angular/common';
import {Component,OnInit} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {HttpClient} from '@angular/common/http';
import {ActivatedRoute,RouterLink} from '@angular/router';
import {NmcNavigationComponent} from '../components/nmc-navigation.component';
import {LanguageService} from '../services/language.service';

type FieldKind='BOOLEAN'|'NOTE'|'TEXT'|'EXPIRY_DATE'|'DATE'|'NUMBER';
interface FieldAdvice{source:string;instruction:string;focus?:string;
 evidenceRefs:string[];approval:string;modelConfidence:number|null;}
interface FieldStep{
 stepId:string;title:string;category:string;origin:'LEGACY'|'PUBLISHED'|'A04_APPROVED';
 mandatory:boolean;fields:FieldKind[];requiredFields:FieldKind[];
 references:string[];members:{kind:'LIFECYCLE'|'PUBLISHED';id:string}[];
 systemAction:string;aiAdvice:FieldAdvice[];currentStatus:string;
 savedAnswer:Partial<Record<FieldKind,string|number>>;
 note:string;naReason:string;severity:string|null;answered:boolean;
}
interface StepEvidence{id:string;filename:string;mimeType:string;reference:string;byteLength:number;}
interface FinalAssessment{outcome:string;total:number;recorded:number;incomplete:{stepId:string;title:string}[];open:{stepId:string;title:string;severity:string}[];notApplicable:number;canSubmit:boolean;}
interface ImageReview{
 status:'AI_PHOTO_ADVISORY_ONLY';provider:'AIRIA_SI_V01'|string;
 reviewedEvidence:string;officialCompliance:false;
 inspectorReviewRequired:true;findingCreated:false;
 recommendations:{rationale:string;instruction:string;dataGaps:string[]}[];
}
interface FieldGuide{
 evidenceByStep:Record<string,StepEvidence[]>;finalAssessment:FinalAssessment;
 status:string;orderId:string;planId:string;caseId:string;
 imo:string;vesselName:string;orderStatus:string;lifecycleStage:string;
 publishedSnapshotVersion:number|null;lifecycleVersion:number;
 preparationStatus:string;aiApproved:boolean;aiDraftNotApproved:boolean;
 pendingAiSuggestions:{title:string;reason:string;notExecutable:true}[];
 numberOfMergedDuplicateQuestions:number;
 progress:{done:number;total:number;remaining:number};
 steps:FieldStep[];
}
interface FieldAiAdvice{
 status:string;stepId:string;provider:'AIRIA'|'MOCK';mock:boolean;
 stepSpecific:boolean;warnings:string[];
 actions:{instruction:string;focus:string;evidenceRefs:string[]}[];
 focusAreas:{title:string;instruction:string;priority:string;evidenceRefs:string[]}[];
 missingEvidence:string[];confidence:number;inspectorMustVerify:true;
}
@Component({
 selector:'app-si-guided-inspection',standalone:true,
 imports:[CommonModule,FormsModule,RouterLink,NmcNavigationComponent],
 template:`
 <div class="page" [attr.dir]="lang.dir"><app-nmc-navigation></app-nmc-navigation>
 <main class="content">
  <header class="hero">
   <div>
    <small>MOEI · SMART INSPECTION · INSPECTOR FIELD EXECUTION</small>
    <h1>{{t('Execute Inspection Work Order','تنفيذ أمر تكليف المعاينة')}}</h1>
    <p>{{t('A single question path from the pinned mandatory checklist and supervisor-reviewed A04 additions. Answer as the assigned inspector; AI gives instructions, not findings.',
      'مسار واحد للأسئلة من قوائم الفحص الإلزامية المثبتة وإضافات A04 المعتمدة. الإجابات للمفتش المسند، وAI يوجه التنفيذ ولا يصدر نتائج تلقائية.')}}</p>
   </div>
   <nav class="toplinks">
    <a routerLink="/moei/smart-inspection/my-work-orders" [queryParams]="{orderId:orderId}"
     data-testid="si-guided-return-journey">
     {{t('← My Inspection Journey','← رحلة المعاينة الموحدة')}}</a>
   </nav>
  </header>
  <p *ngIf="busy&& !guide" class="status">{{t('Loading the pinned inspection scope…','جارٍ تحميل نطاق المعاينة المثبت…')}}</p>
  <p *ngIf="error" class="status danger" role="alert">{{error}}</p>
  <p *ngIf="message" class="status good" role="status">{{message}}</p>
  <ng-container *ngIf="guide as g">
   <section class="summary">
    <div><small>{{t('Vessel','السفينة')}}</small><strong>{{g.vesselName}}</strong>
     <span>IMO {{g.imo}}</span></div>
    <div><small>{{t('Inspection','المعاينة')}}</small><strong>{{g.orderStatus}}</strong>
     <span>{{g.lifecycleStage}}</span></div>
    <div><small>{{t('Progress','التقدم')}}</small>
     <strong>{{g.progress.done}} / {{g.progress.total}}</strong>
     <span>{{t('steps recorded','خطوة مسجلة')}}</span></div>
    <div><small>{{t('Duplicate questions consolidated','أسئلة مكررة تم دمجها')}}</small>
     <strong>{{g.numberOfMergedDuplicateQuestions}}</strong>
     <span>{{t('Original pinned IDs retained','مع الحفاظ على البنود الأصلية')}}</span></div>
   </section>
   <div class="bar"><div [style.width.%]="progressPercent"></div></div>
   <p class="warning" *ngIf="g.aiDraftNotApproved">
    {{t('A04 recommendations are still draft or stale. They are not executable until supervisor approval of the dossier AND scope.',
      'توصيات A04 ما زالت مسودة أو غير محدثة، ولا تُنفذ إلا بعد اعتماد الدوسيه والنطاق من المشرف.')}}</p>
   <div class="workspace">
    <aside class="steps" aria-label="Inspection steps">
     <header><h2>{{t('Inspection Steps','خطوات المعاينة')}}</h2>
      <button type="button" (click)="reload()" [disabled]="busy">{{t('Refresh','تحديث')}}</button></header>
     <label class="filter">{{t('Show','عرض')}}
      <select [(ngModel)]="filter"><option value="ALL">{{t('All','الكل')}}</option>
       <option value="PENDING">{{t('Pending','المتبقي')}}</option>
       <option value="COMPLETED">{{t('Recorded','المسجل')}}</option>
       <option value="A04">{{t('AI Additions','إضافات AI')}}</option>
      </select>
     </label>
     <button *ngFor="let step of visibleSteps;let i=index" type="button"
      class="step" [class.selected]="selected?.stepId===step.stepId"
      (click)="choose(step)">
      <span class="step-icon" [class.done]="step.answered">{{step.answered?'✓':i+1}}</span>
      <span><b>{{step.title}}</b><small>{{step.category}}</small>
       <em>{{step.origin==='A04_APPROVED'?'AI + Supervisor':
        step.origin==='LEGACY'?'Mandatory scope':'Published checklist'}}</em></span>
     </button>
    </aside>
    <section class="editor" *ngIf="selected as step">
     <div class="editor-head"><div>
       <small>{{step.mandatory?t('MANDATORY CHECK','بند إلزامي'):
        t('APPROVED OPTIONAL CHECK','بند إضافي معتمد')}}</small>
       <h2>{{step.title}}</h2>
       <p>{{step.category}}</p>
      </div><span class="pill">{{statusLabel(step.currentStatus)}}</span>
     </div>
     <div class="help">
      <h3>1 · {{t('What to do on board','ماذا تفعل بالضبط على السفينة؟')}}</h3>
      <p>{{step.systemAction}}</p>
      <small>{{t('Platform procedure: inspect and record observations; never infer compliance from the absence of evidence.',
       'تعليمات تشغيلية من المنصة: افحص وسجل ما شاهدته؛ نقص الدليل ليس إثباتًا للمطابقة.')}}</small>
     </div>
     <div class="help ai">
      <header><h3>✦ 2 · {{t('AI — Inspector instructions','تعليمات AI للمفتش')}}</h3>
       <button type="button" class="ai-btn" (click)="askAi(step)"
        [disabled]="aiBusy||busy||!(g.orderStatus==='FIELD_STARTED'||g.orderStatus==='READY_FOR_FIELD')">
        {{aiBusy?t('Asking Airia…','جارٍ سؤال Airia…'):t('Ask AI: what exactly should I inspect?','اسأل AI: أفحص إيه بالضبط؟')}}</button></header>
      <ng-container *ngIf="step.aiAdvice.length">
       <article *ngFor="let a of step.aiAdvice" class="advice">
        <b>{{a.source}} · {{a.approval}}</b>
        <p>{{a.instruction}}</p>
        <small>{{t('Source evidence','أدلة المصدر')}}: {{a.evidenceRefs.join(' · ')||'—'}}</small>
       </article>
      </ng-container>
      <ng-container *ngIf="aiResults[step.stepId] as advice">
       <article class="advice">
        <b>{{advice.provider}} · {{t('Suggested actions, not inspection findings','إجراءات مقترحة وليست نتائج معاينة')}}</b>
        <p *ngIf="!advice.stepSpecific" class="warning">
         {{t('AI returned general inspection focus; no step-specific instruction was verified. Review with the supervisor.',
          'رجّع AI توجيهات عامة فقط، ولم يتم التحقق من تعليمات خاصة بهذا البند؛ راجع المشرف.')}}</p>
        <ol><li *ngFor="let a of advice.actions">{{a.instruction}}
         <small>{{a.evidenceRefs.join(' · ')}}</small></li></ol>
        <div *ngIf="advice.missingEvidence.length">
         {{t('Missing evidence','الأدلة الناقصة')}}: {{advice.missingEvidence.join(' · ')}}</div>
        <small>{{t('AI confidence','ثقة AI')}}: {{advice.confidence}}</small>
       </article>
      </ng-container>
      <p *ngIf="!step.aiAdvice.length&&!aiResults[step.stepId]">
       {{t('Ask Airia for source-backed field guidance. The response does not answer the checklist or create findings.',
        'اطلب من Airia خطوات تنفيذ مدعومة بالأدلة؛ الاستجابة لا تجيب عن السؤال ولا تُنشئ ملاحظات رسمية.')}}</p>
     </div>
     <section class="help evidence" data-testid="si-guided-evidence">
      <h3>3 · {{t('Question attachments and AI review','مرفقات السؤال وتحليل AI')}}</h3>
      <p>{{t('Upload a photo or PDF for this exact question. Upload does not call AI or record compliance.',
      'ارفع صورة أو PDF للسؤال الحالي. الرفع لا يشغّل AI ولا يسجّل نجاح الفحص.')}}</p>
      <label class="file-upload">{{uploadBusy?t('Uploading…','جارٍ الرفع…'):t('＋ Attach Photo / Document','＋ رفع صورة / مستند')}}
       <input type="file" data-testid="si-guided-file" accept="image/png,image/jpeg,application/pdf"
        (change)="uploadEvidence($event)" [disabled]="!canSave||busy||uploadBusy"></label>
      <ul class="files"><li *ngFor="let file of selectedEvidence">
       📎 {{file.filename}}
       <button type="button" *ngIf="file.mimeType.startsWith('image/')"
        data-testid="si-guided-analyze-image" (click)="analyzeImage(step,file)"
        [disabled]="!canSave||busy||aiBusy||uploadBusy">
        {{t('Analyze Image with AI','تحليل الصورة بالذكاء الاصطناعي')}}</button>
       <small *ngIf="file.mimeType==='application/pdf'">{{t('PDF saved; visual AI only supports images.','تم حفظ PDF؛ التحليل البصري للصور فقط.')}}</small>
      </li></ul>
      <article *ngIf="imageReviews[step.stepId] as review" class="advice">
       <b>{{t('AI suggestions — inspector verification required','توصيات AI — يجب أن يتحقق المفتش')}}</b>
       <p *ngFor="let result of review.recommendations">
        {{result.instruction||result.rationale}}
        <small>{{result.dataGaps.join(' · ')}}</small></p>
      </article>
     </section>
     <form (ngSubmit)="save()" class="answer">
      <h3>4 · {{t('Your own inspection observations','سجل نتيجة معاينتك بنفسك')}}</h3>
      <p *ngIf="g.orderStatus!=='FIELD_STARTED'" class="warning">
       {{t('The assigned work order must be started before recording answers.',
        'لا يمكن تسجيل نتائج المعاينة إلا بعد بدء أمر التكليف للمفتش المسند.')}}</p>
      <div class="fieldgrid">
       <label *ngIf="step.fields.includes('BOOLEAN')">{{t('Inspection result','نتيجة الفحص')}} *
        <select name="answer-boolean" [(ngModel)]="answers['BOOLEAN']"
         [disabled]="!canSave">
         <option value="">{{t('Select','اختر')}}</option>
         <option value="YES">{{t('Pass / Compliant','مستوفٍ')}}</option>
         <option value="NO">{{t('Deficiency / Needs review','مخالفة / يحتاج مراجعة')}}</option>
         <option value="NA">{{t('Not applicable','لا ينطبق')}}</option>
        </select></label>
       <label *ngIf="step.fields.includes('EXPIRY_DATE')">{{t('Certificate expiry date','تاريخ انتهاء الشهادة')}}
        <input type="date" name="answer-expiry" [(ngModel)]="answers['EXPIRY_DATE']"
         [disabled]="!canSave"/></label>
       <label *ngIf="step.fields.includes('DATE')">{{t('Observed date','التاريخ المسجل')}}
        <input type="date" name="answer-date" [(ngModel)]="answers['DATE']"
         [disabled]="!canSave"/></label>
       <label *ngIf="step.fields.includes('NUMBER')">{{t('Measured value','القيمة المقاسة')}}
        <input type="number" name="answer-number" [(ngModel)]="answers['NUMBER']"
         [disabled]="!canSave"/></label>
       <label *ngIf="step.fields.includes('TEXT')">{{t('Recorded observation','البيان المسجل')}}
        <input name="answer-text" [(ngModel)]="answers['TEXT']"
         [disabled]="!canSave" maxlength="2000"/></label>
       <label *ngIf="step.fields.includes('NOTE')">{{t('Inspector notes','ملاحظات المفتش')}}
        <textarea name="answer-note" [(ngModel)]="answers['NOTE']"
         [disabled]="!canSave" maxlength="1600"></textarea></label>
       <label *ngIf="answers['BOOLEAN']==='NO'">{{t('Deficiency severity','درجة الملاحظة')}} *
        <select name="severity" [(ngModel)]="severity" [disabled]="!canSave">
         <option value="MINOR">Minor</option><option value="MAJOR">Major</option>
         <option value="CRITICAL">Critical</option>
        </select></label>
       <label *ngIf="answers['BOOLEAN']==='NA'">{{t('Why not applicable?','سبب عدم الانطباق')}} *
        <textarea name="naReason" [(ngModel)]="naReason" maxlength="500" [disabled]="!canSave"></textarea></label>
      </div>
      <p *ngIf="step.references.length"><strong>{{t('Published evidence references','مراجع الأدلة المنشورة')}}:</strong>
       {{step.references.join(' · ')}}</p>
      <p><a [routerLink]="['/moei/smart-inspection/checklists',g.caseId]"
       class="evidence-link">{{t('Open full evidence capture (photos & supporting documents)',
         'فتح تسجيل الأدلة التفصيلية (الصور والمستندات المؤيدة)')}}</a></p>
      <div class="form-actions">
       <button type="submit" [disabled]="busy||!canSave">{{t('Save Verified Inspection Step','حفظ نتيجة الخطوة')}}</button>
       <span>{{t('Inspector answers remain separate from AI suggestions','إجابات المفتش منفصلة عن توصيات AI')}}</span>
      </div>
     </form>
     <p *ngIf="g.progress.remaining===0" class="status good">
      {{t('All guided questions have recorded responses. Review the published checklist submission and mandatory lifecycle checks before completing the official report.',
       'تم تسجيل إجابات جميع الخطوات. راجع إرسال القائمة المنشورة وبنود دورة المعاينة قبل إعداد التقرير الرسمي.')}}</p>
     <div class="next"><button type="button" class="secondary" (click)="previous()">
       {{t('Previous','السابق')}}</button>
      <button type="button" (click)="next()">{{t('Next Inspection Step','الخطوة التالية')}}</button></div>
    </section>
   </div>
   <section class="closeout" *ngIf="g.finalAssessment as assessment" data-testid="si-guided-final-assessment">
     <h2>{{t('Final Inspection Assessment','التقييم النهائي للمعاينة')}}</h2>
     <p>{{t('Computed from inspector observations, not an automatic AI regulatory decision. AI image reviews remain advisory.',
       'حساب مبني على نتائج المفتش، وليس قرارًا تنظيميًا تلقائيًا من AI.')}}</p>
     <div class="final-numbers">
      <div>{{assessment.recorded}} / {{assessment.total}}<small>{{t('Completed','مكتمل')}}</small></div>
      <div>{{assessment.incomplete.length}}<small>{{t('Pending','متبقي')}}</small></div>
      <div>{{assessment.open.length}}<small>{{t('Open findings','مخالفات مفتوحة')}}</small></div>
     </div>
     <p class="warning" *ngFor="let item of assessment.open">⚠ {{item.title}} — {{item.severity}}</p>
     <p class="warning" *ngFor="let item of assessment.incomplete">⌛ {{item.title}}</p>
     <strong class="status">{{assessment.outcome==='INCOMPLETE'?t('Inspection incomplete','المعاينة غير مكتملة'):
        assessment.outcome==='OPEN_DEFICIENCIES'?t('Open deficiencies — not clear','مخالفات مفتوحة — ليست ناجحة'):
        t('No recorded deficiencies — pending supervisor approval','لا توجد مخالفات مسجلة — بانتظار اعتماد المشرف')}}</strong>
     <label class="final-summary">{{t('Inspector final summary','الملخص النهائي للمفتش')}}
      <textarea [(ngModel)]="inspectorSummary" maxlength="1800" [disabled]="!canSave||busy"></textarea></label>
     <button type="button" data-testid="si-guided-finish" (click)="finishInspection()"
       [disabled]="!canSave||busy||!assessment.canSubmit">
       {{t('Finish Inspection · Inspector Sign & Submit for Review',
        'إنهاء المعاينة · اعتماد المفتش وإرسال للمراجعة')}}</button>
     <p *ngIf="g.lifecycleStage==='REPORT_PENDING_REVIEW'">
      {{t('Report awaiting independent supervisor approval.','التقرير بانتظار اعتماد المشرف المستقل.')}}</p>
    </section>
  </ng-container>
 </main></div>`,
 styles:[`
 :host{display:block;min-height:100vh;background:#edf4f7;color:#173e53}
 .content{margin-inline-start:240px;padding:28px;max-width:1650px}
 .hero{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;
  background:#fff;border:1px solid #dce8ed;border-radius:16px;padding:24px;margin-bottom:18px}
 .hero small,.editor-head small,.summary small{font-size:11px;letter-spacing:.08em;color:#118279;font-weight:800}
 .hero h1{font-size:25px;margin:8px 0;color:#0d344c}.hero p{font-size:13px;color:#6c8794;max-width:850px}
 .toplinks{display:flex;gap:10px;flex-wrap:wrap}.toplinks a{color:#136c7a;text-decoration:none;font-size:12px;background:#eff8fa;padding:10px;border-radius:8px}
 .summary{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
 .summary>div,.steps,.editor{border:1px solid #dce8ed;background:#fff;border-radius:15px;padding:18px}
 .summary small,.summary span{display:block}.summary strong{display:block;font-size:18px;margin:8px 0;color:#10475f}
 .summary span{font-size:11px;color:#8097a2}.bar{height:7px;border-radius:8px;background:#dfeaf0;margin:16px 0 21px}
 .bar>div{height:100%;border-radius:8px;background:#0c9b8c;transition:width .2s}
 .workspace{display:grid;grid-template-columns:350px minmax(0,1fr);gap:18px;align-items:start}
 .steps{padding:14px;max-height:calc(100vh - 210px);overflow:auto;position:sticky;top:14px}
 .steps header,.editor-head,.help header,.form-actions,.next{display:flex;justify-content:space-between;align-items:center;gap:12px}
 h2{font-size:18px;margin:0}h3{font-size:15px;margin:0 0 12px}
 .filter{display:flex;justify-content:space-between;gap:12px;margin:14px 0;font-size:12px}
 .step{display:flex;align-items:flex-start;text-align:start;background:transparent;border:1px solid transparent;
  width:100%;padding:12px;cursor:pointer;border-radius:10px;gap:12px;color:#2b596b;margin:2px 0}
 .step:hover,.step.selected{background:#eaf7f7;border-color:#94d3cb}
 .step-icon{border:2px solid #acc8d0;border-radius:50%;height:27px;min-width:27px;display:grid;place-items:center;font-size:11px}
 .step-icon.done{background:#168b7e;color:#fff;border-color:#168b7e}.step b,.step small,.step em{display:block}
 .step b{font-size:12px}.step small,.step em{font-size:10px;color:#82949c;margin:3px 0}.step em{font-style:normal;color:#118279}
 .editor{padding:24px}.editor-head{border-bottom:1px solid #e1edf0;padding-bottom:18px}
 .editor-head h2{margin:8px 0}.editor-head p{font-size:12px;color:#718b9a}
 .pill{padding:6px 10px;background:#e4f1f1;color:#0b756f;border-radius:15px;font-size:11px;font-weight:800}
 .help,.answer{border:1px solid #dfebef;border-radius:12px;margin:17px 0;padding:17px}
 .help{background:#f7fafb}.help p,.advice p{font-size:12px;line-height:1.8;color:#536b79}
 .help.ai{background:#f0faf8;border-color:#bce4df}
 .help.evidence{background:#f4faff;border-color:#bedde6}
 .file-upload{position:relative;display:inline-block;background:#087e7b;color:white;
  font-size:12px;font-weight:800;padding:12px;border-radius:8px;cursor:pointer}
 .file-upload input{position:absolute;opacity:0;width:1px;height:1px;pointer-events:none}
 .files{padding:0;list-style:none;font-size:12px}.files li{padding:9px;display:flex;gap:12px;align-items:center;flex-wrap:wrap;border-bottom:1px solid #dce9ee}
 .closeout{background:#fff;border:1px solid #dce8ed;border-radius:16px;padding:24px;margin-top:20px}
 .closeout p{font-size:12px}.final-numbers{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:15px 0}
 .final-numbers div{background:#eef8fa;padding:13px;border-radius:9px;font-size:22px;font-weight:800}
 .final-numbers small{display:block;font-size:11px;font-weight:400}
 .final-summary{display:block;font-size:12px;font-weight:800;margin:16px 0}
 .final-summary textarea{display:block;width:100%;margin-top:8px}
 .advice{padding:12px 16px;border-inline-start:3px solid #16a79b;background:#fff;border-radius:9px;margin:9px 0}
 .advice li{font-size:12px;padding:6px 0}.advice small,.help small{display:block;font-size:10px;color:#6f8793;margin-top:8px}
 .ai-btn{background:#087d77!important;color:#fff!important;border-color:#087d77!important;white-space:normal}
 .fieldgrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:15px}
 .fieldgrid label{display:flex;flex-direction:column;gap:6px;font-size:12px;font-weight:700;color:#436378}
 input,select,textarea{border:1px solid #cbdde4;border-radius:8px;padding:10px;background:#fff;color:#173e53;font:inherit;min-width:0}
 textarea{min-height:70px}.answer p{font-size:11px;color:#65818d}
 button{background:#136c70;color:#fff;border:0;padding:10px 13px;border-radius:9px;cursor:pointer;font-size:12px;font-weight:700}
 button.secondary,.steps button:not(.step){background:#e8f4f6;color:#116d7c}
 button:disabled{opacity:.5;cursor:not-allowed}.form-actions{margin-top:18px}
 .form-actions span{font-size:11px;color:#849ba5}
 .evidence-link{display:inline-block;font-size:12px;color:#087b7e;text-decoration:underline;font-weight:800}
 .next{margin-top:20px;justify-content:flex-end}
 .status,.warning{background:#edf8fa;border:1px solid #acd4db;color:#125970;
  padding:12px;border-radius:9px;margin:13px 0;font-size:12px}
 .warning{background:#fff8e7;color:#956f25;border-color:#ead99c}
 .danger{background:#fff0ef;color:#9b302c;border-color:#eab2b1}
 .good{background:#e9faf2;color:#23734f;border-color:#a7dec5}
 @media(max-width:1200px){.workspace{grid-template-columns:275px 1fr}.summary{grid-template-columns:repeat(2,1fr)}}
 @media(max-width:980px){.content{margin:0;padding:13px}.workspace{grid-template-columns:1fr}
  .steps{max-height:350px;position:static}.fieldgrid{grid-template-columns:1fr}
  .hero{flex-wrap:wrap}}
 `]
})
export class SiGuidedInspectionComponent implements OnInit{
 orderId='';guide:FieldGuide|null=null;selected:FieldStep|null=null;
 filter:'ALL'|'PENDING'|'COMPLETED'|'A04'='ALL';
 answers:Partial<Record<FieldKind,string|number>>={};
 severity='MINOR';naReason='';busy=false;aiBusy=false;uploadBusy=false;error='';message='';
 inspectorSummary='';imageReviews:Record<string,ImageReview>={};
 imageReviewErrors:Record<string,string>={};imageLoadingKey:string|null=null;
 /** The same checklist step may have several photos; never reuse one photo's answer for another. */
 imageReviewKey(stepId:string,evidenceId:string):string{
  return stepId+':'+evidenceId;
 }
 aiResults:Record<string,FieldAiAdvice>={};
 private readonly api='/api/si/v1/maritime-scheduling/my-work-orders/';
 constructor(private readonly http:HttpClient,private readonly route:ActivatedRoute,
   public readonly lang:LanguageService){}
 t(en:string,ar:string):string{return this.lang.pick(en,ar);}
 ngOnInit():void{this.orderId=this.route.snapshot.paramMap.get('orderId')||'';this.reload();}
 get visibleSteps():FieldStep[]{
  return (this.guide?.steps||[]).filter(x=>this.filter==='ALL'||
   this.filter==='PENDING'&&!x.answered||
   this.filter==='COMPLETED'&&x.answered||
   this.filter==='A04'&&x.origin==='A04_APPROVED');
 }
 get selectedEvidence():StepEvidence[]{return this.guide?.evidenceByStep?.[this.selected?.stepId||'']||[];}
 get canSave():boolean{
  return this.guide?.orderStatus==='FIELD_STARTED'&&
    this.guide?.lifecycleStage==='IN_FIELD';
 }
 get progressPercent():number{
  return this.guide?.progress.total?
   Math.round(this.guide.progress.done*100/this.guide.progress.total):0;
 }
 statusLabel(s:string):string{
  return ({PENDING:'Pending · غير مكتمل',PASS:'Recorded · تم',DEFICIENCY:'Observation · ملاحظة',
   NA:'N/A · لا ينطبق'} as Record<string,string>)[s]||s;
 }
 choose(step:FieldStep):void{
  this.selected=step;this.error='';this.message='';
  this.answers={...step.savedAnswer};
  if(step.fields.includes('NOTE')&&!this.answers['NOTE'])this.answers['NOTE']=step.note||'';
  this.severity=step.severity||'MINOR';this.naReason=step.naReason||'';
 }
 reload():void{
  if(!this.orderId||this.busy)return;
  this.busy=true;this.error='';
  this.http.get<FieldGuide>(this.api+encodeURIComponent(this.orderId)+'/guide')
  .subscribe({
   next:g=>{
    this.busy=false;const before=this.selected?.stepId;
    this.guide=g;this.choose(g.steps.find(x=>x.stepId===before)||g.steps[0]);},
   error:e=>{this.busy=false;this.error=e?.error?.error||
     'SI_GUIDED_INSPECTION_UNAVAILABLE';}
  });
 }
 private validAnswers(step:FieldStep):boolean{
  for(const k of step.requiredFields){
   const v=this.answers[k];if(v===undefined||v===null||v===''){
    this.error=this.t('Complete required field: '+k,'أكمل الحقل الإلزامي: '+k);
    return false;
   }
  }
  if(step.members.some(m=>m.kind==='LIFECYCLE')&&!this.answers['BOOLEAN']){
   this.error=this.t('Select the result for the mandatory check.',
     'اختر نتيجة بند المعاينة الإلزامي.');return false;
  }
  if(this.answers['BOOLEAN']==='NA'&&!this.naReason.trim()){
   this.error=this.t('Explain why this check is not applicable.',
     'اذكر سبب عدم انطباق البند.');return false;
  }
  return true;
 }
 save():void{
  const step=this.selected,g=this.guide;
  if(!step||!g||!this.canSave||this.busy||!this.validAnswers(step))return;
  const values={...this.answers};
  if(values['NUMBER']!==undefined&&values['NUMBER']!==''){
    const n=Number(values['NUMBER']);if(!Number.isFinite(n)){
      this.error=this.t('Invalid numeric reading','القراءة الرقمية غير صحيحة');return;}
    values['NUMBER']=n;
  }
  const body={stepId:step.stepId,values,severity:this.severity,
   naReason:this.naReason,expectedChecklistVersion:g.publishedSnapshotVersion,
   expectedLifecycleVersion:g.lifecycleVersion,
    evidenceRefs:this.selectedEvidence.map(x=>x.reference).slice(0,12)};
  this.busy=true;this.error='';
  this.http.post<{guide:FieldGuide}>(this.api+encodeURIComponent(this.orderId)+
   '/guide/answers',body).subscribe({
    next:r=>{this.busy=false;this.guide=r.guide;
     this.choose(r.guide.steps.find(x=>x.stepId===step.stepId)||r.guide.steps[0]);
     this.message=this.t('Inspection observations saved under your assigned work order.',
       'تم حفظ نتيجة المعاينة باسم المفتش المسند لأمر التكليف.');},
    error:e=>{this.busy=false;this.error=e?.error?.error||
      'SI_GUIDED_SAVE_FAILED';}
   });
 }
 askAi(step:FieldStep):void{
  if(!this.guide||this.aiBusy)return;
  this.aiBusy=true;this.error='';
  this.http.post<FieldAiAdvice>(this.api+encodeURIComponent(this.orderId)+
   '/guide/ai',{
     stepId:step.stepId,expectedLifecycleVersion:this.guide.lifecycleVersion,
     language:this.lang.dir==='rtl'?'ar':'en',confirmRun:true
   }).subscribe({
    next:r=>{this.aiBusy=false;this.aiResults[step.stepId]=r;
     this.message=r.stepSpecific?
       this.t('AI suggested question-specific actions. Verify onboard before recording an answer.',
        'اقترح AI خطوات مرتبطة بالسؤال؛ تحقق منها على السفينة قبل تسجيل الإجابة.'):
       this.t('AI returned only general guidance; no verified steps for this checklist item.',
        'رجّع AI إرشادات عامة فقط، دون خطوات موثقة خاصة بهذا البند.');},
    error:e=>{this.aiBusy=false;this.error=e?.error?.error||
      'SI_FIELD_AI_UNAVAILABLE';}
   });
 }
 async uploadEvidence(event:Event):Promise<void>{
  const input=event.target as HTMLInputElement,file=input.files?.[0],step=this.selected;
  if(!file||!step||!this.canSave)return;
  input.value='';
  if(!['image/png','image/jpeg','application/pdf'].includes(file.type)||
     file.size===0||file.size>5*1024*1024){
    this.error=this.t('JPG, PNG or PDF up to 5 MB.','JPG أو PNG أو PDF حتى 5 ميجابايت.');return;
  }
  this.uploadBusy=true;this.error='';
  try{
    const base64=await new Promise<string>((resolve,reject)=>{
      const reader=new FileReader();reader.onerror=()=>reject(new Error('READ_FAILED'));
      reader.onload=()=>resolve(String(reader.result||'').split(',')[1]||'');
      reader.readAsDataURL(file);
    });
    this.http.post<{guide:FieldGuide}>(this.api+encodeURIComponent(this.orderId)+
      '/guide/evidence',{stepId:step.stepId,file:{
        filename:file.name,mimeType:file.type,base64}}).subscribe({
       next:r=>{this.uploadBusy=false;this.guide=r.guide;
         this.selected=r.guide.steps.find(x=>x.stepId===step.stepId)||step;
         this.message=this.t('Evidence uploaded; AI analysis is optional.','تم حفظ الدليل. تحليل AI اختياري.');},
       error:e=>{this.uploadBusy=false;this.error=e?.error?.error||'SI_GUIDED_UPLOAD_FAILED';}
      });
  }catch{this.uploadBusy=false;this.error='SI_GUIDED_FILE_READ_FAILED';}
 }
 analyzeImage(step:FieldStep,file:StepEvidence):void{
  if(!this.canSave||this.aiBusy||!file.mimeType.startsWith('image/'))return;
  if(!window.confirm(this.t('Send photo to Airia AI? A charge may apply. AI is advisory only.',
     'تأكيد إرسال الصورة إلى Airia AI؟ قد توجد تكلفة. النتيجة استشارية فقط.')))return;
  const key=this.imageReviewKey(step.stepId,file.id);
  this.aiBusy=true;this.imageLoadingKey=key;this.error='';
  delete this.imageReviewErrors[key];
  delete this.imageReviews[key]; // A failed retry must not leave a stale success.
  this.http.post<ImageReview>(this.api+encodeURIComponent(this.orderId)+
   '/guide/ai-evidence',{stepId:step.stepId,evidenceId:file.id,confirmCost:true})
   .subscribe({next:r=>{
       this.aiBusy=false;this.imageLoadingKey=null;
       if(r.status!=='AI_PHOTO_ADVISORY_ONLY'||r.reviewedEvidence!==file.id||
          r.findingCreated!==false||r.inspectorReviewRequired!==true){
         this.error=this.t(
           'AI response does not match the selected image. No observation was accepted.',
           'استجابة AI لا تطابق الصورة المختارة. لم تُقبل أي ملاحظة.');
         this.imageReviewErrors[key]=this.error;
         return;
       }
       this.imageReviews[key]=r;
       delete this.imageReviewErrors[key];
       this.error='';
       this.message=this.t(
         'Image analysis completed for '+file.filename+'. Verify findings yourself before saving the inspection.',
         'تم تحليل صورة '+file.filename+'. راجع الملاحظات بنفسك قبل تسجيل نتيجة المعاينة.');
     },
     error:e=>{this.aiBusy=false;this.imageLoadingKey=null;
      if(e?.error?.error==='SI_CHECKLIST_VISION_AI_NOT_CONFIGURED_OR_NOT_CONFIRMED'){
        const missing=e?.error?.missing||{};
        const alternative=e?.error?.alternateV01;
        if(alternative?.pipelineConfigured&&alternative?.keyConfigured&&!alternative?.enabled){
          this.error=this.t(
            'SI-V01 is mapped. Enable SI_V01_ENABLED in AI Settings to analyze this photo; Checklist Vision is a separate contract.',
            'تم ربط SI-V01. فعّل SI_V01_ENABLED من إعدادات AI لتحليل الصورة؛ Checklist Vision لها عقد مختلف.');
          this.imageReviewErrors[key]=this.error;
          return;
        }
        const parts=[
          missing.checklistAiEnabled?'SI_CHECKLIST_AIRIA_ENABLED':null,
          missing.airiaKey?'AIRIA_MENA_KEY / Vault':null,
          missing.checklistVisionPipeline?'AIRIA_SI_CHECKLIST_VISION_PIPELINE_ID':null
        ].filter(Boolean).join(', ');
        this.error=this.t(
          'Image AI is not configured. Review AI Settings: '+(parts||'checklist vision contract'),
          'تحليل الصورة بالذكاء الاصطناعي غير مهيأ. راجع إعدادات AI: '+(parts||'عقد تحليل الصور'));
      }else if(typeof e?.error?.error==='string'&&
                 (e.error.error.startsWith('SI_V01_UPLOAD_')||
                  e.error.error.startsWith('SI_V01_JSON_EXECUTION_'))){
        const code=e.error.error;
        const stage=e?.error?.rejection?.stage||
          (code.startsWith('SI_V01_UPLOAD_')?'UPLOAD':'JSON_EXECUTION');
        this.error=this.t(
          'SI-V01 '+stage+' could not complete: '+code+
          '. No image finding was created. Check the Airia adapter logs; do not retry without reviewing the cause.',
          'لم يكتمل تحليل SI-V01 في مرحلة '+stage+': '+code+
          '. لم يتم إنشاء مخالفة. راجع سجل تكامل Airia قبل إعادة المحاولة.');
      }else if(e?.error?.error==='SI_V01_MULTIPART_REQUEST_REJECTED'){
        const rejection=e?.error?.rejection||{};
        const fields=Array.isArray(rejection.validationFields)?
          rejection.validationFields.filter((f:unknown)=>typeof f==='string').slice(0,5).join(', '):'';
        const category=typeof rejection.category==='string'?rejection.category:'UNCLASSIFIED';
        const suffix=fields?(' · '+fields):(' · '+category);
        this.error=this.t(
          'Airia rejected the photo request (HTTP 400)'+suffix+
          '. The image was not analyzed; share only the correlation ID and rejection category with support.',
          'رفضت Airia طلب تحليل الصورة (HTTP 400)'+suffix+
          '. لم تُحلّل الصورة؛ شارك رقم تتبع الطلب وتصنيف الخطأ فقط مع الدعم.');
      }else if(e?.error?.error==='SI_V01_UPSTREAM_PROVIDER_UNAVAILABLE'||
                e?.error?.error==='SI_V01_UPSTREAM_TIMEOUT'){
        this.error=this.t('SI-V01 photo request failed. Verify the Airia pipeline contract and proxy logs.',
          'فشل استدعاء SI-V01 لتحليل الصورة. تحقق من عقد الاستجابة وسجلات AI Proxy.');
      }else this.error=e?.error?.error||'SI_AI_PHOTO_UNAVAILABLE';
      this.imageReviewErrors[key]=this.error;
     }});
 }
 finishInspection():void{
  const g=this.guide;if(!g||!this.canSave||!g.finalAssessment.canSubmit||this.busy)return;
  if(!window.confirm(this.t('Submit for supervisor review with '+
      g.finalAssessment.open.length+' open findings? This is not official approval.',
      'إرسال للمشرف مع '+g.finalAssessment.open.length+' مخالفات مفتوحة؟ هذا ليس اعتمادًا رسميًا.')))return;
  this.busy=true;this.error='';
  this.http.post<{guide:FieldGuide}>(this.api+encodeURIComponent(this.orderId)+
    '/guide/finish',{confirmSubmission:true,inspectorSummary:this.inspectorSummary,
      expectedChecklistVersion:g.publishedSnapshotVersion,expectedLifecycleVersion:g.lifecycleVersion})
  .subscribe({next:r=>{this.busy=false;this.guide=r.guide;
      this.message=this.t('Submitted for supervisor approval.','تم تسليم التقرير لاعتماد المشرف.');},
    error:e=>{this.busy=false;this.error=e?.error?.error||'SI_FINISH_FAILED';}});
 }
 next():void{
  const all=this.guide?.steps||[];if(!all.length)return;
  const i=all.findIndex(x=>x.stepId===this.selected?.stepId);
  this.filter='ALL';this.choose(all[Math.min(i+1,all.length-1)]);
 }
 previous():void{
  const all=this.guide?.steps||[];if(!all.length)return;
  const i=all.findIndex(x=>x.stepId===this.selected?.stepId);
  this.filter='ALL';this.choose(all[Math.max(0,i-1)]);
 }
}
