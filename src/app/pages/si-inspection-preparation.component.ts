import {LanguageService} from '../services/language.service';
import {CommonModule} from '@angular/common';
import {Component,OnInit} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {ActivatedRoute,RouterLink} from '@angular/router';
import {NmcNavigationComponent} from '../components/nmc-navigation.component';
import {SiPreparationService,SiPreparationView,SiPrepStatus,
 SiCompleteVesselDossier} from '../services/si-preparation.service';

@Component({
  selector:'app-si-inspection-preparation',
  standalone:true,imports:[CommonModule,FormsModule,RouterLink,NmcNavigationComponent],
  templateUrl:'./si-inspection-preparation.component.html',
  styleUrl:'./si-inspection-preparation.component.css'
})
export class SiInspectionPreparationComponent implements OnInit{
  id='';busy=false;loading=false;error='';success='';
  editorKey='MOEI_SESSION';publisherKey='MOEI_SESSION';actor='admin';reason='';
  reviewDecision:'APPROVE'|'REJECT'='APPROVE';
  language:'en'|'ar'='en';
  data:SiPreparationView|null=null;
  fullDossier:SiCompleteVesselDossier|null=null;
  fullDossierError='';dossierLoading=false;
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
  ngOnInit():void{
    // GET is read-only and never calls Airia. No extra key prompt after SSO.
    // Handle navigation between approved cases without displaying stale evidence.
    this.route.paramMap.subscribe(params=>{
      this.id=params.get('caseId')||'';
      this.data=null;this.fullDossier=null;
      this.fullDossierError='';this.error='';this.success='';
      if(this.id)this.load();
      else this.error=this.copy('No inspection case selected. Open an approved case from the preparation register.',
        'لم يتم اختيار حالة معاينة. افتح حالة معتمدة من قائمة التحضير.');
    });
  }
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
      next:r=>{this.data=r;this.loading=false;this.loadFullDossier();},
      error:e=>this.fail(e)
    });
  }
  loadFullDossier():void{
    if(!this.id||!this.editorKey.trim())return;
    this.dossierLoading=true;this.fullDossierError='';
    this.api.getDossier(this.id,this.editorKey.trim()).subscribe({
      next:r=>{this.fullDossier=r;this.dossierLoading=false;},
      error:e=>{
        this.fullDossier=null;this.dossierLoading=false;
        this.fullDossierError=e?.error?.error||
         this.copy('Unable to load full vessel dossier.',
          'تعذر تحميل الدوسيه الكامل للسفينة.');
      }
    });
  }
  private fail(e:unknown):void{
    const err=e as {error?:{error?:string};status?:number};
    const code=err?.error?.error;
    this.error=code==='SI_MIGRATION_010_REQUIRED'?
      this.copy('Preparation unavailable: Oracle migration 010 is missing. Contact the database administrator; do not recreate Oracle.',
        'التحضير غير متاح: ترحيل Oracle رقم 010 غير مطبق. راجع مسؤول قاعدة البيانات دون إعادة إنشائها.'):
      code==='SI_APPROVED_CASE_REQUIRED'?
      this.copy('This inspection case is not approved or no longer exists in the saved registry.',
        'حالة المعاينة غير معتمدة أو غير موجودة في السجل المحفوظ.'):
      code==='SI_VESSEL_BUNDLE_MISSING'?
      this.copy('Approved case found, but its source vessel evidence bundle is unavailable.',
        'الحالة المعتمدة موجودة لكن حزمة أدلة السفينة المصدر غير متاحة.'):
      this.copy('Unable to load approved case evidence. Please verify the SI preparation API and Oracle migration 010.',
        'تعذر تحميل أدلة حالة المعاينة. راجع خدمة التحضير وترحيل Oracle رقم 010.');
    this.busy=false;this.loading=false;
    if(err?.status===401)this.error='Your login session expired.';
  }
  private completed(message:string):void{
    this.busy=false;
    this.api.get(this.id,this.editorKey.trim()).subscribe({
      next:r=>{this.data=r;this.error='';this.success=message;
        this.loadFullDossier();},
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
    const mock=this.data?.a04Provider==='MOCK';
    if(!window.confirm(mock?
      'Generate MOCK A04 dossier? No Airia calls. Fixed template, not real analysis. Inspector and supervisor review required.':
      'Execute A04 on Airia NOW? This is a potentially paid call. Suggestions require supervisor review.'))return;
    this.busy=true;this.error='';this.success='';
    this.api.generate(this.id,this.editorKey.trim(),{actor:this.actor.trim(),
      expectedVersion:this.nextVersion,confirmCost:true,language:this.language}).subscribe({
      next:()=>this.completed(this.data?.a04Provider==='MOCK'?'MOCK A04 dossier saved as DRAFT REVIEW. No Airia call.':'A04 dossier saved as DRAFT REVIEW. A supervisor must approve it.'),
      error:e=>{this.fail(e);this.loadAfterFailedCall();}
    });
  }
  private loadAfterFailedCall():void{
    if(!this.editorKey.trim())return;
    this.api.get(this.id,this.editorKey.trim()).subscribe({
      next:r=>{this.data=r;this.loadFullDossier();},error:()=>{}
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
      'APPROVE':'اعتماد',
      'REJECT':'رفض',
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
