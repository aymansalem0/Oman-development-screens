import { NMC_OPERATIONAL_VESSELS } from './nmc-expanded-vessel-catalog';
import { riskLevel } from './nmc-vessel-catalog';
import {
  CandidateBusinessSignal,
  NmcInspectionReferral,
  PscTargetingContext,
  ServiceInspectionRequest,
  SmartInspectionCandidate,
  SmartInspectionCandidateSource,
  SmartInspectionEligibilityStatus,
  SmartInspectionRegime,
  SmartInspectionTargetingConfiguration
} from '../models/smart-inspection-candidate.models';

const POC_REFERENCE_DATE = '2026-10-08';

export const SMART_INSPECTION_TARGETING_CONFIG: SmartInspectionTargetingConfiguration = {
  pscAnnualInspectionTargetPercent: 10,
  recentPscInspectionWindowDays: 180,
  firstVisitAbsenceWindowDays: 365,
  sourceReference: 'Riyadh MoU published inspection-rate baseline; configurable for POC use'
};

const SERVICE_TYPES: ServiceInspectionRequest['serviceType'][] = [
  'CERTIFICATE_RENEWAL',
  'VESSEL_REGISTRATION',
  'OWNERSHIP_OR_TECHNICAL_CHANGE',
  'SAFETY_COMPLIANCE'
];

const SERVICE_FOCUS: Record<ServiceInspectionRequest['serviceType'], string[]> = {
  CERTIFICATE_RENEWAL: ['Statutory Certificates', 'Safety Equipment'],
  VESSEL_REGISTRATION: ['Vessel Identity', 'Hull & Machinery', 'Safety Equipment'],
  OWNERSHIP_OR_TECHNICAL_CHANGE: ['Vessel Particulars', 'Machinery', 'Certificates'],
  SAFETY_COMPLIANCE: ['Fire Safety', 'Lifesaving', 'Manning'],
  OTHER: ['General Compliance']
};

