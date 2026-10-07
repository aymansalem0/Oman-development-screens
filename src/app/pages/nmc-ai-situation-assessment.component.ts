import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import {
  NmcVesselProfile,
  riskLevel
} from '../data/nmc-vessel-catalog';
import {
  NMC_OPERATIONAL_VESSELS,
  getOperationalVesselByImo
} from '../data/nmc-expanded-vessel-catalog';
import { LanguageService } from '../services/language.service';

type DecisionStatus = 'Pending' | 'Accepted' | 'Modified' | 'Rejected';
type EvidenceType = 'Movement' | 'Inspection' | 'Certificate' | 'Data Quality' | 'History';

interface AiEvidence {
  id: string;
  type: EvidenceType;
  title: string;
  source: string;
  record: string;
  confidence: number;
  contribution: number;
  detail: string;
  tab: 'movement' | 'inspection' | 'certificates';
}

interface AiRecommendation {
  id: string;
  priority: 'Immediate' | 'High' | 'Monitor' | 'Conditional';
  title: string;
  owner: string;
  target: string;
  confidence: number;
  reason: string;
  evidenceIds: string[];
  authority: string;
  decision: DecisionStatus;
  officerNote: string;
}

@Component({
  selector: 'app-nmc-ai-situation-assessment',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './nmc-ai-situation-assessment.component.html',
  styleUrl: './nmc-ai-situation-assessment.component.css'
})
export class NmcAiSituationAssessmentComponent implements OnInit {
  vessel!: NmcVesselProfile;
  evidence: AiEvidence[] = [];
  recommendations: AiRecommendation[] = [];
  selectedEvidence?: AiEvidence;

  readonly generatedAt = '07 Oct 2026 · 22:43:06';
  readonly modelLabel = 'Maritime Situation Intelligence';

  constructor(private route: ActivatedRoute, public lang: LanguageService) {}

  ngOnInit(): void {
    const imo = this.route.snapshot.paramMap.get('imo') || NMC_OPERATIONAL_VESSELS[0].imo;
    this.vessel = getOperationalVesselByImo(imo) || NMC_OPERATIONAL_VESSELS[0];
    this.rebuildAssessment();
  }

  copy(en: string, ar: string): string {
    return this.lang.pick(en, ar);
  }

  toggleLanguage(): void {
    const decisions = new Map(
      this.recommendations.map(item => [item.id, { decision: item.decision, note: item.officerNote }])
    );
    this.lang.toggle();
    this.rebuildAssessment();

    this.recommendations.forEach(item => {
      const previous = decisions.get(item.id);
      if (previous) {
        item.decision = previous.decision;
        item.officerNote = previous.note;
      }
    });
  }

  get riskLevelLabel(): string {
    const level = riskLevel(this.vessel.risk);
    const labels: Record<string, string> = {
      Critical: this.copy('Critical', 'حرج'),
      High: this.copy('High', 'مرتفع'),
      Watch: this.copy('Watch', 'مراقبة'),
      Normal: this.copy('Normal', 'طبيعي')
    };
    return labels[level] || level;
  }

  get riskClass(): string {
    return riskLevel(this.vessel.risk).toLowerCase();
  }

  get hasConflict(): boolean {
    return this.vessel.risk >= 80;
  }

  get hasOpenDeficiency(): boolean {
    return this.vessel.risk >= 45;
  }

  get hasMovementException(): boolean {
    return this.vessel.risk >= 65;
  }

  get hasCertificateConcern(): boolean {
    return this.vessel.risk >= 55;
  }

  get aiConfidence(): number {
    const base = Math.round((this.vessel.riskConfidence * 0.55) + (this.vessel.dataConfidence * 0.45));
    return Math.max(74, Math.min(97, base - (this.hasConflict ? 3 : 0)));
  }

  get situationPriority(): string {
    if (this.vessel.risk >= 85) return this.copy('Immediate Review', 'مراجعة فورية');
    if (this.vessel.risk >= 65) return this.copy('Priority Review', 'مراجعة ذات أولوية');
    if (this.vessel.risk >= 45) return this.copy('Enhanced Monitoring', 'مراقبة معززة');
    return this.copy('Routine Monitoring', 'مراقبة اعتيادية');
  }

