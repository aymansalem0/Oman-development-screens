import { CommonModule } from '@angular/common';
import { AfterViewInit, Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import * as L from 'leaflet';

interface SourceStatus {
  name: string;
  system: string;
  status: 'Matched' | 'Conflict' | 'Available';
  lastSync: string;
  record: string;
  confidence: number;
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

@Component({
  selector: 'app-nmc-vessel-360',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './nmc-vessel-360.component.html',
  styleUrl: './nmc-vessel-360.component.css'
})
export class NmcVessel360Component implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('vesselMap', { static: false }) vesselMap?: ElementRef<HTMLDivElement>;

  imo = '9328471';
  activeTab = 'overview';
  certificateVerificationStarted = false;
  priorityInspectionCreated = false;
  selectedCertificateId = 'CERT-SC-2026-0417';
  private map?: L.Map;

  vessel = {
    name: 'MV Gulf Horizon',
    imo: '9328471',
    mmsi: '636019872',
    callSign: 'D5GH7',
    flag: 'Liberia',
    type: 'General Cargo',
    lengthM: 184,
    built: 2002,
    age: 24,
    grossTonnage: '28,450 GT',
    deadweight: '46,820 DWT',
    owner: 'Gulf Horizon Shipping Ltd.',
    operator: 'Blue Meridian Marine',
    classSociety: 'Global Marine Classification',
    destination: 'Jebel Ali',
    eta: '07 Oct 2026 · 03:30',
    speed: '3.1 kn',
    course: '169°',
    navStatus: 'Under way using engine',
    position: '25.2200° N, 55.0000° E',
    riskScore: 87,
    riskLevel: 'Critical',
    dataConfidence: 76,
    riskConfidence: 92
  };

  sources: SourceStatus[] = [
    { name: 'Vessel Registry', system: 'MOEI Vessel Master', status: 'Matched', lastSync: '22:42:09', record: 'IMO 9328471 · Active', confidence: 100 },
    { name: 'Movement Feed', system: 'AIS / LRIT Simulator', status: 'Matched', lastSync: '22:42:18', record: 'Position / speed / course', confidence: 96 },
    { name: 'Inspection', system: 'Smart Inspection', status: 'Matched', lastSync: '22:41:55', record: '1 critical deficiency open', confidence: 100 },
    { name: 'Certificates', system: 'MOEI Certificate Registry', status: 'Conflict', lastSync: '22:41:56', record: 'Safety certificate: Conditional', confidence: 100 },
    { name: 'External Classification', system: 'Simulated Class Feed', status: 'Conflict', lastSync: '22:41:57', record: 'Safety certificate: Valid', confidence: 68 },
    { name: 'Company Profile', system: 'Company Master', status: 'Available', lastSync: '22:40:12', record: 'Operator profile available', confidence: 98 }
  ];

  riskFactors = [
    { label: 'Unresolved critical fire-safety deficiency', value: 25, source: 'Inspection' },
    { label: 'Abnormal speed reduction & route deviation', value: 22, source: 'AIS / LRIT' },
    { label: 'Conditional certificate state', value: 18, source: 'Certificate Registry' },
    { label: 'Conflict between authoritative data sources', value: 12, source: 'Data Quality' },
    { label: 'Historical inspection pattern', value: 10, source: 'Inspection History' }
  ];

  certificates: CertificateRecord[] = [
    {
      id: 'CERT-SC-2026-0417',
      type: 'Cargo Ship Safety Construction Certificate',
      number: 'CSC-9328471-2026',
      issuer: 'MOEI Maritime Affairs',
      issued: '12 Feb 2026',
      expiry: '11 Feb 2031',
      status: 'Conditional',
      source: 'MOEI Certificate Registry',
      condition: 'Subject to closure of outstanding fire-safety deficiency before unrestricted operation.',
      conflict: true
    },
    {
      id: 'CERT-SR-2025-1182',
      type: 'Cargo Ship Safety Radio Certificate',
      number: 'CSR-9328471-2025',
      issuer: 'Recognized Organization',
      issued: '18 Nov 2025',
      expiry: '17 Nov 2026',
      status: 'Valid',
      source: 'MOEI Certificate Registry'
    },
    {
      id: 'CERT-SE-2025-0914',
      type: 'Cargo Ship Safety Equipment Certificate',
      number: 'CSE-9328471-2025',
      issuer: 'Recognized Organization',
      issued: '02 Sep 2025',
      expiry: '01 Dec 2026',
      status: 'Expiring',
      source: 'MOEI Certificate Registry'
    },
    {
      id: 'CERT-ISSC-2024-3310',
      type: 'International Ship Security Certificate',
      number: 'ISSC-9328471-2024',
      issuer: 'Flag Administration',
      issued: '04 Apr 2024',
      expiry: '03 Apr 2029',
      status: 'Valid',
      source: 'External Flag Record'
    }
  ];

  inspections: InspectionRecord[] = [
    {
      id: 'INS-2026-01341',
      date: '19 Aug 2026',
      port: 'Jebel Ali',
      type: 'Port State / Safety Inspection',
      result: 'Follow-up Required',
      inspector: 'MOEI Smart Inspection',
      source: 'Smart Inspection',
      openDeficiencies: 1
    },
    {
      id: 'INS-2026-00418',
      date: '13 Mar 2026',
      port: 'Fujairah',
      type: 'Safety Compliance Inspection',
      result: 'Deficiencies Found',
      inspector: 'MOEI Smart Inspection',
      source: 'Smart Inspection',
      openDeficiencies: 0
    },
    {
      id: 'INS-2025-02981',
      date: '22 Nov 2025',
      port: 'Khalifa Port',
      type: 'Routine Inspection',
      result: 'Passed',
      inspector: 'MOEI Smart Inspection',
      source: 'Smart Inspection',
      openDeficiencies: 0
    }
  ];

  deficiencies: DeficiencyRecord[] = [
    {
      id: 'DEF-2026-441',
      category: 'Fire Safety',
      description: 'Fixed fire detection and alarm system in cargo-space zone failed functional verification during inspection.',
      severity: 'Critical',
      status: 'Open',
      raised: '19 Aug 2026',
      due: '02 Sep 2026',
      evidence: 'Inspection report INS-2026-01341 · Photo evidence set FS-12 to FS-18',
      riskImpact: 25
    },
    {
      id: 'DEF-2026-118',
      category: 'Life Saving Appliances',
      description: 'Emergency lighting signage required corrective labeling.',
      severity: 'Minor',
      status: 'Closed',
      raised: '13 Mar 2026',
      due: '20 Mar 2026',
      evidence: 'Closure evidence accepted 17 Mar 2026',
      riskImpact: 0
    }
  ];

  timeline: TimelineItem[] = [
    { time: '22:42', title: 'Risk escalated to Critical', detail: 'Composite score reached 87 after data correlation.', kind: 'critical' },
    { time: '22:41', title: 'Certificate data conflict detected', detail: 'MOEI registry and external classification feed disagree.', kind: 'warning' },
    { time: '22:41', title: 'Movement anomaly detected', detail: 'Observed course differs from expected arrival corridor.', kind: 'warning' },
    { time: '20:15', title: 'Historical deficiency loaded', detail: 'Fire-safety deficiency remains unresolved from prior inspection.', kind: 'normal' },
    { time: '18:04', title: 'Vessel entered monitoring area', detail: 'AIS identity matched to MOEI vessel master using IMO number.', kind: 'normal' }
  ];

  constructor(private route: ActivatedRoute) {}

  ngOnInit(): void {
    this.imo = this.route.snapshot.paramMap.get('imo') || this.vessel.imo;
    this.vessel.imo = this.imo;
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

    if (source.includes('AIS')) {
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

  private initMap(): void {
    if (!this.vesselMap || this.map) return;

    this.map = L.map(this.vesselMap.nativeElement, {
      zoomControl: false,
      attributionControl: true,
      minZoom: 6,
      maxZoom: 15
    });

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      crossOrigin: true,
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(this.map);

    L.control.zoom({ position: 'bottomright' }).addTo(this.map);

    const expected: L.LatLngExpression[] = [
      [25.52, 54.88],
      [25.42, 54.92],
      [25.32, 54.96],
      [25.22, 55.00],
      [25.12, 55.02],
      [25.04, 55.02],
      [24.99, 55.03]
    ];

    const observed: L.LatLngExpression[] = [
      [25.52, 54.88],
      [25.42, 54.92],
      [25.34, 54.89],
      [25.28, 54.84],
      [25.23, 54.90],
      [25.22, 55.00]
    ];

    L.polyline(expected, {
      color: '#0284c7',
      weight: 3,
      opacity: 0.64,
      dashArray: '7 7'
    }).bindTooltip('Expected offshore arrival corridor to Jebel Ali').addTo(this.map);

    L.polyline(observed, {
      color: '#0f766e',
      weight: 4,
      opacity: 0.92
    }).bindTooltip('Observed offshore movement').addTo(this.map);

    L.circleMarker([25.34, 54.89], {
      radius: 8,
      color: '#fff',
      weight: 3,
      fillColor: '#f59e0b',
      fillOpacity: 1
    }).bindTooltip('Anomaly detected · route deviation begins').addTo(this.map);

    const shipSize = Math.round(Math.max(18, Math.min(30, 14 + this.vessel.lengthM / 25)));
    const ringSize = shipSize + 16;
    const currentShipIcon = L.divIcon({
      className: 'v360-map-ship-wrap',
      html: `
        <div class="v360-map-ship critical" style="--ship-size:${shipSize}px;--ring-size:${ringSize}px">
          <span class="v360-risk-ring"></span>
          <span class="v360-risk-pulse"></span>
          <svg class="v360-ship-symbol" viewBox="0 0 24 34" aria-hidden="true" style="transform:rotate(169deg)">
            <path d="M12 1.4c1.5 2.1 4.7 4.6 6.5 8.2v15.7L12 32.6 5.5 25.3V9.6C7.3 6 10.5 3.5 12 1.4Z"></path>
            <path class="ship-deck" d="M9.2 10.6h5.6v8.2H9.2z"></path>
            <path class="ship-centerline" d="M12 3.5v24.3"></path>
          </svg>
          <span class="v360-ship-label">MV Gulf Horizon <b>87</b></span>
        </div>
      `,
      iconSize: [58, 58],
      iconAnchor: [29, 29]
    });

    L.marker([25.22, 55.00], {
      icon: currentShipIcon,
      keyboard: true,
      riseOnHover: true
    })
      .bindTooltip(
        `<div class="v360-map-tooltip">
          <strong>MV Gulf Horizon</strong>
          <span>IMO ${this.vessel.imo} · ${this.vessel.lengthM} m</span>
          <span>3.1 kn · Course 169° · Jebel Ali</span>
          <b>Risk 87 · Critical</b>
        </div>`,
        { direction: 'top', offset: [0, -22], opacity: 1 }
      )
      .addTo(this.map);

    this.map.fitBounds(L.latLngBounds([[24.92, 54.72], [25.60, 55.16]]), { padding: [18, 18] });
  }
}