function isoDateOffset(days: number): string {
  const date = new Date(POC_REFERENCE_DATE + 'T00:00:00Z');
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function hasSyntheticServiceRequest(vesselId: number, flag: string): boolean {
  return flag === 'UAE' && (vesselId % 3 === 0 || vesselId === 13 || vesselId === 29);
}

function buildServiceRequest(vesselId: number, destination: string): ServiceInspectionRequest {
  const serviceType = SERVICE_TYPES[vesselId % SERVICE_TYPES.length];
  return {
    requestId: `SRV-INS-2026-${String(1000 + vesselId).padStart(5, '0')}`,
    serviceType,
    requestedInspectionType: 'UAE_SERVICE_INSPECTION',
    submittedAt: isoDateOffset(-((vesselId % 11) + 1)),
    dueDate: isoDateOffset((vesselId % 6) + 1),
    expectedPort: destination,
    requiredFocusAreas: SERVICE_FOCUS[serviceType],
    status: vesselId % 4 === 0 ? 'OPEN' : 'READY_FOR_INSPECTION'
  };
}

function buildNmcReferral(vesselId: number, imo: string, risk: number): NmcInspectionReferral | undefined {
  const shouldRefer = risk >= 65 && (vesselId === 1 || vesselId % 3 === 1);
  if (!shouldRefer) return undefined;

  const drivers: string[] = [];
  const focusAreas: string[] = [];
  const evidenceRefs: string[] = [];

  if (risk >= 45) {
    drivers.push('Open / recurring inspection deficiency');
    focusAreas.push('Previous Deficiencies');
    evidenceRefs.push(`INS-2026-${String(1300 + vesselId).padStart(5, '0')}`);
  }
  if (risk >= 55) {
    drivers.push('Certificate validity / condition concern');
    focusAreas.push('Statutory Certificates');
    evidenceRefs.push(`CERT-SC-${imo}`);
  }
  if (risk >= 65) {
    drivers.push('Movement / route exception');
    focusAreas.push('Navigation & Movement');
  }
  if (risk >= 80) {
    drivers.push('Cross-source data conflict');
    focusAreas.push('Evidence Verification');
    evidenceRefs.push(`DQC-${imo}`);
  }

  return {
    caseId: `NMC-2026-${String(4000 + vesselId).padStart(5, '0')}`,
    officialRisk: risk,
    riskLevel: riskLevel(risk),
    riskDrivers: drivers,
    focusAreas: Array.from(new Set(focusAreas)),
    urgency: risk >= 85 ? 'IMMEDIATE' : 'PRIORITY',
    evidenceRefs
  };
}

function buildPscContext(
  vesselId: number,
  destination: string,
  eta: string,
  risk: number,
  hasNmcReferral: boolean
): PscTargetingContext {
  const lastPscInspectionDaysAgo = 20 + ((vesselId * 37) % 540);
  const previousDeficiencyCount = risk >= 65 ? 3 + (vesselId % 4) : risk >= 45 ? 1 + (vesselId % 3) : vesselId % 2;
  const recurringDeficiency = risk >= 55 && vesselId % 2 === 1;
  const previousDetention = vesselId % 29 === 0;
  const classSuspendedOrWithdrawn = vesselId % 113 === 0;
  const pilotOrPortAuthorityReport = vesselId % 47 === 0;
  const certificateConcern = risk >= 55;
  const firstVisitOrAbsentTwelveMonths = vesselId % 11 === 0 || lastPscInspectionDaysAgo >= SMART_INSPECTION_TARGETING_CONFIG.firstVisitAbsenceWindowDays;
  const inspectedWithinSixMonths = lastPscInspectionDaysAgo < SMART_INSPECTION_TARGETING_CONFIG.recentPscInspectionWindowDays;

  const clearGrounds =
    hasNmcReferral ||
    previousDetention ||
    classSuspendedOrWithdrawn ||
    pilotOrPortAuthorityReport ||
    recurringDeficiency ||
    risk >= 75;

  return {
    portCallId: `PORTCALL-2026-${String(7000 + vesselId).padStart(5, '0')}`,
    expectedPort: destination,
    eta,
    lastPscInspectionDaysAgo,
    inspectedWithinSixMonths,
    firstVisitOrAbsentTwelveMonths,
    previousDeficiencyCount,
    recurringDeficiency,
    previousDetention,
    classSuspendedOrWithdrawn,
    pilotOrPortAuthorityReport,
    certificateConcern,
    clearGrounds,
    annualTargetPopulationEligible: true
  };
}

function buildBusinessSignals(
  serviceRequest: ServiceInspectionRequest | undefined,
  psc: PscTargetingContext | undefined,
  nmc: NmcInspectionReferral | undefined
): CandidateBusinessSignal[] {
  const signals: CandidateBusinessSignal[] = [];

  if (serviceRequest) {
    signals.push({
      code: 'SERVICE_REQUIRES_INSPECTION',
      label: `Service request requires ${serviceRequest.requestedInspectionType}`,
      severity: 'HIGH',
      source: 'SERVICE'
    });
  }

  if (psc?.firstVisitOrAbsentTwelveMonths) {
    signals.push({
      code: 'PSC_FIRST_OR_12M_RETURN',
      label: 'First visit / return after 12 months',
      severity: 'WATCH',
      source: 'PSC'
    });
  }
  if (psc?.recurringDeficiency) {
    signals.push({
      code: 'RECURRING_DEFICIENCY',
      label: 'Recurring deficiency pattern',
      severity: 'HIGH',
      source: 'INSPECTION_HISTORY'
    });
  }
  if (psc?.previousDetention) {
    signals.push({
      code: 'PREVIOUS_DETENTION',
      label: 'Previous detention in synthetic PSC history',
      severity: 'HIGH',
      source: 'PSC'
    });
  }
  if (psc?.classSuspendedOrWithdrawn) {
    signals.push({
      code: 'CLASS_STATUS_ALERT',
      label: 'Class status requires priority review',
      severity: 'CRITICAL',
      source: 'PSC'
    });
  }
  if (psc?.pilotOrPortAuthorityReport) {
    signals.push({
      code: 'PORT_AUTHORITY_REPORT',
      label: 'Pilot / port authority report requires review',
      severity: 'HIGH',
      source: 'PSC'
    });
  }
  if (psc?.certificateConcern) {
    signals.push({
      code: 'CERTIFICATE_CONCERN',
      label: 'Certificate validity / condition concern',
      severity: 'HIGH',
      source: 'CERTIFICATE'
    });
  }
  if (nmc) {
    signals.push({
      code: 'NMC_REFERRAL',
      label: `NMC referral · ${nmc.riskLevel} ${nmc.officialRisk}/100`,
      severity: nmc.riskLevel === 'Critical' ? 'CRITICAL' : 'HIGH',
      source: 'NMC'
    });
  }

  return signals;
}

function selectRegime(
  serviceRequest: ServiceInspectionRequest | undefined,
  psc: PscTargetingContext | undefined,
  nmc: NmcInspectionReferral | undefined
): SmartInspectionRegime | null {
  if (serviceRequest) return serviceRequest.requestedInspectionType;
  if (psc) return 'PORT_STATE_CONTROL';
  if (nmc) return 'FOCUSED_INSPECTION';
  return null;
}

function selectEligibility(
  serviceRequest: ServiceInspectionRequest | undefined,
  psc: PscTargetingContext | undefined,
  nmc: NmcInspectionReferral | undefined
): SmartInspectionEligibilityStatus {
  if (serviceRequest) return 'MANDATORY';

  if (psc) {
    if (psc.inspectedWithinSixMonths && !psc.clearGrounds) return 'DEFER_RECENT_PSC';
    return 'ELIGIBLE';
  }

  if (nmc) return 'ELIGIBLE';
  return 'NOT_APPLICABLE';
}

export const SMART_INSPECTION_CANDIDATES: SmartInspectionCandidate[] = NMC_OPERATIONAL_VESSELS.map(vessel => {
  const serviceRequest = hasSyntheticServiceRequest(vessel.id, vessel.flag)
    ? buildServiceRequest(vessel.id, vessel.destination)
    : undefined;

  const nmcReferral = buildNmcReferral(vessel.id, vessel.imo, vessel.risk);

  const pscContext = vessel.flag !== 'UAE'
    ? buildPscContext(vessel.id, vessel.destination, vessel.eta, vessel.risk, Boolean(nmcReferral))
    : undefined;

  const candidateSources: SmartInspectionCandidateSource[] = [];
  if (serviceRequest) candidateSources.push('SERVICE_REQUEST');
  if (pscContext) candidateSources.push('PSC_PORT_CALL');
  if (nmcReferral) candidateSources.push('NMC_CASE');

  const eligibilityStatus = selectEligibility(serviceRequest, pscContext, nmcReferral);

  return {
    vessel,
    imo: vessel.imo,
    vesselId: vessel.id,
    candidateSources,
    inspectionRegime: selectRegime(serviceRequest, pscContext, nmcReferral),
    eligibilityStatus,
    candidateState:
      eligibilityStatus === 'DEFER_RECENT_PSC'
        ? 'DEFERRED'
        : eligibilityStatus === 'NOT_APPLICABLE'
          ? 'DISCOVERED'
          : 'CANDIDATE',
    expectedPort: serviceRequest?.expectedPort || pscContext?.expectedPort || vessel.destination,
    eta: vessel.eta,
    serviceRequest,
    pscContext,
    nmcReferral,
    businessSignals: buildBusinessSignals(serviceRequest, pscContext, nmcReferral),
    requiresHumanReview: Boolean(
      pscContext?.classSuspendedOrWithdrawn ||
      pscContext?.pilotOrPortAuthorityReport ||
      nmcReferral?.riskLevel === 'Critical'
    )
  };
});

export const SMART_INSPECTION_ACTIVE_CANDIDATES = SMART_INSPECTION_CANDIDATES.filter(
  candidate => candidate.candidateSources.length > 0
);

export function getSmartInspectionCandidateByImo(imo: string): SmartInspectionCandidate | undefined {
  return SMART_INSPECTION_CANDIDATES.find(candidate => candidate.imo === imo);
}
