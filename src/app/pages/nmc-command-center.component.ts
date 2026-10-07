import { CommonModule } from '@angular/common';
import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  ViewChild
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import * as L from 'leaflet';
import {
  NMC_VESSELS,
  NmcVesselProfile,
  riskLevel,
  RiskLevel,
  RouteDirection,
  SEA_ROUTES
} from '../data/nmc-vessel-catalog';
import { LanguageService } from '../services/language.service';

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
  selectedVessel?: NmcVesselProfile;
  now = new Date();

  vessels: NmcVesselProfile[] = NMC_VESSELS.map(vessel => ({ ...vessel }));

  events: MaritimeEvent[] = [
    { time: '22:42:18', vessel: 'MV Gulf Horizon', title: 'Risk escalated to Critical', detail: 'Movement anomaly correlated with unresolved inspection deficiency and certificate condition.', severity: 'critical' },
    { time: '22:41:56', vessel: 'MV Gulf Horizon', title: 'Certificate data conflict', detail: 'MOEI record and external classification source require verification.', severity: 'high' },
    { time: '22:40:14', vessel: 'Ocean Star', title: 'Enhanced monitoring started', detail: 'Risk threshold exceeded due to inspection and certificate indicators.', severity: 'high' },
    { time: '22:38:09', vessel: 'Northern Light', title: 'Route deviation detected', detail: 'Observed route differs from expected arrival corridor.', severity: 'info' },
    { time: '22:36:31', vessel: 'Arabian Crest', title: 'Certificate expiry threshold reached', detail: 'Certificate validity window entered the configured monitoring threshold.', severity: 'info' }
  ];

  private timer?: ReturnType<typeof setInterval>;
  private map?: L.Map;
  private markers = new Map<number, L.Marker>();
  private selectedTrack?: L.Polyline;

  constructor(private router: Router, public lang: LanguageService) {}

  copy(en: string, ar: string): string {
    return this.lang.pick(en, ar);
  }

  toggleLanguage(): void {
    this.lang.toggle();

    if (this.map) {
      this.map.remove();
      this.map = undefined;
      this.markers.clear();
      this.selectedTrack = undefined;
      setTimeout(() => this.initMap());
    }
  }

  get formattedNow(): string {
    return new Intl.DateTimeFormat(this.lang.isArabic ? 'ar-AE' : 'en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }).format(this.now);
  }

  riskLabel(score: number): string {
    const level = this.riskLevel(score);
    const labels: Record<RiskLevel, string> = {
      Critical: this.copy('Critical', 'حرج'),
      High: this.copy('High', 'مرتفع'),
      Watch: this.copy('Watch', 'مراقبة'),
      Normal: this.copy('Normal', 'طبيعي')
    };
    return labels[level];
  }

  vesselTypeLabel(type: string): string {
    const labels: Record<string, string> = {
      Cargo: 'سفينة بضائع',
      Tanker: 'ناقلة',
      Passenger: 'سفينة ركاب',
      Container: 'سفينة حاويات',
      Offshore: 'سفينة خدمات بحرية',
      'Bulk Carrier': 'ناقلة بضائع صب',
      Tug: 'قاطرة'
    };
    return this.lang.isArabic ? (labels[type] || type) : type;
  }

  flagLabel(flag: string): string {
    const labels: Record<string, string> = {
      UAE: 'الإمارات',
      Liberia: 'ليبيريا',
      Panama: 'بنما',
      'Marshall Is.': 'جزر مارشال',
      Singapore: 'سنغافورة',
      Malta: 'مالطا',
      'Hong Kong': 'هونغ كونغ',
      Bahamas: 'الباهاما'
    };
    return this.lang.isArabic ? (labels[flag] || flag) : flag;
  }

  zoneLabel(zone: string): string {
    const labels: Record<string, string> = {
      'UAE Approach': 'مناطق الاقتراب من الإمارات',
      'East Coast': 'الساحل الشرقي',
      'UAE Waters': 'المياه الإماراتية',
      'Abu Dhabi Approach': 'مناطق الاقتراب من أبوظبي',
      Offshore: 'المناطق البحرية',
      'Dubai Coastal': 'ساحل دبي',
      'Northern Emirates': 'الإمارات الشمالية',
      'Western Waters': 'المياه الغربية'
    };
    return this.lang.isArabic ? (labels[zone] || zone) : zone;
  }

  eventTitle(event: MaritimeEvent): string {
    const ar: Record<string, string> = {
      'Risk escalated to Critical': 'تصاعد مستوى المخاطر إلى حرج',
      'Certificate data conflict': 'تعارض في بيانات الشهادة',
      'Enhanced monitoring started': 'بدء المراقبة المعززة',
      'Route deviation detected': 'تم اكتشاف انحراف عن المسار',
      'Certificate expiry threshold reached': 'بلوغ حد مراقبة انتهاء الشهادة'
    };
    return this.lang.isArabic ? (ar[event.title] || event.title) : event.title;
  }

  eventDetail(event: MaritimeEvent): string {
    const ar: Record<string, string> = {
      'Movement anomaly correlated with unresolved inspection deficiency and certificate condition.': 'تم ربط نمط حركة غير اعتيادي بملاحظة تفتيش غير مغلقة وشرط قائم على إحدى الشهادات.',
      'MOEI record and external classification source require verification.': 'يوجد اختلاف بين سجل الوزارة ومصدر التصنيف الخارجي ويستلزم التحقق.',
      'Risk threshold exceeded due to inspection and certificate indicators.': 'تم تجاوز حد المخاطر نتيجة مؤشرات التفتيش والشهادات.',
      'Observed route differs from expected arrival corridor.': 'المسار المرصود يختلف عن مسار الوصول المتوقع.',
      'Certificate validity window entered the configured monitoring threshold.': 'دخلت صلاحية الشهادة ضمن حد المراقبة المهيأ.'
    };
    return this.lang.isArabic ? (ar[event.detail] || event.detail) : event.detail;
  }

  ngOnInit(): void {
    this.selectedVessel = this.vessels[0];

    this.timer = setInterval(() => {
      this.now = new Date();
      if (this.feedLive) this.moveVessels();
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

    L.polygon(
      [[26.40,51.85],[26.55,53.65],[26.15,55.45],[25.55,55.25],[24.45,54.70],[23.65,53.25],[23.90,51.95]],
      { color:'#0f766e', weight:1.6, dashArray:'8 7', fillColor:'#14b8a6', fillOpacity:0.045 }
    ).bindTooltip(this.copy('Gulf Monitoring Area', 'منطقة مراقبة الخليج'), { sticky:true }).addTo(this.map);

    L.polygon(
      [[25.75,56.20],[25.80,56.95],[24.75,57.05],[24.20,56.58],[24.45,56.12]],
      { color:'#0284c7', weight:1.6, dashArray:'8 7', fillColor:'#38bdf8', fillOpacity:0.04 }
    ).bindTooltip(this.copy('East Coast Monitoring Area', 'منطقة مراقبة الساحل الشرقي'), { sticky:true }).addTo(this.map);

    this.resetMapView();
    this.refreshMapMarkers();
    this.drawSelectedTrack();
  }

  private moveVessels(): void {
    this.vessels = this.vessels.map((vessel, index) => {
      const route = SEA_ROUTES[vessel.routeKey];
      if (!route || route.length < 2) return vessel;

      let direction: RouteDirection = vessel.direction;
      let segmentIndex = vessel.segmentIndex;
      let nextIndex = segmentIndex + direction;

      if (nextIndex >= route.length || nextIndex < 0) {
        direction = direction === 1 ? -1 : 1;
        nextIndex = segmentIndex + direction;
      }

      const target = route[nextIndex];
      const latDiff = target[0] - vessel.lat;
      const lngDiff = target[1] - vessel.lng;
      const distance = Math.hypot(latDiff, lngDiff);
      const visualStep = Math.min(0.075, Math.max(0.022, vessel.speed / 330));

      let lat = vessel.lat + latDiff * visualStep;
      let lng = vessel.lng + lngDiff * visualStep;

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
        ...vessel,
        lat,
        lng,
        course: this.bearing(lat, lng, future[0], future[1]),
        segmentIndex,
        direction,
        lastUpdate: 2 + ((vessel.lastUpdate + index) % 12)
      };
    });

    if (this.selectedVessel) {
      this.selectedVessel = this.vessels.find(vessel => vessel.id === this.selectedVessel?.id);
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

  get filteredVessels(): NmcVesselProfile[] {
    const query = this.searchTerm.trim().toLowerCase();
    return this.vessels.filter(vessel => {
      const matchesSearch = !query || [vessel.name, vessel.imo, vessel.destination, vessel.flag]
        .some(value => value.toLowerCase().includes(query));
      const matchesRisk = this.riskFilter === 'All' || this.riskLevel(vessel.risk) === this.riskFilter;
      const matchesType = this.typeFilter === 'All' || vessel.type === this.typeFilter;
      return matchesSearch && matchesRisk && matchesType;
    });
  }

  get attentionVessels(): NmcVesselProfile[] {
    return [...this.vessels]
      .filter(vessel => vessel.risk >= 45)
      .sort((a,b) => b.risk - a.risk)
      .slice(0, 6);
  }

  get vesselTypes(): string[] {
    return ['All', ...Array.from(new Set(this.vessels.map(vessel => vessel.type))).sort()];
  }

  get monitoredCount(): number { return this.vessels.length; }
  get attentionCount(): number { return this.vessels.filter(vessel => vessel.risk >= 45).length; }
  get highRiskCount(): number { return this.vessels.filter(vessel => vessel.risk >= 65).length; }
  get criticalCount(): number { return this.vessels.filter(vessel => vessel.risk >= 85).length; }

  riskLevel(score: number): RiskLevel {
    return riskLevel(score);
  }

  riskClass(score: number): string {
    return riskLevel(score).toLowerCase();
  }

  selectVessel(vessel: NmcVesselProfile, fly = true): void {
    this.selectedVessel = vessel;
    this.refreshMapMarkers();
    this.drawSelectedTrack();

    if (fly && this.map) {
      this.map.flyTo([vessel.lat, vessel.lng], Math.max(this.map.getZoom(), 8), { duration: 0.7 });
    }
  }

  openVessel(vessel: NmcVesselProfile): void {
    this.selectedVessel = vessel;
    void this.router.navigate(['/moei/nmc/vessel', vessel.imo]);
  }

  toggleFeed(): void {
    this.feedLive = !this.feedLive;
  }

  onFilterChange(): void {
    this.refreshMapMarkers();
  }

  resetMapView(): void {
    this.map?.fitBounds(L.latLngBounds([[23.35,51.55],[26.75,57.05]]), { padding:[16,16] });
  }

  private refreshMapMarkers(): void {
    if (!this.map) return;

    const visibleIds = new Set(this.filteredVessels.map(vessel => vessel.id));

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
          <span>IMO ${vessel.imo} · ${this.flagLabel(vessel.flag)} · ${this.vesselTypeLabel(vessel.type)}</span>
          <span>${vessel.speed.toFixed(1)} ${this.copy('kn', 'عقدة')} · ${vessel.destination}</span>
          <b>${this.copy('Risk', 'المخاطر')} ${vessel.risk} · ${this.riskLabel(vessel.risk)}</b>
        </div>`,
        { direction:'top', offset:[0,-18], opacity:1 }
      );

      marker.on('click', () => this.openVessel(vessel));
      marker.addTo(this.map);
      this.markers.set(vessel.id, marker);
    }
  }

  private createVesselIcon(vessel: NmcVesselProfile): L.DivIcon {
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
          ${vessel.risk >= 65 ? `<span class="ship-label">${vessel.name}<b>${vessel.risk}</b></span>` : ''}
        </div>
      `,
      iconSize:[52,52],
      iconAnchor:[26,26]
    });
  }

  private drawSelectedTrack(): void {
    if (!this.map || !this.selectedVessel) return;
    if (this.selectedTrack) this.selectedTrack.removeFrom(this.map);

    const route = SEA_ROUTES[this.selectedVessel.routeKey];
    if (!route) return;

    this.selectedTrack = L.polyline(route, {
      color:'#0f766e',
      weight:3,
      opacity:0.72,
      dashArray:'9 7'
    }).bindTooltip(
      this.copy(
        `Monitored route to ${this.selectedVessel.destination}`,
        `المسار المراقب إلى ${this.selectedVessel.destination}`
      ),
      { sticky:true }
    ).addTo(this.map);
  }
}
