import {CommonModule} from '@angular/common';
import {Component,OnInit} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {ActivatedRoute,RouterLink} from '@angular/router';
import {NmcNavigationComponent} from '../components/nmc-navigation.component';
import {LanguageService} from '../services/language.service';
import {
 SiLifecycleService,SiLifecycleCase,SiLifecycleView,SiLifecycleRecord,SiInspectionCheck,SiCorrection
} from '../services/si-lifecycle.service';

interface DraftCheck extends SiInspectionCheck{evidenceText:string;}
interface DraftAction{findingId:string;owner:string;dueDate:string;instruction:string;}
@Component({
 selector:'app-si-full-lifecycle',standalone:true,
 imports:[CommonModule,FormsModule,RouterLink,NmcNavigationComponent],
 templateUrl:'./si-full-lifecycle.component.html',
 styleUrl:'./si-full-lifecycle.component.css'
})
export class SiFullLifecycleComponent implements OnInit{
 readonly steps=[
  ['01','PSC targeting & sources','استهداف PSC والمصادر'],
  ['02','Candidate / eligibility','الترشيح والأهلية'],
  ['03','Human approval & SI-P01','اعتماد المعاينة وترتيبها'],
  ['04','Pre-inspection dossier / A04','ملف ما قبل المعاينة A04'],
  ['05','Dynamic scope approval','اعتماد نطاق المعاينة'],
  ['06','Scheduling & assignment','الجدولة والتكليف'],
  ['07','Inspector readiness & field work','الاستعداد والتنفيذ الميداني'],
  ['08','Evidence / deficiencies','الأدلة والمخالفات'],
  ['09','Report & supervisor review','التقرير ومراجعته'],
  ['10','Corrective actions & follow-up','الإجراءات التصحيحية والمتابعة'],
  ['11','Compliance handoff & closure','تحديث الامتثال والإغلاق']
 ];
 readonly baseStages=[
   'PREPARATION_READY','SCOPE_APPROVED','ASSIGNED','IN_FIELD',
   'REPORT_PENDING_REVIEW','REPORT_APPROVED','ACTIONS_OPEN','FOLLOW_UP_PENDING',
   'READY_TO_CLOSE','CLOSED'
 ];
 caseId='';cases:SiLifecycleCase[]=[];view:SiLifecycleView|null=null;
 loading=false;busy=false;error='';success='';search='';
 operator='';editorKey='';publisherKey='';reason='';
 inspector='';port='Jebel Ali';visitLocal='';assignmentMode:'POC_MANUAL'|'NMC_SCHEDULED'='POC_MANUAL';
 scopeChosen:string[]=[];draftChecks:DraftCheck[]=[];reportSummary='';
 draftActions:DraftAction[]=[];
 correctionEvidence:Record<string,string>={};correctionDecision:Record<string,'ACCEPT'|'REJECT'>={};
 followMode:'DESK_REVIEW'|'ON_SITE'='DESK_REVIEW';
 followResult:'PASS'|'FAIL'='PASS';followEvidence='';
 constructor(private route:ActivatedRoute,private api:SiLifecycleService,public lang:LanguageService){
  const d=new Date(Date.now()+86400000);
  this.visitLocal=d.toISOString().slice(0,10)+'T09:00';
 }
 copy(en:string,ar:string){return this.lang.pick(en,ar);}
 ngOnInit(){
  this.caseId=this.route.snapshot.paramMap.get('caseId')||'';
  // Credentials are intentionally never persisted into localStorage.
 }
 get record():SiLifecycleRecord|null{return this.view?.record||null;}
 get stage():string{return this.record?.stage||'NOT_STARTED';}
 get nmcOrigin():boolean{return Boolean(this.view?.inspectionCase?.nmcReferralId);}
 get prepared():boolean{return ['PREPARED','APPROVED'].includes(this.view?.preparation.status||'')&&!this.view?.preparation.stale;}
 get canSelectScope():boolean{return this.view?.preparation.status==='APPROVED';}
 get allChecksDone():boolean{return this.draftChecks.length>0&&
  this.draftChecks.every(c=>c.status!=='PENDING'&&
    (c.status!=='NOT_APPLICABLE'||c.naReason.trim())&&
    (c.status!=='DEFICIENCY'||(c.note.trim()&&
      (c.severity==='MINOR'||c.evidenceText.trim()))));}
 get checksDirty():boolean{
  const current=this.record?.checks||[];
  return JSON.stringify(this.draftChecks.map(c=>({
   id:c.id,status:c.status,severity:c.status==='DEFICIENCY'?c.severity:null,
   note:c.note,naReason:c.naReason,
   evidenceRefs:c.evidenceText.split(',').map(x=>x.trim()).filter(Boolean)
  })))!==JSON.stringify(current.map(c=>({
   id:c.id,status:c.status,severity:c.severity,note:c.note,naReason:c.naReason,evidenceRefs:c.evidenceRefs
  })));
 }
 toggleScope(title:string,selected:boolean){
  if(selected&&!this.scopeChosen.includes(title))this.scopeChosen.push(title);
  if(!selected)this.scopeChosen=this.scopeChosen.filter(x=>x!==title);
 }
 get findCounts():{all:number;critical:number;major:number}{
  const f=this.record?.findings||[];
  return {all:f.length,critical:f.filter(x=>x.severity==='CRITICAL').length,
    major:f.filter(x=>x.severity==='MAJOR').length};
 }
 load():void{
  if(!this.editorKey.trim()){this.error=this.copy('Editor key required for inspection records.',
    'يجب إدخال مفتاح المحرر لعرض سجل المعاينة.');return;}
  this.loading=true;this.error='';this.success='';
  if(!this.caseId){
   this.api.list(this.editorKey.trim()).subscribe({
    next:r=>{this.cases=r.cases;this.loading=false;},
    error:e=>this.fail(e)});
  }else{
   this.api.get(this.caseId,this.editorKey.trim()).subscribe({
    next:r=>{this.view=r;this.loading=false;this.hydrate();},
    error:e=>this.fail(e)});
  }
 }
 private hydrate(){
  const r=this.record;if(!r)return;
  this.draftChecks=r.checks.map(c=>({...c,evidenceText:c.evidenceRefs.join(', ')}));
  this.inspector=r.assignment?.inspector||this.operator;
  this.port=r.assignment?.port||this.port;
  this.assignmentMode=this.nmcOrigin?'NMC_SCHEDULED':'POC_MANUAL';
  this.reportSummary=r.report?.summary||'';
  this.draftActions=r.findings.map(f=>{
   const saved=r.actions.find(x=>x.findingId===f.id);
   return {findingId:f.id,owner:saved?.owner||'',
    dueDate:saved?.dueDate||new Date(Date.now()+14*86400000).toISOString().slice(0,10),
    instruction:saved?.instruction||'Rectify '+f.title};
  });
 }
 fail(error:unknown){
  const e=error as {error?:{error?:string};status?:number};
  this.error=e?.error?.error||this.copy('Backend operation failed. Check Oracle migration 013 and access.',
    'فشلت العملية. تحقق من ترحيل Oracle رقم 013 والصلاحيات.');
  this.loading=false;this.busy=false;this.success='';
 }
 run(action:string,data:Record<string,unknown>={},supervisor=false):void{
  if(this.busy||!this.caseId)return;
  const key=supervisor?this.publisherKey:this.editorKey;
  if(!key.trim()||!this.operator.trim()){
   this.error=this.copy('Enter actor name and required role key.','أدخل اسم المسؤول ومفتاح الصلاحية.');return;
  }
  if(['APPROVE_SCOPE','APPROVE_REPORT','RETURN_REPORT','ISSUE_ACTIONS',
      'VERIFY_ACTION','RECORD_FOLLOW_UP','CLOSE'].includes(action) &&
      this.reason.trim().length<8){
   this.error=this.copy('A minimum 8-character reason is required.','مطلوب سبب توضيحي من ٨ أحرف على الأقل.');return;
  }
  if(!window.confirm(this.copy('Record '+action+' with audited version '+(this.record?.version||0)+'?',
    'تسجيل '+action+' في سجل التدقيق بالإصدار '+(this.record?.version||0)+'؟')))return;
  this.busy=true;this.error='';this.success='';
  this.api.apply(this.caseId,key.trim(),{
   action,expectedVersion:this.record?.version||0,actor:this.operator.trim(),
   data:{...data,reason:this.reason.trim()}
  }).subscribe({next:()=>{this.busy=false;this.reason='';this.load();},
    error:e=>this.fail(e)});
 }
 addScope(){
  this.run('ADD_SCOPE',{additions:this.scopeChosen});
 }
 updateChecks(){
  this.run('SAVE_CHECKS',{checks:this.draftChecks.map(c=>({
    id:c.id,status:c.status,severity:c.status==='DEFICIENCY'?c.severity:null,
    note:c.note,naReason:c.naReason,
    evidenceRefs:c.evidenceText.split(',').map(x=>x.trim()).filter(Boolean)
  }))});
 }
 submitField(){
  if(!this.allChecksDone){this.error=this.copy('Complete all checks and mandatory evidence first.',
    'أكمل جميع بنود المعاينة والأدلة المطلوبة أولاً.');return;}
  // Save before submission explicitly; prevent submitting old persisted checklist.
  this.error=this.copy('Save current checklist first, then submit the inspection report.',
    'احفظ نتائج القائمة أولاً، ثم أرسل تقرير المعاينة.');
 }
 submitReport(){this.run('SUBMIT_FIELD',{summary:this.reportSummary});}
 issueActions(){this.run('ISSUE_ACTIONS',{actions:this.draftActions},true);}
 submitCorrection(x:SiCorrection){
  this.run('SUBMIT_ACTION',{actionId:x.id,
    evidenceRefs:(this.correctionEvidence[x.id]||'').split(',').map(z=>z.trim()).filter(Boolean)});
 }
 verifyCorrection(x:SiCorrection){
  this.run('VERIFY_ACTION',{actionId:x.id,decision:this.correctionDecision[x.id]||'ACCEPT'},true);
 }
 followUp(){
  this.run('RECORD_FOLLOW_UP',{mode:this.followMode,result:this.followResult,
    evidenceRefs:this.followEvidence.split(',').map(x=>x.trim()).filter(Boolean)},true);
 }
 get visibleCases():SiLifecycleCase[]{
  const s=this.search.toLowerCase().trim();
  return this.cases.filter(c=>!s||[c.imo,c.vesselName,c.regime,c.stage]
    .some(t=>t.toLowerCase().includes(s)));
 }
 stageLabel(stage:string){
  const ar:Record<string,string>={
   'NOT_STARTED':'لم تبدأ','PREPARATION_READY':'جاهزة لإقرار النطاق',
   'SCOPE_APPROVED':'تم اعتماد النطاق','ASSIGNED':'تم التكليف',
   'IN_FIELD':'المعاينة جارية','REPORT_PENDING_REVIEW':'التقرير بانتظار الاعتماد',
   'REPORT_RETURNED':'تمت إعادة التقرير','REPORT_APPROVED':'تم اعتماد التقرير',
   'ACTIONS_OPEN':'الإجراءات التصحيحية مفتوحة','FOLLOW_UP_PENDING':'بانتظار المتابعة',
   'READY_TO_CLOSE':'جاهزة للإغلاق','CLOSED':'مغلقة'};
  return this.lang.isArabic?ar[stage]||stage:stage.replaceAll('_',' ');
 }
 track(_:number,c:{id:string}){return c.id;}
}
