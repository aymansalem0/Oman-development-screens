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
  private map?: L.Map;

  vessel = {
    name: 'MV Gulf Horizon',
    imo: '9328471',
    mmsi: '636019872',
    callSign: 'D5GH7',
    flag: 'Liberia',
    type: 'General Cargo',
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
    course: '287°',
    navStatus: 'Under way using engine',
    position: '25.2150° N, 55.5900° E',
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

  private initMap(): void {
    if (!this.vesselMap || this.map) return;

    this.map = L.map(this.vesselMap.nativeElement, {
      zoomControl: false,
      attributionControl: true,
      minZoom: 6,
      maxZoom: 15
    });

    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      subdomains: 'abcd',
      maxZoom: 20,
      attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
    }).addTo(this.map);

    L.control.zoom({ position: 'bottomright' }).addTo(this.map);

    const expected: L.LatLngExpression[] = [
      [24.94, 56.15],
      [25.03, 55.98],
      [25.10, 55.80],
      [25.17, 55.63],
      [25.22, 55.45]
    ];

    const observed: L.LatLngExpression[] = [
      [24.94, 56.15],
      [25.03, 55.98],
      [25.10, 55.84],
      [25.18, 55.78],
      [25.215, 55.59]
    ];

    L.polyline(expected, {
      color: '#0284c7',
      weight: 3,
      opacity: 0.62,
      dashArray: '7 7'
    }).bindTooltip('Expected arrival corridor').addTo(this.map);

    L.polyline(observed, {
      color: '#0f766e',
      weight: 4,
      opacity: 0.9
    }).bindTooltip('Observed movement').addTo(this.map);

    L.circleMarker([25.18, 55.78], {
      radius: 8,
      color: '#fff',
      weight: 3,
      fillColor: '#f59e0b',
      fillOpacity: 1
    }).bindTooltip('Anomaly detected · route deviation begins').addTo(this.map);

    L.circleMarker([25.215, 55.59], {
      radius: 9,
      color: '#fff',
      weight: 3,
      fillColor: '#ef4444',
      fillOpacity: 1
    }).bindTooltip('MV Gulf Horizon · Current position').addTo(this.map);

    this.map.fitBounds(L.latLngBounds([[24.84, 55.35], [25.34, 56.25]]), { padding: [18, 18] });
  }
}
