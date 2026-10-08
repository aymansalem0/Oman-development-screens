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
import { Subscription } from 'rxjs';
import { NmcFleetAiService, FleetAiSnapshot, FleetAiVessel } from '../services/nmc-fleet-ai.service';
import { NmcVesselEvidenceService } from '../services/nmc-vessel-evidence.service';
import { Router, RouterLink } from '@angular/router';
import * as L from 'leaflet';
import {
  NmcVesselProfile,
  RiskLevel,
  RouteDirection,
  SEA_ROUTES
} from '../data/nmc-vessel-catalog';
import { NMC_OPERATIONAL_VESSELS } from '../data/nmc-expanded-vessel-catalog';
import { LanguageService } from '../services/language.service';
import { NmcRiskEngineService } from '../services/nmc-risk-engine.service';

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

  vessels: NmcVesselProfile[] = NMC_OPERATIONAL_VESSELS.map(vessel => ({ ...vessel, risk: -1 }));
  fleetSnapshot: FleetAiSnapshot | null = null;
  fleetError = '';
  fleetInfo = '';
  fleetToken = '';
  fleetSubmitting = false;
  attentionPage = 1;
  readonly attentionPageSize = 6;

  readonly trafficSnapshot = {
    totalContacts: 420,
    insideUaeMonitoredArea: 265,
    approachingUaeArea: 155,
    correlatedProfiles: NMC_OPERATIONAL_VESSELS.length,
    source: 'AIS / LRIT traffic layer',
    snapshotTime: '22:42:18'
  };

  events: MaritimeEvent[] = [];

  private timer?: ReturnType<typeof setInterval>;
  private map?: L.Map;
  private markers = new Map<number, L.Marker>();
  private selectedTrack?: L.Polyline;
  private lastInteractiveVesselId?: number;
  private riskSubscription?: Subscription;
  private fleetPoller?: ReturnType<typeof setInterval>;

  constructor(
    private router: Router,
    public lang: LanguageService,
    private riskEngine: NmcRiskEngineService,
    private readonly fleetAi: NmcFleetAiService,
    private readonly vesselEvidence: NmcVesselEvidenceService
  ) {}

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
    if(score<0)return this.copy('Pending AI','بانتظار AI');
    const level = this.riskLevel(score) as RiskLevel;
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
      'Critical open finding in POC': 'مخالفة حرجة مفتوحة في السيناريو التجريبي',
      'AI fleet risk evaluated': 'اكتمل تقييم مخاطر السفينة بواسطة AI',
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
    this.riskSubscription = this.riskEngine.config$.subscribe(() => this.loadFleet());
    this.fleetPoller = setInterval(() => this.loadFleet(), 7000);

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
    this.riskSubscription?.unsubscribe();
    if(this.fleetPoller)clearInterval(this.fleetPoller);
    this.fleetToken='';
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
      let targetLat = target[0];
      let targetLng = target[1];

      if (vessel.id > 30) {
        const segmentStart = route[segmentIndex];
        const dLat = target[0] - segmentStart[0];
        const dLng = target[1] - segmentStart[1];
        const segmentLength = Math.max(0.0001, Math.hypot(dLat, dLng));
        const laneOffset = (((vessel.id * 29) % 17) - 8) * 0.0065;
        targetLat += (-dLng / segmentLength) * laneOffset;
        targetLng += (dLat / segmentLength) * laneOffset;
      }

      const latDiff = targetLat - vessel.lat;
      const lngDiff = targetLng - vessel.lng;
      const distance = Math.hypot(latDiff, lngDiff);
      const visualStep = Math.min(0.075, Math.max(0.022, vessel.speed / 330));

      let lat = vessel.lat + latDiff * visualStep;
      let lng = vessel.lng + lngDiff * visualStep;

      if (distance < 0.012) {
        lat = targetLat;
        lng = targetLng;
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

  private fleetResult(v: NmcVesselProfile): FleetAiVessel | undefined {
    return this.fleetSnapshot?.results[v.imo];
  }
  get assessedCount():number{return this.vessels.filter(v=>v.risk>=0).length;}
  get pendingCount():number{return 420-this.assessedCount;}
  get priorityReviewCount():number{
    return this.vessels.filter(v=>v.risk>=0&&this.fleetResult(v)?.operationalPriority==='Priority Review').length;
  }
  get fleetJobRunning():boolean{return this.fleetSnapshot?.job?.status==='RUNNING';}
  get fleetProgress():string{
    const j=this.fleetSnapshot?.job;
    return j?j.completed+' completed · '+j.failed+' failed / '+j.total:'';
  }
  private loadFleet():void{
    this.fleetAi.snapshot().subscribe({
      next:snapshot=>{
        this.fleetSnapshot=snapshot;this.fleetError='';
        const currentVersion=this.riskEngine.config.version;
        const selectedId=this.selectedVessel?.id;
        this.vessels=this.vessels.map(v=>{
          const row=snapshot.results[v.imo];
          const risk=row?.status==='COMPLETED'&&row.configVersion===currentVersion&&Number.isFinite(row.score)
            ?Number(row.score):-1;
          return {...v,risk};
        });
        this.selectedVessel=this.vessels.find(v=>v.id===selectedId)||this.vessels[0];
        this.attentionPage=Math.min(this.attentionPage,this.attentionPageCount);
        this.events=Object.values(snapshot.results)
          .filter(r=>r.status==='COMPLETED'&&r.configVersion===currentVersion&&r.assessedAt)
          .sort((a,b)=>String(b.assessedAt).localeCompare(String(a.assessedAt)))
          .slice(0,5).map((r):MaritimeEvent=>({
            time:new Date(r.assessedAt!).toLocaleTimeString('en-GB',{hour12:false}),
            vessel:this.vessels.find(v=>v.imo===r.imo)?.name||r.imo,
            title:r.criticalOpenFinding?'Critical open finding in POC':'AI fleet risk evaluated',
            detail:(r.operationalPriority||'Routine')+' · '+r.level+' '+r.score+'/100 · synthetic evidence',
            severity:r.criticalOpenFinding?'critical':r.level==='Critical'?'critical':r.level==='High'?'high':'info'
          }));
        this.refreshMapMarkers();
      },
      error:err=>{this.fleetError=err?.error?.error||'Fleet AI API unavailable';}
    });
  }
  runFleetBatch(size:10|420):void{
    if(this.fleetSubmitting||this.fleetJobRunning)return;
    if(this.fleetToken.trim().length<24){
      this.fleetError=this.copy('Enter the local admin token (at least 24 characters).',
        'أدخل رمز الإدارة المحلي (24 حرفًا على الأقل).');return;
    }
    if(!window.confirm(this.copy(
      'Analyze '+size+' synthetic vessels? Up to '+size*2+' paid Airia agent calls. No regulatory action.',
      'تحليل '+size+' سفينة تجريبية؟ حتى '+size*2+' استدعاء مدفوع لوكلاء Airia. دون إجراء تنظيمي.'
    )))return;
    this.fleetSubmitting=true;this.fleetError='';this.fleetInfo='';
    const bundles=NMC_OPERATIONAL_VESSELS.slice(0,size).map(v=>this.vesselEvidence.create(v));
    this.fleetAi.start(bundles,this.riskEngine.config,this.fleetToken.trim()).subscribe({
      next:r=>{this.fleetSubmitting=false;
        this.fleetInfo=this.copy('Batch queued: ','تم بدء الدفعة: ')+r.total+' / '+r.estimatedAiriaCalls+' calls max';
        this.loadFleet();},
      error:err=>{this.fleetSubmitting=false;this.fleetError=err?.error?.error||'FLEET_BATCH_START_FAILED';}
    });
  }
  cancelFleetBatch():void{
    if(!this.fleetJobRunning||!this.fleetToken.trim())return;
    this.fleetAi.cancel(this.fleetToken.trim()).subscribe({
      next:()=>{this.fleetInfo='Cancellation requested';this.loadFleet();},
      error:err=>this.fleetError=err?.error?.error||'FLEET_BATCH_CANCEL_FAILED'
    });
  }
  riskDisplay(v:NmcVesselProfile):string{return v.risk<0?'—':String(v.risk);}

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

  get allAttentionVessels(): NmcVesselProfile[] {
    return [...this.vessels]
      .filter(v=>v.risk>=0&&(this.riskLevel(v.risk)!=='Normal'||this.fleetResult(v)?.operationalPriority==='Priority Review'))
      .sort((a,b)=>Number(this.fleetResult(b)?.operationalPriority==='Priority Review')-
        Number(this.fleetResult(a)?.operationalPriority==='Priority Review')||b.risk-a.risk);
  }

  get attentionVessels(): NmcVesselProfile[] {
    const start = (this.attentionPage - 1) * this.attentionPageSize;
    return this.allAttentionVessels.slice(start, start + this.attentionPageSize);
  }

  get attentionPageCount(): number {
    return Math.max(1, Math.ceil(this.allAttentionVessels.length / this.attentionPageSize));
  }

  get attentionPageNumbers(): number[] {
    const total = this.attentionPageCount;
    const start = Math.max(1, Math.min(this.attentionPage - 2, total - 4));
    const end = Math.min(total, start + 4);
    return Array.from({ length: end - start + 1 }, (_, index) => start + index);
  }

  get attentionRangeStart(): number {
    return this.allAttentionVessels.length === 0 ? 0 : (this.attentionPage - 1) * this.attentionPageSize + 1;
  }

  get attentionRangeEnd(): number {
    return Math.min(this.attentionPage * this.attentionPageSize, this.allAttentionVessels.length);
  }

  attentionRank(indexOnPage: number): number {
    return (this.attentionPage - 1) * this.attentionPageSize + indexOnPage + 1;
  }

  setAttentionPage(page: number): void {
    this.attentionPage = Math.min(Math.max(page, 1), this.attentionPageCount);
  }

  previousAttentionPage(): void {
    this.setAttentionPage(this.attentionPage - 1);
  }

  nextAttentionPage(): void {
    this.setAttentionPage(this.attentionPage + 1);
  }

  private syncAttentionPageForVessel(vessel: NmcVesselProfile): void {
    if(vessel.risk<0||this.riskLevel(vessel.risk)==='Normal')return;
    const index = this.allAttentionVessels.findIndex(item => item.id === vessel.id);
    if (index >= 0) this.attentionPage = Math.floor(index / this.attentionPageSize) + 1;
  }

  get vesselTypes(): string[] {
    return ['All', ...Array.from(new Set(this.vessels.map(vessel => vessel.type))).sort()];
  }

  get monitoredCount(): number { return this.trafficSnapshot.totalContacts; }
  get correlatedProfileCount(): number { return this.trafficSnapshot.correlatedProfiles; }
  get attentionCount():number{return this.allAttentionVessels.length;}
  get highRiskCount():number{return this.vessels.filter(v=>v.risk>=0&&['High','Critical'].includes(this.riskLevel(v.risk))).length;}
  get criticalCount():number{return this.vessels.filter(v=>v.risk>=0&&this.riskLevel(v.risk)==='Critical').length;}
  riskLevel(score:number):RiskLevel|'Pending'{return score<0?'Pending':this.riskEngine.levelForScore(score);}
  riskClass(score:number):string{return score<0?'pending':this.riskEngine.levelForScore(score).toLowerCase();}

  selectVessel(vessel: NmcVesselProfile, fly = true): void {
    this.selectedVessel = vessel;
    this.syncAttentionPageForVessel(vessel);
    this.refreshMapMarkers();
    this.drawSelectedTrack();

    if (fly && this.map) {
      this.map.flyTo([vessel.lat, vessel.lng], Math.max(this.map.getZoom(), 9), { duration: 0.7 });
    }
  }

  handleVesselInteraction(vessel: NmcVesselProfile): void {
    const current = this.vessels.find(item => item.id === vessel.id) ?? vessel;
    const isSecondClickOnFocusedVessel =
      this.lastInteractiveVesselId === current.id &&
      this.selectedVessel?.id === current.id;

    if (isSecondClickOnFocusedVessel) {
      this.openVessel(current);
      return;
    }

    this.lastInteractiveVesselId = current.id;
    this.selectVessel(current, true);
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
    this.map?.fitBounds(L.latLngBounds([[23.35,51.55],[26.75,57.75]]), { padding:[16,16] });
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
        existing.setTooltipContent(this.tooltipFor(vessel));
        continue;
      }

      const marker = L.marker([vessel.lat, vessel.lng], {
        icon: this.createVesselIcon(vessel),
        keyboard: true,
        riseOnHover: true
      });

      marker.bindTooltip(this.tooltipFor(vessel), {direction:'top',offset:[0,-18],opacity:1});

      marker.on('click', () => this.handleVesselInteraction(vessel));
      marker.addTo(this.map);
      this.markers.set(vessel.id, marker);
    }
  }

  private tooltipFor(v:NmcVesselProfile):string{
    return '<div class="map-vessel-tooltip"><strong>'+v.name+'</strong>'+
      '<span>IMO '+v.imo+' · '+this.flagLabel(v.flag)+' · '+this.vesselTypeLabel(v.type)+'</span>'+
      '<span>'+v.speed.toFixed(1)+' kn · '+v.destination+'</span>'+
      '<b>'+this.copy('AI Risk','مخاطر AI')+' '+this.riskDisplay(v)+' · '+this.riskLabel(v.risk)+'</b></div>';
  }
  private createVesselIcon(vessel: NmcVesselProfile): L.DivIcon {
    const level = this.riskClass(vessel.risk);
    const selected = this.selectedVessel?.id === vessel.id ? 'selected' : '';
    const isSelected = this.selectedVessel?.id === vessel.id;
    const shipSize = isSelected
      ? Math.round(Math.max(17, Math.min(28, 14 + vessel.lengthM / 25)))
      : Math.round(Math.max(10, Math.min(18, 9 + vessel.lengthM / 42)));
    const ringSize = shipSize + (isSelected ? 14 : 8);

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
          ${isSelected || this.riskLevel(vessel.risk) === 'Critical' ? `<span class="ship-label">${vessel.name}<b>${this.riskDisplay(vessel)}</b></span>` : ''}
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
