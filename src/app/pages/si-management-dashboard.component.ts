import {CommonModule} from '@angular/common';
import {Component} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {RouterLink} from '@angular/router';
import {NmcNavigationComponent} from '../components/nmc-navigation.component';
import {LanguageService} from '../services/language.service';
import {SiManagementService,SiManagementReport,SiManagementCase} from '../services/si-management.service';

@Component({
 selector:'app-si-management-dashboard',
 standalone:true,
 imports:[CommonModule,FormsModule,RouterLink,NmcNavigationComponent],
 templateUrl:'./si-management-dashboard.component.html',
 styleUrl:'./si-management-dashboard.component.css'
})
export class SiManagementDashboardComponent{
 editorKey='MOEI_SESSION';busy=false;error='';report:SiManagementReport|null=null;
 search='';stage='ALL';regime='ALL';inspector='ALL';
 constructor(private api:SiManagementService,public lang:LanguageService){this.load();}
 copy(en:string,ar:string):string{return this.lang.pick(en,ar);}
 load():void{
  if(!this.editorKey.trim()){
   this.error=this.copy('Enter the Dashboard Editor key to view saved inspection records.',
     'أدخل مفتاح المحرر لعرض سجلات المعاينات المحفوظة.');return;
  }
  this.busy=true;this.error='';
  this.api.load(this.editorKey.trim()).subscribe({
   next:r=>{this.report=r;this.busy=false;},
   error:e=>{this.busy=false;this.error=e?.error?.error||
    this.copy('Unable to retrieve saved inspection statistics.',
      'تعذر استرجاع إحصاءات المعاينات المحفوظة.');}
  });
 }
 get cards():{titleEn:string;titleAr:string;value:number|null;helpEn:string;helpAr:string;important?:boolean}[]{
  const k=this.report?.kpis;
  return [
   {titleEn:'Candidate Vessels',titleAr:'السفن المرشحة',
     value:k?.uniqueCandidateVessels??null,
     helpEn:'Current approved source queue',helpAr:'قائمة الترشيحات الحالية'},
   {titleEn:'Pending Officer Review',titleAr:'بانتظار مراجعة الموظف',
     value:k?.pendingCandidateVessels??null,
     helpEn:'Distinct vessel candidates',helpAr:'سفن مرشحة غير مكررة'},
   {titleEn:'Approved Inspection Cases',titleAr:'حالات المعاينة المعتمدة',
     value:k?.approvedCases??null,helpEn:'Persisted case registry',
     helpAr:'سجل حالات المعاينة المحفوظ'},
   {titleEn:'In Progress',titleAr:'معاينات قيد التنفيذ',value:k?.inProgressCases??null,
     helpEn:'Started; not yet closed',helpAr:'بدأت ولم تغلق'},
   {titleEn:'Awaiting Report Review',titleAr:'تقارير تنتظر المراجعة',
     value:k?.pendingReportReview??null,helpEn:'Supervisor workload',
     helpAr:'عبء مراجعة المشرف'},
   {titleEn:'Open Corrective Actions',titleAr:'إجراءات تصحيحية مفتوحة',
     value:k?.openCorrectiveActions??null,helpEn:'Not independently verified',
     helpAr:'لم تُعتمد إجراءات التحقق'},
   {titleEn:'Overdue Corrections',titleAr:'إجراءات تصحيحية متأخرة',
     value:k?.overdueCorrectiveActions??null,helpEn:'Due before report date',
     helpAr:'تجاوزت تاريخ الاستحقاق',important:true},
   {titleEn:'Major & Critical Findings',titleAr:'ملاحظات كبيرة وحرجة',
     value:k?(k.majorFindings+k.criticalFindings):null,
     helpEn:'Saved confirmed inspector findings',
     helpAr:'ملاحظات المفتش المسجلة'},
   {titleEn:'Closed Inspections',titleAr:'معاينات مغلقة',
     value:k?.closedCases??null,helpEn:'Supervisor-confirmed closure',
     helpAr:'إغلاق معتمد من المشرف'},
   {titleEn:'Recurring Deficiency Vessels',titleAr:'سفن بملاحظات متكررة',
     value:k?.repeatDeficiencyVessels??null,
     helpEn:'Same check on same IMO across cases',
     helpAr:'نفس البند لنفس السفينة في حالات متعددة'}
  ];
 }
 get allStages():string[]{return this.report?.byStage
   .filter(x=>x.count>0).map(x=>x.stage)||[];}
 get allRegimes():string[]{return this.report?.byRegime.map(x=>x.regime)||[];}
 get allInspectors():string[]{return this.report?.workload.map(x=>x.inspector)||[];}
 get filteredCases():SiManagementCase[]{
  const search=this.search.trim().toLowerCase();
  return (this.report?.cases||[]).filter(c=>
   (this.stage==='ALL'||this.stage===c.stage)&&
   (this.regime==='ALL'||this.regime===c.regime)&&
   (this.inspector==='ALL'||this.inspector===c.inspector)&&
   (!search||[c.id,c.imo,c.vesselName,c.regime,c.stage,c.inspector||'']
    .some(s=>s.toLowerCase().includes(search))));
 }
 get largestStageCount():number{
  return Math.max(1,...(this.report?.byStage.map(x=>x.count)||[]));
 }
 get maxFindingCount():number{
  return Math.max(1,...(this.report?.recurringChecks.map(x=>x.findings)||[]));
 }
 asPercent(v:number,total:number):number{
  return Math.max(0,Math.min(100,(v/Math.max(1,total))*100));
 }
 stageName(stage:string):string{return this.lang.isArabic?
  ({'NOT_STARTED':'لم تبدأ','PREPARATION_READY':'التحضير مكتمل',
   'SCOPE_APPROVED':'تم اعتماد النطاق','ASSIGNED':'تم التكليف',
   'IN_FIELD':'جارية ميدانيًا','REPORT_PENDING_REVIEW':'التقرير قيد المراجعة',
   'REPORT_RETURNED':'تقرير مُعاد','REPORT_APPROVED':'تقرير معتمد',
   'ACTIONS_OPEN':'إجراءات تصحيحية','FOLLOW_UP_PENDING':'متابعة',
   'READY_TO_CLOSE':'جاهزة للإغلاق','CLOSED':'مغلقة'} as Record<string,string>)[stage]||stage:
    stage.replaceAll('_',' ');}
 clearFilters():void{this.search='';this.stage='ALL';this.regime='ALL';this.inspector='ALL';}
 trackCase(_i:number,c:SiManagementCase):string{return c.id;}
 display(v:number|null|undefined):string{return v===null||v===undefined?'—':
   v.toLocaleString('en-US');}
}
