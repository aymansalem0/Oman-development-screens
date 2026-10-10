import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {SiCandidateTargeting,SiTargetingError} from '../si-candidate-targeting.mjs';

const fleet=Array.from({length:420},(_,i)=>({
  imo:String(9100000+i),inlineContext:{vessel:{name:'Vessel '+i,flag:'UAE',vesselType:'CARGO'}}
}));
function workspace({referrals=[],projection=[]}={}){
  const dir=mkdtempSync(join(tmpdir(),'si-targeting-'));
  let agentCalls=0;
  const subject=new SiCandidateTargeting({mode:'json',
    file:join(dir,'candidate.json'),bundles:fleet,
    cases:{listInspectionRequests:async()=>referrals},
    riskPolicy:{ready:true,projectCurrent:async()=>({
      policyRevision:2,projections:projection
    })}});
  return {subject,cleanup:()=>rmSync(dir,{force:true,recursive:true}),agentCalls:()=>agentCalls};
}
function source(overrides={}){
  return {sourceType:'SERVICE_REQUEST',sourceEventId:'SR-1',sourceReference:'SVC-1',
    imo:fleet[0].imo,requestedRegime:'UAE_SERVICE_INSPECTION',port:'Jebel Ali',
    sourceApprovalStatus:'SOURCE_REVIEWED',provenance:'POC_SIMULATOR',
    createdBy:'Officer One',...overrides};
}
test('entire current fleet evaluated with zero candidates and zero fabricated risks',async()=>{
  const w=workspace();
  try{
    const result=await w.subject.dashboard();
    assert.equal(result.summary.evaluatedPopulation,420);
    assert.equal(result.summary.candidates,0);
    assert.equal(result.summary.assessedRiskVessels,0);
    assert.equal(result.summary.inspectionsCreated,0);
    assert.equal(result.candidates.length,0);
  }finally{w.cleanup();}
});
test('source events are idempotent, combined within regime and permanently manual-review',async()=>{
  const w=workspace();
  try{
    const once=await w.subject.receiveEvent(source());
    assert.equal(once.replayed,false);
    const replay=await w.subject.receiveEvent(source());
    assert.equal(replay.replayed,true);
    await assert.rejects(()=>w.subject.receiveEvent(source({port:'Fujairah'})),
      e=>e instanceof SiTargetingError&&e.code==='SI_EVENT_IDEMPOTENCY_CONFLICT');
    await w.subject.receiveEvent(source({sourceEventId:'SR-2',sourceReference:'SVC-2'}));
    const result=await w.subject.dashboard(),c=result.candidates[0];
    assert.equal(result.summary.candidates,1);
    assert.equal(c.events.length,2);
    assert.equal(c.eligibility,'MANUAL_REVIEW');
    assert.equal(c.vesselName,'Vessel 0');
    assert.equal(c.flag,'UAE');
    assert.equal(c.currentRisk,null);
    assert.equal(c.status,'PENDING_REVIEW');
    assert.equal(c.events[0].provenance,'POC_SIMULATOR');
  }finally{w.cleanup();}
});
test('NMC human-approved referral creates mandatory review even with no saved AI risk',async()=>{
  const w=workspace({referrals:[{
    id:'e49d71b2-5a34-424c-9b2d-000000000001',
    caseId:'61f74e23-1111-4444-8888-0f0f0f0f0f0f',
    imo:fleet[4].imo,status:'PENDING_SCHEDULING',caseStatus:'IN_PROGRESS',
    createdAt:'2026-10-10T09:00:00Z',reason:'Human-approved A01 inspection referral',
    evidenceIds:['NMC-EVIDENCE-001'],sourceAssessmentId:'AI-1000'
  }]});
  try{
    const result=await w.subject.dashboard();
    assert.equal(result.summary.candidates,1);
    assert.equal(result.candidates[0].eligibility,'MANDATORY');
    assert.equal(result.candidates[0].currentRisk,null);
    assert.equal(result.candidates[0].events[0].provenance,'NMC_HUMAN_APPROVED');
    assert.equal(result.summary.bySource.NMC_CASE,1);
  }finally{w.cleanup();}
});
test('human approval is audited and creates exactly one case; replay cannot create second',async()=>{
  const w=workspace();
  try{
    await w.subject.receiveEvent(source());
    const c=(await w.subject.dashboard()).candidates[0];
    const payload={candidateKey:c.key,imo:c.imo,action:'APPROVE',
      actor:'Supervisor',note:'Reviewed simulated supporting evidence'};
    const result=await w.subject.decide(payload);
    assert.equal(result.decision.action,'APPROVE');
    assert.equal(result.inspectionCase.status,'CREATED');
    assert.equal(result.inspectionCase.riskAtApproval,null);
    const current=(await w.subject.dashboard()).candidates[0];
    assert.equal(current.status,'INSPECTION_CREATED');
    assert.equal(current.inspectionCase.id,result.inspectionCase.id);
    await assert.rejects(()=>w.subject.decide(payload),
      e=>e.code==='SI_CANDIDATE_ALREADY_HANDLED');
    assert.equal((await w.subject.dashboard()).summary.inspectionsCreated,1);
  }finally{w.cleanup();}
});
test('priority impact preview/revision never changes legal eligibility, NMC risk or AI data',async()=>{
  const projections=[{
    imo:fleet[0].imo,riskScore:72,riskLevel:'High',
    sourceAssessmentId:'AI-SAVED-01',policyRevision:2
  }];
  const w=workspace({projection:projections});
  try{
    await w.subject.receiveEvent(source());
    const before=(await w.subject.dashboard()).candidates[0];
    assert.equal(before.priority,'PRIORITY');
    const preview=await w.subject.previewRules({
      riskPriorityThreshold:80,includeMissingRiskInReview:true
    });
    assert.deepEqual(preview.affectedImos,[fleet[0].imo]);
    assert.equal(preview.evaluatedPopulation,420);
    assert.equal(preview.unevaluatedRiskVessels,419);
    assert.equal((await w.subject.dashboard()).candidates[0].priority,'PRIORITY');
    const published=await w.subject.publishRules({expectedVersion:1,
      publishedBy:'SME',reason:'Priority trial threshold',
      config:{riskPriorityThreshold:80,includeMissingRiskInReview:true}});
    assert.equal(published.version,2);
    const after=(await w.subject.dashboard()).candidates[0];
    assert.equal(after.priority,'STANDARD');
    assert.equal(after.eligibility,before.eligibility);
    assert.deepEqual(after.currentRisk,before.currentRisk);
    await assert.rejects(()=>w.subject.publishRules({expectedVersion:1,
      publishedBy:'SME',reason:'Priority trial threshold',
      config:{riskPriorityThreshold:10,includeMissingRiskInReview:true}}),
      e=>e.code==='SI_POLICY_VERSION_CONFLICT');
  }finally{w.cleanup();}
});
test('reject unknown IMO, source authority spoof and missing source event',async()=>{
  const w=workspace();
  try{
    await assert.rejects(()=>w.subject.receiveEvent(source({imo:'9999999'})),
      e=>e.code==='SI_EVENT_VALIDATION_FAILED');
    await assert.rejects(()=>w.subject.receiveEvent(source({provenance:'OFFICIAL_PSC'})),
      e=>e.code==='SI_EVENT_VALIDATION_FAILED');
    await assert.rejects(()=>w.subject.receiveEvent(source({sourceEventId:''})),
      e=>e.code==='SI_EVENT_VALIDATION_FAILED');
  }finally{w.cleanup();}
});

