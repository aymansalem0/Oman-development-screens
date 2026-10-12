import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=(path)=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const html=read('src/app/pages/nmc-command-center.component.html');
const code=read('src/app/pages/nmc-command-center.component.ts');
const api=read('ai-proxy/server.mjs');
const policy=read('ai-proxy/nmc-dashboard-focus.mjs');

test('single boundary replaces three disconnected repeated KPI panels',()=>{
  assert.equal((html.match(/class="nmc-unified-kpi-board"/g)||[]).length,1);
  assert.doesNotMatch(html,/class="fleet-ai-overview"|class="kpi-grid"|class="nmc-incident-ribbon"/);
  assert.match(html,/\*ngFor="let kpi of dashboardKpis;trackBy:dashboardKpiTrack"/);
  assert.match(html,/\[class\.nmc-ai-selected\]="aiFocusedKpi\(kpi\.id\)"/);
});

test('eight unique counts, high and critical separate, no inverse assessed/pending duplication',()=>{
  const keys=['vesselContacts','assessedVessels','highRiskVessels',
    'criticalRiskVessels','requiresAttention','activeAlerts','openCases','activeIncidents'];
  for(const id of keys){
    assert.ok(code.includes("id:'"+id+"'"),'missing UI card: '+id);
    assert.ok(policy.includes(id+":"),'missing approved backend metric: '+id);
  }
  const summary=html.slice(html.indexOf('class="nmc-unified-kpi-board"'),
    html.indexOf('class="workspace-grid"'));
  // Pending remains an operational fleet FILTER count; it must not be
  // repeated as a headline KPI in the new unified board.
  assert.doesNotMatch(summary,/\{\{pendingCount\}\}|\{\{highRiskCount\}\}|\{\{priorityReviewCount\}\}/);
  assert.match(code,/this\.fleetSnapshot\?\.counts\.high/);
  assert.match(code,/this\.fleetSnapshot\?\.counts\.critical/);
});

test('page load and polling cannot trigger Airia focus; explicit click is the only run trigger',()=>{
  assert.match(html,/\(click\)="requestAiKpiFocus\(\)"/);
  assert.match(code,/if\(!confirmed\)return;/);
  assert.match(code,/this\.aiKpi\.run\(values\)/);
  assert.match(api,/dashboards\.assertRole\(req,'EDITOR'\)/);
  const uiRuns=code.match(/this\.aiKpi\.run\(/g)||[];
  assert.equal(uiRuns.length,1);
  assert.match(code,/this\.aiKpi\.status\(\)\.subscribe/);
  assert.match(api,/if\(req\.method!=='POST'\)return respond\(res,405/);
  assert.match(policy,/automaticAiCalls:false/);
});

test('no AI badge when source counts changed or Airia is disabled',()=>{
  assert.match(code,/this\.aiFocusIsCurrent&&this\.aiKpiFocus\?\.selection\.metricId===id/);
  assert.match(html,/\[disabled\]="!aiKpiFocusAvailable\|\|aiKpiFocusBusy"/);
  assert.match(html,/\*ngIf="aiKpiFocus&&!aiFocusIsCurrent"/);
  assert.match(html,/\*ngIf="aiKpiFocus && aiFocusIsCurrent"/);
  assert.match(html,/lang\.isArabic\?aiKpiFocus\.selection\.reasonAr:aiKpiFocus\.selection\.reasonEn/);
});

test('KPI cards use compact desktop height without hiding mobile AI focus',()=>{
  const css=read('src/app/pages/nmc-command-center.component.css');
  const card=css.match(/\.nmc-unified-kpi-card\{([\s\S]*?)\}/);
  assert.ok(card,'KPI card CSS rule not found');
  const height=card[1].match(/min-height:(\d+)px/);
  assert.ok(height,'KPI card minimum height not specified');
  assert.ok(Number(height[1])<=115,'desktop cards should be compact');
  assert.match(css,/\.nmc-unified-kpi-grid\{\s*display:grid;grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(css,/\.nmc-unified-kpi-card\.nmc-ai-selected/);
  assert.match(css,/@media\(max-width:600px\)/);
});
