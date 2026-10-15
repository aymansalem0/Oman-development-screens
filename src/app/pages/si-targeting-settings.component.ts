import {CommonModule} from '@angular/common';
import {Component,OnInit} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {RouterLink} from '@angular/router';
import {NmcNavigationComponent} from '../components/nmc-navigation.component';
import {LanguageService} from '../services/language.service';
import {SiCandidateTargetingService,SiDashboard,SiImpact,SiTargetingPolicyConfig,SiSelectionRules,SiC01AdvisoryRules,SiC01Signal} from '../services/si-candidate-targeting.service';

/** Entry rules ≠ execution ranking. Operational rules, not NMC vessel risk. */
@Component({
 selector:'app-si-targeting-settings',
 standalone:true,imports:[CommonModule,FormsModule,RouterLink,NmcNavigationComponent],
 template:`
 <div class="si-layout" [attr.dir]="lang.dir">
  <app-nmc-navigation></app-nmc-navigation>
  <main class="settings-main">
   <header class="heading">
    <div>
     <small>{{copy('SETTINGS / SMART INSPECTION','الإعدادات / المعاينة الذكية')}}</small>
     <h1>{{copy('Inspection Selection & Priority Policy','إعدادات اختيار السفن وترتيب أولويات المعاينات')}}</h1>
     <p>{{copy('Configure candidate entry, independent PSC-risk and UAE-flag quotas, verified execution priorities and SI-C01 AI selection. The AI returns source-grounded vessel selection under the PUBLISHED business policy.',
      'ضبط أهلية المرشحين ونسب PSC والعلم الإماراتي وقواعد الأولويات وتعليمات SI-C01. يختار AI السفن من المصادر ضمن السياسة المنشورة ويظل الاعتماد بشريًا.')}}</p>
    </div>
    <div class="actions">
     <a routerLink="/moei/smart-inspection/candidates">{{copy('Candidate Center','قائمة المرشحين')}}</a>
     <button type="button" (click)="refresh()" [disabled]="busy||loading">{{copy('Refresh','تحديث')}}</button>
    </div>
   </header>
   <p *ngIf="error" class="notice error" role="alert">{{error}}</p>
   <p *ngIf="success" class="notice success" role="status">{{success}}</p>
   <p *ngIf="loading" class="notice">{{copy('Loading inspection policy…','تحميل سياسة المعاينات…')}}</p>
   <section class="stats" *ngIf="dashboard as d">
    <article><small>{{copy('PUBLISHED POLICY','إصدار السياسة')}}</small><strong>v{{d.policy.version}}</strong></article>
    <article><small>{{copy('PENDING CANDIDATES','المرشحون المنتظرون')}}</small><strong>{{d.summary.pendingVessels}}</strong></article>
    <article><small>{{copy('AVAILABLE VESSEL SOURCES','مصادر السفن')}}</small><strong>3</strong></article>
   </section>
   <nav class="policy-tabs" aria-label="Inspection selection rules">
    <button type="button" [class.active]="tab==='ENTRY'" (click)="tab='ENTRY'">{{copy('1. Eligibility & Selection','١. أهلية السفن واختيارها')}}</button>
    <button type="button" [class.active]="tab==='RANKING'" (click)="tab='RANKING'">{{copy('2. Priority Rules','٢. قواعد ترتيب الأولويات')}}</button>
    <button type="button" [class.active]="tab==='AI_RULES'" (click)="tab='AI_RULES'">{{copy('3. AI Advisory Configuration','٣. إعدادات وكيل AI')}}</button>
    <button type="button" [class.active]="tab==='PUBLISH'" (click)="tab='PUBLISH'">{{copy('4. Policy Impact & Publishing','٤. معاينة الأثر والنشر')}}</button>
   </nav>
   <section class="panel" *ngIf="tab==='ENTRY'">
    <h2>{{copy('Inspection Eligibility & Candidate Entry','شروط دخول السفن إلى قائمة المعاينة')}}</h2>
    <p>{{copy('Inclusion is based on validated source workflows, not on ETD, incident score or NMC vessel risk. Rules are enforced by each source integration.',
     'يتم الإدراج طبقًا لمسار مصدر الطلب، وليس حسب موعد المغادرة أو درجة الحادث أو مخاطر السفينة.')}}</p>
    <div class="rule">
     <div class="position">1</div><div>
      <strong>{{copy('NMC Approved Referral','إحالة NMC المعتمدة')}}</strong>
      <small>{{copy('Human-approved active referral. Protected mandatory inclusion; do not infer authorization from AI.',
       'إحالة نشطة معتمدة بشريًا، تُحمى عند الإدراج ولا يمنح AI أي اعتماد.')}}</small></div>
     <span class="status">{{copy('Source-gated','بحسب المصدر')}}</span>
    </div>
    <div class="rule">
     <div class="position">2</div><div>
      <strong>{{copy('Maritime Service Request','طلب خدمة بحرية')}}</strong>
      <small>{{copy('Every actionable pending service request is eligible regardless of low/missing NMC risk. Duplicate or handled events do not create new cases.',
       'كل طلب خدمة صالح ومعلّق مؤهل بغض النظر عن انخفاض أو غياب المخاطر؛ مع منع التكرار.')}}</small></div>
     <span class="status">{{copy('Source-gated','بحسب المصدر')}}</span>
    </div>
    <div class="rule">
     <div class="position">3</div><div>
      <strong>{{copy('PSC Port Call','سفينة PSC')}}</strong>
      <small>{{copy('Published PSC quotas are applied to saved Excel Port Calls automatically; each result is an advisory candidate, not an approved inspection.',
       'تُطبّق حصص PSC المنشورة على أحداث Excel المحفوظة تلقائيًا، ويظل الترشيح للمراجعة وليس اعتمادًا للمعاينة.')}}</small></div>
     <a routerLink="/moei/smart-inspection/settings/psc-quotas" class="policy-link">{{copy('PSC settings','إعدادات PSC')}}</a>
    </div>
    <section class="si-selection-config" aria-label="Business selection factors">
     <h3>{{copy('Candidate Entry · Independent Selection Factors (Pool B)','دخول المرشحين · نسب اختيار مستقلة (مجموعة B)')}}</h3>
     <p class="rule-info">{{copy('UAE Flag B counts ONLY source-eligible vessels already present in Candidate Center, not every UAE-registered vessel. NMC approved referrals and mandatory service requests are always protected.',
       'المجموعة B تشمل السفن الإماراتية المؤهلة الموجودة بالفعل ضمن Candidate Center من المصادر، وليس كل السفن المسجلة. إحالات NMC المعتمدة وطلبات الخدمات الملزمة تظل محمية.')}}</p>
     <div class="selection-percents">
       <label>{{copy('PSC + Saved Risk · % of eligible candidate IMOs','PSC + المخاطر المحفوظة · % من السفن المرشحة المؤهلة')}}
         <input type="number" min="0" max="100" step="1" [(ngModel)]="selectionRules.pscRiskRatePercent" (ngModelChange)="rulesChanged()" aria-label="PSC plus risk percent"/> %
       </label>
       <label>{{copy('UAE Flag B · % of eligible candidate IMOs','العلم الإماراتي B · % من السفن المرشحة المؤهلة')}}
         <input type="number" min="0" max="100" step="1" [(ngModel)]="selectionRules.uaeFlagRatePercent" (ngModelChange)="rulesChanged()" aria-label="UAE flag percent"/> %
       </label>
     </div>
     <p class="rule-info">{{copy('PSC is TWO sequential, visible screens: Stage 1 is the published PSC Port Call event quota; Stage 2 is this PSC + Risk percentage applied to the resulting eligible distinct vessels. They are NOT one rate. UAE-flag selection is independent. A vessel in both is counted once.',
       'اختيار PSC يتم على مرحلتين واضحتين: الأولى حصة أحداث Port Call المنشورة، والثانية نسبة PSC + المخاطر هنا على السفن المؤهلة الناتجة دون تكرار IMO. النسبتان ليستا نسبة واحدة. نسبة العلم الإماراتي مستقلة، والسفينة المشتركة تحسب مرة واحدة.')}}</p>
     <p class="helper">{{copy('SI-C01 returns SELECT / DEFER / MANUAL REVIEW evidence-backed recommendations within each cap; no AI recommendation can expand eligibility, replace missing saved risk or approve an inspection.',
       'يرجع SI-C01 توصيات اختيار أو تأجيل أو مراجعة يدوية مع الأدلة في حدود الحصص، دون توسيع الأهلية أو اختراع مخاطر غير محفوظة أو اعتماد معاينة.')}}</p>
   </section>
   <p class="helper">{{copy('Entry rules do not decide execution order. Final inspection plan approval remains with the authorised supervisor.',
      'قواعد الدخول لا تحدد ترتيب التنفيذ، واعتماد خطة المعاينة يظل من اختصاص المسؤول المخول.')}}</p>
   </section>
   <section class="panel" *ngIf="tab==='RANKING'">
    <h2>{{copy('Vessel Execution Ranking','ترتيب تنفيذ معاينات السفن')}}</h2>
    <p>{{copy('Ordered, non-weighted rules: apply criterion 1, then criterion 2. No 100% normalization or source score. More criteria have not yet been specified.',
     'قواعد متتابعة بلا أوزان: أولاً المعيار الأول، ثم الثاني. لا تطبيع للنسب أو درجات مصادر؛ ولم تُحدد بقية المعايير بعد.')}}</p>
    <div class="rule"><div class="position">1</div><div>
     <strong>{{copy('Vessels approaching departure (ETD)','السفن التي قاربت على المغادرة')}}</strong>
     <small>{{copy('Ascending verified future departure time: sooner ETD first. Arrival ETA is not departure. No unsupported departure window is invented.',
      'ترتيب تصاعدي لموعد المغادرة الفعلي الموثق ETD. موعد الوصول ETA لا يُستخدم بديلاً للمغادرة.')}}</small>
    </div><span class="status">{{copy('Primary','الأول')}}</span></div>
    <div class="rule"><div class="position">2</div><div>
     <strong>{{copy('Vessels with maritime incidents','السفن المرتبطة بحوادث بحرية')}}</strong>
     <small>{{copy('For remaining vessels, descending NMC incident-specific severity from a current human-reviewed incident, not the general vessel risk score.',
      'للسفن الباقية، الأشد أولاً وفق درجة خطورة الحادث المعتمدة بشريًا في NMC، وليس درجة مخاطر السفينة العامة.')}}</small>
    </div><span class="status">{{copy('Secondary','الثاني')}}</span></div>
    <div class="rule pending"><div class="position">3</div><div>
     <strong>{{copy('Additional criteria — awaiting MOEI definition','بقية معايير الترتيب — بانتظار استكمال التعريف')}}</strong>
     <small>{{copy('Until defined, vessels with no verified ETD or incident data stay visible in stable IMO order with missing-data explanation. Never fabricate a date or severity.',
      'حتى اعتماد باقي المعايير، تظهر السفن بلا موعد مغادرة أو حادث معتمد بترتيب IMO ثابت مع توضيح البيانات الناقصة.')}}</small>
    </div></div>
    <p class="helper">{{copy('The official execution order is currently fixed by approved business rules, independent of vessel risk or AI prompt changes. AI advisory guidance can be managed in the third tab.',
     'ترتيب التنفيذ الرسمي ثابت حاليًا وفق قواعد الأعمال المعتمدة، ولا يتغير بدرجة مخاطر السفينة أو تعليمات AI. يمكن إدارة توجيهات AI الاستشارية من التبويب الثالث.')}}</p>

   </section>
   <section class="panel" *ngIf="tab==='AI_RULES'">
    <h2>{{copy('SI-C01 · Selection & Priority Configuration','SI-C01 · إعدادات اختيار السفن وتفسير الأولوية')}}</h2>
    <p>{{copy('These are versioned instructions actually sent to Airia. They govern AI advice; they cannot change legal eligibility, published PSC quotas, verified departure ordering or inspection approval.',
      'هذه تعليمات مُؤرشفة تُرسل فعليًا إلى Airia. تتحكم في توصيات AI ولا تستطيع تعديل الأهلية التنظيمية أو حصص PSC أو ترتيب المغادرة المؤكد أو صلاحيات اعتماد المعاينات.')}}</p>
    <div class="policy-rule-editor">
     <h3>{{copy('A. Selection signals considered by AI','أ. إشارات الاختيار التي يراعيها AI')}}</h3>
     <p>{{copy('Choose which trusted facts should guide AI recommendations. All available source evidence continues to be transmitted and validated.',
       'حدد البيانات الموثقة التي توجه توصيات AI. سيظل النظام يرسل الأدلة المتاحة ويتحقق منها جميعًا.')}}</p>
     <div class="signal-grid">
      <label *ngFor="let item of signals" class="signal-switch">
       <input type="checkbox" [checked]="aiRules.selectionSignals.includes(item.code)"
          (change)="toggleSignal(item.code,$any($event.target).checked)"/>
       <span><strong>{{copy(item.en,item.ar)}}</strong><small>{{copy(item.detailEn,item.detailAr)}}</small></span>
      </label>
     </div>
     <label>{{copy('Minimum AI confidence for an inclusion recommendation (0–1)','الحد الأدنى لثقة AI لترشيح الإدراج (من صفر إلى ١)')}}
      <input type="number" min="0" max="1" step="0.05"
        [(ngModel)]="aiRules.minimumSelectionConfidence" (ngModelChange)="rulesChanged()"/>
     </label>
     <p class="rule-info">{{copy('Recommendations below the configured threshold become Manual Review. Mandatory NMC referrals and eligible service requests remain protected.',
       'التوصيات الأقل من الحد تتحول إلى مراجعة بشرية. لا تُستبعد إحالات NMC الإلزامية أو طلبات الخدمات المؤهلة.')}}</p>
     <label>{{copy('Additional selection instructions for AI · up to 600 characters','تعليمات إضافية لاختيار السفن · حتى ٦٠٠ حرف')}}
      <textarea rows="4" maxlength="600" [(ngModel)]="aiRules.selectionInstructions"
       (ngModelChange)="rulesChanged()" placeholder="e.g. Explain why source evidence supports inspection review"></textarea>
     </label>
     <h3>{{copy('B. Priority explanation instructions','ب. تعليمات شرح الأولوية')}}</h3>
     <div class="rule-info">
      <strong>{{copy('Official order (not editable here)','الترتيب الرسمي (لا يُعدل من هنا)')}}</strong>
      <p>{{copy('1. Earliest verified future ETD. 2. Highest human-reviewed active incident severity. 3. Additional criteria pending ministry definition. Vessel risk does not assign execution priority.',
       '١. أقرب موعد مغادرة مؤكد ETD. ٢. أعلى خطورة لحادث نشط تمت مراجعته بشريًا. ٣. باقي المعايير بانتظار تعريف الوزارة. مخاطر السفينة لا تحدد ترتيب التنفيذ.')}}</p>
     </div>
     <label>{{copy('Additional AI priority explanation instructions · up to 600 characters','تعليمات إضافية لشرح الأولوية عبر AI · حتى ٦٠٠ حرف')}}
      <textarea rows="4" maxlength="600" [(ngModel)]="aiRules.priorityInstructions" (ngModelChange)="rulesChanged()"
       placeholder="e.g. Reference ETD provenance and explicitly list missing data"></textarea>
     </label>
     <p class="rule-info">{{copy('Changes are saved only after authorised publication, increment the policy version, and are applied to future explicit SI-C01 runs. Draft previews do not call Airia or rewrite approved plans.',
       'لا تُحفظ التعديلات إلا بعد النشر بصلاحية معتمدة، مع زيادة رقم الإصدار. وتطبق على تشغيل SI-C01 اللاحق صراحةً. المعاينة لا تشغل Airia ولا تعدل الخطط المعتمدة.')}}</p>
    </div>
        </section>
   <section class="panel" *ngIf="tab==='PUBLISH'">
    <h2>{{copy('Policy Impact & Publishing','معاينة تأثير السياسة والنشر')}}</h2>
    <p>{{copy('Preview is read-only. Configure two independent candidate-level quotas, review all source-backed populations, then publish one version used by every future explicit SI-C01 run.',
      'المعاينة قراءة فقط. اضبط نسبتي اختيار السفن المستقلتين، راجع المجتمعات المؤهلة من المصادر، ثم انشر إصدارًا واحدًا يستخدمه SI-C01 عند تشغيله لاحقًا.')}}</p>
    <div class="rule-info"><strong>{{copy('Policy to be sent to AI SI-C01','السياسة التي سترسل إلى وكيل SI-C01')}}</strong>
      <p>PSC + Risk {{selectionRules.pscRiskRatePercent}}% · UAE Flag B {{selectionRules.uaeFlagRatePercent}}% · {{copy('Confidence','الحد الأدنى للثقة')}} {{aiRules.minimumSelectionConfidence}}</p>
      <small>{{copy('Published PSC Port Call quotas remain a separate first-stage source gate. Selection is a proposed shortlist only, never an inspection authorization.',
      'حصة أحداث PSC المنشورة مرحلة مصدر مستقلة أولاً. اختيار AI مسودة ترشيح فقط وليس تصريح معاينة.')}}</small>
    </div>
    <button class="primary" type="button" (click)="preview()" [disabled]="busy||loading||!dashboard">{{copy('Preview Configured Policy Impact (No AI)','معاينة تأثير السياسة المنشورة (بدون AI)')}}</button>
    <section class="impact" *ngIf="impact as p">
     <strong>{{copy('Business policy impact — NO AI calls','معاينة أثر سياسة الأعمال — دون استدعاءات AI')}}</strong>
     <p>{{p.evaluatedPopulation}} {{copy('tracked vessels','سفينة مسجلة')}} ·
        {{p.potentialRankingCandidates||0}} {{copy('candidates may require reranking','قد تحتاج إعادة ترتيب')}}</p>
     <small>{{copy('Unverified ETD and incident severity are not scored. Preview is not approval.',
      'لا تُحسب مواعيد المغادرة أو الحوادث غير الموثقة؛ هذه المعاينة ليست اعتمادًا.')}}</small>
    </section>
    <div class="publication">
     <h3>{{copy('Controlled Publication','النشر المعتمد')}}</h3>
     <label>{{copy('Business justification (min. 8 characters)','مبرر إداري (٨ أحرف على الأقل)')}}
       <textarea [(ngModel)]="reason" rows="2" maxlength="500"></textarea></label>
     <button class="primary" type="button" [disabled]="busy||!impact||!impact.aiSettingsChanged" (click)="publish()">
       {{copy('Publish New Inspection Selection Policy Version','نشر إصدار سياسة اختيار السفن')}}</button>
    </div>

   
    <section *ngIf="impact?.selectionImpact as si" class="selection-impact">
      <h3>{{copy('Selection pool B · deterministic impact','تأثير نسب الاختيار على المجموعة B')}}</h3>
      <div class="selection-impact-grid">
        <div><small>{{copy('Eligible distinct IMO','السفن المؤهلة')}}</small><strong>{{si.candidatePoolImos}}</strong></div>
        <div><small>{{copy('PSC eligible','سفن PSC المؤهلة')}}</small><strong>{{si.pscEligibleImos}}</strong></div>
        <div><small>{{copy('PSC selection cap','سقف اختيار PSC')}}</small><strong>{{si.pscTargetImos}}</strong></div>
        <div><small>{{copy('UAE-flag eligible','سفن العلم الإماراتي المؤهلة')}}</small><strong>{{si.uaeEligibleImos}}</strong></div>
        <div><small>{{copy('UAE selection cap','سقف اختيار الإمارات')}}</small><strong>{{si.uaeTargetImos}}</strong></div>
        <div><small>{{copy('Mandatory referrals & services','الإحالات والخدمات الملزمة')}}</small><strong>{{si.mandatoryImos}}</strong></div>
      </div>
      <p class="helper">{{copy('Targets are caps, NOT an AI result. Publish and explicitly run SI-C01 in Candidate Center to receive named vessels, reasons, evidence references, confidence, missing data and quota exclusions. Supervisor approval remains separate.',
        'الأرقام حدود اختيار وليست نتيجة AI. انشر الإعدادات وشغل SI-C01 صراحةً من Candidate Center للحصول على السفن والأسباب والأدلة والثقة والنواقص والاستبعادات، مع استمرار الاعتماد البشري.')}}</p>
    </section>
    <a routerLink="/moei/smart-inspection/candidates" class="policy-link">{{copy('Candidate Center · Run AI Selection →','قائمة المرشحين · تشغيل اختيار AI ←')}}</a>
   </section>
  </main>
 </div>
 `,
 styles:[`
 :host{display:block;background:#eef4f7;min-height:calc(100vh - 82px);color:#1e4156}
 .si-layout{display:flex;min-height:calc(100vh - 82px)}
 .settings-main{flex:1;min-width:0;max-width:1440px;margin:auto;padding:26px 30px 48px}
 .heading{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;border-bottom:1px solid #d8e6ed;padding-bottom:22px}
 .heading small{font-size:11px;color:#08756d;font-weight:800}
 .heading h1{color:#153951;font-size:25px;margin:9px 0}
 .heading p,.panel p{font-size:12px;color:#5d7c8b;line-height:1.75}
 .actions{display:flex;gap:9px;align-items:center}
 .actions a,.actions button,.policy-tabs button{padding:10px 14px;border:1px solid #c7dfe5;border-radius:9px;background:white;color:#156374;font-size:12px;font-weight:750;text-decoration:none;cursor:pointer}
 .stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;margin:19px 0}
 .stats article,.panel{background:white;border:1px solid #d7e7ee;border-radius:13px;padding:22px;box-shadow:0 4px 15px #173b500b}
 .stats small{display:block;font-size:10px;color:#628092;font-weight:800}
 .stats strong{display:block;font-size:27px;margin-top:8px;color:#09697b}
 .policy-tabs{display:flex;gap:10px;margin:16px 0;flex-wrap:wrap}
 .policy-tabs button.active{background:#087c76;color:white;border-color:#087c76}
 .selection-percents,.selection-impact-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin:14px 0}
 .selection-percents label{background:#f5fafb;border:1px solid #d4e6ed;border-radius:10px;padding:12px}
 .selection-percents input{width:95px;margin:8px 5px;padding:10px;border:1px solid #c6dbe3;border-radius:8px}
 .si-selection-config{margin-top:18px;padding:15px;border:1px solid #d5e6eb;border-radius:12px}
 .selection-impact-grid{grid-template-columns:repeat(3,minmax(0,1fr))}
 .selection-impact-grid div{background:#f2f9fb;border:1px solid #d9eaed;padding:14px;border-radius:9px}
 .selection-impact-grid small{display:block;color:#587d8c;font-size:11px}
 .selection-impact-grid strong{font-size:24px;color:#006f75}
 @media(max-width:740px){.selection-percents,.selection-impact-grid{grid-template-columns:1fr}}
 .panel h2{font-size:18px;color:#14516c;margin:0 0 12px}
 .panel h3{font-size:15px;color:#16516b}
 .rule{display:grid;grid-template-columns:44px minmax(0,1fr) auto;gap:17px;align-items:center;border-bottom:1px solid #e2edf0;padding:18px 4px}
 .rule strong{font-size:14px;display:block;color:#19445d}
 .rule small{font-size:11px;display:block;color:#688394;line-height:1.6;margin-top:7px;max-width:760px}
 .position{width:40px;height:40px;display:grid;place-items:center;border-radius:11px;background:#e8f7f4;color:#08756d;font-size:19px;font-weight:800}
 .status{font-size:11px;color:#0d6d6a;font-weight:800;white-space:nowrap}
 .policy-link{font-size:11px;color:#08777f;text-decoration:underline}
 .pending{background:#fafbfc}.pending .position{background:#f2f4f5;color:#8a969a}
 .helper{padding:13px 15px;background:#f2f8fa;border-radius:9px;margin:18px 0}
 .policy-rule-editor{padding:12px 2px;border-top:1px solid #e2edf0}
 .signal-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:15px 0}
 .signal-switch{display:flex;align-items:flex-start;gap:10px;border:1px solid #d6e8eb;border-radius:9px;padding:12px;background:#f8fcfc;margin:0}
 .signal-switch input{width:17px;height:17px;flex:none;margin-top:3px}
 .signal-switch strong{font-size:12px;color:#14536a}
 .signal-switch small{display:block;color:#698493;font-size:11px;font-weight:400;margin-top:5px}
 .policy-rule-editor input[type=number]{display:block;width:110px;padding:10px;border:1px solid #cfdfe6;border-radius:8px;margin-top:7px}
 .rule-info{border-radius:8px;border:1px solid #d8e8ed;background:#f2f9fa;padding:11px 13px}
 @media(max-width:760px){.signal-grid{grid-template-columns:1fr}}
 .primary{background:#087d84;color:#fff;border:0;border-radius:8px;padding:12px 15px;font-weight:800;cursor:pointer;margin-top:12px}
 button:disabled{opacity:.5;cursor:not-allowed}
 .publication{border-top:1px solid #dfebee;margin-top:20px;padding-top:15px}
 label{display:block;margin-top:14px;font-size:12px;font-weight:700;color:#365c6c}
 textarea{display:block;box-sizing:border-box;width:100%;border:1px solid #cfdfe6;border-radius:9px;padding:10px;margin-top:7px;color:#193c50}
 .notice,.impact{padding:12px 15px;background:#e6f2f8;border-radius:9px;margin:16px 0}
 .error{background:#fff0ed;color:#a83131}.success{background:#e3f7e9;color:#186c43}
 .impact{background:#edf8f5;color:#155e57}.impact strong{font-size:12px}
 @media(max-width:900px){.si-layout{display:block}.settings-main{padding:16px}.heading{flex-direction:column}.rule{grid-template-columns:40px 1fr}.rule .status,.rule .policy-link{grid-column:2}.stats{grid-template-columns:1fr}}
 `]
})
export class SiTargetingSettingsComponent implements OnInit{
 tab:'ENTRY'|'RANKING'|'AI_RULES'|'PUBLISH'='ENTRY';
 selectionRules:SiSelectionRules={
   pscRiskRatePercent:15,uaeFlagRatePercent:0,
   uaePoolMode:'ELIGIBLE_CANDIDATES_ONLY',
   pscPoolMode:'PUBLISHED_PSC_SHORTLIST_ONLY',
   aiSelectionMode:'RECOMMEND_WITHIN_ELIGIBLE_QUOTAS'
 };
 readonly signals:{code:SiC01Signal;en:string;ar:string;detailEn:string;detailAr:string}[]=[
  {code:'SOURCE_EVENT_EVIDENCE',en:'Verified source events & evidence',ar:'أحداث المصادر والأدلة الموثقة',
   detailEn:'Source documents, referral IDs, stored PSC/service events',detailAr:'مستندات المصدر والإحالات وأحداث PSC والخدمات المحفوظة'},
  {code:'VERIFIED_ETD',en:'Verified vessel departure (ETD)',ar:'موعد مغادرة السفينة المؤكد ETD',
   detailEn:'Departure evidence; never substitute ETA',detailAr:'أدلة المغادرة دون الاستعاضة عنها بموعد الوصول'},
  {code:'REVIEWED_INCIDENT',en:'Human-reviewed incident severity',ar:'خطورة الحادث المعتمدة بشريًا',
   detailEn:'Active NMC incident-specific assessment',detailAr:'تقييم خاص بحادث نشط من NMC'},
  {code:'SAVED_VESSEL_RISK',en:'Saved vessel risk (advisory only)',ar:'مخاطر السفينة المحفوظة (استرشادي)',
   detailEn:'Use for selection context, never official execution order',detailAr:'سياق اختيار فقط، وليس ترتيب التنفيذ الرسمي'}
 ];
 aiRules:SiC01AdvisoryRules={
  selectionSignals:['SOURCE_EVENT_EVIDENCE','VERIFIED_ETD','REVIEWED_INCIDENT','SAVED_VESSEL_RISK'],
  minimumSelectionConfidence:0,selectionInstructions:'',priorityInstructions:''
 };
 toggleSignal(code:SiC01Signal,checked:boolean):void{
  const next=new Set(this.aiRules.selectionSignals);
  if(checked)next.add(code);else next.delete(code);
  this.aiRules.selectionSignals=[...next];this.rulesChanged();
 }
 rulesChanged():void{this.impact=null;this.success='';}

