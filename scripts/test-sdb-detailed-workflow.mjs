import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import ts from 'typescript';

function loadTs(path, dependencies={}) {
  const source=readFileSync(new URL('../'+path,import.meta.url),'utf8');
  const js=ts.transpileModule(source,{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,experimentalDecorators:true}
  }).outputText;
  const module={exports:{}};
  const core={Injectable:()=>target=>target};
  const resolve=(id)=>{
    if(id==='@angular/core')return core;
    if(id==='./sdb-poc.service')return dependencies.registry;
    throw Error('Unexpected import '+id+' for '+path);
  };
  new Function('require','module','exports',js)(resolve,module,module.exports);
  return module.exports;
}

const registry=loadTs('src/app/services/sdb-poc.service.ts');
const journey=loadTs('src/app/services/sdb-journey.service.ts',{registry});
function setup(){
  const store=new registry.SdbPocService();
  const flow=new journey.SdbJourneyService(store);
  return {store,flow};
}
function fillApplicant(caseRecord,mode='COLLECTION'){
  caseRecord.applicantConfirmed=true;
  caseRecord.documentsReviewed=true;
  caseRecord.declarationAccepted=true;
  caseRecord.contactEmail='sdb.fixture@example.test';
  caseRecord.deliveryMode=mode;
  caseRecord.deliveryAddress=mode==='COURIER'?'Synthetic quay 1, UAE':'';
}

test('UAE cadet HOLD requires distinct CoP correction and source-owned HOLD release',()=>{
  const {store,flow}=setup(),row=store.getSeafarer('SF-002');
  assert.equal(store.readiness(row),'EXTERNAL_HOLD');
  assert.equal(row.applicationState,'NOT_STARTED');
  assert.match(flow.invite(row),/Cannot invite/);
  assert.match(flow.incomingSourceEvent(row,'COP','COMPANY'),/Only the controlled/);
  flow.incomingSourceEvent(row,'COP','OPERATIONS');
  assert.equal(store.readiness(row),'EXTERNAL_HOLD');
  flow.incomingSourceEvent(row,'HOLD','OPERATIONS');
  assert.equal(store.readiness(row),'READY_TO_APPLY');
});

test('full UAE application needs invitation, applicant declaration, rules, payment, issuance and collection',()=>{
  const {store,flow}=setup(),row=store.getSeafarer('SF-001');
  assert.equal(store.readiness(row),'READY_TO_APPLY');
  assert.match(flow.submit(row,'SELF'),/Confirm applicant/);
  flow.invite(row);
  const current=flow.caseOf(row);fillApplicant(current);
  assert.match(flow.submit(row,'COMPANY'),/UAE self-service/);
  assert.equal(row.applicationState,'INVITED');
  flow.submit(row,'SELF');
  assert.equal(row.applicationState,'SUBMITTED');
  assert.match(flow.pay(row,'OPERATIONS'),/until the rules engine authorises/);
  assert.match(flow.issue(row,'OPERATIONS'),/authorised decision and confirmed mock payment/i);
  flow.authorise(row,'OPERATIONS');
  assert.equal(current.decision,'AUTHORISED');
  assert.equal(current.decisionEvidence.length,8);
  assert.equal(current.decisionRuleVersion,'POC-SDB-RULESET-v1.0');
  flow.pay(row,'OPERATIONS');
  assert.equal(row.applicationState,'PAYMENT_SIMULATED');
  assert.match(current.paymentReference,/PAY-DEMO/);
  flow.issue(row,'OPERATIONS');
  assert.equal(row.applicationState,'ISSUED');
  assert.match(row.sid,/^SID-DEMO-NEW-/);
  assert.match(flow.completeDelivery(row,'OPERATIONS'),/Printing and appropriate/);
  flow.queuePrint(row,'OPERATIONS');
  assert.equal(current.printState,'QUEUED');
  flow.markPrinted(row,'OPERATIONS');
  assert.equal(current.deliveryState,'READY_FOR_COLLECTION');
  flow.completeDelivery(row,'OPERATIONS');
  assert.equal(current.deliveryState,'COMPLETED');
  assert.ok(current.timeline.some(x=>x.stage==='AUTO_AUTHORIZED_SIMULATED'));
  assert.ok(current.timeline.some(x=>x.stage==='FULFILMENT_COMPLETED_SIMULATED'));
});

test('foreign representative required; renewal preserves original SID; courier must dispatch before handover',()=>{
  const {store,flow}=setup(),row=store.getSeafarer('SF-003');
  const sid=row.sid;
  flow.invite(row);
  const c=flow.caseOf(row);fillApplicant(c,'COURIER');
  assert.match(flow.submit(row,'SELF'),/company representative/);
  assert.equal(row.applicationState,'INVITED');
  flow.submit(row,'COMPANY');
  flow.authorise(row,'OPERATIONS');
  flow.pay(row,'OPERATIONS');
  flow.issue(row,'OPERATIONS');
  assert.equal(row.sid,sid);
  flow.queuePrint(row,'OPERATIONS');
  flow.markPrinted(row,'OPERATIONS');
  assert.equal(c.deliveryState,'NOT_STARTED');
  assert.match(flow.completeDelivery(row,'OPERATIONS'),/appropriate collection/);
  flow.dispatch(row,'OPERATIONS');
  assert.equal(c.deliveryState,'DISPATCHED');
  flow.completeDelivery(row,'OPERATIONS');
  assert.equal(c.deliveryState,'COMPLETED');
});

test('foreign endorsement expiry and source outage fail closed',()=>{
  const {store,flow}=setup(),foreign=store.getSeafarer('SF-004'),pending=store.getSeafarer('SF-007');
  assert.equal(store.readiness(foreign),'MISSING_ENDORSEMENT');
  assert.equal(store.readiness(pending),'PENDING_VERIFICATION');
  assert.match(flow.invite(foreign),/Cannot invite/);
  assert.match(flow.invite(pending),/Cannot invite/);
  flow.incomingSourceEvent(foreign,'ENDORSEMENT','OPERATIONS');
  assert.equal(store.readiness(foreign),'READY_TO_APPLY');
  flow.incomingSourceEvent(pending,'SOURCE','OPERATIONS');
  assert.equal(store.readiness(pending),'READY_TO_APPLY');
});

test('company HOLD cannot be released by applicant; medical needs MARASI update',()=>{
  const {store,flow}=setup(),company=store.getSeafarer('SF-005'),medical=store.getSeafarer('SF-006');
  assert.equal(store.readiness(company),'EXTERNAL_HOLD');
  flow.incomingSourceEvent(company,'HOLD','COMPANY');
  assert.equal(store.readiness(company),'EXTERNAL_HOLD');
  flow.incomingSourceEvent(company,'HOLD','OPERATIONS');
  assert.equal(store.readiness(company),'READY_TO_APPLY');
  assert.equal(store.readiness(medical),'REQUIREMENT_MISSING');
  flow.incomingSourceEvent(medical,'MEDICAL','OPERATIONS');
  assert.equal(store.readiness(medical),'READY_TO_APPLY');
});