  get situationSummary(): string {
    if (this.vessel.risk >= 85) {
      return this.copy(
        `${this.vessel.name} is operating toward ${this.vessel.destination} with a critical combination of movement, inspection and certificate indicators. The current picture includes an unresolved inspection finding and a cross-source certificate conflict that requires authorized verification before any enforcement decision.`,
        `تتحرك السفينة ${this.vessel.name} باتجاه ${this.vessel.destination} مع اجتماع مؤشرات حرجة مرتبطة بالحركة والمعاينة والشهادات. وتتضمن الصورة الحالية ملاحظة معاينة غير مغلقة وتعارضاً بين مصادر الشهادات يتطلب تحققاً معتمداً قبل اتخاذ أي قرار تنفيذي.`
      );
    }
    if (this.vessel.risk >= 65) {
      return this.copy(
        `${this.vessel.name} has multiple active operational and compliance indicators requiring coordinated review. Movement behavior and compliance history currently place the vessel above the high-risk threshold.`,
        `لدى السفينة ${this.vessel.name} عدة مؤشرات تشغيلية وتنظيمية نشطة تتطلب مراجعة منسقة. ويضع سلوك الحركة وسجل الامتثال السفينة حالياً فوق حد المخاطر المرتفعة.`
      );
    }
    if (this.vessel.risk >= 45) {
      return this.copy(
        `${this.vessel.name} is within the monitored UAE maritime picture and has indicators that justify enhanced monitoring. No immediate critical intervention is currently indicated.`,
        `تقع السفينة ${this.vessel.name} ضمن الصورة البحرية المراقبة لدولة الإمارات ولديها مؤشرات تبرر المراقبة المعززة، دون وجود تدخل حرج فوري مطلوب حالياً.`
      );
    }
    return this.copy(
      `${this.vessel.name} is operating within the monitored traffic picture with no material exception currently requiring NMC intervention. Routine monitoring remains appropriate.`,
      `تعمل السفينة ${this.vessel.name} ضمن صورة الحركة البحرية المراقبة دون وجود حالة جوهرية تتطلب تدخل المركز البحري الوطني حالياً. وتظل المراقبة الاعتيادية مناسبة.`
    );
  }

  get whyItMatters(): string {
    if (this.vessel.risk >= 85) {
      return this.copy(
        'The significance comes from correlation, not from one alert: live movement, an unresolved regulatory finding, certificate condition and source disagreement are reinforcing each other. The vessel should therefore be reviewed ahead of lower-risk traffic.',
        'تكمن أهمية الحالة في ترابط المؤشرات وليس في تنبيه منفرد: فالحركة الحية، والملاحظة التنظيمية غير المغلقة، وحالة الشهادة، واختلاف المصادر تعزز بعضها بعضاً. ولذلك يجب مراجعة السفينة قبل حركة السفن الأقل خطورة.'
      );
    }
    if (this.vessel.risk >= 65) {
      return this.copy(
        'Several independent indicators are aligned. Early review can prevent a compliance or safety issue from becoming an operational disruption.',
        'تتوافق عدة مؤشرات مستقلة في الاتجاه نفسه. ويمكن للمراجعة المبكرة أن تمنع تحول مشكلة امتثال أو سلامة إلى تعطيل تشغيلي.'
      );
    }
    if (this.vessel.risk >= 45) {
      return this.copy(
        'The vessel does not require immediate intervention, but the current indicators justify closer monitoring so that escalation can happen early if conditions deteriorate.',
        'لا تتطلب السفينة تدخلاً فورياً، لكن المؤشرات الحالية تبرر مراقبة أقرب حتى يتم التصعيد مبكراً إذا ساءت الظروف.'
      );
    }
    return this.copy(
      'The current evidence does not justify priority intervention. Maintaining routine monitoring avoids unnecessary operational action while preserving situational awareness.',
      'لا تبرر الأدلة الحالية تدخلاً ذا أولوية. وتسمح المراقبة الاعتيادية بتجنب الإجراءات التشغيلية غير الضرورية مع الحفاظ على الوعي بالموقف.'
    );
  }

  get acceptedCount(): number {
    return this.recommendations.filter(item => item.decision === 'Accepted').length;
  }

  get modifiedCount(): number {
    return this.recommendations.filter(item => item.decision === 'Modified').length;
  }

