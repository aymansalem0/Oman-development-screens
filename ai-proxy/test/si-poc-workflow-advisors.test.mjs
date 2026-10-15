import test from 'node:test';
import assert from 'node:assert/strict';
import {runSiPocAdvisor,siFutureAdvisorCoverage,SiPocAdvisorError}
 from '../si-poc-workflow-advisors.mjs';

const caseId='b221f1fa-7fea-47f4-b513-08e21e63ce62';
const view=()=>({
 inspectionCase:{id:caseId,imo:'9337325',
  inspectionReasons:[{sourceReference:'NMC-HUMAN-REF-1'}]},
 nmcBooking:null,preparation:{status:'PREPARED'},
 record:{version:2,stage:'IN_FIELD',
  checks:[{id:'fire-safety',status:'DEFICIENCY',evidenceRefs:['EV-01']}],
  findings:[{id:'F-fire-safety',severity:'MAJOR',
   status:'CONFIRMED_BY_INSPECTOR',description:'Inspector observed unresolved door issue',
   evidenceRefs:['EV-01']}]}
});
test('unknown Airia S/V/R/X integrations expose deliberate MOCK contract coverage',()=>{
 const c=siFutureAdvisorCoverage();
 assert.equal(c.provider,'MOCK');
 assert.equal(c.externalCalls,0);
 assert.equal(c.liveProviderStatus,'AIRIA_RESPONSE_CONTRACT_NOT_RECEIVED');
 assert.deepEqual(c.supported,['SI-S01','SI-V01','SI-R01','SI-X01']);
});
test('four mock adapters use only current saved case evidence and do not mutate official state',()=>{
 for(const code of siFutureAdvisorCoverage().supported){
  const snapshot=view(),before=structuredClone(snapshot);
  const r=runSiPocAdvisor({agentCode:code,caseId},snapshot);
  assert.equal(r.agentCode,code);
  assert.equal(r.provider,'MOCK');
  assert.equal(r.simulationLabel,'MOCK_POC_NOT_REAL_AI');
  assert.equal(r.externalCalls,0);assert.equal(r.caseMutations,0);
  assert.equal(r.regulatoryDecision,false);
  assert.equal(r.humanApprovalRequired,true);
  assert.equal(r.snapshot.caseVersion,2);
  assert.ok(r.advice.every(x=>x.requiresHumanReview));
  assert.deepEqual(snapshot,before);
 }
});
test('R01 report suggestion never invents confirmed findings or modifies the case report',()=>{
 const input=view();
 const r=runSiPocAdvisor({agentCode:'SI-R01',caseId},input);
 assert.equal(r.draft.aiGenerated,false);
 assert.equal(r.draft.autoIssued,false);
 assert.equal(r.draft.findingRefs.length,1);
 assert.equal(r.draft.findingRefs[0].findingId,'F-fire-safety');
 assert.equal(input.record.report,undefined);
});
test('X01 demonstrates three exceptional events only with an explicit synthetic scenario request',()=>{
 const ordinary=runSiPocAdvisor({agentCode:'SI-X01',caseId},view());
 assert.ok(!ordinary.advice.some(x=>x.synthetic));
 const simulated=runSiPocAdvisor({agentCode:'SI-X01',caseId,
  scenario:'RECURRING_DEFICIENCY_CERT_EXPIRY_CONFLICT'},view());
 assert.equal(simulated.advice.filter(x=>x.synthetic).length,3);
 assert.ok(simulated.advice.filter(x=>x.synthetic).every(x=>
  x.severity==='SCENARIO_ONLY'&&!x.evidenceRefs.length));
 assert.throws(()=>runSiPocAdvisor({agentCode:'SI-X01',caseId,scenario:'UNVERIFIED'},view()),
  e=>e instanceof SiPocAdvisorError);
});
