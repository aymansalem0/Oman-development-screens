import {CommonModule} from '@angular/common';
import {Component,OnInit} from '@angular/core';
import {HttpClient} from '@angular/common/http';
import {Router,RouterLink} from '@angular/router';
import {NmcNavigationComponent} from '../components/nmc-navigation.component';
import {LanguageService} from '../services/language.service';

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
   startLocal:string|null;status:string;liveErpBookingConfirmed:boolean}|null;
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
    <button type="button" (click)="load()" [disabled]="busy">{{t('Refresh Assignments','تحديث أوامر التكليف')}}</button>
    <a routerLink="/moei/smart-inspection/scheduling">{{t('Scheduling','الجدولة')}}</a>
   </div>
  </header>
  <p *ngIf="error" class="status danger" role="alert">{{error}}</p>
  <p *ngIf="message" class="status good" role="status">{{message}}</p>
  <section class="overview">
   <div><small>{{t('Assigned to me','مسندة إليّ')}}</small><strong>{{orders.length}}</strong></div>
   <div><small>{{t('Ready for execution','جاهزة للتنفيذ')}}</small><strong>{{statusCount('READY_FOR_FIELD')}}</strong></div>
   <div><small>{{t('Field in progress','قيد المعاينة')}}</small><strong>{{statusCount('FIELD_STARTED')}}</strong></div>
   <div><small>{{t('Awaiting preparation','بانتظار التجهيز')}}</small>
    <strong>{{orders.length-statusCount('READY_FOR_FIELD')-statusCount('FIELD_STARTED')}}</strong></div>
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
     (mouseenter)="select(o)" (focus)="select(o)"
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
     <div class="buttons">
      <button *ngIf="canActivate(o)" type="button" (click)="activate(o)"
       [disabled]="busy">{{t('Prepare Work Order & AI Dossier','تجهيز أمر التكليف ودوسيه AI')}}</button>
      <button *ngIf="o.status==='READY_FOR_FIELD'" type="button" (click)="execute(o)"
       [disabled]="busy">{{t('Execute Work Order','تنفيذ أمر التكليف')}}</button>
      <button *ngIf="o.status==='FIELD_STARTED'" type="button" (click)="continue(o)">
       {{t('Continue Guided Inspection','استكمال خطوات المعاينة')}}</button>
      <a *ngIf="o.status==='READY_FOR_SCOPE_REVIEW'"
       [routerLink]="['/moei/smart-inspection/scheduling/plan',o.planId]">
        {{t('Supervisor: Approve Scope','المشرف: اعتماد نطاق المعاينة')}}</a>
      <a *ngIf="o.caseId" [routerLink]="['/moei/smart-inspection/preparation',o.caseId]">
       {{t('Review A04 Dossier','مراجعة دوسيه A04')}}</a>
      <a *ngIf="o.caseId" [routerLink]="['/moei/smart-inspection/checklists',o.caseId]">
       {{t('Published Checklist Details','تفاصيل القائمة المنشورة')}}</a>
     </div>
     <p *ngIf="loadingDossier" class="status">{{t('Opening full vessel dossier…','جارٍ فتح ملف السفينة الكامل…')}}</p>
     <ng-container *ngIf="dossier as d">
      <div class="warning" *ngIf="!d.caseId">
       {{t('Source dossier before activation: no approved SI case, pinned checklist or AI A04 preparation has been created yet.',
         'دوسيه المصادر قبل تفعيل أمر التكليف: لم تُنشأ حالة المعاينة أو القائمة المثبتة أو تجهيز A04 حتى الآن.')}}</div>
      <div class="dossier-grid">
       <div class="fact"><small>{{t('Flag','العلم')}}</small><b>{{d.sections.identity.flag||'—'}}</b></div>
       <div class="fact"><small>{{t('Vessel Type','نوع السفينة')}}</small><b>{{d.sections.identity.vesselType||'—'}}</b></div>
       <div class="fact"><small>{{t('Saved NMC Risk','المخاطر المحفوظة')}}</small>
         <b>{{d.sections.risk?.score??'—'}} · {{d.sections.risk?.level||''}}</b></div>
       <div class="fact"><small>{{t('AI A04','ذكاء A04')}}</small>
         <b>{{d.sections.aiAnalysis.status}}</b></div>
      </div>
      <div class="evidence">
       <details open><summary>{{t('Inspection assignment and scope','التكليف ونطاق المعاينة')}}</summary>
        <p>{{o.assignment.inspectorName}} · {{o.assignment.portName}}</p>
        <pre>{{d.sections.assignments|json}}</pre></details>
       <details open><summary>{{t('Why this vessel was selected','أسباب اختيار السفينة للمعاينة')}}
        ({{d.sections.referrals.allSourceReasons.length}})</summary>
        <pre>{{d.sections.referrals|json}}</pre></details>
       <details><summary>{{t('Certificates and validity','الشهادات وصلاحيتها')}}
        ({{d.sections.sourceEvidence.certificates.length}})</summary>
        <pre>{{d.sections.sourceEvidence.certificates|json}}</pre></details>
       <details><summary>{{t('Historical inspections','المعاينات السابقة')}}
        ({{d.sections.sourceEvidence.inspectionHistory.length}})</summary>
        <pre>{{d.sections.sourceEvidence.inspectionHistory|json}}</pre></details>
       <details><summary>{{t('Open deficiencies / findings','الملاحظات السابقة المفتوحة')}}
        ({{d.sections.sourceEvidence.openDeficiencies.length}})</summary>
        <pre>{{d.sections.sourceEvidence.openDeficiencies|json}}</pre></details>
       <details><summary>{{t('Document manifest & evidence','المستندات ومراجع الأدلة')}}
        ({{d.sections.sourceEvidence.documents.length}})</summary>
        <pre>{{d.sections.sourceEvidence|json}}</pre></details>
       <details><summary>{{t('Saved vessel movement & tracking','حركة السفينة والتتبع')}}</summary>
        <pre>{{d.sections.sourceEvidence.tracking|json}}</pre></details>
       <details><summary>{{t('Main checklist and A04 suggested checks','القائمة الرئيسية ومقترحات A04')}}</summary>
        <p>{{t('Published checklist snapshot','لقطة القائمة المنشورة')}}:
          {{d.sections.inspectionChecklist.publishedTemplateSnapshotPresent?'✓':'—'}}</p>
        <pre>{{d.sections.inspectionChecklist|json}}</pre>
        <pre>{{d.sections.aiAnalysis.modelDraft|json}}</pre></details>
       <details *ngIf="d.missingEvidence.length"><summary>
        {{t('Missing / unverified source data','بيانات ناقصة أو غير موثقة')}}
        ({{d.missingEvidence.length}})</summary>
        <p>{{d.missingEvidence.join(' · ')}}</p></details>
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
 .overview{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:15px}
 .overview div{padding:14px;background:#fff;border:1px solid #d8e8ed;border-radius:12px}
 .overview small,.overview strong{display:block}.overview small{color:#8197a3;font-size:11px}
 .overview strong{font-size:27px;color:#116575;margin-top:7px}
 .poc,.status,.warning{padding:12px;background:#eff9f7;border:1px solid #abdcd3;border-radius:10px;
  font-size:12px;color:#17685f}.poc code{font-size:11px}
 .danger{background:#ffeded;color:#a03939;border-color:#e9b7b7}.good{background:#eaf9f0;color:#226e4c}
 .warning{background:#fff7e9;color:#805b26;border-color:#ead6ac}
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
 .buttons{margin:18px 0}.dossier-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:15px 0}
 .fact{background:#f3f9fa;padding:13px;border-radius:10px}.fact small,.fact b{display:block}
 .fact small{font-size:10px;color:#7899a2}.fact b{font-size:12px;margin-top:7px;color:#17566d}
 details{border:1px solid #dae8ed;border-radius:10px;margin:9px 0;padding:11px 14px}
 summary{font-size:12px;font-weight:800;color:#216b79;cursor:pointer}
 details p{font-size:12px;color:#6b8392}
 pre{white-space:pre-wrap;overflow:auto;max-height:280px;overflow-wrap:anywhere;
  background:#f6fafb;padding:10px;font-size:11px;color:#526a77;border-radius:7px}
 .empty{font-size:12px;color:#637f8c;line-height:1.8}
 .placeholder{text-align:center;margin:75px auto;color:#7291a0;max-width:400px}
 .placeholder span{font-size:45px}.placeholder h2{font-size:19px;color:#28536a}
 .placeholder p{font-size:12px;line-height:1.8}
 @media(max-width:1180px){.workspace{grid-template-columns:300px 1fr}.dossier-grid{grid-template-columns:repeat(2,1fr)}}
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
 constructor(private readonly http:HttpClient,private readonly router:Router,
  public readonly lang:LanguageService){}
 t(en:string,ar:string):string{return this.lang.pick(en,ar);}
 ngOnInit():void{this.load();}
 statusCount(s:string):number{return this.orders.filter(x=>x.status===s).length;}
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
  this.loading=true;this.error='';
  this.http.get<{orders:AssignedOrder[];me:{session:string;inspectorPocId:string|null}}>(
    this.api+'my-work-orders').subscribe({
   next:r=>{this.loading=false;this.orders=r.orders||[];this.me=r.me||null;
    if(this.selected){
     const next=this.orders.find(x=>x.orderId===this.selected?.orderId);
     if(next)this.selected=next;else{this.selected=null;this.dossier=null;}
    }},
   error:e=>{this.loading=false;this.error=e?.error?.error||'SI_ORDERS_UNAVAILABLE';}
  });
 }
 select(o:AssignedOrder):void{
  if(this.selected?.orderId===o.orderId&&(this.dossier||this.loadingDossier))return;
  this.selected=o;this.error='';this.dossier=this.cache[o.orderId]||null;
  if(this.dossier)return;
  this.loadingDossier=true;
  this.http.get<Dossier>(this.api+'my-work-orders/'+o.orderId+'/dossier').subscribe({
   next:d=>{this.cache[o.orderId]=d;
    if(this.selected?.orderId===o.orderId)this.dossier=d;
    this.loadingDossier=false;},
   error:e=>{this.loadingDossier=false;
    if(this.selected?.orderId===o.orderId)this.error=e?.error?.error||
      'SI_DOSSIER_UNAVAILABLE';}
  });
 }
 activate(o:AssignedOrder):void{
  if(this.busy||!this.canActivate(o)||!window.confirm(this.t(
   'Activate your assigned order: create/link an official-free SI case, pin the mandatory checklist and request A04 analysis if the source has verified risk and evidence? Supervisor approval remains separate.',
   'تفعيل أمر التكليف الخاص بك: إنشاء/ربط حالة معاينة POC وتجهيز القائمة الإلزامية وتشغيل A04 إن توفرت المخاطر والأدلة؟ يظل اعتماد النطاق من اختصاص المشرف.')))return;
  this.busy=true;this.error='';
  this.http.post<{order:AssignedOrder}>(
   this.api+'plans/'+o.planId+'/work-orders/'+o.orderId+'/activate',
   {generateAi:true,confirmAiCost:true}
  ).subscribe({
   next:r=>{this.busy=false;const updated=this.replaceOrder(r.order);
    this.message=this.t('Dossier and mandatory checklist prepared. Supervisor must review A04 and approve scope before field start.',
      'تم تجهيز الدوسيه والقائمة الإلزامية؛ يلزم مراجعة A04 واعتماد النطاق من المشرف قبل بدء التنفيذ.');
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
   this.api+'plans/'+o.planId+'/work-orders/'+o.orderId+'/start',
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
