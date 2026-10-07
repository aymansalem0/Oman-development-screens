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
type RouteDirection = 1 | -1;

interface Vessel {
  id: number;
  name: string;
  imo: string;
  mmsi: string;
  flag: string;
  type: string;
  lengthM: number;
  speed: number;
  course: number;
  destination: string;
  eta: string;
  lat: number;
  lng: number;
  risk: number;
  zone: string;
  lastUpdate: number;
  routeKey: string;
  segmentIndex: number;
  direction: RouteDirection;
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

  /**
   * Synthetic maritime corridors for the POC.
   * The points are deliberately offshore so vessel simulation remains over water.
   * They are not official navigation routes and must not be used for navigation.
   */
  private readonly seaRoutes: Record<string, L.LatLngTuple[]> = {
    jebelAli: [
      [25.48, 55.02],
      [25.36, 55.05],
      [25.24, 55.08],
      [25.13, 55.08],
      [25.04, 55.06],
      [24.99, 55.04]
    ],
    dubai: [
      [25.54, 55.08],
      [25.45, 55.13],
      [25.37, 55.18],
      [25.31, 55.22],
      [25.28, 55.25]
    ],
    sharjah: [
      [25.65, 55.10],
      [25.56, 55.15],
      [25.48, 55.20],
      [25.41, 55.25],
      [25.37, 55.29]
    ],
    khalifa: [
      [25.24, 54.28],
      [25.12, 54.38],
      [25.01, 54.48],
      [24.91, 54.56],
      [24.84, 54.61]
    ],
    ruwais: [
      [24.76, 52.24],
      [24.61, 52.36],
      [24.47, 52.48],
      [24.34, 52.58],
      [24.22, 52.66]
    ],
    das: [
      [25.58, 52.40],
      [25.46, 52.52],
      [25.34, 52.64],
      [25.24, 52.76],
      [25.15, 52.88]
    ],
    fujairah: [
      [25.58, 56.86],
      [25.48, 56.72],
      [25.38, 56.58],
      [25.29, 56.47],
      [25.22, 56.39]
    ]
  };

