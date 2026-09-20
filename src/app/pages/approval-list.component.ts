import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LanguageService } from '../services/language.service';

interface StatCard {
  labelKey: string;
  value: number;
  icon: string;
}

interface ApprovalRow {
  requestNumber: string;
  beneficiary: string;
  statusKey: string;
  statusClass: string;
  lastUpdate: string;
  id: number;
}

@Component({
  selector: 'app-approval-list',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './approval-list.component.html'
})
export class ApprovalListComponent {
  constructor(public lang: LanguageService) {}

  stats: StatCard[] = [
    { labelKey: 'totalRequests', value: 31, icon: '▣' },
    { labelKey: 'underProcessing', value: 14, icon: '⌛' },
    { labelKey: 'rejected', value: 0, icon: '⊗' },
    { labelKey: 'send', value: 2, icon: '➤' },
    { labelKey: 'pending', value: 0, icon: '⌛' },
    { labelKey: 'accepted', value: 6, icon: '✓' },
    { labelKey: 'issued', value: 17, icon: '✹' },
    { labelKey: 'awaitingInstallationReview', value: 6, icon: '▧' }
  ];

  rows: ApprovalRow[] = [
    {
      requestNumber: '4365/2026',
      beneficiary: 'المرشد للخدمات الملاحية',
      statusKey: 'awaitingStatusLong',
      statusClass: 'awaiting',
      lastUpdate: '2026-09-16T11:51:00+04:00',
      id: 100
    },
    {
      requestNumber: '4218/2026',
      beneficiary: 'المرشد للخدمات الملاحية',
      statusKey: 'issued',
      statusClass: 'issued',
      lastUpdate: '2026-09-07T13:54:00+04:00',
      id: 100
    },
    {
      requestNumber: '4173/2026',
      beneficiary: 'المرشد للخدمات الملاحية',
      statusKey: 'issued',
      statusClass: 'issued',
      lastUpdate: '2026-09-06T13:18:00+04:00',
      id: 100
    },
    {
      requestNumber: '3772/2026',
      beneficiary: 'المرشد للخدمات الملاحية',
      statusKey: 'issued',
      statusClass: 'issued',
      lastUpdate: '2026-08-25T01:16:00+04:00',
      id: 100
    },
    {
      requestNumber: '3755/2026',
      beneficiary: 'RED SEA SHIPPING AGENCIES',
      statusKey: 'awaitingStatusLong',
      statusClass: 'awaiting',
      lastUpdate: '2026-09-09T08:11:00+04:00',
      id: 100
    }
  ];
}
