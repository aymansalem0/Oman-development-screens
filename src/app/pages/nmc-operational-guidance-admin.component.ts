import {CommonModule} from '@angular/common';
import {Component,OnInit} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {RouterLink} from '@angular/router';
import {NmcNavigationComponent} from '../components/nmc-navigation.component';
import {LanguageService} from '../services/language.service';
import {
  NmcOperationalGuidanceService,GuidancePolicy,GuidanceRuleState,GuidanceField
} from '../services/nmc-operational-guidance.service';

@Component({
  selector:'app-nmc-operational-guidance-admin',
  standalone:true,
  imports:[CommonModule,FormsModule,RouterLink,NmcNavigationComponent],
  templateUrl:'./nmc-operational-guidance-admin.component.html',
  styleUrl:'./nmc-operational-guidance-admin.component.css'
})
export class NmcOperationalGuidanceAdminComponent implements OnInit{
  rules:GuidanceRuleState[]=[];
  selected?:GuidanceRuleState;
  draft?:GuidancePolicy;
  loading=false;busy=false;error='';message='';
  history:Array<{revision:number;action:string;role:string;at:string}>=[];
  testImo='9328471';testResults:string[]=[];
  readonly availableFields:Array<{value:GuidanceField;en:string;ar:string}>=[
    {value:'criticalOpenFinding',en:'Critical open finding',ar:'ملاحظة حرجة مفتوحة'},
    {value:'inspectionSeverity',en:'Inspection severity',ar:'شدة مخاطر التفتيش'},
    {value:'certificateSeverity',en:'Certificate severity',ar:'شدة مخاطر الشهادات'},
    {value:'historySeverity',en:'History severity',ar:'شدة المخاطر التاريخية'},
    {value:'movementSeverity',en:'Movement severity',ar:'شدة مخاطر الحركة'},
    {value:'dataQualitySeverity',en:'Data quality severity',ar:'شدة مخاطر جودة البيانات'},
    {value:'riskScore',en:'Saved risk score',ar:'درجة المخاطر المحفوظة'},
    {value:'riskLevel',en:'Saved risk level',ar:'تصنيف المخاطر المحفوظ'},
    {value:'operationalPriority',en:'Operational priority',ar:'الأولوية التشغيلية'},
    {value:'dataConflictDetected',en:'Verified structural identity conflict',ar:'تعارض بنيوي موثق في بيانات الهوية'}
  ];
  readonly priorities=['ROUTINE','WATCH','HIGH','PRIORITY_REVIEW'];
  constructor(public lang:LanguageService,private api:NmcOperationalGuidanceService){}
  ngOnInit():void{this.load();}
  copy(en:string,ar:string):string{return this.lang.pick(en,ar);}
  toggleLanguage():void{this.lang.toggle();}
  load():void{
    this.loading=true;this.error='';
    const prior=this.selected?.id;
    this.api.list().subscribe({
      next:r=>{
        this.loading=false;this.rules=r.rules;
        this.select(this.rules.find(x=>x.id===prior)||this.rules[0]);
      },
      error:e=>{this.loading=false;this.error=this.api.message(e,this.lang.isArabic);}
    });
  }
  select(rule?:GuidanceRuleState):void{
    this.selected=rule;
    this.draft=rule?JSON.parse(JSON.stringify(rule.draft||rule.published)) as GuidancePolicy:undefined;
    this.testResults=[];this.history=[];
    if(rule)this.api.history(rule.id).subscribe({next:x=>this.history=x.history,error:()=>this.history=[]});
  }
  get valueKind():string{
    const field=this.draft?.condition.field||'';
    if(field==='criticalOpenFinding'||field==='dataConflictDetected')return 'boolean';
    if(field==='riskLevel'||field==='operationalPriority')return 'choice';
    return 'number';
  }
  get choiceValues():string[]{
    return this.draft?.condition.field==='riskLevel'
      ?['Normal','Watch','High','Critical']:['Routine','Enhanced Monitoring','Priority Review'];
  }
  onFieldChange():void{
    if(!this.draft)return;
    const field=this.draft.condition.field;
    this.draft.condition.operator=field.endsWith('Severity')||field==='riskScore'?'GTE':'EQUALS';
    this.draft.condition.value=field==='criticalOpenFinding'||field==='dataConflictDetected'?true:
      field==='riskLevel'?'Watch':field==='operationalPriority'?'Priority Review':75;
  }
  saveDraft():void{
    if(!this.selected||!this.draft||this.busy)return;
    this.busy=true;this.error='';this.message='';
    this.api.saveDraft(this.selected,this.draft).subscribe({
      next:x=>{this.busy=false;this.replace(x.rule);this.message=this.copy(
        'Draft saved. Published rules remain unchanged until supervisor approval.',
        'حُفظت المسودة، ولن تتغير القواعد المنشورة قبل اعتماد المشرف.');},
      error:e=>{this.busy=false;this.error=this.api.message(e,this.lang.isArabic);}
    });
  }
  publish():void{
    if(!this.selected?.draft||this.busy)return;
    if(!window.confirm(this.copy(
      'Publish this draft as a new active rule revision? This affects future platform guidance only. It does NOT recalculate stored risk, create tasks or call AI.',
      'نشر المسودة كإصدار جديد؟ يؤثر النشر على الإرشادات القادمة فقط، دون إعادة حساب المخاطر أو إنشاء مهام أو استدعاء AI.')))return;
    this.busy=true;this.error='';
    this.api.publish(this.selected).subscribe({
      next:x=>{this.busy=false;this.replace(x.rule);this.message=this.copy('Rule revision published.','تم نشر الإصدار الجديد للقاعدة.');},
      error:e=>{this.busy=false;this.error=this.api.message(e,this.lang.isArabic);}
    });
  }
  private replace(rule:GuidanceRuleState):void{
    this.rules=this.rules.map(x=>x.id===rule.id?rule:x);
    this.select(rule);
  }
  testSaved():void{
    if(!/^\d{7}$/.test(this.testImo)){this.error=this.copy('Enter a 7-digit IMO.','أدخل رقم IMO من 7 أرقام.');return;}
    this.busy=true;this.error='';this.testResults=[];
    this.api.forVessel(this.testImo).subscribe({
      next:x=>{this.busy=false;this.testResults=x.rules.map(g=>g.ruleId+' · '+g.title+' · '+g.priority);
        this.message=this.copy('Dry-run: applied currently PUBLISHED rules to saved assessment; no AI call or task was created.',
                               'تجربة قراءة فقط: تم تطبيق القواعد المنشورة على تقييم محفوظ دون استدعاء AI أو إنشاء مهام.');},
      error:e=>{this.busy=false;this.error=this.api.message(e,this.lang.isArabic);}
    });
  }
}
