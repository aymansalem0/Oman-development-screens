import test from 'node:test';
import assert from 'node:assert/strict';
import {sdbServiceScenarios} from '../seafarer-sdb-service-scenarios.mjs';

const now=Date.parse('2026-10-16T09:00:00Z');
const byId=Object.fromEntries(sdbServiceScenarios(now).map(s=>[s.id,s]));

test('eight distinct SDB cases are modelled in four issuance and four renewal states',()=>{
 const scenarios=sdbServiceScenarios(now);
 assert.equal(scenarios.length,8);
 assert.equal(new Set(scenarios.map(s=>s.id)).size,8);
 assert.equal(scenarios.filter(s=>s.readiness.service==='FIRST_ISSUE').length,4);
 assert.equal(scenarios.filter(s=>s.readiness.service==='RENEWAL').length,4);
 assert.equal(scenarios.filter(s=>s.canContinue).length,2);
 assert.ok(scenarios.every(s=>s.advisor.modelInvoked===false));
 assert.ok(scenarios.every(s=>s.advisor.mode==='EXPLAINABLE_RULES_POC'));
 assert.ok(scenarios.every(s=>s.advisor.score===s.readiness.percent));
});
test('first-issue cadet scenarios expose missing CoPs, absent medical, academy hold, and fully ready',()=>{
 const incomplete=byId.CADET_MISSING_CERTIFICATES;
 assert.equal(incomplete.readiness.service,'FIRST_ISSUE');
 assert.equal(incomplete.existingSdb,null);
 assert.equal(incomplete.readiness.status,'INCOMPLETE');
 assert.equal(incomplete.readiness.blockers.filter(c=>c.key.startsWith('COP-')).length,3);
 const medical=byId.CADET_MISSING_MEDICAL;
 assert.equal(medical.readiness.status,'INCOMPLETE');
 assert.equal(medical.readiness.blockers.find(c=>c.key==='MEDICAL').result,'FAIL');
 assert.equal(medical.readiness.checks.filter(c=>c.key.startsWith('COP-')&&c.result==='PASS').length,4);
 const hold=byId.CADET_ACADEMY_HOLD;
 assert.equal(hold.readiness.status,'ON_HOLD');
 assert.equal(hold.readiness.blockers.find(c=>c.key==='CLEARANCE-ACADEMY').result,'HOLD');
 assert.equal(hold.readiness.checks.find(c=>c.key==='MEDICAL').result,'PASS');
 assert.equal(byId.CADET_READY.readiness.status,'READY');
 assert.equal(byId.CADET_READY.canContinue,true);
 assert.equal(byId.CADET_READY.readiness.percent,100);
});
test('renewal is based on existing SDB, not a customer-selected service type',()=>{
 for(const id of [
  'RENEWAL_ACADEMY_HOLD','RENEWAL_COMPANY_HOLD',
  'RENEWAL_MEDICAL_ISSUE','RENEWAL_READY'
 ]){
  const s=byId[id];
  assert.ok(s.existingSdb?.sid);
  assert.equal(s.readiness.service,'RENEWAL');
  assert.equal(s.advisor.classifiedService,'RENEWAL');
 }
 assert.equal(byId.RENEWAL_ACADEMY_HOLD.readiness.status,'ON_HOLD');
 assert.equal(byId.RENEWAL_ACADEMY_HOLD.readiness.blockers
   .find(c=>c.key==='CLEARANCE-ACADEMY').result,'HOLD');
 assert.equal(byId.RENEWAL_COMPANY_HOLD.readiness.status,'ON_HOLD');
 assert.equal(byId.RENEWAL_COMPANY_HOLD.readiness.blockers
   .find(c=>c.key==='CLEARANCE-COMPANY').result,'HOLD');
 assert.equal(byId.RENEWAL_MEDICAL_ISSUE.readiness.status,'INCOMPLETE');
 assert.equal(byId.RENEWAL_MEDICAL_ISSUE.readiness.blockers
   .find(c=>c.key==='MEDICAL').result,'FAIL');
 assert.equal(byId.RENEWAL_READY.readiness.status,'READY');
 assert.equal(byId.RENEWAL_READY.canContinue,true);
 assert.equal(byId.RENEWAL_READY.readiness.percent,100);
});
test('each decision has individually traceable source checks and no implicit paid AI calls',()=>{
 for(const s of sdbServiceScenarios(now)){
  assert.deepEqual(s.advisor.evidence.map(x=>x.key),
   s.readiness.checks.map(x=>x.key));
  assert.deepEqual(s.advisor.nextActions.map(x=>x.key),
   s.readiness.blockers.map(x=>x.key));
  assert.equal(s.advisor.requiresHumanClearance,
   s.readiness.checks.some(c=>c.result==='HOLD'));
  assert.ok(s.advisor.evidence.every(x=>typeof x.source==='string'));
 }
});
