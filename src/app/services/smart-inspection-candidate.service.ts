import { Injectable } from '@angular/core';

import {
  SMART_INSPECTION_ACTIVE_CANDIDATES,
  SMART_INSPECTION_CANDIDATES,
  SMART_INSPECTION_TARGETING_CONFIG,
  getSmartInspectionCandidateByImo
} from '../data/smart-inspection-candidate-catalog';
import {
  SmartInspectionCandidate,
  SmartInspectionCandidateSource,
  SmartInspectionCandidateSummary,
  SmartInspectionEligibilityStatus,
  SmartInspectionTargetingConfiguration
} from '../models/smart-inspection-candidate.models';

@Injectable({ providedIn: 'root' })
export class SmartInspectionCandidateService {
  readonly targetingConfiguration: Readonly<SmartInspectionTargetingConfiguration> =
    SMART_INSPECTION_TARGETING_CONFIG;

  get population(): ReadonlyArray<SmartInspectionCandidate> {
    return SMART_INSPECTION_CANDIDATES;
  }

  get candidates(): ReadonlyArray<SmartInspectionCandidate> {
    return SMART_INSPECTION_ACTIVE_CANDIDATES;
  }

  get summary(): SmartInspectionCandidateSummary {
    const sourceCount = (source: SmartInspectionCandidateSource): number =>
      this.candidates.filter(candidate => candidate.candidateSources.includes(source)).length;

    const eligibleStatuses: SmartInspectionEligibilityStatus[] = ['ELIGIBLE', 'MANDATORY'];

    return {
      totalVessels: this.population.length,
      uniqueCandidates: this.candidates.length,
      serviceTriggeredCandidates: sourceCount('SERVICE_REQUEST'),
      foreignPortCallCandidates: sourceCount('PSC_PORT_CALL'),
      nmcReferredCandidates: sourceCount('NMC_CASE'),
      overlappingSourceCandidates: this.candidates.filter(candidate => candidate.candidateSources.length > 1).length,
      eligibleCandidates: this.candidates.filter(candidate => eligibleStatuses.includes(candidate.eligibilityStatus)).length,
      deferredRecentPsc: this.candidates.filter(candidate => candidate.eligibilityStatus === 'DEFER_RECENT_PSC').length
    };
  }

  byImo(imo: string): SmartInspectionCandidate | undefined {
    return getSmartInspectionCandidateByImo(imo);
  }

  bySource(source: SmartInspectionCandidateSource): ReadonlyArray<SmartInspectionCandidate> {
    return this.candidates.filter(candidate => candidate.candidateSources.includes(source));
  }

  eligible(): ReadonlyArray<SmartInspectionCandidate> {
    return this.candidates.filter(candidate =>
      candidate.eligibilityStatus === 'ELIGIBLE' || candidate.eligibilityStatus === 'MANDATORY'
    );
  }

  deferredRecentPsc(): ReadonlyArray<SmartInspectionCandidate> {
    return this.candidates.filter(candidate => candidate.eligibilityStatus === 'DEFER_RECENT_PSC');
  }

  requiringHumanReview(): ReadonlyArray<SmartInspectionCandidate> {
    return this.candidates.filter(candidate => candidate.requiresHumanReview);
  }
}
