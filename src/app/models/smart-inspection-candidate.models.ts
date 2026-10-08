import { NmcVesselProfile, RiskLevel } from '../data/nmc-vessel-catalog';

export type SmartInspectionCandidateSource =
  | 'SERVICE_REQUEST'
  | 'PSC_PORT_CALL'
  | 'NMC_CASE';

export type SmartInspectionRegime =
  | 'UAE_SERVICE_INSPECTION'
  | 'PORT_STATE_CONTROL'
  | 'FOLLOW_UP_INSPECTION'
  | 'FOCUSED_INSPECTION';

export type SmartInspectionEligibilityStatus =
  | 'NOT_APPLICABLE'
  | 'ELIGIBLE'
  | 'MANDATORY'
  | 'DEFER_RECENT_PSC'
  | 'MANUAL_REVIEW';

export type SmartInspectionCandidateState =
  | 'DISCOVERED'
  | 'ELIGIBILITY_CHECKED'
  | 'CANDIDATE'
  | 'AI_ASSESSED'
  | 'RECOMMENDED'
  | 'SELECTED'
  | 'DEFERRED'
  | 'EXCLUDED'
  | 'INSPECTION_CREATED';

export interface ServiceInspectionRequest {
  requestId: string;
  serviceType:
    | 'CERTIFICATE_RENEWAL'
    | 'VESSEL_REGISTRATION'
    | 'OWNERSHIP_OR_TECHNICAL_CHANGE'
    | 'SAFETY_COMPLIANCE'
    | 'OTHER';
  requestedInspectionType: SmartInspectionRegime;
  submittedAt: string;
  dueDate: string;
  expectedPort: string;
  requiredFocusAreas: string[];
  status: 'OPEN' | 'READY_FOR_INSPECTION';
}

export interface PscTargetingContext {
  portCallId: string;
  expectedPort: string;
  eta: string;
  lastPscInspectionDaysAgo: number | null;
  inspectedWithinSixMonths: boolean;
  firstVisitOrAbsentTwelveMonths: boolean;
  previousDeficiencyCount: number;
  recurringDeficiency: boolean;
  previousDetention: boolean;
  classSuspendedOrWithdrawn: boolean;
  pilotOrPortAuthorityReport: boolean;
  certificateConcern: boolean;
  clearGrounds: boolean;
  annualTargetPopulationEligible: boolean;
}

export interface NmcInspectionReferral {
  caseId: string;
  officialRisk: number;
  riskLevel: RiskLevel;
  riskDrivers: string[];
  focusAreas: string[];
  urgency: 'ROUTINE' | 'PRIORITY' | 'IMMEDIATE';
  evidenceRefs: string[];
}

export interface CandidateBusinessSignal {
  code: string;
  label: string;
  severity: 'INFO' | 'WATCH' | 'HIGH' | 'CRITICAL';
  source: 'SERVICE' | 'PSC' | 'NMC' | 'INSPECTION_HISTORY' | 'CERTIFICATE';
}

export interface SmartInspectionCandidate {
  vessel: Readonly<NmcVesselProfile>;
  imo: string;
  vesselId: number;
  candidateSources: SmartInspectionCandidateSource[];
  inspectionRegime: SmartInspectionRegime | null;
  eligibilityStatus: SmartInspectionEligibilityStatus;
  candidateState: SmartInspectionCandidateState;
  expectedPort: string;
  eta: string;
  serviceRequest?: ServiceInspectionRequest;
  pscContext?: PscTargetingContext;
  nmcReferral?: NmcInspectionReferral;
  businessSignals: CandidateBusinessSignal[];
  requiresHumanReview: boolean;
}

export interface SmartInspectionCandidateSummary {
  totalVessels: number;
  uniqueCandidates: number;
  serviceTriggeredCandidates: number;
  foreignPortCallCandidates: number;
  nmcReferredCandidates: number;
  overlappingSourceCandidates: number;
  eligibleCandidates: number;
  deferredRecentPsc: number;
}

export interface SmartInspectionTargetingConfiguration {
  pscAnnualInspectionTargetPercent: number;
  recentPscInspectionWindowDays: number;
  firstVisitAbsenceWindowDays: number;
  sourceReference: string;
}
