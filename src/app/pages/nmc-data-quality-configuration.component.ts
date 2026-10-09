import {CommonModule} from '@angular/common';
import {Component,OnDestroy,OnInit} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {ActivatedRoute,RouterLink} from '@angular/router';
import {Subscription} from 'rxjs';
import {LanguageService} from '../services/language.service';
import {FleetAiIntelligence,NmcFleetAiService} from '../services/nmc-fleet-ai.service';
import {NmcDataQualityConfigService,QualityDemoPolicy,QualityMetricKey,QualityIdentityField,
  QualityPolicyImpact,QUALITY_METRICS,QUALITY_ID_FIELDS,projectQuality} from '../services/nmc-data-quality-config.service';

@Component({selector:'app-nmc-data-quality-configuration',standalone:true,
  imports:[CommonModule,FormsModule,RouterLink],
  templateUrl:'./nmc-data-quality-configuration.component.html',
  styleUrl:'./nmc-data-quality-configuration.component.css'})
export class NmcDataQualityConfigurationComponent implements OnInit,OnDestroy {
  readonly metrics=QUALITY_METRICS;
  readonly fields=QUALITY_ID_FIELDS;
  imo='9328471';
  saved:FleetAiIntelligence|null=null;
  draft!:QualityDemoPolicy;
  published!:QualityDemoPolicy;
  proposed:QualityPolicyImpact|null=null;
  applied:QualityPolicyImpact|null=null;
  loading=true;error='';errors:string[]=[];message='';
  private sub?:Subscription;
  constructor(private route:ActivatedRoute,private fleet:NmcFleetAiService,
    public quality:NmcDataQualityConfigService,public lang:LanguageService){}
  ngOnInit():void {
    const imo=this.route.snapshot.queryParamMap.get('imo')||'9328471';
    this.imo=/^[0-9]{7}$/.test(imo)?imo:'9328471';
    this.reload();
    this.sub=this.fleet.intelligence(this.imo).subscribe({
      next:row=>{this.saved=row;this.loading=false;this.recalculate();},
      error:()=>{this.loading=false;this.error='Oracle quality trace unavailable.';}
    });
  }
  ngOnDestroy():void {this.sub?.unsubscribe();}
  copy(en:string,ar:string):string {return this.lang.pick(en,ar);}
  metricLabel(key:QualityMetricKey):string {
    const v:Record<QualityMetricKey,[string,string]>={
      completeness:['Completeness','الاكتمال'],consistency:['Consistency','التطابق'],
      evidenceLinkage:['Evidence linkage','ربط الأدلة'],provenance:['Source metadata','بيانات المصدر']};
    return this.copy(...v[key]);
  }
  fieldLabel(key:QualityIdentityField):string {
    const v:Record<QualityIdentityField,[string,string]>={
      VESSEL_NAME:['Vessel name','اسم السفينة'],FLAG:['Flag state','دولة العلم'],
      VESSEL_TYPE:['Vessel type','نوع السفينة'],OPERATOR_NAME:['Operator','المشغل']};
    return this.copy(...v[key]);
  }
  toggleField(key:QualityIdentityField,enabled:boolean):void {
    this.draft.enabledFields=enabled
      ? [...new Set([...this.draft.enabledFields,key])]
      : this.draft.enabledFields.filter(f=>f!==key);
    this.recalculate();
  }
  get totalWeight():number {return this.metrics.reduce((sum,k)=>sum+Number(this.draft.weights[k]||0),0);}
  get delta():number|null {
    return this.proposed?.score!=null && this.saved?.quality.score!=null
      ?this.proposed.score-this.saved.quality.score:null;
  }
  recalculate():void {
    this.message='';
    this.errors=this.quality.validate(this.draft);
    const b=this.saved?.quality.breakdown;
    this.applied=b?projectQuality(b,this.published):null;
    this.proposed=b&&!this.errors.length?projectQuality(b,this.draft):null;
  }
  reload():void {this.published=this.quality.config;this.draft=this.quality.copy(this.published);this.recalculate();}
  reset():void {
    this.draft=this.quality.defaults;
    this.draft.changeReason='Restore default local POC quality policy';
    this.recalculate();
  }
  publish():void {
    if(this.quality.validate(this.draft).length)return;
    try{
      this.published=this.quality.publish(this.draft);
      this.draft=this.quality.copy(this.published);
      this.recalculate();
      this.message=this.copy('Browser-only policy saved; Oracle remains unchanged.',
        'تم حفظ إعدادات المتصفح فقط؛ قيم Oracle لم تتغير.');
    }catch{this.error=this.copy('Browser settings could not be saved.','تعذر حفظ الإعدادات.');}
  }
}
