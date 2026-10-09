import type {RiskEngineConfig} from './nmc-risk-engine.service';
import {Injectable} from '@angular/core';
import {HttpClient} from '@angular/common/http';
import {Observable} from 'rxjs';

export interface FleetAiVessel {
  imo: string;
  status: 'COMPLETED' | 'FAILED';
  score?: number;
  assessmentId?: string;
  level?: 'Normal' | 'Watch' | 'High' | 'Critical';
  operationalPriority?: 'Priority Review' | 'Enhanced Monitoring' | 'Routine';
  criticalOpenFinding?: boolean;
  assessedAt?: string;
  sourceMode?: 'GOOGLE_SHEETS_LIVE' | 'LOCAL_FIXTURE_SNAPSHOT';
  configVersion?: string;
  reasonCode?: string;
  lastCheckedAt?: string;
  nextCheckAt?: string;
  refreshFailure?: string|null;
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
  scheduler?: {
    mode:string;enabled:boolean;enabledVessels:number;checkIntervalSeconds:number;
    lastTickAt:string|null;lastError:string|null;
    lastSelected:number;lastUnchanged:number;batchRunning:boolean;
  };
  job: null | {
    id:string;status:'RUNNING'|'COMPLETED'|'CANCELLED';
    total:number;completed:number;failed:number;
    startedAt:string;finishedAt:string|null;
  };
  results: Record<string,FleetAiVessel>;
}
/** How the synthetic data-quality engine reached its persisted structural score. */
export interface FleetAiQualityStep {
  key: 'completeness' | 'consistency' | 'evidenceLinkage' | 'provenance';
  label: string;
  percent: number | null;
  weightPercent: number;
  numerator: number;
  denominator: number;
  rawContribution: number | null;
}
export interface FleetAiFieldComparison {
  field: string;
  internalValue: string | null;
  externalValue: string | null;
  internalSource: string;
  externalSource: string;
  internalEvidenceId: string | null;
  externalEvidenceId: string | null;
  status: 'MATCHED' | 'MISMATCH' | 'MISSING';
  comparisonRule: string;
}
export interface FleetAiEvidenceLink {
  factor: string;
  agent: string;
  evidenceId: string;
  matched: boolean;
  source: string;
}
export interface FleetAiProvenanceCheck {
  field: 'sourceSystem' | 'datasetVersion' | 'retrievedAt';
  value: string | null;
  present: boolean;
}
export interface FleetAiIntelligence {
  imo: string;
  assessmentId: string | null;
  dataNature: 'SYNTHETIC_POC_NOT_OFFICIAL';
  independentlyVerifiedDataConfidence: null;
  quality: {
    score: number | null;
    status: 'CALCULATED' | 'INSUFFICIENT_EVIDENCE' | 'NOT_CALCULATED';
    version: string | null;
    breakdown: null | {
      scoreKind: 'STRUCTURAL_QUALITY_NOT_DATA_CONFIDENCE';
      completenessPercent: number;
      consistencyPercent: number | null;
      evidenceLinkagePercent: number | null;
      provenanceMetadataPercent: number;
      comparedFields: number;
      missingFieldSides: number;
      disagreementCount: number;
      syntheticUnverifiedScoreCap: number;
      rawScoreBeforeSyntheticCap?: number | null;
      syntheticDiscountFactor?: number;
      rawWeightedContributionMethod?: string;
      finalScoreMethod?: string;
      identityValueSidesPresent?: number;
      identityValueSidesExpected?: number;
      matchingIdentityFields?: number;
      evidenceReferencesLinked?: number;
      evidenceReferencesTotal?: number;
      calculationSteps?: FleetAiQualityStep[];
      fieldComparisons?: FleetAiFieldComparison[];
      evidenceLinkages?: FleetAiEvidenceLink[];
      provenanceChecks?: FleetAiProvenanceCheck[];
      sourceProvenance?: {
        internalSystem: string;
        externalSystem: string;
        pscSourceSystem: string | null;
        pscDatasetVersion: string | null;
        pscRetrievedAt: string | null;
        pscMode: string;
        reconstruction: string;
      };
      note: string;
      reconstructionNotice?: string;
    };
  };
  conflicts: Array<{
    CONFLICT_ID: string;
    FIELD_NAME: string;
    STATUS: 'PENDING_REVIEW' | 'CONFIRMED' | 'DISMISSED' | 'RESOLVED';
    CONFLICT_SUMMARY: string;
    SOURCE_A_EVIDENCE_ID: string | null;
    SOURCE_B_EVIDENCE_ID: string | null;
    FIRST_DETECTED_ASSESSMENT_ID: string | null;
    LAST_ASSESSMENT_ID: string | null;
  }>;
}

export interface FleetAiHistory {
  imo: string;
  assessments: Array<{
    ASSESSMENT_ID: string;
    RISK_SCORE: number;
    RISK_LEVEL: string;
    OPERATIONAL_PRIORITY: string;
    RULESET_VERSION: string;
    ASSESSED_AT: string;
  }>;
  events: Array<{
    EVENT_TYPE: string;
    EVENT_DESCRIPTION: string | null;
    PREVIOUS_RISK_SCORE: number | null;
    NEW_RISK_SCORE: number | null;
    OCCURRED_AT: string;
  }>;
  dataNature: 'SYNTHETIC_POC_NOT_OFFICIAL';
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
  /** Fresh Oracle/JSON persisted snapshot; never invokes Airia or the scheduler. */
  fetchSaved():Observable<FleetAiSnapshot & {fetchedFrom:string;fetchedAt:string}>{
    return this.http.get<FleetAiSnapshot & {fetchedFrom:string;fetchedAt:string}>(
      '/api/ai/fleet/saved-status');
  }
  assessment(imo:string):Observable<FleetAiAssessment>{
    return this.http.get<FleetAiAssessment>('/api/ai/fleet/results/'+encodeURIComponent(imo));
  }
  history(imo:string):Observable<FleetAiHistory>{
    return this.http.get<FleetAiHistory>('/api/ai/fleet/history/'+encodeURIComponent(imo));
  }
  intelligence(imo:string):Observable<FleetAiIntelligence>{
    return this.http.get<FleetAiIntelligence>('/api/ai/fleet/intelligence/'+encodeURIComponent(imo));
  }

}