  get rejectedCount(): number {
    return this.recommendations.filter(item => item.decision === 'Rejected').length;
  }

  get pendingCount(): number {
    return this.recommendations.filter(item => item.decision === 'Pending').length;
  }

  setDecision(item: AiRecommendation, decision: DecisionStatus): void {
    item.decision = decision;
    if (decision === 'Accepted') {
      item.officerNote = '';
    }
  }

  evidenceFor(item: AiRecommendation): AiEvidence[] {
    return this.evidence.filter(evidence => item.evidenceIds.includes(evidence.id));
  }

  selectEvidence(item: AiEvidence): void {
    this.selectedEvidence = item;
  }

  closeEvidence(): void {
    this.selectedEvidence = undefined;
  }

  decisionLabel(status: DecisionStatus): string {
    const labels: Record<DecisionStatus, string> = {
      Pending: this.copy('Pending', 'بانتظار القرار'),
      Accepted: this.copy('Accepted', 'مقبولة'),
      Modified: this.copy('Modified', 'معدلة'),
      Rejected: this.copy('Rejected', 'مرفوضة')
    };
    return labels[status];
  }

  priorityLabel(priority: AiRecommendation['priority']): string {
    const labels: Record<AiRecommendation['priority'], string> = {
      Immediate: this.copy('Immediate', 'فوري'),
      High: this.copy('High', 'مرتفع'),
      Monitor: this.copy('Monitor', 'مراقبة'),
      Conditional: this.copy('Conditional', 'مشروط')
    };
    return labels[priority];
  }

  evidenceTypeLabel(type: EvidenceType): string {
    const labels: Record<EvidenceType, string> = {
      Movement: this.copy('Movement', 'الحركة'),
      Inspection: this.copy('Inspection', 'المعاينة'),
      Certificate: this.copy('Certificate', 'الشهادة'),
      'Data Quality': this.copy('Data Quality', 'جودة البيانات'),
      History: this.copy('History', 'السجل التاريخي')
    };
    return labels[type];
  }

  private rebuildAssessment(): void {
    this.evidence = this.buildEvidence();
    this.recommendations = this.buildRecommendations();
    this.selectedEvidence = undefined;
  }

