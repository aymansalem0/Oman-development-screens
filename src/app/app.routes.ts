import { Routes } from '@angular/router';
import { ApprovalListComponent } from './pages/approval-list.component';
import { ApprovalDetailComponent } from './pages/approval-detail.component';
import { YearlyAvailabilityComponent } from './pages/yearly-availability.component';
import { NmcCommandCenterComponent } from './pages/nmc-command-center.component';
import { NmcVessel360Component } from './pages/nmc-vessel-360.component';
import { NmcRiskExplainabilityComponent } from './pages/nmc-risk-explainability.component';

const base = 'dashboard/maritime-navigation/navigation-aids-installation-approval';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: base },
  { path: base, component: ApprovalListComponent },
  { path: base + '/:id', component: ApprovalDetailComponent },
  { path: 'dashboard/appointment-availability', component: YearlyAvailabilityComponent },
  { path: 'moei/nmc', component: NmcCommandCenterComponent },
  { path: 'moei/nmc/vessel/:imo/risk', component: NmcRiskExplainabilityComponent },
  { path: 'moei/nmc/vessel/:imo', component: NmcVessel360Component },
  { path: '**', redirectTo: base }
];
