import {CommonModule} from '@angular/common';
import {Component,OnInit} from '@angular/core';
import {ActivatedRoute,RouterLink} from '@angular/router';
import {forkJoin} from 'rxjs';
import {NmcNavigationComponent} from '../components/nmc-navigation.component';
import {NmcPlatformHeaderComponent} from '../components/nmc-platform-chrome.component';
import {LanguageService} from '../services/language.service';
import {SeafarerWorkspaceService,SdbDashboard,SdbCheck,SdbProfile,
 SdbServiceScenario,SdbRequirement,SdbDocumentReview}
 from '../services/seafarer-workspace.service';

@Component({
 selector:'app-moei-sdb-case-detail',standalone:true,
 imports:[CommonModule,RouterLink,NmcNavigationComponent,NmcPlatformHeaderComponent],
 templateUrl:'./moei-sdb-case-detail.component.html',
 styleUrls:['./moei-sdb-customer-services.component.css',
  './moei-sdb-case-detail.component.css']
})
export class MoeiSdbCaseDetailComponent implements OnInit{
 data:SdbDashboard|null=null;scenario:SdbServiceScenario|null=null;
 profile:SdbProfile|null=null;
 requirements:SdbRequirement[]=[];
 loading=true;busy=false;error='';message='';
 readonly scenarioId:string;
 constructor(private api:SeafarerWorkspaceService,public lang:LanguageService,
   private route:ActivatedRoute){
  this.scenarioId=route.snapshot.paramMap.get('scenarioId')||'';
 }
 t(en:string,ar:string){return this.lang.pick(en,ar);}
 get readonlyScenario(){return this.scenarioId!=='self';}
 get readiness(){
  return this.scenario?.readiness||this.profile?.readiness||null;
 }
 get name(){
  return this.scenario?.person.name||this.profile?.name||'';
 }
 get existingSdb(){
  return this.scenario?.existingSdb||this.profile?.existingSdb||null;
 }
 get displayService(){
  return this.readiness?.service==='RENEWAL'?
   this.t('SDB Renewal','تجديد سجل بحار'):
   this.t('First-Time SDB Issuance','إصدار سجل بحار لأول مرة');
 }
 get checks(){return this.readiness?.checks||[];}
 get blockers(){return this.readiness?.blockers||[];}
 get eligibleProfileId(){
  return this.scenario?.profileId||this.profile?.id||'';
 }
 get canContinue(){
  const p=this.data?.profiles.find(p=>p.id===this.eligibleProfileId);
  return this.readiness?.status==='READY'&&p?.readiness.status==='READY'
    &&p?.readiness.service===this.readiness.service;
 }
 get canUpload(){
  return !!this.profile&&this.data?.actor.seafarerId===this.profile.id
   &&!this.data?.actor.operations;
 }
 ngOnInit(){this.load();}
 load(){
  this.loading=true;this.error='';
  if(this.readonlyScenario){
   forkJoin({detail:this.api.demoScenario(this.scenarioId),
      dashboard:this.api.dashboard(),requirements:this.api.publicRequirements()})
    .subscribe({
     next:v=>{this.scenario=v.detail.scenario;this.data=v.dashboard;
       this.requirements=v.requirements.requirements;this.loading=false;},
     error:e=>this.failure(e)
    });
  }else{
   forkJoin({dashboard:this.api.dashboard(),
     requirements:this.api.publicRequirements()}).subscribe({
      next:v=>{
       this.data=v.dashboard;this.profile=v.dashboard.profiles.find(p=>
        p.id===v.dashboard.actor.seafarerId)||null;
       this.requirements=v.requirements.requirements;
       this.loading=false;
       if(!this.profile)this.error=this.t(
        'No seafarer profile is bound to your login.',
        'لا يوجد ملف بحار مرتبط بحسابك.');
      },
      error:e=>this.failure(e)
     });
  }
 }
 failure(e:unknown){
  this.busy=false;this.loading=false;
  const code=(e as {error?:{error?:string}})?.error?.error||'SDB_SERVICE_UNAVAILABLE';
  this.error=this.t('The service could not complete','تعذر إتمام الخدمة')+
   ' ('+code+')';
 }
 status(s:string){
  const v:Record<string,[string,string]>={
   PASS:['Verified','مستوفى'],
   FAIL:['Missing / invalid','ناقص / غير صالح'],
   HOLD:['Authority hold','إيقاف من جهة مسؤولة'],
   PENDING:['Pending verification','قيد التحقق'],
   READY:['Ready','جاهز']
  };
  return v[s]?this.t(...v[s]):s;
 }
 source(source:string){
  const dict:Record<string,[string,string]>={
   ACADEMY:['Maritime Academy','الأكاديمية البحرية'],
   MARASI:['MARASI Medical','مراسي · الكشف الطبي'],
   COMPANY:['Operating Company','الشركة المشغلة'],
   MOI_ICP:['ICP / Identity','الهوية والإقامة'],
   REGISTRY:['Qualification Registry','سجل المؤهلات']
  };
  return dict[source]?this.t(...dict[source]):source;
 }
 label(c:SdbCheck){
  const config=this.requirements.find(r=>
   r.id===(c.policyRequirementId||c.key));
  if(this.lang.isArabic&&config)return config.titleAr;
  return c.label;
 }
 mode(c:SdbCheck){
  const config=this.requirements.find(r=>
   r.id===(c.policyRequirementId||c.key));
  return config?.inputMode||'INTEGRATION';
 }
 modeLabel(c:SdbCheck){
  switch(this.mode(c)){
   case 'ATTACHMENT':return this.t('Attached document','مستند مرفق');
   case 'PLATFORM_ENTRY':return this.t('Platform data entry','إدخال على المنصة');
   default:return this.t('System integration','تكامل إلكتروني');
  }
 }
 action(c:SdbCheck){
  if(c.result==='PASS')return this.t('Verified according to available sandbox evidence.',
    'تم التحقق وفق الأدلة التجريبية المتاحة.');
  if(c.result==='HOLD')return this.t(
   'Hold must be lifted by the issuing academy/company; AI cannot override it.',
   'رفع الإيقاف من مسؤولية الأكاديمية أو الشركة ولا يستطيع AI تجاوزه.');
  if(c.result==='PENDING')return this.t(
   'The configured source must confirm this requirement. If evidence is uncertain, it is queued for AI triage then human review.',
   'يلزم تأكيد الجهة المغذية. وإذا كانت الوثيقة غير مؤكدة تُحال لفرز AI ثم المراجعة البشرية.');
  return this.t('Complete or renew this requirement at its source before applying.',
   'استكمل المتطلب أو جدده لدى الجهة المسؤولة قبل تقديم الطلب.');
 }
 documentFor(c:SdbCheck):SdbDocumentReview|null{
  return (this.profile?.documents||[])
   .filter(d=>d.requirementId===(c.policyRequirementId||c.key))
   .sort((a,b)=>b.submittedAt.localeCompare(a.submittedAt))[0]||null;
 }
 async attach(e:Event,c:SdbCheck){
  const target=e.target as HTMLInputElement;
  const file=target.files?.[0];
  if(!file||!this.canUpload||!this.profile)return;
  target.value='';
  if(!['application/pdf','image/png','image/jpeg'].includes(file.type)
    ||file.size>10*1024*1024){
   this.error=this.t('Use PDF/JPG/PNG under 10 MB.',
     'اختر PDF أو JPG أو PNG أقل من 10 ميجابايت.');return;
  }
  this.busy=true;this.error='';this.message='';
  try{
   const content=await file.arrayBuffer();
   const hash=await crypto.subtle.digest('SHA-256',content);
   const sha256=Array.from(new Uint8Array(hash),v=>v.toString(16).padStart(2,'0')).join('');
   this.api.uploadEvidenceMetadata(this.profile.id,
    c.policyRequirementId||c.key,{filename:file.name,
     mimeType:file.type,size:file.size,sha256}).subscribe({
      next:()=>{
       this.busy=false;this.message=this.t(
        'Evidence fingerprint queued for AI triage; no AI call or document verification has occurred.',
        'تم وضع بصمة المستند في قائمة انتظار مراجعة AI؛ لم يحدث استدعاء نموذج أو تحقق من صحة المستند بعد.');
       this.load();
      },error:x=>this.failure(x)
     });
  }catch(x){this.failure(x);}
 }
}
