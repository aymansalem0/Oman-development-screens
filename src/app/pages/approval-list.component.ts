import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

interface StatCard {
  label: string;
  value: number;
  icon: string;
}

interface ApprovalRow {
  requestNumber: string;
  beneficiary: string;
  status: string;
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
  stats: StatCard[] = [
    { label: 'Total Requests', value: 31, icon: '▣' },
    { label: 'Under Processing', value: 14, icon: '⌛' },
    { label: 'Rejected', value: 0, icon: '⊗' },
    { label: 'Send', value: 2, icon: '➤' },
    { label: 'Pending', value: 0, icon: '⌛' },
    { label: 'Accepted', value: 6, icon: '✓' },
    { label: 'Issued', value: 17, icon: '✹' },
    { label: 'Awaiting Installation Company Review', value: 6, icon: '▧' }
  ];

  rows: ApprovalRow[] = [
    {
      requestNumber: '4365/2026',
      beneficiary: 'المرشد للخدمات الملاحية',
      status: 'AWAITING INSTALLATION COMPANY REVIEW',
      statusClass: 'awaiting',
      lastUpdate: '16 September 2026 11:51 AM',
      id: 100
    },
    {
      requestNumber: '4218/2026',
      beneficiary: 'المرشد للخدمات الملاحية',
      status: 'Issued',
      statusClass: 'issued',
      lastUpdate: '7 September 2026 1:54 PM',
      id: 100
    },
    {
      requestNumber: '4173/2026',
      beneficiary: 'المرشد للخدمات الملاحية',
      status: 'Issued',
      statusClass: 'issued',
      lastUpdate: '6 September 2026 1:18 PM',
      id: 100
    },
    {
      requestNumber: '3772/2026',
      beneficiary: 'المرشد للخدمات الملاحية',
      status: 'Issued',
      statusClass: 'issued',
      lastUpdate: '25 August 2026 1:16 AM',
      id: 100
    },
    {
      requestNumber: '3755/2026',
      beneficiary: 'RED SEA SHIPPING AGENCIES',
      status: 'AWAITING INSTALLATION COMPANY REVIEW',
      statusClass: 'awaiting',
      lastUpdate: '9 September 2026 8:11 AM',
      id: 100
    }
  ];
}
