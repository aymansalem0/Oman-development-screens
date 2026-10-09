import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import type { FleetAiIntelligence, FleetAiQualityStep, FleetAiFieldComparison } from './nmc-fleet-ai.service';

export type QualityMetricKey = 'completeness' | 'consistency' | 'evidenceLinkage' | 'provenance';
export type QualityIdentityField = 'VESSEL_NAME' | 'FLAG' | 'VESSEL_TYPE' | 'OPERATOR_NAME';
export const QUALITY_METRICS: QualityMetricKey[] = ['completeness','consistency','evidenceLinkage','provenance'];
export const QUALITY_ID_FIELDS: QualityIdentityField[] = ['VESSEL_NAME','FLAG','VESSEL_TYPE','OPERATOR_NAME'];

export interface QualityDemoPolicy {
  version: string;
  weights: Record<QualityMetricKey,number>;
  enabledFields: QualityIdentityField[];
  syntheticDiscountPercent: number;
  changeReason: string;
  publishedAt: string;
}
export interface QualityPolicyImpact {
  score: number | null;
  rawScore: number | null;
  status: 'CALCULATED' | 'INSUFFICIENT_EVIDENCE';
  steps: FleetAiQualityStep[];
  selectedFields: FleetAiFieldComparison[];
  totalWeight: number;
  syntheticDiscountPercent: number;
  syntheticCap: 75;
  effectiveScorePercent: number | null;
}
const DEFAULT: QualityDemoPolicy = {
  version:'NMC Quality Demo Policy 1.0',
  weights:{completeness:35,consistency:30,evidenceLinkage:20,provenance:15},
  enabledFields:[...QUALITY_ID_FIELDS],
  syntheticDiscountPercent:75,
  changeReason:'Initial local demonstration policy — not applied to Oracle',
  publishedAt:''
};
const pct=(n:number):number=>Math.max(0,Math.min(100,Math.round(n)));
const percent=(part:number,total:number):number|null=>total ? pct(part/total*100) : null;
const metric=(key:QualityMetricKey,value:number|null,weight:number,num:number,den:number):FleetAiQualityStep=>({
  key,label:key,percent:value,weightPercent:weight,numerator:num,denominator:den,
  rawContribution:value===null?null:Math.round(value*weight)/100
});

/** Calculation replays persisted source evidence; it never fabricates records or overwrites Oracle. */
export function projectQuality(
  breakdown:NonNullable<FleetAiIntelligence['quality']['breakdown']>,
  cfg:QualityDemoPolicy
):QualityPolicyImpact {
  const fields=(breakdown.fieldComparisons||[])
    .filter(f=>cfg.enabledFields.includes(f.field as QualityIdentityField));
  const selectedUnique=new Set(fields.map(f=>f.field));
  const missingConfigured=cfg.enabledFields.some(field=>!selectedUnique.has(field));
  const presentSides=fields.reduce((sum,f)=>sum+Number(f.internalValue!==null)+Number(f.externalValue!==null),0);
  const sidesExpected=cfg.enabledFields.length*2;
  const both=fields.filter(f=>f.internalValue!==null&&f.externalValue!==null);
  const matched=both.filter(f=>f.status==='MATCHED').length;
  const links=breakdown.evidenceLinkages||[];
  const verifiedLinks=links.filter(link=>link.matched).length;
  const checks=breakdown.provenanceChecks||[];
  const validChecks=checks.filter(check=>check.present).length;
  // Mirror backend V1 provenance heuristic exactly (3/3 ->100, else 60).
  const provenanceScore=checks.length===3&&validChecks===3?100:60;
  const measures=[
    metric('completeness',missingConfigured?null:percent(presentSides,sidesExpected),
      cfg.weights.completeness,presentSides,sidesExpected),
    metric('consistency',missingConfigured?null:percent(matched,both.length),
      cfg.weights.consistency,matched,both.length),
    metric('evidenceLinkage',links.length?percent(verifiedLinks,links.length):null,
      cfg.weights.evidenceLinkage,verifiedLinks,links.length),
    metric('provenance',checks.length===3?provenanceScore:null,
      cfg.weights.provenance,validChecks,3)
  ];
  const insufficient=missingConfigured || !both.length || !links.length ||
    checks.length!==3 || measures.some(s=>s.percent===null);
  const raw=insufficient?null:Math.round(measures.reduce(
    (sum,s)=>sum+(s.percent||0)*s.weightPercent/100,0));
  const discounted=raw===null?null:Math.round(raw*cfg.syntheticDiscountPercent/100);
  return {
    score:discounted===null?null:Math.min(75,discounted),
    rawScore:raw,status:insufficient?'INSUFFICIENT_EVIDENCE':'CALCULATED',
    steps:measures,selectedFields:fields,
    totalWeight:QUALITY_METRICS.reduce((sum,k)=>sum+cfg.weights[k],0),
    syntheticDiscountPercent:cfg.syntheticDiscountPercent,
    syntheticCap:75,effectiveScorePercent:discounted
  };
}

