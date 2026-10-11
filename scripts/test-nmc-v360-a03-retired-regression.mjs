import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const src=(path)=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('Vessel 360 has no Documents / A03 tab, content component or route',()=>{
  const html=src('src/app/pages/nmc-vessel-360.component.html');
  const ts=src('src/app/pages/nmc-vessel-360.component.ts');
  assert.doesNotMatch(html,/activeTab\s*===?\s*['"]documents['"]|setTab\(['"]documents['"]\)|<app-nmc-vessel-documents|Documents\s*\/\s*A03/);
  assert.doesNotMatch(ts,/NmcVesselDocumentsComponent|['"]documents['"]\s*,\s*['"]sources['"]/);
  assert.match(ts,/this\.incidentsService\.list\(\)/);
  assert.match(ts,/row\.imo===this\.vessel\.imo/);
  assert.match(html,/\*ngIf="hasAccidents"/);
});

test('Admin risk factor editor contains only the five A01/A02 risk factors',()=>{
  const ts=src('src/app/pages/nmc-risk-configuration-admin.component.ts');
  const list=ts.match(/readonly factorKeys:\s*RiskFactorKey\[\]\s*=\s*\[([\s\S]*?)\];/);
  assert.ok(list,'factorKeys array missing');
  for(const key of ['movement','inspection','certificate','dataQuality','history'])
    assert.match(list[1],new RegExp("'"+key+"'"));
  assert.doesNotMatch(list[1],/documentIntegrity/);
  assert.doesNotMatch(ts,/Document integrity \(A03\)/);
});

test('Current five-factor vessel scoring rejects A03 weighting, without mutating history',()=>{
  const policy=src('ai-proxy/risk-policy.mjs');
  const fleet=src('ai-proxy/fleet-ai.mjs');
  const engine=src('src/app/services/nmc-risk-engine.service.ts');
  assert.match(policy,/A03_RISK_FACTOR_RETIRED/);
  assert.match(fleet,/A03_RISK_FACTOR_RETIRED/);
  assert.match(fleet,/const signals=validated;/);
  assert.match(engine,/copy\.weights\.documentIntegrity=0;/);
  assert.match(engine,/const keys: RiskFactorKey\[\] = \['movement', 'inspection', 'certificate', 'dataQuality', 'history'\]/);
});

test('Existing A01 provenance and Command Center incident filter functionality is preserved',()=>{
  const nmc=src('src/app/pages/nmc-command-center.component.html');
  const cases=src('ai-proxy/server.mjs');
  assert.match(nmc,/\[\(ngModel\)\]="incidentFilter"/);
  assert.match(nmc,/attention-incident-shortcut/);
  assert.match(cases,/caseA01SourcePreview/);
  assert.match(cases,/historicalApprovalValid/);
});
