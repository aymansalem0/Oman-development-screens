import {CommonModule} from '@angular/common';
import {Component,OnInit} from '@angular/core';
import {RouterLink} from '@angular/router';
import {NmcNavigationComponent} from '../components/nmc-navigation.component';
import {LanguageService} from '../services/language.service';
import {SiPreparationCaseSummary,SiPreparationService} from '../services/si-preparation.service';

/** Approved inspection-case landing route: persistent SI register, no AI on GET. */
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
            <p>{{copy('Select a previously approved inspection case. The saved approvals remain visible even when an NMC referral is resolved or no longer in live targeting.',
              'اختر حالة معاينة معتمدة؛ تظل الاعتمادات المحفوظة ظاهرة حتى لو أُغلق تحويل NMC أو اختفى من الترشيح الحالي.')}}</p>
          </div>
          <div class="actions">
            <a routerLink="/moei/smart-inspection/candidates">{{copy('Candidate Center','مركز الترشيح')}}</a>
            <button type="button" (click)="refresh()" [disabled]="loading">{{copy('Refresh','تحديث')}}</button>
          </div>
        </header>
        <div *ngIf="loading" class="info" role="status">{{copy('Loading centrally saved approved cases…','جارٍ تحميل حالات المعاينة المعتمدة…')}}</div>
        <div *ngIf="error" class="error" role="alert">{{error}}</div>
        <div *ngIf="!loading&&!preparationAvailable&&!error" class="error" role="alert">
          {{copy('Approved cases are shown, but the preparation workspace is not ready. Oracle migration 010 must be verified by an administrator; no data was changed.',
            'تظهر الحالات المعتمدة، لكن مساحة التحضير غير جاهزة. يجب التحقق من ترحيل Oracle رقم 010 بواسطة المسؤول؛ لم يتم تغيير أي بيانات.')}}
        </div>
        <section class="metrics" *ngIf="!loading&&!error">
          <article><span>{{copy('Approved SI Cases','حالات المعاينة المعتمدة')}}</span><strong>{{cases.length}}</strong></article>
          <article><span>{{copy('Risk Recorded at Approval','المخاطر وقت الاعتماد')}}</span><strong>{{casesWithRisk}}</strong></article>
          <article><span>{{copy('Not Yet Prepared','لم يبدأ تحضيرها')}}</span><strong>{{unpreparedCount}}</strong></article>
        </section>
        <section class="panel">
          <h2>{{copy('Available Inspection Cases','حالات المعاينة المتاحة')}}</h2>
          <p>{{copy('Only human-approved inspection cases can be prepared. This register reads saved case approvals, not the temporary live candidate queue.',
              'يبدأ التحضير من حالة معاينة معتمدة بشريًا فقط؛ تُعرض الاعتمادات المحفوظة وليس قائمة الترشيحات الحية المؤقتة.')}}</p>
          <div class="table-wrap" *ngIf="cases.length">
            <table>
              <thead><tr>
                <th>{{copy('Vessel / IMO','السفينة / IMO')}}</th>
                <th>{{copy('Inspection Regime','نظام المعاينة')}}</th>
                <th>{{copy('Approved By','اعتمدها')}}</th>
                <th>{{copy('Risk at Approval','المخاطر عند الاعتماد')}}</th>
                <th>{{copy('Preparation Status','حالة التحضير')}}</th>
                <th>{{copy('Case ID','معرف الحالة')}}</th>
                <th>{{copy('Preparation','التحضير')}}</th>
              </tr></thead>
              <tbody>
                <tr *ngFor="let c of cases;trackBy:track">
                  <td><strong>{{c.vesselName}}</strong><span>{{c.imo}}</span></td>
                  <td>{{c.regime}}</td>
                  <td>{{c.approvedBy||'—'}}</td>
                  <td>{{c.riskAtApproval?c.riskAtApproval.score+'/100':copy('NOT ASSESSED','لم تُقيّم')}}</td>
                  <td><span class="state-chip" [class.waiting]="c.preparationStatus==='NOT_PREPARED'">{{status(c.preparationStatus)}}</span></td>
                  <td><code>{{c.id}}</code></td>
                  <td><a class="open" [routerLink]="['/moei/smart-inspection/preparation',c.id]">
                    {{copy('Open Preparation →','فتح التحضير ←')}}
                  </a>
                  <a class="open" [routerLink]="['/moei/smart-inspection/lifecycle',c.id]">
                    {{copy('Full Cycle →','دورة المعاينة ←')}}
                  </a></td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="info" *ngIf="!loading&&!cases.length&&!error">
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
    .state-chip{display:inline-flex;border-radius:100px;background:#def5eb;color:#086449;padding:6px 10px;font-size:10px;font-weight:800}
    .state-chip.waiting{background:#fff4dd;color:#935a11}
    .info,.error{margin-top:15px;border-radius:9px;padding:15px;font-size:12px}
    .info{background:#eaf5f8;color:#28617a}.error{background:#ffedea;color:#a13c36}
    .info a{color:#0c7668;margin-inline-start:10px}
    @media(max-width:960px){.si-layout{display:block}.prep-queue-main{padding:18px}
      .prep-heading{flex-direction:column}.metrics{grid-template-columns:1fr}}
  `]
})
export class SiPreparationQueueComponent implements OnInit{
  cases:SiPreparationCaseSummary[]=[];
  loading=false;error='';preparationAvailable=true;
  // POC central Admin session; interceptor removes this local sentinel header.
  readonly editorKey='MOEI_SESSION';
  constructor(private readonly api:SiPreparationService,public readonly lang:LanguageService){}
  ngOnInit():void{this.refresh();}
  copy(en:string,ar:string):string{return this.lang.pick(en,ar);}
  refresh():void{
    if(this.loading)return;
    this.loading=true;this.error='';
    this.api.list(this.editorKey).subscribe({
      next:data=>{
        this.cases=data.cases;
        this.preparationAvailable=data.preparationAvailable;
        this.loading=false;
      },
      error:e=>{
        this.cases=[];
        this.preparationAvailable=false;
        const code=e?.error?.error;
        this.error=e?.status===401?this.copy('Please sign in again.','يرجى إعادة تسجيل الدخول.'):
          code==='SI_MIGRATION_009_REQUIRED'?this.copy('SI case registry migration 009 is required. Contact the database administrator.',
            'ترحيل قاعدة بيانات حالات المعاينة رقم 009 غير مُطبّق؛ تواصل مع مسؤول قاعدة البيانات.'):
          this.copy('Unable to read saved SI approved cases. Verify backend connection and the database schema; the source is not assumed empty.',
            'تعذر قراءة حالات المعاينة المعتمدة المحفوظة. راجع الخادم ومخطط قاعدة البيانات؛ لا يعني ذلك خلو السجل.');
        this.loading=false;
      }
    });
  }
  get casesWithRisk():number{return this.cases.filter(c=>c.riskAtApproval!==null).length;}
  get unpreparedCount():number{return this.cases.filter(c=>c.preparationStatus==='NOT_PREPARED').length;}
  status(v:string):string{
    const en:Record<string,string>={NOT_PREPARED:'Not Prepared',PREPARED:'Prepared',
      GENERATING:'Generating',DRAFT_REVIEW:'AI Draft Review',APPROVED:'Approved',
      REJECTED:'Rejected',FAILED:'Failed'};
    const ar:Record<string,string>={NOT_PREPARED:'لم يبدأ التحضير',PREPARED:'تم التحضير',
      GENERATING:'جارٍ إعداد الملف',DRAFT_REVIEW:'ملف AI قيد المراجعة',
      APPROVED:'معتمد',REJECTED:'مرفوض',FAILED:'فشل'};
    return this.lang.isArabic?(ar[v]||v):(en[v]||v);
  }
  track(_:number,c:SiPreparationCaseSummary):string{return c.id;}
}
