import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const component=read('src/app/pages/si-preparation-queue.component.ts');
const detail=read('src/app/pages/si-inspection-preparation.component.ts');
const service=read('src/app/services/si-preparation.service.ts');
const server=read('ai-proxy/server.mjs');
test('Preparation queue fetches persisted approved case list, never volatile live candidates',()=>{
 assert.match(component,/this\.api\.list\(this\.editorKey\)/);
 assert.doesNotMatch(component,/this\.api\.dashboard\(\)/);
 assert.match(component,/this\.cases=data\.cases/);
 assert.match(component,/c\.preparationStatus/);
 assert.match(component,/\['\/moei\/smart-inspection\/preparation',c\.id\]/);
 assert.match(component,/No approved SI cases are saved yet/);
});
test('SI-02 detail loads selected case automatically and handles navigation',()=>{
 assert.match(detail,/this\.route\.paramMap\.subscribe/);
 assert.match(detail,/if\(this\.id\)this\.load\(\)/);
 assert.match(detail,/SI_MIGRATION_010_REQUIRED/);
});
test('SI-02 dedicated endpoint is session/role protected and read-only, without lifecycle-013 dependency',()=>{
 assert.match(service,/this\.http\.get<SiPreparationRegister>\('\/api\/si\/v1\/preparations'/);
 assert.match(server,/path==='\/api\/si\/v1\/preparations'&&req\.method==='GET'/);
 assert.match(server,/return respond\(res,200,await siPreparation\.list\(\)\)/);
 assert.match(server,/dashboards\.assertRole\(req,'EDITOR'\)/);
});
