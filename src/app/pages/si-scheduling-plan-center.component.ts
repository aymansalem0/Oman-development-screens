import {CommonModule} from '@angular/common';
import {Component,OnInit} from '@angular/core';
import {HttpClient} from '@angular/common/http';
import {RouterLink} from '@angular/router';
import {LanguageService} from '../services/language.service';
import {NmcNavigationComponent} from '../components/nmc-navigation.component';

interface Plan{
 id:string;number:string;title:string;status:string;revision:number;
 startsOn:string;endsOn:string;approvedAt?:string|null;
 vesselCount:number;
}
@Component({
 selector:'app-si-scheduling-plan-center',standalone:true,
 imports:[CommonModule,RouterLink,NmcNavigationComponent],
 template:`
 <div class="schedule-hub" [attr.dir]="lang.dir">
  <app-nmc-navigation/>
  <main class="schedule-hub-main">
   <header>
    <small>MOEI · SMART INSPECTION · SI-S01</small>
    <h1>{{copy('Electronic Inspection Scheduling','الجدولة الإلكترونية للمعاينات')}}</h1>
    <p>{{copy('Schedule vessels from an approved Inspection Plan. ERP supplies verified engineer availability; SI-S01 advises on feasible whole-plan alternatives.',
     'الجدولة تبدأ من السفن المعتمدة في خطة المعاينات؛ يوفر ERP إتاحة المهندسين ويحلل SI-S01 بدائل الجدولة الممكنة للخطة.')}}</p>
    <div class="actions"><a routerLink="/moei/smart-inspection/candidates">
     {{copy('← Candidate & Plan Center','← مركز المرشحين والخطط')}}</a>
     <a routerLink="/moei/smart-inspection/settings/erp">{{copy('ERP workforce settings','إعدادات موارد ERP')}}</a>
     <button type="button" (click)="load()" [disabled]="loading">
      {{copy('Refresh plans','تحديث الخطط')}}</button>
    </div>
   </header>
   <p *ngIf="loading" class="notice">{{copy('Loading approved plans…','جارٍ تحميل الخطط المعتمدة…')}}</p>
   <p *ngIf="error" class="notice error" role="alert">{{error}}</p>
   <section class="summary">
    <article><span>{{copy('Approved plans','الخطط المعتمدة')}}</span>
     <strong>{{approved.length}}</strong></article>
    <article><span>{{copy('Vessels ready for scheduling','سفن جاهزة للجدولة')}}</span>
     <strong>{{approvedVesselCount}}</strong></article>
    <article><span>{{copy('Other plans','خطط أخرى')}}</span><strong>{{other.length}}</strong></article>
   </section>
   <section class="panel">
    <h2>{{copy('Approved inspection plans · ready to schedule','خطط المعاينات المعتمدة · جاهزة للجدولة')}}</h2>
    <p>{{copy('All plan sources (NMC, PSC Excel and services) are included when approved. An NMC referral is not required to schedule a PSC or service vessel.',
     'تُعرض سفن جميع المصادر المعتمدة داخل الخطة (NMC وPSC Excel وطلبات الخدمات). لا تشترط إحالة NMC لجدولة سفينة PSC أو خدمة.')}}</p>
    <div class="table-wrap"><table>
     <thead><tr><th>{{copy('Plan','الخطة')}}</th><th>{{copy('Date range','الفترة')}}</th>
      <th>{{copy('Vessels','السفن')}}</th><th>{{copy('Action','الإجراء')}}</th></tr></thead>
     <tbody>
      <tr *ngFor="let p of approved">
       <td><strong>{{p.number||p.title}}</strong><small>{{p.title}}</small></td>
       <td>{{p.startsOn}} → {{p.endsOn}}</td>
       <td><strong>{{p.vesselCount||0}}</strong></td>
       <td><a class="open" [routerLink]="['/moei/smart-inspection/scheduling/plan',p.id]">
        {{copy('Open schedule board →','فتح لوحة الجدولة ←')}}</a></td>
      </tr>
      <tr *ngIf="!approved.length&&!loading"><td colspan="4">{{copy(
       'No approved plans yet. Select vessels and approve the plan in Candidate Center.',
       'لا توجد خطة معتمدة. اختر السفن واعتمد الخطة من مركز المرشحين أولًا.')}}</td></tr>
     </tbody></table></div>
   </section>
   <section class="panel" *ngIf="other.length">
    <h2>{{copy('Draft / pending plans','خطط تحت الإعداد أو المراجعة')}}</h2>
    <p>{{copy('Scheduling requires an approved roster. Continue review rather than bypassing authorization.',
     'الجدولة تتطلب خطة سفن معتمدة. استكمل مراجعة المسودة بدل تجاوز الاعتماد.')}}</p>
    <div *ngFor="let p of other" class="pending">
     <span><strong>{{p.number||p.title}}</strong> · {{p.status}}</span>
     <a [routerLink]="['/moei/smart-inspection/plan/create',p.id]">
      {{copy('Review plan','مراجعة الخطة')}}</a>
    </div>
   </section>
   <footer>{{copy('Existing NMC-only referral scheduling remains available separately.',
     'جدولة إحالات NMC الفردية القديمة متاحة بصورة منفصلة.')}}
    <a routerLink="/moei/smart-inspection/scheduling/referrals">
     {{copy('Legacy NMC referral scheduler','جدولة إحالات NMC الفردية')}}</a></footer>
  </main>
 </div>`,
 styles:[`
 .schedule-hub{min-height:100vh;background:#edf4f7;color:#123f53}
 .schedule-hub-main{margin-inline-start:232px;padding:30px 28px;max-width:1650px}
 header,section.panel{background:#fff;border:1px solid #d7e6eb;border-radius:14px;padding:22px;margin:0 0 17px}
 header small{font-size:10px;letter-spacing:1px;font-weight:800;color:#008a8e}
 h1{font-size:26px;margin:12px 0}h2{font-size:17px;margin:0 0 9px}
 p,footer{font-size:12px;color:#608092;line-height:1.6}
 .actions{display:flex;gap:12px;flex-wrap:wrap;align-items:center}
 a{color:#087d8e;font-weight:800;text-decoration:none;font-size:12px}
 button,.open{border:1px solid #a6cdd3;border-radius:8px;padding:8px 11px;background:#ecf8f8;color:#087485}
 button{cursor:pointer}
 .summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:0 0 16px}
 .summary article{padding:17px;background:#fff;border:1px solid #d9e8eb;border-radius:12px}
 .summary span{display:block;color:#688493;font-size:11px}
 .summary strong{display:block;font-size:24px;color:#006d7c;margin:9px 0 0}
 table{width:100%;border-collapse:collapse;min-width:650px}
 .table-wrap{overflow-x:auto}th,td{padding:12px 10px;border-bottom:1px solid #e7eff1;text-align:start;font-size:12px}
 th{font-size:11px;color:#5b798a;background:#f6fafb}
 td small{display:block;color:#7a929b}
 .pending{display:flex;justify-content:space-between;gap:15px;padding:12px;border-bottom:1px solid #e4eff0}
 .notice{padding:12px;border:1px solid #d0e5e8;background:#fff;border-radius:8px}
 .error{color:#a73531;background:#fff2f0;border-color:#f1c1b8}
 footer{padding:10px 0}footer a{margin-inline-start:8px}
 @media(max-width:1050px){.schedule-hub-main{margin:0;padding:14px}.summary{grid-template-columns:1fr}}
 `]
})
export class SiSchedulingPlanCenterComponent implements OnInit{
 plans:Plan[]=[];loading=false;error='';
 constructor(private readonly http:HttpClient,public readonly lang:LanguageService){}
 copy(en:string,ar:string){return this.lang.pick(en,ar);}
 get approved(){return this.plans.filter(p=>p.status==='APPROVED'&&p.vesselCount>0);}
 get other(){return this.plans.filter(p=>p.status!=='APPROVED');}
 get approvedVesselCount(){return this.approved.reduce((n,p)=>n+(p.vesselCount||0),0);}
 ngOnInit(){this.load();}
 load(){
  this.loading=true;this.error='';
  this.http.get<{plans:Plan[]}>('/api/si/v1/inspection-plans').subscribe({
   next:r=>{this.loading=false;this.plans=r.plans||[];},
   error:e=>{this.loading=false;this.error=e?.error?.error||
    this.copy('Could not load inspection plans','تعذر تحميل خطط المعاينات');}
  });
 }
}
