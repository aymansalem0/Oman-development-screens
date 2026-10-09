import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { NmcVesselProfile, RiskLevel } from '../data/nmc-vessel-catalog';
import { NMC_OPERATIONAL_VESSELS } from '../data/nmc-expanded-vessel-catalog';

export type RiskFactorKey = 'movement' | 'inspection' | 'certificate' | 'dataQuality' | 'history';
export type RiskCalculationMode = 'weighted' | 'conservative' | 'max-signal';

export interface RiskWeights {
  movement: number;
  inspection: number;
  certificate: number;
  dataQuality: number;
  history: number;
}

export interface RiskThresholds {
  watch: number;
  high: number;
  critical: number;
}

export interface RiskEngineConfig {
  version: string;
  name: string;
  mode: RiskCalculationMode;
  weights: RiskWeights;
  thresholds: RiskThresholds;
  publishedAt: string;
  publishedBy: string;
  changeReason: string;
}

export interface RiskFactorEvaluation {
  key: RiskFactorKey;
  severity: number;
  weight: number;
  rawContribution: number;
  contribution: number;
}

export interface RiskEvaluation {
  score: number;
  baseScore: number;
  delta: number;
  level: RiskLevel;
  factors: RiskFactorEvaluation[];
}

export interface RiskPopulationStats {
  normal: number;
  watch: number;
  high: number;
  critical: number;
  attention: number;
  averageScore: number;
}

const DEFAULT_CONFIG: RiskEngineConfig = {
  version: 'NMC Risk Ruleset 1.0',
  name: 'National Maritime Risk Model',
  mode: 'weighted',
  weights: {
    movement: 25,
    inspection: 28,
    certificate: 20,
    dataQuality: 14,
    history: 13
  },
  thresholds: {
    watch: 45,
    high: 65,
    critical: 85
  },
  publishedAt: '07 Oct 2026 · 22:42',
  publishedBy: 'NMC Risk Administrator',
  changeReason: 'Initial operational ruleset'
};

@Injectable({ providedIn: 'root' })
export class NmcRiskEngineService {
  private readonly storageKey = 'moei-nmc-risk-engine-config:v1';
  private readonly baselineRisk = new Map<number, number>(
    NMC_OPERATIONAL_VESSELS.map(vessel => [vessel.id, vessel.risk])
  );

  private readonly configSubject = new BehaviorSubject<RiskEngineConfig>(this.loadConfig());
  readonly config$ = this.configSubject.asObservable();

  get config(): RiskEngineConfig {
    return this.cloneConfig(this.configSubject.value);
  }

  get defaults(): RiskEngineConfig {
    return this.cloneConfig(DEFAULT_CONFIG);
  }

  /**
   * Keep policy projections in sync across browser tabs without silently
   * modifying any saved Oracle AI assessment or operational case.
   * This is local Risk Management policy only, not a centrally approved policy.
   */
  syncPublishedFromStorage(): void {
    const incoming = this.loadConfig();
    if (this.validate(incoming).length) return;
    if (JSON.stringify(incoming) !== JSON.stringify(this.configSubject.value)) {
      this.configSubject.next(incoming);
    }
  }

  cloneConfig(config: RiskEngineConfig): RiskEngineConfig {
    return JSON.parse(JSON.stringify(config)) as RiskEngineConfig;
  }

