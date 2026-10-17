import {CommonModule} from '@angular/common';
import {HttpClient,HttpHeaders} from '@angular/common/http';
import {Component,OnInit} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {RouterLink} from '@angular/router';
import {NmcNavigationComponent} from '../components/nmc-navigation.component';
import {LanguageService} from '../services/language.service';
import {SiLifecycleCase,SiLifecycleView} from '../services/si-lifecycle.service';

type Decision='APPROVE_REPORT'|'RETURN_REPORT'|'CLOSE';
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
      <article class="report" *ngIf="v.record?.report as report;else noReport">
       <h3>{{copy('Inspector Report','تقرير المفتش')}}</h3>
       <p>{{report.summary}}</p>
       <div class="attributes">
        <div><span>{{copy('Report status','حالة التقرير')}}</span><b>{{report.status}}</b></div>
        <div><span>{{copy('Inspected checks','البنود المفحوصة')}}</span><b>{{report.checksCompleted??v.record?.checks?.length}}</b></div>
        <div><span>{{copy('Confirmed findings','الملاحظات المؤكدة')}}</span><b>{{report.findingsCount}}</b></div>
        <div><span>{{copy('Major / Critical','كبيرة / حرجة')}}</span><b>{{report.majorCount}} / {{report.criticalCount}}</b></div>
       </div>
       <h3>{{copy('Inspector Findings','ملاحظات المفتش')}}</h3>
       <p *ngIf="!v.record?.findings?.length" class="muted">{{copy('No deficiencies recorded','لم يسجل المفتش مخالفات')}}</p>
       <div class="finding" *ngFor="let finding of v.record?.findings">
        <b>{{finding.title}} · {{finding.severity}}</b><p>{{finding.description}}</p>
        <small>{{copy('Evidence references','مراجع الأدلة')}}: {{finding.evidenceRefs.join(', ')||'—'}}</small>
       </div>
       <h3 *ngIf="v.record?.actions?.length">{{copy('Corrective Actions','الإجراءات التصحيحية')}}</h3>
       <div class="finding" *ngFor="let action of v.record?.actions">
        {{action.instruction}} · <b>{{action.status}}</b>
       </div>
       <div class="origin" *ngIf="v.inspectionCase.nmcReferralId">
        {{copy('NMC referral:','طلب NMC:')}} {{v.inspectionCase.nmcReferralId}}.
        {{copy('When closed, the approved inspection outcome is recorded in the linked NMC Case. NMC risk is not recalculated automatically.',
           'بعد الإغلاق، تُسجَّل نتيجة المعاينة المعتمدة في حالة NMC المرتبطة، دون تغيير درجة مخاطر NMC تلقائيًا.')}}
       </div>
       <div class="review-form">
        <label for="supervisor-reason">{{copy('Supervisor decision reason (at least 8 characters)','سبب قرار المشرف (8 أحرف على الأقل)')}}</label>
        <textarea id="supervisor-reason" rows="3" [(ngModel)]="reason"></textarea>
        <div class="actions">
         <button type="button" class="button approve" (click)="decide('APPROVE_REPORT')"
          [disabled]="busy||v.record?.stage!=='REPORT_PENDING_REVIEW'||reason.trim().length<8">
           {{copy('Approve Inspector Report','اعتماد تقرير المفتش')}}</button>
         <button type="button" class="button return" (click)="decide('RETURN_REPORT')"
          [disabled]="busy||v.record?.stage!=='REPORT_PENDING_REVIEW'||reason.trim().length<8">
           {{copy('Return to Inspector','إرجاع للمفتش')}}</button>
         <button type="button" class="button close" (click)="decide('CLOSE')"
          [disabled]="busy||!canClose||reason.trim().length<8">
           {{copy('Close Inspection Case','إغلاق حالة المعاينة')}}</button>
         <button type="button" *ngIf="v.inspectionCase.nmcReferralId&&v.record?.stage==='CLOSED'"
          class="button" (click)="retryNmc()" [disabled]="busy">
           {{copy('Verify / Retry NMC Sync','فحص / إعادة مزامنة NMC')}}</button>
        </div>
        <p class="muted">{{copy('Closing requires an approved report and all corrective actions verified. A separate risk reassessment remains required where applicable.',
          'الإغلاق يتطلب تقريرًا معتمدًا والتحقق من الإجراءات التصحيحية. تحديث تقييم المخاطر إجراء مستقل عند الحاجة.')}}</p>
       </div>
      </article>
      <ng-template #noReport><p class="muted">{{copy('No submitted inspector report yet.','لم يتم تقديم تقرير المعاينة بعد.')}}</p></ng-template>
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
   .si-title{align-items:flex-start;flex-wrap:wrap}
 }
 `]
})
export class SiSupervisorReviewComponent implements OnInit{
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
  this.http.get<SiLifecycleView>(this.base+'/'+encodeURIComponent(id),
   {headers:this.headers()})
  .subscribe({next:r=>{this.busy=false;this.view=r;},
   error:e=>{this.busy=false;this.error=e?.error?.error||'SI_SUPERVISOR_REPORT_UNAVAILABLE';}});
 }
 decide(action:Decision):void{
  const v=this.view?.record;
  if(!v||this.reason.trim().length<8||this.busy)return;
  if(!window.confirm(this.copy(
   'Confirm supervisor action: '+action+'?','هل تؤكد إجراء المشرف: '+action+'؟')))return;
  this.busy=true;this.error='';this.notice='';
  this.http.post<{record:unknown;nmcSync?:{status:string;error?:string}}>(
   this.base+'/'+encodeURIComponent(this.selectedId)+'/decision',
   {action,expectedVersion:v.version,reason:this.reason.trim()},
   {headers:this.headers(true)})
  .subscribe({next:r=>{
    this.busy=false;
    this.notice=this.copy('Supervisor decision saved: ','تم تسجيل قرار المشرف: ')+action+
      (r.nmcSync?' · NMC: '+r.nmcSync.status:'');
    this.load();
   },error:e=>{this.busy=false;this.error=e?.error?.error||'SI_SUPERVISOR_ACTION_FAILED';}});
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