test('same IMO across NMC, Service and PSC has one vessel row, three source types, independent decisions',async()=>{
  const approved={
    id:'06f9ba7a-40d0-4dd1-acbd-7a4e60ee0d5a',
    caseId:'9510c038-889f-4cb0-b27a-09681a69e78b',
    imo:fleet[0].imo,status:'PENDING_SCHEDULING',caseStatus:'IN_PROGRESS',
    createdAt:'2026-10-10T09:00:00Z',reason:'Human-approved NMC referral',
    evidenceIds:['NMC-CASE-EVIDENCE'],sourceAssessmentId:'NMC-SAVED-ASSESSMENT'
  };
  const w=workspace({referrals:[approved]});
  try{
    const first=await w.subject.dashboard();
    assert.equal(first.summary.candidateVessels,1);
    assert.equal(first.vesselCandidates[0].sourceTypes.length,1);
    await w.subject.receiveEvent(source());
    await w.subject.receiveEvent({
      ...source(),sourceType:'PSC_PORT_CALL',sourceEventId:'PC-001',
      sourceReference:'PORT-001',requestedRegime:'PORT_STATE_CONTROL'
    });
    const d=await w.subject.dashboard();
    assert.equal(d.summary.candidateVessels,1);
    assert.equal(d.summary.candidates,3); // independent inspection regimes
    assert.equal(d.summary.pendingVessels,1);
    assert.equal(d.summary.pendingReview,3);
    assert.equal(d.summary.bySource.NMC_CASE,1);
    assert.equal(d.summary.bySource.SERVICE_REQUEST,1);
    assert.equal(d.summary.bySource.PSC_PORT_CALL,1);
    assert.equal(d.vesselCandidates.length,1);
    const v=d.vesselCandidates[0];
    assert.equal(v.imo,fleet[0].imo);
    assert.equal(v.sourceTypes.length,3);
    assert.equal(v.sourceEvents.length,3);
    assert.equal(v.regimes.length,3);
    assert.equal(v.workflows.length,3);
    assert.equal(v.eligibility,'MANDATORY');
    assert.equal(v.currentRisk,null);
    assert.equal(v.pendingWorkflows,3);
    const service=d.candidates.find(c=>c.regime==='UAE_SERVICE_INSPECTION');
    const result=await w.subject.decide({
      candidateKey:service.key,imo:service.imo,action:'APPROVE',
      actor:'Inspection Supervisor',note:'Approved service inspection only'
    });
    const after=await w.subject.dashboard();
    assert.equal(result.inspectionCase.regime,'UAE_SERVICE_INSPECTION');
    assert.equal(after.vesselCandidates.length,1);
    assert.equal(after.summary.candidateVessels,1);
    assert.equal(after.summary.createdVessels,1);
    assert.equal(after.vesselCandidates[0].createdWorkflows,1);
    assert.equal(after.vesselCandidates[0].pendingWorkflows,2);
    assert.equal(after.candidates.find(c=>c.regime==='PORT_STATE_CONTROL').status,'PENDING_REVIEW');
    assert.equal(after.candidates.find(c=>c.regime==='FOCUSED_INSPECTION').status,'PENDING_REVIEW');
    const reload=await w.subject.dashboard();
    assert.equal(reload.vesselCandidates.length,1);
    assert.deepEqual(
      [...reload.vesselCandidates[0].sourceTypes].sort(),
      [...v.sourceTypes].sort()
    );
  }finally{w.cleanup();}
});
