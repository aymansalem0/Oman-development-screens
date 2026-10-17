import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const server=read('ai-proxy/server.mjs');
const ui=read('src/app/pages/nmc-case-workspace.component.ts');
const html=read('src/app/pages/nmc-case-workspace.component.html');
const service=read('src/app/services/nmc-cases.service.ts');
const risk=read('ai-proxy/si-post-inspection-risk.mjs');
const cohort=JSON.parse(read('ai-proxy/airia-demo-99.json'));

test('MOEI SI approved vessel 9400368 is a known 99-vessel POC source',()=>{
 assert.equal(cohort.records.length,99);
 assert.ok(cohort.records.some(x=>x.imo==='9400368'));
});
test('NMC status route is read-only and uses exact persisted NMC case + latest approved SI report',()=>{
 const start=server.indexOf("if(action==='post-inspection-risk-status'){");
 const end=server.indexOf("if(action==='action-plan-source'){",start);
 assert.ok(start>=0&&end>start);
 const route=server.slice(start,end);
 assert.match(route,/moeiAuth.require\(req\)/);
 assert.match(route,/dashboards.assertRole\(req,'EDITOR'\)/);
 assert.match(route,/const item=await cases.get\(first\)/);
 assert.match(route,/siInspectionSources/);
 assert.match(route,/x.source==='SI_APPROVED_REPORT'/);
 assert.match(route,/siRiskReassessor.status\(latest.inspectionId\)/);
 assert.match(route,/x.nmcCaseId===item.id&&x.reportId===latest.reportId/);
 assert.match(route,/jobStatus:job\?\.status\|\|'NOT_QUEUED'/);
 assert.match(route,/errorCode:job.errorCode\|\|null/);
 assert.match(route,/riskSaved:Boolean\(job.result\)/);
 assert.doesNotMatch(route,/\.retry\(|\.enqueue\(|fleetAgentCall|\.assess\(|\.saveAssessment\(/);
});
test('SI-origin NMC case does not offer an A01 Retry that requires a nonexistent baseline',()=>{
 assert.match(ui,/isSiCaseWithoutOriginalAssessment/);
 assert.match(ui,/this.centralCase\?\.source==='SI_APPROVED_INSPECTION'/);
 assert.match(ui,/this.cases.siPostInspectionRiskStatus\(id\)/);
 const start=ui.indexOf('  generateAiActions():void{');
 const end=ui.indexOf('  issue',start);
 const method=ui.slice(start,end>start?end:start+3000);
 assert.ok(method.indexOf("if(this.isSiCaseWithoutOriginalAssessment)")>=0);
 assert.ok(method.indexOf("if(this.isSiCaseWithoutOriginalAssessment)")<
  method.indexOf("this.cases.actionPlanSourcePreview(current.id)"));
 assert.match(html,/data-testid="nmc-si-risk-diagnostic"/);
 assert.match(html,/result\.job\?\.errorCode/);
 assert.match(html,/result\.jobStatus==='NOT_QUEUED'/);
 assert.match(html,/result\.job\?\.riskSaved&&!centralCase\?\.operationalRisk/);
 assert.match(html,/data-testid="nmc-si-original-source-unavailable"/);
 assert.match(html,/\*ngIf="!centralCase.actionPlan&&!isSiCaseWithoutOriginalAssessment"/);
 assert.match(service,/post-inspection-risk-status/);
});
test('Risk worker still rejects without evidence, no synthetic assessment source',()=>{
 assert.match(risk,/SI_RISK_AI_DID_NOT_CITE_APPROVED_REPORT/);
 assert.match(risk,/SI_RISK_SOURCE_CHANGED/);
 assert.match(risk,/SI_RISK_SOURCE_VESSEL_NOT_IN_NMC_COHORT/);
 assert.doesNotMatch(risk,/caseWorkspace\.sourceAssessmentId\s*=/);
});
