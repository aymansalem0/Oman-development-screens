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
const sidebarMenu=read('src/app/services/nmc-sidebar-menu-state.service.ts');

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
    'moei/smart-inspection/supervisor',
    'moei/smart-inspection/settings/targeting',
    'moei/smart-inspection/settings/erp'
  ];
  for(const r of expected){
    assert.ok(routes.includes("path: '"+r+"'"),'Missing route '+r);
    assert.ok(nav.includes('routerLink="/'+r+'"'),'Missing menu link '+r);
  }
  assert.match(routes,/moei\/smart-inspection\/preparation\/:caseId/);
  assert.match(routes,/moei\/nmc\/vessel\/:imo\/smart-inspection/);
  // Hidden legacy menu links remain deep-linkable for old workflow dependencies.
  for(const legacy of ['moei/smart-inspection/preparation',
     'moei/smart-inspection/scheduling',
     'moei/nmc/admin/operational-guidance']){
    assert.ok(routes.includes("path: '"+legacy+"'"),'Legacy route removed '+legacy);
    assert.ok(!nav.includes('routerLink="/'+legacy+'"'),'Legacy menu link still visible '+legacy);
  }
  assert.ok(!nav.includes('[routerLink]="inspectionWorkbenchRoute"'));
  assert.match(nav,/Supervisor Approval/);
});
test('Settings group headings, links and active markers are separate',()=>{
  assert.match(nav,/aria-controls="nmc-settings-children"/);
  assert.match(nav,/aria-controls="si-settings-children"/);
  assert.match(nav,/nmcSettingsExpanded/);
  assert.match(nav,/inspectionSettingsExpanded/);
  assert.match(nav,/copy\('NMC Settings','إعدادات المركز البحري'\)/);
  assert.match(nav,/copy\('Inspection Settings','إعدادات المعاينات'\)/);
  for(const route of ['risk-configuration','data-quality','/moei/nmc/dashboards'])
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
test('preparation menu lists persisted approved cases rather than volatile targeting',()=>{
  const launcher=read('src/app/pages/si-preparation-queue.component.ts');
  const settings=read('src/app/pages/si-targeting-settings.component.ts');
  assert.match(launcher,/this\.api\.list\(this\.editorKey\)/);
  assert.doesNotMatch(launcher,/this\.api\.dashboard\(\)/);
  assert.match(launcher,/\['\/moei\/smart-inspection\/preparation',c\.id\]/);
  assert.match(launcher,/No approved SI cases are saved yet/);
  assert.match(settings,/this\.api\.preview\(/);
  assert.match(settings,/this\.api\.publish\(/);
});

test('Smart Inspection entry and ranking rules are separated; ETD precedes incidents',()=>{
  const centralRisk=read('src/app/pages/nmc-risk-configuration-admin.component.html');
  const si=read('src/app/pages/si-targeting-settings.component.ts');
  assert.match(centralRisk,/type="range"/);
  assert.match(centralRisk,/normalizeWeights\(\)/);
  assert.match(si,/Inspection Selection & Priority Policy/);
  assert.match(si,/Eligibility & Selection/);
  assert.match(si,/Priority Rules/);
  assert.match(si,/aiRules\.minimumSelectionConfidence/);
  assert.match(si,/aiRules\.priorityInstructions/);
  assert.match(si,/Vessels approaching departure/);
  assert.match(si,/Vessels with maritime incidents/);
  assert.match(si,/criteria:\['DEPARTURE_SOON','INCIDENT_SEVERITY'\]/);
  assert.doesNotMatch(si,/riskPriorityThreshold|weightFactors|weightsValid|normalizeWeights|SI-P01/);
  assert.match(si,/ETD/);
  assert.match(si,/source workflows|source workflows|Candidate Center/);
  // P01 historical handler remains inert and no longer controls C01 selection.
  const server=read('ai-proxy/server.mjs');
  assert.match(server,/SI_P01_OUT_OF_CURRENT_POC_SCOPE/);
});


test('PSC quota settings auto-load published policy; credentials guard changes, not initial display',()=>{
  const screen=read('src/app/pages/si-psc-quota-settings.component.ts');
  const api=read('src/app/services/si-psc-selection.service.ts');
  const server=read('ai-proxy/server.mjs');
  assert.match(screen,/ngOnInit\(\):void\{this\.load\(\);\}/);
  assert.match(screen,/this\.api\.policy\(\)\.subscribe\(/);
  assert.match(screen,/\*ngIf="policy as p"/);
  assert.match(screen,/Preview & Approval Access/);
  assert.match(screen,/this\.api\.preview\(this\.editorKey\.trim\(\),config\)/);
  assert.match(screen,/this\.api\.publish\(this\.publisherKey\.trim\(\),/);
  assert.match(screen,/\*ngIf="!policy&&!busy&&error"/);
  assert.match(api,/policy\(\):Observable/);
  assert.match(api,/this\.base\+'\/policy'\);/);
  assert.match(server,/GET'&&path==='\/api\/si\/v1\/psc-selection\/policy'\)[\s\S]{0,380}siPscSelection\.policy\(\)/);
  assert.match(server,/POST'&&path==='\/api\/si\/v1\/psc-selection\/policy\/preview'\)\{\s*dashboards\.assertRole\(req,'EDITOR'\)/);
  assert.match(server,/POST'&&path==='\/api\/si\/v1\/psc-selection\/policy\/publish'\)\{\s*dashboards\.assertRole\(req,'PUBLISHER'\)/);
  assert.match(server,/POST'&&path==='\/api\/si\/v1\/psc-selection\/decision'\)\{\s*dashboards\.assertRole\(req,'PUBLISHER'\)/);
});

test('all sidebar submenus collapse initially, even on bookmarks or refresh',()=>{
  for(const initialization of [
    "main:MainMaritimeGroup|null=null",
    "settings:SettingsMaritimeGroup|null=null",
    "dashboard:MaritimeDashboardGroup|null=null"
  ])assert.ok(sidebarMenu.includes(initialization),initialization);
  assert.ok(navTs.includes('NmcSidebarMenuStateService'));
  for(const bad of [
    'expandSelectedDashboard','this.smartInspectionExpanded = true',
    'this.settingsExpanded = true'
  ])assert.ok(!navTs.includes(bad),'Unexpected route-driven expansion: '+bad);
  for(const bad of ['localStorage.setItem','sessionStorage.setItem','fetch('])
    assert.ok(!sidebarMenu.includes(bad),'Menu state must not be persisted: '+bad);
});

test('NMC, Smart Inspection, Settings: one main submenu open per explicit click',()=>{
  for(const area of ['nmc','smart','settings'])
    assert.ok(nav.includes("toggleMain('"+area+"')"));
  for(const expanded of ['nmcExpanded','smartInspectionExpanded','settingsExpanded']){
    assert.ok(nav.includes('[attr.aria-expanded]="'+expanded+'"'));
    assert.ok(nav.includes('[hidden]="!'+expanded+'"'));
  }
  assert.ok(sidebarMenu.includes('toggleMain(group:MainMaritimeGroup):void'));
  assert.ok(sidebarMenu.includes('if(this.main===group){'));
  assert.ok(sidebarMenu.includes('this.main=null'));
  assert.ok(sidebarMenu.includes('this.main=group'));
});

test('nested Settings sections and published Dashboards expand by user click only',()=>{
  for(const area of ['nmc','inspection'])
    assert.ok(nav.includes("toggleSettings('"+area+"')"));
  for(const area of ['nmc','smart','settings'])
    assert.ok(nav.includes("toggleDashboard('"+area+"')"));
  assert.ok(sidebarMenu.includes('this.settings=group'));
  assert.ok(sidebarMenu.includes('this.settings=null'));
  assert.ok(sidebarMenu.includes("if(this.main!==group)return"));
  assert.ok(nav.includes('[hidden]="!nmcSettingsExpanded"'));
  assert.ok(nav.includes('[hidden]="!inspectionSettingsExpanded"'));
});

test('opened sidebar survives Angular route changes without reopening on deep links',()=>{
  assert.ok(sidebarMenu.includes("@Injectable({providedIn:'root'})"));
  assert.ok(navTs.includes("return this.menuState.main==='nmc'"));
  assert.ok(navTs.includes("return this.menuState.main==='smart'"));
  assert.ok(navTs.includes("return this.menuState.main==='settings'"));
  assert.ok(navTs.includes('private updateRoute(url: string): void'));
  assert.ok(navTs.includes('this.currentPath = url'));
  assert.ok(!navTs.includes('expandSelectedDashboard'));
});

test('Seafarer Management is a first-class maritime menu and all five pages are routed',()=>{
  assert.ok(sidebarMenu.includes("'seafarers'"),
    'seafarer menu must use the same single-expanded-group state');
  assert.ok(navTs.includes('get seafarersExpanded()'));
  assert.ok(nav.includes("toggleMain('seafarers')"));
  assert.ok(nav.includes('[hidden]="!seafarersExpanded"'));
  for(const route of [
    'moei/seafarers/readiness',
    'moei/seafarers/services',
    'moei/seafarers/company',
    'moei/seafarers/notifications',
    'moei/seafarers/fulfilment'
  ]){
    assert.ok(routes.includes("path: '"+route+"'"),'route missing: '+route);
    assert.ok(nav.includes('routerLink="/'+route+'"'),
      'sidebar link missing: '+route);
  }
  assert.ok(routes.includes("route.path?.startsWith('moei/seafarers')?"),
    'seafarer login return-path guard must precede the generic MOEI guard');
  assert.ok(chrome.includes("'smart-inspection'|'seafarers'"),
    'shared maritime header must support Seafarer page context');
});

test('Supervisor Approval reserves fixed sidebar width in LTR/RTL and collapses it on mobile',()=>{
 const supervisor=read('src/app/pages/si-supervisor-review.component.ts');
 assert.match(supervisor,/class="supervisor-shell" \[attr\.dir\]="lang\.dir"/);
 assert.match(supervisor,/\.supervisor-shell\{display:flex;min-height:calc\(100vh - 82px\);width:100%/);
 assert.match(supervisor,/padding-inline-start:240px/);
 assert.match(supervisor,/@media \(min-width:961px\) and \(max-width:1220px\)/);
 assert.match(supervisor,/\.supervisor-shell\{padding-inline-start:66px\}/);
 assert.match(supervisor,/@media \(max-width:960px\)/);
 assert.match(supervisor,/\.supervisor-shell\{padding-inline-start:0\}/);
 assert.match(navCss,/\.nmc-unified-sidebar \{[\s\S]*?position: fixed;[\s\S]*?width: 240px/);
});
