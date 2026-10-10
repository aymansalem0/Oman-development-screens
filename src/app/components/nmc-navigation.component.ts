import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink, NavigationEnd } from '@angular/router';
import { filter, Subscription } from 'rxjs';
import { LanguageService } from '../services/language.service';
import { DashboardMenuPlacement } from '../services/nmc-dashboard-store.service';
import { NmcDashboardNavigationService } from '../services/nmc-dashboard-navigation.service';
import { PublishedDashboardMenuItem } from '../services/nmc-dashboard-workspace.service';
import { NmcAlertsService } from '../services/nmc-alerts.service';

/**
 * Unified business navigation. Published dashboard links are server-driven,
 * not generated from local drafts or any client-side user-defined route.
 */
@Component({
  selector: 'app-nmc-navigation',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './nmc-navigation.component.html',
  styleUrl: './nmc-navigation.component.css'
})
export class NmcNavigationComponent implements OnInit, OnDestroy {
  nmcExpanded = true;
  smartInspectionExpanded = true;
  settingsExpanded = true;
  nmcSettingsExpanded = true;
  inspectionSettingsExpanded = true;
  nmcDashboardsExpanded = true;
  smartDashboardsExpanded = true;
  settingsDashboardsExpanded = true;
  mobileOpen = false;
  currentPath = '';
  selectedImo: string | null = null;
  publishedDashboards: PublishedDashboardMenuItem[] = [];
  unreadAlerts = 0;
  private readonly subscriptions = new Subscription();
  private refreshTimer?: ReturnType<typeof setInterval>;
  private readonly selectedKey = 'moei-nmc-selected-vessel-imo';

  constructor(
    private readonly router: Router,
    public readonly lang: LanguageService,
    private readonly dashboardNavigation: NmcDashboardNavigationService,
    private readonly alertsService: NmcAlertsService
  ) {}

