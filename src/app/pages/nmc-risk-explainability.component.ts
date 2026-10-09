import {NmcNavigationComponent} from '../components/nmc-navigation.component';
import {CommonModule} from '@angular/common';
import {Component,OnInit} from '@angular/core';
import {ActivatedRoute,RouterLink} from '@angular/router';
import {NmcVesselProfile} from '../data/nmc-vessel-catalog';
import {getOperationalVesselByImo} from '../data/nmc-expanded-vessel-catalog';
import {LanguageService} from '../services/language.service';
import {NmcFleetAiService,FleetAiAssessment} from '../services/nmc-fleet-ai.service';
import {NmcOperationalGuidanceService,GuidanceResult} from '../services/nmc-operational-guidance.service';
import {NmcCasesService,NmcCentralCase} from '../services/nmc-cases.service';

type FactorKey='movement'|'inspection'|'certificate'|'dataQuality'|'history';
interface RiskFactor {
  id:FactorKey;label:string;labelAr:string;
  severity:number;weight:number;contribution:number;confidence:number;
  evidenceIds:string[];reason:string;sourceAgent:string;
}
interface Threshold {
  key:string;min:number;max:number;width:number;
}
@Component({
  selector:'app-nmc-risk-explainability',standalone:true,
  imports:[CommonModule,RouterLink,NmcNavigationComponent],
  templateUrl:'./nmc-risk-explainability.component.html',
  styleUrl:'./nmc-risk-explainability.component.css'
})
export class NmcRiskExplainabilityComponent implements OnInit {
  vessel?:NmcVesselProfile;
  assessment:FleetAiAssessment|null=null;
  factors:RiskFactor[]=[];
  selectedFactor?:RiskFactor;
  guidanceItems:GuidanceResult[]=[];
  guidanceError='';
  assessmentError='';
  busy=true;
  guidanceBusy=true;
  linkedCase:NmcCentralCase|null=null;
  readonly factorLabels:Record<FactorKey,[string,string]>={
    movement:['Movement & voyage','الحركة والرحلة'],
    inspection:['Inspection & deficiencies','التفتيش والملاحظات'],
    certificate:['Certificates & compliance','الشهادات والامتثال'],
    dataQuality:['Data quality','جودة البيانات'],
    history:['Historical risk','المخاطر التاريخية']
  };
  readonly factorOrder:FactorKey[]=['movement','inspection','certificate','dataQuality','history'];

  constructor(private route:ActivatedRoute,public lang:LanguageService,
    private readonly fleet:NmcFleetAiService,
    private readonly guidance:NmcOperationalGuidanceService,
    private readonly cases:NmcCasesService){}

