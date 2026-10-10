import { Routes } from '@angular/router';

import { ApprovalListComponent } from './pages/approval-list.component';
import { ApprovalDetailComponent } from './pages/approval-detail.component';
import { YearlyAvailabilityComponent } from './pages/yearly-availability.component';
import { ActivityClassificationMappingComponent } from './pages/activity-classification-mapping.component';

const base = 'dashboard/maritime-navigation/navigation-aids-installation-approval';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: base },
  { path: base, component: ApprovalListComponent },
  { path: base + '/:id', component: ApprovalDetailComponent },
  { path: 'dashboard/appointment-availability', component: YearlyAvailabilityComponent },
  { path: 'dashboard/master-data/activity-classification-mapping', component: ActivityClassificationMappingComponent },
  { path: 'moei/smart-inspection/lifecycle', loadComponent: () => import('./pages/si-full-lifecycle.component').then(m => m.SiFullLifecycleComponent) },
  { path: 'moei/smart-inspection/lifecycle/:caseId', loadComponent: () => import('./pages/si-full-lifecycle.component').then(m => m.SiFullLifecycleComponent) },
  { path: 'moei/smart-inspection/psc-targeting', loadComponent: () => import('./pages/si-psc-targeting-pool.component').then(m => m.SiPscTargetingPoolComponent) },
  { path: 'moei/smart-inspection/settings/psc-quotas', loadComponent: () => import('./pages/si-psc-quota-settings.component').then(m => m.SiPscQuotaSettingsComponent) },
  { path: 'moei/smart-inspection/candidates', loadComponent: () => import('./pages/si-candidate-workbench.component').then(m => m.SiCandidateWorkbenchComponent) },
  { path: 'moei/smart-inspection/candidates/demo', loadComponent: () => import('./pages/smart-inspection-candidate-center.component').then(m => m.SmartInspectionCandidateCenterComponent) },
  { path: 'moei/smart-inspection/preparation', loadComponent: () => import('./pages/si-preparation-queue.component').then(m => m.SiPreparationQueueComponent) },
  { path: 'moei/smart-inspection/scheduling', loadComponent: () => import('./pages/si-electronic-scheduling.component').then(m => m.SiElectronicSchedulingComponent) },
  { path: 'moei/smart-inspection/settings/erp', loadComponent: () => import('./pages/si-erp-settings.component').then(m => m.SiErpSettingsComponent) },
  { path: 'moei/smart-inspection/settings/targeting', loadComponent: () => import('./pages/si-targeting-settings.component').then(m => m.SiTargetingSettingsComponent) },
  { path: 'moei/smart-inspection/settings/sources', loadComponent: () => import('./pages/si-candidate-sources.component').then(m => m.SiCandidateSourcesComponent) },
  { path: 'moei/smart-inspection/settings/sources/:source', loadComponent: () => import('./pages/si-candidate-sources.component').then(m => m.SiCandidateSourcesComponent) },
  { path: 'moei/smart-inspection/preparation/:caseId', loadComponent: () => import('./pages/si-inspection-preparation.component').then(m => m.SiInspectionPreparationComponent) },
  { path: 'moei/nmc', loadComponent: () => import('./pages/nmc-command-center.component').then(m => m.NmcCommandCenterComponent) },
  { path: 'moei/nmc/alerts', loadComponent: () => import('./pages/nmc-alert-center.component').then(m => m.NmcAlertCenterComponent) },
  { path: 'moei/nmc/dashboards', loadComponent: () => import('./pages/nmc-dashboard-builder.component').then(m => m.NmcDashboardBuilderComponent) },
  { path: 'moei/nmc/dashboards/view/:id', loadComponent: () => import('./pages/nmc-dashboard-builder.component').then(m => m.NmcDashboardBuilderComponent) },
  { path: 'moei/nmc/dashboards/:id', loadComponent: () => import('./pages/nmc-dashboard-builder.component').then(m => m.NmcDashboardBuilderComponent) },
  { path: 'moei/nmc/admin/risk-configuration', loadComponent: () => import('./pages/nmc-risk-configuration-admin.component').then(m => m.NmcRiskConfigurationAdminComponent) },
  { path: 'moei/nmc/admin/data-quality', loadComponent: () => import('./pages/nmc-data-quality-configuration.component').then(m => m.NmcDataQualityConfigurationComponent) },
 { path: 'moei/nmc/admin/runtime-settings', loadComponent: () => import('./pages/nmc-runtime-settings.component').then(m=>m.NmcRuntimeSettingsComponent) },
  { path: 'moei/nmc/admin/operational-guidance', loadComponent: () => import('./pages/nmc-operational-guidance-admin.component').then(m => m.NmcOperationalGuidanceAdminComponent) },
  { path: 'moei/nmc/vessel/:imo/smart-inspection', loadComponent: () => import('./pages/nmc-smart-inspection.component').then(m => m.NmcSmartInspectionComponent) },
  { path: 'moei/nmc/vessel/:imo/case', loadComponent: () => import('./pages/nmc-case-workspace.component').then(m => m.NmcCaseWorkspaceComponent) },
  { path: 'moei/nmc/vessel/:imo/ai-assessment', loadComponent: () => import('./pages/nmc-risk-explainability.component').then(m => m.NmcRiskExplainabilityComponent) },
  { path: 'moei/nmc/vessel/:imo/risk', loadComponent: () => import('./pages/nmc-risk-explainability.component').then(m => m.NmcRiskExplainabilityComponent) },
  { path: 'moei/nmc/vessel/:imo', loadComponent: () => import('./pages/nmc-vessel-360.component').then(m => m.NmcVessel360Component) },
  { path: '**', redirectTo: base }
];