 dashboard:SiDashboard|null=null;impact:SiImpact|null=null;
 loading=false;busy=false;error='';success='';
 reviewer='admin';reason='';editorKey='MOEI_SESSION';publisherKey='MOEI_SESSION';
 constructor(private readonly api:SiCandidateTargetingService,public readonly lang:LanguageService){}
 copy(en:string,ar:string):string{return this.lang.pick(en,ar);}
 ngOnInit():void{this.refresh();}
 refresh():void{
  this.loading=true;this.error='';this.impact=null;
  this.api.dashboard().subscribe({
    next:d=>{
      this.dashboard=d;this.loading=false;
     this.selectionRules={...this.selectionRules,...d.policy.config.selection};
     const saved=d.policy.config.aiAdvisory;
      this.aiRules=saved?{
        selectionSignals:[...saved.selectionSignals],
        minimumSelectionConfidence:saved.minimumSelectionConfidence,
        selectionInstructions:saved.selectionInstructions,
        priorityInstructions:saved.priorityInstructions
      }:{
        selectionSignals:['SOURCE_EVENT_EVIDENCE','VERIFIED_ETD','REVIEWED_INCIDENT','SAVED_VESSEL_RISK'],
        minimumSelectionConfidence:0,selectionInstructions:'',priorityInstructions:''
      };
    },
    error:e=>{this.showError(e);this.loading=false;}
  });
 }
 private showError(e:unknown):void{
  const value=e as {error?:{error?:string}};
  this.error=value?.error?.error||this.copy('Unable to load/save policy','تعذر تحميل أو حفظ السياسة');
  this.busy=false;this.success='';
 }
 private validAiRules():boolean{
  if(!Number.isInteger(this.selectionRules.pscRiskRatePercent)||
     this.selectionRules.pscRiskRatePercent<0||this.selectionRules.pscRiskRatePercent>100||
     !Number.isInteger(this.selectionRules.uaeFlagRatePercent)||
     this.selectionRules.uaeFlagRatePercent<0||this.selectionRules.uaeFlagRatePercent>100){
    this.error=this.copy('Selection percentages must be integers between 0 and 100.',
      'نسب الاختيار يجب أن تكون أعدادًا صحيحة من صفر إلى ١٠٠.');return false;
  }
  const confidence=this.aiRules.minimumSelectionConfidence;
  if(!this.aiRules.selectionSignals.length||typeof confidence!=='number'||
    !Number.isFinite(confidence)||confidence<0||confidence>1||
    this.aiRules.selectionInstructions.length>600||
    this.aiRules.priorityInstructions.length>600){
    this.error=this.copy('Choose at least one signal, set confidence from 0 to 1, and keep each instruction within 600 characters.',
      'اختر إشارة واحدة على الأقل، واضبط الثقة بين صفر و١، ولا تتجاوز ٦٠٠ حرف في كل تعليمات.');return false;
  }
  return true;
 }
 private rankingConfig():SiTargetingPolicyConfig{
  return {ranking:{criteria:['DEPARTURE_SOON','INCIDENT_SEVERITY']},
   selection:{...this.selectionRules},
   aiAdvisory:{
      selectionSignals:[...this.aiRules.selectionSignals],
      minimumSelectionConfidence:this.aiRules.minimumSelectionConfidence,
      selectionInstructions:this.aiRules.selectionInstructions,
      priorityInstructions:this.aiRules.priorityInstructions
    }};
 }
 preview():void{
  if(!this.dashboard||this.busy)return;
  if(!this.validAiRules())return;
  this.busy=true;this.error='';this.success='';this.impact=null;
  this.api.preview(this.rankingConfig(),this.editorKey).subscribe({
   next:p=>{this.impact=p;this.busy=false;},error:e=>this.showError(e)
  });
 }
 publish():void{
  if(!this.dashboard||!this.impact||!this.impact.aiSettingsChanged||this.busy)return;
  if(!this.validAiRules())return;
  if(this.reason.trim().length<8){
   this.error=this.copy('Provide an 8-character business justification','أدخل مبررًا إداريًا لا يقل عن ٨ أحرف');return;
  }
  if(!window.confirm(this.copy('Publish the configured vessel selection rules and SI-C01 AI policy? Future explicit AI runs use the new version; approved plans remain immutable.',
   'نشر قواعد اختيار السفن وإعدادات SI-C01؟ سيتم تطبيقها على تشغيل AI الجديد دون تعديل الخطط المعتمدة.')))return;
  this.busy=true;this.error='';
  this.api.publish({config:this.rankingConfig(),expectedVersion:this.dashboard.policy.version,
    publishedBy:this.reviewer,reason:this.reason.trim()},this.publisherKey).subscribe({
   next:()=>{this.busy=false;this.reason='';this.refresh();this.success=
     this.copy('Published new inspection selection policy version','تم نشر إصدار جديد لقواعد اختيار السفن');},
   error:e=>this.showError(e)
  });
 }
}
