import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const html=read('src/app/pages/nmc-dashboard-builder.component.html');
const ts=read('src/app/pages/nmc-dashboard-builder.component.ts');
const store=read('src/app/services/nmc-dashboard-store.service.ts');

test('only the named AI continuous improvement published board gets contextual results filters',()=>{
 assert.match(ts,/this.dashboard.title==='AI Continuous Improvement'/);
 assert.match(ts,/this.dashboard.widgets.every\(w=>isAiCiMetric\(w.metric\)\)/);
 const a=html.indexOf('data-testid="ai-ci-contextual-results-filters"');
 const b=html.indexOf('data-testid="nmc-vessel-results-filters"');
 assert.ok(a>0&&b>a);
 assert.ok(html.slice(a-150,a).includes('viewOnly&&isAiContinuousImprovementDashboard'));
 assert.ok(html.slice(b-160,b).includes('viewOnly&&!isAiContinuousImprovementDashboard'));
 const ci=html.slice(a,b);
 assert.match(ci,/data-testid="ai-ci-filter-area"/);
 assert.match(ci,/data-testid="ai-ci-filter-evidence"/);
 assert.match(ci,/data-testid="ai-ci-filter-search"/);
 assert.doesNotMatch(ci,/board.filters.(risk|type|flag|search)/);
 const fleet=html.slice(b,html.indexOf('<div class="db-layout"'));
 for(const filter of ['risk','type','flag','search'])
  assert.ok(fleet.includes('board.filters.'+filter),'original vessel filter lost '+filter);
});

test('AI dashboard filters display real matching widgets without inventing aggregate recalculations',()=>{
 assert.match(ts,/get visiblePreviewWidgets\(\):DashboardWidget\[\]/);
 assert.match(ts,/this.ciMetricArea\(w.metric\)===this.ciViewArea/);
 assert.match(ts,/this.ciIsMeasured\(w.metric\)/);
 assert.match(ts,/w.title.toLowerCase\(\).includes\(query\)/);
 assert.match(html,/\*ngFor="let widget of visiblePreviewWidgets; let i=index"/);
 assert.match(html,/visiblePreviewWidgets.length:previewCardsCount/);
 assert.match(html,/data-testid="ai-ci-no-matching-metrics"/);
 assert.match(html,/Filters control visible widgets only/);
 assert.ok(store.includes("board.title='AI Continuous Improvement'"));
 assert.match(ts,/if\(!this.viewOnly\|\|!this.isAiContinuousImprovementDashboard\)return widgets;/);
});
