import {CommonModule} from '@angular/common';
import {Component,OnInit} from '@angular/core';
import {HttpClient} from '@angular/common/http';
import {RouterLink} from '@angular/router';
import {NmcNavigationComponent} from '../components/nmc-navigation.component';
import {LanguageService} from '../services/language.service';
interface WorkOrder{
 planId:string;scheduleId:string;orderId:string;imo:string;caseId:string;
 status:string;dossierStatus:string;
 assignment:{inspectorName:string;inspectorId:string;portName:string;
  startLocal:string;startUtc:string;locationName:string};
}
interface Execution{
 status:string;caseId:string;orderId:string;imo:string;
 mandatoryTemplates:string[];approvedAiAdditionalItems:string[];
}
@Component({
 selector:'app-si-my-work-orders',standalone:true,
 imports:[CommonModule,RouterLink,NmcNavigationComponent],
 template:`
 <div class="si-orders" [attr.dir]="lang.dir"><app-nmc-navigation/>
 <main class="si-orders-main">
  <header><small>MOEI · SMART INSPECTION · WORK ORDERS</small>
   <h1>{{copy('My Assigned Inspections','أوامر المعاينات المسندة إليّ')}}</h1>
   <p>{{copy('Only the signed-in assigned engineer may execute a work order. Execution initializes mandatory checklist templates and any human-approved A04 additional inspection scope.',
     'لا يستطيع تنفيذ أمر التكليف إلا المهندس المسند إليه. عند التنفيذ تُنشأ القوائم الإلزامية وبنود A04 الإضافية التي اعتمدها المسؤول.')}}</p>
   <a routerLink="/moei/smart-inspection/scheduling">
    {{copy('← Approved schedules','← الجدولة المعتمدة')}}</a>
   <button type="button" (click)="load()" [disabled]="busy">{{copy('Refresh','تحديث')}}</button>
  </header>
  <p *ngIf="error" class="err" role="alert">{{error}}</p>
  <p *ngIf="message" class="notice" role="status">{{message}}</p>
  <section class="order" *ngFor="let o of orders">
   <div><strong>{{copy('Work order','أمر تكليف')}} {{o.orderId}}</strong>
    <p>IMO {{o.imo}} · {{o.assignment.portName}} ·
     {{o.assignment.startLocal||o.assignment.startUtc}}</p>
    <small>{{copy('Dossier','الدوسيه')}}: {{o.dossierStatus}} ·
     {{copy('Assigned engineer','المهندس المكلف')}}: {{o.assignment.inspectorName}}</small>
   </div>
   <button type="button" (click)="execute(o)" [disabled]="busy">
    {{copy('Execute Work Order & Create Checklists',
      'تنفيذ أمر التكليف وإنشاء قوائم المعاينة')}}</button>
  </section>
  <section class="order" *ngFor="let e of executed">
   <div>
    <strong>{{copy('Inspection started','بدأت المعاينة')}} · IMO {{e.imo}}</strong>
    <p>{{copy('Mandatory checklists','القوائم الإلزامية')}}:
     {{e.mandatoryTemplates.length}}</p>
    <p>{{copy('Human-approved AI checklist additions','البنود الإضافية المعتمدة من AI')}}:
     {{e.approvedAiAdditionalItems.length}}</p>
    <div *ngFor="let item of e.approvedAiAdditionalItems">✓ {{item}}</div>
   </div>
   <a [routerLink]="['/moei/smart-inspection/checklists',e.caseId]">
    {{copy('Open mandatory field checklist →','فتح قائمة المعاينة الإلزامية ←')}}</a>
   <a [routerLink]="['/moei/smart-inspection/lifecycle',e.caseId]">
    {{copy('View approved additional scope →','عرض نطاق AI الإضافي المعتمد ←')}}</a>
  </section>
  <p *ngIf="!orders.length&&!executed.length&&!busy">
   {{copy('No issued work orders for this signed-in engineer. The supervisor must approve and dispatch the schedule first.',
     'لا توجد أوامر تكليف صادرة لهذا المهندس. يجب على المسؤول اعتماد الجدولة ثم إصدار الأوامر أولًا.')}}</p>
 </main></div>`,
 styles:[`
 .si-orders{min-height:100vh;background:#eef5f7;color:#173b4c}
 .si-orders-main{margin-inline-start:240px;padding:25px;max-width:1400px}
 header,.order{border:1px solid #d5e6eb;background:#fff;padding:22px;
 border-radius:12px;margin:0 0 16px}
 h1{font-size:25px}small{font-size:11px;color:#648090}
 p{color:#5a7b89;font-size:12px}
 .order{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:15px}
 button,a{display:inline-block;padding:9px 12px;border:1px solid #a6ccd2;
 border-radius:8px;background:#ecf8f7;color:#075c71;font-size:12px;cursor:pointer;
 text-decoration:none;font-weight:700;margin-inline-end:8px}
 button:disabled{opacity:.5;cursor:not-allowed}
 .err,.notice{padding:12px;background:#fff0ee;border:1px solid #e7b6b2;border-radius:8px}
 .notice{background:#ecf9f7;border-color:#afe0da}
 @media(max-width:1000px){.si-orders-main{margin:0;padding:15px}}
 `]
})
export class SiMyWorkOrdersComponent implements OnInit{
 orders:WorkOrder[]=[];executed:Execution[]=[];busy=false;error='';message='';
 private readonly api='/api/si/v1/maritime-scheduling/';
 constructor(private readonly http:HttpClient,public readonly lang:LanguageService){}
 copy(en:string,ar:string){return this.lang.pick(en,ar);}
 ngOnInit(){this.load();}
 load():void{
  this.busy=true;this.error='';
  this.http.get<{orders:WorkOrder[]}>(this.api+'my-work-orders').subscribe({
   next:r=>{this.busy=false;this.orders=r.orders||[];},
   error:e=>{this.busy=false;this.error=e?.error?.error||'SI_ORDERS_UNAVAILABLE';}
  });
 }
 execute(o:WorkOrder):void{
  if(this.busy||!window.confirm(this.copy(
   'Start assigned inspection and create mandatory and approved-AI checklist items? The action will be audited.',
   'بدء المعاينة وإنشاء البنود الإلزامية وبنود AI المعتمدة؟ سيتم تسجيل الإجراء في سجل التدقيق.')))return;
  this.busy=true;this.error='';
  this.http.post<Execution>(this.api+'plans/'+encodeURIComponent(o.planId)+
    '/orders/'+encodeURIComponent(o.imo)+'/execute',{confirmExecution:true})
    .subscribe({
     next:r=>{
      this.busy=false;this.executed=[r,...this.executed];
      this.orders=this.orders.filter(x=>x.orderId!==o.orderId);
      this.message=this.copy('Inspection checklists prepared for assigned inspector.',
       'تم تجهيز قوائم المعاينة للمهندس المكلف.');
     },
     error:e=>{this.busy=false;this.error=e?.error?.error||'SI_ORDER_EXECUTION_FAILED';}
    });
 }
}
