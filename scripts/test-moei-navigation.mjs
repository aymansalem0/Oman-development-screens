/**
 * Static route/navigation consistency checks for the unified MOEI platform.
 * No browser or Angular runtime required; the Angular CI build validates
 * the actual imported components/templates separately.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const nav=read('src/app/components/nmc-navigation.component.html');
const navTs=read('src/app/components/nmc-navigation.component.ts');
const routes=read('src/app/app.routes.ts');
const chrome=read('src/app/components/nmc-platform-chrome.component.ts');
const chromeCss=read('src/app/components/nmc-platform-chrome.component.css');
const navCss=read('src/app/components/nmc-navigation.component.css');
const globalCss=read('src/styles.css');

test('shared header/footer show exact platform name and Arabic equivalence',()=>{
  assert.match(chrome,/MOEI Maritime Unified Platform/);
  assert.match(chrome,/المنصة البحرية الموحدة لوزارة الطاقة والبنية التحتية/);
  assert.match(chrome,/changeLanguage\(\)/);
  assert.match(chrome,/this\.lang\.toggle\(\)/);
  assert.match(chrome,/maritime-platform-footer/);
});
test('all Smart Inspection fixed menu links resolve to existing actual routes',()=>{
  const expected=[
    'moei/smart-inspection/candidates',
    'moei/smart-inspection/preparation',
    'moei/smart-inspection/scheduling',
    'moei/smart-inspection/settings/targeting',
    'moei/smart-inspection/settings/erp'
  ];
  for(const r of expected){
    assert.ok(routes.includes("path: '"+r+"'"),'Missing route '+r);
    assert.ok(nav.includes('routerLink="/'+r+'"'),'Missing menu link '+r);
  }
  assert.match(routes,/moei\/smart-inspection\/preparation\/:caseId/);
  assert.match(routes,/moei\/nmc\/vessel\/:imo\/smart-inspection/);
  assert.match(nav,/inspectionWorkbenchRoute/);
});
test('Settings group headings, links and active markers are separate',()=>{
  assert.match(nav,/aria-controls="nmc-settings-children"/);
  assert.match(nav,/aria-controls="si-settings-children"/);
  assert.match(nav,/nmcSettingsExpanded/);
  assert.match(nav,/inspectionSettingsExpanded/);
  assert.match(nav,/copy\('NMC Settings','إعدادات المركز البحري'\)/);
  assert.match(nav,/copy\('Inspection Settings','إعدادات المعاينات'\)/);
  for(const route of ['risk-configuration','data-quality','operational-guidance','/moei/nmc/dashboards'])
    assert.ok(nav.includes(route),'Missing NMC settings child '+route);
  assert.match(navTs,/isInspectionCandidates/);
  assert.match(navTs,/isInspectionPreparation/);
  assert.match(navTs,/isInspectionScheduling/);
  assert.match(navTs,/isInspectionTargetingSettings/);
  assert.match(navTs,/isErpIntegrationSettings/);
  assert.ok(!nav.includes('[class.active]="isSmartInspection"'),
    'Candidate link must NOT highlight every inspection screen');
});
test('desktop sidebar and responsive NMC + SI offsets are consistently widened',()=>{
  assert.match(navCss,/width: 240px/);
  assert.match(globalCss,/\.app-shell\.smart-inspection-mode \.si-layout\s*\{\s*padding-inline-start: 240px/);
  assert.match(globalCss,/\.app-shell\.smart-inspection-mode \.erp-layout\s*\{\s*padding-inline-start: 240px/);
  assert.match(chromeCss,/padding-inline-start:264px/);
  assert.match(navCss,/@media \(min-width: 961px\) and \(max-width: 1220px\)/);
  assert.match(navCss,/width: 66px/);
  assert.match(navCss,/@media \(max-width: 960px\)/);
  assert.match(navCss,/:host-context\(\[dir="rtl"\]\) \.nmc-unified-sidebar/);
});
test('preparation menu leads to a real approved case selector, no mock case IDs',()=>{
  const launcher=read('src/app/pages/si-preparation-queue.component.ts');
  const settings=read('src/app/pages/si-targeting-settings.component.ts');
  assert.match(launcher,/status==='INSPECTION_CREATED'/);
  assert.match(launcher,/this\.api\.dashboard\(\)/);
  assert.match(launcher,/\['\/moei\/smart-inspection\/preparation',c\.inspectionCase\?\.id\]/);
  assert.match(settings,/this\.api\.preview\(/);
  assert.match(settings,/this\.api\.publish\(/);
});

test('SI-P01 weights and trigger priorities follow NMC Risk slider + compact number pattern',()=>{
  const centralRisk=read('src/app/pages/nmc-risk-configuration-admin.component.html');
  const si=read('src/app/pages/si-targeting-settings.component.ts');
  assert.match(centralRisk,/type="range"/);
  assert.match(centralRisk,/normalizeWeights\(\)/);
  assert.match(si,/class="risk-style-factor" \*ngFor="let factor of weightFactors"/);
  assert.match(si,/class="risk-style-factor" \*ngFor="let reason of triggerReasons"/);
  assert.match(si,/type="range" min="0" max="100" step="1"/);
  assert.match(si,/class="number-input"/);
  assert.match(si,/normalizeWeights\(\)/);
  assert.match(si,/\[class.invalid\]="!weightsValid"/);
  assert.match(si,/get weightsValid\(\):boolean/);
  assert.match(si,/this\.weightTotal===100/);
  assert.match(si,/this\.onPriorityEdit\(\)/);
  assert.match(si,/this\.impact=null;this\.success='';this\.error='';/);
  assert.match(si,/missingRiskAction:'REVIEW_REQUIRED'/);
  assert.match(si,/sourceTriggerScores:\{\.\.\.this\.sourceScores\}/);
  assert.match(si,/\[attr\.aria-label\]=/);
  assert.match(si,/\.factor-control input\.weight-slider\{[^}]*accent-color:#0f766e/);
  // This PR must remain UI-only: existing backend protected P01 inputs remain.
  const server=read('ai-proxy/server.mjs');
  assert.match(server,/SiAiPrioritization/);
});
