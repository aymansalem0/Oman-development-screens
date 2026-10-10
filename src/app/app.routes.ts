import { Routes } from '@angular/router';
import { ApprovalListComponent } from './pages/approval-list.component';
import { ApprovalDetailComponent } from './pages/approval-detail.component';
import { YearlyAvailabilityComponent } from './pages/yearly-availability.component';
import { NmcCommandCenterComponent } from './pages/nmc-command-center.component';
import { NmcVessel360Component } from './pages/nmc-vessel-360.component';
import { NmcRiskExplainabilityComponent } from './pages/nmc-risk-explainability.component';
import { NmcCaseWorkspaceComponent } from './pages/nmc-case-workspace.component';
import { NmcRiskConfigurationAdminComponent } from './pages/nmc-risk-configuration-admin.component';
import { NmcDataQualityConfigurationComponent } from './pages/nmc-data-quality-configuration.component';
import { NmcOperationalGuidanceAdminComponent } from './pages/nmc-operational-guidance-admin.component';
import { ActivityClassificationMappingComponent } from './pages/activity-classification-mapping.component';
import { SmartInspectionCandidateCenterComponent } from './pages/smart-inspection-candidate-center.component';
import { SiCandidateWorkbenchComponent } from './pages/si-candidate-workbench.component';
import { SiInspectionPreparationComponent } from './pages/si-inspection-preparation.component';
import { SiPreparationQueueComponent } from './pages/si-preparation-queue.component';
import { SiTargetingSettingsComponent } from './pages/si-targeting-settings.component';
import { SiCandidateSourcesComponent } from './pages/si-candidate-sources.component';
import { SiPscTargetingPoolComponent } from './pages/si-psc-targeting-pool.component';
import { SiPscQuotaSettingsComponent } from './pages/si-psc-quota-settings.component';
import { SiElectronicSchedulingComponent } from './pages/si-electronic-scheduling.component';
import { SiErpSettingsComponent } from './pages/si-erp-settings.component';
import { NmcDashboardBuilderComponent } from './pages/nmc-dashboard-builder.component';
import { NmcAlertCenterComponent } from './pages/nmc-alert-center.component';

const base = 'dashboard/maritime-navigation/navigation-aids-installation-approval';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: base },
  { path: base, component: ApprovalListComponent },
  { path: base + '/:id', component: ApprovalDetailComponent },
  { path: 'dashboard/appointment-availability', component: YearlyAvailabilityComponent },
  { path: 'dashboard/master-data/activity-classification-mapping', component: ActivityClassificationMappingComponent },
  { path: 'moei/smart-inspection/lifecycle', loadComponent: () => import('./pages/si-full-lifecycle.component').then(m => m.SiFullLifecycleComponent) },
  { path: 'moei/smart-inspection/lifecycle/:caseId', loadComponent: () => import('./pages/si-full-lifecycle.component').then(m => m.SiFullLifecycleComponent) },
  { path: 'moei/smart-inspection/psc-targeting', component: SiPscTargetingPoolComponent },
  { path: 'moei/smart-inspection/settings/psc-quotas', component: SiPscQuotaSettingsComponent },
  { path: 'moei/smart-inspection/candidates', component: SiCandidateWorkbenchComponent },
  { path: 'moei/smart-inspection/candidates/demo', component: SmartInspectionCandidateCenterComponent },
  { path: 'moei/smart-inspection/preparation', component: SiPreparationQueueComponent },
  { path: 'moei/smart-inspection/scheduling', component: SiElectronicSchedulingComponent },
  { path: 'moei/smart-inspection/settings/erp', component: SiErpSettingsComponent },
  { path: 'moei/smart-inspection/settings/targeting', component: SiTargetingSettingsComponent },
  { path: 'moei/smart-inspection/settings/sources', component: SiCandidateSourcesComponent },
  { path: 'moei/smart-inspection/settings/sources/:source', component: SiCandidateSourcesComponent },
  { path: 'moei/smart-inspection/preparation/:caseId', component: SiInspectionPreparationComponent },
  { path: 'moei/nmc', component: NmcCommandCenterComponent },
  { path: 'moei/nmc/alerts', component: NmcAlertCenterComponent },
  { path: 'moei/nmc/dashboards', component: NmcDashboardBuilderComponent },
  { path: 'moei/nmc/dashboards/view/:id', component: NmcDashboardBuilderComponent },
  { path: 'moei/nmc/dashboards/:id', component: NmcDashboardBuilderComponent },
  { path: 'moei/nmc/admin/risk-configuration', component: NmcRiskConfigurationAdminComponent },
  { path: 'moei/nmc/admin/data-quality', component: NmcDataQualityConfigurationComponent },
  { path: 'moei/nmc/admin/operational-guidance', component: NmcOperationalGuidanceAdminComponent },
  { path: 'moei/nmc/vessel/:imo/smart-inspection', loadComponent: () => import('./pages/nmc-smart-inspection.component').then(m => m.NmcSmartInspectionComponent) },
  { path: 'moei/nmc/vessel/:imo/case', component: NmcCaseWorkspaceComponent },
  { path: 'moei/nmc/vessel/:imo/ai-assessment', component: NmcRiskExplainabilityComponent },
  { path: 'moei/nmc/vessel/:imo/risk', component: NmcRiskExplainabilityComponent },
  { path: 'moei/nmc/vessel/:imo', component: NmcVessel360Component },
  { path: '**', redirectTo: base }
];
