import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const server=read('ai-proxy/server.mjs');
const component=read('src/app/pages/si-guided-inspection.component.ts');
const start=server.indexOf("if(task==='finish'&&req.method==='POST')");
const end=server.indexOf("if(task==='answers'&&req.method==='POST')",start);
const finish=server.slice(start,end);
const clientStart=component.indexOf('private refreshAfterFinishConflict(');
const clientEnd=component.indexOf(' next():void{',clientStart);
const finishClient=component.slice(clientStart,clientEnd);

test('server distinguishes explicit submission confirmation from stale checklist/lifecycle sources',()=>{
 assert.ok(start>=0&&end>start,'guided finish route found');
 assert.match(finish,/body.confirmSubmission!==true/);
 assert.match(finish,/SI_GUIDED_FINISH_EXPLICIT_CONFIRMATION_REQUIRED/);
 assert.match(finish,/expectedLifecycleVersion!==current.guide.lifecycleVersion/);
 assert.match(finish,/expectedChecklistVersion!==current.guide.publishedSnapshotVersion/);
 assert.match(finish,/SI_GUIDED_FINISH_SOURCE_CHANGED_RELOAD_REQUIRED/);
 assert.match(finish,/changedSources:changed/);
 assert.match(finish,/submissionPerformed:false/);
 assert.match(finish,/currentLifecycleVersion/);
 assert.match(finish,/currentChecklistVersion/);
 const check=finish.indexOf('SI_GUIDED_FINISH_SOURCE_CHANGED_RELOAD_REQUIRED');
 assert.ok(check<finish.indexOf('siChecklistField.complete('),
   'reject before writing checklist state');
 assert.ok(check<finish.indexOf('siLifecycle.apply('),
   'reject before lifecycle submit');
});
test('inspector refreshes guided snapshot after conflict without automatic submission',()=>{
 assert.ok(clientStart>0&&clientEnd>clientStart);
 assert.match(finishClient,/\/guide'\)/);
 assert.match(finishClient,/SI_GUIDED_FINISH_SOURCE_CHANGED_RELOAD_REQUIRED/);
 assert.match(finishClient,/SI_GUIDED_FINISH_CONFIRMATION_OR_VERSION_INVALID/);
 assert.match(finishClient,/this.refreshAfterFinishConflict\(sources\)/);
 assert.match(finishClient,/this.guide=g/);
 assert.match(finishClient,/this.choose\(step\)/);
 assert.match(finishClient,/this.busy\|\|this.uploadBusy\)return/);
 assert.match(component,/\[disabled\]="!canSave\|\|busy\|\|uploadBusy\|\|!assessment.canSubmit"/);
 assert.match(finishClient,/nothing was submitted/);
 assert.equal((finishClient.match(/'\/guide\/finish'/g)||[]).length,1,
   'only one finish request exists inside the human-initiated method');
 assert.ok(!finishClient.slice(0,finishClient.indexOf(' finishInspection():void')).includes('this.finishInspection('),
   'refresh must never automatically resubmit');
 assert.ok(!finishClient.slice(0,finishClient.indexOf(' finishInspection():void')).includes('/guide/finish'),
   'conflict recovery never POSTs to finish');
});
