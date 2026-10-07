import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import {
  getVesselByImo,
  NMC_VESSELS,
  NmcVesselProfile,
  riskLevel
} from '../data/nmc-vessel-catalog';

type SourceClass =
  | 'MOEI Authoritative'
  | 'External Authoritative'
  | 'External Trusted'
  | 'Operational Feed'
  | 'Internal Derived';

interface RiskFactorEvidence {
  id: string;
  ruleId: string;
  label: string;
  contribution: number;
  source: string;
  sourceClass: SourceClass;
  authority: string;
  evidenceRecord: string;
  trigger: string;
  ruleLogic: string;
  sourceTrust: number;
  dataConfidence: number;
  identityMatch: number;
  freshness: number;
  conflict: boolean;
  status: 'Triggered' | 'Observed' | 'Historical';
  explanation: string;
}

interface ThresholdBand {
  label: string;
  min: number;
  max: number;
  className: string;
}

@Component({
  selector: 'app-nmc-risk-explainability',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './nmc-risk-explainability.component.html',
  styleUrl: './nmc-risk-explainability.component.css'
})
export class NmcRiskExplainabilityComponent implements OnInit {
  vessel!: NmcVesselProfile;
  factors: RiskFactorEvidence[] = [];
  selectedFactor?: RiskFactorEvidence;

  readonly thresholds: ThresholdBand[] = [
    { label: 'Normal', min: 0, max: 44, className: 'normal' },
    { label: 'Watch', min: 45, max: 64, className: 'watch' },
    { label: 'High', min: 65, max: 84, className: 'high' },
    { label: 'Critical', min: 85, max: 100, className: 'critical' }
  ];

  readonly engineVersion = 'NMC Risk Ruleset 1.0';
  readonly evaluatedAt = '07 Oct 2026 · 22:42:18';

  constructor(private route: ActivatedRoute) {}

  ngOnInit(): void {
    const imo = this.route.snapshot.paramMap.get('imo') || NMC_VESSELS[0].imo;
    this.vessel = getVesselByImo(imo) || NMC_VESSELS[0];
    this.factors = this.buildFactors();
    this.selectedFactor = this.factors[0];
  }

  get riskLevel(): string {
    return riskLevel(this.vessel.risk);
  }

  get riskClass(): string {
    return this.riskLevel.toLowerCase();
  }

  get isUaeFlag(): boolean {
    return this.vessel.flag === 'UAE';
  }

  get totalContribution(): number {
    return this.factors.reduce((sum, factor) => sum + factor.contribution, 0);
  }

  get triggeredCount(): number {
    return this.factors.filter(factor => factor.status === 'Triggered').length;
  }

  get conflictCount(): number {
    return this.factors.filter(factor => factor.conflict).length;
  }

  get scoreMarkerPosition(): number {
    return Math.max(1, Math.min(99, this.vessel.risk));
  }

  get flagRegistryAuthority(): string {
    const authorities: Record<string, string> = {
      UAE: 'MOEI Vessel Registry',
      Liberia: 'Liberia Maritime Authority',
      Panama: 'Panama Maritime Authority',
      'Marshall Is.': 'Marshall Islands Maritime Administrator',
      Singapore: 'Maritime and Port Authority of Singapore',
      Malta: 'Malta Ship Registry',
      'Hong Kong': 'Hong Kong Shipping Registry',
      Bahamas: 'Bahamas Maritime Authority'
    };
    return authorities[this.vessel.flag] || `${this.vessel.flag} Flag Administration`;
  }

  selectFactor(factor: RiskFactorEvidence): void {
    this.selectedFactor = factor;
  }

