/**
 * My Inspections contract and privilege-boundary regression.
 *
 * This protects the session-owned inspector routes while the comprehensive
 * schedule, assignment, lifecycle and guided-checklist unit tests run in CI.
 * It does not make Oracle writes or paid Airia requests.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {MoeiPocAuth} from '../ai-proxy/moei-poc-auth.mjs';

const src=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const server=src('ai-proxy/server.mjs');
const workspace=src('src/app/pages/si-my-work-orders.component.ts');
const guide=src('src/app/pages/si-guided-inspection.component.ts');
const routes=src('src/app/app.routes.ts');

test('Viewer session is read-only by default; inspector exception cannot grant ADMIN',()=>{
  const auth=new MoeiPocAuth();
  const {token}=auth.issueSession({
    username:'inspector@example.test',email:'inspector@example.test',
    role:'VIEWER',provider:'google'
  });
  const req={headers:{cookie:'MOEI_POC_SESSION='+token,
    'x-moei-csrf':'1'}};
  assert.equal(auth.require(req).role,'VIEWER');
  assert.throws(()=>auth.require(req,{mutate:true}),
    e=>e.code==='MOEI_ADMIN_REQUIRED'&&e.status===403);
});

test('global /api/si write gate exempts only authenticated, CSRF-checked assigned inspector actions',()=>{
  const start=server.indexOf('const publicHealth=');
  const end=server.indexOf('// Unified AI Settings',start);
  assert.ok(start>=0&&end>start);
  const block=server.slice(start,end);
  assert.match(block,/const inspectorAction=req\.method==='POST'/);
  assert.ok(block.includes('(?:activate|start|guide\\/answers)$'),
    'only prepare, field start and checklist answers may bypass global ADMIN requirement');
  assert.ok(block.includes('!inspectorAction'), 'all other mutations must keep the original guard');
  assert.ok(block.includes("req.headers['x-moei-csrf']!=='1'"));
  assert.ok(!block.includes('scope|approve|ai'), 'supervisor and paid AI actions must not be exempt');
});

test('inspector endpoints require a session-owned order and deny costly AI or supervisor delegation',()=>{
  const start=server.indexOf('const myOrder=');
  const end=server.indexOf('// SI-S02:',start);
  assert.ok(start>=0&&end>start);
  const block=server.slice(start,end);
  assert.ok(block.includes('dossier|guide|activate|start'));
  assert.ok(block.includes('await siScheduleOrders.mineOrder(actor,orderId)'));
  assert.ok(block.includes('body.confirmPocDelegation===true'));
  assert.ok(block.includes('body.generateAi===true'));
  assert.ok(block.includes('body.confirmAiCost===true'));
  assert.ok(block.includes('SI_INSPECTOR_SUPERVISOR_OR_PAID_AI_ACTION_DENIED'));
  assert.ok(block.includes("req.headers['x-moei-csrf']!=='1'"));
  assert.ok(!block.includes("dashboards.assertRole(req,'EDITOR')"),
    'an assigned VIEWER should not need the dashboard editor key');
});

test('inspector listing and dossier are assignment-scoped, not a dashboard editor privilege',()=>{
  const listStart=server.indexOf("if(path==='/api/si/v1/maritime-scheduling/my-work-orders'");
  const listEnd=server.indexOf('const myOrder=',listStart);
  assert.ok(listStart>=0&&listEnd>listStart);
  const list=server.slice(listStart,listEnd);
  assert.ok(list.includes('moeiAuth.require(req)'));
  assert.ok(list.includes('siScheduleOrders.mine(actor)'));
  assert.ok(!list.includes('dashboards.assertRole'));
});

test('My Inspections UI uses scoped endpoints and guided execution keeps immutable assigned order',()=>{
  assert.ok(workspace.includes("this.api+'my-work-orders/'+o.orderId+'/activate'"));
  assert.ok(workspace.includes("this.api+'my-work-orders/'+o.orderId+'/start'"));
  assert.ok(!workspace.includes("this.api+'plans/'+o.planId+'/work-orders/'+o.orderId+'/activate'"));
  assert.ok(!workspace.includes("this.api+'plans/'+o.planId+'/work-orders/'+o.orderId+'/start'"));
  assert.ok(guide.includes("'/api/si/v1/maritime-scheduling/my-work-orders/'"));
  assert.ok(routes.includes("path: 'moei/smart-inspection/my-work-orders/:orderId/execute'"));
  assert.ok(routes.includes("path: 'moei/seafarers/readiness'"),
    'preserve the integrated Seafarer SDB routes');
});

test('supervisor-only scope approval and schedule issuance remain unchanged',()=>{
  assert.ok(server.includes("const supervisor=operation==='approve'||orderAction==='scope'"));
  assert.ok(server.includes("dashboards.assertRole(req,supervisor?'PUBLISHER':'EDITOR')"));
});
