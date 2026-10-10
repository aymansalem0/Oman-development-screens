import {LanguageService} from '../services/language.service';
import {CommonModule} from '@angular/common';
import {Component,OnInit} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {ActivatedRoute,RouterLink} from '@angular/router';
import {NmcNavigationComponent} from '../components/nmc-navigation.component';
import {SiPreparationService,SiPreparationView,SiPrepStatus} from '../services/si-preparation.service';

@Component({
  selector:'app-si-inspection-preparation',
  standalone:true,imports:[CommonModule,FormsModule,RouterLink,NmcNavigationComponent],
  templateUrl:'./si-inspection-preparation.component.html',
  styleUrl:'./si-inspection-preparation.component.css'
})
export class SiInspectionPreparationComponent implements OnInit{
  id='';busy=false;loading=false;error='';success='';
  editorKey='';publisherKey='';actor='';reason='';
  reviewDecision:'APPROVE'|'REJECT'='APPROVE';
  language:'en'|'ar'='en';
  data:SiPreparationView|null=null;
  readonly names:Record<string,string>={
    'fire-safety':'Fire Safety & Historical Deficiencies',
    'certificates':'Statutory Certificates',
    navigation:'Navigation and Bridge',
    lifesaving:'Life-Saving Appliances',
    pollution:'Pollution Prevention',
    manning:'Crew and Manning',
    'hull-machinery':'Hull & Machinery',
    security:'Security and Access'
  };
  constructor(private route:ActivatedRoute,private api:SiPreparationService,public readonly lang:LanguageService){}
  copy(en:string,ar:string):string{return this.lang.pick(en,ar);}
  ngOnInit():void{this.id=this.route.snapshot.paramMap.get('caseId')||'';}
  get saved(){return this.data?.saved||null;}
  get prepared():boolean{return Boolean(this.saved);}
  get aiDraft():boolean{return this.saved?.status==='DRAFT_REVIEW';}
  get pendingRisk():boolean{return !this.data?.context.risk;}
  get canGenerate():boolean{
    return this.data?.a04Enabled===true&&!this.data?.stale&&
      this.saved?.status!==('APPROVED' as SiPrepStatus)&&
      ['PREPARED','REJECTED','FAILED'].includes(this.saved?.status||'')&&
      !this.pendingRisk&&this.editorKey.trim().length>0&&!this.busy;
  }
  get nextVersion():number{return this.saved?.version||0;}
  load():void{
    if(!this.editorKey.trim()){this.error='Editor access key required to open vessel evidence.';return;}
    this.loading=true;this.error='';this.success='';
    this.api.get(this.id,this.editorKey.trim()).subscribe({
      next:r=>{this.data=r;this.loading=false;},
      error:e=>this.fail(e)
    });
  }
  private fail(e:unknown):void{
    const err=e as {error?:{error?:string};status?:number};
    this.error=err?.error?.error||'Unable to complete the request. Check Oracle migration 010 and backend.';
    this.busy=false;this.loading=false;
    if(err?.status===403)this.editorKey='';
  }
  private completed(message:string):void{
    this.busy=false;
    this.api.get(this.id,this.editorKey.trim()).subscribe({
      next:r=>{this.data=r;this.error='';this.success=message;},
      error:e=>this.fail(e)
    });
  }
  prepare():void{
    if(!this.actor.trim()||!this.editorKey.trim()){this.error='Officer name and Editor key required.';return;}
    if(this.saved?.status==='APPROVED'){this.error='Approved dossier is immutable. Start a new case for a new scope.';return;}
    if(!window.confirm(this.prepared?
      'Refresh preparation from current NMC risk/evidence? Prior unapproved draft will be superseded.':
      'Create a deterministic evidence snapshot without calling AI?'))return;
    this.busy=true;this.error='';this.success='';
    this.api.prepare(this.id,this.editorKey.trim(),{actor:this.actor.trim(),
      expectedVersion:this.nextVersion}).subscribe({
      next:()=>this.completed('Evidence preparation saved centrally. A04 has NOT been called.'),
      error:e=>this.fail(e)
    });
  }
  generate():void{
    if(!this.canGenerate||!this.actor.trim()){
      this.error='Prepare the case, confirm current saved NMC risk, and enter officer name.';return;
    }
    if(!window.confirm('Execute A04 on Airia NOW? This is an explicit API call that may incur AI usage charges. The output remains a human-reviewed suggestion; no official risk or checklist will change.'))return;
    this.busy=true;this.error='';this.success='';
    this.api.generate(this.id,this.editorKey.trim(),{actor:this.actor.trim(),
      expectedVersion:this.nextVersion,confirmCost:true,language:this.language}).subscribe({
      next:()=>this.completed('A04 dossier saved as DRAFT REVIEW. A supervisor must approve it.'),
      error:e=>{this.fail(e);this.loadAfterFailedCall();}
    });
  }
  private loadAfterFailedCall():void{
    if(!this.editorKey.trim())return;
    this.api.get(this.id,this.editorKey.trim()).subscribe({
      next:r=>{this.data=r;},error:()=>{}
    });
  }
  review():void{
    if(!this.aiDraft||!this.publisherKey.trim()||!this.actor.trim()||this.reason.trim().length<8){
      this.error='A04 draft, Supervisor key, reviewer name and 8+ character reason required.';return;
    }
    if(!window.confirm(this.reviewDecision==='APPROVE'?
      'Approve this *advisory* focus overlay? Existing mandatory checklist will NOT change.':
      'Reject this AI recommendation while retaining the full audit trail?'))return;
    this.busy=true;this.error='';this.success='';
    this.api.review(this.id,this.publisherKey.trim(),{
      actor:this.actor.trim(),decision:this.reviewDecision,
      reason:this.reason.trim(),expectedVersion:this.nextVersion}).subscribe({
        next:()=>this.completed('Supervisor decision recorded centrally. Base checklist unchanged.'),
        error:e=>this.fail(e)
      });
  }
  statusLabel(value:string|null|undefined):string{
    const key=value||'NOT PREPARED';
    const labels:Record<string,string>={
      'NOT PREPARED':'لم يبدأ التحضير',
      'PREPARED':'جاهز',
      'GENERATING':'جارٍ إنشاء الملف',
      'DRAFT_REVIEW':'مسودة للمراجعة',
      'APPROVED':'معتمد',
      'REJECTED':'مرفوض',
      'FAILED':'فشل',
      'ENABLED':'مفعّل',
      'DISABLED':'غير مفعّل',
      'High':'مرتفع',
      'Critical':'حرج',
      'Watch':'مراقبة',
      'Normal':'عادي'
    };
    return this.lang.isArabic?labels[key]||key:key;
  }
  itemLabel(id:string):string{
    if(!this.lang.isArabic)return this.names[id]||id;
    const ar:Record<string,string>={
      'fire-safety':'السلامة من الحريق والمخالفات السابقة',
      'certificates':'الشهادات الإلزامية',
      'navigation':'الملاحة والجسر',
      'lifesaving':'معدات إنقاذ الأرواح',
      'pollution':'منع التلوث',
      'manning':'الطاقم والحد الأدنى للتشغيل',
      'hull-machinery':'البدن والآلات',
      'security':'الأمن والتحكم في الدخول'
    };
    return ar[id]||this.names[id]||id;
  }
  countFocus(id:string):string{
    return this.saved?.dossier?.checklistFocus.find(x=>x.existingItemId===id)?.focus||'BASE';
  }
  short(value:string|null|undefined):string{return (value||'—').slice(0,12);}
}
