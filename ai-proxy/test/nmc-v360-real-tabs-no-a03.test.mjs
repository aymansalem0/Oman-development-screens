import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const root=new URL('../../',import.meta.url);
const read=path=>readFileSync(fileURLToPath(new URL(path,root)),'utf8');

const routes=read('src/app/app.routes.ts');
const nav=read('src/app/components/nmc-navigation.component.ts');
const navHtml=read('src/app/components/nmc-navigation.component.html');
const v=read('src/app/pages/nmc-vessel-360.component.ts');
const h=read('src/app/pages/nmc-vessel-360.component.html');
const explain=read('src/app/pages/nmc-risk-explainability.component.ts');
const explainHtml=read('src/app/pages/nmc-risk-explainability.component.html');
const admin=read('src/app/pages/nmc-risk-configuration-admin.component.ts');
const engine=read('src/app/services/nmc-risk-engine.service.ts');
const central=read('ai-proxy/risk-policy.mjs');
const fleet=read('ai-proxy/fleet-ai.mjs');
const quality=read('ai-proxy/data-quality.mjs');

test('Command Center is default root without hijacking the legacy Oman route',()=>{
 assert.match(routes,/path:\s*'',\s*pathMatch:\s*'full',\s*redirectTo:\s*'moei\/nmc'/);
 assert.match(routes,/path:\s*'moei\/nmc',\s*loadComponent/);
 assert.match(routes,/const base = 'dashboard\/maritime-navigation\/navigation-aids-installation-approval'/);
 assert.match(routes,/path:\s*'\*\*',\s*redirectTo:\s*'moei\/nmc'/);
});
test('Maritime menu and all groups start closed; one operator hamburger opens the drawer',()=>{
 for(const key of ['nmcExpanded','smartInspectionExpanded','settingsExpanded',
   'nmcSettingsExpanded','inspectionSettingsExpanded','nmcDashboardsExpanded',
   'smartDashboardsExpanded','settingsDashboardsExpanded','mobileOpen'])
   assert.match(nav,new RegExp(key+'\\s*=\\s*false;'),key+' must start closed');
 assert.match(navHtml,/class="mobile-nav-toggle"/);
 assert.match(navHtml,/\(click\)="mobileOpen = !mobileOpen"/);
 assert.match(navHtml,/class="nmc-nav-scrim"/);
 assert.match(navHtml,/\[class\.mobile-open\]="mobileOpen"/);
 assert.doesNotMatch(nav,/expandSelectedDashboard\(/);
});
test('A03 is retired as a vessel risk factor in backend, admin and risk explainability',()=>{
 assert.doesNotMatch(admin,/Document integrity \(A03\)|documentIntegrity/);
 assert.doesNotMatch(explain,/documentIntegrity|missingRequiredA03/);
 assert.doesNotMatch(explainHtml,/documentIntegrity|missingRequiredA03|tab:'documents'/);
 assert.match(central,/const keySet=\[\.\.\.coreKeys\]/);
 assert.match(central,/RISK_LEGACY_A03_REBALANCE_REQUIRED/);
 assert.match(fleet,/const signals=validated/);
 assert.doesNotMatch(fleet,/import \{documentEvidenceChecks,documentIntegritySignal\}/);
 assert.match(engine,/export type RiskFactorKey = 'movement' \| 'inspection' \| 'certificate' \| 'dataQuality' \| 'history'/);
 assert.match(quality,/const calculationSteps=\[/);
 assert.doesNotMatch(quality,/metric\('documentConsistency'/);
});
test('Vessel 360 every menu tab uses an actual rendered view, with no placeholders or old documents risk screens',()=>{
 for(const name of ['overview','movement','compliance','inspection','external-psc',
   'certificates','sources'])
   assert.match(h,new RegExp('activeTab\\s*===?\\s*\\x27'+name+'\\x27'),name+' view is missing');
 assert.doesNotMatch(h,/activeTab\s*===?\s*'documents'/);
 assert.doesNotMatch(h,/app-nmc-vessel-documents|Export vessel brief/);
 assert.doesNotMatch(h,/Create verification task|createPriorityInspection\(|startCertificateVerification\(/);
 assert.doesNotMatch(h,/placeholder-grid|VER-2026-00872|22:41:5/);
 assert.match(h,/A01 movement risk evidence|Saved A01 movement evidence/);
 assert.match(h,/A02 — saved compliance factors|A02 — saved compliance factors/);
 assert.match(h,/source\.dataNature/);
 assert.match(h,/externalPsc as psc/);
 assert.match(h,/certificates\.length/);
});
test('Conditional Accidents tab uses only exact-IMO linked source reports and never invents a case link',()=>{
 assert.match(h,/<button \*ngIf="hasRecordedAccidents"/);
 assert.match(h,/activeTab==='accidents'&&hasRecordedAccidents/);
 assert.match(v,/this\.vesselIncidents=feed\.incidents\.filter\(r=>r\.imo===this\.vessel\.imo\)/);
 assert.match(v,/this\.vesselIncidents!==null&&this\.vesselIncidents\.length>0/);
 assert.match(v,/this\.requestedAccidentsTab=requestedTab==='accidents'/);
 assert.match(h,/row\.description/);
 assert.match(h,/row\.sourceReference/);
 assert.match(h,/row\.aiAssessment as ai/);
 assert.match(h,/\*ngIf="row\.linkedCaseId"/);
 assert.doesNotMatch(h,/source-conflict-verification|Source Conflict Verification/);
});
test('No fake successful actions or confidence percentages are presented as verified',()=>{
 assert.doesNotMatch(h,/Export vessel brief|TASK CREATED|priorityInspectionCreated|certificateVerificationStarted/);
 assert.doesNotMatch(h,/sourceTrust \}\}%|provenance\.sourceTrust.*%/);
 assert.doesNotMatch(h,/provenance\.freshness/);
 assert.doesNotMatch(h,/provenance\.identityMatch/);
 assert.match(h,/independently verified/i);
 assert.match(h,/\[routerLink\]="\['\/moei\/nmc\/vessel',vessel\.imo,'case'\]"/);
 assert.match(v,/this\.hasCertificateConflict = false/);
 assert.match(v,/this\.deficiencies\.filter\(d=>d\.status==='Open'\)\.length/);
});
