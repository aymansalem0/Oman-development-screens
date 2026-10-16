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

test('assigned inspection stepper follows vessel, dossier, preparation, checklist, execution',()=>{
 const journey=workspace.indexOf('data-testid="si-assigned-inspection-stepper"');
 assert.ok(journey>0);
 const stages=[
  'si-step-select-vessel','si-step-prepare-dossier','si-step-open-preparation',
  'si-step-create-checklist','si-step-supervisor-scope','si-step-execute-order'
 ];
 const positions=stages.map(testId=>workspace.indexOf('data-testid="'+testId+'"'));
 assert.ok(positions.every(x=>x>journey));
 assert.ok(positions.every((x,i)=>i===0||x>positions[i-1]),
  'vessel → prepare dossier → open preparation → checklist → execute');
 assert.ok(workspace.includes('(click)="activate(o)"'));
 assert.ok(workspace.includes('data-testid="si-stepper-prepare-action"'));
 assert.ok(workspace.includes('data-testid="si-stepper-open-preparation"'));
 assert.ok(workspace.includes('data-testid="si-stepper-open-checklist"'));
 assert.ok(workspace.includes('data-testid="si-stepper-execute-order"'));
 assert.ok(workspace.includes('data-testid="si-stepper-resume-checklist"'));
 assert.ok(workspace.includes("o.status==='READY_FOR_FIELD'"));
 assert.ok(workspace.includes("o.status==='FIELD_STARTED'"));
 assert.ok(workspace.includes("['/moei/smart-inspection/preparation',selected!.caseId]"));
 assert.ok(workspace.includes('selected?.caseId && auth.isAdmin'));
 assert.ok(workspace.includes('selected?.caseId && !auth.isAdmin'));
 assert.ok(workspace.includes('selected?.checklistStatus===\'MANDATORY_PUBLISHED_TEMPLATE_SNAPSHOT\''));
 assert.ok(workspace.includes('selected?.status===\'READY_FOR_FIELD\''));
 assert.ok(workspace.includes("'/moei/smart-inspection/my-work-orders'"));
});

test('stepper returns to the assigned work order after preparation or checklist preview',()=>{
 const preparation=src('src/app/pages/si-inspection-preparation.component.ts');
 const preparationHtml=src('src/app/pages/si-inspection-preparation.component.html');
 const checklist=src('src/app/pages/si-checklist-execution.component.ts');
 assert.ok(workspace.includes('queryParams:{orderId:o.orderId}'));
 assert.ok(workspace.includes("this.route.snapshot.queryParamMap.get('orderId')"));
 assert.ok(preparation.includes("this.route.snapshot.queryParamMap.get('orderId')"));
 assert.ok(preparationHtml.includes('data-testid="si-return-to-order"'));
 assert.ok(checklist.includes('data-testid="si-return-to-order"'));
 assert.ok(checklist.includes('returnOrderId'));
 assert.ok(workspace.includes("this.api+'my-work-orders/'+o.orderId+'/dossier'"),
  'read-only dossier remains session-owned');
});

test('mandatory preparation never waits for AI hypotheses or accepts unreviewed extras',()=>{
 const scheduling=src('ai-proxy/si-schedule-orders.mjs');
 const start=scheduling.indexOf('async activate({');
 const end=scheduling.indexOf('async approveScope({',start);
 assert.ok(start>0&&end>start);
 const activation=scheduling.slice(start,end);
 assert.ok(activation.includes("await this.checklists.start(caseId,actor)"));
 assert.ok(activation.includes("action:'INITIALIZE'"));
 assert.ok(activation.indexOf('await this.checklists.start(caseId,actor)')<
  activation.indexOf('if(generateAi&&prepared.saved.status'));
 assert.ok(workspace.includes('!ai.predictedDeficiencies?.length'));
 assert.ok(workspace.includes('ai.predictedDeficiencies'));
 assert.ok(workspace.includes('AI hypothesis only'));
});

test('approved A04 dossier updates Step 3 from saved authoritative vessel read model',()=>{
 const dossier=src('ai-proxy/si-vessel-dossier.mjs');
 assert.ok(workspace.includes('dossier?.readiness?.preparationSaved'));
 assert.ok(workspace.includes('dossier?.readiness?.aiReviewed'));
 assert.ok(workspace.includes('data-testid="si-step3-a04-approved"'));
 assert.ok(workspace.includes('data-testid="si-step3-a04-summary"'));
 assert.ok(workspace.includes('data-testid="si-refresh-journey-status"'));
 assert.ok(workspace.includes('ai.focusAreas.length'));
 assert.ok(workspace.includes('ai.suggestedAdditionalItems.length'));
 assert.ok(dossier.includes("aiReviewed:record?.status==='APPROVED'"));
 assert.ok(workspace.includes("this.api+'my-work-orders/'+o.orderId+'/dossier'"),
  'no extra paid AI invocation to render A04 status');
});