  private buildFactors(): RiskFactorEvidence[] {
    const risk = this.vessel.risk;
    const hasOpenDeficiency = risk >= 45;
    const hasMovementException = risk >= 65;
    const hasCertificateConcern = risk >= 55;
    const hasSourceConflict = risk >= 80;

    const movement = Math.max(3, Math.round(risk * 0.25));
    const inspection = hasOpenDeficiency
      ? Math.max(6, Math.round(risk * 0.28))
      : Math.max(2, Math.round(risk * 0.12));
    const certificate = hasCertificateConcern
      ? Math.max(5, Math.round(risk * 0.20))
      : Math.max(2, Math.round(risk * 0.10));
    const dataConflict = hasSourceConflict
      ? Math.max(5, Math.round(risk * 0.14))
      : Math.max(1, Math.round(risk * 0.06));
    const historical = Math.max(1, risk - movement - inspection - certificate - dataConflict);

    const certificateSource = this.isUaeFlag
      ? 'MOEI Certificate Registry'
      : `${this.vessel.flag} Flag / Verified Certificate Record`;
    const certificateClass: SourceClass = this.isUaeFlag
      ? 'MOEI Authoritative'
      : 'External Authoritative';

    return [
      {
        id: 'inspection',
        ruleId: 'RISK-INS-004',
        label: hasOpenDeficiency ? 'Open inspection deficiency' : 'Inspection exposure',
        contribution: inspection,
        source: 'MOEI Smart Inspection',
        sourceClass: 'MOEI Authoritative',
        authority: 'MOEI inspection record',
        evidenceRecord: `INS-2026-${String(1300 + this.vessel.id).padStart(5, '0')}`,
        trigger: hasOpenDeficiency
          ? 'An inspection finding remains open and requires corrective follow-up.'
          : 'Historical inspection context contributes a low baseline exposure.',
        ruleLogic: hasOpenDeficiency
          ? 'Open Major/Critical Deficiency → weighted inspection contribution'
          : 'No open deficiency → historical inspection baseline only',
        sourceTrust: 100,
        dataConfidence: 100,
        identityMatch: 100,
        freshness: 96,
        conflict: false,
        status: hasOpenDeficiency ? 'Triggered' : 'Historical',
        explanation: hasOpenDeficiency
          ? 'The risk engine uses the unresolved inspection finding because it is an active MOEI regulatory record linked directly to this IMO.'
          : 'No active deficiency is open, so the inspection factor is limited to historical exposure.'
      },
      {
        id: 'movement',
        ruleId: 'RISK-MOV-011',
        label: hasMovementException ? 'Movement anomaly / route deviation' : 'Voyage & movement exposure',
        contribution: movement,
        source: 'AIS / LRIT',
        sourceClass: 'Operational Feed',
        authority: 'Operational vessel tracking source',
        evidenceRecord: `AIS-${this.vessel.mmsi}`,
        trigger: hasMovementException
          ? 'Observed movement differs from the monitored route pattern and current voyage behavior.'
          : 'Current voyage, approach zone and movement state are monitored without a critical anomaly.',
        ruleLogic: hasMovementException
          ? 'Route deviation + abnormal movement pattern → movement risk contribution'
          : 'Active monitored voyage → baseline movement contribution',
        sourceTrust: 96,
        dataConfidence: Math.max(91, this.vessel.dataConfidence),
        identityMatch: 99,
        freshness: Math.max(92, 100 - Math.min(8, this.vessel.lastUpdate)),
        conflict: false,
        status: hasMovementException ? 'Triggered' : 'Observed',
        explanation: 'Movement risk is calculated from live position, speed, course, destination and route behavior after matching the tracking identity to the vessel record.'
      },
      {
        id: 'certificate',
        ruleId: 'RISK-CERT-007',
        label: hasSourceConflict
          ? 'Conditional certificate state'
          : hasCertificateConcern
            ? 'Certificate validity proximity / condition'
            : 'Certificate portfolio exposure',
        contribution: certificate,
        source: certificateSource,
        sourceClass: certificateClass,
        authority: this.isUaeFlag ? 'MOEI certificate authority' : this.flagRegistryAuthority,
        evidenceRecord: `CERT-SC-${this.vessel.imo}`,
        trigger: hasSourceConflict
          ? 'A certificate condition is active and requires verification.'
          : hasCertificateConcern
            ? 'A monitored statutory certificate is approaching a configured validity threshold.'
            : 'No critical certificate exception; normal portfolio exposure applies.',
        ruleLogic: hasSourceConflict
          ? 'Conditional / restricted certificate → elevated certificate contribution'
          : hasCertificateConcern
            ? 'Expiry/condition threshold reached → monitored certificate contribution'
            : 'Valid certificate portfolio → baseline contribution',
        sourceTrust: this.isUaeFlag ? 100 : 96,
        dataConfidence: hasSourceConflict ? 92 : 97,
        identityMatch: 100,
        freshness: hasSourceConflict ? 94 : 97,
        conflict: hasSourceConflict,
        status: hasCertificateConcern ? 'Triggered' : 'Observed',
        explanation: 'Certificate status is evaluated independently from movement and inspection data. Foreign-flag registration authority remains external to MOEI.'
      },
      {
        id: 'data-quality',
        ruleId: 'RISK-DQ-003',
        label: hasSourceConflict ? 'Authoritative source conflict' : 'Data-quality exposure',
        contribution: dataConflict,
        source: 'NMC Data Correlation Layer',
        sourceClass: 'Internal Derived',
        authority: 'Cross-source correlation and validation',
        evidenceRecord: `DQC-${this.vessel.imo}`,
        trigger: hasSourceConflict
          ? 'Two trusted sources report different certificate states for the same vessel record.'
          : 'No unresolved cross-source conflict; normal data-quality exposure remains.',
        ruleLogic: hasSourceConflict
          ? 'Unresolved authoritative conflict → data-quality risk contribution'
          : 'Matched sources → minimal data-quality contribution',
        sourceTrust: 98,
        dataConfidence: this.vessel.dataConfidence,
        identityMatch: 99,
        freshness: 97,
        conflict: hasSourceConflict,
        status: hasSourceConflict ? 'Triggered' : 'Observed',
        explanation: hasSourceConflict
          ? 'The platform preserves the conflict instead of silently choosing a source. Human verification is required before enforcement based on the disputed fact.'
          : 'Source correlation is healthy and no material conflict is currently unresolved.'
      },
      {
        id: 'history',
        ruleId: 'RISK-HIST-009',
        label: 'Historical vessel / operator risk pattern',
        contribution: historical,
        source: 'Inspection & Operator History',
        sourceClass: this.isUaeFlag ? 'MOEI Authoritative' : 'External Trusted',
        authority: this.isUaeFlag ? 'MOEI historical compliance context' : 'Verified historical maritime context',
        evidenceRecord: `HIST-${this.vessel.imo}`,
        trigger: 'Historical inspection, vessel and operator context contributes to the current risk baseline.',
        ruleLogic: 'Historical findings / operator pattern → weighted historical contribution',
        sourceTrust: this.isUaeFlag ? 100 : 94,
        dataConfidence: Math.max(90, this.vessel.dataConfidence),
        identityMatch: 99,
        freshness: 92,
        conflict: false,
        status: 'Historical',
        explanation: 'Historical risk is retained separately so current operational events do not erase recurring vessel or operator patterns.'
      }
    ];
  }
}