  vessels: Vessel[] = [
    { id: 1, name: 'MV Gulf Horizon', imo: '9328471', mmsi: '636019872', flag: 'Liberia', type: 'Cargo', lengthM: 184, speed: 3.1, course: 198, destination: 'Jebel Ali', eta: '03:30', lat: 25.24, lng: 55.08, risk: 87, zone: 'UAE Approach', lastUpdate: 4, routeKey: 'jebelAli', segmentIndex: 2, direction: 1 },
    { id: 2, name: 'Ocean Star', imo: '9781207', mmsi: '352001947', flag: 'Panama', type: 'Tanker', lengthM: 248, speed: 10.2, course: 225, destination: 'Fujairah', eta: '05:10', lat: 25.38, lng: 56.58, risk: 74, zone: 'East Coast', lastUpdate: 7, routeKey: 'fujairah', segmentIndex: 2, direction: 1 },
    { id: 3, name: 'Sea Pearl', imo: '9904410', mmsi: '470012281', flag: 'UAE', type: 'Passenger', lengthM: 112, speed: 17.6, course: 145, destination: 'Dubai', eta: '01:45', lat: 25.37, lng: 55.18, risk: 28, zone: 'UAE Waters', lastUpdate: 5, routeKey: 'dubai', segmentIndex: 2, direction: 1 },
    { id: 4, name: 'Blue Falcon', imo: '9612456', mmsi: '538008731', flag: 'Marshall Is.', type: 'Container', lengthM: 292, speed: 15.4, course: 140, destination: 'Khalifa Port', eta: '04:20', lat: 25.01, lng: 54.48, risk: 61, zone: 'Abu Dhabi Approach', lastUpdate: 11, routeKey: 'khalifa', segmentIndex: 2, direction: 1 },
    { id: 5, name: 'Al Dana', imo: '9853312', mmsi: '470045821', flag: 'UAE', type: 'Offshore', lengthM: 78, speed: 8.4, course: 132, destination: 'Das Island', eta: '06:40', lat: 25.34, lng: 52.64, risk: 18, zone: 'Offshore', lastUpdate: 8, routeKey: 'das', segmentIndex: 2, direction: 1 },
    { id: 6, name: 'Eastern Crown', imo: '9758418', mmsi: '563091200', flag: 'Singapore', type: 'Bulk Carrier', lengthM: 226, speed: 12.1, course: 200, destination: 'Jebel Ali', eta: '07:15', lat: 25.36, lng: 55.05, risk: 49, zone: 'UAE Approach', lastUpdate: 6, routeKey: 'jebelAli', segmentIndex: 1, direction: 1 },
    { id: 7, name: 'Desert Wave', imo: '9441251', mmsi: '470031118', flag: 'UAE', type: 'Tug', lengthM: 38, speed: 6.2, course: 140, destination: 'Port Rashid', eta: '02:05', lat: 25.31, lng: 55.22, risk: 12, zone: 'Dubai Coastal', lastUpdate: 3, routeKey: 'dubai', segmentIndex: 3, direction: 1 },
    { id: 8, name: 'Northern Light', imo: '9711240', mmsi: '256883000', flag: 'Malta', type: 'Container', lengthM: 304, speed: 14.7, course: 198, destination: 'Jebel Ali', eta: '05:55', lat: 25.48, lng: 55.02, risk: 66, zone: 'UAE Approach', lastUpdate: 9, routeKey: 'jebelAli', segmentIndex: 0, direction: 1 },
    { id: 9, name: 'Arabian Swift', imo: '9885016', mmsi: '470055120', flag: 'UAE', type: 'Cargo', lengthM: 156, speed: 11.8, course: 142, destination: 'Sharjah', eta: '04:05', lat: 25.48, lng: 55.20, risk: 34, zone: 'Northern Emirates', lastUpdate: 12, routeKey: 'sharjah', segmentIndex: 2, direction: 1 },
    { id: 10, name: 'Golden Reef', imo: '9520447', mmsi: '538009112', flag: 'Marshall Is.', type: 'Tanker', lengthM: 238, speed: 9.6, course: 145, destination: 'Ruwais', eta: '08:30', lat: 24.47, lng: 52.48, risk: 53, zone: 'Western Waters', lastUpdate: 6, routeKey: 'ruwais', segmentIndex: 2, direction: 1 },
    { id: 11, name: 'Coral Bridge', imo: '9693412', mmsi: '354221000', flag: 'Panama', type: 'Cargo', lengthM: 176, speed: 13.3, course: 140, destination: 'Khalifa Port', eta: '06:10', lat: 25.12, lng: 54.38, risk: 24, zone: 'Abu Dhabi Approach', lastUpdate: 10, routeKey: 'khalifa', segmentIndex: 1, direction: 1 },
    { id: 12, name: 'Falcon Spirit', imo: '9830097', mmsi: '470066911', flag: 'UAE', type: 'Passenger', lengthM: 98, speed: 18.9, course: 145, destination: 'Dubai', eta: '01:35', lat: 25.45, lng: 55.13, risk: 21, zone: 'Dubai Coastal', lastUpdate: 4, routeKey: 'dubai', segmentIndex: 1, direction: 1 }
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
        [26.15, 55.45],
        [25.55, 55.25],
        [24.45, 54.70],
        [23.65, 53.25],
        [23.90, 51.95]
      ],
      {
        color: '#0f766e',
        weight: 1.6,
        dashArray: '8 7',
        fillColor: '#14b8a6',
        fillOpacity: 0.045
      }
    ).bindTooltip('POC Gulf Monitoring Area', { sticky: true });

    const eastZone = L.polygon(
      [
        [25.75, 56.20],
        [25.80, 56.95],
        [24.75, 57.05],
        [24.20, 56.58],
        [24.45, 56.12]
      ],
      {
        color: '#0284c7',
        weight: 1.6,
        dashArray: '8 7',
        fillColor: '#38bdf8',
        fillOpacity: 0.04
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

    for (let i = 13; i <= 30; i++) {
      const type = types[i % types.length];
      const destination = destinations[i % destinations.length];
      const routeKey = this.routeForDestination(destination);
      const route = this.seaRoutes[routeKey];
      const segmentIndex = (i * 3) % (route.length - 1);
      const start = route[segmentIndex];
      const next = route[Math.min(segmentIndex + 1, route.length - 1)];
      const spread = ((i % 3) - 1) * 0.006;

      this.vessels.push({
        id: i,
        name: `Vessel ${String(i).padStart(2, '0')}`,
        imo: String(9100000 + i * 1137),
        mmsi: String(470000000 + i * 1793),
        flag: flags[i % flags.length],
        type,
        lengthM: this.lengthForType(type, i),
        speed: 7 + ((i * 13) % 110) / 10,
        course: this.bearing(start[0], start[1], next[0], next[1]),
        destination,
        eta: `${String((i + 1) % 24).padStart(2, '0')}:${i % 2 ? '15' : '45'}`,
        lat: start[0] + spread,
        lng: start[1] - spread,
        risk: (i * 17) % 58,
        zone: routeKey === 'fujairah' ? 'East Coast' : routeKey === 'ruwais' ? 'Western Waters' : 'UAE Approach',
        lastUpdate: 2 + (i % 12),
        routeKey,
        segmentIndex,
        direction: 1
      });
    }
  }

  private routeForDestination(destination: string): string {
    if (destination === 'Fujairah') return 'fujairah';
    if (destination === 'Khalifa Port') return 'khalifa';
    if (destination === 'Sharjah') return 'sharjah';
    if (destination === 'Ruwais') return 'ruwais';
    if (destination === 'Das Island') return 'das';
    if (destination === 'Dubai' || destination === 'Port Rashid') return 'dubai';
    return 'jebelAli';
  }

  private lengthForType(type: string, seed: number): number {
    const base: Record<string, number> = {
      Container: 285,
      Tanker: 235,
      'Bulk Carrier': 220,
      Cargo: 165,
      Offshore: 82,
      Passenger: 108,
      Tug: 38
    };
    return (base[type] || 140) + (seed % 5) * 4;
  }

  private moveVessels(): void {
    this.vessels = this.vessels.map((v, index) => {
      const route = this.seaRoutes[v.routeKey];
      if (!route || route.length < 2) return v;

      let direction: RouteDirection = v.direction;
      let segmentIndex = v.segmentIndex;
      let nextIndex = segmentIndex + direction;

      if (nextIndex >= route.length || nextIndex < 0) {
        direction = direction === 1 ? -1 : 1;
        nextIndex = segmentIndex + direction;
      }

      const target = route[nextIndex];
      const latDiff = target[0] - v.lat;
      const lngDiff = target[1] - v.lng;
      const distance = Math.hypot(latDiff, lngDiff);
      const visualStep = Math.min(0.075, Math.max(0.022, v.speed / 330));

      let lat = v.lat + latDiff * visualStep;
      let lng = v.lng + lngDiff * visualStep;

      if (distance < 0.012) {
        lat = target[0];
        lng = target[1];
        segmentIndex = nextIndex;

        if (segmentIndex === route.length - 1 || segmentIndex === 0) {
          direction = direction === 1 ? -1 : 1;
        }
      }

      const futureIndex = Math.max(0, Math.min(route.length - 1, segmentIndex + direction));
      const future = route[futureIndex];

      return {
        ...v,
        lat,
        lng,
        course: this.bearing(lat, lng, future[0], future[1]),
        segmentIndex,
        direction,
        lastUpdate: 2 + ((v.lastUpdate + index) % 12)
      };
    });

    if (this.selectedVessel) {
      this.selectedVessel = this.vessels.find(v => v.id === this.selectedVessel?.id);
    }

    this.refreshMapMarkers();
    this.drawSelectedTrack();
  }

  private bearing(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const toRad = (deg: number) => deg * Math.PI / 180;
    const toDeg = (rad: number) => rad * 180 / Math.PI;
    const y = Math.sin(toRad(lng2 - lng1)) * Math.cos(toRad(lat2));
    const x =
      Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
      Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lng2 - lng1));
    return Math.round((toDeg(Math.atan2(y, x)) + 360) % 360);
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

    const route = this.seaRoutes['jebelAli'];
    vessel.risk = 87;
    vessel.speed = 3.1;
    vessel.lat = route[2][0];
    vessel.lng = route[2][1];
    vessel.routeKey = 'jebelAli';
    vessel.segmentIndex = 2;
    vessel.direction = 1;
    vessel.course = this.bearing(route[2][0], route[2][1], route[3][0], route[3][1]);

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
          <span>IMO ${vessel.imo} · ${vessel.lengthM} m</span>
          <span>${vessel.speed.toFixed(1)} kn · ${vessel.destination}</span>
          <b>Risk ${vessel.risk} · ${this.riskLevel(vessel.risk)}</b>
        </div>`,
        { direction: 'top', offset: [0, -18], opacity: 1 }
      );

      marker.on('click', () => {
        this.zone.run(() => {
          const currentVessel = this.vessels.find(v => v.id === vessel.id);
          if (currentVessel) {
            this.selectVessel(currentVessel, false);
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
    const shipSize = Math.round(Math.max(15, Math.min(27, 14 + vessel.lengthM / 25)));
    const ringSize = shipSize + 14;

    return L.divIcon({
      className: 'nmc-map-marker-wrap',
      html: `
        <div class="nmc-map-marker ${level} ${selected}" style="--ship-size:${shipSize}px;--ring-size:${ringSize}px">
          <span class="risk-ring"></span>
          <span class="ship-pulse"></span>
          <svg class="ship-symbol" viewBox="0 0 24 34" aria-hidden="true" style="transform:rotate(${vessel.course}deg)">
            <path d="M12 1.4c1.5 2.1 4.7 4.6 6.5 8.2v15.7L12 32.6 5.5 25.3V9.6C7.3 6 10.5 3.5 12 1.4Z"></path>
            <path class="ship-deck" d="M9.2 10.6h5.6v8.2H9.2z"></path>
            <path class="ship-centerline" d="M12 3.5v24.3"></path>
          </svg>
          ${selected || vessel.risk >= 65 ? `<span class="ship-label">${vessel.name}<b>${vessel.risk}</b></span>` : ''}
        </div>
      `,
      iconSize: [52, 52],
      iconAnchor: [26, 26]
    });
  }

  private drawSelectedTrack(): void {
    if (!this.map || !this.selectedVessel) return;

    if (this.selectedTrack) {
      this.selectedTrack.removeFrom(this.map);
    }

    const route = this.seaRoutes[this.selectedVessel.routeKey];
    if (!route) return;

    this.selectedTrack = L.polyline(route, {
      color: '#0f766e',
      weight: 3,
      opacity: 0.72,
      dashArray: '9 7'
    }).bindTooltip(`Synthetic safe-sea route to ${this.selectedVessel.destination}`, {
      sticky: true
    }).addTo(this.map);
  }
}
