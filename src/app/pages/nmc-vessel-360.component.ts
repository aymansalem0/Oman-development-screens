import { CommonModule } from '@angular/common';
import { AfterViewInit, Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import * as L from 'leaflet';
import {
  getVesselByImo,
  NMC_VESSELS,
  NmcVesselProfile,
  riskLevel,
  SEA_ROUTES
} from '../data/nmc-vessel-catalog';

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

  hasCertificateConflict = false;
  hasOpenDeficiency = false;
  openDeficiencyCount = 0;
  certificateRiskImpact = 0;
  inspectionRiskImpact = 0;
  historicalRiskImpact = 0;
  movementRiskImpact = 0;
  dataConflictRiskImpact = 0;

  private map?: L.Map;

  constructor(private route: ActivatedRoute) {}

  ngOnInit(): void {
    this.imo = this.route.snapshot.paramMap.get('imo') || NMC_VESSELS[0].imo;
    const profile = getVesselByImo(this.imo) || NMC_VESSELS[0];

    this.vessel = {
      ...profile,
      age: 2026 - profile.built,
      riskScore: profile.risk,
      riskLevel: riskLevel(profile.risk),
      position: `${profile.lat.toFixed(4)}° N, ${profile.lng.toFixed(4)}° E`
    };

    this.buildOperationalData();
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
    return this.isUaeFlag ? 'UAE Vessel Registration' : 'Flag Registration';
  }

  get registrationStatus(): string {
    return 'Active';
  }

  get registrationSource(): string {
    return this.flagRegistryAuthority;
  }

  get registrationAuthorityLabel(): string {
    return this.isUaeFlag ? 'MOEI Authoritative' : 'External Authoritative';
  }

  get vesselMasterRole(): string {
    return this.isUaeFlag
      ? 'Authoritative internal vessel context linked to the UAE registry'
      : 'Internal correlation record for a foreign-flag vessel operating in the NMC context';
  }

  get moeiRelationshipTitle(): string {
    return this.isUaeFlag ? 'MOEI Flag-State Relationship' : 'MOEI Regulatory Relationship';
  }

  get moeiRelationshipStatus(): string {
    if (this.isUaeFlag) return 'Registered UAE Vessel';
    return this.vessel.risk >= 65 ? 'Active · Under Operational Review' : 'Active · Monitored';
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
    if (level === 'Critical') return 'Immediate operational review required';
    if (level === 'High') return 'Priority monitoring and review required';
    if (level === 'Watch') return 'Enhanced monitoring recommended';
    return 'Normal monitoring status';
  }

  get attentionDescription(): string {
    if (this.vessel.risk >= 85) {
      return 'Multiple movement, inspection, certificate and data-quality indicators have been correlated into a critical vessel risk picture.';
    }
    if (this.vessel.risk >= 65) {
      return 'The vessel has multiple active risk indicators requiring coordinated operational review.';
    }
    if (this.vessel.risk >= 45) {
      return 'Monitoring indicators require attention, but no immediate critical intervention is currently indicated.';
    }
    return 'No critical compliance, inspection or movement exceptions are currently open for this vessel.';
  }

  get complianceStatus(): string {
    if (this.vessel.risk >= 85) return 'Action Required';
    if (this.vessel.risk >= 65) return 'Under Review';
    if (this.vessel.risk >= 45) return 'Watch';
    return 'Compliant';
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
