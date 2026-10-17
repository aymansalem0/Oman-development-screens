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
 // Capacity-first navigation now originates from each saved plan card,
 // not a removed activePlanId link in the old single-plan banner.
 assert.match(html,/\[routerLink\]="\['\/moei\/smart-inspection\/plan\/create',p\.id\]"/);
 assert.match(html,/\[queryParams\]="\{stage:'capacity'\}"/);
 assert.match(html,/si-rolling-management/);
 assert.match(html,/\(click\)="generateIntegratedDraft\(\)"/);
 assert.match(html,/\(click\)="saveIntegratedDraft\(\)"/);
 assert.match(ts,/this\.http\.post<IntegratedDraftJob>\('\/api\/si\/v1\/inspection-plans\/draft-preview'/);
 assert.match(ts,/draft-jobs\//);
 assert.match(ts,/completedBatches/);
 assert.match(backend,/draft-\(recalculate\|save\)/);
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


test('saved capacity and inspector assignments are a native, collapsed-by-default disclosure',()=>{
 const start=html.indexOf('<details *ngIf="plan?.capacityDraft as cap"');
 const end=html.indexOf('</details>',start);
 assert.ok(start>=0&&end>start,
  'Saved Draft section must be wrapped in native accessible details');
 const body=html.slice(start,end);
 assert.match(body,/data-testid="si-saved-capacity-details"/);
 assert.match(body,/<summary class="si-saved-capacity-summary"/);
 assert.match(body,/data-testid="si-saved-capacity-toggle"/);
 assert.ok(!body.slice(0,body.indexOf('>')).includes(' open'),
  'the long capacity section must start collapsed');
 for(const required of [
  "cap.status","cap.generatedAt","cap.selectedImos.length",
  "cap.proposedAssignments.length","cap.mandatoryUnscheduled.length",
  "cap.capacityExcluded?.length","cap.unscheduled.length",
  'class="si-draft-saved-assignments"','class="si-draft-stats"',
  'Show details','Hide details'
 ])assert.ok(body.includes(required),'missing saved capacity content '+required);
 assert.ok(css.includes('.si-saved-capacity-summary:focus-visible'));
 assert.ok(css.includes('.si-saved-capacity-details[open]'));
 assert.ok(css.includes('@media(max-width:760px)'));
});

test('planning subsections default to independent disclosures and preserve source/consent action flow',()=>{
 const names=[
  'si-plan-policy-disclosure','si-plan-consent-disclosure',
  'si-plan-proposal-disclosure','si-supervisor-scheduling-add-panel',
  'si-plan-capacity-inputs-disclosure','si-plan-vessel-visit-disclosure',
  'si-saved-plan-list-disclosure'
 ];
 for(const name of names)assert.ok(html.includes('data-testid="'+name+'"'),
  'missing disclosure '+name);
 const tags=[...html.matchAll(/<details\b[^>]*>/g)];
 assert.equal(tags.length,(html.match(/<\/details>/g)||[]).length,
  'all plan disclosure elements must be closed');
 assert.ok(tags.every(x=>!/(?:^|\s)open(?:\s|=|>)/.test(x[0])),
  'all plan subsections must default to collapsed');
 assert.match(html,/\(click\)="generateIntegratedDraft\(\)"/);
 assert.match(html,/\(click\)="recalculateIntegratedDraft\(\)"/);
 assert.match(html,/\(click\)="saveIntegratedDraft\(\)"/);
 assert.ok(html.includes('draft.mandatoryUnscheduled.join'));
 assert.ok(html.includes('newDraftScope?.requiresOfficerAction'));
 assert.ok(css.includes('.si-plan-disclosure[open] > .si-plan-disclosure-summary'));
 assert.ok(css.includes('.si-plan-disclosure-summary:focus-visible'));
});
test('vessel inclusion and removal controls align in trailing row column in LTR and RTL',()=>{
 assert.ok(html.includes('class="si-plan-scheduling-action-cell"'));
 assert.ok(html.includes('class="si-plan-vessel-row-actions"'));
 assert.ok(html.includes('class="si-plan-alternative-header"'));
 assert.ok(html.includes('class="si-plan-alternative-actions"'));
 assert.ok(css.includes('.si-draft-table td.si-plan-scheduling-action-cell'));
 assert.ok(css.includes('.si-plan-vessel-row-actions{display:flex'));
 assert.ok(css.includes('.si-plan-alternative-header{display:flex'));
 assert.ok(css.includes('.si-plan-alternative-actions{display:flex'));
 assert.ok(css.includes('text-align:end'));
 assert.ok(css.includes('justify-content:flex-end'));
 assert.match(html,/\(click\)="toggleDraftVesselForScheduling\(row\)"/);
 assert.match(html,/\(click\)="toggleDraftAlternative\(choice,true\)"/);
});

test('C01 is checked by default only when a new plan starts, and still requires manual execution confirmation',()=>{
 assert.match(ts,/newDraftDemoMode=true;newDraftAiConsent=true;/);
 const start=ts.indexOf('openCreatePlan():void{');
 const end=ts.indexOf('refreshDraftScope():void{',start);
 assert.ok(start>=0&&end>start);
 assert.ok(ts.slice(start,end).includes('this.newDraftAiConsent=true;'));
 const refresh=ts.slice(end,ts.indexOf('draftParametersChanged():void{',end));
 assert.ok(!refresh.includes('this.newDraftAiConsent=false'),
   'loading source policy should not uncheck the default or override manual opt out');
 assert.match(html,/\[\(ngModel\)\]="newDraftAiConsent"/);
 assert.match(ts,/this\.newDraftBusy\|\|!this\.newDraftAiConsent/);
 const action=ts.slice(ts.indexOf('generateIntegratedDraft():void{'),
   ts.indexOf('capacityBlockerText(',ts.indexOf('generateIntegratedDraft():void{')));
 assert.ok(action.includes('window.confirm('),
   'C01 job must not be started solely by the prechecked UI option');
 assert.ok(action.includes('confirmAi:true,confirmCost:true'),
   'AI job requires the explicit confirmation on Generate');
});
