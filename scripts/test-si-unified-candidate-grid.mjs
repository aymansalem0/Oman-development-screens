import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const ts=read('src/app/pages/si-candidate-workbench.component.ts');
const html=read('src/app/pages/si-candidate-workbench.component.html');
const css=read('src/app/pages/si-candidate-workbench.component.css');
const backend=read('ai-proxy/server.mjs');
const svc=read('src/app/services/si-candidate-targeting.service.ts');
test('one compact stats-first, one source-backed candidate grid; no stage panels',()=>{
 assert.ok(html.indexOf('class="stats si-kpis"')<
   html.indexOf('class="si-panel si-unified-queue"'));
 assert.ok(html.indexOf('class="si-panel si-unified-queue"')<
   html.indexOf('class="si-unified-table"'));
 assert.equal((html.match(/<table/g)||[]).length,1);
 assert.doesNotMatch(html,/Stage 1 ·|Stage 2 ·|Stage 3 ·|class="si-panel ai-ranking-panel"/);
 assert.doesNotMatch(html,/class="si-panel si-c01-panel"/);
 assert.match(html,/\*ngFor="let v of vessels;trackBy:trackVessel"/);
});
test('visible AI-selected count is advisory and distinct from approved cases',()=>{
 assert.match(html,/AI RECOMMENDED FOR INSPECTION/);
 assert.match(html,/aiSelectedCount===null\?'—':aiSelectedCount/);
 assert.match(html,/CURRENT INSPECTION PLAN/);
 assert.match(html,/planSelectedCount===null\?'—':planSelectedCount/);
 assert.match(html,/APPROVED INSPECTION CASES/);
 assert.match(html,/d\.summary\.inspectionsCreated/);
 assert.match(html,/not approved/);
});
test('officer can remove/include/change rank directly on vessel row, with mandatory reason',()=>{
 for(const x of [
  "(click)=\"openPlanEdit(v,false)\"",
  "(click)=\"openPlanEdit(v,true)\"",
  "(click)=\"openPlanEdit(v,true,true)\"",
  "(ngSubmit)=\"savePlanEdit()\"",
  "[(ngModel)]=\"planReason\"",
  "[(ngModel)]=\"planRequestedRank\""
 ])assert.ok(html.includes(x),'missing '+x);
 assert.match(html,/required minlength="8"/);
 assert.match(ts,/this\.submitPlanReevaluation\(\{/);
 assert.match(ts,/confirmRun:true,confirmCost:!mock/);
});
test('AI why-selected and why-ranked explanations appear in a single expandable row',()=>{
 assert.match(html,/toggleVesselDetail\(v\)/);
 assert.match(html,/planRow\(v\)\?\.selectionReason/);
 assert.match(html,/planRow\(v\)\?\.priorityReason/);
 assert.match(html,/planRow\(v\)\?\.evidenceRefs/);
 assert.match(html,/planRow\(v\)\?\.officerReason/);
});
test('official supervisor inspection approval remains separate from advisory plan changes',()=>{
 assert.match(html,/decide\('APPROVE'\)/);
 assert.doesNotMatch(html,/\[\(ngModel\)\]="publisherKey"/);
 assert.match(html,/decide\('APPROVE'\)/);
 assert.match(backend,/const siInspectionPlan=new SiInspectionPlan/);
 assert.match(backend,/siInspectionPlan\.rerank/);
 assert.match(backend,/dashboards\.assertRole\(req,'EDITOR'\)/);
 assert.match(svc,/rerankInspectionPlan/);
});
test('compact layout keeps existing source, risk and vessel-level status context',()=>{
 assert.match(css,/\.si-kpis\{grid-template-columns:repeat\(6,minmax\(0,1fr\)\)/);
 assert.match(css,/\.si-unified-table\{/);
 assert.match(css,/@media\(max-width:550px\)/);
 assert.match(html,/v\.sourceTypes/);
 assert.match(html,/v\.sourceEvents\.length/);
 assert.match(html,/v\.currentRisk/);
});

test('Inspection Candidate & Targeting is the FIRST Smart Inspection menu screen',()=>{
 const menu=read('src/app/components/nmc-navigation.component.html');
 const sub=menu.split('id="si-main-submenu"')[1]?.split('</div>')[0]||'';
 assert.ok(sub.includes('routerLink="/moei/smart-inspection/candidates"'),
  'Candidate targeting should lead the Smart Inspection submenu');
});
