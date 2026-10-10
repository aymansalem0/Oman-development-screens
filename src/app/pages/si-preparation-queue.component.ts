import {CommonModule} from '@angular/common';
import {Component,OnInit} from '@angular/core';
import {RouterLink} from '@angular/router';
import {NmcNavigationComponent} from '../components/nmc-navigation.component';
import {LanguageService} from '../services/language.service';
import {SiCandidate,SiCandidateTargetingService} from '../services/si-candidate-targeting.service';

/** An actual landing route is required: A04 preparation is always case-specific. */
@Component({
  selector:'app-si-preparation-queue',
  standalone:true,
  imports:[CommonModule,RouterLink,NmcNavigationComponent],
  template:`
    <div class="si-layout" [attr.dir]="lang.dir">
      <app-nmc-navigation></app-nmc-navigation>
      <main class="prep-queue-main">
        <header class="prep-heading">
          <div>
            <small>{{copy('SMART INSPECTION / PREPARATION','المعاينة الذكية / التحضير')}}</small>
            <h1>{{copy('Inspection Preparation & A04','تحضير المعاينة وملف A04')}}</h1>
            <p>{{copy('Choose a previously approved inspection case to view its evidence, prepare the mandatory checklist and request an optional A04 dossier.',
              'اختر حالة معاينة معتمدة لعرض أدلتها وتحضير قائمة المعاينة الإلزامية وطلب ملف A04 عند الحاجة.')}}</p>
          </div>
          <div class="actions">
            <a routerLink="/moei/smart-inspection/candidates">{{copy('Candidate Center','مركز الترشيح')}}</a>
            <button type="button" (click)="refresh()" [disabled]="loading">{{copy('Refresh','تحديث')}}</button>
          </div>
        </header>
        <div *ngIf="loading" class="info" role="status">{{copy('Loading centrally saved approved cases…','جارٍ تحميل حالات المعاينة المعتمدة…')}}</div>
        <div *ngIf="error" class="error" role="alert">{{error}}</div>
        <section class="metrics" *ngIf="!loading">
          <article><span>{{copy('Approved SI Cases','حالات المعاينة المعتمدة')}}</span><strong>{{cases.length}}</strong></article>
          <article><span>{{copy('With Saved NMC Risk','ذات تقييم مخاطر محفوظ')}}</span><strong>{{casesWithRisk}}</strong></article>
          <article><span>{{copy('Pending NMC Risk','بانتظار تقييم المخاطر')}}</span><strong>{{cases.length-casesWithRisk}}</strong></article>
        </section>
        <section class="panel">
          <h2>{{copy('Available Inspection Cases','حالات المعاينة المتاحة')}}</h2>
          <p>{{copy('Preparation requires an actual approved SI case. A fleet record or unapproved candidate alone cannot start A04.',
              'يتطلب التحضير حالة معاينة معتمدة؛ لا تكفي بيانات السفينة أو الترشيح غير المعتمد لتشغيل A04.')}}</p>
          <div class="table-wrap" *ngIf="cases.length">
            <table>
              <thead><tr>
                <th>{{copy('Vessel / IMO','السفينة / IMO')}}</th>
                <th>{{copy('Inspection Regime','نظام المعاينة')}}</th>
                <th>{{copy('Approved By','اعتمدها')}}</th>
                <th>{{copy('Risk','المخاطر')}}</th>
                <th>{{copy('Case ID','معرف الحالة')}}</th>
                <th>{{copy('Preparation','التحضير')}}</th>
              </tr></thead>
              <tbody>
                <tr *ngFor="let c of cases;trackBy:track">
                  <td><strong>{{c.vesselName}}</strong><span>{{c.imo}}</span></td>
                  <td>{{c.regime}}</td>
                  <td>{{c.inspectionCase?.approvedBy||'—'}}</td>
                  <td>{{c.currentRisk?c.currentRisk.score+'/100':copy('NOT ASSESSED','لم تُقيّم')}}</td>
                  <td><code>{{c.inspectionCase?.id}}</code></td>
                  <td><a class="open" [routerLink]="['/moei/smart-inspection/preparation',c.inspectionCase?.id]">
                    {{copy('Open Preparation →','فتح التحضير ←')}}
                  </a></td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="info" *ngIf="!loading&&!cases.length">
            {{copy('No approved SI cases are saved yet. Open Candidate Center, review a traceable source event and approve an inspection case first.',
              'لا توجد حالات معاينة معتمدة بعد. افتح مركز الترشيح، وراجع حدث المصدر، ثم اعتمد حالة معاينة أولًا.')}}
            <a routerLink="/moei/smart-inspection/candidates">{{copy('Go to Candidate Center','الانتقال إلى مركز الترشيح')}}</a>
          </div>
        </section>
      </main>
    </div>`,
  styles:[`
    :host{display:block;min-height:calc(100vh - 82px);background:#eef4f7;color:#213f55}
    .si-layout{display:flex;min-height:calc(100vh - 82px)}
    .prep-queue-main{flex:1;min-width:0;max-width:1680px;margin:0 auto;padding:25px 28px 50px}
    .prep-heading{display:flex;justify-content:space-between;align-items:flex-start;gap:18px;padding:13px 0 22px;
      border-bottom:1px solid #dfe9ef}
    .prep-heading small{color:#0f766e;letter-spacing:1px;font-size:10px;font-weight:850}
    .prep-heading h1{margin:8px 0;color:#16324f;font-size:25px}
    .prep-heading p,.panel p{font-size:12px;color:#708698;line-height:1.7;margin:0}
    .actions{display:flex;gap:9px;flex-wrap:wrap}
    .actions a,.actions button,.open{display:inline-flex;align-items:center;border:1px solid #cde2dc;
      border-radius:8px;padding:10px 12px;color:#0f766e;background:white;font-size:11px;font-weight:800;
      text-decoration:none;cursor:pointer;white-space:nowrap}
    .metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:13px;margin:20px 0}
    .metrics article,.panel{border:1px solid #dde9ee;border-radius:13px;background:white;padding:20px;
      box-shadow:0 3px 12px rgba(21,50,68,.06)}
    .metrics span,.metrics strong{display:block}.metrics span{font-size:11px;color:#6c8593}
    .metrics strong{font-size:29px;color:#075d73;margin-top:10px}
    .panel h2{font-size:17px;color:#12465f;margin:0 0 8px}
    .table-wrap{max-width:100%;overflow:auto;margin-top:19px}
    table{width:100%;border-collapse:collapse;min-width:850px;font-size:12px}
    th,td{text-align:start;padding:13px 10px;border-bottom:1px solid #e8f0f3}
    th{font-size:10px;color:#507084;background:#f1f7f9}
    td strong,td span{display:block}td span{color:#78919e;font-size:10px;margin-top:4px}
    code{font-size:10px;overflow-wrap:anywhere;unicode-bidi:plaintext}
    .info,.error{margin-top:15px;border-radius:9px;padding:15px;font-size:12px}
    .info{background:#eaf5f8;color:#28617a}.error{background:#ffedea;color:#a13c36}
    .info a{color:#0c7668;margin-inline-start:10px}
    @media(max-width:960px){.si-layout{display:block}.prep-queue-main{padding:18px}
      .prep-heading{flex-direction:column}.metrics{grid-template-columns:1fr}}
  `]
})
export class SiPreparationQueueComponent implements OnInit{
  cases:SiCandidate[]=[];loading=false;error='';
  constructor(private readonly api:SiCandidateTargetingService,public readonly lang:LanguageService){}
  ngOnInit(){this.refresh();}
  copy(en:string,ar:string){return this.lang.pick(en,ar);}
  refresh():void{
    this.loading=true;this.error='';
    this.api.dashboard().subscribe({
      next:data=>{
        this.cases=data.candidates.filter(c=>c.status==='INSPECTION_CREATED'&&Boolean(c.inspectionCase?.id));
        this.loading=false;
      },
      error:e=>{
        this.error=e?.error?.error||this.copy('Unable to load approved cases','تعذر تحميل حالات المعاينة المعتمدة');
        this.loading=false;
      }
    });
  }
  get casesWithRisk():number{return this.cases.filter(c=>c.currentRisk!==null).length;}
  track(_:number,c:SiCandidate):string{return c.key;}
}
