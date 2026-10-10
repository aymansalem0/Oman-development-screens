import {NmcNavigationComponent} from '../components/nmc-navigation.component';
import {NmcMinistryLogoComponent} from '../components/nmc-ministry-logo.component';
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
  imports:[CommonModule,RouterLink,NmcNavigationComponent,NmcMinistryLogoComponent],
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
  factorViewSource:'CURRENT'|'SAVED'='CURRENT';
  projectionNotice='';
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
      this.assessment=null;this.projectedRisk=null;this.projectionNotice='';
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
        this.assessmentError='';
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
  /**
   * The CURRENT central risk policy may require a sixth A03 signal that an
   * older saved A01/A02 assessment does not have. In that situation never
   * invent a current score, but ALWAYS show the saved original factor trace.
   * This also keeps source-assessed Watch vessels visible for human review.
   */
  private updatePolicyProjection():void{
    const row=this.assessment,config=this.activeRiskConfig,vessel=this.vessel;
    this.projectedRisk=null;
    this.projectionNotice='';
    if(!row||!vessel){this.factors=[];this.selectedFactor=undefined;return;}
    const core=this.factorOrder.filter(key=>key!=='documentIntegrity');
    const hasValidSignal=(key:FactorKey):boolean=>
      row.signals.filter(s=>s.factor===key&&Number.isFinite(s.severity)&&
        s.severity>=0&&s.severity<=100).length===1;
    const validCore=core.every(hasValidSignal);
    const needsDocument=Number(config?.weights?.documentIntegrity||0)>0;
    const validPolicy=Boolean(config&&this.riskEngine.centralReady&&
      this.riskEngine.validate(config).length===0);
    const canProject=validCore&&validPolicy&&(!needsDocument||hasValidSignal('documentIntegrity'));
    if(canProject&&config){
      const required=this.factorOrder.filter(key=>key!=='documentIntegrity'||needsDocument);
      const severities=Object.fromEntries(required.map(key=>
        [key,row.signals.find(s=>s.factor===key)!.severity])) as Record<RiskFactorKey,number>;
      this.projectedRisk=this.riskEngine.evaluateFromAiSignals(vessel,severities,config);
    }else{
      this.projectionNotice=!validCore?
        this.copy('Some original A01/A02 risk factors are missing or invalid. Only recorded, individually valid signals are displayed; no current policy score is inferred.',
          'بعض عوامل A01/A02 الأصلية غير متوفرة أو غير صالحة. تُعرض الإشارات المحفوظة الصالحة فقط ولا يتم افتراض درجة للسياسة الحالية.') :
        needsDocument&&!hasValidSignal('documentIntegrity')?
          this.copy('The currently published risk policy requires A03 Document Integrity evidence, which is missing from this saved assessment. Current risk is UNAVAILABLE; the original saved risk and its factors are shown unchanged.',
            'السياسة المنشورة حاليًا تشترط دليل اتساق مستندات A03 وهو غير موجود في هذا التقييم. المخاطر الحالية غير متاحة؛ تُعرض المخاطر والعوامل الأصلية المحفوظة دون تغيير.') :
          this.copy('The current published risk policy is unavailable or invalid. The original saved risk and supported factors are still available for review.',
            'السياسة المنشورة حاليًا غير متاحة أو غير صالحة. تبقى درجة المخاطر الأصلية والعوامل المحفوظة متاحة للمراجعة.');
    }
    // Never apply new weights to old factors if a complete current policy
    // projection is impossible. Keep original ruleset contributions distinct.
    this.factorViewSource=canProject?'CURRENT':'SAVED';
    const weights=canProject?config?.weights:row.ruleset?.weights;
    const previous=this.selectedFactor?.id;
    this.factors=this.factorOrder.filter(hasValidSignal).map(id=>{
      const signal=row.signals.find(s=>s.factor===id)!;
      const weight=Number(weights?.[id]||0);
      return {
        id,label:this.factorLabels[id][0],labelAr:this.factorLabels[id][1],
        severity:signal.severity,weight,
        contribution:this.projectedRisk?.factors.find(f=>f.key===id)?.rawContribution
          ??signal.severity*weight/100,
        confidence:signal.confidence,evidenceIds:signal.evidenceIds||[],
        reason:signal.reason||'',sourceAgent:signal.sourceAgent
      };
    });
    this.selectedFactor=this.factors.find(f=>f.id===previous)||this.factors[0];
    this.assessmentError='';
  }
  get riskScore():number|null{return this.projectedRisk?.score??null;}
  get riskLevel():string{return this.projectedRisk?.level||(this.assessment?'Unavailable':'Pending');}
  get sourceRiskScore():number|null{return this.assessment?.score??null;}
  get sourceRiskLevel():string{return this.assessment?.level||'Pending';}

  /** Read-only source assessment visibility: distinct from CURRENT projected risk. */
  get sourceRiskClass():string{
    const level=this.sourceRiskLevel.toLowerCase();
    return ['watch','high','critical','normal'].includes(level)?level:'unavailable';
  }
  get sourceRiskLabel():string{
    const labels:Record<string,[string,string]>={
      Normal:['Normal','طبيعي'],Watch:['Watch','مراقبة'],
      High:['High','مرتفع'],Critical:['Critical','حرج']
    };
    const pair=labels[this.sourceRiskLevel];
    return pair?this.copy(pair[0],pair[1]):this.copy('Unavailable','غير متاح');
  }
  /** Never infer a new risk when A03 is required by the current policy. */
  get missingRequiredA03():boolean{
    return Boolean(this.assessment&&this.riskEngine.centralReady&&
      Number(this.activeRiskConfig?.weights.documentIntegrity||0)>0&&
      !this.assessment.signals.some(s=>s.factor==='documentIntegrity'&&
        Number.isFinite(s.severity)&&s.severity>=0&&s.severity<=100));
  }
  /** Top recorded contributing factors from the ORIGINAL assessment weights only. */
  get savedRiskDrivers():Array<{label:string;factor:string;severity:number;weight:number;
      contribution:number;evidenceCount:number}>{
    const assessment=this.assessment;
    if(!assessment)return [];
    const weights=assessment.ruleset?.weights;
    const values=assessment.signals.filter(s=>Number.isFinite(s.severity)&&
      s.severity>=0&&s.severity<=100&&this.factorOrder.includes(s.factor as FactorKey))
      .map(s=>{
        const factor=s.factor as FactorKey;
        const weight=Number(weights?.[factor]||0);
        return {
          label:this.copy(...this.factorLabels[factor]),
          factor, severity:s.severity,weight,
          contribution:Number((s.severity*weight/100).toFixed(2)),
          evidenceCount:s.evidenceIds?.length||0
        };
      });
    return values.sort((a,b)=>b.contribution-a.contribution).slice(0,3);
  }
  /** Ranges shown here belong to the saved ORIGINAL ruleset, not the new policy. */
  get originalClassRange():string{
    const config=this.assessment?.ruleset?.thresholds;
    if(!config)return '—';
    const {watch,high,critical}=config;
    if(this.sourceRiskLevel==='Normal')return '0–'+(watch-1);
    if(this.sourceRiskLevel==='Watch')return watch+'–'+(high-1);
    if(this.sourceRiskLevel==='High')return high+'–'+(critical-1);
    if(this.sourceRiskLevel==='Critical')return critical+'–100';
    return '—';
  }

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
      High:['High','مرتفع'],Critical:['Critical','حرج'],Pending:['Pending','بانتظار التقييم'],
      Unavailable:['Unavailable','غير متاحة']
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
  get calculationMode():string{return (this.factorViewSource==='CURRENT'?this.activeRiskConfig?.mode:
    this.assessment?.ruleset?.mode)||'weighted';}
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
    if(!this.projectedRisk){
      return this.copy('The original saved AI assessment remains '+this.sourceRiskLevel+
        ' ('+this.sourceRiskScore+'/100). A current policy projection is unavailable; no new risk is inferred.',
        'التقييم الأصلي المحفوظ ما زال '+this.sourceRiskLevel+' ('+this.sourceRiskScore+
        '/100). حساب السياسة الحالية غير متاح؛ لم نفترض درجة مخاطر جديدة.');
    }
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