  ngOnInit(): void {
    try {
      const saved = localStorage.getItem(this.selectedKey);
      if (saved && /^\d{7}$/.test(saved)) this.selectedImo = saved;
    } catch { /* Navigation remains usable when browser storage is blocked. */ }

    this.subscriptions.add(this.dashboardNavigation.published$.subscribe(items => {
      this.publishedDashboards = items;
      this.expandSelectedDashboard();
    }));
    this.updateRoute(this.router.url);
    this.subscriptions.add(this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd)
    ).subscribe(event => {
      this.updateRoute(event.urlAfterRedirects);
      this.dashboardNavigation.refresh();
      this.refreshAlertCount();
      this.mobileOpen = false;
    }));
    this.dashboardNavigation.refresh();
    this.refreshAlertCount();
    // Publication from another browser is reflected without requiring reload.
    this.refreshTimer = setInterval(() => {this.dashboardNavigation.refresh();this.refreshAlertCount();}, 30000);
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
    if (this.refreshTimer) clearInterval(this.refreshTimer);
  }

  copy(en: string, ar: string): string { return this.lang.pick(en, ar); }

  get isAlertCenter():boolean{return this.currentPath==='/moei/nmc/alerts';}
  private refreshAlertCount():void{
    const req=this.alertsService.overviewForBrowserPolicy().subscribe({
      next:result=>{this.unreadAlerts=result.summary.unread;},
      error:()=>{this.unreadAlerts=0;}
    });
    this.subscriptions.add(req);
  }

  dashboardItems(area: DashboardMenuPlacement): PublishedDashboardMenuItem[] {
    return this.publishedDashboards.filter(item => item.menuPlacement === area);
  }

  publishedRoute(id: string): string {
    return '/moei/nmc/dashboards/view/' + id;
  }

  isPublishedDashboard(id: string): boolean {
    return this.currentPath === this.publishedRoute(id);
  }

  get vesselRoute(): string {
    return this.selectedImo ? '/moei/nmc/vessel/' + this.selectedImo : '/moei/nmc';
  }

  get intelligenceRoute(): string {
    return this.selectedImo ? this.vesselRoute + '/risk' : '/moei/nmc';
  }

  get caseRoute(): string {
    return this.selectedImo ? this.vesselRoute + '/case' : '/moei/nmc';
  }

  get isCommandCenter(): boolean { return this.currentPath === '/moei/nmc'; }
  get isDashboardManager(): boolean {
    return this.currentPath === '/moei/nmc/dashboards' ||
      /^\/moei\/nmc\/dashboards\/(?!view\/)[^/]+$/.test(this.currentPath);
  }
  get isVessel360(): boolean {
    return /^\/moei\/nmc\/vessel\/\d{7}(?:\/risk)?$/.test(this.currentPath);
  }
  get isIntelligence(): boolean { return this.currentPath.endsWith('/ai-assessment')||this.currentPath.endsWith('/risk'); }
  get isGuidanceConfig():boolean{return this.currentPath==='/moei/nmc/admin/operational-guidance';}
  get isErpIntegrationSettings(): boolean {
    return this.currentPath === '/moei/smart-inspection/settings/erp';
  }
  get isInspectionLifecycle():boolean{
    return this.currentPath==='/moei/smart-inspection/lifecycle'||
      this.currentPath.startsWith('/moei/smart-inspection/lifecycle/');
  }
  get isPscTargetingPool():boolean{
    return this.currentPath==='/moei/smart-inspection/psc-targeting';
  }
  get isPscQuotaSettings():boolean{
    return this.currentPath==='/moei/smart-inspection/settings/psc-quotas';
  }
  get isCandidateSourceSettings(): boolean {
    return this.currentPath==='/moei/smart-inspection/settings/sources' ||
      this.currentPath.startsWith('/moei/smart-inspection/settings/sources/');
  }
  get isInspectionTargetingSettings(): boolean {
    return this.currentPath === '/moei/smart-inspection/settings/targeting';
  }
  get isInspectionCandidates(): boolean {
    return this.currentPath === '/moei/smart-inspection/candidates' ||
      this.currentPath === '/moei/smart-inspection/candidates/demo';
  }
  get isInspectionPreparation(): boolean {
    return this.currentPath === '/moei/smart-inspection/preparation' ||
      this.currentPath.startsWith('/moei/smart-inspection/preparation/');
  }
  get isInspectionScheduling(): boolean {
    return this.currentPath === '/moei/smart-inspection/scheduling';
  }
  get isInspectionWorkbench(): boolean {
    return /^\/moei\/nmc\/vessel\/\d{7}\/smart-inspection$/.test(this.currentPath);
  }
  get inspectionWorkbenchRoute(): string {
    return this.selectedImo
      ? '/moei/nmc/vessel/' + this.selectedImo + '/smart-inspection'
      : '/moei/nmc';
  }
  get isCase(): boolean { return this.currentPath.endsWith('/case'); }
  get isRiskConfig(): boolean {
    return this.currentPath === '/moei/nmc/admin/risk-configuration';
  }
  get isQualityConfig(): boolean {
    return this.currentPath === '/moei/nmc/admin/data-quality';
  }
  get vesselHint(): string {
    return this.selectedImo
      ? 'IMO ' + this.selectedImo
      : this.copy('Select a vessel from Command Center', 'اختر سفينة من مركز القيادة');
  }

  private updateRoute(url: string): void {
    this.currentPath = url.split('?')[0].split('#')[0];
    const match = this.currentPath.match(/^\/moei\/nmc\/vessel\/(\d{7})(?:\/|$)/);
    const param = url.match(/[?&]imo=(\d{7})(?:&|$)/);
    const imo = match?.[1] ?? param?.[1];
    if (imo) {
      this.selectedImo = imo;
      try { localStorage.setItem(this.selectedKey, imo); }
      catch { /* Optional navigation convenience. */ }
    }
    // Keep the active screen visible in its section when routing from a
    // bookmarked deep link or from NMC Vessel 360.
    if (this.isPscTargetingPool || this.isInspectionCandidates || this.isInspectionPreparation ||
        this.isInspectionScheduling || this.isInspectionWorkbench) {
      this.smartInspectionExpanded = true;
    }
    if (this.isRiskConfig || this.isQualityConfig || this.isGuidanceConfig ||
        this.isDashboardManager) {
      this.settingsExpanded = true;
      this.nmcSettingsExpanded = true;
    }
    if (this.isErpIntegrationSettings || this.isInspectionTargetingSettings || this.isCandidateSourceSettings || this.isPscQuotaSettings) {
      this.settingsExpanded = true;
      this.inspectionSettingsExpanded = true;
    }
    this.expandSelectedDashboard();
  }

  private expandSelectedDashboard(): void {
    const item = this.publishedDashboards.find(d => this.isPublishedDashboard(d.id));
    if (!item) return;
    if (item.menuPlacement === 'NMC_CENTER') {
      this.nmcExpanded = true;
      this.nmcDashboardsExpanded = true;
    } else if (item.menuPlacement === 'SMART_INSPECTION') {
      this.smartInspectionExpanded = true;
      this.smartDashboardsExpanded = true;
    } else {
      this.settingsExpanded = true;
      this.nmcSettingsExpanded = true;
      this.settingsDashboardsExpanded = true;
    }
  }
}
