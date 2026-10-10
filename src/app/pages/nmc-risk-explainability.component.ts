import {NmcNavigationComponent} from '../components/nmc-navigation.component';
import {CommonModule} from '@angular/common';
import {Component,OnDestroy,OnInit} from '@angular/core';
import {Subscription} from 'rxjs';
import {ActivatedRoute,RouterLink} from '@angular/router';
import {NmcVesselProfile} from '../data/nmc-vessel-catalog';
import {getOperationalVesselByImo} from '../data/nmc-expanded-vessel-catalog';
import {LanguageService} from '../services/language.service';
import {NmcFleetAiService,FleetAiAssessment} from '../services/nmc-fleet-ai.service';
import {NmcRiskEngineService,RiskEngineConfig,RiskEvaluation,RiskFactorKey} from '../services/nmc-risk-engine.service';
import {NmcOperationalGuidanceService,GuidanceResult} from '../services/nmc-operational-guidance.service';
import {NmcCasesService,NmcCentralCase} from '../services/nmc-cases.service';

type FactorKey='movement'|'inspection'|'certificate'|'dataQuality'|'history'|'documentIntegrity';
interface RiskFactor {
  id:FactorKey;label:string;labelAr:string;
  severity:number;weight:number;contribution:number;confidence:number;
  evidenceIds:string[];reason:string;sourceAgent:string;
}
interface HistoricalRiskProjection {
  imo:string;sourceAssessmentId:string;riskScore:number;riskLevel:string;
  policyRevision:number;policyRef?:string;policyVersion?:string;
  reason?:string;calculatedAt?:string;
  factorSnapshotReconstructed?:boolean;
  factorSnapshot?:{
    calculationMode:string;weightedSubtotal:number;modeAdjustment:number;
    clampedAndRoundedScore:number;
    factors:Array<{key:string;severity:number;weight:number;
      weightedContribution:number;sourceAgent?:string;reason?:string;evidenceIds?:string[]}>;
  }|null;
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
export class NmcRiskExplainabilityComponent implements OnInit,OnDestroy {
  private readonly subscriptions=new Subscription();
  vessel?:NmcVesselProfile;
  assessment:FleetAiAssessment|null=null;
  // The local Risk Management settings apply only to this centrally published model;
  // immutable Oracle assessment and audit history must NEVER be relabeled as recalculated.
  activeRiskConfig:RiskEngineConfig|null=null;
  projectedRisk:RiskEvaluation|null=null;
  riskHistory:HistoricalRiskProjection[]=[];
  historyLoading=false;
  historyError='';
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
    history:['Historical risk','المخاطر التاريخية'],
    documentIntegrity:['Document Integrity (A03)','اتساق المستندات (A03)']
  };
  readonly factorOrder:FactorKey[]=['movement','inspection','certificate','dataQuality','history','documentIntegrity'];

  constructor(private route:ActivatedRoute,public lang:LanguageService,
    private readonly fleet:NmcFleetAiService,
    private readonly riskEngine:NmcRiskEngineService,
    private readonly guidance:NmcOperationalGuidanceService,
    private readonly cases:NmcCasesService){}

