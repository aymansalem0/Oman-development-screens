import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const page=read('src/app/pages/nmc-case-workspace.component.ts');
const html=read('src/app/pages/nmc-case-workspace.component.html');
const service=read('src/app/services/nmc-cases.service.ts');
const server=read('ai-proxy/server.mjs');
const fleet=read('ai-proxy/fleet-ai.mjs');
const worker=read('ai-proxy/si-post-inspection-risk.mjs');

test('SI-origin NMC case offers explicit paid A01/A02 retry with human cost consent',()=>{
 assert.match(html,/data-testid="nmc-si-risk-explicit-retry"/);
 assert.match(html,/\(click\)="retrySiPostInspectionRisk\(\)"/);
 assert.match(html,/data-testid="nmc-si-risk-refresh"/);
 const fn=page.slice(page.indexOf('  retrySiPostInspectionRisk():void{'),
   page.indexOf('  private pollSiPostInspectionRisk',page.indexOf('  retrySiPostInspectionRisk():void{')));
 assert.match(fn,/canRetrySiPostInspectionRisk/);
 assert.match(fn,/window\.confirm\(message\)/);
 assert.match(fn,/this\.cases\.retrySiPostInspectionRisk\(status\.inspectionId,needsPaidCalls\)/);
 assert.match(fn,/this\.pollSiPostInspectionRisk\(caseId\)/);
 assert.ok(fn.indexOf('window.confirm(message)')<fn.indexOf('this.cases.retrySiPostInspectionRisk'));
 assert.match(page,/\['FAILED','INTERRUPTED_REVIEW_BEFORE_RETRY',/);
 assert.match(page,/get canRetrySiPostInspectionRisk/);
 assert.match(page,/ngOnDestroy\(\):void\{this\.siRiskPoll\?\.unsubscribe\(\)/);
 assert.match(service,/\/reassessment\/retry/);
 assert.match(service,/'X-Moei-Csrf':'1'/);
 assert.match(server,/dashboards\.assertRole\(req,'PUBLISHER'\)/);
 assert.match(server,/confirmCost:input\.confirmCost===true/);
 assert.match(worker,/SI_RISK_RETRY_AI_COST_CONFIRMATION_REQUIRED/);
});
test('retry remains idempotent, no auto restart, and unsafe agent refs never become saved risk',()=>{
 assert.match(worker,/if\(row\.status==='COMPLETED'\|\|row\.status==='QUEUED'\)/);
 assert.match(worker,/if\(this\.active\.has\(eventId\)\|\|row\.status==='RUNNING'\)/);
 assert.match(worker,/INTERRUPTED_REVIEW_BEFORE_RETRY/);
 assert.match(server,/errorDetails:job\.errorDetails\|\|null/);
 assert.match(html,/diagnostic\.unknownCount/);
 assert.match(html,/diagnostic\.factor/);
 assert.match(fleet,/FLEET_AI_UNVERIFIED_EVIDENCE_ID/);
 assert.match(fleet,/canonicalizeApprovedFindingReferences/);
 assert.match(fleet,/evidenceReferenceContract/);
});
