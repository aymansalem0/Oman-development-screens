import { Routes } from '@angular/router';
import { ApprovalListComponent } from './pages/approval-list.component';
import { ApprovalDetailComponent } from './pages/approval-detail.component';
import { YearlyAvailabilityComponent } from './pages/yearly-availability.component';
import { NmcCommandCenterComponent } from './pages/nmc-command-center.component';
import { NmcVessel360Component } from './pages/nmc-vessel-360.component';
import { NmcRiskExplainabilityComponent } from './pages/nmc-risk-explainability.component';
import { NmcAiSituationAssessmentComponent } from './pages/nmc-ai-situation-assessment.component';
import { NmcCaseWorkspaceComponent } from './pages/nmc-case-workspace.component';
import { NmcSmartInspectionComponent } from './pages/nmc-smart-inspection.component';
import { NmcRiskConfigurationAdminComponent } from './pages/nmc-risk-configuration-admin.component';
import { NmcDataQualityConfigurationComponent } from './pages/nmc-data-quality-configuration.component';
import { ActivityClassificationMappingComponent } from './pages/activity-classification-mapping.component';
import { SmartInspectionCandidateCenterComponent } from './pages/smart-inspection-candidate-center.component';

const base = 'dashboard/maritime-navigation/navigation-aids-installation-approval';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: base },
  { path: base, component: ApprovalListComponent },
  { path: base + '/:id', component: ApprovalDetailComponent },
  { path: 'dashboard/appointment-availability', component: YearlyAvailabilityComponent },
  { path: 'dashboard/master-data/activity-classification-mapping', component: ActivityClassificationMappingComponent },
  { path: 'moei/smart-inspection/candidates', component: SmartInspectionCandidateCenterComponent },
  { path: 'moei/nmc', component: NmcCommandCenterComponent },
  { path: 'moei/nmc/admin/risk-configuration', component: NmcRiskConfigurationAdminComponent },
  { path: 'moei/nmc/admin/data-quality', component: NmcDataQualityConfigurationComponent },
  { path: 'moei/nmc/vessel/:imo/smart-inspection', component: NmcSmartInspectionComponent },
  { path: 'moei/nmc/vessel/:imo/case', component: NmcCaseWorkspaceComponent },
  { path: 'moei/nmc/vessel/:imo/ai-assessment', component: NmcAiSituationAssessmentComponent },
  { path: 'moei/nmc/vessel/:imo/risk', component: NmcRiskExplainabilityComponent },
  { path: 'moei/nmc/vessel/:imo', component: NmcVessel360Component },
  { path: '**', redirectTo: base }
];