  ngOnInit():void{
    this.subscriptions.add(this.riskEngine.config$.subscribe(policy=>{
      this.activeRiskConfig=policy;
      this.updatePolicyProjection();
      if(this.vessel)this.loadRiskHistory();
    }));
    window.addEventListener('storage',this.onPolicyStorageChange);
    this.subscriptions.add(this.route.paramMap.subscribe(params=>{
      const imo=params.get('imo')||'';
      this.vessel=getOperationalVesselByImo(imo);
      this.assessment=null;this.projectedRisk=null;
      this.factors=[];this.selectedFactor=undefined;
      this.guidanceItems=[];this.linkedCase=null;
      this.riskHistory=[];this.historyError='';
      if(!this.vessel){this.assessmentError='Unknown vessel IMO';this.busy=false;return;}
      this.refresh();
      this.loadRiskHistory();
    }));
  }
  ngOnDestroy():void{
    this.subscriptions.unsubscribe();
    window.removeEventListener('storage',this.onPolicyStorageChange);
  }
  private readonly onPolicyStorageChange=(event:StorageEvent):void=>{
    if(event.key==='moei-nmc-risk-engine-config:v1')this.riskEngine.syncPublishedFromStorage();
  };
  copy(en:string,ar:string):string{return this.lang.pick(en,ar);}
  toggleLanguage():void{this.lang.toggle();}
  refresh():void{
    if(!this.vessel)return;
    this.busy=true;this.assessmentError='';
    const imo=this.vessel.imo;
    this.subscriptions.add(this.fleet.assessment(imo).subscribe({
      next:row=>{
        if(this.vessel?.imo!==imo)return;
        this.busy=false;
        if(row.status!=='COMPLETED'||!row.assessmentId||
           typeof row.score!=='number'||!Number.isFinite(row.score)||
           !Array.isArray(row.signals)||![5,6].includes(row.signals.length)){
          this.assessmentError=this.copy('A valid saved A01/A02 assessment is not available.','لا يوجد تقييم A01/A02 صالح ومحفوظ.');
          return;
        }
        // Rebuild from the five SAVED A01/A02 severities using the currently
        // configured risk model; the source Oracle score remains unchanged.
        this.assessment=row;
        this.updatePolicyProjection();
      },
      error:()=>{if(this.vessel?.imo!==imo)return;
        this.busy=false;this.assessment=null;this.projectedRisk=null;
        this.factors=[];this.assessmentError=
        this.copy('No saved validated assessment; no simulated score will be substituted.',
                  'لا يوجد تقييم محفوظ ومتحقق منه؛ لن يتم عرض درجة مخاطر تجريبية كبديل.');}
    }));
    this.loadGuidance();
    this.subscriptions.add(this.cases.byImo(imo).subscribe({
      next:r=>{if(this.vessel?.imo===imo)this.linkedCase=r.case?.status==='RESOLVED'?null:r.case;},
      error:()=>{if(this.vessel?.imo===imo)this.linkedCase=null;}
    }));
  }
  loadRiskHistory():void{
    if(!this.vessel)return;
    const imo=this.vessel.imo;
    this.historyLoading=true;this.historyError='';
    this.subscriptions.add(this.fleet.policyRiskHistory(imo).subscribe({
      next:response=>{
        if(this.vessel?.imo!==imo)return;
        this.historyLoading=false;this.riskHistory=response.history||[];
      },
      error:e=>{
        if(this.vessel?.imo!==imo)return;
        this.historyLoading=false;this.historyError=e?.error?.error||'RISK_HISTORY_UNAVAILABLE';
      }
    }));
  }
  openCurrentRisk():void{
    if(!this.factors.length)return;
    this.selectedFactor=this.factors[0];
    document.getElementById('current-risk-factors')?.scrollIntoView({
      behavior:'smooth',block:'start'
    });
  }
  loadGuidance():void{
    if(!this.vessel)return;
    this.guidanceBusy=true;this.guidanceError='';
    const imo=this.vessel.imo;
    this.subscriptions.add(this.guidance.forVessel(imo).subscribe({
      next:r=>{if(this.vessel?.imo!==imo)return;this.guidanceBusy=false;this.guidanceItems=r.rules;},
      error:e=>{if(this.vessel?.imo!==imo)return;this.guidanceBusy=false;this.guidanceItems=[];
        this.guidanceError=this.guidance.message(e,this.lang.isArabic);}
    }));
  }
  /** Scoring policy projection is recomputed from persisted AI evidence, NEVER fixture calibration. */
  private updatePolicyProjection():void{
    const row=this.assessment,config=this.activeRiskConfig,vessel=this.vessel;
    if(!row||!config||!vessel||!this.riskEngine.centralReady){
      this.projectedRisk=null;this.factors=[];
      return; // Never present fallback browser defaults as the active central policy.
    }
    const valid=this.factorOrder.filter(key=>key!=='documentIntegrity'||
      Number(config.weights.documentIntegrity||0)>0).every(key=>
      row.signals.filter(signal=>signal.factor===key&&
        Number.isFinite(signal.severity)&&signal.severity>=0&&signal.severity<=100).length===1);
    if(!valid||this.riskEngine.validate(config).length){
      this.projectedRisk=null;this.factors=[];
      this.assessmentError=this.copy(
        'Cannot project risk: saved factor evidence or the published browser policy is invalid.',
        'لا يمكن حساب المخاطر: أدلة العوامل المحفوظة أو قواعد المتصفح غير صالحة.');
      return;
    }
    const required=this.factorOrder.filter(key=>key!=='documentIntegrity'||
      Number(config.weights.documentIntegrity||0)>0);
    if(required.some(key=>!row.signals.some(s=>s.factor===key&&Number.isFinite(s.severity)))){
      this.assessmentError=this.copy(
        'The current six-factor policy requires A03 evidence not present in this saved assessment. No risk score is inferred.',
        'السياسة الحالية تتطلب أدلة A03 غير الموجودة بالتقييم المحفوظ؛ لن نفترض درجة مخاطر.');
      this.projectedRisk=null;this.factors=[];return;
    }
    const severities=Object.fromEntries(required.map(key=>
      [key,row.signals.find(signal=>signal.factor===key)!.severity])) as Record<RiskFactorKey,number>;
    this.projectedRisk=this.riskEngine.evaluateFromAiSignals(vessel,severities,config);
    const previous=this.selectedFactor?.id;
    this.factors=this.factorOrder.filter(id=>row.signals.some(s=>s.factor===id)).map(id=>{
      const signal=row.signals.find(x=>x.factor===id)!;
      const weight=Number(config.weights[id]||0);
      return {
        id,label:this.factorLabels[id][0],labelAr:this.factorLabels[id][1],
        severity:signal.severity,weight,
        contribution:this.projectedRisk?.factors.find(f=>f.key===id)?.rawContribution
          ??signal.severity*weight/100,
        confidence:signal.confidence,evidenceIds:signal.evidenceIds||[],
        reason:signal.reason||'',sourceAgent:signal.sourceAgent
      };
    });
    this.selectedFactor=this.factors.find(x=>x.id===previous)||this.factors[0];
  }
  get riskScore():number|null{return this.projectedRisk?.score??null;}
  get riskLevel():string{return this.projectedRisk?.level||'Pending';}
  get sourceRiskScore():number|null{return this.assessment?.score??null;}
  get sourceRiskLevel():string{return this.assessment?.level||'Pending';}
  get policyChanged():boolean{
    const original=this.assessment?.ruleset,current=this.activeRiskConfig;
    if(!original||!current)return false;
    return original.mode!==current.mode||
      this.factorOrder.some(key=>original.weights[key]!==current.weights[key])||
      original.thresholds.watch!==current.thresholds.watch||
      original.thresholds.high!==current.thresholds.high||
      original.thresholds.critical!==current.thresholds.critical;
  }
  get projectedPriority():string{
    if(!this.assessment||!this.projectedRisk)return '—';
    return this.assessment.criticalOpenFinding||this.riskLevel==='Critical'
      ?'Priority Review':this.riskLevel==='High'?'Enhanced Monitoring':'Routine';
  }
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
    const t=this.activeRiskConfig?.thresholds??{watch:45,high:65,critical:85};
    return [
      {key:'Normal',min:0,max:t.watch-1,width:t.watch},
      {key:'Watch',min:t.watch,max:t.high-1,width:t.high-t.watch},
      {key:'High',min:t.high,max:t.critical-1,width:t.critical-t.high},
      {key:'Critical',min:t.critical,max:100,width:100-t.critical}
    ];
  }
  thresholdName(key:string):string{
    const d:Record<string,[string,string]>={
      Normal:['Normal','طبيعي'],Watch:['Watch','مراقبة'],
      High:['High','مرتفع'],Critical:['Critical','حرج']
    };
    const pair=d[key]||[key,key];
    return this.copy(pair[0],pair[1]);
  }
  get totalContribution():number{return this.factors.reduce((n,f)=>n+f.contribution,0);}
  get calculationMode():string{return this.activeRiskConfig?.mode||'weighted';}
  get modeAdjustment():number{
    if(!this.factors.length)return 0;
    const weighted=this.totalContribution;
    const maximum=Math.max(...this.factors.map(x=>x.severity));
    if(this.calculationMode==='conservative')return Math.max(0,maximum-weighted)*0.28;
    if(this.calculationMode==='max-signal')return (maximum-weighted)*0.32;
    return 0;
  }
  get reconstructedScore():number{
    return Math.round(Math.min(100,Math.max(0,this.totalContribution+this.modeAdjustment)));
  }
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
        '. التصنيف المتوقع من قواعد المخاطر المركزية المنشورة '+this.riskLabel+'، والأولوية المتوقعة '+this.projectedPriority+
        '. الدرجة الأصلية المحفوظة مستقلة، ولا يمثل هذا قرارًا تشغيليًا معتمدًا.'
      :'Saved A01/A02 signals identify '+names+' as the strongest observed severities. '+
        'The centrally published policy projects '+this.riskLevel+' risk and '+
        this.projectedPriority+' priority. The original Oracle assessment is unchanged. '+
        'This is a platform-calculated projection, not an agent recommendation or approved operational decision.';
  }
  guidanceName(g:GuidanceResult):string{return this.copy(g.title,g.titleAr);}
  selectFactor(f:RiskFactor):void{this.selectedFactor=f;}
}
