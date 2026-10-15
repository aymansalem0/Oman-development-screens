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
 // The main candidate queue is still ONE grid. A second table is now
 // permitted ONLY inside the conditional pre-save capacity preview.
 assert.equal((html.match(/<table/g)||[]).length,2);
 assert.match(html,/\*ngIf="newDraftPreview as draft"/);
 assert.match(html,/\*ngFor="let row of draft.items"/);
 assert.match(html,/\*ngFor="let v of vessels;trackBy:trackVessel"/);
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
test('officer can include, remove, defer or mark nonmandatory sources N/A without AI; rerank with explicit cost confirmation',()=>{
 for(const x of [
  "(click)=\"openManualDecision(v,'INCLUDE')\"",
  "(click)=\"openManualDecision(v,'NOT_SELECTED')\"",
  "(click)=\"openManualDecision(v,'DEFER')\"",
  "(click)=\"openManualDecision(v,'NOT_APPLICABLE')\"",
  "(click)=\"openPlanEdit(v,true,true)\"",
  "(ngSubmit)=\"savePlanEdit()\"",
  "[(ngModel)]=\"planReason\"",
  "[(ngModel)]=\"planRequestedRank\""
 ])assert.ok(html.includes(x),'missing '+x);
 assert.match(html,/required minlength="8"/);
 assert.match(ts,/this\.api\.selectRollingVessel\(/);
 assert.match(html,/\(ngSubmit\)="saveManualDecision\(\)"/);
 assert.match(html,/\[\(ngModel\)\]="manualReviewAfter"/);
 assert.match(ts,/this\.submitPlanReevaluation\(\{/);
 assert.match(ts,/confirmRun:true,confirmCost:!mock/);
 assert.match(backend,/siInspectionPlan\.select/);
});
test('AI why-selected and why-ranked explanations appear in a single expandable row',()=>{
 assert.match(html,/toggleVesselDetail\(v\)/);
 assert.match(html,/planRow\(v\)\?\.selectionReason/);
 assert.match(html,/planRow\(v\)\?\.priorityReason/);
 assert.match(html,/planRow\(v\)\?\.evidenceRefs/);
 assert.match(html,/planRow\(v\)\?\.officerReason/);
});
test('rolling inspection plan contains no port selector or port payload',()=>{
 assert.match(html,/Inspection Planning Management/);
 assert.match(html,/\[\(ngModel\)\]="newPlan\.title"/);
 assert.match(html,/\[\(ngModel\)\]="newPlan\.startsOn"/);
 assert.match(html,/\[\(ngModel\)\]="newPlan\.endsOn"/);
 assert.match(html,/\[\(ngModel\)\]="newPlan\.notes"/);
 assert.doesNotMatch(html,/newPlan\.port|Port \/ Location|الميناء \/ الموقع/);
 assert.doesNotMatch(ts,/newPlan\.port|port:''/);
 assert.doesNotMatch(svc,/port\?:string;notes\?:string/);
});
test('one official supervisor approval covers the plan, not each vessel row',()=>{
 assert.match(html,/\[routerLink\]="\['\/moei\/smart-inspection\/plan\/create',activePlanId\]"/);
 assert.match(html,/si-rolling-management/);
 assert.match(html,/\(click\)="generateIntegratedDraft\(\)"/);
 assert.match(html,/\(click\)="saveIntegratedDraft\(\)"/);
 assert.match(ts,/this\.http\.post<DraftIntegratedPreview>\('\/api\/si\/v1\/inspection-plans\/draft-preview'/);
 assert.match(backend,/inspection-plans\/draft-save/);
 assert.doesNotMatch(html,/\(click\)="decide\('APPROVE'\)"/);
 assert.doesNotMatch(html,/\[\(ngModel\)\]="publisherKey"/);
 assert.match(backend,/const siInspectionPlan=new SiInspectionPlan/);
 assert.match(backend,/const siBulkPlan=new SiBulkInspectionPlan/);
 assert.match(backend,/siBulkPlan\.approve/);
 assert.match(backend,/dashboards\.assertRole\(req,'PUBLISHER'\)/);
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
