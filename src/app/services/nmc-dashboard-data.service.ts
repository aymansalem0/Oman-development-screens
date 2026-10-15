import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { NmcVesselProfile, RiskLevel } from '../data/nmc-vessel-catalog';
import { NMC_OPERATIONAL_VESSELS } from '../data/nmc-expanded-vessel-catalog';
import { NmcRiskEngineService, RiskFactorKey } from './nmc-risk-engine.service';

export interface DashboardSavedAssessment {
  imo: string;
  assessmentId: string | null;
  assessedAt: string | null;
  savedRiskScore: number;
  savedRiskLevel: string;
  rulesetVersion: string | null;
  criticalOpenFinding: boolean;
  factorSeverities: Record<RiskFactorKey,number>;
}

export interface DashboardAnalyticsResponse {
  status: 'ok';
  fleetSize: number;
  assessments: DashboardSavedAssessment[];
}

export interface DashboardVessel extends NmcVesselProfile {
  calculatedRisk: number | null;
  riskCategory: RiskLevel | 'Pending';
  attention: boolean;
  priorityReview: boolean;
  assessmentDate: string | null;
  riskSource: 'RECALCULATED_FROM_STORED_AI' | 'AWAITING_ASSESSMENT';
}

@Injectable({providedIn:'root'})
export class NmcDashboardDataService {
  constructor(private readonly http:HttpClient,private readonly riskEngine:NmcRiskEngineService){}

  load():Observable<DashboardAnalyticsResponse>{
    return this.http.get<DashboardAnalyticsResponse>('/api/ai/fleet/analytics');
  }

  /**
   * Applies the currently configured deterministic Risk Engine to STORED AI
   * factors. No API calls or synthetic fallback assessments are generated here.
   * Unassessed vessels remain Pending rather than inheriting catalog risk.
   */
  compose(response:DashboardAnalyticsResponse):DashboardVessel[]{
    const stored=new Map(response.assessments.map(a=>[a.imo,a]));
    return NMC_OPERATIONAL_VESSELS.map(v=>{
      const assessment=stored.get(v.imo);
      let risk:number|null=null;
      if(assessment && this.validFactors(assessment.factorSeverities)){
        risk=this.riskEngine.evaluateFromAiSignals(v,assessment.factorSeverities).score;
      }
      const level=risk===null?'Pending':this.riskEngine.levelForScore(risk);
      const critical=Boolean(assessment?.criticalOpenFinding);
      return {
        ...v,calculatedRisk:risk,riskCategory:level,
        attention:risk!==null&&(level!=='Normal'||critical),
        priorityReview:risk!==null&&(level==='Critical'||critical),
        assessmentDate:risk===null?null:(assessment?.assessedAt||null),
        riskSource:risk===null?'AWAITING_ASSESSMENT':'RECALCULATED_FROM_STORED_AI'
      };
    });
  }

  private validFactors(values:Record<RiskFactorKey,number>):boolean{
    return ['movement','inspection','certificate','dataQuality','history']
      .every(key=>typeof values?.[key as RiskFactorKey]==='number'&&
        Number.isFinite(values[key as RiskFactorKey])&&values[key as RiskFactorKey]>=0&&
        values[key as RiskFactorKey]<=100);
  }
}
