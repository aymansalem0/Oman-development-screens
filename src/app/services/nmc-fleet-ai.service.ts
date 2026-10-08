import {Injectable} from '@angular/core';
import {HttpClient, HttpHeaders} from '@angular/common/http';
import {Observable} from 'rxjs';
import {RiskEngineConfig} from './nmc-risk-engine.service';
import {NmcVesselEvidenceBundle} from './nmc-vessel-evidence.service';

export interface FleetAiVessel {
  imo: string;
  status: 'COMPLETED' | 'FAILED';
  score?: number;
  level?: 'Normal' | 'Watch' | 'High' | 'Critical';
  operationalPriority?: 'Priority Review' | 'Enhanced Monitoring' | 'Routine';
  criticalOpenFinding?: boolean;
  assessedAt?: string;
  sourceMode?: 'GOOGLE_SHEETS_LIVE' | 'LOCAL_FIXTURE_SNAPSHOT';
  configVersion?: string;
  reasonCode?: string;
}
export interface FleetAiSnapshot {
  status: 'ok';
  provenance: 'SYNTHETIC_POC_AI_NOT_AUTHORITATIVE';
  fleetSize: 420;
  counts: {
    total: number;
    assessed: number;
    pending: number;
    normal: number;
    watch: number;
    high: number;
    critical: number;
    priorityReview: number;
    failed: number;
  };
  job: null | {
    id:string;status:'RUNNING'|'COMPLETED'|'CANCELLED';
    total:number;completed:number;failed:number;
    startedAt:string;finishedAt:string|null;
  };
  results: Record<string,FleetAiVessel>;
}
export interface FleetAiAssessment extends FleetAiVessel {
  signals: Array<{factor:string;severity:number;confidence:number;sourceAgent:string;evidenceIds:string[];reason:string}>;
  pscSummary: {inspections:number;deficiencies:number;openDeficiencies:number;detentions:number};
  ruleset: RiskEngineConfig;
  sourceNature:string; evidenceVerified:false; authoritative:false;
}
@Injectable({providedIn:'root'})
export class NmcFleetAiService {
  constructor(private readonly http:HttpClient){}
  snapshot():Observable<FleetAiSnapshot>{
    return this.http.get<FleetAiSnapshot>('/api/ai/fleet/status');
  }
  assessment(imo:string):Observable<FleetAiAssessment>{
    return this.http.get<FleetAiAssessment>('/api/ai/fleet/results/'+encodeURIComponent(imo));
  }
  start(bundles:NmcVesselEvidenceBundle[], config:RiskEngineConfig, token:string):Observable<{id:string;status:string;total:number;estimatedAiriaCalls:number}>{
    const vessels=bundles.map(b=>({
      imo:b.vessel.imo,
      evidenceIds:b.evidenceIds,
      inlineContext:b.inlineContext
    }));
    return this.http.post<{id:string;status:string;total:number;estimatedAiriaCalls:number}>(
      '/api/ai/fleet/start',{vessels,config},
      {headers:new HttpHeaders({'X-NMC-FLEET-ADMIN-TOKEN':token})}
    );
  }
  cancel(token:string):Observable<{status:string}>{
    return this.http.post<{status:string}>('/api/ai/fleet/cancel',{},
      {headers:new HttpHeaders({'X-NMC-FLEET-ADMIN-TOKEN':token})});
  }
}