  ngOnInit():void{
    const imo=this.route.snapshot.paramMap.get('imo')||'';
    this.vessel=getOperationalVesselByImo(imo);
    if(!this.vessel){this.assessmentError='Unknown vessel IMO';this.busy=false;return;}
    this.refresh();
  }
  copy(en:string,ar:string):string{return this.lang.pick(en,ar);}
  toggleLanguage():void{this.lang.toggle();}
  refresh():void{
    if(!this.vessel)return;
    this.busy=true;this.assessmentError='';
    this.fleet.assessment(this.vessel.imo).subscribe({
      next:row=>{
        this.busy=false;
        if(row.status!=='COMPLETED'||!row.assessmentId||
           typeof row.score!=='number'||!Number.isFinite(row.score)||
           !Array.isArray(row.signals)||row.signals.length!==5){
          this.assessmentError=this.copy('A valid saved A01/A02 assessment is not available.','لا يوجد تقييم A01/A02 صالح ومحفوظ.');
          return;
        }
        this.assessment=row;
        const prior=this.selectedFactor?.id;
        this.factors=this.factorOrder.flatMap(id=>{
          const signal=row.signals.find(x=>x.factor===id);
          const weight=Number(row.ruleset?.weights?.[id]??NaN);
          if(!signal||!Number.isFinite(weight))return [];
          return [{
            id,label:this.factorLabels[id][0],labelAr:this.factorLabels[id][1],
            severity:signal.severity,weight,
            contribution:signal.severity*weight/100,
            confidence:signal.confidence,
            evidenceIds:signal.evidenceIds||[],reason:signal.reason||'',sourceAgent:signal.sourceAgent
          }];
        });
        if(this.factors.length!==5)this.assessmentError=this.copy(
          'Some saved risk factors are missing.','بعض عوامل المخاطر المحفوظة غير موجودة.');
        this.selectedFactor=this.factors.find(x=>x.id===prior)||this.factors[0];
      },
      error:()=>{this.busy=false;this.assessment=null;this.factors=[];this.assessmentError=
        this.copy('No saved validated assessment; no simulated score will be substituted.',
                  'لا يوجد تقييم محفوظ ومتحقق منه؛ لن يتم عرض درجة مخاطر تجريبية كبديل.');}
    });
    this.loadGuidance();
    this.cases.byImo(this.vessel.imo).subscribe({
      next:r=>this.linkedCase=r.case?.status==='RESOLVED'?null:r.case,
      error:()=>this.linkedCase=null
    });
  }
  loadGuidance():void{
    if(!this.vessel)return;
    this.guidanceBusy=true;this.guidanceError='';
    this.guidance.forVessel(this.vessel.imo).subscribe({
      next:r=>{this.guidanceBusy=false;this.guidanceItems=r.rules;},
      error:e=>{this.guidanceBusy=false;this.guidanceItems=[];
        this.guidanceError=this.guidance.message(e,this.lang.isArabic);}
    });
  }
  get riskScore():number|null{return this.assessment?.score??null;}
  get riskLevel():string{return this.assessment?.level||'Pending';}
  get riskClass():string{return this.riskLevel.toLowerCase();}
  get riskLabel():string{
    const values:Record<string,[string,string]>={
      Normal:['Normal','طبيعي'],Watch:['Watch','مراقبة'],
      High:['High','مرتفع'],Critical:['Critical','حرج'],Pending:['Pending','بانتظار التقييم']
    };
    const labels=values[this.riskLevel]||values['Pending'];
    return this.copy(labels[0],labels[1]);
  }
  get scoreMarkerPosition():number{return this.riskScore===null?0:Math.min(99,Math.max(1,this.riskScore));}
  get thresholds():Threshold[]{
    const t=this.assessment?.ruleset?.thresholds??{watch:45,high:65,critical:85};
    return [
      {key:'Normal',min:0,max:t.watch-1,width:t.watch},
      {key:'Watch',min:t.watch,max:t.high-1,width:t.high-t.watch},
      {key:'High',min:t.high,max:t.critical-1,width:t.critical-t.high},
      {key:'Critical',min:t.critical,max:100,width:101-t.critical}
    ];
  }
  thresholdName(key:string):string{
    const d:Record<string,[string,string]>={
      Normal:['Normal','طبيعي'],Watch:['Watch','مراقبة'],
      High:['High','مرتفع'],Critical:['Critical','حرج']
    };
    return this.copy(...(d[key]||[key,key]) as [string,string]);
  }
  get totalContribution():number{return this.factors.reduce((n,f)=>n+f.contribution,0);}
  get calculationMode():string{return this.assessment?.ruleset?.mode||'weighted';}
  get averageFactorConfidence():number|null{
    if(!this.factors.length)return null;
    return Math.round(this.factors.reduce((v,f)=>v+f.confidence,0)/this.factors.length*100);
  }
  get assessmentSource():string{return this.assessment?.sourceMode||'—';}
  get situationSummary():string{
    if(!this.assessment)return '';
    const top=[...this.factors].sort((a,b)=>b.severity-a.severity).slice(0,2);
    const names=top.map(f=>this.copy(f.label,f.labelAr)).join(' / ');
    return this.lang.isArabic
      ?'تُظهر مؤشرات A01/A02 المحفوظة ارتفاعًا نسبيًا في '+names+
        '. تصنيف المخاطر '+this.riskLabel+'، وأولوية التشغيل '+this.assessment.operationalPriority+
        '. هذا ملخص حتمي من النتائج المحفوظة وليس توصية مولدة من Agent جديد.'
      :'Saved A01/A02 signals identify '+names+' as the strongest observed severities. '+
        'Risk classification is '+this.riskLevel+'; operational priority is '+
        this.assessment.operationalPriority+
        '. This is a platform-assembled summary of saved AI signals, not a new agent recommendation.';
  }
  guidanceName(g:GuidanceResult):string{return this.copy(g.title,g.titleAr);}
  selectFactor(f:RiskFactor):void{this.selectedFactor=f;}
}