test('Dynamic Checklist distinguishes 4 approved focus areas from zero extra questions',()=>{
 const ui=src('src/app/pages/si-checklist-execution.component.ts');
 assert.ok(ui.includes('data-testid="si-a04-approved-focus-overlay"'));
 assert.ok(ui.includes('data-testid="si-a04-zero-extras"'));
 assert.ok(ui.includes('a04FocusAreas.length'));
 assert.ok(ui.includes('a04ChecklistFocus.length'));
 assert.ok(ui.includes('a04AdditionalItems.length'));
 assert.ok(ui.includes("this.a04?.saved?.status==='APPROVED'"));
 assert.ok(ui.includes('this.a04?.stale!==true'));
 assert.ok(ui.includes('focus.existingItemId'));
 assert.ok(ui.includes('focus.reasonEvidenceIds'));
 assert.ok(ui.includes('data-testid="si-field-not-started"'));
 assert.ok(ui.includes('preview?.fieldAccess?.inspectionStatus'));
 assert.ok(ui.includes('data-testid="si-checklist-continue-in-stepper"'));
 assert.ok(!ui.includes('predictedDeficiencies.map(x=>x.mandatory'),
  'AI hypothesis must not become a mandatory question');
});

test('one assigned inspection journey performs publisher-gated scope approval',()=>{
 const nav=src('src/app/components/nmc-navigation.component.html');
 const lifecycle=src('src/app/pages/si-full-lifecycle.component.html');
 const preparation=src('src/app/pages/si-inspection-preparation.component.html');
 const guide=src('src/app/pages/si-guided-inspection.component.ts');
 assert.ok(workspace.includes('data-testid="si-step-supervisor-scope"'));
 assert.ok(workspace.includes('data-testid="si-stepper-approve-scope"'));
 assert.ok(workspace.includes('data-testid="si-stepper-scope-approved"'));
 assert.ok(workspace.includes('data-testid="si-field-await-scope"'));
 assert.ok(workspace.includes('approveScope(o:AssignedOrder):void'));
 assert.ok(workspace.includes("o.status!=='READY_FOR_SCOPE_REVIEW'"));
 assert.ok(workspace.includes("'work-orders/'+encodeURIComponent(o.orderId)+'/scope'"));
 assert.ok(workspace.includes('{reason:reason.trim(),includeAiSuggestions}'));
 assert.ok(workspace.includes("ai.status==='APPROVED'"));
 assert.ok(workspace.includes('extraCount>0&&window.confirm'));
 assert.ok(server.includes("dashboards.assertRole(req,supervisor?'PUBLISHER':'EDITOR')"));
 assert.ok(server.includes('await siScheduleOrders.approveScope({'));
 assert.ok(server.includes('includeAiSuggestions:data.includeAiSuggestions===true'));
 assert.ok(nav.includes("copy('My Inspection Journey','رحلة معايناتي')"));
 assert.ok(!nav.includes('routerLink="/moei/smart-inspection/lifecycle"'));
 assert.ok(lifecycle.includes('Inspection Case Record & Follow-up'));
 assert.ok(lifecycle.includes('data-testid="si-case-record-return-journey"'));
 assert.ok(!preparation.includes('Continue Full Inspection Cycle'));
 const caseUi=src('src/app/pages/si-full-lifecycle.component.ts');
 const caseView=src('src/app/services/si-lifecycle.service.ts');
 assert.ok(lifecycle.includes('data-testid="si-workorder-managed-case"'));
 assert.ok(lifecycle.includes("*ngIf=\"stage==='PREPARATION_READY'&&!workOrderManaged\""));
 assert.ok(lifecycle.includes("*ngIf=\"stage==='SCOPE_APPROVED'&&!workOrderManaged\""));
 assert.ok(lifecycle.includes("*ngIf=\"stage==='ASSIGNED'&&!workOrderManaged\""));
 assert.ok(caseUi.includes('get workOrderManaged():boolean'));
 assert.ok(caseUi.includes("['APPROVE_SCOPE','ASSIGN','START_FIELD'].includes(action)"));
 assert.ok(caseView.includes('workOrderManaged?:boolean;'));
 assert.ok(server.includes("error:'SI_ASSIGNED_WORK_ORDER_JOURNEY_REQUIRED'"));
 assert.ok(server.includes("s.orders.some(o=>o.caseId===id)"));

 assert.ok(guide.includes('data-testid="si-guided-return-journey"'));
});

test('A04 approval does not itself unlock field execution',()=>{
 const workOrderService=src('ai-proxy/si-schedule-orders.mjs');
 const approveBlock=workOrderService.slice(
  workOrderService.indexOf('async approveScope({'),
  workOrderService.indexOf('async startField({'));
 assert.ok(approveBlock.includes("order.status='READY_FOR_FIELD'"));
 assert.ok(approveBlock.includes("if(includeAiSuggestions&&prep.saved?.status!=='APPROVED')"));
 assert.ok(approveBlock.includes("action:'APPROVE_SCOPE'"));
 assert.ok(approveBlock.includes("action:'ASSIGN'"));
 const startBlock=workOrderService.slice(workOrderService.indexOf('async startField({'));
 assert.ok(startBlock.includes("order.status!=='READY_FOR_FIELD'"));
 assert.ok(startBlock.includes("order.status='FIELD_STARTED'"));
 assert.ok(workspace.includes("o.status==='READY_FOR_FIELD'"));
 assert.ok(workspace.includes("o.status==='FIELD_STARTED'"));
});
