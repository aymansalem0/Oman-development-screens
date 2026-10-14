import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=x=>readFileSync(new URL('../'+x,import.meta.url),'utf8');
const routes=read('src/app/app.routes.ts');
const grid=read('src/app/pages/si-candidate-workbench.component.html');
const wizard=read('src/app/pages/si-inspection-plan-wizard.component.ts');
const backend=read('ai-proxy/si-bulk-inspection-plan.mjs');
const cases=read('ai-proxy/si-candidate-targeting.mjs');
const prep=read('ai-proxy/si-inspection-preparation.mjs');
const detail=read('src/app/pages/si-inspection-preparation.component.html');
const server=read('ai-proxy/server.mjs');
const capacity=read('ai-proxy/si-capacity-plan.mjs');
const atomic=read('ai-proxy/si-capacity-plan-approval.mjs');

test('candidate screen opens separate capacity-first Inspection Plan wizard',()=>{
 assert.match(grid,/routerLink.*plan\\/create/);
 assert.match(routes,/path: 'moei\\/smart-inspection\\/plan\\/create\\/:planId'/);
 assert.match(routes,/path: 'moei\\/smart-inspection\\/plan\\/create'/);
 assert.doesNotMatch(grid,/<app-si-bulk-approval-panel/);
 assert.match(wizard,/Candidate Vessels/);
 assert.match(wizard,/Referral Evidence/);
 assert.match(wizard,/Weights & Capacity/);
 assert.match(wizard,/Unified Plan Approval/);
});

test('stepper preserves all statutory sources without single regime selector',()=>{
 assert.doesNotMatch(wizard,/choices\\[/);
 assert.match(wizard,/vessel\\.reasons\\.length/);
 assert.match(wizard,/source\\.sourceReference/);
 assert.match(wizard,/source\\.inspectionRegime/);
 assert.match(wizard,/this\\.api\\.approveCapacityPlan\\(/);
 assert.doesNotMatch(wizard,/this\\.api\\.approveForScheduling\\(/);
 assert.match(wizard,/createdInspectionCases/);
 assert.doesNotMatch(wizard,/candidateKey:this\\.choices/);
});

test('capacity preflight before approval and atomic Oracle work orders are mandatory',()=>{
 assert.match(server,/SI_CAPACITY_FIRST_PREVIEW_AND_APPROVAL_REQUIRED/);
 assert.match(server,/capacity-preview/);
 assert.match(server,/approve-capacity/);
 assert.match(server,/capacity-ai-recommend/);
 assert.match(server,/commitCapacityFirstPlan/);
 assert.match(capacity,/readyForApproval/);
 assert.match(capacity,/UNKNOWN_RISK_IS_NOT_ASSUMED_ZERO_RISK/);
 assert.match(atomic,/ROLLING_PLAN_VERSION/); // version row written in the same transaction
 assert.match(atomic,/SI_SCHED_WORK_ORDER/);
 assert.match(atomic,/await con\\.commit\\(\\)/);
 assert.match(backend,/inspectionReasons:v\\.reasons/);
 assert.match(backend,/preview\\.vessels\\.some\\(v=>v\\.missingSource/);
 assert.doesNotMatch(backend,/requiresRegimeChoice/);
});

test('four source and risk percentage sliders restored without bypassing human approval',()=>{
 assert.match(wizard,/type="range"/);
 assert.match(wizard,/NMC_CASE/);
 assert.match(wizard,/SERVICE_REQUEST/);
 assert.match(wizard,/PSC_PORT_CALL/);
 assert.match(wizard,/RISK_FACTOR/);
 assert.match(wizard,/weightTotal/);
 assert.match(wizard,/capacity\\?\\.readyForApproval/);
 assert.match(wizard,/this\\.api\\.capacityPreview\\(/);
 assert.match(wizard,/this\\.api\\.capacityAiRecommend\\(/);
 assert.match(wizard,/confirmCrossPort/);
});

test('all official source reasons and inspection objectives are retained for SI-02',()=>{
 assert.match(cases,/async decideBatch\\(/);
 assert.match(cases,/inspectionReasons:reasons/);
 assert.match(cases,/candidateKeys/);
 assert.match(cases,/inspectionScopes:regimes\\.map/);
 assert.match(prep,/sourceInspectionObjectives/);
 assert.match(prep,/allInspectionReasons/);
 assert.match(detail,/d\\.context\\.inspectionReasons/);
 assert.match(detail,/d\\.context\\.sourceInspectionObjectives/);
 assert.match(detail,/source\\.sourceReference/);
});
