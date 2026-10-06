import { CommonModule } from '@angular/common';
import {
  AfterViewInit,
  ChangeDetectorRef,
  Component,
  ElementRef,
  NgZone,
  OnDestroy,
  OnInit,
  ViewChild
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import * as L from 'leaflet';

type RiskLevel = 'Critical' | 'High' | 'Watch' | 'Normal';

interface Vessel {
  id: number;
  name: string;
  imo: string;
  mmsi: string;
  flag: string;
  type: string;
  speed: number;
  course: number;
  destination: string;
  eta: string;
  lat: number;
  lng: number;
  risk: number;
  zone: string;
  lastUpdate: number;
}

interface MaritimeEvent {
  time: string;
  vessel: string;
  title: string;
  detail: string;
  severity: 'critical' | 'high' | 'info';
}

@Component({
  selector: 'app-nmc-command-center',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './nmc-command-center.component.html',
  styleUrl: './nmc-command-center.component.css'
})
export class NmcCommandCenterComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('mapContainer', { static: false }) mapContainer?: ElementRef<HTMLDivElement>;

  searchTerm = '';
  riskFilter = 'All';
  typeFilter = 'All';
  feedLive = true;
  selectedVessel?: Vessel;
  now = new Date();

  private timer?: ReturnType<typeof setInterval>;
  private map?: L.Map;
  private markers = new Map<number, L.Marker>();
  private selectedTrack?: L.Polyline;
  private monitoringLayers: L.Layer[] = [];

  vessels: Vessel[] = [
    { id: 1, name: 'MV Gulf Horizon', imo: '9328471', mmsi: '636019872', flag: 'Liberia', type: 'Cargo', speed: 3.1, course: 287, destination: 'Jebel Ali', eta: '03:30', lat: 25.215, lng: 55.590, risk: 87, zone: 'UAE Approach', lastUpdate: 4 },
    { id: 2, name: 'Ocean Star', imo: '9781207', mmsi: '352001947', flag: 'Panama', type: 'Tanker', speed: 10.2, course: 214, destination: 'Fujairah', eta: '05:10', lat: 25.245, lng: 56.510, risk: 74, zone: 'East Coast', lastUpdate: 7 },
    { id: 3, name: 'Sea Pearl', imo: '9904410', mmsi: '470012281', flag: 'UAE', type: 'Passenger', speed: 17.6, course: 305, destination: 'Dubai', eta: '01:45', lat: 25.315, lng: 55.430, risk: 28, zone: 'UAE Waters', lastUpdate: 5 },
    { id: 4, name: 'Blue Falcon', imo: '9612456', mmsi: '538008731', flag: 'Marshall Is.', type: 'Container', speed: 15.4, course: 296, destination: 'Khalifa Port', eta: '04:20', lat: 24.940, lng: 54.900, risk: 61, zone: 'Abu Dhabi Approach', lastUpdate: 11 },
    { id: 5, name: 'Al Dana', imo: '9853312', mmsi: '470045821', flag: 'UAE', type: 'Offshore', speed: 8.4, course: 110, destination: 'Das Island', eta: '06:40', lat: 25.090, lng: 53.020, risk: 18, zone: 'Offshore', lastUpdate: 8 },
    { id: 6, name: 'Eastern Crown', imo: '9758418', mmsi: '563091200', flag: 'Singapore', type: 'Bulk Carrier', speed: 12.1, course: 276, destination: 'Jebel Ali', eta: '07:15', lat: 25.520, lng: 55.880, risk: 49, zone: 'UAE Approach', lastUpdate: 6 },
    { id: 7, name: 'Desert Wave', imo: '9441251', mmsi: '470031118', flag: 'UAE', type: 'Tug', speed: 6.2, course: 19, destination: 'Port Rashid', eta: '02:05', lat: 25.300, lng: 55.310, risk: 12, zone: 'Dubai Coastal', lastUpdate: 3 },
    { id: 8, name: 'Northern Light', imo: '9711240', mmsi: '256883000', flag: 'Malta', type: 'Container', speed: 14.7, course: 302, destination: 'Jebel Ali', eta: '05:55', lat: 25.680, lng: 55.350, risk: 66, zone: 'UAE Approach', lastUpdate: 9 },
    { id: 9, name: 'Arabian Swift', imo: '9885016', mmsi: '470055120', flag: 'UAE', type: 'Cargo', speed: 11.8, course: 89, destination: 'Sharjah', eta: '04:05', lat: 25.430, lng: 55.520, risk: 34, zone: 'Northern Emirates', lastUpdate: 12 },
    { id: 10, name: 'Golden Reef', imo: '9520447', mmsi: '538009112', flag: 'Marshall Is.', type: 'Tanker', speed: 9.6, course: 266, destination: 'Ruwais', eta: '08:30', lat: 24.460, lng: 52.950, risk: 53, zone: 'Western Waters', lastUpdate: 6 },
    { id: 11, name: 'Coral Bridge', imo: '9693412', mmsi: '354221000', flag: 'Panama', type: 'Cargo', speed: 13.3, course: 310, destination: 'Khalifa Port', eta: '06:10', lat: 24.780, lng: 54.650, risk: 24, zone: 'Abu Dhabi Approach', lastUpdate: 10 },
    { id: 12, name: 'Falcon Spirit', imo: '9830097', mmsi: '470066911', flag: 'UAE', type: 'Passenger', speed: 18.9, course: 61, destination: 'Dubai', eta: '01:35', lat: 25.180, lng: 55.140, risk: 21, zone: 'Dubai Coastal', lastUpdate: 4 }
  ];

  events: MaritimeEvent[] = [
    { time: '22:42:18', vessel: 'MV Gulf Horizon', title: 'Risk escalated to CRITICAL', detail: 'Movement anomaly correlated with unresolved inspection deficiency and certificate condition.', severity: 'critical' },
    { time: '22:41:56', vessel: 'MV Gulf Horizon', title: 'Certificate data conflict', detail: 'MOEI record: Conditionally Valid · External source: Valid.', severity: 'high' },
    { time: '22:41:31', vessel: 'MV Gulf Horizon', title: 'Abnormal speed reduction', detail: 'Speed reduced from 13.4 kn to 3.1 kn inside UAE Approach monitoring zone.', severity: 'high' },
    { time: '22:40:14', vessel: 'Ocean Star', title: 'Enhanced monitoring started', detail: 'Risk threshold exceeded due to historical inspection indicators.', severity: 'info' },
    { time: '22:38:09', vessel: 'Northern Light', title: 'Route deviation detected', detail: 'Observed route differs from declared destination corridor.', severity: 'info' }
  ];

  constructor(
    private zone: NgZone,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.addBackgroundVessels();
    this.selectedVessel = this.vessels[0];

    this.timer = setInterval(() => {
      this.now = new Date();
      if (this.feedLive) {
        this.moveVessels();
      }
    }, 2500);
  }

  ngAfterViewInit(): void {
    this.initMap();
  }

  ngOnDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.map?.remove();
  }

  private initMap(): void {
    if (!this.mapContainer || this.map) return;

    this.map = L.map(this.mapContainer.nativeElement, {
      zoomControl: false,
      attributionControl: true,
      minZoom: 5,
      maxZoom: 16
    });

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      crossOrigin: true,
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(this.map);

    L.control.zoom({ position: 'bottomright' }).addTo(this.map);

    const gulfZone = L.polygon(
      [
        [26.40, 51.85],
        [26.55, 53.65],
        [26.15, 55.55],
        [25.55, 56.15],
        [24.45, 55.35],
        [23.65, 53.25],
        [23.90, 51.95]
      ],
      {
        color: '#0f766e',
        weight: 1.6,
        dashArray: '8 7',
        fillColor: '#14b8a6',
        fillOpacity: 0.06
      }
    ).bindTooltip('POC Gulf Monitoring Area', { sticky: true });

    const eastZone = L.polygon(
      [
        [25.70, 56.00],
        [25.75, 56.75],
        [24.75, 56.95],
        [24.20, 56.45],
        [24.45, 56.00]
      ],
      {
        color: '#0284c7',
        weight: 1.6,
        dashArray: '8 7',
        fillColor: '#38bdf8',
        fillOpacity: 0.05
      }
    ).bindTooltip('POC East Coast Monitoring Area', { sticky: true });

    gulfZone.addTo(this.map);
    eastZone.addTo(this.map);
    this.monitoringLayers = [gulfZone, eastZone];

    this.map.fitBounds(L.latLngBounds([[23.35, 51.55], [26.75, 57.05]]), {
      padding: [16, 16]
    });

    this.refreshMapMarkers();
    this.drawSelectedTrack();
  }

  private addBackgroundVessels(): void {
    const flags = ['Bahamas', 'Hong Kong', 'UAE', 'Panama', 'Liberia', 'Singapore'];
    const types = ['Cargo', 'Tanker', 'Container', 'Bulk Carrier', 'Offshore'];
    const destinations = ['Jebel Ali', 'Fujairah', 'Khalifa Port', 'Sharjah', 'Ruwais'];
    const zones = ['UAE Approach', 'UAE Waters', 'East Coast', 'Western Waters'];
    const anchorPoints = [
      { lat: 25.55, lng: 55.72 },
      { lat: 24.92, lng: 54.95 },
      { lat: 25.28, lng: 56.45 },
      { lat: 24.38, lng: 53.28 },
      { lat: 25.46, lng: 55.02 },
      { lat: 24.74, lng: 55.58 }
    ];

    for (let i = 13; i <= 30; i++) {
      const anchor = anchorPoints[i % anchorPoints.length];
      const risk = (i * 17) % 58;
      const latOffset = (((i * 13) % 11) - 5) * 0.055;
      const lngOffset = (((i * 7) % 13) - 6) * 0.065;

      this.vessels.push({
        id: i,
        name: `Vessel ${String(i).padStart(2, '0')}`,
        imo: String(9100000 + i * 1137),
        mmsi: String(470000000 + i * 1793),
        flag: flags[i % flags.length],
        type: types[i % types.length],
        speed: 7 + ((i * 13) % 110) / 10,
        course: (i * 31) % 360,
        destination: destinations[i % destinations.length],
        eta: `${String((i + 1) % 24).padStart(2, '0')}:${i % 2 ? '15' : '45'}`,
        lat: anchor.lat + latOffset,
        lng: anchor.lng + lngOffset,
        risk,
        zone: zones[i % zones.length],
        lastUpdate: 2 + (i % 12)
      });
    }
  }

  private moveVessels(): void {
    this.vessels = this.vessels.map((v, index) => {
      const distanceFactor = Math.max(0.0008, v.speed / 18000);
      const heading = (v.course * Math.PI) / 180;
      const latDelta = Math.cos(heading) * distanceFactor;
      const lngDelta = Math.sin(heading) * distanceFactor;

      return {
        ...v,
        lat: v.lat + latDelta,
        lng: v.lng + lngDelta,
        lastUpdate: 2 + ((v.lastUpdate + index) % 12)
      };
    });

    if (this.selectedVessel) {
      this.selectedVessel = this.vessels.find(v => v.id === this.selectedVessel?.id);
    }

    this.refreshMapMarkers();
    this.drawSelectedTrack();
  }

  get filteredVessels(): Vessel[] {
    const q = this.searchTerm.trim().toLowerCase();
    return this.vessels.filter(v => {
      const matchesSearch = !q || [v.name, v.imo, v.destination, v.flag].some(value => value.toLowerCase().includes(q));
      const matchesRisk = this.riskFilter === 'All' || this.riskLevel(v.risk) === this.riskFilter;
      const matchesType = this.typeFilter === 'All' || v.type === this.typeFilter;
      return matchesSearch && matchesRisk && matchesType;
    });
  }

  get attentionVessels(): Vessel[] {
    return [...this.vessels]
      .filter(v => v.risk >= 45)
      .sort((a, b) => b.risk - a.risk)
      .slice(0, 6);
  }

  get vesselTypes(): string[] {
    return ['All', ...Array.from(new Set(this.vessels.map(v => v.type))).sort()];
  }

  get monitoredCount(): number {
    return this.vessels.length;
  }

  get attentionCount(): number {
    return this.vessels.filter(v => v.risk >= 45).length;
  }

  get highRiskCount(): number {
    return this.vessels.filter(v => v.risk >= 65).length;
  }

  get criticalCount(): number {
    return this.vessels.filter(v => v.risk >= 85).length;
  }

  riskLevel(score: number): RiskLevel {
    if (score >= 85) return 'Critical';
    if (score >= 65) return 'High';
    if (score >= 45) return 'Watch';
    return 'Normal';
  }

  riskClass(score: number): string {
    return this.riskLevel(score).toLowerCase();
  }

  selectVessel(vessel: Vessel, fly = true): void {
    this.selectedVessel = vessel;
    this.refreshMapMarkers();
    this.drawSelectedTrack();

    if (fly && this.map) {
      this.map.flyTo([vessel.lat, vessel.lng], Math.max(this.map.getZoom(), 8), {
        duration: 0.7
      });
    }
  }

  toggleFeed(): void {
    this.feedLive = !this.feedLive;
  }

  onFilterChange(): void {
    this.refreshMapMarkers();
  }

  resetMapView(): void {
    this.map?.fitBounds(L.latLngBounds([[23.35, 51.55], [26.75, 57.05]]), {
      padding: [16, 16]
    });
  }

  replayScenario(): void {
    const vessel = this.vessels.find(v => v.id === 1);
    if (!vessel) return;

    vessel.risk = 87;
    vessel.speed = 3.1;
    vessel.lat = 25.215;
    vessel.lng = 55.590;
    vessel.course = 287;

    this.selectedVessel = vessel;
    const time = new Date().toLocaleTimeString('en-GB', { hour12: false });
    const replayEvent: MaritimeEvent = {
      time,
      vessel: vessel.name,
      title: 'POC scenario replayed',
      detail: 'Movement anomaly + open deficiency + certificate conflict correlated into a critical maritime event.',
      severity: 'critical'
    };

    this.events = [replayEvent, ...this.events].slice(0, 8);
    this.refreshMapMarkers();
    this.drawSelectedTrack();
    this.map?.flyTo([vessel.lat, vessel.lng], 9, { duration: 0.8 });
  }

  private refreshMapMarkers(): void {
    if (!this.map) return;

    const visibleIds = new Set(this.filteredVessels.map(v => v.id));

    for (const [id, marker] of this.markers.entries()) {
      if (!visibleIds.has(id)) {
        marker.removeFrom(this.map);
        this.markers.delete(id);
      }
    }

    for (const vessel of this.filteredVessels) {
      const existing = this.markers.get(vessel.id);
      if (existing) {
        existing.setLatLng([vessel.lat, vessel.lng]);
        existing.setIcon(this.createVesselIcon(vessel));
        continue;
      }

      const marker = L.marker([vessel.lat, vessel.lng], {
        icon: this.createVesselIcon(vessel),
        keyboard: true,
        riseOnHover: true
      });

      marker.bindTooltip(
        `<div class="map-vessel-tooltip">
          <strong>${vessel.name}</strong>
          <span>IMO ${vessel.imo}</span>
          <span>${vessel.speed.toFixed(1)} kn · ${vessel.destination}</span>
          <b>Risk ${vessel.risk} · ${this.riskLevel(vessel.risk)}</b>
        </div>`,
        { direction: 'top', offset: [0, -12], opacity: 1 }
      );

      marker.on('click', () => {
        this.zone.run(() => {
          const current = this.vessels.find(v => v.id === vessel.id);
          if (current) {
            this.selectVessel(current, false);
            this.cdr.detectChanges();
          }
        });
      });

      marker.addTo(this.map);
      this.markers.set(vessel.id, marker);
    }
  }

  private createVesselIcon(vessel: Vessel): L.DivIcon {
    const level = this.riskClass(vessel.risk);
    const selected = this.selectedVessel?.id === vessel.id ? 'selected' : '';

    return L.divIcon({
      className: 'nmc-map-marker-wrap',
      html: `
        <div class="nmc-map-marker ${level} ${selected}">
          <span class="ship-pulse"></span>
          <span class="ship-arrow" style="transform:rotate(${vessel.course}deg)">▲</span>
          ${selected || vessel.risk >= 65 ? `<span class="ship-label">${vessel.name}<b>${vessel.risk}</b></span>` : ''}
        </div>
      `,
      iconSize: [32, 32],
      iconAnchor: [16, 16]
    });
  }

  private drawSelectedTrack(): void {
    if (!this.map || !this.selectedVessel) return;

    if (this.selectedTrack) {
      this.selectedTrack.removeFrom(this.map);
    }

    const v = this.selectedVessel;
    const points: L.LatLngExpression[] = [
      [v.lat - 0.10, v.lng + 0.16],
      [v.lat - 0.07, v.lng + 0.12],
      [v.lat - 0.045, v.lng + 0.08],
      [v.lat - 0.02, v.lng + 0.04],
      [v.lat, v.lng]
    ];

    this.selectedTrack = L.polyline(points, {
      color: '#0f766e',
      weight: 2.3,
      opacity: 0.75,
      dashArray: '5 6'
    }).addTo(this.map);
  }
}
