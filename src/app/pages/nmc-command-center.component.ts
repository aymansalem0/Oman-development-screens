import { NmcNavigationComponent } from '../components/nmc-navigation.component';
import { NmcPlatformHeaderComponent, NmcPlatformFooterComponent } from '../components/nmc-platform-chrome.component';
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
import { Router, RouterLink } from '@angular/router';
import * as L from 'leaflet/dist/leaflet-src.esm.js';
import {
  NmcVesselProfile,
  RiskLevel,
  RouteDirection,
  SEA_ROUTES
} from '../data/nmc-vessel-catalog';
import { NMC_OPERATIONAL_VESSELS } from '../data/nmc-expanded-vessel-catalog';
import { LanguageService } from '../services/language.service';
import { NmcRiskEngineService } from '../services/nmc-risk-engine.service';
import { NmcAlertsService } from '../services/nmc-alerts.service';
import { NmcCasesService } from '../services/nmc-cases.service';
import {NmcIncidentsService,NmcMaritimeIncident} from '../services/nmc-incidents.service';
import {NmcAiFocusService, NmcAiFocusResult, NmcKpiValues,
  NmcKpiMetricId} from '../services/nmc-ai-focus.service';
import {incidentSeverityBand as verifiedIncidentBand, isActiveNmcIncident,
  vesselMatchesIncidentFilter, type NmcIncidentFilter} from '../services/nmc-incident-filters';

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
  imports: [CommonModule, FormsModule, RouterLink, NmcNavigationComponent, NmcPlatformHeaderComponent, NmcPlatformFooterComponent],
  templateUrl: './nmc-command-center.component.html',
  styleUrl: './nmc-command-center.component.css'
})
export class NmcCommandCenterComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('mapContainer', { static: false }) mapContainer?: ElementRef<HTMLDivElement>;

  searchTerm = '';
  riskFilter = 'All';
  assessmentFilter: 'All' | 'Assessed' | 'Pending' = 'All';
  typeFilter = 'All';
  /** One shared incident filter for map markers and the Requires Attention queue. */
  incidentFilter:NmcIncidentFilter='All';
  feedLive = true;
  /** AI picks ONE review focus; no KPI is colored as AI-prioritized until
   *  an explicit operator request returns a verified selection. */
  aiKpiFocus:NmcAiFocusResult|null=null;
  aiKpiFocusAvailable=false;
  aiKpiFocusContextReady=false;
  aiKpiFocusStatusLoaded=false;
  aiKpiFocusBusy=false;
  aiKpiFocusError='';
  /** Session-only confirmation that the UI view was reset, not business data. */
  dashboardResetNotice='';
  selectedVessel?: NmcVesselProfile;
  now = new Date();

  vessels: NmcVesselProfile[] = NMC_OPERATIONAL_VESSELS.map(vessel => ({ ...vessel, risk: -1 }));
  fleetSnapshot: FleetAiSnapshot | null = null;
  fleetError = '';
  unreadAlertCount = 0;
  activeAlertCount: number | null = null;
  openCaseCount: number | null = null;
  incidentCount:number|null=null;
  activeIncidentCount:number|null=null;
  criticalIncidentCount:number|null=null;
  incidentSourceError=false;
  incidentFeedLastUpdatedAt:string|null=null;
  incidentFeedRefreshing=false;
  incidentSourceMessage='';
  incidentRejectedRowsCount=0;
  /** Complete source rows indexed by IMO. No simulated severity or vessel risk is substituted. */
  readonly activeIncidentsByImo=new Map<string,NmcMaritimeIncident[]>();
  expandedIncidentImo:string|null=null;

  attentionPage = 1;
  readonly attentionPageSize = 6;

  readonly trafficSnapshot = {
    totalContacts: 420,
    insideUaeMonitoredArea: 265,
    approachingUaeArea: 155,
    correlatedProfiles: NMC_OPERATIONAL_VESSELS.length,
    source: 'Synthetic AIS / LRIT fixture',
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
  private alertPoller?: ReturnType<typeof setInterval>;
  private fleetLoadInFlight = false;
  private pendingDatabaseFetch = false;
  latestDatabaseFetchAt: string | null = null;
  fetchingSaved = false;

  constructor(
    private router: Router,
    public lang: LanguageService,
    private riskEngine: NmcRiskEngineService,
    private readonly fleetAi: NmcFleetAiService,
    private readonly alertsService: NmcAlertsService,
    private readonly casesService: NmcCasesService,
    private readonly incidentsService:NmcIncidentsService,
    private readonly aiKpi:NmcAiFocusService
  ) {}

  copy(en: string, ar: string): string {
    return this.lang.pick(en, ar);
  }

  refreshMapForLanguage(): void {

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

  riskLabel(score: number, imo?: string): string {
    if(score<0)return this.copy('Pending AI','بانتظار AI');
    const level = this.riskLevel(score, imo) as RiskLevel;
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
    // Configuration GET is free and never starts Airia.
    this.aiKpi.status().subscribe({
      next:r=>{
        this.aiKpiFocusAvailable=r.configured&&r.assessmentContextReady;
        this.aiKpiFocusContextReady=r.assessmentContextReady;
        this.aiKpiFocusStatusLoaded=true;
      },
      error:()=>{
        this.aiKpiFocusAvailable=false;this.aiKpiFocusContextReady=false;
        this.aiKpiFocusStatusLoaded=true;
      }
    });
    this.riskSubscription = this.riskEngine.config$.subscribe(() => {
      this.loadFleet();  // Saved fleet results remain the original Oracle snapshot.
      this.loadOperations(); // Browser policy changes immediately refresh locally eligible alerts.
    });
    this.fleetPoller = setInterval(() => this.loadFleet(), 7000);
    this.loadOperations();
    this.alertPoller=setInterval(()=>this.loadOperations(),30000);

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
    if(this.alertPoller)clearInterval(this.alertPoller);
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

    this.resetMapBounds();
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
  // Aggregate counters are authoritative server-side fleet snapshot counts, not locally recalculated scores.
  get assessedCount():number{return this.fleetSnapshot?.counts.assessed ?? 0;}
  get pendingCount():number{return this.fleetSnapshot?.counts.pending ?? 420;}
  get priorityReviewCount():number{return this.fleetSnapshot?.counts.priorityReview ?? 0;}
  get fleetJobRunning():boolean{return this.fleetSnapshot?.job?.status==='RUNNING';}
  get fleetProgress():string{
    const j=this.fleetSnapshot?.job;
    return j?j.completed+' completed · '+j.failed+' failed / '+j.total:'';
  }
  /** A source incident belongs to a vessel only with an exact 7-digit IMO match. */
  incidentsForVessel(imo:string):NmcMaritimeIncident[]{
    return this.activeIncidentsByImo.get(imo)||[];
  }
  hasActiveIncidents(imo:string):boolean{
    return this.incidentsForVessel(imo).length>0;
  }
  /** Count distinct catalogued vessels, never count two reports for one IMO twice. */
  get incidentVesselCount():number{
    return this.vessels.filter(v=>this.hasActiveIncidents(v.imo)).length;
  }
  private matchesIncidentFilter(imo:string):boolean{
    return vesselMatchesIncidentFilter(this.incidentFilter,this.incidentsForVessel(imo));
  }
  incidentFilterLabel():string{
    switch(this.incidentFilter){
      case 'Active':return this.copy('Active incidents','حوادث نشطة');
      case 'Critical':return this.copy('Critical incidents (AI or reported)','حوادث حرجة (AI أو بلاغ)');
      case 'High':return this.copy('High incidents (AI or reported)','حوادث مرتفعة (AI أو بلاغ)');
      case 'PendingReview':return this.copy('Pending human review','بانتظار المراجعة البشرية');
      case 'None':return this.copy('No active incidents','لا توجد حوادث نشطة');
      default:return this.copy('All incident statuses','جميع حالات الحوادث');
    }
  }
  setIncidentFilter(value:NmcIncidentFilter):void{
    this.incidentFilter=value;
    this.attentionPage=1;
    this.onFilterChange();
  }
  toggleVesselIncidents(imo:string):void{
    this.expandedIncidentImo=this.expandedIncidentImo===imo?null:imo;
  }
  /** AI assessed vs source-reported incident severity remains distinct. */
  incidentSeverityBand(row:NmcMaritimeIncident):'CRITICAL'|'HIGH'|'MODERATE'|'LOW'|'UNASSESSED'{
    return verifiedIncidentBand(row);
  }
  incidentSeverityRank(row:NmcMaritimeIncident):number{
    const band=this.incidentSeverityBand(row);
    return ({CRITICAL:4,HIGH:3,MODERATE:2,LOW:1,UNASSESSED:0})[band];
  }
  incidentRepresentative(imo:string):NmcMaritimeIncident|undefined{
    return this.incidentsForVessel(imo)[0];
  }
  incidentClass(imo:string):string{
    const incident=this.incidentRepresentative(imo);
    return incident?'incident-'+this.incidentSeverityBand(incident).toLowerCase():'';
  }
  incidentSourceIsAI(row:NmcMaritimeIncident):boolean{
    return !!row.aiAssessment&&!row.aiAssessmentStale;
  }
  incidentBandLabel(imo:string):string{
    const row=this.incidentRepresentative(imo);
    if(!row)return '';
    const band=this.incidentSeverityBand(row);
    return (this.incidentSourceIsAI(row)?'AI ':'Reported ')+band;
  }
  /** Show incident-only cases in the attention queue even when A01/A02 is Pending. */
  private hasSavedFleetAttention(v:NmcVesselProfile):boolean{
    return v.risk>=0&&(
      this.riskLevel(v.risk,v.imo)!=='Normal'||
      this.fleetResult(v)?.operationalPriority==='Priority Review');
  }
  private loadOperations():void{
    this.alertsService.overviewForBrowserPolicy().subscribe({
      next:response=>{
        this.unreadAlertCount=response.summary.unread;
        this.activeAlertCount=response.summary.active;
      },
      error:()=>{this.unreadAlertCount=0;this.activeAlertCount=null;}
    });
    this.incidentFeedRefreshing=true;
    this.incidentsService.list().subscribe({
      next:r=>{
        this.incidentFeedRefreshing=false;
        this.incidentCount=r.summary.total;
        this.activeIncidentCount=r.summary.unresolved;
        this.criticalIncidentCount=r.incidents.filter(v=>
          ['HIGH','CRITICAL'].includes(v.aiAssessment?.incidentRiskBand||'')).length;
        this.incidentSourceError=false;
        this.incidentSourceMessage='';
        this.incidentRejectedRowsCount=r.sourceValidationWarnings||0;
        this.incidentFeedLastUpdatedAt=new Date().toISOString();
        const grouped=new Map<string,NmcMaritimeIncident[]>();
        for(const report of r.incidents){
          // Closed/resolved incident history remains in Incident Intelligence,
          // but does not raise the vessel's ACTIVE incident flag on the map.
          if(!isActiveNmcIncident(report))continue;
          if(!report.imo||!(/^[0-9]{7}$/).test(report.imo))continue;
          const bucket=grouped.get(report.imo)||[];
          bucket.push(report);
          grouped.set(report.imo,bucket);
        }
        this.activeIncidentsByImo.clear();
        for(const [imo,rows] of grouped){
          rows.sort((left,right)=>
            this.incidentSeverityRank(right)-this.incidentSeverityRank(left)||
            (right.reportedAt||right.receivedAt||'').localeCompare(left.reportedAt||left.receivedAt||''));
          this.activeIncidentsByImo.set(imo,rows);
        }
        if(this.expandedIncidentImo&&!this.hasActiveIncidents(this.expandedIncidentImo))
          this.expandedIncidentImo=null;
        this.attentionPage=Math.min(this.attentionPage,this.attentionPageCount);
        this.onFilterChange();
      },
      error:err=>{
        this.incidentFeedRefreshing=false;
        this.incidentCount=null;this.activeIncidentCount=null;
        this.criticalIncidentCount=null;this.incidentSourceError=true;
        // Fail closed: never display stale incident markers as if confirmed.
        this.activeIncidentsByImo.clear();
        this.expandedIncidentImo=null;
        this.onFilterChange();
        this.incidentSourceMessage=this.incidentsService.message(err,this.lang.isArabic);
      }
    });
    this.casesService.list().subscribe({
      next:response=>this.openCaseCount=response.cases.filter(c=>c.status!=='RESOLVED').length,
      error:()=>this.openCaseCount=null
    });
  }
  /** Saved Oracle-backed assessments are displayed using the ruleset that actually produced them.
   *  Browser-local Risk Management drafts MUST NOT hide stored scores or reclassify them. */
  private hasSavedScore(row?: FleetAiVessel): boolean {
    return row?.status==='COMPLETED' && typeof row.score==='number' &&
      Number.isFinite(row.score) && row.score>=0 && row.score<=100 &&
      ['Normal','Watch','High','Critical'].includes(row.level||'');
  }
  private loadFleet(fromDatabase=false):void{
    if(this.fleetLoadInFlight){
      // An explicit Fetch Again cannot be silently dropped by the 7s poll.
      if(fromDatabase)this.pendingDatabaseFetch=true;
      return;
    }
    this.fleetLoadInFlight=true;
    if(fromDatabase)this.fetchingSaved=true;
    const request=fromDatabase?this.fleetAi.fetchSaved():this.fleetAi.snapshot();
    request.subscribe({
      next:snapshot=>{
        this.fleetLoadInFlight=false;
        this.fetchingSaved=false;
        this.fleetSnapshot=snapshot;this.fleetError='';
        if(fromDatabase)this.latestDatabaseFetchAt=new Date().toISOString();
        const selectedId=this.selectedVessel?.id;
        this.vessels=this.vessels.map(v=>{
          const row=snapshot.results[v.imo];
          return {...v,risk:this.hasSavedScore(row)?Number(row!.score):-1};
        });
        // A screen refresh or polling must never auto-select the first vessel.
        this.selectedVessel=selectedId===undefined?undefined:this.vessels.find(v=>v.id===selectedId);
        this.attentionPage=Math.min(this.attentionPage,this.attentionPageCount);
        this.events=Object.values(snapshot.results)
          .filter(r=>this.hasSavedScore(r)&&r.assessedAt)
          .sort((a,b)=>String(b.assessedAt).localeCompare(String(a.assessedAt)))
          .slice(0,5).map((r):MaritimeEvent=>({
            time:new Date(r.assessedAt!).toLocaleTimeString('en-GB',{hour12:false}),
            vessel:this.vessels.find(v=>v.imo===r.imo)?.name||r.imo,
            title:r.criticalOpenFinding?'Critical open finding in POC':'AI fleet risk evaluated',
            detail:(r.operationalPriority||'Routine')+' · '+r.level+' '+r.score+'/100 · synthetic evidence',
            severity:r.criticalOpenFinding?'critical':r.level==='Critical'?'critical':r.level==='High'?'high':'info'
          }));
        this.refreshMapMarkers();
        if(this.pendingDatabaseFetch){this.pendingDatabaseFetch=false;this.loadFleet(true);}
      },
      error:err=>{
        this.fleetLoadInFlight=false;
        this.fetchingSaved=false;
        // Failed database retrieval must never clear the last good map, priority queue or vessel selection.
        this.fleetError=err?.error?.error||'Fleet AI API unavailable';
        if(this.pendingDatabaseFetch){this.pendingDatabaseFetch=false;this.loadFleet(true);}
      }
    });
  }
  fetchAgain():void{this.loadFleet(true);this.loadOperations();}
  riskDisplay(v:NmcVesselProfile):string{return v.risk<0?'—':String(v.risk);}

  get filteredVessels(): NmcVesselProfile[] {
    const query = this.searchTerm.trim().toLowerCase();
    return this.vessels.filter(vessel => {
      const matchesSearch = !query || [vessel.name, vessel.imo, vessel.destination, vessel.flag]
        .some(value => value.toLowerCase().includes(query));
      const matchesRisk = this.riskFilter === 'All' || this.riskLevel(vessel.risk, vessel.imo) === this.riskFilter;
      // An AI-assessed vessel requires a COMPLETED, validated saved A01/A02
      // assessment. Synthetic baseline risk and failed jobs never qualify.
      const assessed = this.hasSavedScore(this.fleetResult(vessel));
      const matchesAssessment = this.assessmentFilter === 'All' ||
        (this.assessmentFilter === 'Assessed' ? assessed : !assessed);
      const matchesType = this.typeFilter === 'All' || vessel.type === this.typeFilter;
      return matchesSearch && matchesRisk && matchesAssessment && matchesType &&
        this.matchesIncidentFilter(vessel.imo);
    });
  }

  get visibleMapCount(): number { return this.filteredVessels.length; }

  get allAttentionVessels(): NmcVesselProfile[] {
    return [...this.vessels]
      .filter(v=>(this.hasSavedFleetAttention(v)||this.hasActiveIncidents(v.imo))&&
        this.matchesIncidentFilter(v.imo))
      .sort((a,b)=>{
        // Active incident vessels must remain visible on the first attention
        // page; do not bury their buttons behind risk-only pagination.
        const aActive=Number(this.hasActiveIncidents(a.imo));
        const bActive=Number(this.hasActiveIncidents(b.imo));
        const aPriority=Number(this.fleetResult(a)?.operationalPriority==='Priority Review');
        const bPriority=Number(this.fleetResult(b)?.operationalPriority==='Priority Review');
        // Preserve existing ranked fleet priorities. Within each saved risk
        // tier, incident severity raises matters that need human attention.
        const aRisk=a.risk<0?0:a.risk,bRisk=b.risk<0?0:b.risk;
        const aIncident=this.incidentRepresentative(a.imo);
        const bIncident=this.incidentRepresentative(b.imo);
        const aRank=aIncident?this.incidentSeverityRank(aIncident):0;
        const bRank=bIncident?this.incidentSeverityRank(bIncident):0;
        return bActive-aActive || bRank-aRank || bPriority-aPriority || bRisk-aRisk;
      });
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
    if(!this.hasSavedFleetAttention(vessel)&&!this.hasActiveIncidents(vessel.imo))return;
    const index = this.allAttentionVessels.findIndex(item => item.id === vessel.id);
    if (index >= 0) this.attentionPage = Math.floor(index / this.attentionPageSize) + 1;
  }

  get vesselTypes(): string[] {
    return ['All', ...Array.from(new Set(this.vessels.map(vessel => vessel.type))).sort()];
  }

  /** Distinct, explicit business measures. Critical and High are NOT combined,
   *  and pending (the inverse of assessed) is deliberately not duplicated. */
  get dashboardKpis():Array<{id:NmcKpiMetricId;value:number|null;display:string;
      labelEn:string;labelAr:string;hintEn:string;hintAr:string;icon:string}>{
    const ready=!!this.fleetSnapshot;
    const asDisplay=(x:number|null)=>x===null?'—':x.toLocaleString('en-US');
    const assessed=ready?this.assessedCount:null;
    const total=this.fleetSnapshot?.fleetSize||this.trafficSnapshot.totalContacts;
    const values:Array<{id:NmcKpiMetricId;value:number|null;
      labelEn:string;labelAr:string;hintEn:string;hintAr:string;icon:string}>=[
      {id:'vesselContacts',value:this.monitoredCount,labelEn:'Monitored contacts',
        labelAr:'الأهداف البحرية المرصودة',hintEn:'Simulated AIS/LRIT traffic',
        hintAr:'حركة AIS/LRIT تجريبية',icon:'⌖'},
      {id:'assessedVessels',value:assessed,labelEn:'AI assessed vessels',
        labelAr:'السفن المقيمة بالذكاء الاصطناعي',hintEn:'Completed / fleet scope',
        hintAr:'مكتمل / إجمالي السفن',icon:'✦'},
      {id:'highRiskVessels',value:ready?(this.fleetSnapshot?.counts.high??null):null,
        labelEn:'High-risk vessels',labelAr:'سفن مرتفعة المخاطر',
        hintEn:'High only · excludes Critical',hintAr:'مرتفعة فقط دون الحرجة',icon:'▲'},
      {id:'criticalRiskVessels',value:ready?(this.fleetSnapshot?.counts.critical??null):null,
        labelEn:'Critical-risk vessels',labelAr:'سفن حرجة المخاطر',
        hintEn:'Based on saved risk policy',hintAr:'وفق سياسة المخاطر المحفوظة',icon:'!'},
      {id:'requiresAttention',value:ready?this.attentionCount:null,
        labelEn:'Vessels needing attention',labelAr:'سفن تتطلب المتابعة',
        hintEn:'Distinct vessels · risk or incidents',
        hintAr:'سفن مميزة · مخاطر أو حوادث',icon:'◎'},
      {id:'activeAlerts',value:this.activeAlertCount,
        labelEn:'Active maritime alerts',labelAr:'التنبيهات البحرية النشطة',
        hintEn:'Alert workflow records',hintAr:'سجلات التنبيهات التشغيلية',icon:'♢'},
      {id:'openCases',value:this.openCaseCount,
        labelEn:'Open maritime cases',labelAr:'الحالات البحرية المفتوحة',
        hintEn:'Central Case Management',hintAr:'إدارة الحالات المركزية',icon:'▣'},
      {id:'activeIncidents',value:this.activeIncidentCount,
        labelEn:'Unresolved incidents',labelAr:'الحوادث غير المغلقة',
        hintEn:'Source reports · not unique vessels',
        hintAr:'عدد البلاغات وليس عدد السفن',icon:'⚑'}
    ];
    return values.map(k=>({...k,
      display:k.id==='assessedVessels'&&k.value!==null
        ?asDisplay(k.value)+' / '+total:asDisplay(k.value)}));
  }
  dashboardKpiTrack(_index:number,k:{id:NmcKpiMetricId}):string{return k.id;}
  get dashboardKpiValues():NmcKpiValues{
    return Object.fromEntries(this.dashboardKpis.map(k=>[k.id,k.value])) as NmcKpiValues;
  }
  get aiFocusIsCurrent():boolean{
    const stored=this.aiKpiFocus;
    if(!stored)return false;
    const now=this.dashboardKpiValues;
    return Object.entries(stored.snapshot).every(([id,v])=>
      now[id as NmcKpiMetricId]===v);
  }
  aiFocusedKpi(id:NmcKpiMetricId):boolean{
    return this.aiFocusIsCurrent&&this.aiKpiFocus?.selection.metricId===id;
  }
  requestAiKpiFocus():void{
    if(this.aiKpiFocusBusy||!this.aiKpiFocusAvailable)return;
    this.dashboardResetNotice='';
    const values=this.dashboardKpiValues;
    if(Object.values(values).filter(v=>v!==null).length<5){
      this.aiKpiFocusError=this.copy(
        'Wait for the operational KPI data to load before requesting AI review.',
        'انتظر اكتمال تحميل المؤشرات التشغيلية قبل طلب مراجعة AI.');
      return;
    }
    const confirmed=window.confirm(this.copy(
      'Send these eight synthetic aggregate counts to the EXISTING A02 and A01 maritime-risk agents using the saved assessment of one representative vessel? This may incur TWO paid Airia requests (A02 then A01). The original response schemas remain unchanged. A KPI is highlighted only if A01 explicitly identifies one inside whyItMatters, with cited vessel evidence. Human review only; no risk, cases, alerts, tasks or incident data will change.',
      'هل تريد إرسال المؤشرات الثمانية التجريبية إلى الوكيلين البحريين الحاليين A02 ثم A01 اعتماداً على تقييم سفينة محفوظ؟ قد يستهلك ذلك استدعاءين مدفوعين من Airia. لن تتغير عقود الاستجابة؛ يميز النظام مؤشراً واحداً فقط إذا حدده A01 صراحةً داخل whyItMatters مع الاستشهاد بأدلة السفينة. النتيجة للمراجعة البشرية دون تغيير المخاطر أو الحالات أو التنبيهات أو المهام أو الحوادث.'
    ));
    if(!confirmed)return;
    this.aiKpiFocusBusy=true;this.aiKpiFocusError='';
    this.aiKpi.run(values).subscribe({
      next:result=>{this.aiKpiFocusBusy=false;this.aiKpiFocus=result;},
      error:e=>{this.aiKpiFocusBusy=false;this.aiKpiFocusError=
        this.aiKpi.readableError(e,this.lang.isArabic);}
    });
  }

  get monitoredCount(): number { return this.trafficSnapshot.totalContacts; }
  get correlatedProfileCount(): number { return this.trafficSnapshot.correlatedProfiles; }
  get attentionCount():number{return this.allAttentionVessels.length;}
  get highRiskCount():number{return (this.fleetSnapshot?.counts.high ?? 0)+(this.fleetSnapshot?.counts.critical ?? 0);}
  get criticalCount():number{return this.fleetSnapshot?.counts.critical ?? 0;}
  riskLevel(score:number, imo?:string):RiskLevel|'Pending'{
    if(score<0)return 'Pending';
    const saved=imo?this.fleetSnapshot?.results[imo]:undefined;
    return this.hasSavedScore(saved)?saved!.level!:this.riskEngine.levelForScore(score);
  }
  riskClass(score:number, imo?:string):string{return this.riskLevel(score,imo).toLowerCase();}

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
    this.dashboardResetNotice='';
    // Do not leave an out-of-filter vessel's route or Vessel 360 action
    // visible when the operator chooses AI Assessed Only.
    if(this.selectedVessel&&!this.filteredVessels.some(v=>v.id===this.selectedVessel?.id)){
      this.selectedVessel=undefined;
      this.lastInteractiveVesselId=undefined;
      this.drawSelectedTrack();
    }
    this.refreshMapMarkers();
  }

  /** Reset all dashboard UI state (unlike Map Reset, also clear AI focus,
   *  selected vessel, expanded incidents and animation pause).
   *  This calls the existing read-only map reset + saved-status reload.
   *  It must NEVER alter Oracle, incident sheets, policies or invoke Airia.
   *  In-flight paid AI requests cannot be cancelled by a cosmetic UI reset.
   */
  resetDashboardView():void{
    if(this.aiKpiFocusBusy)return;
    this.aiKpiFocus=null;
    this.aiKpiFocusError='';
    this.selectedVessel=undefined;
    this.lastInteractiveVesselId=undefined;
    this.expandedIncidentImo=null;
    this.feedLive=true;
    this.resetMapView();
    this.dashboardResetNotice=this.copy(
      'Dashboard view reset. Saved risk, cases and incidents are unchanged.',
      'تمت إعادة ضبط عرض لوحة القيادة. لم تتغير المخاطر والحالات والحوادث المحفوظة.'
    );
  }

  resetMapView(): void {
    // Map reset is presentation-only: do not clear saved risk, case state or chosen vessel.
    this.searchTerm='';this.riskFilter='All';this.assessmentFilter='All';this.typeFilter='All';
    this.incidentFilter='All';this.attentionPage=1;
    this.resetMapBounds();
    this.refreshMapMarkers();
    this.drawSelectedTrack();
    // Explicitly fetch up-to-date persisted scores and priority statuses.
    // The backend handles changed evidence on its own hourly schedule; no Airia call here.
    this.fetchAgain();
  }
  private resetMapBounds():void{
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
        continue;
      }

      const marker = L.marker([vessel.lat, vessel.lng], {
        icon: this.createVesselIcon(vessel),
        keyboard: true,
        riseOnHover: true
      });


      marker.on('click', () => this.handleVesselInteraction(vessel));
      marker.addTo(this.map);
      this.markers.set(vessel.id, marker);
    }
  }

  private createVesselIcon(vessel: NmcVesselProfile): L.DivIcon {
    const level = this.riskClass(vessel.risk,vessel.imo);
    const selected = this.selectedVessel?.id === vessel.id ? 'selected' : '';
    const isSelected = this.selectedVessel?.id === vessel.id;
    const shipSize = isSelected
      ? Math.round(Math.max(17, Math.min(28, 14 + vessel.lengthM / 25)))
      : Math.round(Math.max(10, Math.min(18, 9 + vessel.lengthM / 42)));
    const ringSize = shipSize + (isSelected ? 14 : 8);

    return L.divIcon({
      className: 'nmc-map-marker-wrap',
      html: `
        <div class="nmc-map-marker ${level} ${selected} ${this.incidentClass(vessel.imo)}" style="--ship-size:${shipSize}px;--ring-size:${ringSize}px">
          <span class="risk-ring"></span>
          ${this.hasActiveIncidents(vessel.imo)?'<span class="incident-outer-ring"></span><span class="incident-exclamation">!</span>':''}
          <span class="ship-pulse"></span>
          <svg class="ship-symbol" viewBox="0 0 24 34" aria-hidden="true" style="transform:rotate(${vessel.course}deg)">
            <path d="M12 1.4c1.5 2.1 4.7 4.6 6.5 8.2v15.7L12 32.6 5.5 25.3V9.6C7.3 6 10.5 3.5 12 1.4Z"></path>
            <path class="ship-deck" d="M9.2 10.6h5.6v8.2H9.2z"></path>
            <path class="ship-centerline" d="M12 3.5v24.3"></path>
          </svg>
          ${isSelected ? `<span class="ship-label">${vessel.name}<b>${this.riskDisplay(vessel)}</b></span>` : ''}
        </div>
      `,
      iconSize:[52,52],
      iconAnchor:[26,26]
    });
  }

  private drawSelectedTrack(): void {
    if (!this.map) return;
    if (this.selectedTrack) this.selectedTrack.removeFrom(this.map);
    this.selectedTrack=undefined;
    if (!this.selectedVessel) return;

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