  private buildEvidence(): AiEvidence[] {
    const risk = this.vessel.risk;
    const movement = Math.max(3, Math.round(risk * 0.25));
    const inspection = this.hasOpenDeficiency ? Math.max(6, Math.round(risk * 0.28)) : Math.max(2, Math.round(risk * 0.12));
    const certificate = this.hasCertificateConcern ? Math.max(5, Math.round(risk * 0.20)) : Math.max(2, Math.round(risk * 0.10));
    const quality = this.hasConflict ? Math.max(5, Math.round(risk * 0.14)) : Math.max(1, Math.round(risk * 0.06));
    const history = Math.max(1, risk - movement - inspection - certificate - quality);

    return [
      {
        id: 'movement',
        type: 'Movement',
        title: this.hasMovementException
          ? this.copy('Movement anomaly / route deviation', 'حركة غير اعتيادية / انحراف عن المسار')
          : this.copy('Current voyage & movement state', 'حالة الرحلة والحركة الحالية'),
        source: 'AIS / LRIT',
        record: `AIS-${this.vessel.mmsi}`,
        confidence: Math.max(91, this.vessel.dataConfidence),
        contribution: movement,
        detail: this.hasMovementException
          ? this.copy('Observed movement differs from the monitored route pattern and requires operational review.', 'تختلف الحركة المرصودة عن نمط المسار المراقب وتتطلب مراجعة تشغيلية.')
          : this.copy('The vessel movement is being monitored without a critical route exception.', 'تتم مراقبة حركة السفينة دون وجود حالة حرجة مرتبطة بالمسار.'),
        tab: 'movement'
      },
      {
        id: 'inspection',
        type: 'Inspection',
        title: this.hasOpenDeficiency
          ? this.copy('Open inspection deficiency', 'ملاحظة معاينة مفتوحة')
          : this.copy('Inspection history', 'سجل المعاينات'),
        source: 'MOEI Smart Inspection',
        record: `INS-2026-${String(1300 + this.vessel.id).padStart(5, '0')}`,
        confidence: 100,
        contribution: inspection,
        detail: this.hasOpenDeficiency
          ? this.copy('An unresolved finding remains linked to the vessel and contributes directly to prioritization.', 'تظل هناك ملاحظة غير مغلقة مرتبطة بالسفينة وتسهم مباشرة في تحديد الأولوية.')
          : this.copy('No active critical deficiency is currently open; historical inspection exposure is retained.', 'لا توجد ملاحظة حرجة نشطة مفتوحة حالياً؛ ويتم الاحتفاظ بسياق المعاينات التاريخي.'),
        tab: 'inspection'
      },
      {
        id: 'certificate',
        type: 'Certificate',
        title: this.hasCertificateConcern
          ? this.copy('Certificate condition / validity concern', 'حالة أو صلاحية شهادة تتطلب الانتباه')
          : this.copy('Certificate portfolio', 'ملف الشهادات'),
        source: this.vessel.flag === 'UAE' ? 'MOEI Certificate Registry' : `${this.vessel.flag} Flag / RO Record`,
        record: `CERT-SC-${this.vessel.imo}`,
        confidence: this.hasConflict ? 92 : 97,
        contribution: certificate,
        detail: this.hasCertificateConcern
          ? this.copy('A statutory certificate condition or validity threshold is contributing to the vessel risk picture.', 'يسهم شرط قائم أو حد صلاحية لإحدى الشهادات النظامية في صورة مخاطر السفينة.')
          : this.copy('The current certificate portfolio does not contain a critical exception.', 'لا يحتوي ملف الشهادات الحالي على حالة حرجة.'),
        tab: 'certificates'
      },
      {
        id: 'quality',
        type: 'Data Quality',
        title: this.hasConflict
          ? this.copy('Cross-source certificate conflict', 'تعارض بين مصادر بيانات الشهادة')
          : this.copy('Data correlation quality', 'جودة ربط البيانات'),
        source: 'NMC Data Correlation Layer',
        record: `DQC-${this.vessel.imo}`,
        confidence: this.vessel.dataConfidence,
        contribution: quality,
        detail: this.hasConflict
          ? this.copy('Trusted sources report different states for the same certificate. The conflict is preserved for human verification.', 'تعرض مصادر موثوقة حالات مختلفة للشهادة نفسها، ويتم الاحتفاظ بالتعارض للتحقق البشري.')
          : this.copy('No material unresolved source conflict is currently present.', 'لا يوجد حالياً تعارض جوهري غير محلول بين المصادر.'),
        tab: 'certificates'
      },
      {
        id: 'history',
        type: 'History',
        title: this.copy('Historical vessel / operator pattern', 'النمط التاريخي للسفينة / المشغل'),
        source: 'Vessel & Operator History',
        record: `HIST-${this.vessel.imo}`,
        confidence: Math.max(90, this.vessel.dataConfidence),
        contribution: history,
        detail: this.copy(
          'Historical vessel and operator context is retained so recurring patterns remain visible in the current assessment.',
          'يتم الاحتفاظ بالسياق التاريخي للسفينة والمشغل حتى تظل الأنماط المتكررة ظاهرة في التقييم الحالي.'
        ),
        tab: 'inspection'
      }
    ];
  }

