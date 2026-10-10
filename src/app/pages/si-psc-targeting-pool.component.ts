import {CommonModule} from '@angular/common';
import {Component,OnInit} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {RouterLink} from '@angular/router';
import {NmcNavigationComponent} from '../components/nmc-navigation.component';
import {LanguageService} from '../services/language.service';
import {SiPscSelectionService,PscSelectionPool,PscPoolItem,PscQuotaBucket}
  from '../services/si-psc-selection.service';

@Component({
  selector:'app-si-psc-targeting-pool',standalone:true,
  imports:[CommonModule,FormsModule,RouterLink,NmcNavigationComponent],
  template:`
  <div class="si-layout" [attr.dir]="lang.dir">
    <app-nmc-navigation></app-nmc-navigation>
    <main class="psc-main">
      <header class="psc-head">
        <div>
          <small>MOEI MARITIME UNIFIED PLATFORM · SI-T00</small>
          <h1>{{copy('PSC Port Call Targeting & Selection','استهداف واختيار سفن تفتيش دولة الميناء')}}</h1>
          <p>{{copy('Port call registration is NOT a decision to inspect. Select only reviewed PSC events within the published monthly quota.',
            'تسجيل وصول السفينة ليس قرارًا بالمعاينة. يتم اختيار أحداث PSC بعد المراجعة وضمن حصة الاستهداف الشهرية المنشورة.')}}</p>
        </div>
        <a routerLink="/moei/smart-inspection/candidates">{{copy('Selected Inspection Candidates →','المرشحون المختارون للمعاينة ←')}}</a>
      </header>
      <section class="psc-access">
        <label>{{copy('Editor key (read pool)','مفتاح المحرر (عرض القائمة)')}}
          <input type="password" [(ngModel)]="editorKey" autocomplete="off"/></label>
        <label>{{copy('Publisher key (approve selection)','مفتاح المشرف (اعتماد الاختيار)')}}
          <input type="password" [(ngModel)]="publisherKey" autocomplete="off"/></label>
        <button (click)="load()" [disabled]="busy">{{copy('Load Port Calls','تحميل إخطارات الوصول')}}</button>
        <a routerLink="/moei/smart-inspection/settings/psc-quotas">{{copy('Quota Settings ⚙','إعدادات حصص المعاينة ⚙')}}</a>
      </section>
      <div *ngIf="error" class="notice err" role="alert">{{error}}</div>
      <div *ngIf="success" class="notice ok" role="status">{{success}}</div>
      <div *ngIf="busy" class="notice">{{copy('Processing…','جارٍ المعالجة…')}}</div>
      <section class="psc-stats" *ngIf="data as d">
        <article><small>{{copy('Eligible POC Port Calls','إخطارات وصول مؤهلة تجريبيًا')}}</small>
          <strong>{{d.summary.eligiblePortCalls}}</strong></article>
        <article><small>{{copy('Selected for PSC Review','تم اختيارها للمعاينة')}}</small>
          <strong>{{d.summary.selectedPortCalls}}</strong></article>
        <article><small>{{copy('Not Selected','لم تُختر')}}</small>
          <strong>{{d.summary.notSelectedPortCalls}}</strong></article>
        <article><small>{{copy('Still in Targeting Pool','ما زالت بقائمة الاستهداف')}}</small>
          <strong>{{d.summary.inPoolPortCalls}}</strong></article>
      </section>
      <section class="psc-panel" *ngIf="data as d">
        <div class="section-head">
          <div><h2>{{copy('01 · Published Quota by Month / Port','٠١ · الحصة المنشورة حسب الشهر والميناء')}}</h2>
          <p>{{copy('15% is an illustrative POC default, not an approved MOEI or PSC rate. Quota is calculated from recorded eligible port-call EVENTS, not unique IMO vessels. Values round DOWN. NMC referrals and Service Requests are outside this PSC quota.',
            'نسبة ١٥٪ مثال تجريبي وليست نسبة معتمدة. تُحسب الحصة من أحداث وصول السفن المؤهلة، وليس عدد السفن المختلفة، مع التقريب لأسفل. إحالات NMC وطلبات الخدمات خارج حصة PSC.')}}</p></div>
          <span class="badge">v{{d.policy.version}} · {{d.scope}}</span>
        </div>
        <div class="quota-cards">
          <article *ngFor="let b of d.summary.buckets" [class.over]="b.overQuota">
            <strong>{{b.bucket}}</strong>
            <p>{{copy('Eligible','مؤهلة')}}: {{b.eligiblePortCalls}} ·
            {{copy('Rate','النسبة')}}: {{b.selectionRate}}%</p>
            <p>{{copy('Target','المستهدف')}}: {{b.targetCount}} ·
            {{copy('Selected','مختارة')}}: {{b.selectedCount}} ·
            {{copy('Available','متبقي')}}: {{b.remainingSlots}}</p>
            <small *ngIf="b.overQuota">{{copy('Over target after policy change — review required',
              'تجاوز الحصة بعد تغيير السياسة — يلزم مراجعة')}}</small>
          </article>
        </div>
      </section>
      <section class="psc-panel" *ngIf="data as d">
        <h2>{{copy('02 · Port Call Targeting Pool','٠٢ · قائمة إخطارات الوصول للاستهداف')}}</h2>
        <div class="filter-row">
          <label>{{copy('Period (YYYY-MM)','الشهر')}}
            <input [(ngModel)]="periodFilter" placeholder="2026-10"/></label>
          <label>{{copy('Port (optional)','الميناء (اختياري)')}}
            <input [(ngModel)]="portFilter" [placeholder]="copy('All ports','جميع الموانئ')"/></label>
          <button (click)="load()" [disabled]="busy">{{copy('Apply Filters','تطبيق المرشحات')}}</button>
        </div>
        <p class="hint">{{copy('Rule recommendation is based only on SAVED NMC Risk when available, then ETA. No AI is invoked and no finding is invented. Port calls are not added to Candidate Center until selected by a Publisher.',
          'التوصية المبدئية تعتمد فقط على تقييم NMC المحفوظ إن وجد ثم موعد الوصول. لا يتم تشغيل AI أو اختلاق مخالفات. لا تنتقل أحداث PSC إلى المرشحين إلا بعد اعتماد اختيارها من المشرف.')}}</p>
        <div class="table-scroll"><table><thead><tr>
          <th>{{copy('Port Call / Vessel','إخطار الوصول / السفينة')}}</th>
          <th>{{copy('Port / Month','الميناء / الشهر')}}</th>
          <th>{{copy('NMC Risk','مخاطر NMC')}}</th>
          <th>{{copy('Rule Rank','الترتيب المبدئي')}}</th>
          <th>{{copy('Selection','الاختيار')}}</th>
          <th>{{copy('Review','المراجعة')}}</th>
        </tr></thead><tbody>
          <tr *ngFor="let row of d.items">
            <td><strong>{{row.vesselName}}</strong><small>IMO {{row.imo}}</small>
              <small>{{row.sourceReference}} · {{row.sourceFile||'POC'}} · {{row.sourceExcelRow||'—'}}</small></td>
            <td>{{row.port}}<small>{{row.period}} · {{row.eta}}</small></td>
            <td>{{row.nmcRisk?row.nmcRisk.score+'/100 · '+row.nmcRisk.level:copy('NOT ASSESSED','بدون تقييم')}}</td>
            <td>#{{row.ruleRank}}
              <small>{{row.ruleRecommended?copy('Within indicative quota','ضمن الحصة المبدئية'):
                copy('Outside indicative quota','خارج الحصة المبدئية')}}</small></td>
            <td><span class="badge" [class.selected]="row.selectionStatus==='SELECTED'">
              {{statusText(row.selectionStatus)}}</span></td>
            <td><button type="button" (click)="review(row)" [disabled]="busy">
              {{copy('Review Event','مراجعة الحدث')}}</button></td>
          </tr>
          <tr *ngIf="!d.items.length"><td colspan="6" class="empty">
            {{copy('No Port Calls match these filters. Import PSC Excel in Candidate Data Sources.',
              'لا توجد إخطارات مطابقة. ارفع ملف PSC من مصادر بيانات الترشيح.')}}</td></tr>
        </tbody></table></div>
      </section>
      <section class="psc-panel decision" *ngIf="selected as row">
        <h2>{{copy('03 · Explicit PSC Selection Decision','٠٣ · قرار اختيار المعاينة')}}</h2>
        <p><strong>{{row.vesselName}}</strong> · IMO {{row.imo}} · {{row.sourceReference}}
          · {{row.port}} · {{row.period}}</p>
        <p>{{copy('This decision applies to this exact PORT CALL EVENT. Other arrivals of the same vessel stay separate.',
          'يسري هذا القرار على حدث وصول السفينة المحدد فقط، وتظل وصولاتها الأخرى مستقلة.')}}</p>
        <p *ngIf="row.selectionDecision">{{copy('Previous decision','القرار السابق')}}:
          {{statusText(row.selectionStatus)}} · {{row.selectionDecision.actor}} ·
          {{row.selectionDecision.reason}}</p>
        <label>{{copy('Decision officer','مسؤول القرار')}}
          <input [(ngModel)]="actor" maxlength="120" autocomplete="off"/></label>
        <label>{{copy('Reason (minimum 8 characters)','مبرر القرار (٨ أحرف على الأقل)')}}
          <textarea [(ngModel)]="reason" rows="3" maxlength="500"></textarea></label>
        <div class="action-buttons">
          <button class="primary" type="button" (click)="decide('SELECT')" [disabled]="busy||row.selectionStatus==='SELECTED'">
            {{copy('Select for Inspection Review','اختيار للمعاينة')}}</button>
          <button type="button" (click)="decide('NOT_SELECT')" [disabled]="busy||row.selectionStatus==='NOT_SELECTED'">
            {{copy('Do Not Select','عدم الاختيار')}}</button>
        </div>
        <p class="hint">{{copy('Selection requires Publisher authority and capacity. Selection alone does not create an Inspection Case: officer approval remains separate in Candidate Center.',
          'يتطلب الاختيار صلاحية المشرف وتوافر حصة. ولا يُنشئ الاختيار حالة معاينة مباشرة؛ إذ يظل اعتماد الموظف منفصلًا داخل مركز المرشحين.')}}</p>
      </section>
    </main>
  </div>`,
  styleUrl:'./si-psc-targeting-pool.component.css'
})
export class SiPscTargetingPoolComponent implements OnInit{
  data:PscSelectionPool|null=null;selected:PscPoolItem|null=null;
  editorKey='';publisherKey='';periodFilter='';portFilter='';actor='';reason='';
  busy=false;error='';success='';
  constructor(private readonly api:SiPscSelectionService,public readonly lang:LanguageService){}
  ngOnInit():void{}
  copy(en:string,ar:string):string{return this.lang.pick(en,ar);}
  statusText(x:string):string{
    const map:Record<string,string>={
      IN_POOL:'قيد الاستهداف',SELECTED:'تم الاختيار',NOT_SELECTED:'لم يتم الاختيار'
    };
    return this.lang.isArabic?(map[x]||x):x.replaceAll('_',' ');
  }
  load():void{
    if(!this.editorKey.trim()){this.error=this.copy('Editor key required','مطلوب مفتاح المحرر');return;}
    if(this.periodFilter&&!/^20\d\d-(0[1-9]|1[0-2])$/.test(this.periodFilter)){
      this.error=this.copy('Use YYYY-MM period','اكتب الشهر بصيغة YYYY-MM');return;
    }
    this.busy=true;this.error='';
    this.api.pool(this.editorKey.trim(),this.periodFilter||null,this.portFilter||null).subscribe({
      next:r=>{this.data=r;this.busy=false;
        this.selected=r.items.find(x=>x.eventKey===this.selected?.eventKey)||null;},
      error:e=>this.fail(e)
    });
  }
  review(row:PscPoolItem):void{this.selected=row;this.error='';this.success='';}
  decide(action:'SELECT'|'NOT_SELECT'):void{
    if(!this.selected||!this.data||this.busy)return;
    if(!this.publisherKey.trim()||this.actor.trim().length<3||this.reason.trim().length<8){
      this.error=this.copy('Publisher key, officer and reason (8+ characters) are required.',
        'مطلوب مفتاح المشرف واسم المسؤول ومبرر من ٨ أحرف على الأقل.');return;
    }
    if(!window.confirm(this.copy('Record this PSC selection decision? This does not approve an inspection case.',
      'تسجيل قرار اختيار PSC؟ هذا لا يعتمد حالة المعاينة.')))return;
    this.busy=true;this.error='';this.success='';
    this.api.decide(this.publisherKey.trim(),{
      eventKey:this.selected.eventKey,action,actor:this.actor.trim(),
      reason:this.reason.trim(),expectedPolicyVersion:this.data.policy.version
    }).subscribe({
      next:()=>{this.busy=false;this.reason='';
        this.success=this.copy('PSC decision saved. Selected port calls now enter Candidate Center.',
          'تم حفظ قرار PSC؛ الإخطارات المختارة تظهر الآن في مركز المرشحين.');
        this.load();},
      error:e=>this.fail(e)
    });
  }
  private fail(e:any):void{this.busy=false;this.error=e?.error?.error||'PSC_SELECTION_REQUEST_FAILED';}
}
