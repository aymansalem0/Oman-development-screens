import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(p,'utf8');
const html=read('src/app/pages/si-candidate-workbench.component.html');
const ts=read('src/app/pages/si-candidate-workbench.component.ts');
const css=read('src/app/pages/si-candidate-workbench.component.css');
const login=read('src/app/pages/moei-admin-login.component.html');
const routes=read('src/app/app.routes.ts');
test('unified C01 grid has no Officer or key input; Admin identity is global',()=>{
 assert.match(html,/class="si-panel si-unified-queue"/);
 assert.match(html,/si-admin-user/);
 assert.match(html,/Generate AI Selection & Priority/);
 assert.doesNotMatch(html,/\[\(ngModel\)\]="(?:editorKey|publisherKey|reviewer)"/);
 assert.doesNotMatch(html,/type="password"/);
 assert.match(ts,/editorKey='MOEI_SESSION'/);
 assert.match(ts,/reviewer='admin'/);
});
test('login is the ONLY credential entry within NMC and Smart Inspection workbench',()=>{
 assert.match(login,/autocomplete="username"/);
 assert.match(login,/type="password" name="password"/);
 assert.match(routes,/path: 'moei\/login'/);
 assert.match(routes,/canActivate:\[moeiAdminGuard\]/);
 assert.ok(css.includes('.si-unified-table'));
});
test('AI plan edits remain separate from one supervisor whole-plan approval',()=>{
 assert.match(html,/savePlanEdit\(\)/);
 assert.match(html,/routerLink="\/moei\/smart-inspection\/plan\/create"/);
 assert.doesNotMatch(html,/\(click\)="decide\('APPROVE'\)"/);
 assert.match(html,/Officer Reason/);
});
