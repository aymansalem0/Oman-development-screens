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
test('candidate screen only proposes plan and navigates to distinct Create Inspection Plan stepper',()=>{
 assert.match(grid,/\[routerLink\]="\['\/moei\/smart-inspection\/plan\/create',activePlanId\]"/);
 assert.match(routes,/path: 'moei\/smart-inspection\/plan\/create\/:planId'/);
 assert.match(routes,/path: 'moei\/smart-inspection\/plan\/create'/);
 assert.doesNotMatch(grid,/<app-si-bulk-approval-panel/);
 assert.match(wizard,/Selected Vessels/);
 assert.match(wizard,/All Referral Reasons/);
 assert.match(wizard,/AI & Preparation/);
 assert.match(wizard,/Review & Approval/);
});
test('stepper contains no single-regime selector and shows all reasons automatically',()=>{
 assert.doesNotMatch(wizard,/<select/);
 assert.doesNotMatch(wizard,/choices\[/);
 assert.match(wizard,/vessel\.reasons\.length/);
 assert.match(wizard,/source\.sourceReference/);
 assert.match(wizard,/source\.inspectionRegime/);
 assert.match(wizard,/this\.api\.approve\(/);
 assert.doesNotMatch(wizard,/candidateKey:this\.choices/);
});
test('server rejects old per-vessel approval; full plan creates all linked source scopes',()=>{
 assert.match(server,/SI_APPROVAL_REQUIRES_COMPLETE_PLAN/);
 assert.match(cases,/async decideBatch\(/);
 assert.match(cases,/inspectionReasons:reasons/);
 assert.match(cases,/candidateKeys/);
 assert.match(cases,/inspectionScopes:regimes\.map/);
 assert.match(backend,/inspectionReasons:v\.reasons/);
 assert.match(backend,/preview\.vessels\.some\(v=>v\.missingSource/);
 assert.doesNotMatch(backend,/requiresRegimeChoice/);
});
test('SI-02 dossier contains preserved reasons and source-based field objectives',()=>{
 assert.match(prep,/sourceInspectionObjectives/);
 assert.match(prep,/allInspectionReasons/);
 assert.match(detail,/d\.context\.inspectionReasons/);
 assert.match(detail,/d\.context\.sourceInspectionObjectives/);
 assert.match(detail,/source\.sourceReference/);
});
