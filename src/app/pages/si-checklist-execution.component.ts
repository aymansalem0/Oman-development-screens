import {CommonModule} from '@angular/common';
import {Component,OnInit,OnDestroy} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {ActivatedRoute,RouterLink} from '@angular/router';
import {HttpClient} from '@angular/common/http';
import {NmcNavigationComponent} from '../components/nmc-navigation.component';
import {LanguageService} from '../services/language.service';
import {MoeiAuthService} from '../services/moei-auth.service';
import {SiChecklistsService,ChecklistPreview,ChecklistExecution,
 CheckField,ChecklistInstanceTemplate,ChecklistInstanceGroup,
 ChecklistInstanceItem,ChecklistProposal,AiLevel,
 ChecklistEvidence,SuggestedInspectionQuestion
} from '../services/si-checklists.service';

type AnswerValues=Partial<Record<CheckField,any>>;
interface ReviewScope{level:AiLevel|'AI_QUESTION';templateId?:string;
 groupId?:string;itemId?:string;label:string;}
interface A04Additional{title:string;reason:string;evidenceIds?:string[];recommendationOnly?:boolean;}
interface A04Dossier{saved?:{status:string;dossier?:{
 suggestedAdditionalItems?:A04Additional[];source?:string;mock?:boolean;
 }|null}|null;stale?:boolean;}
