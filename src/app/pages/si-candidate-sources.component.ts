import {CommonModule} from '@angular/common';
import {Component,OnDestroy,OnInit} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {ActivatedRoute,Router,RouterLink} from '@angular/router';
import {Subscription} from 'rxjs';
import {NmcNavigationComponent} from '../components/nmc-navigation.component';
import {LanguageService} from '../services/language.service';
import {SiCandidateSourcesService,SiExcelSource,SiImportPreview,SiSourceImportSummary}
  from '../services/si-candidate-sources.service';

type SourcePage='NMC_CASE'|SiExcelSource|null;
@Component({
  selector:'app-si-candidate-sources',
  standalone:true,
  imports:[CommonModule,FormsModule,RouterLink,NmcNavigationComponent],
  templateUrl:'./si-candidate-sources.component.html',
  styleUrl:'./si-candidate-sources.component.css'
})
export class SiCandidateSourcesComponent implements OnInit,OnDestroy{
  source:SourcePage=null;
  status:SiSourceImportSummary|null=null;
  preview:SiImportPreview|null=null;
  editorKey='';actor='';selectedName='';selectedSize=0;
  busy=false;loading=false;error='';success='';
  private sub:Subscription|null=null;
  readonly sources:{key:SiExcelSource;slug:string;en:string;ar:string}[]=[
    {key:'SERVICE_REQUEST',slug:'service-requests',
      en:'Maritime Service Requests',ar:'طلبات الخدمات البحرية'},
    {key:'PSC_PORT_CALL',slug:'psc-port-calls',
      en:'PSC Port Call Notifications',ar:'إخطارات وصول السفن وتفتيش دولة الميناء'}
  ];
  constructor(private readonly api:SiCandidateSourcesService,
    private readonly route:ActivatedRoute,
    private readonly router:Router,
    public readonly lang:LanguageService){}
  copy(en:string,ar:string):string{return this.lang.pick(en,ar);}
  ngOnInit():void{
    this.sub=this.route.paramMap.subscribe(params=>{
      const slug=params.get('source');
      this.source=slug==='nmc'?'NMC_CASE':
        this.sources.find(x=>x.slug===slug)?.key||null;
      if(slug&&!this.source){this.router.navigate(['/moei/smart-inspection/settings/sources']);return;}
      this.preview=null;this.error='';this.success='';
      if(this.editorKey.trim())this.refresh();
    });
  }
  ngOnDestroy(){this.sub?.unsubscribe();}
  link(source:SiExcelSource){return '/moei/smart-inspection/settings/sources/'+
    this.sources.find(x=>x.key===source)?.slug;}
  get activeDefinition(){return this.source&&this.source!=='NMC_CASE'?
    this.status?.excelSources[this.source]:null;}
  get sheetName(){return this.source==='SERVICE_REQUEST'?'SERVICE_REQUESTS':'PSC_PORT_CALLS';}
  get templateUrl(){return this.source&&this.source!=='NMC_CASE'?
    '/api/si/v1/candidate-sources/template/'+this.source:'';}
  get readyToCommit():boolean{
    return Boolean(this.source&&this.source!=='NMC_CASE'&&this.preview?.canCommit&&
      this.editorKey.trim()&&this.actor.trim().length>=3&&!this.busy);
  }
  refresh():void{
    if(!this.editorKey.trim()){
      this.error=this.copy('Editor key required to view source import history.',
        'مطلوب مفتاح المحرر لعرض سجل استيراد المصادر.');
      return;
    }
    this.loading=true;this.error='';
    this.api.status(this.editorKey.trim()).subscribe({
      next:d=>{this.status=d;this.loading=false;},
      error:e=>{this.loading=false;this.showError(e);}
    });
  }
  private showError(error:unknown):void{
    const e=error as {status?:number;error?:{error?:string}};
    const code=e?.error?.error||'SI_XLSX_REQUEST_FAILED';
    this.error=code+(code==='SI_MIGRATION_009_REQUIRED'?
      this.copy(' — Oracle migration 009 is required for candidate events.',
        ' — يجب تنفيذ Oracle Migration 009 لتخزين أحداث الترشيح.'):'');
    this.busy=false;this.success='';
    if(e?.status===403)this.editorKey='';
  }
  async selectFile(event:Event):Promise<void>{
    const input=event.target as HTMLInputElement;
    const file=input.files?.[0];if(!file||this.source===null||this.source==='NMC_CASE')return;
    this.preview=null;this.error='';this.success='';
    if(!this.editorKey.trim()){
      this.error=this.copy('Enter Editor key before uploading.','أدخل مفتاح المحرر قبل الرفع.');return;
    }
    if(!file.name.toLowerCase().endsWith('.xlsx')||file.size>2*1024*1024||file.size<200){
      this.error=this.copy('Choose a valid .xlsx workbook smaller than 2 MB.',
        'اختر ملف Excel صالحًا بصيغة xlsx بحجم أقل من ٢ ميجابايت.');return;
    }
    this.busy=true;this.selectedName=file.name;this.selectedSize=file.size;
    try{
      const base64=await new Promise<string>((resolve,reject)=>{
        const rd=new FileReader();rd.onload=()=>resolve(String(rd.result||'').split(',')[1]||'');
        rd.onerror=()=>reject(new Error('LOCAL_FILE_READ_ERROR'));rd.readAsDataURL(file);
      });
      this.api.preview(this.editorKey.trim(),{
        sourceType:this.source,fileName:file.name,workbookBase64:base64
      }).subscribe({
        next:p=>{
          this.preview=p;this.busy=false;
          this.success=p.canCommit?
            this.copy('Preview passed. Nothing was saved until you click Commit.',
              'نجحت المعاينة. لن تُحفظ البيانات حتى تضغط اعتماد الاستيراد.'):
            this.copy('Preview has validation issues. Correct the workbook before committing.',
              'توجد أخطاء تحقق. صحح ملف Excel قبل اعتماد الاستيراد.');
        },
        error:e=>this.showError(e)
      });
    }catch(e){this.error=this.copy('Unable to read selected file.','تعذر قراءة الملف المختار.');this.busy=false;}
  }
  commit():void{
    if(!this.readyToCommit||!this.preview||!this.source||this.source==='NMC_CASE')return;
    const p=this.preview;
    if(!window.confirm(this.copy(
      'Commit '+p.newEvents+' new source events? No official NMC referral, AI score or inspection case will be automatically created.',
      'اعتماد '+p.newEvents+' حدث مصدر جديد؟ لن يتم إنشاء إحالة NMC أو درجة AI أو حالة معاينة تلقائيًا.')))return;
    this.busy=true;this.error='';
    this.api.commit(this.editorKey.trim(),{
      previewId:p.previewId,sourceType:this.source,actor:this.actor.trim()
    }).subscribe({
      next:r=>{
        this.preview=null;this.busy=false;this.success=
          this.copy('Imported ','تم استيراد ')+r.importedEvents+
          this.copy(' new events; ',' حدث جديد؛ وتم تجاهل ')+r.duplicateEvents+
          this.copy(' repeated events. Candidates now require officer review.',
            ' حدث مكرر. المرشحون بانتظار مراجعة الموظف.');
        this.refresh();
      },error:e=>this.showError(e)
    });
  }
  nameFor(source:SiExcelSource):string{
    const x=this.sources.find(s=>s.key===source);
    return x?this.copy(x.en,x.ar):source;
  }
}
