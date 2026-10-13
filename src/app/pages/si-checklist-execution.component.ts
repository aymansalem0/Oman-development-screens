import {CommonModule} from '@angular/common';
import {Component,OnInit,OnDestroy} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {ActivatedRoute,RouterLink} from '@angular/router';
import {NmcNavigationComponent} from '../components/nmc-navigation.component';
import {LanguageService} from '../services/language.service';
import {MoeiAuthService} from '../services/moei-auth.service';
import {SiChecklistsService,ChecklistPreview,ChecklistExecution,
 CheckField,ChecklistInstanceTemplate,ChecklistInstanceGroup,
 ChecklistInstanceItem,ChecklistProposal,AiLevel
} from '../services/si-checklists.service';

type AnswerValues=Partial<Record<CheckField,any>>;
interface ReviewScope{level:AiLevel;templateId:string;groupId?:string;itemId?:string;label:string;}
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

   <section class="assistant" *ngIf="currentAi as target">
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
    <button class="ai-submit" (click)="askAiria()" [disabled]="busy||(!aiText.trim()&&!imagePayload)||!auth.isAdmin">
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
 aiStatus:{visionConfigured:boolean}|null=null;
 loading=false;busy=false;error='';message='';
 answers:Record<string,AnswerValues>={};currentAi:ReviewScope|null=null;
 aiText='';fileName='';imagePayload:{mimeType:string;base64:string}|null=null;
 proposal:ChecklistProposal|null=null;reviewEdits:Record<string,string>={};
 private sub:any;
 constructor(private route:ActivatedRoute,private api:SiChecklistsService,
  public lang:LanguageService,public auth:MoeiAuthService){}
 t(en:string,ar:string){return this.lang.pick(en,ar);}
 ngOnInit():void{
  this.sub=this.route.paramMap.subscribe(p=>{
   this.caseId=p.get('caseId')||'';this.reload();
  });
  this.api.aiStatus().subscribe({next:r=>this.aiStatus=r,error:()=>this.aiStatus=null});
 }
 ngOnDestroy():void{this.sub?.unsubscribe();}
 reload():void{
  if(!this.caseId)return;this.loading=true;this.error='';
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
 labelFor(id:string):string{return this.allItems().find(i=>i.instanceId===id)?.title||id;}
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
 openAi(level:AiLevel,template:ChecklistInstanceTemplate,
  group?:ChecklistInstanceGroup,item?:ChecklistInstanceItem):void{
  this.currentAi={level,templateId:template.templateId,groupId:group?.instanceId,
   itemId:item?.instanceId,label:item?.title||group?.title||template.title};
  this.proposal=null;this.reviewEdits={};this.error='';
 }
 closeAi():void{this.currentAi=null;this.proposal=null;this.imagePayload=null;
  this.aiText='';this.fileName='';this.reviewEdits={};}
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
  if(!this.currentAi||(!this.aiText.trim()&&!this.imagePayload)||this.busy)return;
  if(!window.confirm(this.t('Send selected image/text to the configured Airia pipeline? This may incur an AI usage charge.',
   'هل توافق على إرسال الصورة/النص المختار إلى Airia؟ قد يتم احتساب تكلفة AI.')))return;
  this.busy=true;this.error='';
  this.api.aiSuggest(this.caseId,{level:this.currentAi.level,
   templateId:this.currentAi.templateId,groupId:this.currentAi.groupId,
   itemId:this.currentAi.itemId,text:this.aiText.trim(),
   image:this.imagePayload||undefined,confirmCost:true})
   .subscribe({next:r=>{this.busy=false;this.proposal=r.proposal;
    this.reload();
    this.reviewEdits={};
    for(const suggestion of r.proposal.recommendations)
     this.reviewEdits[suggestion.itemId]=JSON.stringify(suggestion.proposedAnswers,null,2);},
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
  this.api.review(this.caseId,{expectedVersion:this.execution.version,
   proposalId:this.proposal.id,itemId,decision,editedAnswers,
   reviewNote:decision==='EDIT'?'Inspector edited model recommendation':''})
   .subscribe({next:e=>{
    this.execution=e;this.busy=false;this.copyAnswers();
    const saved=e.proposals.find(x=>x.id===this.proposal?.id);
    if(saved)this.proposal=saved;
    this.message=this.t('Inspector decision saved and audited.','تم تسجيل قرار المفتش وتدقيقه.');
   },error:e=>this.fail(e)});
 }
 fail(e:any):void{
  this.loading=false;this.busy=false;
  this.error=e?.error?.error||this.t('Unable to load or save inspection checklist.',
    'تعذر تحميل أو حفظ قائمة المعاينة.');
 }
}
