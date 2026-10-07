import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import {
  getVesselByImo,
  NMC_VESSELS,
  NmcVesselProfile,
  riskLevel
} from '../data/nmc-vessel-catalog';
import { LanguageService } from '../services/language.service';

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

  constructor(private route: ActivatedRoute, public lang: LanguageService) {}

  copy(en: string, ar: string): string {
    return this.lang.pick(en, ar);
  }

  toggleLanguage(): void {
    const selectedId = this.selectedFactor?.id;
    this.lang.toggle();
    this.factors = this.buildFactors();
    this.selectedFactor = this.factors.find(factor => factor.id === selectedId) || this.factors[0];
  }

  riskLabel(level: string = this.riskLevel): string {
    const labels: Record<string, string> = {
      Critical: this.copy('Critical', 'حرج'),
      High: this.copy('High', 'مرتفع'),
      Watch: this.copy('Watch', 'مراقبة'),
      Normal: this.copy('Normal', 'طبيعي')
    };
    return labels[level] || level;
  }

  thresholdLabel(label: string): string {
    const labels: Record<string, string> = {
      Normal: 'طبيعي',
      Watch: 'مراقبة',
      High: 'مرتفع',
      Critical: 'حرج'
    };
    return this.lang.isArabic ? (labels[label] || label) : label;
  }

  sourceClassLabel(value: SourceClass): string {
    const labels: Record<SourceClass, string> = {
      'MOEI Authoritative': 'مصدر معتمد من الوزارة',
      'External Authoritative': 'مصدر خارجي معتمد',
      'External Trusted': 'مصدر خارجي موثوق',
      'Operational Feed': 'تغذية تشغيلية',
      'Internal Derived': 'قيمة مشتقة داخلياً'
    };
    return this.lang.isArabic ? labels[value] : value;
  }

  factorStatusLabel(status: RiskFactorEvidence['status']): string {
    const labels: Record<RiskFactorEvidence['status'], string> = {
      Triggered: 'مُفعّل',
      Observed: 'مرصود',
      Historical: 'تاريخي'
    };
    return this.lang.isArabic ? labels[status] : status;
  }

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
        label: hasOpenDeficiency
          ? this.copy('Open inspection deficiency', 'ملاحظة معاينة مفتوحة')
          : this.copy('Inspection exposure', 'مخاطر مرتبطة بالمعاينة'),
        contribution: inspection,
        source: 'MOEI Smart Inspection',
        sourceClass: 'MOEI Authoritative',
        authority: this.copy('MOEI inspection record', 'سجل معاينة معتمد من الوزارة'),
        evidenceRecord: `INS-2026-${String(1300 + this.vessel.id).padStart(5, '0')}`,
        trigger: hasOpenDeficiency
          ? this.copy('An inspection finding remains open and requires corrective follow-up.', 'توجد ملاحظة معاينة ما زالت مفتوحة وتتطلب متابعة إجراء تصحيحي.')
          : this.copy('Historical inspection context contributes a low baseline exposure.', 'يسهم سجل المعاينات التاريخي بمستوى مخاطر أساسي منخفض.'),
        ruleLogic: hasOpenDeficiency
          ? this.copy('Open Major/Critical Deficiency → weighted inspection contribution', 'ملاحظة كبيرة/حرجة مفتوحة ← مساهمة موزونة في مخاطر المعاينة')
          : this.copy('No open deficiency → historical inspection baseline only', 'لا توجد ملاحظة مفتوحة ← خط أساس تاريخي للمعاينة فقط'),
        sourceTrust: 100,
        dataConfidence: 100,
        identityMatch: 100,
        freshness: 96,
        conflict: false,
        status: hasOpenDeficiency ? 'Triggered' : 'Historical',
        explanation: hasOpenDeficiency
          ? this.copy('The risk engine uses the unresolved inspection finding because it is an active MOEI regulatory record linked directly to this IMO.', 'يستخدم محرك المخاطر ملاحظة المعاينة غير المغلقة لأنها سجل تنظيمي نشط تابع للوزارة ومرتبط مباشرة برقم IMO.')
          : this.copy('No active deficiency is open, so the inspection factor is limited to historical exposure.', 'لا توجد ملاحظة نشطة مفتوحة، لذلك يقتصر عامل المعاينة على المخاطر التاريخية.')
      },
      {
        id: 'movement',
        ruleId: 'RISK-MOV-011',
        label: hasMovementException
          ? this.copy('Movement anomaly / route deviation', 'حركة غير اعتيادية / انحراف عن المسار')
          : this.copy('Voyage & movement exposure', 'مخاطر الرحلة والحركة'),
        contribution: movement,
        source: 'AIS / LRIT',
        sourceClass: 'Operational Feed',
        authority: this.copy('Operational vessel tracking source', 'مصدر تتبع تشغيلي للسفن'),
        evidenceRecord: `AIS-${this.vessel.mmsi}`,
        trigger: hasMovementException
          ? this.copy('Observed movement differs from the monitored route pattern and current voyage behavior.', 'الحركة المرصودة تختلف عن نمط المسار المراقب وسلوك الرحلة الحالي.')
          : this.copy('Current voyage, approach zone and movement state are monitored without a critical anomaly.', 'تتم مراقبة الرحلة الحالية ومنطقة الاقتراب وحالة الحركة دون وجود حالة حرجة غير اعتيادية.'),
        ruleLogic: hasMovementException
          ? this.copy('Route deviation + abnormal movement pattern → movement risk contribution', 'انحراف عن المسار + نمط حركة غير اعتيادي ← مساهمة في مخاطر الحركة')
          : this.copy('Active monitored voyage → baseline movement contribution', 'رحلة نشطة تحت المراقبة ← مساهمة أساسية في مخاطر الحركة'),
        sourceTrust: 96,
        dataConfidence: Math.max(91, this.vessel.dataConfidence),
        identityMatch: 99,
        freshness: Math.max(92, 100 - Math.min(8, this.vessel.lastUpdate)),
        conflict: false,
        status: hasMovementException ? 'Triggered' : 'Observed',
        explanation: this.copy('Movement risk is calculated from live position, speed, course, destination and route behavior after matching the tracking identity to the vessel record.', 'يتم احتساب مخاطر الحركة من الموقع والسرعة والمسار والوجهة وسلوك الرحلة بعد مطابقة هوية التتبع مع سجل السفينة.')
      },
      {
        id: 'certificate',
        ruleId: 'RISK-CERT-007',
        label: hasSourceConflict
          ? this.copy('Conditional certificate state', 'حالة شهادة مشروطة')
          : hasCertificateConcern
            ? this.copy('Certificate validity proximity / condition', 'اقتراب انتهاء صلاحية الشهادة / شرط قائم')
            : this.copy('Certificate portfolio exposure', 'مخاطر مرتبطة بملف الشهادات'),
        contribution: certificate,
        source: certificateSource,
        sourceClass: certificateClass,
        authority: this.isUaeFlag ? this.copy('MOEI certificate authority', 'جهة الشهادات بالوزارة') : this.flagRegistryAuthority,
        evidenceRecord: `CERT-SC-${this.vessel.imo}`,
        trigger: hasSourceConflict
          ? this.copy('A certificate condition is active and requires verification.', 'يوجد شرط نشط على إحدى الشهادات ويتطلب التحقق.')
          : hasCertificateConcern
            ? this.copy('A monitored statutory certificate is approaching a configured validity threshold.', 'تقترب إحدى الشهادات النظامية المراقبة من حد صلاحية مهيأ.')
            : this.copy('No critical certificate exception; normal portfolio exposure applies.', 'لا توجد حالة حرجة بالشهادات؛ يتم تطبيق مستوى المخاطر الطبيعي لملف الشهادات.'),
        ruleLogic: hasSourceConflict
          ? this.copy('Conditional / restricted certificate → elevated certificate contribution', 'شهادة مشروطة / مقيدة ← مساهمة مرتفعة في مخاطر الشهادات')
          : hasCertificateConcern
            ? this.copy('Expiry/condition threshold reached → monitored certificate contribution', 'بلوغ حد الانتهاء/الشرط ← مساهمة مراقبة في مخاطر الشهادات')
            : this.copy('Valid certificate portfolio → baseline contribution', 'ملف شهادات ساري ← مساهمة أساسية'),
        sourceTrust: this.isUaeFlag ? 100 : 96,
        dataConfidence: hasSourceConflict ? 92 : 97,
        identityMatch: 100,
        freshness: hasSourceConflict ? 94 : 97,
        conflict: hasSourceConflict,
        status: hasCertificateConcern ? 'Triggered' : 'Observed',
        explanation: this.copy('Certificate status is evaluated independently from movement and inspection data. Foreign-flag registration authority remains external to MOEI.', 'يتم تقييم حالة الشهادات بشكل مستقل عن بيانات الحركة والمعاينة، وتظل جهة تسجيل السفن الأجنبية خارج سلطة تسجيل الوزارة.')
      },
      {
        id: 'data-quality',
        ruleId: 'RISK-DQ-003',
        label: hasSourceConflict
          ? this.copy('Authoritative source conflict', 'تعارض بين مصادر معتمدة')
          : this.copy('Data-quality exposure', 'مخاطر جودة البيانات'),
        contribution: dataConflict,
        source: 'NMC Data Correlation Layer',
        sourceClass: 'Internal Derived',
        authority: this.copy('Cross-source correlation and validation', 'ربط المصادر والتحقق بينها'),
        evidenceRecord: `DQC-${this.vessel.imo}`,
        trigger: hasSourceConflict
          ? this.copy('Two trusted sources report different certificate states for the same vessel record.', 'يعرض مصدران موثوقان حالتين مختلفتين للشهادة نفسها ضمن سجل السفينة.')
          : this.copy('No unresolved cross-source conflict; normal data-quality exposure remains.', 'لا يوجد تعارض غير محلول بين المصادر؛ يظل مستوى مخاطر جودة البيانات طبيعياً.'),
        ruleLogic: hasSourceConflict
          ? this.copy('Unresolved authoritative conflict → data-quality risk contribution', 'تعارض معتمد غير محلول ← مساهمة في مخاطر جودة البيانات')
          : this.copy('Matched sources → minimal data-quality contribution', 'مصادر متطابقة ← مساهمة محدودة في مخاطر جودة البيانات'),
        sourceTrust: 98,
        dataConfidence: this.vessel.dataConfidence,
        identityMatch: 99,
        freshness: 97,
        conflict: hasSourceConflict,
        status: hasSourceConflict ? 'Triggered' : 'Observed',
        explanation: hasSourceConflict
          ? this.copy('The platform preserves the conflict instead of silently choosing a source. Human verification is required before enforcement based on the disputed fact.', 'تحتفظ المنصة بالتعارض بدلاً من اختيار أحد المصادر تلقائياً. ويتطلب الأمر تحققاً بشرياً قبل اتخاذ إجراء تنظيمي بناءً على المعلومة محل الخلاف.')
          : this.copy('Source correlation is healthy and no material conflict is currently unresolved.', 'ربط المصادر سليم ولا يوجد حالياً تعارض جوهري غير محلول.')
      },
      {
        id: 'history',
        ruleId: 'RISK-HIST-009',
        label: this.copy('Historical vessel / operator risk pattern', 'نمط مخاطر تاريخي للسفينة / المشغل'),
        contribution: historical,
        source: 'Inspection & Operator History',
        sourceClass: this.isUaeFlag ? 'MOEI Authoritative' : 'External Trusted',
        authority: this.isUaeFlag ? this.copy('MOEI historical compliance context', 'سياق امتثال تاريخي معتمد من الوزارة') : this.copy('Verified historical maritime context', 'سياق بحري تاريخي تم التحقق منه'),
        evidenceRecord: `HIST-${this.vessel.imo}`,
        trigger: this.copy('Historical inspection, vessel and operator context contributes to the current risk baseline.', 'يسهم سياق المعاينات والسفينة والمشغل تاريخياً في خط أساس المخاطر الحالي.'),
        ruleLogic: this.copy('Historical findings / operator pattern → weighted historical contribution', 'ملاحظات تاريخية / نمط المشغل ← مساهمة تاريخية موزونة'),
        sourceTrust: this.isUaeFlag ? 100 : 94,
        dataConfidence: Math.max(90, this.vessel.dataConfidence),
        identityMatch: 99,
        freshness: 92,
        conflict: false,
        status: 'Historical',
        explanation: this.copy('Historical risk is retained separately so current operational events do not erase recurring vessel or operator patterns.', 'يتم الاحتفاظ بالمخاطر التاريخية بشكل مستقل حتى لا تلغي الأحداث التشغيلية الحالية الأنماط المتكررة للسفينة أو المشغل.')
      }
    ];
  }
}
