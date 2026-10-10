import {CommonModule} from '@angular/common';
import {Component,OnInit} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {HttpClient,HttpHeaders} from '@angular/common/http';
import {RouterLink} from '@angular/router';
import {NmcNavigationComponent} from '../components/nmc-navigation.component';

interface ErpSnapshot{
  ready:boolean;source:string;snapshotId:string|null;importedAt:string|null;
  counts:Record<string,number>|null;
}
interface ErpPreview{
  snapshotId:string;expiresAt:string;counts:Record<string,number>;
  replacedSnapshot:string|null;warnings:string[];
}
@Component({
  selector:'app-si-erp-settings',
  standalone:true,imports:[CommonModule,FormsModule,RouterLink,NmcNavigationComponent],
  templateUrl:'./si-erp-settings.component.html',
  styleUrl:'./si-erp-settings.component.css'
})
export class SiErpSettingsComponent implements OnInit{
  busy=false;loading=false;error='';success='';
  editorKey='';erp:ErpSnapshot|null=null;
  pendingImport:ErpPreview|null=null;
  fileName='';fileSize=0;
  readonly requiredSheets=[
    'Ports','Inspectors','Inspector_Ports','Qualifications','Shifts','Leaves',
    'Blackouts','Travel_Matrix','Bookings','Scheduling_Policy','POC_Requests'
  ];
  private readonly api='/api/si';
  constructor(private readonly http:HttpClient){}
  ngOnInit(){this.refresh();}
  refresh():void{
    this.loading=true;this.error='';
    this.http.get<ErpSnapshot>(this.api+'/erp/status').subscribe({
      next:r=>{this.erp=r;this.loading=false;},
      error:e=>this.showError(e)
    });
  }
  get countPairs():{name:string;value:number}[]{
    return Object.entries(this.erp?.counts||{}).map(([name,value])=>({name,value}));
  }
  private headers():HttpHeaders|null{
    if(!this.editorKey.trim()){
      this.error='Enter the NMC Editor access key to preview or commit an ERP workbook.';
      return null;
    }
    return new HttpHeaders({'X-NMC-DASHBOARD-KEY':this.editorKey.trim()});
  }
  private showError(e:unknown):void{
    const r=e as {error?:{error?:string};status?:number};
    const code=r?.error?.error||'ERP_IMPORT_FAILED';
    const hints:Record<string,string>={
      'ERP_INVALID_XLSX':'The file could not be read as XLSX. Make sure you deployed the latest ERP namespace compatibility fix; do not rename CSV to XLSX.',
      'ERP_HEADER_MISMATCH':'Column names in row 4 differ from the required ERP template.',
      'ERP_PREVIEW_EXPIRED':'The 10-minute preview expired. Upload and preview again.',
      'ERP_FORMULAS_NOT_ALLOWED':'Formula cells are not accepted in workforce data. Use literal values.',
      'ERP_FILE_SIZE_INVALID':'Workbook must be an XLSX file smaller than 3 MB.'
    };
    this.error=code+(hints[code]?' — '+hints[code]:'');
    if(r?.status===403)this.editorKey='';
    this.success='';this.loading=false;this.busy=false;
  }
  async uploadExcel(event:Event):Promise<void>{
    const input=event.target as HTMLInputElement;
    const file=input.files?.[0];
    if(!file)return;
    const key=this.headers();if(!key)return;
    this.fileName=file.name;this.fileSize=file.size;
    this.pendingImport=null;this.error='';this.success='';
    if(!file.name.toLowerCase().endsWith('.xlsx')||file.size<200||file.size>3*1024*1024){
      this.error='Choose a real .xlsx file between 200 bytes and 3 MB.';return;
    }
    this.busy=true;
    try{
      const base64=await new Promise<string>((resolve,reject)=>{
        const reader=new FileReader();
        reader.onload=()=>resolve(String(reader.result||'').split(',')[1]||'');
        reader.onerror=()=>reject(new Error('FILE_READ_FAILED'));
        reader.readAsDataURL(file);
      });
      this.http.post<ErpPreview>(this.api+'/erp/import/preview',
        {workbookBase64:base64},{headers:key}).subscribe({
          next:r=>{
            this.pendingImport=r;this.busy=false;
            this.success='All required ERP worksheets and references passed validation. Commit to apply this POC snapshot.';
          },
          error:e=>this.showError(e)
        });
    }catch(e){this.showError(e);}
  }
  commitExcel():void{
    if(!this.pendingImport||this.busy)return;
    const key=this.headers();if(!key)return;
    if(!window.confirm('Replace the existing simulated ERP workforce snapshot with this validated workbook? This does NOT write to real ERP or NMC Oracle.'))return;
    this.busy=true;this.error='';this.success='';
    this.http.post(this.api+'/erp/import/commit',
      {snapshotId:this.pendingImport.snapshotId},{headers:key}).subscribe({
        next:()=>{
          this.busy=false;this.pendingImport=null;
          this.success='ERP POC workforce snapshot committed. Scheduling screens will now use its saved inspectors and ports.';
          this.refresh();
        },
        error:e=>this.showError(e)
      });
  }
  short(value:string|null|undefined){return value?value.slice(0,18)+'…':'—';}
}