  publish(config: RiskEngineConfig): RiskEngineConfig {
    const next = this.cloneConfig(config);
    next.version = this.nextVersion(this.configSubject.value.version);
    next.publishedAt = new Intl.DateTimeFormat('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).format(new Date()).replace(',', ' ·');
    next.publishedBy = next.publishedBy || 'NMC Risk Administrator';
    next.changeReason = next.changeReason || 'Risk model configuration updated';

    this.saveConfig(next);
    this.configSubject.next(next);
    return this.cloneConfig(next);
  }

  resetToDefaults(): RiskEngineConfig {
    const defaults = this.cloneConfig(DEFAULT_CONFIG);
    this.saveConfig(defaults);
    this.configSubject.next(defaults);
    return defaults;
  }

  evaluate(vessel: NmcVesselProfile, config: RiskEngineConfig = this.configSubject.value): RiskEvaluation {
    const baseScore = this.getBaselineRisk(vessel);
    const severities = this.factorSeverities(vessel, baseScore);

    const defaultWeighted = this.weightedScore(severities, DEFAULT_CONFIG.weights);
    const calibration = baseScore - defaultWeighted;
    const currentWeighted = this.weightedScore(severities, config.weights);

    let score = currentWeighted + calibration;

    if (config.mode === 'conservative') {
      const highestSignal = Math.max(...Object.values(severities));
      score += Math.max(0, highestSignal - score) * 0.28;
    } else if (config.mode === 'max-signal') {
      const highestSignal = Math.max(...Object.values(severities));
      score = (score * 0.68) + (highestSignal * 0.32);
    }

    score = Math.round(this.clamp(score, 0, 100));

    const factorEntries = (Object.keys(severities) as RiskFactorKey[]).map(key => {
      const weight = Math.max(0, Number(config.weights[key] || 0));
      const rawContribution = this.weightContribution(severities[key], weight, config.weights);
      return {
        key,
        severity: Math.round(severities[key]),
        weight,
        rawContribution,
        contribution: 0
      };
    });

    const rawTotal = factorEntries.reduce((sum, factor) => sum + factor.rawContribution, 0);
    let assigned = 0;

    factorEntries.forEach((factor, index) => {
      if (index === factorEntries.length - 1) {
        factor.contribution = Math.max(0, score - assigned);
      } else {
        factor.contribution = rawTotal > 0
          ? Math.max(0, Math.round((factor.rawContribution / rawTotal) * score))
          : 0;
        assigned += factor.contribution;
      }
    });

    return {
      score,
      baseScore,
      delta: score - baseScore,
      level: this.levelForScore(score, config),
      factors: factorEntries
    };
  }


  /**
   * Calculates a POC risk score exclusively from five validated AI severities.
   * No synthetic baseline calibration is applied to actual AI-derived severities.
   * Does NOT publish a decision, change vessel state or perform any enforcement.
   */
  evaluateFromAiSignals(
    vessel: NmcVesselProfile,
    severities: Record<RiskFactorKey, number>,
    config: RiskEngineConfig = this.configSubject.value
  ): RiskEvaluation {
    const keys: RiskFactorKey[] = ['movement', 'inspection', 'certificate', 'dataQuality', 'history'];
    if (!keys.every(key => Number.isFinite(severities[key]) && severities[key] >= 0 && severities[key] <= 100)) {
      throw new Error('All five AI risk severities must be finite numbers from 0 to 100.');
    }

    let score = this.weightedScore(severities, config.weights);
    const highestSignal = Math.max(...keys.map(key => severities[key]));
    if (config.mode === 'conservative') {
      score += Math.max(0, highestSignal - score) * 0.28;
    } else if (config.mode === 'max-signal') {
      score = (score * 0.68) + (highestSignal * 0.32);
    }
    score = Math.round(this.clamp(score, 0, 100));

    const factors: RiskFactorEvaluation[] = keys.map(key => {
      const weight = Math.max(0, Number(config.weights[key] || 0));
      return {
        key,
        severity: severities[key],
        weight,
        rawContribution: this.weightContribution(severities[key], weight, config.weights),
        contribution: 0
      };
    });

    const rawTotal = factors.reduce((total, factor) => total + factor.rawContribution, 0);
    let assigned = 0;
    factors.forEach((factor, index) => {
      factor.contribution = index === factors.length - 1
        ? Math.max(0, score - assigned)
        : (rawTotal ? Math.max(0, Math.round(factor.rawContribution / rawTotal * score)) : 0);
      assigned += factor.contribution;
    });
    const baseScore = this.getBaselineRisk(vessel);
    return {
      score,
      baseScore,
      delta: score - baseScore,
      level: this.levelForScore(score, config),
      factors
    };
  }

  applyToVessel(vessel: NmcVesselProfile, config: RiskEngineConfig = this.configSubject.value): NmcVesselProfile {
    const evaluation = this.evaluate(vessel, config);
    return {
      ...vessel,
      risk: evaluation.score
    };
  }

  applyToFleet(vessels: NmcVesselProfile[], config: RiskEngineConfig = this.configSubject.value): NmcVesselProfile[] {
    return vessels.map(vessel => this.applyToVessel(vessel, config));
  }

  levelForScore(score: number, config: RiskEngineConfig = this.configSubject.value): RiskLevel {
    if (score >= config.thresholds.critical) return 'Critical';
    if (score >= config.thresholds.high) return 'High';
    if (score >= config.thresholds.watch) return 'Watch';
    return 'Normal';
  }

  stats(vessels: NmcVesselProfile[], config: RiskEngineConfig = this.configSubject.value): RiskPopulationStats {
    const evaluations = vessels.map(vessel => this.evaluate(vessel, config));
    const result: RiskPopulationStats = {
      normal: 0,
      watch: 0,
      high: 0,
      critical: 0,
      attention: 0,
      averageScore: 0
    };

    for (const evaluation of evaluations) {
      if (evaluation.level === 'Critical') result.critical++;
      else if (evaluation.level === 'High') result.high++;
      else if (evaluation.level === 'Watch') result.watch++;
      else result.normal++;

      if (evaluation.level !== 'Normal') result.attention++;
    }

    result.averageScore = evaluations.length
      ? Number((evaluations.reduce((sum, item) => sum + item.score, 0) / evaluations.length).toFixed(1))
      : 0;

    return result;
  }

  thresholds(config: RiskEngineConfig = this.configSubject.value): Array<{label: RiskLevel; min: number; max: number}> {
    return [
      { label: 'Normal', min: 0, max: config.thresholds.watch - 1 },
      { label: 'Watch', min: config.thresholds.watch, max: config.thresholds.high - 1 },
      { label: 'High', min: config.thresholds.high, max: config.thresholds.critical - 1 },
      { label: 'Critical', min: config.thresholds.critical, max: 100 }
    ];
  }

  validate(config: RiskEngineConfig): string[] {
    const errors: string[] = [];
    const totalWeight = Object.values(config.weights).reduce((sum, value) => sum + Number(value || 0), 0);

    if (Math.round(totalWeight) !== 100) {
      errors.push('Risk factor weights must total 100%.');
    }

    if (
      config.thresholds.watch < 1 ||
      config.thresholds.watch >= config.thresholds.high ||
      config.thresholds.high >= config.thresholds.critical ||
      config.thresholds.critical > 100
    ) {
      errors.push('Thresholds must follow Normal < Watch < High < Critical and remain within 0–100.');
    }

    return errors;
  }

  private factorSeverities(vessel: NmcVesselProfile, baseScore: number): Record<RiskFactorKey, number> {
    const age = Math.max(0, 2026 - vessel.built);
    const deterministic = (multiplier: number, modulus: number, center: number): number =>
      ((vessel.id * multiplier) % modulus) - center;

    return {
      movement: this.clamp(
        baseScore +
        deterministic(17, 17, 8) * 1.05 +
        (vessel.speed < 5 ? 4 : 0) +
        (vessel.zone.includes('Approach') ? 2 : 0),
        0, 100
      ),
      inspection: this.clamp(
        baseScore +
        deterministic(23, 19, 9) * 1.0 +
        (age > 18 ? 5 : age > 12 ? 2 : 0),
        0, 100
      ),
      certificate: this.clamp(
        baseScore +
        deterministic(13, 15, 7) * 1.05 +
        (vessel.flag !== 'UAE' ? 2 : 0),
        0, 100
      ),
      dataQuality: this.clamp(
        baseScore +
        deterministic(11, 13, 6) * 0.8 +
        ((90 - vessel.dataConfidence) * 0.55),
        0, 100
      ),
      history: this.clamp(
        baseScore +
        deterministic(7, 21, 10) * 0.75 +
        (age > 20 ? 5 : age > 15 ? 3 : 0),
        0, 100
      )
    };
  }

  private weightedScore(severities: Record<RiskFactorKey, number>, weights: RiskWeights): number {
    const totalWeight = Object.values(weights).reduce((sum, value) => sum + Math.max(0, Number(value || 0)), 0);
    if (!totalWeight) return 0;

    return (Object.keys(severities) as RiskFactorKey[]).reduce(
      (sum, key) => sum + (severities[key] * Math.max(0, Number(weights[key] || 0))),
      0
    ) / totalWeight;
  }

  private weightContribution(severity: number, weight: number, weights: RiskWeights): number {
    const totalWeight = Object.values(weights).reduce((sum, value) => sum + Math.max(0, Number(value || 0)), 0);
    return totalWeight ? (severity * weight) / totalWeight : 0;
  }

  private getBaselineRisk(vessel: NmcVesselProfile): number {
    return this.baselineRisk.get(vessel.id) ?? vessel.risk;
  }

  private nextVersion(current: string): string {
    const match = current.match(/(\d+)(?:\.(\d+))?$/);
    if (!match) return 'NMC Risk Ruleset 1.1';

    const major = Number(match[1] || 1);
    const minor = Number(match[2] || 0) + 1;
    return current.replace(/\d+(?:\.\d+)?$/, `${major}.${minor}`);
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
  }

  private loadConfig(): RiskEngineConfig {
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (!raw) return this.cloneConfig(DEFAULT_CONFIG);
      const parsed = JSON.parse(raw) as RiskEngineConfig;
      return {
        ...this.cloneConfig(DEFAULT_CONFIG),
        ...parsed,
        weights: { ...DEFAULT_CONFIG.weights, ...(parsed.weights || {}) },
        thresholds: { ...DEFAULT_CONFIG.thresholds, ...(parsed.thresholds || {}) }
      };
    } catch {
      return this.cloneConfig(DEFAULT_CONFIG);
    }
  }

  private saveConfig(config: RiskEngineConfig): void {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(config));
    } catch {
      // Browser storage may be unavailable in restricted environments.
    }
  }
}
