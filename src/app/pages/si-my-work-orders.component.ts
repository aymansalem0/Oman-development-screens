import {CommonModule} from '@angular/common';
import {Component,OnInit} from '@angular/core';
import {HttpClient} from '@angular/common/http';
import {RouterLink} from '@angular/router';
import {NmcNavigationComponent} from '../components/nmc-navigation.component';
import {LanguageService} from '../services/language.service';

interface AssignedOrder{
 planId:string;scheduleId:string;orderId:string;imo:string;
 status:string;caseId:string|null;checklistStatus:string;
 aiStatus:string;scopeStatus:string;mode:'POC_MOCK'|'ERP_EXCEL_POC';
 assignment:{inspectorName:string;inspectorId:string;
  portName:string;startLocal:string;startUtc:string;locationName:string};
}
@Component({
 selector:'app-si-my-work-orders',standalone:true,
 imports:[CommonModule,RouterLink,NmcNavigationComponent],
 template:`
 <div class="si-orders" [attr.dir]="lang.dir"><app-nmc-navigation/>
 <main class="si-orders-main">
  <header>
   <small>MOEI · SMART INSPECTION · INSPECTOR WORK ORDERS</small>
   <h1>{{copy('My Assigned Inspections','المعاينات المسندة إليّ')}}</h1>
   <p>{{copy('Only orders mapped to your signed-in ERP inspector ID are shown. A supervisor separately approves scope before field start. Synthetic POC assignments are not official ERP bookings.',
     'تظهر الأوامر المطابقة لهوية المفتش المسجّل دخوله فقط. يعتمد المشرف نطاق المعاينة قبل البدء الميداني. التكليفات التجريبية لا تمثل حجوزات فعلية في ERP.')}}</p>
   <a routerLink="/moei/smart-inspection/scheduling">{{copy('← Approved schedules','← الجدولة المعتمدة')}}</a>
   <button type="button" (click)="load()" [disabled]="busy">{{copy('Refresh','تحديث')}}</button>
  </header>
  <p *ngIf="error" class="err" role="alert">{{error}}</p>
  <p *ngIf="message" class="notice" role="status">{{message}}</p>
  <section class="order" *ngFor="let o of orders">
   <div>
    <strong>{{copy('Work order','أمر تكليف')}} {{o.orderId}}</strong>
    <p>IMO {{o.imo}} · {{o.assignment.portName}} ·
     {{o.assignment.startLocal||o.assignment.startUtc}}</p>
    <small>{{copy('Status','الحالة')}}: {{o.status}} · {{o.scopeStatus}} ·
     {{o.mode==='POC_MOCK'?'POC MOCK':'ERP EXCEL POC'}}</small>
   </div>
   <div class="actions">
    <button *ngIf="o.status==='READY_FOR_FIELD'" type="button"
      (click)="start(o)" [disabled]="busy">
     {{copy('Start Assigned Inspection','بدء المعاينة المسندة')}}</button>
    <span *ngIf="o.status!=='READY_FOR_FIELD'&&o.status!=='FIELD_STARTED'">
      {{copy('Awaiting preparation and supervisor scope approval',
        'بانتظار التجهيز واعتماد نطاق المعاينة من المشرف')}}</span>
    <a *ngIf="o.caseId" [routerLink]="['/moei/smart-inspection/checklists',o.caseId]">
      {{copy('Mandatory checklist','القائمة الإلزامية')}}</a>
    <a *ngIf="o.caseId" [routerLink]="['/moei/smart-inspection/lifecycle',o.caseId]">
      {{copy('Inspection lifecycle','دورة المعاينة')}}</a>
   </div>
  </section>
  <p *ngIf="!orders.length&&!busy">
   {{copy('No work orders are mapped to this signed-in inspector. Ask the administrator to provision SI_V2_INSPECTOR_IDENTITY_MAP_JSON for the existing ERP inspector ID.',
     'لا توجد أوامر تكليف مرتبطة بحساب المفتش. يمكن للمسؤول ربط الحساب برقم المفتش المسجل في ERP.')}}</p>
 </main></div>`,
 styles:[`
 .si-orders{min-height:100vh;background:#eef5f7;color:#173b4c}
 .si-orders-main{margin-inline-start:240px;padding:25px;max-width:1400px}
 header,.order{border:1px solid #d5e6eb;background:#fff;padding:22px;
  border-radius:12px;margin:0 0 16px}
 h1{font-size:25px}small{font-size:11px;color:#648090}
 p{color:#5a7b89;font-size:12px}
 .order,.actions{display:flex;justify-content:space-between;
  align-items:center;flex-wrap:wrap;gap:15px}
 button,a{display:inline-block;padding:9px 12px;border:1px solid #a6ccd2;
  border-radius:8px;background:#ecf8f7;color:#075c71;font-size:12px;
  cursor:pointer;text-decoration:none;font-weight:700;margin-inline-end:8px}
 button:disabled{opacity:.5;cursor:not-allowed}
 .err,.notice{padding:12px;background:#fff0ee;
  border:1px solid #e7b6b2;border-radius:8px}
 .notice{background:#ecf9f7;border-color:#afe0da}
 @media(max-width:1000px){.si-orders-main{margin:0;padding:15px}}
 `]
})
export class SiMyWorkOrdersComponent implements OnInit{
 orders:AssignedOrder[]=[];busy=false;error='';message='';
 private readonly api='/api/si/v1/maritime-scheduling/';
 constructor(private readonly http:HttpClient,public readonly lang:LanguageService){}
 copy(en:string,ar:string):string{return this.lang.pick(en,ar);}
 ngOnInit():void{this.load();}
 load():void{
  this.busy=true;this.error='';
  this.http.get<{orders:AssignedOrder[]}>(this.api+'my-work-orders').subscribe({
   next:r=>{this.busy=false;this.orders=r.orders||[];},
   error:e=>{this.busy=false;this.error=e?.error?.error||'SI_ORDERS_UNAVAILABLE';}
  });
 }
 start(o:AssignedOrder):void{
  if(this.busy||o.status!=='READY_FOR_FIELD'||!window.confirm(this.copy(
   'Start this assigned inspection under your authenticated ERP inspector identity?',
   'هل تريد بدء المعاينة بهوية المفتش المرتبطة بحسابك؟')))return;
  this.busy=true;this.error='';
  this.http.post<{order:AssignedOrder}>(
   this.api+'plans/'+encodeURIComponent(o.planId)+'/work-orders/'+
    encodeURIComponent(o.orderId)+'/start',{confirmPocDelegation:false}
  ).subscribe({
   next:r=>{
    this.busy=false;
    this.orders=this.orders.map(x=>x.orderId===o.orderId?r.order:x);
    this.message=this.copy('Inspection started. Open the mandatory checklist and lifecycle.',
      'بدأت المعاينة. افتح القائمة الإلزامية ودورة المعاينة.');
   },
   error:e=>{this.busy=false;this.error=e?.error?.error||'SI_ORDER_EXECUTION_FAILED';}
  });
 }
}
