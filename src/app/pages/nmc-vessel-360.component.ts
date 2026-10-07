import { CommonModule } from '@angular/common';
import { AfterViewInit, Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import * as L from 'leaflet';
import {
  NmcVesselProfile,
  riskLevel,
  SEA_ROUTES
} from '../data/nmc-vessel-catalog';
import { NMC_OPERATIONAL_VESSELS, getOperationalVesselByImo } from '../data/nmc-expanded-vessel-catalog';
import { LanguageService } from '../services/language.service';

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
  imports: [CommonModule, RouterLink],
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

  hasCertificateConflict = false;
  hasOpenDeficiency = false;
  openDeficiencyCount = 0;
  certificateRiskImpact = 0;
  inspectionRiskImpact = 0;
  historicalRiskImpact = 0;
  movementRiskImpact = 0;
  dataConflictRiskImpact = 0;

  private map?: L.Map;

  constructor(private route: ActivatedRoute, public lang: LanguageService) {}

  copy(en: string, ar: string): string {
    return this.lang.pick(en, ar);
  }

  toggleLanguage(): void {
    this.lang.toggle();
    this.buildOperationalData();

    if (this.map) {
      this.map.remove();
      this.map = undefined;
      setTimeout(() => this.initMap());
    }
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
      'Historical vessel / operator risk pattern': 'نمط مخاطر تاريخي للسفينة / المشغل'
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
    const profile = getOperationalVesselByImo(this.imo) || NMC_OPERATIONAL_VESSELS[0];

    this.vessel = {
      ...profile,
      age: 2026 - profile.built,
      riskScore: profile.risk,
      riskLevel: riskLevel(profile.risk),
      position: `${profile.lat.toFixed(4)}° N, ${profile.lng.toFixed(4)}° E`
    };

    this.buildOperationalData();

    const requestedTab = this.route.snapshot.queryParamMap.get('tab');
    if (requestedTab && ['overview','movement','compliance','inspection','certificates','sources'].includes(requestedTab)) {
      this.activeTab = requestedTab;
    }
  }

  ngAfterViewInit(): void {
    this.initMap();
  }

  ngOnDestroy(): void {
    this.map?.remove();
  }

  setTab(tab: string): void {
    this.activeTab = tab;
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
    const level = this.vessel.riskLevel;
    if (level === 'Critical') return this.copy('Immediate operational review required', 'مراجعة تشغيلية فورية مطلوبة');
    if (level === 'High') return this.copy('Priority monitoring and review required', 'مراقبة ومراجعة ذات أولوية مطلوبة');
    if (level === 'Watch') return this.copy('Enhanced monitoring recommended', 'يوصى بالمراقبة المعززة');
    return this.copy('Normal monitoring status', 'حالة مراقبة طبيعية');
  }

  get attentionDescription(): string {
    if (this.vessel.risk >= 85) {
      return this.copy(
        'Multiple movement, inspection, certificate and data-quality indicators have been correlated into a critical vessel risk picture.',
        'تم ربط عدة مؤشرات للحركة والمعاينة والشهادات وجودة البيانات لتكوين صورة مخاطر حرجة للسفينة.'
      );
    }
    if (this.vessel.risk >= 65) {
      return this.copy(
        'The vessel has multiple active risk indicators requiring coordinated operational review.',
        'لدى السفينة عدة مؤشرات مخاطر نشطة تتطلب مراجعة تشغيلية منسقة.'
      );
    }
    if (this.vessel.risk >= 45) {
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
    if (this.vessel.risk >= 85) return this.copy('Action Required', 'إجراء مطلوب');
    if (this.vessel.risk >= 65) return this.copy('Under Review', 'قيد المراجعة');
    if (this.vessel.risk >= 45) return this.copy('Watch', 'مراقبة');
    return this.copy('Compliant', 'مستوفٍ');
  }

  get riskCssClass(): string {
    return this.vessel.riskLevel.toLowerCase();
  }

  get riskGaugeBackground(): string {
    const color =
      this.vessel.risk >= 85 ? '#e65353' :
      this.vessel.risk >= 65 ? '#ef8b43' :
      this.vessel.risk >= 45 ? '#d7a738' : '#4da7a0';
    return `radial-gradient(circle at center, white 58%, transparent 59%), conic-gradient(${color} 0 ${this.vessel.risk}%, #edf1f3 ${this.vessel.risk}% 100%)`;
  }

  private buildOperationalData(): void {
    const risk = this.vessel.risk;
    this.hasCertificateConflict = risk >= 80;
    this.hasOpenDeficiency = risk >= 45;
    this.openDeficiencyCount = this.hasOpenDeficiency ? 1 : 0;

    this.movementRiskImpact = Math.max(3, Math.round(risk * 0.25));
    this.inspectionRiskImpact = this.hasOpenDeficiency ? Math.max(6, Math.round(risk * 0.28)) : Math.max(2, Math.round(risk * 0.12));
    this.certificateRiskImpact = risk >= 55 ? Math.max(5, Math.round(risk * 0.20)) : Math.max(2, Math.round(risk * 0.10));
    this.dataConflictRiskImpact = this.hasCertificateConflict ? Math.max(5, Math.round(risk * 0.14)) : Math.max(1, Math.round(risk * 0.06));
    this.historicalRiskImpact = Math.max(1, risk - this.movementRiskImpact - this.inspectionRiskImpact - this.certificateRiskImpact - this.dataConflictRiskImpact);

    this.sources = this.buildSources();
    this.certificates = this.buildCertificates();
    this.inspections = this.buildInspections();
    this.deficiencies = this.buildDeficiencies();
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

  private buildCertificates(): CertificateRecord[] {
    const firstStatus: CertificateRecord['status'] =
      this.hasCertificateConflict ? 'Conditional' : this.vessel.risk >= 55 ? 'Expiring' : 'Valid';

    return [
      {
        id:`CERT-SC-${this.vessel.imo}`,
        type:'Cargo Ship Safety Construction Certificate',
        number:`CSC-${this.vessel.imo}-2026`,
        issuer:this.isUaeFlag ? 'MOEI Maritime Affairs' : this.flagRegistryAuthority,
        issued:'12 Feb 2026',
        expiry:this.vessel.risk >= 55 ? '19 Dec 2026' : '11 Feb 2031',
        status:firstStatus,
        source:this.isUaeFlag ? 'MOEI Certificate Registry' : 'Verified Flag / RO Certificate Record',
        condition:this.hasCertificateConflict ? 'Subject to verification of an outstanding safety condition before unrestricted operation.' : undefined,
        conflict:this.hasCertificateConflict
      },
      {
        id:`CERT-SR-${this.vessel.imo}`,
        type:'Ship Safety Radio Certificate',
        number:`CSR-${this.vessel.imo}-2025`,
        issuer:this.isUaeFlag ? 'MOEI Recognized Organization' : this.vessel.classSociety,
        issued:'18 Nov 2025',
        expiry:'17 Nov 2027',
        status:'Valid',
        source:this.isUaeFlag ? 'MOEI Certificate Registry' : 'Recognized Organization Record'
      },
      {
        id:`CERT-SE-${this.vessel.imo}`,
        type:'Ship Safety Equipment Certificate',
        number:`CSE-${this.vessel.imo}-2025`,
        issuer:this.isUaeFlag ? 'MOEI Recognized Organization' : this.vessel.classSociety,
        issued:'02 Sep 2025',
        expiry:this.vessel.risk >= 65 ? '01 Dec 2026' : '01 Sep 2028',
        status:this.vessel.risk >= 65 ? 'Expiring' : 'Valid',
        source:this.isUaeFlag ? 'MOEI Certificate Registry' : 'Recognized Organization Record'
      },
      {
        id:`CERT-ISSC-${this.vessel.imo}`,
        type:'International Ship Security Certificate',
        number:`ISSC-${this.vessel.imo}-2024`,
        issuer:this.flagRegistryAuthority,
        issued:'04 Apr 2024',
        expiry:'03 Apr 2029',
        status:'Valid',
        source:this.isUaeFlag ? 'MOEI / Flag-State Record' : 'External Flag Record'
      }
    ];
  }

  private buildInspections(): InspectionRecord[] {
    const latestResult: InspectionRecord['result'] =
      this.vessel.risk >= 65 ? 'Follow-up Required' :
      this.vessel.risk >= 45 ? 'Deficiencies Found' : 'Passed';

    return [
      {
        id:`INS-2026-${String(1300 + this.vessel.id).padStart(5,'0')}`,
        date:'19 Aug 2026',
        port:this.vessel.destination,
        type:'Port State / Safety Inspection',
        result:latestResult,
        inspector:'MOEI Smart Inspection',
        source:'Smart Inspection',
        openDeficiencies:this.openDeficiencyCount
      },
      {
        id:`INS-2026-${String(400 + this.vessel.id).padStart(5,'0')}`,
        date:'13 Mar 2026',
        port:this.vessel.zone,
        type:'Safety Compliance Inspection',
        result:this.vessel.risk >= 50 ? 'Deficiencies Found' : 'Passed',
        inspector:'MOEI Smart Inspection',
        source:'Smart Inspection',
        openDeficiencies:0
      },
      {
        id:`INS-2025-${String(2900 + this.vessel.id).padStart(5,'0')}`,
        date:'22 Nov 2025',
        port:'UAE',
        type:'Routine Inspection',
        result:'Passed',
        inspector:'MOEI Smart Inspection',
        source:'Smart Inspection',
        openDeficiencies:0
      }
    ];
  }

  private buildDeficiencies(): DeficiencyRecord[] {
    const records: DeficiencyRecord[] = [];

    if (this.hasOpenDeficiency) {
      const critical = this.vessel.risk >= 80;
      records.push({
        id:`DEF-2026-${400 + this.vessel.id}`,
        category:critical ? 'Fire Safety' : 'Safety Equipment',
        description:critical
          ? 'Fixed fire detection and alarm system failed functional verification during the latest inspection.'
          : 'Safety equipment finding remains open pending corrective-action evidence.',
        severity:critical ? 'Critical' : 'Major',
        status:'Open',
        raised:'19 Aug 2026',
        due:'02 Sep 2026',
        evidence:`Inspection report INS-2026-${String(1300 + this.vessel.id).padStart(5,'0')} · supporting evidence attached`,
        riskImpact:this.inspectionRiskImpact
      });
    }

    records.push({
      id:`DEF-2026-${100 + this.vessel.id}`,
      category:'Life Saving Appliances',
      description:'Historical inspection finding closed after corrective evidence was accepted.',
      severity:'Minor',
      status:'Closed',
      raised:'13 Mar 2026',
      due:'20 Mar 2026',
      evidence:'Closure evidence accepted',
      riskImpact:0
    });

    return records;
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
          ${this.vessel.risk >= 65 ? '<span class="v360-risk-pulse"></span>' : ''}
          <svg class="v360-ship-symbol" viewBox="0 0 24 34" aria-hidden="true" style="transform:rotate(${this.vessel.course}deg)">
            <path d="M12 1.4c1.5 2.1 4.7 4.6 6.5 8.2v15.7L12 32.6 5.5 25.3V9.6C7.3 6 10.5 3.5 12 1.4Z"></path>
            <path class="ship-deck" d="M9.2 10.6h5.6v8.2H9.2z"></path>
            <path class="ship-centerline" d="M12 3.5v24.3"></path>
          </svg>
          <span class="v360-ship-label">${this.vessel.name} <b>${this.vessel.risk}</b></span>
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
        <b>Risk ${this.vessel.risk} · ${this.vessel.riskLevel}</b>
      </div>`,
      { direction:'top', offset:[0,-22], opacity:1 }
    ).addTo(this.map);

    const routeBounds = L.latLngBounds(route);
    routeBounds.extend([this.vessel.lat, this.vessel.lng]);
    this.map.fitBounds(routeBounds, { padding:[28,28] });
  }
}
