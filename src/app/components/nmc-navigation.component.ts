import { Component, OnDestroy, OnInit } from '@angular/core';
import { Router, RouterLink, NavigationEnd } from '@angular/router';
import { filter, Subscription } from 'rxjs';
import { LanguageService } from '../services/language.service';

/**
 * Unified business navigation for the National Maritime Center.
 * Only implemented screens appear as links. Vessel-scoped links retain the
 * most recently selected IMO; until one is selected they open Command Center.
 */
@Component({
  selector: 'app-nmc-navigation',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './nmc-navigation.component.html',
  styleUrl: './nmc-navigation.component.css'
})
export class NmcNavigationComponent implements OnInit, OnDestroy {
  nmcExpanded = true;
  settingsExpanded = true;
  mobileOpen = false;
  currentPath = '';
  selectedImo: string | null = null;
  private navigation?: Subscription;
  private readonly selectedKey = 'moei-nmc-selected-vessel-imo';

  constructor(private readonly router: Router, public readonly lang: LanguageService) {}

  ngOnInit(): void {
    try {
      const saved = localStorage.getItem(this.selectedKey);
      if (saved && /^\d{7}$/.test(saved)) this.selectedImo = saved;
    } catch { /* Navigation remains usable when browser storage is blocked. */ }
    this.updateRoute(this.router.url);
    this.navigation = this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd)
    ).subscribe(event => {
      this.updateRoute(event.urlAfterRedirects);
      this.mobileOpen = false;
    });
  }

  ngOnDestroy(): void {
    this.navigation?.unsubscribe();
  }

  copy(en: string, ar: string): string {
    return this.lang.pick(en, ar);
  }

  get vesselRoute(): string {
    return this.selectedImo ? '/moei/nmc/vessel/' + this.selectedImo : '/moei/nmc';
  }

  get intelligenceRoute(): string {
    return this.selectedImo ? this.vesselRoute + '/ai-assessment' : '/moei/nmc';
  }

  get caseRoute(): string {
    return this.selectedImo ? this.vesselRoute + '/case' : '/moei/nmc';
  }

  get isCommandCenter(): boolean { return this.currentPath === '/moei/nmc'; }
  get isVessel360(): boolean { return /^\/moei\/nmc\/vessel\/\d{7}(?:\/risk)?$/.test(this.currentPath); }
  get isIntelligence(): boolean { return this.currentPath.endsWith('/ai-assessment'); }
  get isCase(): boolean { return this.currentPath.endsWith('/case'); }
  get isSmartInspection(): boolean {
    return this.currentPath.includes('/smart-inspection');
  }
  get isRiskConfig(): boolean { return this.currentPath === '/moei/nmc/admin/risk-configuration'; }
  get isQualityConfig(): boolean { return this.currentPath === '/moei/nmc/admin/data-quality'; }
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
      try { localStorage.setItem(this.selectedKey, imo); } catch { /* Optional only. */ }
    }
  }
}
