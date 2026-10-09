import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import {
  SmartInspectionCandidate,
  SmartInspectionCandidateSource,
  SmartInspectionEligibilityStatus
} from '../models/smart-inspection-candidate.models';
import { LanguageService } from '../services/language.service';
import { SmartInspectionCandidateService } from '../services/smart-inspection-candidate.service';

type CandidateFilter = 'ALL' | 'SERVICE_REQUEST' | 'PSC_PORT_CALL' | 'NMC_CASE';
type EligibilityFilter = 'ALL' | SmartInspectionEligibilityStatus;
type TargetingBand = 'Critical' | 'High' | 'Watch' | 'Routine';

@Component({
  selector: 'app-smart-inspection-candidate-center',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './smart-inspection-candidate-center.component.html',
  styleUrl: './smart-inspection-candidate-center.component.css'
})
export class SmartInspectionCandidateCenterComponent {
  searchTerm = '';
  sourceFilter: CandidateFilter = 'ALL';
  eligibilityFilter: EligibilityFilter = 'ALL';
  portFilter = 'ALL';
  selectedCandidate?: SmartInspectionCandidate;
  page = 1;
  readonly pageSize = 18;

  constructor(
    public readonly lang: LanguageService,
    public readonly candidatesService: SmartInspectionCandidateService
  ) {}

  copy(en: string, ar: string): string {
    return this.lang.pick(en, ar);
  }

  toggleLanguage(): void {
    this.lang.toggle();
  }

  get summary() {
    return this.candidatesService.summary;
  }

  get targetingConfig() {
    return this.candidatesService.targetingConfiguration;
  }

  get ports(): string[] {
    return Array.from(new Set(this.candidatesService.candidates.map(item => item.expectedPort))).sort();
  }

  get filteredCandidates(): SmartInspectionCandidate[] {
    const term = this.searchTerm.trim().toLowerCase();

    return this.candidatesService.candidates.filter(candidate => {
      const vessel = candidate.vessel;
      const matchesSearch = !term || [
        vessel.name,
        vessel.imo,
        vessel.flag,
        vessel.type,
        candidate.expectedPort,
        candidate.nmcReferral?.caseId || '',
        candidate.serviceRequest?.requestId || ''
      ].some(value => String(value).toLowerCase().includes(term));

      const matchesSource =
        this.sourceFilter === 'ALL' || candidate.candidateSources.includes(this.sourceFilter);

      const matchesEligibility =
        this.eligibilityFilter === 'ALL' || candidate.eligibilityStatus === this.eligibilityFilter;

      const matchesPort = this.portFilter === 'ALL' || candidate.expectedPort === this.portFilter;

      return matchesSearch && matchesSource && matchesEligibility && matchesPort;
    }).sort((a, b) => this.targetingScore(b) - this.targetingScore(a));
  }

  get pageCount(): number {
    return Math.max(1, Math.ceil(this.filteredCandidates.length / this.pageSize));
  }

  get pagedCandidates(): SmartInspectionCandidate[] {
    const safePage = Math.min(this.page, this.pageCount);
    const start = (safePage - 1) * this.pageSize;
    return this.filteredCandidates.slice(start, start + this.pageSize);
  }

  get foreignPscPopulation(): number {
    return this.candidatesService.bySource('PSC_PORT_CALL').length;
  }

  get projectedPscTarget(): number {
    return Math.ceil(this.foreignPscPopulation * this.targetingConfig.pscAnnualInspectionTargetPercent / 100);
  }

  setSourceFilter(filter: CandidateFilter): void {
    this.sourceFilter = filter;
    this.page = 1;
  }

  setEligibilityFilter(filter: EligibilityFilter): void {
    this.eligibilityFilter = filter;
    this.page = 1;
  }

  onFilterChange(): void {
    this.page = 1;
  }

  selectCandidate(candidate: SmartInspectionCandidate): void {
    this.selectedCandidate = candidate;
  }

  closeCandidate(): void {
    this.selectedCandidate = undefined;
  }

  previousPage(): void {
    this.page = Math.max(1, this.page - 1);
  }

  nextPage(): void {
    this.page = Math.min(this.pageCount, this.page + 1);
  }

