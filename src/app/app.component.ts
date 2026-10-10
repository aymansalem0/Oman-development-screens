import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { Router, RouterLink, RouterOutlet } from '@angular/router';
import { LanguageService } from './services/language.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterOutlet],
  templateUrl: './app.component.html'
})
export class AppComponent {
  constructor(public lang: LanguageService, private router: Router) {}

  /**
   * The NMC and Smart Inspection pages share the white maritime navigation.
   * Never render the legacy blue Oman demo shell around these routes.
   * Non-maritime demo routes retain the original shell unchanged.
   */
  get isNmcArea(): boolean {
    const path = this.router.url.split('?')[0].split('#')[0];
    return path === '/moei/nmc' || path.startsWith('/moei/nmc/') ||
      path === '/moei/smart-inspection' || path.startsWith('/moei/smart-inspection/');
  }

  get isSmartInspectionArea(): boolean {
    const path = this.router.url.split('?')[0].split('#')[0];
    return path === '/moei/smart-inspection' || path.startsWith('/moei/smart-inspection/');
  }
}
