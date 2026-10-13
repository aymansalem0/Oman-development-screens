import {CommonModule} from '@angular/common';
import {Component,OnInit} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {RouterLink} from '@angular/router';
import {NmcNavigationComponent} from '../components/nmc-navigation.component';
import {LanguageService} from '../services/language.service';
import {MoeiAuthService} from '../services/moei-auth.service';
import {
 SiChecklistsService,ChecklistDraft,ChecklistGroup,ChecklistItem,ChecklistTemplate,
 ChecklistSummary,CheckField,AiLevel,ChecklistBuilderReply
} from '../services/si-checklists.service';

@Component({
 selector:'app-si-checklist-settings',standalone:true,
 imports:[CommonModule,FormsModule,RouterLink,NmcNavigationComponent],
 template:`
 <div class="layout" [attr.dir]="lang.dir">
 <app-nmc-navigation></app-nmc-navigation>
 <main class="body">
  <header class="hero"><div>
    <p class="eyebrow">MOEI · SMART INSPECTION · CONFIGURATION</p>
    <h1>{{t('Dynamic Inspection Checklists','إعدادات قوائم المعاينة الديناميكية')}}</h1>
    <p>{{t('Define multiple mandatory checklists by vessel type, GT, DWT and referral scope. Each group can include many questions and answer types.',
     'صمّم أكثر من قائمة معاينة إلزامية طبقًا لنوع السفينة وحمولتها ونطاق إحالتها، مع مجموعات وبنود متعددة الأنواع.')}}</p>
   </div>
   <a routerLink="/moei/smart-inspection/candidates">{{t('Back to Smart Inspection','العودة للمعاينة الذكية')}}</a>
  </header>
  <p class="banner warning">{{t('Configuration is not official statutory certification. Publish only after responsible maritime SME review; existing published revisions remain immutable.',
   'هذه الإعدادات لا تمثل اعتمادًا نظاميًا رسميًا. لا تنشر قبل مراجعة المختص البحري، وتبقى النسخ المنشورة السابقة محفوظة.')}}
  </p>
  <p class="banner error" *ngIf="error" role="alert">{{error}}</p>
  <p class="banner good" *ngIf="message">{{message}}</p>

  <div class="columns">
   <aside class="catalog">
    <div class="titlebar"><h2>{{t('Checklist Catalog','مكتبة قوائم الفحص')}}</h2>
     <button (click)="create()" [disabled]="busy||!auth.isAdmin">+ {{t('New','جديد')}}</button></div>
    <p *ngIf="!templates.length">{{t('No configured templates. Start with New.','لا توجد قوائم مخصصة. ابدأ بإنشاء قائمة جديدة.')}}</p>
    <button class="catalog-item" *ngFor="let item of templates"
      [class.selected]="selected?.id===item.id" (click)="open(item.id)" [disabled]="busy">
      <strong>{{item.title}}</strong>
      <span>{{item.groupCount}} {{t('groups','مجموعات')}} · {{item.itemCount}} {{t('items','بنود')}}</span>
      <small>{{item.published?'PUBLISHED v'+item.revision:'DRAFT'}}</small>
    </button>
   </aside>
   <section class="editor">
    <ng-container *ngIf="selected as template;else empty">
     <div class="editor-head"><div>
      <p class="eyebrow">{{t('TEMPLATE EDITOR','محرر قائمة الفحص')}}</p>
      <h2>{{template.draft.title||t('New Checklist','قائمة جديدة')}}</h2>
      <p>{{t('Draft editable · published revision','المسودة قابلة للتعديل · الإصدار المنشور')}}
       <strong>v{{template.revision}}</strong></p>
     </div><div class="actions">
      <button class="secondary" type="button" (click)="save()" [disabled]="busy||!auth.isAdmin">
        {{t('Save Draft','حفظ المسودة')}}</button>
      <button type="button" (click)="publish()" [disabled]="busy||!auth.isAdmin">
        {{t('Publish New Revision','نشر إصدار جديد')}}</button>
     </div></div>
     <div class="grid2">
      <label>{{t('Checklist Name','اسم القائمة')}}*
       <input [(ngModel)]="template.draft.title" maxlength="160"/></label>
      <label>{{t('Vessel Types (multiple, comma-separated)','أنواع السفن (متعددة، تفصل بفاصلة)')}}
       <input [ngModel]="template.draft.applicability.vesselTypes.join(', ')"
        (ngModelChange)="csv('vesselTypes',$event)"
        placeholder="Tanker, Passenger, Offshore"/></label>
      <label>{{t('Min GT / Max GT','الحمولة الإجمالية GT من / إلى')}}
       <div class="row"><input type="number" min="0" [(ngModel)]="template.draft.applicability.minGT" placeholder="Min GT"/>
        <input type="number" min="0" [(ngModel)]="template.draft.applicability.maxGT" placeholder="Max GT"/></div></label>
      <label>{{t('Min DWT / Max DWT','الحمولة الساكنة DWT من / إلى')}}
       <div class="row"><input type="number" min="0" [(ngModel)]="template.draft.applicability.minDWT" placeholder="Min DWT"/>
        <input type="number" min="0" [(ngModel)]="template.draft.applicability.maxDWT" placeholder="Max DWT"/></div></label>
      <label>{{t('Applicable Inspection Regimes','أنواع المعاينة المنطبقة')}}
       <input [ngModel]="template.draft.applicability.inspectionRegimes.join(', ')"
        (ngModelChange)="csv('inspectionRegimes',$event)"
        placeholder="FOCUSED_INSPECTION, UAE_SERVICE_INSPECTION"/></label>
      <label>{{t('Source Reasons','مصادر الإحالة')}}
       <select multiple [(ngModel)]="template.draft.applicability.sourceTypes" size="3">
        <option value="NMC_CASE">NMC Referral</option>
        <option value="PSC_PORT_CALL">PSC Port Call</option>
        <option value="SERVICE_REQUEST">Service Request</option>
       </select></label>
     </div>
     <p class="hint">{{t('Empty type, tonnage or source conditions mean ANY. If a constrained GT/DWT is unknown, the checklist is flagged for review rather than silently assumed to match.',
      'ترك شرط فارغ يعني كل القيم. إذا كانت الحمولة مطلوبة وغير معروفة، تظهر الحالة للمراجعة بدلاً من افتراض انطباق القائمة.')}}</p>
     <label class="inline"><input type="checkbox" [(ngModel)]="template.draft.mandatory"/>
      {{t('Configured as mandatory (requires formal policy verification)','مُعرّفة كإلزامية (تحتاج تحققًا من السياسة الرسمية)')}}</label>
     <label>{{t('Description / official references','وصف القائمة / المراجع المعتمدة')}}
      <textarea rows="2" [(ngModel)]="template.draft.description"></textarea></label>

     <div class="ai-config">
      <div class="titlebar"><h3>{{t('AI Assistant · Template Level','مساعد AI · مستوى القائمة')}}</h3>
       <button type="button" class="violet" (click)="ask('TEMPLATE')"
        [disabled]="busy||!aiStatus?.builderConfigured||!auth.isAdmin">
        ✦ {{t('Suggest Checklist with Airia','اقتراح قائمة بواسطة Airia')}}</button></div>
      <label class="inline"><input type="checkbox" [(ngModel)]="template.draft.ai.enabled"/>
       {{t('Allow AI assistant for this checklist','تفعيل مساعد AI لهذه القائمة')}}</label>
      <textarea rows="2" [(ngModel)]="template.draft.ai.instructions"
       [placeholder]="t('AI instructions / approved references','تعليمات AI والمراجع المعتمدة')"></textarea>
     </div>

     <section class="groups">
      <div class="titlebar"><h3>{{t('Checklist Groups','مجموعات القائمة')}}</h3>
       <button type="button" class="secondary" (click)="addGroup()" [disabled]="!auth.isAdmin">
        + {{t('Add Group','إضافة مجموعة')}}</button></div>
      <article class="group" *ngFor="let group of template.draft.groups;let gi=index">
       <header><span class="group-number">{{gi+1}}</span>
        <input [(ngModel)]="group.title" maxlength="180" [attr.aria-label]="t('Group title','اسم المجموعة')"/>
        <button class="violet" (click)="ask('GROUP',group.id)" [disabled]="!aiStatus?.builderConfigured||busy||!auth.isAdmin">
         ✦ {{t('AI Group','مساعد المجموعة')}}</button>
        <button class="danger" (click)="removeGroup(gi)" [disabled]="!auth.isAdmin">{{t('Remove','حذف')}}</button>
       </header>
       <label class="inline"><input type="checkbox" [(ngModel)]="group.ai.enabled"/>
        {{t('AI Assistant on this group','مساعد AI لهذه المجموعة')}}</label>
       <textarea rows="1" [(ngModel)]="group.ai.instructions"
        [placeholder]="t('Group AI instructions','تعليمات مساعد المجموعة')"></textarea>
       <div class="item" *ngFor="let item of group.items;let ii=index">
        <div class="item-title"><strong>{{ii+1}}.</strong>
         <input [(ngModel)]="item.title" maxlength="200" [attr.aria-label]="t('Question','نص البند')"
          placeholder="Question / Inspection requirement"/>
         <button class="violet" (click)="ask('ITEM',group.id,item.id)"
          [disabled]="!aiStatus?.builderConfigured||busy||!auth.isAdmin">✦ AI</button>
         <button class="danger" (click)="removeItem(group,ii)" [disabled]="!auth.isAdmin">×</button>
        </div>
        <label>{{t('Item instructions','شرح البند')}}<input [(ngModel)]="item.description"/></label>
        <div class="type-grid">
         <span>{{t('Answer fields · select more than one','حقول الإجابة · يمكن اختيار أكثر من نوع')}}</span>
         <label *ngFor="let f of fieldTypes"><input type="checkbox"
          [checked]="item.fields.includes(f)" (change)="toggleField(item,f,$any($event.target).checked)"/>
          {{fieldLabel(f)}}</label>
        </div>
        <div class="type-grid">
         <span>{{t('Required answer fields · only checked types must be answered',
           'حقول الإجابة المطلوبة · الأنواع المختارة فقط إجبارية')}}</span>
         <label *ngFor="let f of item.fields">
          <input type="checkbox" [checked]="item.requiredFields.includes(f)"
           (change)="toggleRequired(item,f,$any($event.target).checked)"/>
          {{fieldLabel(f)}}
         </label>
        </div>
        <div class="row wraps">
         <label class="inline"><input type="checkbox" [(ngModel)]="item.mandatory"/>
          {{t('Required','إلزامي')}}</label>
         <label class="inline"><input type="checkbox" [(ngModel)]="item.ai.enabled"/>
          {{t('AI enabled on item','تفعيل مساعد AI للبند')}}</label>
        </div>
        <input [(ngModel)]="item.ai.instructions"
         [placeholder]="t('AI-specific guidance for this item','تعليمات AI الخاصة بهذا البند')"/>
       </div>
       <button class="secondary" type="button" (click)="addItem(group)" [disabled]="!auth.isAdmin">
        + {{t('Add Question','إضافة بند')}}</button>
      </article>
     </section>

     <section class="ai-suggest" *ngIf="suggestion as suggest">
      <h3>✦ {{t('Airia Draft Recommendation — review before applying','اقتراح Airia — راجعه قبل إضافته')}}</h3>
      <p>{{suggest.rationale||t('Suggestions require maritime expert review.','الاقتراحات تحتاج مراجعة مختص بحري.')}}</p>
      <pre>{{suggest|json}}</pre>
      <div class="actions">
       <button type="button" (click)="applySuggestion()" [disabled]="busy">{{t('Add as Editable Draft','إضافة كمسودة قابلة للتعديل')}}</button>
       <button type="button" class="secondary" (click)="suggestion=null">{{t('Reject AI Suggestion','رفض الاقتراح')}}</button>
      </div>
      <small>{{t('No AI suggestion automatically becomes mandatory or published.',
       'لا يتم نشر أي اقتراح أو اعتباره إلزاميًا بصورة تلقائية.')}}</small>
     </section>
     <div class="bottom-save"><button (click)="save()" [disabled]="busy||!auth.isAdmin">
      {{t('Save Checklist Draft','حفظ مسودة القائمة')}}</button></div>
    </ng-container>
    <ng-template #empty><div class="empty">
     <h2>{{t('Choose a checklist or create a new one','اختر قائمة أو أنشئ قائمة جديدة')}}</h2>
     <p>{{t('Templates can be combined for each vessel according to type, tonnage and inspection triggers.',
      'يمكن جمع عدة قوائم لنفس السفينة طبقًا لنوعها وحمولتها وأسباب الإحالة.')}}</p>
    </div></ng-template>
   </section>
  </div>
 </main>
 </div>
 `,
 styles:[`
 :host{display:block;background:#eff5f7;min-height:100vh;color:#173e53}
 .body{margin-inline-start:264px;padding:30px;max-width:1730px}
 .hero{display:flex;justify-content:space-between;gap:20px;margin-bottom:20px;align-items:center}
 .hero h1{font-size:28px;margin:0 0 8px}.hero p{color:#657f8d;font-size:12px;line-height:1.75}
 .hero a{color:#067d77;font-size:12px;font-weight:700}
 .eyebrow{letter-spacing:1.3px;color:#05897d;font-size:10px;font-weight:900}
 .banner{padding:13px 16px;border-radius:9px;margin-bottom:15px;font-size:12px;line-height:1.65}
 .banner.warning{background:#fff3de;color:#7f5a24}
 .banner.error{background:#ffebe5;color:#a74b32}.banner.good{background:#dcf5e8;color:#126c50}
 .columns{display:grid;grid-template-columns:260px minmax(0,1fr);gap:17px}
 .catalog,.editor{background:#fff;border:1px solid #d9e8ea;border-radius:13px;padding:19px;min-width:0}
 .catalog{align-self:start}.catalog h2{font-size:15px}.titlebar{display:flex;justify-content:space-between;align-items:center;gap:15px;margin-bottom:13px}
 .titlebar h3{font-size:16px;margin:0}.catalog-item{width:100%;background:#fff;color:#173a53;border:1px solid #e2ebef;
  text-align:start;margin:7px 0;display:grid;gap:7px}
 .catalog-item.selected{border-color:#02a19b;background:#e8f8f4}
 .catalog-item span,.catalog-item small{font-size:10px;color:#779099}
 .editor-head{display:flex;justify-content:space-between;align-items:center;gap:13px;margin-bottom:17px}
 .editor-head h2{margin:0;font-size:21px}.editor-head p{font-size:11px}
 button{background:#087c75;color:#fff;border:0;padding:10px 13px;border-radius:8px;font-size:11px;font-weight:800;cursor:pointer}
 button:disabled{opacity:.5;cursor:not-allowed}.secondary{background:#e9f5f3;color:#0a7770}
 .danger{background:#fff0eb;color:#b25245}.violet{background:#ecedff;color:#5b48b7}
 .actions{display:flex;gap:8px;flex-wrap:wrap}
 .grid2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}
 label{display:grid;gap:6px;color:#466c7b;font-size:12px;font-weight:650}
 input:not([type=checkbox]),textarea,select{border:1px solid #c6d9dd;border-radius:8px;
  width:100%;padding:10px;font:inherit;color:#173c52;background:#fff}
 select[multiple]{min-height:85px}.row{display:flex;gap:9px}.wraps{flex-wrap:wrap}
 .inline{display:flex;align-items:center;gap:7px;color:#365f70;font-size:12px;margin:10px 0}
 input[type=checkbox]{accent-color:#087e74;width:15px;height:15px}
 .hint{font-size:11px;color:#68818a;line-height:1.8}
 .ai-config{background:#f0f7f9;padding:15px;border-radius:10px;margin:20px 0}
 .groups{margin-top:20px}.group{border:1px solid #d9e8e9;border-radius:10px;
  background:#fbfdfd;padding:16px;margin:14px 0}
 .group header,.item-title{display:flex;align-items:center;gap:9px}
 .group-number{color:#188579;font-weight:900}
 .item{background:#fff;padding:12px;border-radius:9px;border:1px solid #e3edef;margin:11px 0}
 .item-title input,.group header input{flex:1}
 .type-grid{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:12px 0}
 .type-grid span{width:100%;font-weight:700;font-size:11px;color:#385e6b}
 .type-grid label{display:flex;gap:5px;align-items:center;font-size:11px}
 .ai-suggest{background:#f8f5ff;border:1px solid #ccc4ec;padding:16px;border-radius:10px;margin:24px 0}
 .ai-suggest pre{max-height:275px;overflow:auto;background:#fff;padding:13px;
  border:1px solid #e3dafa;white-space:pre-wrap;overflow-wrap:anywhere;font-size:11px}
 .ai-suggest small{display:block;color:#6b6582;margin-top:10px;font-size:10px}
 .empty{text-align:center;padding:70px 20px;color:#708a91}
 .bottom-save{text-align:end;margin-top:19px}
 @media(max-width:1150px){.body{margin-inline-start:0;padding:20px}}
 @media(max-width:850px){.columns,.grid2{grid-template-columns:1fr}.editor-head,.hero{display:block}
  .actions{margin-top:13px}}
 `]
})
export class SiChecklistSettingsComponent implements OnInit{
 templates:ChecklistSummary[]=[];selected:ChecklistTemplate|null=null;
 busy=false;error='';message='';aiStatus:{builderConfigured:boolean;visionConfigured:boolean}|null=null;
 suggestion:ChecklistBuilderReply|null=null;
 private savedDraftJson='';
 private scope:{level:AiLevel;groupId?:string;itemId?:string}|null=null;
 readonly fieldTypes:CheckField[]=['BOOLEAN','NOTE','EXPIRY_DATE','DATE','TEXT','NUMBER'];
 constructor(private api:SiChecklistsService,public lang:LanguageService,
  public auth:MoeiAuthService){}
 t(en:string,ar:string):string{return this.lang.pick(en,ar);}
 ngOnInit():void{this.load();this.api.aiStatus().subscribe({
  next:status=>this.aiStatus=status,error:()=>this.aiStatus=null});}
 fieldLabel(f:CheckField):string{
  const labels:Record<CheckField,[string,string]>={
   BOOLEAN:['Yes / No / N/A','نعم / لا / لا ينطبق'],
   NOTE:['Observation','ملاحظة'],EXPIRY_DATE:['Expiry date','تاريخ انتهاء'],
   DATE:['Date','تاريخ'],TEXT:['Text','نص'],NUMBER:['Number','رقم']};
  return this.t(...labels[f]);
 }
 freshAi(){return {enabled:false,instructions:'',requiresHumanReview:true};}
 freshItem(title=''):ChecklistItem{
  return {id:crypto.randomUUID(),title,description:'',fields:['BOOLEAN','NOTE'],
    requiredFields:['BOOLEAN'],mandatory:true,order:0,options:[],ai:this.freshAi(),sourceReferences:[]};
 }
 freshGroup(title=''):ChecklistGroup{
  return {id:crypto.randomUUID(),title,description:'',order:0,
    ai:this.freshAi(),items:[this.freshItem()]};
 }
 freshDraft():ChecklistDraft{
  return {title:'',description:'',mandatory:true,
   applicability:{vesselTypes:[],inspectionRegimes:[],sourceTypes:[],
    minGT:null,maxGT:null,minDWT:null,maxDWT:null},
   ai:this.freshAi(),groups:[]};
 }
 load():void{this.api.list().subscribe({
  next:r=>this.templates=r.templates,error:e=>this.failed(e)});
 }
 create():void{
  if(this.busy)return;this.error='';this.message='';this.suggestion=null;
  this.savedDraftJson='';this.selected={id:'',draft:this.freshDraft(),revision:0,published:[],
   updatedAt:'',updatedBy:'',createdAt:'',createdBy:''};
 }
 open(id:string):void{this.busy=true;this.error='';this.suggestion=null;
  this.api.detail(id).subscribe({next:r=>{this.selected=r;this.savedDraftJson=JSON.stringify(r.draft);this.busy=false;},
   error:e=>this.failed(e)});}
 csv(key:'vesselTypes'|'inspectionRegimes',value:string):void{
  if(this.selected)this.selected.draft.applicability[key]=value.split(',')
   .map(x=>x.trim()).filter(Boolean);
 }
 toggleField(item:ChecklistItem,f:CheckField,on:boolean):void{
  item.fields=on?[...new Set([...item.fields,f])]:item.fields.filter(x=>x!==f);
  if(!on)item.requiredFields=item.requiredFields.filter(x=>x!==f);
 }
 toggleRequired(item:ChecklistItem,f:CheckField,on:boolean):void{
  item.requiredFields=on?[...new Set([...item.requiredFields,f])]:
   item.requiredFields.filter(x=>x!==f);
 }
 addGroup():void{this.selected?.draft.groups.push(this.freshGroup());}
 addItem(group:ChecklistGroup):void{group.items.push(this.freshItem());}
 removeGroup(index:number):void{this.selected?.draft.groups.splice(index,1);}
 removeItem(group:ChecklistGroup,index:number):void{group.items.splice(index,1);}
 save():void{
  if(!this.selected||this.busy)return;
  if(!this.selected.draft.title.trim()){
   this.error=this.t('Checklist name is required.','اسم القائمة مطلوب.');return;
  }
  this.busy=true;this.error='';this.message='';
  const call=this.selected.id?this.api.save(this.selected):this.api.create(this.selected.draft);
  call.subscribe({next:t=>{this.selected=t;this.savedDraftJson=JSON.stringify(t.draft);this.busy=false;this.load();
    this.message=this.t('Draft saved.','تم حفظ المسودة.');},
    error:e=>this.failed(e)});
 }
 publish():void{
  if(!this.selected?.id||this.busy){
   this.error=this.t('Save the draft first.','احفظ المسودة أولاً.');return;
  }
  if(JSON.stringify(this.selected.draft)!==this.savedDraftJson){
    this.error=this.t('Save draft changes before publishing the new revision.',
      'احفظ تعديلات المسودة قبل نشر الإصدار الجديد.');return;
  }
  if(!window.confirm(this.t(
    'Publish this reviewed revision? It becomes selectable for matching vessels.',
    'هل تريد نشر الإصدار بعد المراجعة؟ سيصبح قابلًا للتطبيق على السفن المطابقة.')))return;
  this.busy=true;this.api.publish(this.selected).subscribe({
   next:t=>{this.selected=t;this.busy=false;this.load();
    this.message=this.t('Published revision v','تم نشر الإصدار v')+t.revision;},
   error:e=>this.failed(e)});
 }
 ask(level:AiLevel,groupId?:string,itemId?:string):void{
  if(!this.selected||this.busy)return;
  const prompt=window.prompt(this.t('Describe what Airia should suggest. Use only verified maritime references.',
    'اكتب ما تريد أن يقترحه Airia باستخدام المراجع البحرية المعتمدة فقط.'));
  if(!prompt?.trim())return;
  this.scope={level,groupId,itemId};this.busy=true;this.error='';this.suggestion=null;
  this.api.suggestTemplate({level,template:this.selected.draft,
   groupId,itemId,operatorPrompt:prompt,
   instructions:level==='TEMPLATE'?this.selected.draft.ai.instructions:
     this.selected.draft.groups.find(x=>x.id===groupId)?.ai.instructions||''})
   .subscribe({next:r=>{this.suggestion=r;this.busy=false;},
    error:e=>this.failed(e)});
 }
 applySuggestion():void{
  if(!this.selected||!this.suggestion||!this.scope)return;
  const groups=this.selected.draft.groups;
  const normalizeItem=(it:Partial<ChecklistItem>)=>{
   const fields=this.fieldTypes.filter(f=>(it.fields||[]).includes(f));
   return {...this.freshItem(String(it.title||'AI proposed check')),
     description:String(it.description||'').slice(0,1300),
     fields:fields.length?fields:['NOTE'] as CheckField[],
     requiredFields:[],mandatory:false};
  };
  for(const g of this.suggestion.suggestedGroups){
   const group=this.freshGroup(String(g.title||'AI Proposed Group'));
   group.items=(g.items||[]).map(normalizeItem);
   if(!group.items.length)group.items.push(normalizeItem({title:'Review proposal'}));
   groups.push(group);
  }
  const selectedGroup=groups.find(g=>g.id===this.scope?.groupId);
  for(const item of this.suggestion.suggestedItems){
   const target=selectedGroup||groups[0];
   if(target)target.items.push(normalizeItem(item));
   else groups.push({...this.freshGroup('AI Proposed Checks'),items:[normalizeItem(item)]});
  }
  this.suggestion=null;this.scope=null;
  this.message=this.t('Suggestions added as OPTIONAL draft items. Review and Save, then Publish manually.',
    'أضيفت الاقتراحات كبنود مسودة اختيارية. راجع واحفظ ثم انشر يدويًا.');
 }
 failed(e:any):void{
  this.busy=false;this.error=e?.error?.error||
   this.t('Request failed. Review input and backend settings.',
    'فشل الطلب؛ راجع البيانات وإعدادات الخادم.');
 }
}