  sourceLabel(source: SmartInspectionCandidateSource): string {
    const labels: Record<SmartInspectionCandidateSource, [string, string]> = {
      SERVICE_REQUEST: ['Service Request', 'طلب خدمة'],
      PSC_PORT_CALL: ['PSC / Port Call', 'رقابة دولة الميناء / زيارة ميناء'],
      NMC_CASE: ['NMC Case', 'حالة NMC']
    };
    const [en, ar] = labels[source];
    return this.copy(en, ar);
  }

  eligibilityLabel(status: SmartInspectionEligibilityStatus): string {
    const labels: Record<SmartInspectionEligibilityStatus, [string, string]> = {
      NOT_APPLICABLE: ['Not Applicable', 'لا ينطبق'],
      ELIGIBLE: ['Eligible', 'مؤهلة'],
      MANDATORY: ['Mandatory', 'إلزامية'],
      DEFER_RECENT_PSC: ['Defer · Recent PSC', 'تأجيل · تفتيش PSC حديث'],
      MANUAL_REVIEW: ['Manual Review', 'مراجعة يدوية']
    };
    const [en, ar] = labels[status];
    return this.copy(en, ar);
  }

  regimeLabel(candidate: SmartInspectionCandidate): string {
    const labels: Record<string, [string, string]> = {
      UAE_SERVICE_INSPECTION: ['UAE Service Inspection', 'معاينة مرتبطة بخدمة إماراتية'],
      PORT_STATE_CONTROL: ['Port State Control', 'رقابة دولة الميناء'],
      FOLLOW_UP_INSPECTION: ['Follow-up Inspection', 'معاينة متابعة'],
      FOCUSED_INSPECTION: ['Focused Inspection', 'معاينة مركزة']
    };
    if (!candidate.inspectionRegime) return this.copy('Not determined', 'لم يحدد بعد');
    const label = labels[candidate.inspectionRegime] || [candidate.inspectionRegime, candidate.inspectionRegime];
    return this.copy(label[0], label[1]);
  }

  targetingScore(candidate: SmartInspectionCandidate): number {
    let score = 0;

    if (candidate.eligibilityStatus === 'MANDATORY') score += 45;
    else if (candidate.eligibilityStatus === 'ELIGIBLE') score += 20;
    else if (candidate.eligibilityStatus === 'DEFER_RECENT_PSC') score -= 30;

    score += Math.round(candidate.vessel.risk * 0.35);

    if (candidate.candidateSources.includes('NMC_CASE')) score += 25;
    if (candidate.candidateSources.includes('SERVICE_REQUEST')) score += 18;

    const psc = candidate.pscContext;
    if (psc?.clearGrounds) score += 18;
    if (psc?.recurringDeficiency) score += 12;
    if (psc?.previousDetention) score += 10;
    if (psc?.classSuspendedOrWithdrawn) score += 16;
    if (psc?.pilotOrPortAuthorityReport) score += 12;
    if (psc?.firstVisitOrAbsentTwelveMonths) score += 8;
    if (psc?.inspectedWithinSixMonths && !psc.clearGrounds) score -= 20;

    return Math.max(0, Math.min(100, score));
  }

  targetingBand(candidate: SmartInspectionCandidate): TargetingBand {
    const score = this.targetingScore(candidate);
    if (score >= 80) return 'Critical';
    if (score >= 60) return 'High';
    if (score >= 40) return 'Watch';
    return 'Routine';
  }

  targetingBandLabel(candidate: SmartInspectionCandidate): string {
    const band = this.targetingBand(candidate);
    const labels: Record<TargetingBand, [string, string]> = {
      Critical: ['Critical', 'حرجة'],
      High: ['High', 'مرتفعة'],
      Watch: ['Watch', 'مراقبة'],
      Routine: ['Routine', 'اعتيادية']
    };
    return this.copy(labels[band][0], labels[band][1]);
  }

  sourceClass(source: SmartInspectionCandidateSource): string {
    return source.toLowerCase().replaceAll('_', '-');
  }

  trackByImo(_: number, candidate: SmartInspectionCandidate): string {
    return candidate.imo;
  }
}
