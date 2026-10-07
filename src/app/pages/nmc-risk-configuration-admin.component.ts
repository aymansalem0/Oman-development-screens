import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { NMC_OPERATIONAL_VESSELS } from '../data/nmc-expanded-vessel-catalog';
import { NmcVesselProfile, RiskLevel } from '../data/nmc-vessel-catalog';
import { LanguageService } from '../services/language.service';
import {
  NmcRiskEngineService,
  RiskCalculationMode,
  RiskEngineConfig,
  RiskFactorKey,
  RiskPopulationStats
} from '../services/nmc-risk-engine.service';

interface ImpactRow {
  vessel: NmcVesselProfile;
  currentScore: number;
  currentLevel: RiskLevel;
  projectedScore: number;
  projectedLevel: RiskLevel;
  delta: number;
  changedLevel: boolean;
}

@Component({
  selector: 'app-nmc-risk-configuration-admin',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './nmc-risk-configuration-admin.component.html',
  styleUrl: './nmc-risk-configuration-admin.component.css'
})
export class NmcRiskConfigurationAdminComponent implements OnInit {
  draft!: RiskEngineConfig;
  published!: RiskEngineConfig;
  currentStats!: RiskPopulationStats;
  projectedStats!: RiskPopulationStats;
  impactRows: ImpactRow[] = [];
  validationErrors: string[] = [];
  publishedMessage = '';

  readonly factorKeys: RiskFactorKey[] = [
    'movement',
    'inspection',
    'certificate',
    'dataQuality',
    'history'
  ];

  readonly modes: Array<{value: RiskCalculationMode; en: string; ar: string; descriptionEn: string; descriptionAr: string}> = [
    {
      value: 'weighted',
      en: 'Weighted Evidence Model',
      ar: 'نموذج الأدلة الموزونة',
      descriptionEn: 'Calculates the vessel score from weighted evidence factors.',
      descriptionAr: 'يحسب درجة مخاطر السفينة من عوامل الأدلة الموزونة.'
    },
    {
      value: 'conservative',
      en: 'Conservative Risk Model',
      ar: 'نموذج المخاطر التحفظي',
      descriptionEn: 'Adds extra influence when one factor is materially higher than the combined score.',
      descriptionAr: 'يزيد التأثير عندما يكون أحد عوامل الخطر أعلى بشكل جوهري من الدرجة المجمعة.'
    },
    {
      value: 'max-signal',
      en: 'Highest Signal Blend',
      ar: 'دمج أعلى مؤشر خطر',
      descriptionEn: 'Blends the weighted score with the highest active risk signal.',
      descriptionAr: 'يمزج الدرجة الموزونة مع أعلى مؤشر خطر نشط.'
    }
  ];

  constructor(
    public lang: LanguageService,
    public riskEngine: NmcRiskEngineService
  ) {}

  ngOnInit(): void {
    this.loadPublished();
  }

  copy(en: string, ar: string): string {
    return this.lang.pick(en, ar);
  }

  toggleLanguage(): void {
    this.lang.toggle();
  }

  get totalWeight(): number {
    return this.factorKeys.reduce((sum, key) => sum + Number(this.draft.weights[key] || 0), 0);
  }

  get changedVesselCount(): number {
    return this.impactRows.filter(row => row.currentScore !== row.projectedScore).length;
  }

  get changedLevelCount(): number {
    return this.impactRows.filter(row => row.changedLevel).length;
  }

  get averageAbsoluteDelta(): number {
    if (!this.impactRows.length) return 0;
    return Number((
      this.impactRows.reduce((sum, row) => sum + Math.abs(row.delta), 0) / this.impactRows.length
    ).toFixed(1));
  }

  get canPublish(): boolean {
    return this.validationErrors.length === 0 && this.totalWeight === 100;
  }

  get currentModeLabel(): string {
    return this.modeLabel(this.published.mode);
  }

  factorLabel(key: RiskFactorKey): string {
    const labels: Record<RiskFactorKey, [string,string]> = {
      movement: ['Movement & route behavior', 'الحركة وسلوك المسار'],
      inspection: ['Inspection & deficiencies', 'المعاينات والملاحظات'],
      certificate: ['Certificates & regulatory status', 'الشهادات والحالة التنظيمية'],
      dataQuality: ['Data quality & source conflicts', 'جودة البيانات وتعارض المصادر'],
      history: ['Vessel / operator history', 'السجل التاريخي للسفينة / المشغل']
    };
    return this.copy(labels[key][0], labels[key][1]);
  }