@Component({
 selector:'app-si-checklist-execution',standalone:true,
 imports:[CommonModule,FormsModule,RouterLink,NmcNavigationComponent],
 template:`
 <div class="layout" [attr.dir]="lang.dir">
  <app-nmc-navigation></app-nmc-navigation>
  <main class="body">
   <header class="hero"><div>
    <p class="eyebrow">SMART INSPECTION · FIELD EXECUTION</p>
    <h1>{{t('Dynamic Inspection Checklist','قائمة المعاينة الديناميكية')}}</h1>
    <p>{{t('Vessel-specific grouped questions, typed answers and inspector-controlled Airia recommendations.',
      'بنود ومجموعات مناسبة للسفينة، مع حقول إجابة متعددة وتوصيات Airia خاضعة لقرار المفتش.')}}</p>
   </div><div class="nav-actions">
    <a [routerLink]="['/moei/smart-inspection/lifecycle',caseId]">
     {{t('Inspection Lifecycle','دورة المعاينة')}}</a>
    <a routerLink="/moei/smart-inspection/settings/checklists" *ngIf="auth.isAdmin">
     {{t('Checklist Settings','إعدادات قوائم الفحص')}}</a>
   </div></header>
   <p class="notice error" role="alert" *ngIf="error">{{error}}</p>
   <p class="notice good" *ngIf="message">{{message}}</p>
   <p class="notice" *ngIf="loading">{{t('Loading approved case and published checklist rules…',
    'جارٍ تحميل الحالة المعتمدة وقواعد القوائم المنشورة…')}}</p>
   <div class="summary" *ngIf="preview as p">
    <div><span>{{t('Vessel / IMO','السفينة / IMO')}}</span><strong>{{p.vessel.name||p.imo}} · {{p.imo}}</strong></div>
    <div><span>{{t('Vessel Type','نوع السفينة')}}</span><strong>{{p.vessel.vesselType||'UNKNOWN'}}</strong></div>
    <div><span>{{t('Gross Tonnage (GT)','الحمولة الإجمالية GT')}}</span><strong>{{p.vessel.grossTonnage??'UNKNOWN'}}</strong></div>
    <div><span>{{t('Matched Published Templates','القوائم المنشورة المطابقة')}}</span><strong>{{p.selectedTemplates.length}}</strong></div>
   </div>
   <section class="template ai-a04" *ngIf="preview" data-testid="si-a04-ai-questions">
    <header class="template-title">
     <div><h2>✦ {{t('SI-A04 Suggested Additional Inspection Checklist',
       'قائمة البنود الإضافية المقترحة بواسطة SI-A04')}}</h2>
      <span class="badge">{{a04?.saved?.dossier?.mock?'POC MOCK':'AIRIA ADVISORY'}}</span>
      <span class="badge">{{a04?.saved?.status||'DRAFT_REVIEW'}}</span></div>
     <a [routerLink]="['/moei/smart-inspection/preparation',caseId]">
       {{t('Review & Approve A04 Dossier','مراجعة واعتماد ملف A04')}}</a>
    </header>
    <p>{{t('These AI-proposed optional questions are not statutory mandatory checks. They are separate from the frozen published checklist and require supervisor dossier review and scope approval before official inclusion.',
     'هذه البنود الاختيارية مقترحات AI وليست بنودًا إلزامية تنظيمية. تبقى مستقلة عن القائمة المنشورة وتحتاج اعتماد الدوسيه ونطاق المعاينة قبل إدراجها رسميًا.')}}</p>
    <div class="suggested-empty" *ngIf="!a04AdditionalItems.length">
     <b>{{t('No A04-generated questions available yet.','لا توجد أسئلة مقترحة من A04 بعد.')}}</b>
     <p>{{t('Generate an A04 dossier explicitly, then review the advisory results; AI questions are never silently invented.',
      'يمكن إنشاء ملف A04 بشكل صريح ثم مراجعة مقترحاته؛ لا ينشئ النظام أسئلة وهمية تلقائيًا.')}}</p>
    </div>
    <div *ngFor="let item of a04AdditionalItems" class="ai-a04-item">
      <span class="ai-source-pill">✦ {{t('AI-SUGGESTED QUESTION · A04','سؤال مقترح بواسطة AI · A04')}}</span>
      <strong>{{item.title}}</strong><p>{{item.reason}}</p>
      <small>{{t('Evidence references','مراجع الأدلة')}}:
        {{(item.evidenceIds||[]).join(' · ')||'—'}}</small>
    </div>
   </section>
   <p class="notice warning" *ngFor="let warning of preview?.warnings">
    {{t('Applicability needs source review for','تحتاج شروط انطباق القائمة إلى مراجعة المصدر:')}}
    <b>{{warning.title}}</b> · {{warning.missing.join(', ')}}
   </p>
   <p class="notice" *ngIf="preview&&!preview.saved&&!preview.selectedTemplates.length">
     {{t('No configured checklist matches this vessel. The existing 8-item legacy mandatory checklist remains in the inspection lifecycle. Create and publish rules from Checklist Settings.',
       'لا توجد قوائم مخصصة مطابقة لهذه السفينة. تظل البنود الإلزامية الثمانية الأساسية موجودة في دورة المعاينة. أنشئ وانشر القواعد من الإعدادات.')}}
   </p>
   <div class="init" *ngIf="preview&&!execution&&preview.selectedTemplates.length">
    <div><h2>{{t('Apply checklist to approved inspection case','تطبيق قوائم الفحص على حالة المعاينة')}}</h2>
     <p>{{t('All matching published checklists are added together. Their exact revisions are frozen for this case and cannot be changed by later settings updates.',
      'تُضاف جميع القوائم المنشورة المطابقة معًا، وتُثبَّت أرقام إصداراتها للحالة حتى لو تغيرت الإعدادات لاحقًا.')}}</p>
    </div>
    <button (click)="start()" [disabled]="busy||!auth.isAdmin">
     {{t('Start Dynamic Checklist','بدء القائمة الديناميكية')}}</button>
   </div>
   <ng-container *ngIf="execution as e">
    <section class="execution-header">
     <div><b>{{t('Case Status','حالة القائمة')}}: {{e.status}}</b>
      <small>{{t('Version','الإصدار')}} {{e.version}} · {{e.templates.length}} {{t('checklists','قوائم')}}</small></div>
     <div class="actions">
      <button class="secondary" (click)="reload()" [disabled]="busy">
       {{t('Refresh','تحديث')}}</button>
      <button (click)="save()" [disabled]="busy||e.status!=='IN_PROGRESS'||!auth.isAdmin">
       {{t('Save Answers','حفظ الإجابات')}}</button>
     </div>
    </section>

    <section class="template generated-questions" data-testid="si-ai-suggested-questions">
      <div class="template-title">
       <div><p class="eyebrow">✦ AIRIA · OPTIONAL AI-SUGGESTED QUESTIONS</p>
        <h2>{{t('AI-Suggested Inspection Questions','أسئلة معاينة إضافية مقترحة بواسطة AI')}}</h2>
        <span class="badge">{{(e.aiSuggestedQuestions||[]).length}} {{t('suggested · not mandatory','مقترح · غير إلزامي')}}</span>
        <p class="hint">{{t('These questions are AI-generated optional advice. They never modify the published mandatory checklist or official inspection scope; inspector review and supervisor approval are required.',
         'هذه أسئلة إضافية استشارية مقترحة بواسطة AI، ولا تغير قائمة المعاينة الإلزامية أو نطاقها الرسمي؛ تلزم مراجعة المفتش واعتماد المشرف.')}}</p>
       </div>
       <button class="ai-btn" type="button" (click)="generateQuestions()"
        [disabled]="busy||e.status!=='IN_PROGRESS'||!aiStatus?.builderConfigured||!auth.isAdmin"
        data-testid="si-generate-ai-questions">
        ✦ {{t('Generate Optional Questions with AI','إنشاء أسئلة إضافية بواسطة AI')}}</button>
      </div>
      <div class="question-prompt">
       <label>{{t('AI question-generation focus (optional)','سياق مقترح لتوليد الأسئلة (اختياري)')}}
        <textarea rows="2" maxlength="1800" [(ngModel)]="questionPrompt"
         [disabled]="busy||e.status!=='IN_PROGRESS'"></textarea></label>
      </div>
      <p class="hint" *ngIf="!aiStatus?.builderConfigured">
       {{t('The Airia Checklist Builder pipeline is not configured. No questions are generated on page load.',
       'لم يتم تهيئة مسار Airia لإنشاء أسئلة القوائم. لا يُنشئ النظام أسئلة تلقائيًا عند فتح الشاشة.')}}</p>
      <p class="suggested-empty" *ngIf="!(e.aiSuggestedQuestions||[]).length">
       {{t('No runtime AI questions have been generated. Existing published inspection questions remain available below.',
        'لم يتم إنشاء أسئلة إضافية بواسطة AI بعد. تظل أسئلة المعاينة المنشورة متاحة أدناه.')}}</p>
      <article class="item ai-question-card" *ngFor="let q of e.aiSuggestedQuestions||[]"
       [attr.data-ai-question]="q.id">
       <div class="item-head">
        <div>
         <div class="question-provenance"><span class="ai-source-pill">✦
          {{t('AI-SUGGESTED · ADVISORY ONLY','مقترح AI · استشاري فقط')}}</span>
          <span class="badge">{{q.source}}</span>
          <span class="badge">{{q.status}}</span>
         </div>
         <h4>{{q.title}}</h4><p>{{q.description}}</p>
         <p class="hint">{{q.rationale}}</p>
        </div>
        <button class="ai-btn" type="button" (click)="openSuggested(q)"
         [disabled]="busy||e.status!=='IN_PROGRESS'||!aiStatus?.visionConfigured||!auth.isAdmin">
         ✦ {{t('Analyze Evidence & Suggest Answer','تحليل الدليل واقتراح إجابة')}}</button>
       </div>
       <div class="ai-instruction-block">
        <b>✦ {{t('AI-Suggested Inspection Instruction','تعليمات المعاينة المقترحة بواسطة AI')}}</b>
        <p *ngIf="latestInstruction(q.id);else originInstruction">{{latestInstruction(q.id)}}</p>
        <ng-template #originInstruction><p *ngIf="q.suggestedInstruction">{{q.suggestedInstruction}}</p>
         <p *ngIf="!q.suggestedInstruction" class="instruction-unavailable">
          {{t('No AI inspection instruction has been returned for this question yet.',
           'لم ترجع تعليمات معاينة من AI لهذا السؤال بعد.')}}</p>
        </ng-template>
       </div>
       <div class="question-evidence">
        <label>{{t('Attach evidence to this AI-suggested question (PDF / JPG / PNG / WebP)',
         'ارفق دليلًا لهذا السؤال المقترح (PDF / JPG / PNG / WebP)')}}
         <input type="file" accept="application/pdf,image/jpeg,image/png,image/webp"
          [disabled]="busy||e.status!=='IN_PROGRESS'||!auth.isAdmin"
          (change)="attachQuestionEvidence($event,q.id)"/>
        </label>
        <div class="evidence-chips">
         <span *ngFor="let attachment of evidenceFor(q.id)">
          📎 {{attachment.filename}} · {{attachment.mimeType==='application/pdf'?'PDF':'PHOTO'}}
          · {{t('Unverified','غير متحقق منه')}}
         </span>
        </div>
        <small>{{t('Images can be analysed only when the configured Airia Vision pipeline supports the attachment. PDF stays evidence for inspector review; upload itself never runs AI.',
         'يحلل Airia الصور فقط إذا دعم المسار المرفق. يظل PDF دليلًا لمراجعة المفتش؛ رفع المرفق لا يشغّل AI.')}}</small>
       </div>
       <div class="ai-answer-inline" *ngIf="latestAnswer(q.id) as rec">
        <b>✦ {{t('AI-Suggested Answer','إجابة مقترحة بواسطة AI')}}</b>
        <p>{{rec.rationale}}</p><pre>{{rec.proposedAnswers|json}}</pre>
        <p *ngIf="rec.dataGaps.length">⚠ {{rec.dataGaps.join(' • ')}}</p>
        <span class="badge">{{t('Inspector review required','تتطلب مراجعة المفتش')}}</span>
        <button class="secondary" type="button" (click)="openSuggested(q)" [disabled]="busy">
         {{t('Inspect / Review Suggestion','فحص ومراجعة الاقتراح')}}</button>
       </div>
       <div class="advisory-reviewed" *ngIf="q.finalAdvisory">
        ✓ {{t('Inspector reviewed this OPTIONAL advisory. It is not a confirmed finding or a statutory checklist item.',
         'راجع المفتش هذا الاقتراح الاختياري، ولا يُعد مخالفة مؤكدة أو بندًا إلزاميًا.')}}</div>
      </article>
    </section>
    <div class="template" *ngFor="let template of e.templates">
     <header class="template-title">
      <div><h2>{{template.title}}</h2>
       <span class="badge">{{t('Published revision','الإصدار المنشور')}} v{{template.revision}}</span>
       <span class="badge">{{template.mandatory?t('Mandatory','إلزامي'):t('Additional','إضافية')}}</span></div>
      <button class="ai-btn" (click)="openAi('TEMPLATE',template)" [disabled]="busy||!aiStatus?.visionConfigured||!auth.isAdmin">
       ✦ {{t('AI Assistant · Complete Checklist','مساعد AI · القائمة بالكامل')}}</button>
     </header>
     <article class="group" *ngFor="let group of template.groups">
      <header class="group-head"><h3>{{group.title}}</h3>
       <button class="ai-btn" (click)="openAi('GROUP',template,group)"
        [disabled]="busy||!aiStatus?.visionConfigured||!auth.isAdmin">
        ✦ {{t('AI Group Assistant','مساعد AI للمجموعة')}}</button></header>
      <div class="item" *ngFor="let item of group.items">
       <div class="item-head"><div>
        <div class="question-provenance">
         <span class="published-pill">{{item.mandatory?t('PUBLISHED MANDATORY QUESTION','سؤال منشور إلزامي'):
          t('PUBLISHED OPTIONAL QUESTION','سؤال منشور اختياري')}}</span>
         <span *ngIf="latestAnswer(item.instanceId)" class="ai-source-pill">
          ✦ {{t('AI ANSWER SUGGESTED','اقتراح إجابة بواسطة AI')}}</span>
        </div>
        <h4>{{item.title}} <span *ngIf="item.mandatory" class="required">*</span></h4>
         <small>{{t('Required fields','الحقول المطلوبة')}}: {{item.requiredFields.join(', ')||'—'}}</small>
        <p *ngIf="item.description">{{item.description}}</p></div>
        <button class="ai-btn" (click)="openAi('ITEM',template,group,item)"
          [disabled]="busy||!aiStatus?.visionConfigured||!auth.isAdmin">
         ✦ {{t('Ask AI','اسأل AI')}}</button></div>
       <div class="answers">
        <label *ngIf="item.fields.includes('BOOLEAN')">{{t('Result','الإجابة')}}
         <select [(ngModel)]="answers[item.instanceId]['BOOLEAN']"
          [disabled]="e.status!=='IN_PROGRESS'">
          <option [ngValue]="undefined">{{t('Not answered','لم يُجب')}}</option>
          <option value="YES">{{t('Yes / Compliant','نعم / مستوفٍ')}}</option>
          <option value="NO">{{t('No / Needs Review','لا / يحتاج مراجعة')}}</option>
          <option value="NA">{{t('Not Applicable','لا ينطبق')}}</option>
         </select></label>
        <label *ngIf="item.fields.includes('NOTE')">{{t('Observation / Notes','الملاحظات')}}
         <textarea rows="2" maxlength="2500" [(ngModel)]="answers[item.instanceId]['NOTE']"
          [disabled]="e.status!=='IN_PROGRESS'"></textarea></label>
        <label *ngIf="item.fields.includes('EXPIRY_DATE')">{{t('Expiry Date','تاريخ الانتهاء')}}
         <input type="date" [(ngModel)]="answers[item.instanceId]['EXPIRY_DATE']"
          [disabled]="e.status!=='IN_PROGRESS'"/></label>
        <label *ngIf="item.fields.includes('DATE')">{{t('Date','التاريخ')}}
         <input type="date" [(ngModel)]="answers[item.instanceId]['DATE']"
          [disabled]="e.status!=='IN_PROGRESS'"/></label>
        <label *ngIf="item.fields.includes('TEXT')">{{t('Text','نص')}}
         <textarea rows="2" [(ngModel)]="answers[item.instanceId]['TEXT']"
          [disabled]="e.status!=='IN_PROGRESS'"></textarea></label>
        <label *ngIf="item.fields.includes('NUMBER')">{{t('Number','رقم')}}
         <input type="number" [(ngModel)]="answers[item.instanceId]['NUMBER']"
          [disabled]="e.status!=='IN_PROGRESS'"/></label>
       </div>

       <section class="per-question-ai" [attr.data-question-tools]="item.instanceId">
        <div class="question-evidence">
         <label>{{t('Attach file for this question (PDF / photo, max 2MB)',
          'إرفاق ملف لهذا السؤال (PDF أو صورة، حد أقصى 2MB)')}}
          <input type="file" accept="application/pdf,image/jpeg,image/png,image/webp"
           [disabled]="busy||e.status!=='IN_PROGRESS'||!auth.isAdmin"
           (change)="attachQuestionEvidence($event,item.instanceId)"/>
         </label>
         <div class="evidence-chips">
          <span *ngFor="let attachment of evidenceFor(item.instanceId)">
           📎 {{attachment.filename}} · {{attachment.mimeType==='application/pdf'?'PDF':'PHOTO'}}
           · {{t('Unverified','غير متحقق منه')}}
          </span>
         </div>
         <small>{{t('Files belong to this question only; uploading does not invoke Airia.',
          'المرفق مرتبط بهذا السؤال فقط، ورفعه لا يستدعي Airia.')}}</small>
        </div>
        <div class="question-ai-guidance">
         <div class="guidance-title">
          <b>✦ {{t('AI-Suggested Inspection Instruction','تعليمات المعاينة المقترحة بواسطة AI')}}</b>
          <button type="button" class="ai-btn" (click)="openAi('ITEM',template,group,item)"
           [disabled]="busy||e.status!=='IN_PROGRESS'||!aiStatus?.visionConfigured||!auth.isAdmin">
           ✦ {{t('Ask AI · Analyse Photo & Suggest Answer',
            'اسأل AI · تحليل الصورة واقتراح الإجابة')}}</button>
         </div>
         <p *ngIf="latestInstruction(item.instanceId) as guide;else noInstruction">{{guide}}</p>
         <ng-template #noInstruction>
          <p class="instruction-unavailable">{{t(
            'No AI-generated instruction yet. Ask AI to suggest inspection steps for this question.',
            'لم يتم إنشاء تعليمات بواسطة AI بعد؛ اطلب منه خطوات المعاينة لهذا السؤال.')}}</p>
         </ng-template>
         <div class="published-tip" *ngIf="item.description">
          {{t('Published guidance (not AI)','تعليمات المنشور (ليست AI)')}}: {{item.description}}
         </div>
        </div>
        <div class="ai-answer-inline" *ngIf="latestAnswer(item.instanceId) as rec">
         <div class="guidance-title">
          <b>✦ {{t('AI-Suggested Answer · Review Needed','إجابة مقترحة بواسطة AI · تتطلب مراجعة')}}</b>
          <span>{{t('Confidence','الثقة')}} {{rec.confidence*100|number:'1.0-0'}}%</span>
         </div>
         <p>{{rec.rationale}}</p>
         <pre>{{rec.proposedAnswers|json}}</pre>
         <p *ngIf="rec.dataGaps.length">⚠ {{rec.dataGaps.join(' • ')}}</p>
         <button class="secondary" type="button" (click)="openAi('ITEM',template,group,item)"
          [disabled]="busy">{{t('Review AI Answer','مراجعة إجابة AI')}}</button>
        </div>
       </section>
       <div class="answer-foot">
        <span>{{item.answerStatus==='RECORDED'?t('Saved','محفوظ'):t('Not recorded yet','لم يُحفظ بعد')}}</span>
        <span *ngIf="item.evidenceRefs?.length">
          {{t('Evidence','دليل')}}: {{item.evidenceRefs.join(', ')}}</span>
       </div>
      </div>
     </article>
    </div>
    <div class="submit-bar">
     <span>{{t('Save answers, then submit all mandatory dynamic checklists for supervisor review.',
       'احفظ الإجابات ثم أرسل جميع القوائم الديناميكية الإلزامية لمراجعة المشرف.')}}</span>
     <button (click)="submit()" [disabled]="busy||e.status!=='IN_PROGRESS'||!auth.isAdmin">
      {{t('Submit All Completed Checklists','إرسال قوائم المعاينة المكتملة')}}</button>
    </div>
   </ng-container>

   <section class="assistant" id="si-item-ai-assistant" *ngIf="currentAi as target">
    <div class="assistant-head"><div><p class="eyebrow">AIRIA · HUMAN IN THE LOOP</p>
     <h2>✦ {{t('AI Inspection Assistant','مساعد المعاينة بالذكاء الاصطناعي')}}</h2>
     <p>{{target.label}} · {{target.level}}</p></div>
     <button class="secondary" (click)="closeAi()">{{t('Close','إغلاق')}}</button></div>
    <p class="notice warning">{{t('The assistant can analyze text, an image, or both if the configured Airia multimodal pipeline supports this input. It proposes answers; only the inspector can accept, edit or reject.',
     'يمكن للمساعد تحليل نص أو صورة أو كليهما إذا كان مسار Airia يدعم الإدخال متعدد الوسائط. الإجابات مقترحة فقط، والمفتش يقبلها أو يعدلها أو يرفضها.')}}</p>
    <div class="two-fields">
     <label>{{t('Describe what you saw','اكتب وصف الملاحظة')}}
      <textarea [(ngModel)]="aiText" rows="4"
       [placeholder]="t('Describe the finding or ask AI to analyze the evidence.',
         'صف الملاحظة أو اطلب تحليل الدليل.')"></textarea></label>
     <label>{{t('Attach Image (JPG / PNG / WebP, max 2 MB)','ارفق صورة (JPG / PNG / WebP، بحد أقصى 2MB)')}}
      <input type="file" accept="image/jpeg,image/png,image/webp"
       (change)="onImage($event)"/>
      <span *ngIf="fileName">{{fileName}}</span></label>
    </div>
    <div class="linked-evidence-picker" *ngIf="target.itemId && evidenceFor(target.itemId).length">
     <label>{{t('Use attached image from this question','اختر صورة مرفقة بهذا السؤال')}}
      <select [(ngModel)]="selectedEvidenceId">
       <option value="">{{t('No stored image selected','بدون صورة محفوظة')}}</option>
       <ng-container *ngFor="let file of evidenceFor(target.itemId)">
        <option *ngIf="file.mimeType!=='application/pdf'" [value]="file.id">{{file.filename}} · {{file.id}}</option>
       </ng-container>
      </select>
     </label>
    </div>
    <button class="ai-submit" (click)="askAiria()" [disabled]="busy||(!aiText.trim()&&!imagePayload&&!selectedEvidenceId)||!auth.isAdmin">
     ✦ {{busy?t('Requesting Airia…','جارٍ الاتصال بـAiria…'):
       t('Generate AI Recommendations','إنشاء توصيات AI')}}</button>
    <p class="hint">{{t('A model output does not automatically mark the vessel compliant or create a deficiency. Images are private evidence and AI requests may incur charges.',
      'لا يقرّر AI امتثال السفينة أو ينشئ مخالفة تلقائيًا. الصور أدلة خاصة وقد تترتب تكلفة على طلبات AI.')}}</p>
    <div class="proposal" *ngIf="proposal as result">
     <h3>{{t('AI Recommendations — Inspector Review Required','توصيات AI — تتطلب مراجعة المفتش')}}</h3>
     <article class="proposed-item" *ngFor="let rec of result.recommendations">
      <p><b>{{labelFor(rec.itemId)}}</b>
       <span>{{t('Confidence','درجة الثقة')}} {{(rec.confidence*100)|number:'1.0-0'}}%</span></p>
      <p>{{rec.rationale}}</p>
      <small *ngIf="rec.dataGaps?.length">{{t('Data gaps','البيانات الناقصة')}}: {{rec.dataGaps.join(', ')}}</small>
      <pre>{{rec.proposedAnswers|json}}</pre>
      <div class="review-controls">
       <label>{{t('Edit proposed answer (JSON object)','تعديل الإجابة المقترحة (JSON)')}}
        <textarea [(ngModel)]="reviewEdits[rec.itemId]" rows="2"></textarea></label>
       <div class="actions">
        <button (click)="review(rec.itemId,'ACCEPT')" [disabled]="busy||reviewed(rec.itemId)">
         {{t('Accept AI Suggestion','الموافقة على اقتراح AI')}}</button>
        <button class="secondary" (click)="review(rec.itemId,'EDIT')" [disabled]="busy||reviewed(rec.itemId)">
         {{t('Accept with Modifications','الموافقة بعد التعديل')}}</button>
        <button class="reject" (click)="review(rec.itemId,'REJECT')" [disabled]="busy||reviewed(rec.itemId)">
         {{t('Reject Suggestion','رفض الاقتراح')}}</button>
       </div>
       <small *ngIf="reviewed(rec.itemId)">{{t('Reviewed and audited','تمت المراجعة والتسجيل')}}</small>
      </div>
     </article>
    </div>
   </section>
  </main>
 </div>
 `,
 styles:[`
 :host{display:block;background:#edf4f6;min-height:100vh;color:#173b4f}
 .body{margin-inline-start:264px;padding:28px;max-width:1750px}
 .hero{display:flex;justify-content:space-between;gap:18px;align-items:center}
 h1{font-size:28px;margin:6px 0}h2{font-size:20px;margin:5px 0}
 h3{font-size:15px}h4{font-size:14px;margin:5px 0}
 .eyebrow{color:#068b80;font-size:11px;letter-spacing:1px;font-weight:850}
 .hero p,.hint{color:#647e89;font-size:12px;line-height:1.8}
 .nav-actions,.actions{display:flex;gap:9px;flex-wrap:wrap}.nav-actions a{padding:11px;background:white;
  color:#087b72;text-decoration:none;border-radius:9px;font-size:12px;font-weight:800;border:1px solid #d2e2e4}
 button{cursor:pointer;background:#087e77;color:#fff;border:0;border-radius:8px;
  font-size:12px;font-weight:750;padding:11px 15px}
 button:disabled{opacity:.52;cursor:not-allowed}
 .secondary{background:#e9f4f4;color:#087f77}.reject{background:#fff1ec;color:#ad4335}
 .ai-btn{background:#e9e5ff;color:#5c43a5;font-size:11px;white-space:nowrap}
 .notice{border-radius:9px;padding:13px 16px;margin:14px 0;
  font-size:12px;background:#e9f4f8;color:#1d6676;line-height:1.7}
 .notice.warning{background:#fff2db;color:#7b5821}.notice.error{background:#ffebe6;color:#a54736}
 .notice.good{background:#def6e6;color:#1a7650}
 .summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:18px 0}
 .summary div{background:#fff;border:1px solid #dfeaec;border-radius:11px;padding:15px;
  display:grid;gap:9px}.summary span{color:#68818f;font-size:11px}.summary strong{font-size:15px}
 .init,.execution-header,.submit-bar{display:flex;justify-content:space-between;align-items:center;gap:17px;
  background:#fff;padding:18px;border:1px solid #dce9ea;border-radius:11px;margin:14px 0}
 .init p,.submit-bar span{font-size:12px;color:#65808d;line-height:1.8}
 .execution-header small{display:block;color:#718895;margin-top:5px}
 .template{background:#fff;border:1px solid #d3e4e5;border-radius:13px;padding:22px;margin:18px 0}
 .ai-a04{border-color:#cbb6e4;background:#fbf9ff}
 .ai-a04-item{padding:10px 0;border-top:1px solid #e1d6ef}
 .ai-a04-item strong{display:block;color:#66418b}
 .ai-a04-item p{font-size:12px;margin:4px 0}
 .ai-a04-item small{color:#65808b}
 .template-title,.group-head,.item-head,.assistant-head{display:flex;justify-content:space-between;align-items:center;gap:16px}
 .badge{background:#e9f5f0;border-radius:15px;color:#147361;font-size:10px;padding:5px 9px;margin:4px}
 .group{border:1px solid #dde8e8;border-radius:11px;background:#f9fcfc;padding:15px;margin:18px 0}
 .item{background:#fff;border-radius:9px;border:1px solid #e3edef;padding:15px;margin:13px 0}
 .item-head p{color:#76909a;font-size:12px}.required{color:#d06c2a}
 .answers{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:13px;margin:15px 0}
 label{display:grid;gap:7px;font-size:12px;font-weight:700;color:#476c7a}
 input,textarea,select{padding:10px;border-radius:8px;border:1px solid #c6dce0;
  font:inherit;color:#183d54;background:#fff;width:100%}
 .answer-foot{display:flex;gap:20px;color:#72919a;font-size:10px}
 .assistant{background:#f6f4ff;border:1px solid #d6cbed;
  border-radius:13px;padding:23px;margin:20px 0}
 .assistant-head{margin-bottom:16px}.assistant-head p{color:#6c6b9b;font-size:11px}
 .two-fields{display:grid;grid-template-columns:1fr 1fr;gap:18px}
 .ai-submit{background:#6550af;margin-top:15px}
 .proposal{background:white;padding:17px;border-radius:10px;margin:19px 0}
 .proposed-item{padding:14px;border:1px solid #e5e2f3;border-radius:8px;margin:13px 0}
 .proposed-item p{font-size:12px;line-height:1.7}
 .proposed-item p span{float:inline-end;color:#7f699b}
 .proposed-item small{display:block;color:#738091;font-size:10px}
 pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;background:#eff4f8;
  border-radius:6px;padding:12px}
 .review-controls{display:grid;gap:11px}.hint{margin-top:9px}
 @media(max-width:1200px){.body{margin-inline-start:0;padding:18px}}
 @media(max-width:880px){.summary{grid-template-columns:repeat(2,1fr)}
  .answers,.two-fields{grid-template-columns:1fr}}
 @media(max-width:560px){.summary{grid-template-columns:1fr}
  .template-title,.group-head,.hero,.item-head,.init,.execution-header,.submit-bar{display:block}
  .ai-btn{margin-top:10px}}
 `]
})
export class SiChecklistExecutionComponent implements OnInit,OnDestroy{
 caseId='';preview:ChecklistPreview|null=null;execution:ChecklistExecution|null=null;
 a04:A04Dossier|null=null;
 get a04AdditionalItems():A04Additional[]{
  return this.a04?.saved?.dossier?.suggestedAdditionalItems||[];
 }
 aiStatus:{visionConfigured:boolean;builderConfigured?:boolean}|null=null;
 loading=false;busy=false;error='';message='';
 answers:Record<string,AnswerValues>={};currentAi:ReviewScope|null=null;
 aiText='';fileName='';imagePayload:{mimeType:string;base64:string}|null=null;
 selectedEvidenceId='';questionPrompt='Suggest vessel-specific optional inspection questions based only on the evidence and inspection reasons. Include practical inspection instructions.';
 uploadingItem='';
 proposal:ChecklistProposal|null=null;reviewEdits:Record<string,string>={};
 private sub:any;
 constructor(private route:ActivatedRoute,private api:SiChecklistsService,
  private http:HttpClient,public lang:LanguageService,public auth:MoeiAuthService){}
 t(en:string,ar:string){return this.lang.pick(en,ar);}
 ngOnInit():void{
  this.sub=this.route.paramMap.subscribe(p=>{
   this.caseId=p.get('caseId')||'';this.reload();
  });
  this.api.aiStatus().subscribe({next:r=>this.aiStatus=r,error:()=>this.aiStatus=null});
 }
 ngOnDestroy():void{this.sub?.unsubscribe();}
 reload():void{
  if(!this.caseId)return;this.loading=true;this.error='';this.a04=null;
  this.http.get<A04Dossier>('/api/si/v1/preparations/'+
   encodeURIComponent(this.caseId)).subscribe({
    next:r=>this.a04=r,error:()=>this.a04=null});
  this.api.preview(this.caseId).subscribe({
   next:p=>{this.preview=p;this.execution=p.saved;this.loading=false;
    this.copyAnswers();},
   error:e=>this.fail(e)});
 }
 copyAnswers():void{
  const values:Record<string,AnswerValues>={};
  for(const t of this.execution?.templates||[])
   for(const g of t.groups)for(const i of g.items)
    values[i.instanceId]={...i.answers};
  this.answers=values;
 }
 allItems():ChecklistInstanceItem[]{
  return this.execution?.templates.flatMap(t=>t.groups.flatMap(g=>g.items))||[];
 }
 labelFor(id:string):string{return this.allItems().find(i=>i.instanceId===id)?.title||
  this.execution?.aiSuggestedQuestions?.find(q=>q.id===id)?.title||id;}
 start():void{if(this.busy)return;this.busy=true;
  this.api.start(this.caseId).subscribe({next:e=>{this.busy=false;this.execution=e;this.copyAnswers();},
   error:e=>this.fail(e)});}
 save():void{
  if(!this.execution||this.busy)return;
  const entries=this.allItems().map(i=>({itemId:i.instanceId,values:this.answers[i.instanceId]||{}}));
  this.busy=true;this.api.answers(this.caseId,this.execution.version,entries)
   .subscribe({next:e=>{this.execution=e;this.copyAnswers();this.busy=false;
    this.message=this.t('Answers saved with audit.','تم حفظ الإجابات مع سجل تدقيق.');},
    error:e=>this.fail(e)});
 }
 submit():void{
  if(!this.execution||this.busy||!window.confirm(this.t(
   'Submit all mandatory checklists for review?','هل تريد إرسال كل القوائم الإلزامية للمراجعة؟')))return;
  this.busy=true;this.api.submit(this.caseId,this.execution.version)
   .subscribe({next:e=>{this.execution=e;this.busy=false;
    this.message=this.t('Checklist submitted for review.','تم إرسال القائمة للمراجعة.');},
    error:e=>this.fail(e)});
 }
 get questionEvidence():ChecklistEvidence[]{
  return this.execution?.evidenceFiles||[];
 }
 evidenceFor(itemId:string):ChecklistEvidence[]{
  return this.questionEvidence.filter(x=>x.itemId===itemId);
 }
 latestImage(itemId:string):ChecklistEvidence|null{
  return [...this.evidenceFor(itemId)].reverse().find(x=>
   ['image/png','image/jpeg','image/webp'].includes(x.mimeType))||null;
 }
 latestProposal(itemId:string):ChecklistProposal|null{
  const q=this.execution?.aiSuggestedQuestions?.find(q=>q.id===itemId);
  const proposals=q?.answerProposals||this.execution?.proposals||[];
  return [...proposals].reverse().find(p=>
   p.recommendations?.some(r=>r.itemId===itemId))||null;
 }
 latestInstruction(itemId:string):string|null{
  const rec=this.latestProposal(itemId)?.recommendations.find(r=>r.itemId===itemId);
  return rec?.suggestedInstruction||null;
 }
 latestAnswer(itemId:string){
  return this.latestProposal(itemId)?.recommendations.find(r=>r.itemId===itemId)||null;
 }
 assistantForItem(itemId:string):boolean{
  return this.currentAi?.itemId===itemId;
 }
 openAi(level:AiLevel,template:ChecklistInstanceTemplate,
  group?:ChecklistInstanceGroup,item?:ChecklistInstanceItem):void{
  this.currentAi={level,templateId:template.templateId,groupId:group?.instanceId,
   itemId:item?.instanceId,label:item?.title||group?.title||template.title};
  this.proposal=item?this.latestProposal(item.instanceId):null;
  this.reviewEdits={};this.error='';this.aiText='';this.imagePayload=null;
  this.selectedEvidenceId=item?this.latestImage(item.instanceId)?.id||'':'';
  this.prepareReviewEdits();this.scrollToAssistant();
 }
 openSuggested(question:SuggestedInspectionQuestion):void{
  this.currentAi={level:'AI_QUESTION',itemId:question.id,label:question.title};
  this.selectedEvidenceId=this.latestImage(question.id)?.id||'';
  this.proposal=this.latestProposal(question.id);
  this.aiText='';this.imagePayload=null;this.reviewEdits={};
  this.prepareReviewEdits();this.scrollToAssistant();
 }
 prepareReviewEdits():void{
  for(const rec of this.proposal?.recommendations||[])
   this.reviewEdits[rec.itemId]=JSON.stringify(rec.proposedAnswers,null,2);
 }
 scrollToAssistant():void{
  setTimeout(()=>document.getElementById('si-item-ai-assistant')?.scrollIntoView({
   behavior:'smooth',block:'start'
  }),0);
 }
 closeAi():void{this.currentAi=null;this.proposal=null;this.imagePayload=null;
  this.aiText='';this.fileName='';this.selectedEvidenceId='';this.reviewEdits={};}
 refreshCase():void{
  this.api.preview(this.caseId).subscribe({
   next:p=>{this.preview=p;this.execution=p.saved;},
   error:e=>this.fail(e)});
 }
 attachQuestionEvidence(event:Event,itemId:string):void{
  const input=event.target as HTMLInputElement;
  const file=input.files?.[0];input.value='';
  if(!file||!this.execution||this.busy)return;
  const permitted=['image/png','image/jpeg','image/webp','application/pdf'];
  if(!permitted.includes(file.type)||!file.size||file.size>2*1024*1024){
   this.error=this.t('Attach PDF/JPG/PNG/WebP up to 2MB per file.',
    'ارفق PDF أو JPG أو PNG أو WebP بحد أقصى 2MB للملف.');
   return;
  }
  this.busy=true;this.uploadingItem=itemId;this.error='';this.message='';
  const reader=new FileReader();
  reader.onerror=()=>{this.busy=false;this.uploadingItem='';
   this.error=this.t('Cannot read the selected file.','تعذر قراءة المرفق.');};
  reader.onload=()=>{
   const data=String(reader.result||'');
   const base64=data.slice(data.indexOf(',')+1);
   this.api.attachEvidence(this.caseId,{itemId,
    expectedVersion:this.execution!.version,
    file:{filename:file.name,mimeType:file.type,base64}})
    .subscribe({next:result=>{
      this.busy=false;this.uploadingItem='';this.selectedEvidenceId=
       file.type==='application/pdf'?'':result.evidence.id;
      this.message=this.t('Evidence attached to this question; AI has not run.',
       'تم إرفاق الدليل بهذا السؤال ولم يتم تشغيل AI.');
      this.refreshCase();
    },error:e=>{this.uploadingItem='';this.fail(e);}});
  };
  reader.readAsDataURL(file);
 }
 generateQuestions():void{
  if(!this.execution||this.busy||!this.aiStatus?.builderConfigured)return;
  if(!window.confirm(this.t(
   'Generate new OPTIONAL AI-suggested inspection questions? This calls the configured Airia builder and may incur a charge; it does not approve or publish any checklist items.',
   'هل تريد إنشاء أسئلة معاينة إضافية مقترحة بواسطة AI؟ سيتم استدعاء Airia وقد توجد تكلفة، ولن تُعتمد أو تُنشر أي بنود تلقائيًا.')))return;
  this.busy=true;this.error='';
  this.api.suggestQuestions(this.caseId,this.questionPrompt.trim()).subscribe({
   next:r=>{this.busy=false;this.message=this.t(
    r.questions.length+' advisory AI questions suggested (not statutory or approved).',
    'تم اقتراح '+r.questions.length+' أسئلة استشارية بواسطة AI (غير معتمدة أو إلزامية).');
    this.refreshCase();
   },error:e=>this.fail(e)
  });
 }

