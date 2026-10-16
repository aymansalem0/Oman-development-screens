import {CommonModule} from '@angular/common';
import {Component,OnInit} from '@angular/core';
import {Router,RouterLink} from '@angular/router';
import {NmcNavigationComponent} from '../components/nmc-navigation.component';
import {NmcPlatformHeaderComponent} from '../components/nmc-platform-chrome.component';
import {LanguageService} from '../services/language.service';
import {
 SeafarerWorkspaceService,SdbDashboard,SdbServiceScenario,SdbCheck,SdbProfile
} from '../services/seafarer-workspace.service';

/**
 * Customer SDB entry point, intentionally separate from the internal
 * Pre-Application Readiness operations workbench.
 * Scenario selection is read-only and restricted by API to POC operators.
 * Real application mutations remain in the existing applicant-bound wizard.
 */
@Component({
 selector:'app-moei-sdb-customer-services',standalone:true,
 imports:[CommonModule,RouterLink,NmcNavigationComponent,NmcPlatformHeaderComponent],
 templateUrl:'./moei-sdb-customer-services.component.html',
 styleUrl:'./moei-sdb-customer-services.component.css'
})
export class MoeiSdbCustomerServicesComponent implements OnInit{
 data:SdbDashboard|null=null;
 scenarios:SdbServiceScenario[]=[];
 selected:SdbServiceScenario|null=null;
 loading=true;scenariosLoading=false;showCases=false;error='';
 filter:'ALL'|'FIRST_ISSUE'|'RENEWAL'='ALL';
 constructor(private api:SeafarerWorkspaceService,public lang:LanguageService,
 private router:Router){}
 ngOnInit():void{this.load();}
 t(en:string,ar:string):string{return this.lang.pick(en,ar);}
 load():void{
  this.loading=true;this.error='';
  this.api.dashboard().subscribe({
   next:d=>{this.data=d;this.loading=false;},
   error:e=>{this.loading=false;this.error=this.errorLabel(e);}
  });
 }
 get myProfile():SdbProfile|null{
  if(this.data?.actor.operations)return null;
  return this.data?.profiles.find(p=>p.id===this.data?.actor.seafarerId)||
   this.data?.profiles[0]||null;
 }
 get filteredScenarios():SdbServiceScenario[]{
  return this.scenarios.filter(s=>
   this.filter==='ALL'||s.readiness.service===this.filter);
 }
 get issueCount():number{
  return this.scenarios.filter(s=>s.readiness.service==='FIRST_ISSUE').length;
 }
 get renewalCount():number{
  return this.scenarios.filter(s=>s.readiness.service==='RENEWAL').length;
 }
 selectFilter(filter:'ALL'|'FIRST_ISSUE'|'RENEWAL'):void{
  this.filter=filter;this.selected=null;
 }
 startService():void{
  this.showCases=true;this.selected=null;
  if(!this.data?.actor.operations){
    void this.router.navigate(['/moei/seafarers/services/case','self']);
    return;
  }
  if(this.scenarios.length)return;
  this.scenariosLoading=true;this.error='';
  this.api.demoScenarios().subscribe({
   next:d=>{this.scenarios=d.scenarios;this.scenariosLoading=false;},
   error:e=>{this.scenariosLoading=false;this.error=this.errorLabel(e);}
  });
 }
 choose(s:SdbServiceScenario):void{
  // Open an independent page for missing requirements; a verified READY
  // applicant goes straight into the pre-existing guarded SDB wizard.
  // Preview scenario status alone can never authorize an application.
  if(this.proceedAllowed(s)){
    void this.router.navigate(['/moei/seafarers/sdb',s.profileId]);
  }else{
    void this.router.navigate(['/moei/seafarers/services/case',s.id]);
  }
 }
 proceedAllowed(s:SdbServiceScenario):boolean{
  if(!s.canContinue)return false;
  // The hypothetical POC scenario must NEVER override the live applicant
  // gate; genuine server source readiness gets checked again at POST/payment.
  const p=this.data?.profiles.find(p=>p.id===s.profileId);
  return p?.readiness.status==='READY'&&
   p.readiness.service===s.readiness.service;
 }
 get issuedProfileCount():number{
  return this.data?.profiles.filter(p=>!!p.existingSdb).length||0;
 }
 isRenewal(s:SdbServiceScenario):boolean{
  return !!s.existingSdb;
 }
 statusLabel(status:string):string{
  const labels:Record<string,[string,string]>={
   READY:['Ready to apply','جاهز للتقديم'],
   INCOMPLETE:['Requirements missing','متطلبات ناقصة'],
   ON_HOLD:['On hold','موقوف مؤقتًا'],
   PENDING_VERIFICATION:['Pending verification','بانتظار التحقق'],
   PASS:['Verified','مستوفٍ'],
   FAIL:['Action required','يتطلب إجراء'],
   HOLD:['Hold','إيقاف'],
   PENDING:['Pending source','بانتظار المصدر']
  };
  const v=labels[status];return v?this.t(v[0],v[1]):status;
 }
 serviceLabel(service:string):string{
  return service==='RENEWAL'?
   this.t('Renew existing SDB','تجديد سجل البحار'):
   this.t('First-time SDB issuance','إصدار سجل البحار لأول مرة');
 }
 sourceLabel(source:string):string{
  const values:Record<string,[string,string]>={
   ACADEMY:['Maritime Academy','الأكاديمية البحرية'],
   MARASI:['MARASI Medical','مراسي · الكشف الطبي'],
   COMPANY:['Operating Company','الشركة المشغلة'],
   MOI_ICP:['ICP / UAE PASS','الهوية والإقامة / الهوية الرقمية'],
   REGISTRY:['Qualification Registry','سجل المؤهلات']
  };
  const v=values[source];return v?this.t(v[0],v[1]):source;
 }
 checkLabel(check:SdbCheck):string{
  if(!this.lang.isArabic)return check.label;
  if(check.key.startsWith('SOURCE-'))return 'تحقق بيانات '+this.sourceLabel(check.source);
  if(check.key.startsWith('COP-'))return 'شهادة السلامة '+check.key.slice(4);
  const named:Record<string,string>={
   MEDICAL:'اللياقة الطبية',PASSPORT:'جواز السفر',
   PHOTO:'الصورة الشخصية','CLEARANCE-ACADEMY':'عدم ممانعة الأكاديمية',
   'CLEARANCE-COMPANY':'عدم ممانعة الشركة المشغلة',
   COC:'شهادة الكفاءة',ENDORSEMENT:'اعتماد الشهادة'
  };
  return named[check.key]||check.label;
 }
 checkAction(check:SdbCheck):string{
  if(!this.lang.isArabic)return check.reason;
  if(check.result==='PASS')return 'تم التحقق من المصدر المعتمد في السيناريو التجريبي.';
  if(check.key.startsWith('COP-'))return 'استكمال الشهادة أو تحديث صلاحيتها لدى الأكاديمية.';
  if(check.key==='MEDICAL')return 'إجراء أو تجديد الكشف الطبي وإرسال النتيجة من مراسي.';
  if(check.key==='CLEARANCE-ACADEMY')
   return check.result==='HOLD'?'الإيقاف صادر من الأكاديمية؛ يلزم رفعه من الجهة المسؤولة.':
    'بانتظار قرار عدم ممانعة الأكاديمية.';
  if(check.key==='CLEARANCE-COMPANY')
   return check.result==='HOLD'?'إيقاف الشركة المشغلة؛ لا يمكن للعميل تجاوزه.':
    'بانتظار عدم ممانعة الشركة.';
  if(check.key==='PASSPORT')return 'تحديث أو التحقق من جواز السفر.';
  if(check.key==='PHOTO')return 'ربط الصورة الشخصية الموثقة.';
  if(check.key.startsWith('SOURCE-'))return 'يلزم تحديث التحقق من المصدر.';
  return 'استكمال المتطلب والتحقق منه لدى الجهة المسؤولة.';
 }
 errorLabel(e:unknown):string{
  const v=(e as {error?:{error?:string}})?.error?.error;
  return this.t('The service could not load.','تعذر تحميل الخدمة.')+
   (v?' ('+v+')':'');
 }
}