  factorDescription(key: RiskFactorKey): string {
    const labels: Record<RiskFactorKey, [string,string]> = {
      movement: ['AIS/LRIT movement patterns, route deviation and operational behavior.', 'أنماط AIS/LRIT والانحراف عن المسار والسلوك التشغيلي.'],
      inspection: ['Open deficiencies, inspection outcomes and technical exposure.', 'الملاحظات المفتوحة ونتائج المعاينة والتعرض الفني.'],
      certificate: ['Certificate validity, conditions and regulatory compliance signals.', 'صلاحية الشهادات وشروطها ومؤشرات الامتثال التنظيمي.'],
      dataQuality: ['Source confidence, completeness and unresolved data conflicts.', 'الثقة في المصادر واكتمال البيانات والتعارضات غير المحلولة.'],
      history: ['Historical vessel, operator and recurring compliance patterns.', 'السجل التاريخي للسفينة والمشغل وأنماط الامتثال المتكررة.']
    };
    return this.copy(labels[key][0], labels[key][1]);
  }

  modeLabel(mode: RiskCalculationMode): string {
    const found = this.modes.find(item => item.value === mode);
    return found ? this.copy(found.en, found.ar) : mode;
  }

  modeDescription(mode: RiskCalculationMode): string {
    const found = this.modes.find(item => item.value === mode);
    return found ? this.copy(found.descriptionEn, found.descriptionAr) : '';
  }

  levelLabel(level: RiskLevel): string {
    const labels: Record<RiskLevel,[string,string]> = {
      Normal: ['Normal','طبيعي'],
      Watch: ['Watch','مراقبة'],
      High: ['High','مرتفع'],
      Critical: ['Critical','حرج']
    };
    return this.copy(labels[level][0], labels[level][1]);
  }

  updateDraft(): void {
    this.publishedMessage = '';
    this.validationErrors = this.riskEngine.validate(this.draft);
    this.rebuildPreview();
  }

  normalizeWeights(): void {
    const total = this.totalWeight;
    if (!total) return;

    let assigned = 0;
    this.factorKeys.forEach((key, index) => {
      if (index === this.factorKeys.length - 1) {
        this.draft.weights[key] = 100 - assigned;
      } else {
        const normalized = Math.round((this.draft.weights[key] / total) * 100);
        this.draft.weights[key] = normalized;
        assigned += normalized;
      }
    });

    this.updateDraft();
  }

  loadPublished(): void {
    this.published = this.riskEngine.config;
    this.draft = this.riskEngine.cloneConfig(this.published);
    this.validationErrors = this.riskEngine.validate(this.draft);
    this.rebuildPreview();
  }

  discardChanges(): void {
    this.draft = this.riskEngine.cloneConfig(this.published);
    this.publishedMessage = '';
    this.updateDraft();
  }

  resetDraftToDefaults(): void {
    const defaults = this.riskEngine.defaults;
    defaults.changeReason = this.copy('Restore default NMC risk model', 'استعادة نموذج مخاطر NMC الافتراضي');
    this.draft = defaults;
    this.publishedMessage = '';
    this.updateDraft();
  }

  publish(): void {
    this.validationErrors = this.riskEngine.validate(this.draft);
    if (this.validationErrors.length) return;

    this.published = this.riskEngine.publish(this.draft);
    this.draft = this.riskEngine.cloneConfig(this.published);
    this.rebuildPreview();
    this.publishedMessage = this.copy(
      `Published successfully. All ${NMC_OPERATIONAL_VESSELS.length} vessel risks were re-evaluated.`,
      `تم النشر بنجاح. تمت إعادة تقييم مخاطر جميع السفن وعددها ${NMC_OPERATIONAL_VESSELS.length}.`
    );
  }

  private rebuildPreview(): void {
    this.currentStats = this.riskEngine.stats(NMC_OPERATIONAL_VESSELS, this.published);
    this.projectedStats = this.riskEngine.stats(NMC_OPERATIONAL_VESSELS, this.draft);

    this.impactRows = NMC_OPERATIONAL_VESSELS
      .map(vessel => {
        const current = this.riskEngine.evaluate(vessel, this.published);
        const projected = this.riskEngine.evaluate(vessel, this.draft);
        return {
          vessel,
          currentScore: current.score,
          currentLevel: current.level,
          projectedScore: projected.score,
          projectedLevel: projected.level,
          delta: projected.score - current.score,
          changedLevel: current.level !== projected.level
        };
      })
      .sort((a,b) =>
        Number(b.changedLevel) - Number(a.changedLevel) ||
        Math.abs(b.delta) - Math.abs(a.delta) ||
        b.projectedScore - a.projectedScore
      )
      .slice(0, 12);
  }
}
