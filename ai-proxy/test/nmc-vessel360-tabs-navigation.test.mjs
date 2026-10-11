import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const files={
  routes:'src/app/app.routes.ts',
  navTs:'src/app/components/nmc-navigation.component.ts',
  navHtml:'src/app/components/nmc-navigation.component.html',
  v360Ts:'src/app/pages/nmc-vessel-360.component.ts',
  v360Html:'src/app/pages/nmc-vessel-360.component.html',
  riskEngine:'src/app/services/nmc-risk-engine.service.ts',
  riskAdmin:'src/app/pages/nmc-risk-configuration-admin.component.ts',
  explainTs:'src/app/pages/nmc-risk-explainability.component.ts',
  explainHtml:'src/app/pages/nmc-risk-explainability.component.html',
  backendPolicy:'ai-proxy/risk-policy.mjs',
  fleet:'ai-proxy/fleet-ai.mjs'
};
const src=Object.fromEntries(Object.entries(files).map(([k,p])=>
  [k,readFileSync(new URL('../../'+p,import.meta.url),'utf8')]));

test('root and unknown routes lead to National Maritime Command Center',()=>{
  assert.match(src.routes,/path:\s*'',\s*pathMatch:\s*'full',\s*redirectTo:\s*'moei\/nmc'/);
  assert.match(src.routes,/path:\s*'\*\*',\s*redirectTo:\s*'moei\/nmc'/);
});
test('navigation starts CLOSED and is opened by the user's menu button only',()=>{
  for(const state of ['nmcExpanded','smartInspectionExpanded','settingsExpanded'])
    assert.match(src.navTs,new RegExp(state+' = false;'));
  assert.match(src.navTs,/menuOpen = false;/);
  assert.match(src.navHtml,/\(click\)="menuOpen = !menuOpen/);
  assert.match(src.navHtml,/\[class\.user-open\]="menuOpen"/);
  assert.doesNotMatch(src.navTs,/this\.nmcExpanded\s*=\s*true;/);
});
test('five-factor A01/A02 risk policy: no new A03 weighting, no sixth factor on fresh scores',()=>{
  const activeKeys=src.riskAdmin.match(/readonly factorKeys: RiskFactorKey\[\] = \[([\s\S]*?)\];/)?.[1]||'';
  for(const key of ['movement','inspection','certificate','dataQuality','history'])
    assert.ok(activeKeys.includes(key),key+' expected');
  assert.ok(!activeKeys.includes('documentIntegrity'),'A03 should not appear in factor editor');
  assert.match(src.backendPolicy,/A03_RISK_FACTOR_RETIRED/);
  assert.match(src.fleet,/const signals=validated;/);
  assert.match(src.fleet,/A03_RISK_FACTOR_RETIRED/);
  assert.match(src.riskEngine,/copy\.weights\.documentIntegrity=0;/);
  assert.match(src.explainTs,/factorOrder:FactorKey\[\]=\['movement','inspection','certificate','dataQuality','history'\]/);
  assert.doesNotMatch(src.explainHtml,/missingRequiredA03|CURRENT POLICY · A03 EVIDENCE REQUIRED/);
});
test('every Vessel 360 tab has corresponding rendered data, no placeholder movement tab',()=>{
  const tabNames=['overview','movement','compliance','inspection',
    'external-psc','certificates','documents','sources','accidents'];
  for(const tab of tabNames){
    assert.ok(src.v360Html.includes("setTab('"+tab+"')"),
      'tab '+tab+' needs a working click handler');
    assert.ok(src.v360Html.includes("activeTab === '"+tab+"'")||
      src.v360Html.includes("activeTab==='"+tab+"'"),
      'tab '+tab+' needs a rendered view');
  }
  for(const p of ['vessel.speed','vessel.course','vessel.destination','vessel.eta','vessel.navStatus'])
    assert.ok(src.v360Html.includes(p),'missing movement field '+p);
  assert.doesNotMatch(src.v360Html,/class="placeholder-grid"/);
  assert.match(src.v360Html,/<app-nmc-vessel-documents/);
  assert.match(src.v360Html,/externalPsc/);
  assert.match(src.v360Html,/\*ngFor="let inspection of inspections"/);
  assert.match(src.v360Html,/\*ngFor="let certificate of certificates"/);
});
test('Accidents only appears when an IMO has a source report; no fabricated incident data',()=>{
  assert.match(src.v360Html,/\*ngIf="hasAccidents"\s*\[class\.active\]="activeTab === 'accidents'"/);
  assert.match(src.v360Ts,/feed\.incidents\.filter\(r=>r\.imo===this\.vessel\.imo\)/);
  assert.match(src.v360Ts,/get hasAccidents\(\):boolean/);
  assert.match(src.v360Html,/\*ngFor="let accident of accidents"/);
  for(const field of ['description','sourceOrganization','sourceReference',
    'reportedAt','portOrZone','reportedSeverity','sourceIncidentStatus',
    'operationalStatus','linkedCaseId']){
    assert.ok(src.v360Html.includes('accident.'+field),'missing incident data '+field);
  }
  assert.match(src.v360Html,/accident\.aiAssessment && !accident\.aiAssessmentStale/);
});
test('no fake task buttons; workflow is authoritative Case Management',()=>{
  assert.doesNotMatch(src.v360Html,/Export vessel brief|startCertificateVerification\(|createPriorityInspection\(/);
  assert.doesNotMatch(src.v360Ts,/certificateVerificationStarted|priorityInspectionCreated/);
  assert.match(src.v360Html,/Review actions in Case Management/);
  assert.match(src.v360Html,/Follow-up through Case Management/);
  assert.doesNotMatch(src.v360Html,/Verification task VER-2026-00872 created/);
  assert.doesNotMatch(src.v360Html,/class="conflict-panel"/);
  assert.match(src.v360Ts,/else if\(source\.includes\('Data Quality'\)\)this\.setTab\('sources'\)/);
});
