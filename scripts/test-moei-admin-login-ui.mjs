import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(p,'utf8');
const routes=read('src/app/app.routes.ts');
const main=read('src/main.ts');
const server=read('ai-proxy/server.mjs');
const sidebar=read('src/app/components/nmc-navigation.component.html');
const login=read('src/app/pages/moei-admin-login.component.html');
const interp=read('src/app/services/moei-session.interceptor.ts');
test('all NMC and Inspection deep links require the same Admin login',()=>{
 assert.match(routes,/path: 'moei\/login'/);
 assert.match(routes,/canActivate:\[moeiAdminGuard\]/);
 assert.match(routes,/route\.path\?\.startsWith\('moei\/'\)/);
 assert.match(routes,/path: '', pathMatch: 'full', redirectTo: 'moei\/nmc'/);
 assert.match(login,/autocomplete="username"/);
 assert.match(login,/type="password" name="password"/);
 assert.match(sidebar,/auth\.logout\(\)/);
 assert.match(sidebar,/auth\.username/);
});
test('business APIs require backend session/CSRF, not browser supplied role',()=>{
 assert.match(server,/moeiAuth\.require\(req,\{mutate:/);
 assert.match(server,/\/api\/moei\/auth\/login/);
 assert.match(server,/\/api\/moei\/auth\/session/);
 assert.match(server,/\/api\/moei\/auth\/logout/);
 assert.match(interp,/X-MOEI-CSRF/);
 assert.match(interp,/headers=headers\.delete\('X-NMC-DASHBOARD-KEY'\)/);
 assert.match(main,/withInterceptors\(\[moeiSessionInterceptor\]\)/);
});
test('NMC and SI operational pages no longer display key or operator identity inputs',()=>{
 for(const p of [
  'src/app/pages/si-candidate-workbench.component.html',
  'src/app/pages/si-management-dashboard.component.html',
  'src/app/pages/si-full-lifecycle.component.html',
  'src/app/pages/si-inspection-preparation.component.html',
  'src/app/pages/si-erp-settings.component.html',
  'src/app/pages/si-candidate-sources.component.html'
 ]){
  const s=read(p);
  assert.doesNotMatch(s,/\[\(ngModel\)\]="(?:editorKey|publisherKey|operator|reviewer|actor)"/,p);
  assert.doesNotMatch(s,/type="password"/,p);
 }
});
test('key-popups were retired in shared NMC business services',()=>{
 for(const p of [
  'src/app/services/nmc-alerts.service.ts',
  'src/app/services/nmc-cases.service.ts',
  'src/app/services/nmc-dashboard-workspace.service.ts',
  'src/app/services/nmc-operational-guidance.service.ts',
  'src/app/services/nmc-ai-focus.service.ts',
  'src/app/services/nmc-documents.service.ts',
  'src/app/services/nmc-incidents.service.ts'
 ]){
  assert.doesNotMatch(read(p),/window\.prompt\(/,p);
 }
});
