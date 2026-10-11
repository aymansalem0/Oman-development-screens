import {CommonModule} from '@angular/common';
import {Component,OnDestroy,OnInit} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {RouterLink} from '@angular/router';
import {NmcNavigationComponent} from '../components/nmc-navigation.component';
import {NmcMinistryLogoComponent} from '../components/nmc-ministry-logo.component';
import {LanguageService} from '../services/language.service';
import {NmcIncidentsService,NmcMaritimeIncident,IncidentFeedResponse,
  IncidentFeedHealth,IncidentFollowup} from '../services/nmc-incidents.service';

@Component({
 selector:'app-nmc-incident-center',
 standalone:true,
 imports:[CommonModule,FormsModule,RouterLink,NmcNavigationComponent,NmcMinistryLogoComponent],
 templateUrl:'./nmc-incident-center.component.html',
 styleUrl:'./nmc-incident-center.component.css'
})
export class NmcIncidentCenterComponent implements OnInit,OnDestroy {
 data:IncidentFeedResponse|null=null;
 health:IncidentFeedHealth|null=null;
 loading=false;
 busy=false;
 error='';
 success='';
 selectedId='';
 search='';
 sourceFilter='ALL';
 followupSelection:IncidentFollowup='VERIFY_INFORMATION';
 officer='';
 officerNote='';
 private timer?:ReturnType<typeof setInterval>;
 readonly sourceSheet='https://docs.google.com/spreadsheets/d/1fl6rCjHNTPKZTeS76PLSy_ylrClLQQ0Yvq12A7nhfy8/edit';
 readonly followupOptions:IncidentFollowup[]=[
   'VERIFY_INFORMATION','ACTIVE_MONITORING','REFER_SMART_INSPECTION',
   'ESCALATE_TO_AUTHORITY','INCIDENT_RESPONSE','CLOSE_AFTER_VERIFICATION'
 ];
 constructor(public lang:LanguageService,private readonly incidents:NmcIncidentsService){}
 ngOnInit():void{
  this.refresh();
  this.incidents.health().subscribe({
   next:r=>this.health=r,
   error:()=>this.health=null
  });
  this.timer=setInterval(()=>{if(!this.busy)this.refresh(true);},30000);
 }
 ngOnDestroy():void{if(this.timer)clearInterval(this.timer);}
 copy(en:string,ar:string):string{return this.lang.pick(en,ar);}
 get selected():NmcMaritimeIncident|undefined{
  return this.data?.incidents.find(x=>x.incidentId===this.selectedId);
 }
 get filtered():NmcMaritimeIncident[]{
  const q=this.search.toLowerCase().trim();
  return (this.data?.incidents||[]).filter(x=>
   (this.sourceFilter==='ALL'||x.sourceType===this.sourceFilter)&&
   (!q||[x.incidentId,x.imo||'',x.vesselName,x.incidentType,
      x.portOrZone,x.sourceOrganization,x.description].some(v=>
      (v||'').toLowerCase().includes(q)))).sort((a,b)=>
     (b.receivedAt||'').localeCompare(a.receivedAt||''));
 }
 get assessedCount():number{
  return (this.data?.incidents||[]).filter(x=>!!x.aiAssessment).length;
 }
 get urgentCount():number{
  return (this.data?.incidents||[]).filter(x=>
    x.aiAssessment?.incidentRiskBand==='CRITICAL'||
    x.aiAssessment?.incidentRiskBand==='HIGH').length;
 }
 select(id:string):void{
  this.selectedId=id;this.error='';this.success='';this.officerNote='';
  const a=this.selected?.aiAssessment;
  this.followupSelection=a?.aiProposedFollowup||'VERIFY_INFORMATION';
 }
 refresh(silent=false):void{
  if(!silent)this.loading=true;
  this.incidents.list().subscribe({
   next:d=>{
    const previousAssessmentId=this.selected?.aiAssessment?.assessmentId||null;
    this.data=d;this.loading=false;this.error='';
    if(!this.selectedId||!d.incidents.some(x=>x.incidentId===this.selectedId))
      this.select(d.incidents[0]?.incidentId||'');
    else if((this.selected?.aiAssessment?.assessmentId||null)!==previousAssessmentId)
      this.followupSelection=this.selected?.aiAssessment?.aiProposedFollowup||'VERIFY_INFORMATION';
   },
   error:e=>{this.loading=false;this.error=this.incidents.message(e,this.lang.isArabic);}
  });
 }
 assess(force=false):void{
  const row=this.selected;
  if(!row||this.busy||!row.aiReviewRequested||
     row.aiAssessment?.assessmentStatus==='HUMAN_REVIEWED')return;
  if(!window.confirm(this.copy(
    'Send this synthetic report to the EXISTING Airia A02 compliance then A01 maritime-intelligence pipelines (two paid calls)? These require the incident output extension to be supported. No official vessel-risk changes or enforcement.',
    'هل تريد إرسال البلاغ إلى نفس A02 للامتثال ثم A01 للموقف البحري (استدعاءان عبر Airia)؟ قد ينتج عنه تكلفة ويتطلب دعم مخرجات الحوادث الجديدة. لن تتغير مخاطر السفينة أو تُنفذ عقوبات.')))return;
  this.busy=true;this.error='';this.success='';
  this.incidents.analyze(row.incidentId,force).subscribe({
   next:()=>{
    this.busy=false;
    this.success=this.copy('Incident-specific AI assessment saved in Google Sheets.',
      'تم حفظ تقييم AI الخاص بالحادث في Google Sheets.');
    this.refresh(true);
   },
   error:e=>{
    this.busy=false;this.error=this.incidents.message(e,this.lang.isArabic);
   }
  });
 }
 review(decision:'ACCEPT'|'MODIFY'|'REJECT'):void{
  const row=this.selected;const ai=row?.aiAssessment;
  if(!row||!ai||this.busy||ai.assessmentStatus==='HUMAN_REVIEWED')return;
  const name=this.officer.trim(),reason=this.officerNote.trim();
  if(name.length<3||reason.length<15){this.error=this.copy(
     'Provide an officer name (3+ characters) and documented reason (15+ characters).',
     'أدخل اسم الموظف (3 أحرف على الأقل) وسببًا موثقًا (15 حرفًا على الأقل).');return;}
  const route=decision==='REJECT'?'VERIFY_INFORMATION':this.followupSelection;
  if((decision==='ACCEPT'&&route!==ai.aiProposedFollowup)||
     (decision==='MODIFY'&&route===ai.aiProposedFollowup)){
   this.error=this.copy('For Accept retain the AI suggestion; for Modify select another follow-up.',
    'للاعتماد احتفظ باقتراح AI، وللتعديل اختر متابعة مختلفة.');return;
  }
  if(!window.confirm(this.copy(
    'Save the officer decision in the Google Sheet? This is an advisory POC record only; no inspection referral, port restriction or other action will execute automatically.',
    'هل تريد حفظ قرار الموظف في Google Sheets؟ هذا سجل تجريبي فقط؛ لن تنفذ إحالة أو منع ميناء أو أي إجراء تلقائي.')))return;
  this.busy=true;this.error='';this.success='';
  this.incidents.review(row.incidentId,ai.assessmentId,decision,route,reason,name).subscribe({
   next:()=>{
    this.busy=false;this.success=this.copy(
      'Officer-approved follow-up and next-step state saved in AI_Assessments, preserving the original source status and vessel risk.',
      'تم حفظ المتابعة المعتمدة وحالة الخطوة التالية في AI_Assessments، دون تغيير حالة البلاغ الأصلي أو درجة مخاطر السفينة.');
    this.refresh(true);
   },
   error:e=>{this.busy=false;this.error=this.incidents.message(e,this.lang.isArabic);}
  });
 }
}
