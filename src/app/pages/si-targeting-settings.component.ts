import {CommonModule} from '@angular/common';
import {Component,OnInit} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {RouterLink} from '@angular/router';
import {NmcNavigationComponent} from '../components/nmc-navigation.component';
import {LanguageService} from '../services/language.service';
import {SiCandidateTargetingService,SiDashboard,SiImpact,SiTargetingPolicyConfig} from '../services/si-candidate-targeting.service';

/** Entry rules ≠ execution ranking. Operational rules, not NMC vessel risk. */
@Component({
 selector:'app-si-targeting-settings',
 standalone:true,imports:[CommonModule,FormsModule,RouterLink,NmcNavigationComponent],
 template:`
 <div class="si-layout" [attr.dir]="lang.dir">
  <app-nmc-navigation></app-nmc-navigation>
  <main class="settings-main">
   <header class="heading">
    <div>
     <small>{{copy('SETTINGS / SMART INSPECTION','الإعدادات / المعاينة الذكية')}}</small>
     <h1>{{copy('Inspection Entry & Vessel Ranking','قواعد دخول المعاينة وترتيب السفن')}}</h1>
     <p>{{copy('Two separate business decisions. Entry determines which requests are eligible; ranking orders eligible vessels by verified operational signals.',
      'قراران مستقلان: قواعد الدخول تحدد السفن المؤهلة؛ وقواعد الترتيب ترتب السفن المؤهلة وفق بيانات تشغيلية موثقة.')}}</p>
    </div>
    <div class="actions">
     <a routerLink="/moei/smart-inspection/candidates">{{copy('Candidate Center','قائمة المرشحين')}}</a>
     <button type="button" (click)="refresh()" [disabled]="busy||loading">{{copy('Refresh','تحديث')}}</button>
    </div>
   </header>
   <p *ngIf="error" class="notice error" role="alert">{{error}}</p>
   <p *ngIf="success" class="notice success" role="status">{{success}}</p>
   <p *ngIf="loading" class="notice">{{copy('Loading inspection policy…','تحميل سياسة المعاينات…')}}</p>
   <section class="stats" *ngIf="dashboard as d">
    <article><small>{{copy('PUBLISHED POLICY','إصدار السياسة')}}</small><strong>v{{d.policy.version}}</strong></article>
    <article><small>{{copy('PENDING CANDIDATES','المرشحون المنتظرون')}}</small><strong>{{d.summary.pendingVessels}}</strong></article>
    <article><small>{{copy('AVAILABLE VESSEL SOURCES','مصادر السفن')}}</small><strong>3</strong></article>
   </section>
   <nav class="policy-tabs" aria-label="Inspection rules">
    <button type="button" [class.active]="tab==='ENTRY'" (click)="tab='ENTRY'">
     {{copy('01 · Inspection Entry Rules','٠١ · قواعد دخول المعاينة')}}</button>
    <button type="button" [class.active]="tab==='RANKING'" (click)="tab='RANKING'">
     {{copy('02 · Vessel Ranking Rules','٠٢ · قواعد ترتيب السفن')}}</button>
   </nav>
   <section class="panel" *ngIf="tab==='ENTRY'">
    <h2>{{copy('Inspection Eligibility & Candidate Entry','شروط دخول السفن إلى قائمة المعاينة')}}</h2>
    <p>{{copy('Inclusion is based on validated source workflows, not on ETD, incident score or NMC vessel risk. Rules are enforced by each source integration.',
     'يتم الإدراج طبقًا لمسار مصدر الطلب، وليس حسب موعد المغادرة أو درجة الحادث أو مخاطر السفينة.')}}</p>
    <div class="rule">
     <div class="position">1</div><div>
      <strong>{{copy('NMC Approved Referral','إحالة NMC المعتمدة')}}</strong>
      <small>{{copy('Human-approved active referral. Protected mandatory inclusion; do not infer authorization from AI.',
       'إحالة نشطة معتمدة بشريًا، تُحمى عند الإدراج ولا يمنح AI أي اعتماد.')}}</small></div>
     <span class="status">{{copy('Source-gated','بحسب المصدر')}}</span>
    </div>
    <div class="rule">
     <div class="position">2</div><div>
      <strong>{{copy('Maritime Service Request','طلب خدمة بحرية')}}</strong>
      <small>{{copy('Every actionable pending service request is eligible regardless of low/missing NMC risk. Duplicate or handled events do not create new cases.',
       'كل طلب خدمة صالح ومعلّق مؤهل بغض النظر عن انخفاض أو غياب المخاطر؛ مع منع التكرار.')}}</small></div>
     <span class="status">{{copy('Source-gated','بحسب المصدر')}}</span>
    </div>
    <div class="rule">
     <div class="position">3</div><div>
      <strong>{{copy('PSC Port Call','سفينة PSC')}}</strong>
      <small>{{copy('Only port calls selected under the separate PSC quota/targeting policy become candidates.',
       'يُدرج فقط ما تم اختياره وفق سياسة PSC والحصص المستقلة.')}}</small></div>
     <a routerLink="/moei/smart-inspection/settings/psc-quotas" class="policy-link">{{copy('PSC settings','إعدادات PSC')}}</a>
    </div>
    <p class="helper">{{copy('Entry rules do not decide execution order. Final inspection plan approval remains with the authorised supervisor.',
      'قواعد الدخول لا تحدد ترتيب التنفيذ، واعتماد خطة المعاينة يظل من اختصاص المسؤول المخول.')}}</p>
   </section>
   <section class="panel" *ngIf="tab==='RANKING'">
    <h2>{{copy('Vessel Execution Ranking','ترتيب تنفيذ معاينات السفن')}}</h2>
    <p>{{copy('Ordered, non-weighted rules: apply criterion 1, then criterion 2. No 100% normalization or source score. More criteria have not yet been specified.',
     'قواعد متتابعة بلا أوزان: أولاً المعيار الأول، ثم الثاني. لا تطبيع للنسب أو درجات مصادر؛ ولم تُحدد بقية المعايير بعد.')}}</p>
    <div class="rule"><div class="position">1</div><div>
     <strong>{{copy('Vessels approaching departure (ETD)','السفن التي قاربت على المغادرة')}}</strong>
     <small>{{copy('Ascending verified future departure time: sooner ETD first. Arrival ETA is not departure. No unsupported departure window is invented.',
      'ترتيب تصاعدي لموعد المغادرة الفعلي الموثق ETD. موعد الوصول ETA لا يُستخدم بديلاً للمغادرة.')}}</small>
    </div><span class="status">{{copy('Primary','الأول')}}</span></div>
    <div class="rule"><div class="position">2</div><div>
     <strong>{{copy('Vessels with maritime incidents','السفن المرتبطة بحوادث بحرية')}}</strong>
     <small>{{copy('For remaining vessels, descending NMC incident-specific severity from a current human-reviewed incident, not the general vessel risk score.',
      'للسفن الباقية، الأشد أولاً وفق درجة خطورة الحادث المعتمدة بشريًا في NMC، وليس درجة مخاطر السفينة العامة.')}}</small>
    </div><span class="status">{{copy('Secondary','الثاني')}}</span></div>
    <div class="rule pending"><div class="position">3</div><div>
     <strong>{{copy('Additional criteria — awaiting MOEI definition','بقية معايير الترتيب — بانتظار استكمال التعريف')}}</strong>
     <small>{{copy('Until defined, vessels with no verified ETD or incident data stay visible in stable IMO order with missing-data explanation. Never fabricate a date or severity.',
      'حتى اعتماد باقي المعايير، تظهر السفن بلا موعد مغادرة أو حادث معتمد بترتيب IMO ثابت مع توضيح البيانات الناقصة.')}}</small>
    </div></div>
    <p class="helper">{{copy('This policy is versioned. Preview and publish do not run Airia; run C01 explicitly on a draft plan to apply new source data. Approved plans remain frozen.',
     'السياسة مؤرشفة بالإصدارات. المعاينة والنشر لا يشغلان Airia؛ يتطلب التحديث إعادة تشغيل C01 على مسودة فقط، وتظل الخطط المعتمدة محفوظة.')}}</p>
    <button class="primary" type="button" (click)="preview()" [disabled]="busy||loading||!dashboard">{{copy('Preview Priority Policy','معاينة سياسة الترتيب')}}</button>
    <section class="impact" *ngIf="impact as p">
     <strong>{{copy('Policy preview — no AI calls','معاينة السياسة — بدون استدعاءات AI')}}</strong>
     <p>{{p.evaluatedPopulation}} {{copy('tracked vessels','سفينة مسجلة')}} ·
        {{p.potentialRankingCandidates||0}} {{copy('candidates may require reranking','قد تحتاج إعادة ترتيب')}}</p>
     <small>{{copy('Unverified ETD and incident severity are not scored. Preview is not approval.',
      'لا تُحسب مواعيد المغادرة أو الحوادث غير الموثقة؛ هذه المعاينة ليست اعتمادًا.')}}</small>
    </section>
    <div class="publication">
     <h3>{{copy('Controlled Publication','النشر المعتمد')}}</h3>
     <label>{{copy('Business justification (min. 8 characters)','مبرر إداري (٨ أحرف على الأقل)')}}
       <textarea [(ngModel)]="reason" rows="2" maxlength="500"></textarea></label>
     <button class="primary" type="button" [disabled]="busy||!impact" (click)="publish()">
       {{copy('Publish Ranking Policy Version','نشر إصدار سياسة الترتيب')}}</button>
    </div>
   </section>
  </main>
 </div>
 `,
 styles:[`
 :host{display:block;background:#eef4f7;min-height:calc(100vh - 82px);color:#1e4156}
 .si-layout{display:flex;min-height:calc(100vh - 82px)}
 .settings-main{flex:1;min-width:0;max-width:1440px;margin:auto;padding:26px 30px 48px}
 .heading{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;border-bottom:1px solid #d8e6ed;padding-bottom:22px}
 .heading small{font-size:11px;color:#08756d;font-weight:800}
 .heading h1{color:#153951;font-size:25px;margin:9px 0}
 .heading p,.panel p{font-size:12px;color:#5d7c8b;line-height:1.75}
 .actions{display:flex;gap:9px;align-items:center}
 .actions a,.actions button,.policy-tabs button{padding:10px 14px;border:1px solid #c7dfe5;border-radius:9px;background:white;color:#156374;font-size:12px;font-weight:750;text-decoration:none;cursor:pointer}
 .stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;margin:19px 0}
 .stats article,.panel{background:white;border:1px solid #d7e7ee;border-radius:13px;padding:22px;box-shadow:0 4px 15px #173b500b}
 .stats small{display:block;font-size:10px;color:#628092;font-weight:800}
 .stats strong{display:block;font-size:27px;margin-top:8px;color:#09697b}
 .policy-tabs{display:flex;gap:10px;margin:16px 0}
 .policy-tabs button.active{background:#087c76;color:white;border-color:#087c76}
 .panel h2{font-size:18px;color:#14516c;margin:0 0 12px}
 .panel h3{font-size:15px;color:#16516b}
 .rule{display:grid;grid-template-columns:44px minmax(0,1fr) auto;gap:17px;align-items:center;border-bottom:1px solid #e2edf0;padding:18px 4px}
 .rule strong{font-size:14px;display:block;color:#19445d}
 .rule small{font-size:11px;display:block;color:#688394;line-height:1.6;margin-top:7px;max-width:760px}
 .position{width:40px;height:40px;display:grid;place-items:center;border-radius:11px;background:#e8f7f4;color:#08756d;font-size:19px;font-weight:800}
 .status{font-size:11px;color:#0d6d6a;font-weight:800;white-space:nowrap}
 .policy-link{font-size:11px;color:#08777f;text-decoration:underline}
 .pending{background:#fafbfc}.pending .position{background:#f2f4f5;color:#8a969a}
 .helper{padding:13px 15px;background:#f2f8fa;border-radius:9px;margin:18px 0}
 .primary{background:#087d84;color:#fff;border:0;border-radius:8px;padding:12px 15px;font-weight:800;cursor:pointer;margin-top:12px}
 button:disabled{opacity:.5;cursor:not-allowed}
 .publication{border-top:1px solid #dfebee;margin-top:20px;padding-top:15px}
 label{display:block;margin-top:14px;font-size:12px;font-weight:700;color:#365c6c}
 textarea{display:block;box-sizing:border-box;width:100%;border:1px solid #cfdfe6;border-radius:9px;padding:10px;margin-top:7px;color:#193c50}
 .notice,.impact{padding:12px 15px;background:#e6f2f8;border-radius:9px;margin:16px 0}
 .error{background:#fff0ed;color:#a83131}.success{background:#e3f7e9;color:#186c43}
 .impact{background:#edf8f5;color:#155e57}.impact strong{font-size:12px}
 @media(max-width:900px){.si-layout{display:block}.settings-main{padding:16px}.heading{flex-direction:column}.rule{grid-template-columns:40px 1fr}.rule .status,.rule .policy-link{grid-column:2}.stats{grid-template-columns:1fr}}
 `]
})
export class SiTargetingSettingsComponent implements OnInit{
 tab:'ENTRY'|'RANKING'='ENTRY';
 dashboard:SiDashboard|null=null;impact:SiImpact|null=null;
 loading=false;busy=false;error='';success='';
 reviewer='admin';reason='';editorKey='MOEI_SESSION';publisherKey='MOEI_SESSION';
 constructor(private readonly api:SiCandidateTargetingService,public readonly lang:LanguageService){}
 copy(en:string,ar:string):string{return this.lang.pick(en,ar);}
 ngOnInit():void{this.refresh();}
 refresh():void{
  this.loading=true;this.error='';this.impact=null;
  this.api.dashboard().subscribe({
    next:d=>{this.dashboard=d;this.loading=false;},
    error:e=>{this.showError(e);this.loading=false;}
  });
 }
 private showError(e:unknown):void{
  const value=e as {error?:{error?:string}};
  this.error=value?.error?.error||this.copy('Unable to load/save policy','تعذر تحميل أو حفظ السياسة');
  this.busy=false;this.success='';
 }
 private rankingConfig():SiTargetingPolicyConfig{
  return {ranking:{criteria:['DEPARTURE_SOON','INCIDENT_SEVERITY']}};
 }
 preview():void{
  if(!this.dashboard||this.busy)return;
  this.busy=true;this.error='';this.success='';this.impact=null;
  this.api.preview(this.rankingConfig(),this.editorKey).subscribe({
   next:p=>{this.impact=p;this.busy=false;},error:e=>this.showError(e)
  });
 }
 publish():void{
  if(!this.dashboard||!this.impact||this.busy)return;
  if(this.reason.trim().length<8){
   this.error=this.copy('Provide an 8-character business justification','أدخل مبررًا إداريًا لا يقل عن ٨ أحرف');return;
  }
  if(!window.confirm(this.copy('Publish this separate ranking policy? Existing approved plans will not change.',
   'نشر سياسة الترتيب المستقلة؟ لن تتغير الخطط المعتمدة السابقة.')))return;
  this.busy=true;this.error='';
  this.api.publish({config:this.rankingConfig(),expectedVersion:this.dashboard.policy.version,
    publishedBy:this.reviewer,reason:this.reason.trim()},this.publisherKey).subscribe({
   next:()=>{this.busy=false;this.reason='';this.refresh();this.success=
     this.copy('Ranking policy version published','تم نشر إصدار سياسة الترتيب');},
   error:e=>this.showError(e)
  });
 }
}