  private buildRecommendations(): AiRecommendation[] {
    const items: AiRecommendation[] = [];

    if (this.hasConflict || this.hasCertificateConcern) {
      items.push({
        id: 'verify-certificate',
        priority: this.hasConflict ? 'Immediate' : 'High',
        title: this.copy('Verify certificate status', 'التحقق من حالة الشهادة'),
        owner: this.copy('Certificate Compliance', 'امتثال الشهادات'),
        target: this.copy('Within 15 minutes', 'خلال 15 دقيقة'),
        confidence: this.hasConflict ? 94 : 89,
        reason: this.hasConflict
          ? this.copy('Two trusted sources do not currently agree on the certificate state.', 'لا يتطابق مصدران موثوقان حالياً بشأن حالة الشهادة.')
          : this.copy('The monitored certificate is within a configured condition/validity threshold.', 'تقع الشهادة المراقبة ضمن حد مهيأ يتعلق بالحالة أو الصلاحية.'),
        evidenceIds: ['certificate', 'quality'],
        authority: this.copy('Human verification required before enforcement', 'يتطلب تحققاً بشرياً قبل أي إجراء تنفيذي'),
        decision: 'Pending',
        officerNote: ''
      });
    }

    if (this.vessel.risk >= 45) {
      items.push({
        id: 'enhanced-monitoring',
        priority: this.vessel.risk >= 85 ? 'Immediate' : 'Monitor',
        title: this.copy('Maintain enhanced vessel monitoring', 'استمرار المراقبة المعززة للسفينة'),
        owner: this.copy('NMC Operations', 'عمليات المركز البحري الوطني'),
        target: this.copy('Continuous', 'مستمر'),
        confidence: 96,
        reason: this.hasMovementException
          ? this.copy('Movement behavior is contributing materially to the current prioritization.', 'يسهم سلوك الحركة بصورة جوهرية في تحديد الأولوية الحالية.')
          : this.copy('Current risk indicators justify closer observation while the vessel remains in the monitored area.', 'تبرر مؤشرات المخاطر الحالية مراقبة أكثر قرباً أثناء وجود السفينة في النطاق المراقب.'),
        evidenceIds: ['movement', 'history'],
        authority: this.copy('Operational monitoring action', 'إجراء مراقبة تشغيلي'),
        decision: 'Pending',
        officerNote: ''
      });
    }

    if (this.hasOpenDeficiency && this.vessel.risk >= 65) {
      items.push({
        id: 'priority-inspection',
        priority: this.vessel.risk >= 85 ? 'Immediate' : 'High',
        title: this.copy('Create priority follow-up inspection', 'إنشاء معاينة متابعة ذات أولوية'),
        owner: this.copy('Smart Inspection', 'المعاينة الذكية'),
        target: this.copy('Before normal clearance / next operational window', 'قبل التخليص الاعتيادي / أقرب نافذة تشغيلية'),
        confidence: 91,
        reason: this.copy(
          'An unresolved inspection finding remains active and is reinforced by the current vessel risk picture.',
          'تظل هناك ملاحظة معاينة غير مغلقة وتتعزز أهميتها من خلال صورة المخاطر الحالية للسفينة.'
        ),
        evidenceIds: ['inspection', 'movement', 'certificate'],
        authority: this.copy('Officer approval required to create inspection task', 'يتطلب موافقة المسؤول لإنشاء مهمة المعاينة'),
        decision: 'Pending',
        officerNote: ''
      });
    }

    if (this.vessel.risk >= 85) {
      items.push({
        id: 'restriction-review',
        priority: 'Conditional',
        title: this.copy('Consider regulatory restriction only if conditions remain unresolved', 'النظر في قيد تنظيمي فقط إذا ظلت الحالات دون حل'),
        owner: this.copy('Maritime Compliance / NMC Supervisor', 'الامتثال البحري / مشرف المركز البحري'),
        target: this.copy('After verification outcome', 'بعد نتيجة التحقق'),
        confidence: 83,
        reason: this.copy(
          'A restriction may become justified if the certificate conflict or safety deficiency remains unresolved after verification.',
          'قد يصبح القيد مبرراً إذا ظل تعارض الشهادة أو ملاحظة السلامة دون حل بعد التحقق.'
        ),
        evidenceIds: ['inspection', 'certificate', 'quality'],
        authority: this.copy('AI cannot impose a restriction; authorized human decision required', 'لا يستطيع الذكاء الاصطناعي فرض قيد؛ يلزم قرار بشري معتمد'),
        decision: 'Pending',
        officerNote: ''
      });
    }

    if (items.length === 0) {
      items.push({
        id: 'routine-monitoring',
        priority: 'Monitor',
        title: this.copy('Continue routine monitoring', 'استمرار المراقبة الاعتيادية'),
        owner: this.copy('NMC Operations', 'عمليات المركز البحري الوطني'),
        target: this.copy('Continuous', 'مستمر'),
        confidence: 95,
        reason: this.copy(
          'Current evidence does not justify priority intervention or a regulatory action.',
          'لا تبرر الأدلة الحالية تدخلاً ذا أولوية أو إجراءً تنظيمياً.'
        ),
        evidenceIds: ['movement', 'history'],
        authority: this.copy('Operational monitoring action', 'إجراء مراقبة تشغيلي'),
        decision: 'Pending',
        officerNote: ''
      });
    }

    return items;
  }
}
