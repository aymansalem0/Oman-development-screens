import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const server=read('ai-proxy/server.mjs');
const guided=read('ai-proxy/si-guided-inspection.mjs');
const ui=read('src/app/pages/si-guided-inspection.component.ts');
test('live guided assessment evaluates saved lifecycle findings, not only answered count',()=>{
 assert.match(server,/guidedFinalAssessment\(guide,lifecycle.record\)/);
 assert.match(guided,/export function guidedFindingRequirements\(guide,lifecycleRecord\)/);
 assert.match(guided,/check.status==='DEFICIENCY'/);
 assert.match(guided,/check.severity!=='MINOR'/);
 assert.match(guided,/check.note.trim\(\)/);
 assert.match(guided,/uploadedButNotLinked/);
 assert.match(guided,/missingFindingRequirements.length===0/);
});
test('finish rejects missing notes or major/critical evidence before any writes',()=>{
 const start=server.indexOf("if(task==='finish'&&req.method==='POST')");
 const end=server.indexOf("if(task==='answers'&&req.method==='POST')",start);
 assert.ok(start>=0&&end>start);
 const route=server.slice(start,end);
 assert.match(route,/SI_FINDING_NOTE_AND_EVIDENCE_REQUIRED/);
 assert.match(route,/missingFindingRequirements:assessment.missingFindingRequirements/);
 assert.match(route,/submissionPerformed:false/);
 assert.ok(route.indexOf("if(assessment.missingFindingRequirements?.length)")<
   route.indexOf("siChecklistField.complete("));
 assert.ok(route.indexOf("if(assessment.missingFindingRequirements?.length)")<
   route.indexOf("siLifecycle.apply("));
});
test('inspector sees per-finding fix links and requirements without auto-generating evidence',()=>{
 assert.match(ui,/data-testid="si-guided-finding-documentation-blockers"/);
 assert.match(ui,/goToFinding\(issue.stepId\)/);
 assert.match(ui,/issue.missingNote/);
 assert.match(ui,/issue.missingEvidence/);
 assert.match(ui,/issue.uploadedButNotLinked/);
 assert.match(ui,/this.filter='ALL'/);
 assert.match(ui,/SI_FINDING_NOTE_AND_EVIDENCE_REQUIRED/);
 assert.match(ui,/!assessment.canSubmit/);
 assert.doesNotMatch(ui,/this.finishInspection\(\)\s*;\s*\/\/ automatic/);
});