@Injectable({providedIn:'root'})
export class NmcDataQualityConfigService {
  private readonly storageKey='moei-nmc-quality-demo-policy-v1';
  private readonly current=new BehaviorSubject<QualityDemoPolicy>(this.load());
  readonly changes=this.current.asObservable();

  get config():QualityDemoPolicy { return this.copy(this.current.value); }
  get defaults():QualityDemoPolicy { return this.copy(DEFAULT); }
  copy(value:QualityDemoPolicy):QualityDemoPolicy {
    return {...value,weights:{...value.weights},enabledFields:[...value.enabledFields]};
  }
  validate(config:QualityDemoPolicy):string[] {
    const errors:string[]=[];
    if(!config||!config.weights||!Array.isArray(config.enabledFields))return ['Invalid quality policy'];
    const weights=QUALITY_METRICS.map(k=>Number(config.weights[k]));
    if(weights.some(w=>!Number.isInteger(w)||w<0||w>100))errors.push('Each metric weight must be an integer between 0 and 100.');
    if(weights.every(Number.isInteger)&&weights.reduce((sum,n)=>sum+n,0)!==100)
      errors.push('Metric weights must total exactly 100%.');
    if(!Number.isInteger(config.syntheticDiscountPercent) ||
       config.syntheticDiscountPercent<40||config.syntheticDiscountPercent>75)
      errors.push('Synthetic evidence discount must be 40–75%; higher implies unjustified confidence.');
    if(config.enabledFields.length<1 ||
       new Set(config.enabledFields).size!==config.enabledFields.length ||
       config.enabledFields.some(f=>!QUALITY_ID_FIELDS.includes(f)))
      errors.push('Select at least one valid identity field without duplicates.');
    if(config.changeReason.trim().length<10)
      errors.push('Explain the change in at least 10 characters.');
    return errors;
  }
  /** Browser-scoped policy only. No unauthenticated writes to Oracle or shared fleet data. */
  publish(draft:QualityDemoPolicy):QualityDemoPolicy {
    const errors=this.validate(draft);
    if(errors.length)throw new Error(errors.join(' '));
    const next=this.copy(draft);
    const previous=this.current.value.version.match(/(\d+)\.(\d+)$/);
    next.version=previous?this.current.value.version.replace(/\d+\.\d+$/, `${previous[1]}.${Number(previous[2])+1}`)
      :'NMC Quality Demo Policy 1.1';
    next.publishedAt=new Date().toISOString();
    localStorage.setItem(this.storageKey,JSON.stringify(next));
    this.current.next(next);
    return this.copy(next);
  }
  restoreDefaults():void {
    localStorage.removeItem(this.storageKey);
    this.current.next(this.defaults);
  }
  private load():QualityDemoPolicy {
    try {
      const raw=localStorage.getItem(this.storageKey);
      if(raw){
        const parsed=JSON.parse(raw) as QualityDemoPolicy;
        const cfg={...DEFAULT,...parsed,weights:{...DEFAULT.weights,...parsed.weights},
          enabledFields:[...(parsed.enabledFields||[])]};
        if(!this.validate(cfg).length)return this.copy(cfg);
      }
    }catch{}
    return this.copy(DEFAULT);
  }
}
