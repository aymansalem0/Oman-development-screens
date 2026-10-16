import {CommonModule} from '@angular/common';
import {Component,OnInit} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {RouterLink} from '@angular/router';
import {NmcNavigationComponent} from '../components/nmc-navigation.component';
import {NmcPlatformHeaderComponent} from '../components/nmc-platform-chrome.component';
import {LanguageService} from '../services/language.service';
import {SeafarerWorkspaceService,SdbReadinessSettings,SdbRequirement,
 SdbReviewQueue,SdbInputMode,SdbServiceScope,SdbDocumentReview}
 from '../services/seafarer-workspace.service';

@Component({
 selector:'app-moei-sdb-readiness-settings',standalone:true,
 imports:[CommonModule,FormsModule,RouterLink,NmcNavigationComponent,
  NmcPlatformHeaderComponent],
 templateUrl:'./moei-sdb-readiness-settings.component.html',
 styleUrl:'./moei-sdb-readiness-settings.component.css'
})
export class MoeiSdbReadinessSettingsComponent implements OnInit{
 settings:SdbReadinessSettings|null=null;queue:SdbReviewQueue|null=null;
 selected:SdbRequirement|null=null;newMode=false;
 busy=false;loading=true;error='';notice='';reviewReason='';
 readonly modes:SdbInputMode[]=['INTEGRATION','PLATFORM_ENTRY','ATTACHMENT'];
 readonly scopes:SdbServiceScope[]=['BOTH','FIRST_ISSUE','RENEWAL'];
 readonly sources=['ACADEMY','MARASI','MOI_ICP','COMPANY','REGISTRY','MOEI'];
 filter='ALL';
 constructor(private api:SeafarerWorkspaceService,public lang:LanguageService){}
 ngOnInit(){this.reload();}
 t(en:string,ar:string){return this.lang.pick(en,ar);}
 reload(){
  this.loading=true;this.error='';
  this.api.readinessSettings().subscribe({
   next:conf=>{this.settings=conf;this.loading=false;this.loadQueue();},
   error:e=>this.failure(e)
  });
 }
 loadQueue(){
  this.api.documentQueue().subscribe({
   next:data=>{this.queue=data;},
   error:e=>this.failure(e)
  });
 }
 get items(){
  const items=this.settings?.requirements||[];
  return items.filter(x=>this.filter==='ALL'||(
   this.filter==='CORE'?x.core:this.filter===x.inputMode))
   .sort((a,b)=>a.order-b.order);
 }
 get integrationCount(){return this.settings?.requirements.filter(r=>
  r.inputMode==='INTEGRATION').length||0;}
 get attachmentCount(){return this.settings?.requirements.filter(r=>
  r.inputMode==='ATTACHMENT').length||0;}
 get customCount(){return this.settings?.requirements.filter(r=>!r.core).length||0;}
 modeLabel(mode:SdbInputMode){
  const labels:{[key:string]:[string,string]}={
   INTEGRATION:['System Integration','تكامل إلكتروني'],
   PLATFORM_ENTRY:['Platform Data Entry','إدخال داخل المنصة'],
   ATTACHMENT:['Document Attachment','مستند مرفق']
  };
  return this.t(...labels[mode]);
 }
 scopeLabel(scope:SdbServiceScope){
  switch(scope){
   case 'FIRST_ISSUE':return this.t('First Issue','إصدار أول');
   case 'RENEWAL':return this.t('Renewal','تجديد');
   default:return this.t('Both','الاثنان');
  }
 }
 add(){
  this.newMode=true;this.notice='';
  this.selected={id:'',title:'',titleAr:'',source:'ACADEMY',
   inputMode:'ATTACHMENT',scope:'BOTH',active:true,
   mandatory:true,core:false,reviewUncertain:true,
   order:(this.settings?.requirements.length||0)+1};
 }
 edit(r:SdbRequirement){this.newMode=false;this.selected={...r};this.notice='';}
 close(){this.selected=null;this.newMode=false;}
 save(){
  if(!this.selected||this.busy)return;
  this.busy=true;this.notice='';this.error='';
  this.api.saveRequirement(this.selected).subscribe({
   next:v=>{this.settings=v;this.busy=false;this.close();this.notice=
     this.t('Configuration saved. Readiness re-evaluated for sandbox seafarers.',
      'تم حفظ الإعداد وإعادة حساب جاهزية البحارة التجريبية.');},
   error:e=>this.failure(e)
  });
 }
 review(d:SdbDocumentReview,decision:'HUMAN_VERIFIED'|'REJECTED'){
  if(this.busy)return;
  if(!this.reviewReason.trim()){
   this.error=this.t('Enter an explicit review reason.',
    'أدخل سببًا واضحًا لقرار المراجعة.');return;
  }
  this.busy=true;this.error='';this.notice='';
  this.api.reviewEvidence(d.id,decision,this.reviewReason).subscribe({
   next:()=>{
    this.busy=false;this.reviewReason='';
    this.notice=this.t('Human review recorded and readiness recalculated.',
     'تم تسجيل المراجعة البشرية وإعادة حساب الجاهزية.');
    this.loadQueue();
   },error:e=>this.failure(e)
  });
 }
 failure(e:unknown){
  this.loading=false;this.busy=false;
  const code=(e as {error?:{error?:string}})?.error?.error||
   'SDB_SERVICE_UNAVAILABLE';
  this.error=this.t('Action failed','تعذر تنفيذ العملية')+' ('+code+')';
 }
}
