import { NmcNavigationComponent } from '../components/nmc-navigation.component';
import { NmcVesselDocumentsComponent } from '../components/nmc-vessel-documents.component';
import { CommonModule } from '@angular/common';
import { AfterViewInit, Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import * as L from 'leaflet';
import {
  NmcVesselProfile,
  SEA_ROUTES
} from '../data/nmc-vessel-catalog';
import { NMC_OPERATIONAL_VESSELS, getOperationalVesselByImo } from '../data/nmc-expanded-vessel-catalog';
import { LanguageService } from '../services/language.service';
import { NmcRiskEngineService } from '../services/nmc-risk-engine.service';
import { NmcVesselEvidenceService } from '../services/nmc-vessel-evidence.service';
import { NmcExternalPscService, NmcExternalPscRecord } from '../services/nmc-external-psc.service';
import { NmcFleetAiService, FleetAiAssessment, FleetAiHistory, FleetAiIntelligence } from '../services/nmc-fleet-ai.service';
import { NmcDataQualityConfigService, QualityPolicyImpact, projectQuality } from '../services/nmc-data-quality-config.service';

interface SourceStatus {
  name: string;
  system: string;
  status: 'Matched' | 'Conflict' | 'Available';
  lastSync: string;
  record: string;
  confidence: number;
  authority: string;
  sourceClass: 'MOEI Authoritative' | 'Internal Master' | 'External Authoritative' | 'External Trusted' | 'Operational Feed';
}

interface TimelineItem {
  time: string;
  title: string;
  detail: string;
  kind: 'critical' | 'warning' | 'normal';
}

interface CertificateRecord {
  id: string;
  type: string;
  number: string;
  issuer: string;
  issued: string;
  expiry: string;
  status: 'Valid' | 'Conditional' | 'Expiring';
  source: string;
  condition?: string;
  conflict?: boolean;
}

interface InspectionRecord {
  id: string;
  date: string;
  port: string;
  type: string;
  result: 'Passed' | 'Deficiencies Found' | 'Follow-up Required';
  inspector: string;
  source: string;
  openDeficiencies: number;
}

interface DeficiencyRecord {
  id: string;
  category: string;
  description: string;
  severity: 'Critical' | 'Major' | 'Minor';
  status: 'Open' | 'Closed';
  raised: string;
  due: string;
  evidence: string;
  riskImpact: number;
}

interface RiskFactor {
  label: string;
  value: number;
  source: string;
  severity?: number;
  confidence?: number;
  agent?: string;
  evidenceIds?: string[];
  reason?: string;
}

interface FieldProvenance {
  key: string;
  label: string;
  value: string;
  source: string;
  system: string;
  sourceClass: SourceStatus['sourceClass'];
  authority: string;
  recordId: string;
  sourceTrust: number;
  dataConfidence: number;
  identityMatch: number;
  freshness: number;
  lastUpdated: string;
  conflict: 'None' | 'Unresolved' | 'Verified';
  note: string;
}

interface Vessel360View extends NmcVesselProfile {
  age: number;
  riskScore: number;
  riskLevel: string;
  position: string;
}

@Component({
  selector: 'app-nmc-vessel-360',
  standalone: true,
  imports: [CommonModule, RouterLink, NmcNavigationComponent, NmcVesselDocumentsComponent],
  templateUrl: './nmc-vessel-360.component.html',
  styleUrl: './nmc-vessel-360.component.css'
})
export class NmcVessel360Component implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('vesselMap', { static: false }) vesselMap?: ElementRef<HTMLDivElement>;

  imo = '';
  activeTab = 'overview';
  certificateVerificationStarted = false;
  priorityInspectionCreated = false;
  selectedCertificateId = '';

  vessel!: Vessel360View;
  sources: SourceStatus[] = [];
  certificates: CertificateRecord[] = [];
  inspections: InspectionRecord[] = [];
  deficiencies: DeficiencyRecord[] = [];
  riskFactors: RiskFactor[] = [];
  timeline: TimelineItem[] = [];
  fieldProvenance: Record<string, FieldProvenance> = {};
  selectedProvenance?: FieldProvenance;
  externalPsc: NmcExternalPscRecord | null = null;
  pscLoading = false;
  pscError = '';
  // Oracle-sourced AI data is read-only, provisional and explicitly separated
  // from the deterministic vessel/certificate/AIS fixtures.
  storedAi: FleetAiAssessment | null = null;
  storedAiHistory: FleetAiHistory | null = null;
  storedAiIntelligence: FleetAiIntelligence | null = null;
  intelligenceStatus: 'loading' | 'available' | 'unavailable' = 'loading';
  qualityExpanded = false;
  qualityLocalPreview: QualityPolicyImpact | null = null;
  storedAiStatus: 'loading' | 'available' | 'not-assessed' | 'error' = 'loading';
  private readonly subscriptions = new Subscription();

  hasCertificateConflict = false;
  hasOpenDeficiency = false;
  openDeficiencyCount = 0;
  certificateRiskImpact = 0;
  inspectionRiskImpact = 0;
  historicalRiskImpact = 0;
  movementRiskImpact = 0;
  dataConflictRiskImpact = 0;

  private map?: L.Map;

  constructor(
    private route: ActivatedRoute,
    public lang: LanguageService,
    private riskEngine: NmcRiskEngineService,
    private vesselEvidence: NmcVesselEvidenceService,
    private externalPscService: NmcExternalPscService,
    private readonly fleetAiService: NmcFleetAiService,
    public readonly qualityPolicy: NmcDataQualityConfigService
  ) {}

  copy(en: string, ar: string): string {
    return this.lang.pick(en, ar);
  }

  toggleLanguage(): void {
    this.lang.toggle();
    this.buildOperationalData();
    this.applyStoredAiView();

    if (this.map) {
      this.map.remove();
      this.map = undefined;
      setTimeout(() => this.initMap());
    }
  }

  qualityMetricLabel(key: string): string {
    const labels: Record<string, [string, string]> = {
      completeness: ['Data completeness', 'اكتمال البيانات'],
      consistency: ['Cross-source consistency', 'اتساق المصادر'],
      evidenceLinkage: ['Evidence linkage', 'ربط الأدلة'],
      provenance: ['Source metadata coverage', 'اكتمال بيانات تعريف المصدر']
    };
    const v = labels[key];
    return v ? this.copy(v[0], v[1]) : key;
  }

  qualityMetricExplanation(key: string): string {
    switch (key) {
      case 'completeness':
        return this.copy(
          'Number of populated values out of the 8 expected sides (4 identity fields × internal and PSC). Missing is not a conflict.',
          'عدد القيم الموجودة من أصل 8 قيم متوقعة (4 حقول هوية × مصدر داخلي وخارجي). القيمة الناقصة ليست تعارضاً.');
      case 'consistency':
        return this.copy(
          'Matching field pairs ÷ identity field pairs where both values exist. Text is normalized by case, spacing and punctuation; a match is not independent truth verification.',
          'عدد أزواج الحقول المتطابقة ÷ أزواج الحقول التي تتوافر لها قيمتان. تتم تسوية حالة الأحرف والمسافات وعلامات الترقيم؛ التطابق ليس تحققاً مستقلاً من الصحة.');
      case 'evidenceLinkage':
        return this.copy(
          'AI factor evidence references found in the supplied internal or synthetic PSC evidence ID sets ÷ all AI evidence references. A linked ID does not mean the underlying document was authenticated.',
          'معرّفات الأدلة المرتبطة بعوامل AI الموجودة في قوائم الأدلة الداخلية أو PSC التجريبية ÷ إجمالي المراجع. وجود المعرّف لا يعني اعتماد المستند.');
      case 'provenance':
        return this.copy(
          'Current V1 rule: score 100 when sourceSystem, datasetVersion and retrievedAt all exist; otherwise score 60. This checks metadata availability, not the source authority.',
          'قاعدة النسخة الحالية: 100 عند توافر sourceSystem وdatasetVersion وretrievedAt جميعاً؛ وإلا 60. هذا فحص لتوافر بيانات تعريف المصدر وليس اعتماد المصدر.');
      default: return '';
    }
  }

  qualityFieldLabel(field: string): string {
    const labels: Record<string, [string, string]> = {
      VESSEL_NAME: ['Vessel name', 'اسم السفينة'],
      FLAG: ['Flag state', 'دولة العلم'],
      VESSEL_TYPE: ['Vessel type', 'نوع السفينة'],
      OPERATOR_NAME: ['Operator name', 'اسم المشغل']
    };
    const v = labels[field];
    return v ? this.copy(v[0], v[1]) : field;
  }

  qualityComparisonLabel(status: string): string {
    const labels: Record<string, [string, string]> = {
      MATCHED: ['Matched', 'متطابق'],
      MISMATCH: ['Disagreement', 'اختلاف'],
      MISSING: ['Missing value', 'قيمة ناقصة']
    };
    const v = labels[status];
    return v ? this.copy(v[0], v[1]) : status;
  }

  qualitySourceLabel(source: string): string {
    if (source === 'NMC_INTERNAL_SIM') return this.copy('Internal synthetic fixture', 'البيانات الداخلية التجريبية');
    if (source === 'PSC_GOOGLE_SIM') return this.copy('Synthetic PSC registry', 'سجل PSC التجريبي');
    return this.copy('Unknown ID', 'معرّف غير معروف');
  }

  riskLabel(level: string = this.vessel?.riskLevel): string {
    const labels: Record<string, string> = {
      Critical: this.copy('Critical', 'حرج'),
      High: this.copy('High', 'مرتفع'),
      Watch: this.copy('Watch', 'مراقبة'),
      Normal: this.copy('Normal', 'طبيعي')
    };
    return labels[level] || level;
  }

  sourceClassLabel(value: string): string {
    const labels: Record<string, string> = {
      'MOEI Authoritative': 'مصدر معتمد من الوزارة',
      'Internal Master': 'السجل الداخلي الرئيسي',
      'External Authoritative': 'مصدر خارجي معتمد',
      'External Trusted': 'مصدر خارجي موثوق',
      'Operational Feed': 'تغذية تشغيلية'
    };
    return this.lang.isArabic ? (labels[value] || value) : value;
  }

  sourceStatusLabel(value: string): string {
    const labels: Record<string, string> = {
      Matched: 'متطابق',
      Conflict: 'تعارض',
      Available: 'متاح'
    };
    return this.lang.isArabic ? (labels[value] || value) : value;
  }

  certificateStatusLabel(value: string): string {
    const labels: Record<string, string> = {
      Valid: 'سارية',
      Conditional: 'سارية بشروط',
      Expiring: 'قرب الانتهاء'
    };
    return this.lang.isArabic ? (labels[value] || value) : value;
  }

  inspectionResultLabel(value: string): string {
    const labels: Record<string, string> = {
      Passed: 'مستوفاة',
      'Deficiencies Found': 'تم رصد ملاحظات',
      'Follow-up Required': 'تتطلب متابعة'
    };
    return this.lang.isArabic ? (labels[value] || value) : value;
  }

  deficiencyStatusLabel(value: string): string {
    const labels: Record<string, string> = { Open: 'مفتوحة', Closed: 'مغلقة' };
    return this.lang.isArabic ? (labels[value] || value) : value;
  }

  factorLabel(label: string): string {
    const labels: Record<string, string> = {
      'Unresolved critical inspection deficiency': 'ملاحظة معاينة حرجة غير مغلقة',
      'Open inspection deficiency': 'ملاحظة معاينة مفتوحة',
      'Inspection history exposure': 'مخاطر مرتبطة بسجل المعاينات',
      'Movement anomaly / route deviation': 'نمط حركة غير اعتيادي / انحراف عن المسار',
      'Voyage and movement exposure': 'مخاطر مرتبطة بالرحلة والحركة',
      'Conditional certificate state': 'حالة شهادة مشروطة',
      'Certificate expiry proximity': 'اقتراب انتهاء صلاحية الشهادة',
      'Certificate profile exposure': 'مخاطر مرتبطة بملف الشهادات',
      'Conflict between authoritative data sources': 'تعارض بين مصادر بيانات معتمدة',
      'Data-quality / external-source factor': 'عامل جودة البيانات / المصدر الخارجي',
      'Historical vessel / operator risk pattern': 'نمط مخاطر تاريخي للسفينة / المشغل',
      'Movement and voyage behavior': 'مؤشرات حركة السفينة ورحلتها',
      'Inspection exposure': 'المخاطر المرتبطة بالمعاينة',
      'Certificate compliance': 'الامتثال للشهادات',
      'Data quality risk signal': 'مؤشر مخاطر جودة البيانات',
      'Vessel inspection and operator history': 'سجل معاينات السفينة والمشغل'
    };
    return this.lang.isArabic ? (labels[label] || label) : label;
  }

  sourceLabel(source: string): string {
    const labels: Record<string, string> = {
      Inspection: 'المعاينة',
      'AIS / Movement': 'AIS / الحركة',
      'Certificate Registry': 'سجل الشهادات',
      'Data Quality': 'جودة البيانات',
      'Inspection History': 'سجل المعاينات'
    };
    return this.lang.isArabic ? (labels[source] || source) : source;
  }

  timelineTitle(item: TimelineItem): string {
    const title = item.title;
    if (!this.lang.isArabic) return title;
    if (title.startsWith('Risk assessed as ')) return `تم تقييم مستوى المخاطر على أنه ${this.riskLabel(title.replace('Risk assessed as ', ''))}`;
    const labels: Record<string, string> = {
      'Certificate data conflict detected': 'تم اكتشاف تعارض في بيانات الشهادة',
      'Movement exception detected': 'تم اكتشاف حالة استثنائية في الحركة',
      'Open inspection finding loaded': 'تم تحميل ملاحظة معاينة مفتوحة',
      'Vessel entered monitoring area': 'دخلت السفينة منطقة المراقبة'
    };
    return labels[title] || title;
  }

  timelineDetail(item: TimelineItem): string {
    if (!this.lang.isArabic) return item.detail;
    if (item.detail.startsWith('Composite vessel score is ')) return `درجة المخاطر المركبة للسفينة هي ${this.vessel.risk} بعد ربط مصادر البيانات الحالية.`;
    const labels: Record<string, string> = {
      'MOEI registry and external classification source disagree.': 'يوجد اختلاف بين سجل الوزارة ومصدر التصنيف الخارجي.',
      'Observed movement differs from the monitored route pattern.': 'الحركة المرصودة تختلف عن نمط المسار المراقب.',
      'Outstanding deficiency included in the vessel risk picture.': 'تم تضمين الملاحظة غير المغلقة ضمن صورة مخاطر السفينة.',
      'AIS identity matched to MOEI vessel master using IMO number.': 'تمت مطابقة هوية AIS مع سجل السفينة باستخدام رقم IMO.'
    };
    return labels[item.detail] || item.detail;
  }

  ngOnInit(): void {
    this.imo = this.route.snapshot.paramMap.get('imo') || NMC_OPERATIONAL_VESSELS[0].imo;
    const rawProfile = getOperationalVesselByImo(this.imo) || NMC_OPERATIONAL_VESSELS[0];
    const profile = this.riskEngine.applyToVessel(rawProfile);

    this.vessel = {
      ...profile,
      age: 2026 - profile.built,
      riskScore: profile.risk,
      riskLevel: this.riskEngine.levelForScore(profile.risk),
      position: `${profile.lat.toFixed(4)}° N, ${profile.lng.toFixed(4)}° E`
    };

    this.buildOperationalData();
    this.subscriptions.add(this.riskEngine.config$.subscribe(()=>{
      if(this.storedAi){
        this.applyStoredAiView();
        if(this.map){this.map.remove();this.map=undefined;setTimeout(()=>this.initMap(),0);}
      }
    }));
    this.loadExternalPsc();
    this.loadStoredAi();

    const requestedTab = this.route.snapshot.queryParamMap.get('tab');
    if (requestedTab && ['overview','movement','compliance','inspection','external-psc','certificates','sources'].includes(requestedTab)) {
      this.activeTab = requestedTab;
    }
  }

  ngAfterViewInit(): void {
    this.initMap();
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
    this.map?.remove();
  }

  setTab(tab: string): void {
    this.activeTab = tab;
  }

  private loadStoredAi(): void {
    this.storedAiStatus = 'loading';
    this.subscriptions.add(this.fleetAiService.assessment(this.vessel.imo).subscribe({
      next: assessment => {
        const keys = new Set((assessment.signals || []).map(signal => signal.factor));
        const expected = ['movement', 'inspection', 'certificate', 'dataQuality', 'history'];
        if (assessment.imo !== this.vessel.imo ||
            assessment.status !== 'COMPLETED' ||
            assessment.authoritative !== false ||
            assessment.sourceNature !== 'SYNTHETIC_NOT_RIYADH_MOU' ||
            !Number.isFinite(assessment.score) ||
            !assessment.assessmentId ||
            keys.size !== 5 || !expected.every(key => keys.has(key))) {
          this.storedAiStatus = 'error';
          return;
        }

        this.storedAi = assessment;
        this.storedAiStatus = 'available';
        this.applyStoredAiView();
        // The Leaflet vessel badge is a generated DOM icon, not Angular-bound.
        // Refresh it to display the saved Oracle score rather than the fixture score.
        if (this.map) {
          this.map.remove();
          this.map = undefined;
          setTimeout(() => this.initMap(), 0);
        }
        this.loadStoredHistory();
        this.loadStoredIntelligence();
      },
      error: response => {
        // No assessment is normal for vessels that have not yet been evaluated.
        this.storedAiStatus = response?.status === 404 ? 'not-assessed' : 'error';
      }
    }));
  }

  private loadStoredIntelligence(): void {
    this.intelligenceStatus='loading';
    this.subscriptions.add(this.fleetAiService.intelligence(this.vessel.imo).subscribe({
      next: result => {
        if (result.imo!==this.vessel.imo ||
            result.assessmentId!==this.storedAi?.assessmentId ||
            result.dataNature!=='SYNTHETIC_POC_NOT_OFFICIAL') {
          this.intelligenceStatus='unavailable';
          return;
        }
        this.storedAiIntelligence=result;
        this.qualityLocalPreview=result.quality.breakdown
          ?projectQuality(result.quality.breakdown,this.qualityPolicy.config):null;
        this.intelligenceStatus='available';
      },
      error: () => {
        this.storedAiIntelligence=null;
        this.qualityLocalPreview=null;
        this.intelligenceStatus='unavailable';
      }
    }));
  }

  private loadStoredHistory(): void {
    this.subscriptions.add(this.fleetAiService.history(this.vessel.imo).subscribe({
      next: history => {
        if (history.imo !== this.vessel.imo ||
            history.dataNature !== 'SYNTHETIC_POC_NOT_OFFICIAL') return;
        this.storedAiHistory = history;
        this.applyStoredAiView();
      },
      // Preserve the saved current assessment without inventing timeline events.
      error: () => { this.storedAiHistory = null; }
    }));
  }

  private applyStoredAiView(): void {
    if (!this.storedAi) return;
    // Current central Oracle policy is effective across all views;
    // the original saved A01/A02 assessment remains immutable in storedAi.
    const signalKeys=['movement','inspection','certificate','dataQuality','history'] as const;
    const severities=Object.fromEntries(signalKeys.map(key=>[
      key,this.storedAi!.signals.find(signal=>signal.factor===key)?.severity
    ])) as {movement:number;inspection:number;certificate:number;dataQuality:number;history:number};
    const projected=this.riskEngine.centralReady?
      this.riskEngine.evaluateFromAiSignals(this.vessel,severities):null;
    this.vessel.riskScore = projected?.score ?? this.storedAi.score ?? this.vessel.riskScore;
    this.vessel.riskLevel = projected?.level ?? this.storedAi.level ?? this.vessel.riskLevel;
    this.vessel.risk=this.vessel.riskScore;
    const sources: Record<string, string> = {
      movement: 'AIS / Movement',
      inspection: 'Inspection',
      certificate: 'Certificate Registry',
      dataQuality: 'Data Quality',
      history: 'Inspection History'
    };
    const names: Record<string, string> = {
      movement: 'Movement and voyage behavior',
      inspection: 'Inspection exposure',
      certificate: 'Certificate compliance',
      dataQuality: 'Data quality risk signal',
      history: 'Vessel inspection and operator history'
    };
    const weights = this.riskEngine.centralReady?
      (this.riskEngine.config.weights as unknown as Record<string, number>):
      (this.storedAi.ruleset?.weights as unknown as Record<string, number> | undefined);
    this.riskFactors = this.storedAi.signals.map(signal => {
      const weight = weights?.[signal.factor] ?? 0;
      return {
        label: names[signal.factor] || signal.factor,
        value: Math.round(signal.severity * weight) / 100,
        source: sources[signal.factor] || 'Inspection History',
        severity: signal.severity,
        confidence: signal.confidence,
        agent: signal.sourceAgent,
        evidenceIds: signal.evidenceIds,
        reason: signal.reason
      };
    });
    const events = this.storedAiHistory?.events || [];
    if (events.length) {
      this.timeline = events.map(event => ({
        time: event.OCCURRED_AT ? new Date(event.OCCURRED_AT).toLocaleString() : '—',
        title: event.EVENT_TYPE === 'RISK_CHANGE'
          ? this.copy('AI risk score changed', 'تغيرت درجة المخاطر بالذكاء الاصطناعي')
          : this.copy('Saved AI assessment', 'تقييم ذكاء اصطناعي محفوظ'),
        detail: event.EVENT_TYPE === 'RISK_CHANGE'
          ? this.copy(
              `Risk changed from ${event.PREVIOUS_RISK_SCORE ?? '—'} to ${event.NEW_RISK_SCORE ?? '—'} (synthetic POC).`,
              `تغيرت المخاطر من ${event.PREVIOUS_RISK_SCORE ?? '—'} إلى ${event.NEW_RISK_SCORE ?? '—'} (نموذج تجريبي).`
            )
          : this.copy(
              `Stored composite AI risk: ${event.NEW_RISK_SCORE ?? '—'} / 100 (synthetic POC).`,
              `المخاطر المركبة المحفوظة: ${event.NEW_RISK_SCORE ?? '—'} من 100 (نموذج تجريبي).`
            ),
        kind: (event.NEW_RISK_SCORE ?? 0) >= 85 ? 'critical'
          : (event.NEW_RISK_SCORE ?? 0) >= 45 ? 'warning' : 'normal'
      }));
    } else {
      this.timeline = [{
        time: this.storedAi.assessedAt ? new Date(this.storedAi.assessedAt).toLocaleString() : '—',
        title: this.copy('Saved AI assessment', 'تقييم ذكاء اصطناعي محفوظ'),
        detail: this.copy(
          `Stored risk ${this.storedAi.score}/100. Timeline history unavailable; no other events inferred.`,
          `المخاطر المحفوظة ${this.storedAi.score} من 100. سجل الأحداث غير متاح، ولم يتم افتراض أحداث أخرى.`
        ),
        kind: this.storedAi.score! >= 85 ? 'critical' : this.storedAi.score! >= 45 ? 'warning' : 'normal'
      }];
    }
  }

  loadExternalPsc(): void {
    this.pscLoading = true;
    this.pscError = '';
    this.externalPsc = null;
    this.externalPscService.getVessel(this.vessel.imo).subscribe({
      next: payload => {
        if (payload.imo !== this.vessel.imo || payload.authoritative !== false ||
            payload.dataNature !== 'SYNTHETIC_NOT_RIYADH_MOU') {
          this.pscError = this.copy('External PSC provenance failed validation.', 'تعذر التحقق من مصدر بيانات PSC الخارجية.');
        } else {
          this.externalPsc = payload;
        }
        this.pscLoading = false;
      },
      error: () => {
        this.pscLoading = false;
        this.pscError = this.copy(
          'External PSC data unavailable. No simulated inspection records have been inferred.',
          'بيانات PSC الخارجية غير متاحة. لم يتم افتراض أي سجلات تفتيش بديلة.'
        );
      }
    });
  }

  openRiskEvidence(source: string): void {
    if (source.includes('Certificate') || source.includes('Data Quality')) {
      this.activeTab = 'certificates';
      return;
    }
    if (source.includes('Inspection')) {
      this.activeTab = 'inspection';
      return;
    }
    if (source.includes('AIS') || source.includes('Movement')) {
      this.activeTab = 'movement';
    }
  }

  startCertificateVerification(): void {
    this.certificateVerificationStarted = true;
    this.activeTab = 'certificates';
  }

  createPriorityInspection(): void {
    this.priorityInspectionCreated = true;
    this.activeTab = 'inspection';
  }

  selectedCertificate(): CertificateRecord | undefined {
    return this.certificates.find(certificate => certificate.id === this.selectedCertificateId);
  }

  openProvenance(key: string): void {
    const provenance = this.fieldProvenance[key];
    if (provenance) this.selectedProvenance = provenance;
  }

  closeProvenance(): void {
    this.selectedProvenance = undefined;
  }

  provenanceFor(key: string): FieldProvenance | undefined {
    return this.fieldProvenance[key];
  }

  openCertificateProvenance(certificate: CertificateRecord): void {
    const moeiSource = certificate.source.includes('MOEI');
    const externalAuthoritative =
      certificate.source.includes('Flag') ||
      certificate.source.includes('Recognized Organization') ||
      certificate.source.includes('Verified');

    this.selectedProvenance = {
      key:`certificate-${certificate.id}`,
      label:`${certificate.type} status`,
      value:certificate.status,
      source:certificate.source,
      system:certificate.issuer,
      sourceClass:moeiSource ? 'MOEI Authoritative' : externalAuthoritative ? 'External Authoritative' : 'External Trusted',
      authority:moeiSource ? 'MOEI certificate record' : externalAuthoritative ? 'Flag / statutory certificate authority' : 'External maritime certificate source',
      recordId:certificate.number,
      sourceTrust:moeiSource ? 100 : 95,
      dataConfidence:certificate.conflict ? 92 : 97,
      identityMatch:100,
      freshness:certificate.conflict ? 94 : 97,
      lastUpdated:'22:41:56',
      conflict:certificate.conflict ? 'Unresolved' : 'None',
      note:certificate.condition || 'Certificate status is linked to the correlated vessel record and retained with source provenance.'
    };
  }

  openInspectionProvenance(inspection: InspectionRecord): void {
    this.selectedProvenance = {
      key:`inspection-${inspection.id}`,
      label:'Inspection result',
      value:inspection.result,
      source:'MOEI Smart Inspection',
      system:inspection.source,
      sourceClass:'MOEI Authoritative',
      authority:'MOEI inspection record',
      recordId:inspection.id,
      sourceTrust:100,
      dataConfidence:100,
      identityMatch:100,
      freshness:96,
      lastUpdated:'22:41:55',
      conflict:'None',
      note:`Inspection performed through the MOEI inspection process at ${inspection.port}. Findings and evidence remain linked to the vessel record.`
    };
  }

  openDeficiencyProvenance(deficiency: DeficiencyRecord): void {
    this.selectedProvenance = {
      key:`deficiency-${deficiency.id}`,
      label:`${deficiency.category} deficiency`,
      value:`${deficiency.severity} · ${deficiency.status}`,
      source:'MOEI Smart Inspection',
      system:'Inspection Findings & Corrective Actions',
      sourceClass:'MOEI Authoritative',
      authority:'MOEI inspection finding',
      recordId:deficiency.id,
      sourceTrust:100,
      dataConfidence:100,
      identityMatch:100,
      freshness:deficiency.status === 'Open' ? 95 : 92,
      lastUpdated:deficiency.raised,
      conflict:'None',
      note:deficiency.evidence
    };
  }

  get isUaeFlag(): boolean {
    return this.vessel.flag === 'UAE';
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

  get registrationTitle(): string {
    return this.isUaeFlag
      ? this.copy('UAE Vessel Registration', 'تسجيل السفينة في دولة الإمارات')
      : this.copy('Flag Registration', 'التسجيل لدى دولة العلم');
  }

  get registrationStatus(): string {
    return this.copy('Active', 'ساري');
  }

  get registrationSource(): string {
    return this.flagRegistryAuthority;
  }

  get registrationAuthorityLabel(): string {
    return this.isUaeFlag
      ? this.copy('MOEI Authoritative', 'مصدر معتمد من الوزارة')
      : this.copy('External Authoritative', 'مصدر خارجي معتمد');
  }

  get vesselMasterRole(): string {
    return this.isUaeFlag
      ? this.copy('Authoritative internal vessel context linked to the UAE registry', 'سياق داخلي معتمد للسفينة ومرتبط بسجل دولة الإمارات')
      : this.copy('Internal correlation record for a foreign-flag vessel operating in the NMC context', 'سجل داخلي لربط بيانات سفينة أجنبية ضمن سياق المركز البحري الوطني');
  }

  get moeiRelationshipTitle(): string {
    return this.isUaeFlag
      ? this.copy('MOEI Flag-State Relationship', 'علاقة الوزارة بصفتها دولة العلم')
      : this.copy('MOEI Regulatory Relationship', 'العلاقة التنظيمية مع الوزارة');
  }

  get moeiRelationshipStatus(): string {
    if (this.isUaeFlag) return this.copy('Registered UAE Vessel', 'سفينة مسجلة في دولة الإمارات');
    return this.vessel.risk >= 65
      ? this.copy('Active · Under Operational Review', 'نشطة · قيد المراجعة التشغيلية')
      : this.copy('Active · Monitored', 'نشطة · تحت المراقبة');
  }

  get primaryCertificateSourceLabel(): string {
    return this.isUaeFlag ? 'MOEI Certificate Registry' : `${this.vessel.flag} Flag / Verified Certificate Record`;
  }

  get primaryCertificateAuthorityLabel(): string {
    return this.isUaeFlag ? 'MOEI Authoritative' : 'External Authoritative';
  }

  get vesselInitials(): string {
    return this.vessel.name
      .replace(/^MV\s+/i, '')
      .split(/\s+/)
      .slice(0, 2)
      .map(part => part.charAt(0))
      .join('')
      .toUpperCase();
  }

  get conflictCount(): number {
    return this.sources.filter(source => source.status === 'Conflict').length;
  }

  get attentionMessage(): string {
    if (this.storedAi?.operationalPriority === 'Priority Review')
      return this.copy('Priority human review of the saved AI assessment', 'مراجعة بشرية ذات أولوية للتقييم المحفوظ بالذكاء الاصطناعي');
    const level = this.vessel.riskLevel;
    if (level === 'Critical') return this.copy('Immediate operational review required', 'مراجعة تشغيلية فورية مطلوبة');
    if (level === 'High') return this.copy('Priority monitoring and review required', 'مراقبة ومراجعة ذات أولوية مطلوبة');
    if (level === 'Watch') return this.copy('Enhanced monitoring recommended', 'يوصى بالمراقبة المعززة');
    return this.copy('Normal monitoring status', 'حالة مراقبة طبيعية');
  }

  get baseRisk(): number {
    return this.riskEngine.evaluate(this.vessel).baseScore;
  }

  private isAtLeast(level: 'Watch' | 'High' | 'Critical'): boolean {
    const thresholds = this.storedAi?.ruleset?.thresholds || this.riskEngine.config.thresholds;
    const score = this.vessel.riskScore;
    if (level === 'Critical') return score >= thresholds.critical;
    if (level === 'High') return score >= thresholds.high;
    return score >= thresholds.watch;
  }

  get attentionDescription(): string {
    if (this.storedAi?.criticalOpenFinding) {
      return this.copy(
        'A critical open finding in synthetic inspection evidence requires priority human review, even though the composite AI risk level is Watch. This is not a regulatory decision.',
        'توجد ملاحظة حرجة مفتوحة في أدلة المعاينة التجريبية تستلزم مراجعة بشرية ذات أولوية رغم أن تصنيف المخاطر المركبة هو مراقبة. هذا ليس قرارًا تنظيميًا.'
      );
    }
    if (this.isAtLeast('Critical')) {
      return this.copy(
        'Multiple movement, inspection, certificate and data-quality indicators have been correlated into a critical vessel risk picture.',
        'تم ربط عدة مؤشرات للحركة والمعاينة والشهادات وجودة البيانات لتكوين صورة مخاطر حرجة للسفينة.'
      );
    }
    if (this.isAtLeast('High')) {
      return this.copy(
        'The vessel has multiple active risk indicators requiring coordinated operational review.',
        'لدى السفينة عدة مؤشرات مخاطر نشطة تتطلب مراجعة تشغيلية منسقة.'
      );
    }
    if (this.isAtLeast('Watch')) {
      return this.copy(
        'Monitoring indicators require attention, but no immediate critical intervention is currently indicated.',
        'تتطلب مؤشرات المراقبة الانتباه، دون وجود تدخل حرج فوري مطلوب حالياً.'
      );
    }
    return this.copy(
      'No critical compliance, inspection or movement exceptions are currently open for this vessel.',
      'لا توجد حالياً حالات حرجة مفتوحة مرتبطة بالامتثال أو المعاينة أو الحركة لهذه السفينة.'
    );
  }

  get complianceStatus(): string {
    if (this.isAtLeast('Critical')) return this.copy('Action Required', 'إجراء مطلوب');
    if (this.isAtLeast('High')) return this.copy('Under Review', 'قيد المراجعة');
    if (this.isAtLeast('Watch')) return this.copy('Watch', 'مراقبة');
    return this.copy('Compliant', 'مستوفٍ');
  }

  get riskCssClass(): string {
    return this.vessel.riskLevel.toLowerCase();
  }

  get riskGaugeBackground(): string {
    const color =
      this.vessel.riskLevel === 'Critical' ? '#e65353' :
      this.vessel.riskLevel === 'High' ? '#ef8b43' :
      this.vessel.riskLevel === 'Watch' ? '#d7a738' : '#4da7a0';
    return `radial-gradient(circle at center, white 58%, transparent 59%), conic-gradient(${color} 0 ${this.vessel.riskScore}%, #edf1f3 ${this.vessel.riskScore}% 100%)`;
  }

  private buildOperationalData(): void {
    const evaluation = this.riskEngine.evaluate(this.vessel);
    const evidenceRisk = evaluation.baseScore;
    const contribution = (key: string): number =>
      evaluation.factors.find(factor => factor.key === key)?.contribution || 0;

    this.hasCertificateConflict = evidenceRisk >= 80;
    this.hasOpenDeficiency = evidenceRisk >= 45;
    this.openDeficiencyCount = this.hasOpenDeficiency ? 1 : 0;

    this.movementRiskImpact = contribution('movement');
    this.inspectionRiskImpact = contribution('inspection');
    this.certificateRiskImpact = contribution('certificate');
    this.dataConflictRiskImpact = contribution('dataQuality');
    this.historicalRiskImpact = contribution('history');

    this.sources = this.buildSources();
    // The exact same deterministic fixture now drives Vessel 360 and A01/A02.
    const bundle = this.vesselEvidence.create(this.vessel);
    this.certificates = bundle.certificates;
    this.inspections = bundle.inspections;
    this.deficiencies = bundle.deficiencies;
    this.riskFactors = this.buildRiskFactors();
    this.timeline = this.buildTimeline();
    this.selectedCertificateId = this.certificates[0].id;
    this.fieldProvenance = this.buildFieldProvenance();
  }

  private buildFieldProvenance(): Record<string, FieldProvenance> {
    const identitySource = this.isUaeFlag ? 'MOEI Vessel Registry' : this.flagRegistryAuthority;
    const identityClass: SourceStatus['sourceClass'] = this.isUaeFlag ? 'MOEI Authoritative' : 'External Authoritative';
    const identityAuthority = this.registrationAuthorityLabel;
    const identityTrust = this.isUaeFlag ? 100 : 96;
    const operatorSource = this.isUaeFlag ? 'MOEI Company / Vessel Master' : 'Verified Operator / Company Record';
    const operatorClass: SourceStatus['sourceClass'] = this.isUaeFlag ? 'MOEI Authoritative' : 'External Trusted';
    const operatorTrust = this.isUaeFlag ? 100 : 94;
    const movementConfidence = Math.max(91, this.vessel.dataConfidence);
    const movementFreshness = Math.max(94, 100 - Math.min(6, this.vessel.lastUpdate));
    const fields: FieldProvenance[] = [];

    const add = (
      key: string,
      label: string,
      value: string,
      source: string,
      system: string,
      sourceClass: SourceStatus['sourceClass'],
      authority: string,
      recordId: string,
      sourceTrust: number,
      dataConfidence: number,
      identityMatch: number,
      freshness: number,
      lastUpdated: string,
      conflict: FieldProvenance['conflict'],
      note: string
    ): void => {
      fields.push({
        key, label, value, source, system, sourceClass, authority, recordId,
        sourceTrust, dataConfidence, identityMatch, freshness, lastUpdated, conflict, note
      });
    };

    add('vesselName','Vessel name',this.vessel.name,identitySource,'Registry / Vessel Identity',identityClass,identityAuthority,`VES-${this.vessel.imo}`,identityTrust,identityTrust,100,98,'22:42:06','None','Official or verified vessel identity correlated to the IMO number.');
    add('imo','IMO number',this.vessel.imo,identitySource,'Registry / Vessel Identity',identityClass,identityAuthority,`IMO-${this.vessel.imo}`,identityTrust,100,100,99,'22:42:06','None','Primary cross-system correlation key used by the NMC.');
    add('mmsi','MMSI',this.vessel.mmsi,'AIS / LRIT','Vessel Tracking Feed','Operational Feed','Operational tracking source',`MMSI-${this.vessel.mmsi}`,96,movementConfidence,99,movementFreshness,`${this.vessel.lastUpdate} sec ago`,'None','Live tracking identity matched to the vessel master.');
    add('flag','Flag',this.vessel.flag,identitySource,'Flag Registration',identityClass,identityAuthority,`REG-${this.vessel.imo}`,identityTrust,identityTrust,100,98,'22:42:06','None',this.isUaeFlag ? 'UAE flag status is maintained by MOEI.' : 'Foreign flag status is maintained by the vessel flag administration.');
    add('type','Vessel type',this.vessel.type,identitySource,'Registry / Vessel Particulars',identityClass,identityAuthority,`VES-${this.vessel.imo}`,identityTrust,identityTrust,100,97,'22:42:06','None','Vessel type from the authoritative or verified vessel particulars.');
    add('length','Length',`${this.vessel.lengthM} m`,identitySource,'Registry / Vessel Particulars',identityClass,identityAuthority,`VES-${this.vessel.imo}`,identityTrust,identityTrust,100,97,'22:42:06','None','Principal vessel dimension used for identification and operational context.');
    add('callSign','Call sign',this.vessel.callSign,identitySource,'Registry / Vessel Identity',identityClass,identityAuthority,`VES-${this.vessel.imo}`,identityTrust,identityTrust,100,98,'22:42:06','None','Registered or verified radio call sign.');
    add('built','Year built / Age',`${this.vessel.built} · ${this.vessel.age} years`,identitySource,'Registry / Vessel Particulars',identityClass,identityAuthority,`VES-${this.vessel.imo}`,identityTrust,identityTrust,100,95,'22:42:06','None','Construction year from vessel particulars; age is calculated by the platform.');
    add('grossTonnage','Gross tonnage',this.vessel.grossTonnage,identitySource,'Registry / Vessel Particulars',identityClass,identityAuthority,`VES-${this.vessel.imo}`,identityTrust,identityTrust,100,95,'22:42:06','None','Gross tonnage retained in the correlated vessel particulars.');
    add('deadweight','Deadweight',this.vessel.deadweight,identitySource,'Registry / Vessel Particulars',identityClass,identityAuthority,`VES-${this.vessel.imo}`,identityTrust,identityTrust,100,95,'22:42:06','None','Deadweight from vessel particulars.');
    add('owner','Owner',this.vessel.owner,operatorSource,'Owner / Company Record',operatorClass,this.isUaeFlag ? 'MOEI company record' : 'Verified external owner context',`OWN-${this.vessel.id.toString().padStart(5,'0')}`,operatorTrust,operatorTrust,99,94,'22:40:12','None','Current owner linked to the vessel record.');
    add('operator','Operator',this.vessel.operator,operatorSource,'Operator / Company Record',operatorClass,this.isUaeFlag ? 'MOEI company record' : 'Verified external operator context',`OPR-${this.vessel.id.toString().padStart(5,'0')}`,operatorTrust,operatorTrust,99,94,'22:40:12','None','Current operator used for compliance history and operator-risk correlation.');
    add('classSociety','Class society',this.vessel.classSociety,this.vessel.classSociety,'Classification / Recognized Organization','External Trusted','Recognized external maritime source',`CLS-${this.vessel.imo}`,96,95,99,96,'22:41:57',this.hasCertificateConflict ? 'Unresolved' : 'None','Classification context is retained separately from flag registration authority.');
    add('destination','Destination',this.vessel.destination,'AIS / LRIT','Vessel Tracking Feed','Operational Feed','Operational tracking source',`AIS-${this.vessel.mmsi}`,96,movementConfidence,99,movementFreshness,`${this.vessel.lastUpdate} sec ago`,'None','Reported voyage destination from the latest movement message.');
    add('eta','ETA',this.vessel.eta,'AIS / LRIT','Vessel Tracking Feed','Operational Feed','Operational tracking source',`AIS-${this.vessel.mmsi}`,96,movementConfidence,99,movementFreshness,`${this.vessel.lastUpdate} sec ago`,'None','Reported estimated time of arrival from the latest voyage message.');
    add('speed','Current speed',`${this.vessel.speed.toFixed(1)} kn`,'AIS / LRIT','Vessel Tracking Feed','Operational Feed','Operational tracking source',`AIS-${this.vessel.mmsi}`,96,movementConfidence,99,movementFreshness,`${this.vessel.lastUpdate} sec ago`,'None','Live speed over ground used by movement monitoring.');
    add('course','Course',`${this.vessel.course}°`,'AIS / LRIT','Vessel Tracking Feed','Operational Feed','Operational tracking source',`AIS-${this.vessel.mmsi}`,96,movementConfidence,99,movementFreshness,`${this.vessel.lastUpdate} sec ago`,'None','Live course over ground used by route and anomaly monitoring.');
    add('navStatus','Navigation status',this.vessel.navStatus,'AIS / LRIT','Vessel Tracking Feed','Operational Feed','Operational tracking source',`AIS-${this.vessel.mmsi}`,96,movementConfidence,99,movementFreshness,`${this.vessel.lastUpdate} sec ago`,'None','Navigation status from the latest vessel tracking message.');
    add('position','Current position',this.vessel.position,'AIS / LRIT','Vessel Tracking Feed','Operational Feed','Operational tracking source',`AIS-${this.vessel.mmsi}`,96,movementConfidence,99,movementFreshness,`${this.vessel.lastUpdate} sec ago`,'None','Latest correlated vessel position.');
    add('registration','Registration status',`${this.registrationStatus} · ${this.vessel.flag}`,this.registrationSource,'Flag Registration',identityClass,identityAuthority,`REG-${this.vessel.imo}`,identityTrust,identityTrust,100,98,'22:42:06','None',this.isUaeFlag ? 'MOEI is the flag-state registration authority.' : 'MOEI retains this as external authoritative flag-registration context.');
    add('moeiRelationship','MOEI regulatory relationship',this.moeiRelationshipStatus,'MOEI Regulatory Platform','MOEI Regulatory Context','MOEI Authoritative','MOEI regulatory action',`MOEI-${this.vessel.imo}`,100,100,100,99,'22:40:48','None','MOEI authority applies to UAE regulatory actions, inspections, restrictions and other UAE maritime controls.');
    add('dataConfidence','Overall data confidence',`${this.vessel.dataConfidence}%`,'NMC Data Correlation Layer','Data Quality & Correlation','Internal Master','Derived correlation metric',`DQC-${this.vessel.imo}`,98,this.vessel.dataConfidence,99,97,'22:42:18',this.conflictCount > 0 ? 'Unresolved' : 'None','Overall data confidence is distinct from source trust and from AI/risk confidence.');

    return fields.reduce((map, field) => {
      map[field.key] = field;
      return map;
    }, {} as Record<string, FieldProvenance>);
  }

  private buildSources(): SourceStatus[] {
    const certificateSourceName = this.isUaeFlag ? 'Certificates' : 'Foreign Certificates';
    const certificateSystem = this.isUaeFlag ? 'MOEI Certificate Registry' : 'Flag / Recognized Organization Records';
    const companySystem = this.isUaeFlag ? 'MOEI Company Master' : 'Verified Operator / Company Record';

    return [
      {
        name:'Vessel Master',
        system:'MOEI Unified Vessel Master',
        status:'Matched',
        lastSync:'22:42:09',
        record:`IMO ${this.vessel.imo} · Internal correlated vessel record`,
        confidence:100,
        authority:'NMC correlation context',
        sourceClass:'Internal Master'
      },
      {
        name:'Flag Registration',
        system:this.registrationSource,
        status:this.isUaeFlag ? 'Matched' : 'Available',
        lastSync:'22:42:06',
        record:`${this.vessel.flag} registration · ${this.registrationStatus}`,
        confidence:this.isUaeFlag ? 100 : 96,
        authority:this.registrationAuthorityLabel,
        sourceClass:this.isUaeFlag ? 'MOEI Authoritative' : 'External Authoritative'
      },
      {
        name:'Movement Feed',
        system:'AIS / LRIT',
        status:'Matched',
        lastSync:'22:42:18',
        record:'Position / speed / course / destination',
        confidence:Math.max(91, this.vessel.dataConfidence),
        authority:'Operational tracking source',
        sourceClass:'Operational Feed'
      },
      {
        name:'Inspection',
        system:'MOEI Smart Inspection',
        status:'Matched',
        lastSync:'22:41:55',
        record:this.hasOpenDeficiency ? '1 open deficiency' : 'No open critical deficiencies',
        confidence:100,
        authority:'MOEI inspection record',
        sourceClass:'MOEI Authoritative'
      },
      {
        name:certificateSourceName,
        system:certificateSystem,
        status:this.hasCertificateConflict ? 'Conflict' : 'Matched',
        lastSync:'22:41:56',
        record:this.hasCertificateConflict ? 'Certificate condition requires verification' : 'Certificate portfolio matched',
        confidence:this.isUaeFlag ? 100 : 95,
        authority:this.primaryCertificateAuthorityLabel,
        sourceClass:this.isUaeFlag ? 'MOEI Authoritative' : 'External Authoritative'
      },
      {
        name:'Classification / RO',
        system:this.vessel.classSociety,
        status:this.hasCertificateConflict ? 'Conflict' : 'Available',
        lastSync:'22:41:57',
        record:this.hasCertificateConflict ? 'Class / certificate status differs from primary record' : 'Classification record available',
        confidence:this.hasCertificateConflict ? 92 : 96,
        authority:'Recognized external maritime source',
        sourceClass:'External Trusted'
      },
      {
        name:'Company / Operator',
        system:companySystem,
        status:'Available',
        lastSync:'22:40:12',
        record:this.vessel.operator,
        confidence:this.isUaeFlag ? 100 : 94,
        authority:this.isUaeFlag ? 'MOEI company record' : 'Verified external operator context',
        sourceClass:this.isUaeFlag ? 'MOEI Authoritative' : 'External Trusted'
      },
      {
        name:'UAE Restrictions',
        system:'MOEI Enforcement & Restrictions',
        status:'Matched',
        lastSync:'22:40:48',
        record:'No active UAE restriction recorded',
        confidence:100,
        authority:'MOEI regulatory action',
        sourceClass:'MOEI Authoritative'
      }
    ];
  }

  private buildRiskFactors(): RiskFactor[] {
    const critical = this.vessel.risk >= 80;
    const high = this.vessel.risk >= 65;

    return [
      {
        label:critical ? 'Unresolved critical inspection deficiency' : this.hasOpenDeficiency ? 'Open inspection deficiency' : 'Inspection history exposure',
        value:this.inspectionRiskImpact,
        source:'Inspection'
      },
      {
        label:high ? 'Movement anomaly / route deviation' : 'Voyage and movement exposure',
        value:this.movementRiskImpact,
        source:'AIS / Movement'
      },
      {
        label:this.hasCertificateConflict ? 'Conditional certificate state' : this.vessel.risk >= 55 ? 'Certificate expiry proximity' : 'Certificate profile exposure',
        value:this.certificateRiskImpact,
        source:'Certificate Registry'
      },
      {
        label:this.hasCertificateConflict ? 'Conflict between authoritative data sources' : 'Data-quality / external-source factor',
        value:this.dataConflictRiskImpact,
        source:'Data Quality'
      },
      {
        label:'Historical vessel / operator risk pattern',
        value:this.historicalRiskImpact,
        source:'Inspection History'
      }
    ];
  }

  private buildTimeline(): TimelineItem[] {
    const level = this.vessel.riskLevel;
    const items: TimelineItem[] = [
      { time:'22:42', title:`Risk assessed as ${level}`, detail:`Composite vessel score is ${this.vessel.risk} after current data correlation.`, kind:this.vessel.risk >= 85 ? 'critical' : this.vessel.risk >= 45 ? 'warning' : 'normal' }
    ];

    if (this.hasCertificateConflict) {
      items.push({ time:'22:41', title:'Certificate data conflict detected', detail:'MOEI registry and external classification source disagree.', kind:'warning' });
    }
    if (this.vessel.risk >= 65) {
      items.push({ time:'22:40', title:'Movement exception detected', detail:'Observed movement differs from the monitored route pattern.', kind:'warning' });
    }
    if (this.hasOpenDeficiency) {
      items.push({ time:'20:15', title:'Open inspection finding loaded', detail:'Outstanding deficiency included in the vessel risk picture.', kind:'warning' });
    }
    items.push({ time:'18:04', title:'Vessel entered monitoring area', detail:'AIS identity matched to MOEI vessel master using IMO number.', kind:'normal' });
    return items;
  }

  private initMap(): void {
    if (!this.vesselMap || this.map) return;

    this.map = L.map(this.vesselMap.nativeElement, {
      zoomControl:false,
      attributionControl:true,
      minZoom:6,
      maxZoom:15
    });

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom:19,
      crossOrigin:true,
      attribution:'&copy; OpenStreetMap contributors'
    }).addTo(this.map);

    L.control.zoom({ position:'bottomright' }).addTo(this.map);

    const route = SEA_ROUTES[this.vessel.routeKey] || SEA_ROUTES['jebelAli'];
    const expected = route.map(point => [point[0], point[1]] as L.LatLngExpression);
    const anomalyIndex = Math.min(2, route.length - 2);
    const observed = route.map((point, index) => {
      if (this.vessel.risk >= 65 && index === anomalyIndex) {
        return [point[0] + 0.025, point[1] - 0.025] as L.LatLngExpression;
      }
      return [point[0], point[1]] as L.LatLngExpression;
    });

    L.polyline(expected, {
      color:'#0284c7',
      weight:3,
      opacity:0.62,
      dashArray:'7 7'
    }).bindTooltip(`Expected route to ${this.vessel.destination}`).addTo(this.map);

    L.polyline(observed, {
      color:'#0f766e',
      weight:4,
      opacity:0.9
    }).bindTooltip('Observed movement').addTo(this.map);

    if (this.vessel.risk >= 65) {
      const anomaly = observed[anomalyIndex] as [number, number];
      L.circleMarker(anomaly, {
        radius:8,
        color:'#fff',
        weight:3,
        fillColor:'#f59e0b',
        fillOpacity:1
      }).bindTooltip('Movement anomaly detected').addTo(this.map);
    }

    const shipSize = Math.round(Math.max(18, Math.min(30, 14 + this.vessel.lengthM / 25)));
    const ringSize = shipSize + 16;
    const currentShipIcon = L.divIcon({
      className:'v360-map-ship-wrap',
      html:`
        <div class="v360-map-ship ${this.riskCssClass}" style="--ship-size:${shipSize}px;--ring-size:${ringSize}px">
          <span class="v360-risk-ring"></span>
          ${this.vessel.riskScore >= 65 ? '<span class="v360-risk-pulse"></span>' : ''}
          <svg class="v360-ship-symbol" viewBox="0 0 24 34" aria-hidden="true" style="transform:rotate(${this.vessel.course}deg)">
            <path d="M12 1.4c1.5 2.1 4.7 4.6 6.5 8.2v15.7L12 32.6 5.5 25.3V9.6C7.3 6 10.5 3.5 12 1.4Z"></path>
            <path class="ship-deck" d="M9.2 10.6h5.6v8.2H9.2z"></path>
            <path class="ship-centerline" d="M12 3.5v24.3"></path>
          </svg>
          <span class="v360-ship-label">${this.vessel.name} <b>${this.vessel.riskScore}</b></span>
        </div>
      `,
      iconSize:[58,58],
      iconAnchor:[29,29]
    });

    L.marker([this.vessel.lat, this.vessel.lng], {
      icon:currentShipIcon,
      keyboard:true,
      riseOnHover:true
    }).bindTooltip(
      `<div class="v360-map-tooltip">
        <strong>${this.vessel.name}</strong>
        <span>IMO ${this.vessel.imo} · ${this.vessel.lengthM} m</span>
        <span>${this.vessel.speed.toFixed(1)} kn · Course ${this.vessel.course}° · ${this.vessel.destination}</span>
        <b>${this.storedAi ? 'Saved AI risk' : 'Synthetic baseline'} ${this.vessel.riskScore} · ${this.vessel.riskLevel}</b>
      </div>`,
      { direction:'top', offset:[0,-22], opacity:1 }
    ).addTo(this.map);

    const routeBounds = L.latLngBounds(route);
    routeBounds.extend([this.vessel.lat, this.vessel.lng]);
    this.map.fitBounds(routeBounds, { padding:[28,28] });
  }
}