 onImage(event:Event):void{
  const target=event.target as HTMLInputElement,file=target.files?.[0];
  this.imagePayload=null;this.fileName='';
  if(!file)return;
  if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>2*1024*1024){
   this.error=this.t('Use JPG, PNG or WebP (max 2MB).','استخدم JPG أو PNG أو WebP بحد أقصى 2MB.');
   return;
  }
  const reader=new FileReader();
  reader.onload=()=>{
   const data=String(reader.result||'');
   const base64=data.slice(data.indexOf(',')+1);
   this.imagePayload={mimeType:file.type,base64};this.fileName=file.name;
  };reader.readAsDataURL(file);
 }
 askAiria():void{
  if(!this.currentAi||(!this.aiText.trim()&&!this.imagePayload&&!this.selectedEvidenceId)||this.busy)return;
  if(!window.confirm(this.t('Send selected image/text to the configured Airia pipeline? This may incur an AI usage charge.',
   'هل توافق على إرسال الصورة/النص المختار إلى Airia؟ قد يتم احتساب تكلفة AI.')))return;
  this.busy=true;this.error='';
  const target=this.currentAi;
  const request=target.level==='AI_QUESTION'
    ?this.api.suggestAdvisoryAnswer(this.caseId,{
      questionId:target.itemId!,evidenceId:this.selectedEvidenceId||undefined,
      text:this.aiText.trim(),confirmCost:true})
    :this.api.aiSuggest(this.caseId,{level:target.level,
      templateId:target.templateId,groupId:target.groupId,
      itemId:target.itemId,text:this.aiText.trim(),
      evidenceId:this.selectedEvidenceId||undefined,
      image:this.imagePayload||undefined,confirmCost:true});
  request.subscribe({next:r=>{this.busy=false;this.proposal=r.proposal;
    this.refreshCase();this.reviewEdits={};this.prepareReviewEdits();
    this.message=this.t('Airia returned an advisory answer and inspection instruction for inspector review.',
      'أعاد Airia إجابة وتعليمات معاينة استشارية لمراجعتها من المفتش.');},
    error:e=>this.fail(e)});
 }
 reviewed(itemId:string):boolean{
  return Boolean(this.proposal?.reviews.some(r=>r.itemId===itemId));
 }
 review(itemId:string,decision:'ACCEPT'|'EDIT'|'REJECT'):void{
  if(!this.execution||!this.proposal||this.busy)return;
  let editedAnswers:AnswerValues|undefined;
  if(decision==='EDIT'){
   try{editedAnswers=JSON.parse(this.reviewEdits[itemId]||'{}');}
   catch{this.error=this.t('Edited values must be valid JSON.','يجب أن تكون الإجابات المعدلة JSON سليمًا.');return;}
  }
  this.busy=true;this.error='';
  const request=this.currentAi?.level==='AI_QUESTION'
   ?this.api.reviewAdvisoryAnswer(this.caseId,{
      expectedVersion:this.execution.version,questionId:itemId,
      proposalId:this.proposal.id,decision,editedAnswers,
      reviewNote:decision==='EDIT'?'Inspector edited advisory answer':''
    })
   :this.api.review(this.caseId,{expectedVersion:this.execution.version,
      proposalId:this.proposal.id,itemId,decision,editedAnswers,
      reviewNote:decision==='EDIT'?'Inspector edited model recommendation':''});
  request.subscribe({next:e=>{
    this.execution=e;this.busy=false;
    // Do not overwrite unsaved inspector entries when recording an AI review.
    const q=e.aiSuggestedQuestions?.find(x=>x.id===itemId);
    const saved=q?.answerProposals?.find(x=>x.id===this.proposal?.id)||
      e.proposals.find(x=>x.id===this.proposal?.id);
    if(saved)this.proposal=saved;
    this.message=this.t('Inspector decision saved and audited.',
     'تم تسجيل قرار المفتش وتدقيقه.');
   },error:e=>this.fail(e)});
 }
 fail(e:any):void{
  this.loading=false;this.busy=false;
  this.error=e?.error?.error||this.t('Unable to load or save inspection checklist.',
    'تعذر تحميل أو حفظ قائمة المعاينة.');
 }
}
