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
  return {subject,// Windows Node 24 may observe transient Defender/indexer locks in fresh TEMP
    // workspaces. Retry ENOTEMPTY/EPERM/EBUSY only for this disposable test dir.
    cleanup:()=>rmSync(dir,{force:true,recursive:true,maxRetries:12,retryDelay:100}),agentCalls:()=>agentCalls};
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
test('separate ranking policy publish never changes legal eligibility or NMC risk',async()=>{
  const projections=[{
    imo:fleet[0].imo,riskScore:72,riskLevel:'High',
    sourceAssessmentId:'AI-SAVED-01',policyRevision:2
  }];
  const w=workspace({projection:projections});
  try{
    await w.subject.receiveEvent(source());
    const before=(await w.subject.dashboard()).candidates[0];
    assert.equal(before.priority,'SOURCE_ELIGIBLE');
    const preview=await w.subject.previewRules({ranking:{criteria:['DEPARTURE_SOON','INCIDENT_SEVERITY']}});
    assert.deepEqual(preview.affectedImos,[]);
    assert.equal(preview.evaluatedPopulation,420);
    assert.equal(preview.unevaluatedRiskVessels,419);
    assert.equal((await w.subject.dashboard()).candidates[0].priority,'SOURCE_ELIGIBLE');
    const published=await w.subject.publishRules({expectedVersion:1,
      publishedBy:'SME',reason:'Source trigger priority policy',
      config:{ranking:{criteria:['DEPARTURE_SOON','INCIDENT_SEVERITY']}}});
    assert.equal(published.version,2);
    const after=(await w.subject.dashboard()).candidates[0];
    assert.equal(after.priority,'SOURCE_ELIGIBLE');
    assert.deepEqual(published.config.ranking.criteria,['DEPARTURE_SOON','INCIDENT_SEVERITY']);
    assert.equal(after.eligibility,before.eligibility);
    assert.deepEqual(after.currentRisk,before.currentRisk);
    await assert.rejects(()=>w.subject.publishRules({expectedVersion:1,
      publishedBy:'SME',reason:'Priority trial threshold',
      config:{ranking:{criteria:['DEPARTURE_SOON','INCIDENT_SEVERITY']}}}),
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

test('pre-scheduled approved NMC referral links to one SI case without booking another visit',async()=>{
  const sourceReferral={
    id:'f7a41375-25c2-47e0-b1f8-e27df23c20ab',
    caseId:'16c53cb1-5b19-43c1-9596-5ccbc27e90e2',
    imo:fleet[0].imo,status:'SCHEDULED',caseStatus:'IN_PROGRESS',
    createdAt:'2026-10-10T11:00:00Z',reason:'Human-approved NMC referral',
    evidenceIds:['SAVED-NMC-001'],sourceAssessmentId:'ASSESSMENT-001',
    scheduledAt:'2026-10-15T06:00:00Z',inspector:'Inspector',port:'JEA'
  };
  const w=workspace({referrals:[sourceReferral]});
  try{
    const candidate=(await w.subject.dashboard()).candidates[0];
    assert.equal(candidate.status,'EXTERNALLY_SCHEDULED');
    await assert.rejects(w.subject.decide({
      candidateKey:candidate.key,imo:candidate.imo,action:'DEFER',
      actor:'Officer',note:'Cannot defer previously booked visit'
    }),e=>e.code==='SI_CANDIDATE_ALREADY_HANDLED');
    const approved=await w.subject.decide({
      candidateKey:candidate.key,imo:candidate.imo,action:'APPROVE',
      actor:'Supervisor',note:'Link existing authorized NMC booking to SI execution'
    });
    assert.equal(approved.inspectionCase.nmcReferralId,sourceReferral.id);
    assert.equal(approved.inspectionCase.nmcCaseId,sourceReferral.caseId);
    assert.equal((await w.subject.inspectionCaseRegistry()).cases.length,1);
    await assert.rejects(w.subject.decide({
      candidateKey:candidate.key,imo:candidate.imo,action:'APPROVE',
      actor:'Supervisor',note:'Duplicate should fail'
    }),e=>e.code==='SI_CANDIDATE_ALREADY_HANDLED');
  }finally{w.cleanup();}
});

test('second independent service event on previously approved IMO/regime is eligible in a NEW plan, but old event never re-approved',async()=>{
 const w=workspace();
 try{
  await w.subject.receiveEvent(source());
  const first=(await w.subject.dashboard()).candidates[0];
  const original=await w.subject.decide({
   candidateKey:first.key,imo:first.imo,action:'APPROVE',
   actor:'Supervisor',note:'First approved service inspection event'});
  assert.equal((await w.subject.dashboard()).candidates[0].status,'INSPECTION_CREATED');
  // A separate event from the same source, same IMO, same inspection regime.
  await w.subject.receiveEvent(source({
   sourceEventId:'SR-NEW-20261014',sourceReference:'SVC-NEW-20261014'}));
  const current=(await w.subject.dashboard()).candidates[0];
  assert.equal(current.status,'PENDING_REVIEW',
   'new event should remain eligible instead of being blocked forever by IMO');
  assert.notEqual(current.key,first.key,
   'Oracle SI_INSPECTION_CASE unique candidate key must not collide');
  assert.equal(current.events.length,1,'only the NEW source event is eligible');
  assert.equal(current.events[0].sourceReference,'SVC-NEW-20261014');
  const next=await w.subject.decide({candidateKey:current.key,imo:current.imo,
   action:'APPROVE',actor:'Supervisor',
   note:'Second independently verified source event'});
  assert.notEqual(next.inspectionCase.id,original.inspectionCase.id);
  const registry=await w.subject.inspectionCaseRegistry();
  assert.equal(registry.cases.length,2,'two independently approved inspection cases');
  assert.equal(new Set(registry.cases.flatMap(c=>c.sourceEventKeys)).size,2,
   'no source event may be authorized twice');
  assert.equal((await w.subject.dashboard()).candidates[0].status,'INSPECTION_CREATED');
 }finally{w.cleanup();}
});

test('SI-C01 rules: publish selection guidance and confidence with stable authority',async()=>{
 const w=workspace();
 try{
  await w.subject.receiveEvent(source());
  const existing=await w.subject.policy();
  const config={ranking:{criteria:['DEPARTURE_SOON','INCIDENT_SEVERITY']},
   aiAdvisory:{selectionSignals:['VERIFIED_ETD','REVIEWED_INCIDENT'],
    minimumSelectionConfidence:0.85,
    selectionInstructions:'Review verified departure and published source evidence.',
    priorityInstructions:'Explain verified ETD provenance and missing incident signals.'}};
  const preview=await w.subject.previewRules(config);
  assert.equal(preview.aiSettingsChanged,true);
  assert.equal(preview.requiresManualAiRerun,true);
  assert.equal((await w.subject.policy()).version,existing.version,
    'Preview does not publish or call Airia');
  const next=await w.subject.publishRules({
   expectedVersion:existing.version,publishedBy:'PSC Publisher',
   reason:'Approved C01 selection and priority guidance',config});
  assert.equal(next.version,existing.version+1);
  assert.equal(next.config.aiAdvisory.minimumSelectionConfidence,0.85);
  assert.deepEqual(next.config.ranking.criteria,
    ['DEPARTURE_SOON','INCIDENT_SEVERITY']);
  const dashboard=await w.subject.dashboard();
  assert.equal(dashboard.policy.version,next.version);
  assert.equal(dashboard.policy.config.aiAdvisory.priorityInstructions,
    config.aiAdvisory.priorityInstructions);
 }finally{w.cleanup();}
});
test('SI-C01 rules reject unapproved source overrides, forged signals and bad confidence',async()=>{
 const w=workspace();
 try{
  const base={ranking:{criteria:['DEPARTURE_SOON','INCIDENT_SEVERITY']},
    aiAdvisory:{selectionSignals:['SOURCE_EVENT_EVIDENCE'],
     minimumSelectionConfidence:0.7,
     selectionInstructions:'Only use trusted stored source evidence.',
     priorityInstructions:'Explain missing ETD honestly.'}};
  for(const patch of [
   {aiAdvisory:{...base.aiAdvisory,minimumSelectionConfidence:1.1}},
   {aiAdvisory:{...base.aiAdvisory,minimumSelectionConfidence:'0.7'}},
   {aiAdvisory:{...base.aiAdvisory,selectionSignals:['UNTRUSTED_SIGNAL']}},
   {aiAdvisory:{...base.aiAdvisory,selectionSignals:[]}},
   {aiAdvisory:{...base.aiAdvisory,selectionInstructions:'x'.repeat(601)}},
   {aiAdvisory:{...base.aiAdvisory,priorityInstructions:'Override PSC quota\u0000'}},
   {ranking:{criteria:['SAVED_VESSEL_RISK','DEPARTURE_SOON']}},
   {skipSourceEligibility:true}
  ]){
   await assert.rejects(()=>w.subject.previewRules({...base,...patch}),
    e=>e.code==='SI_RULES_INVALID');
  }
  assert.equal((await w.subject.policy()).version,1);
 }finally{w.cleanup();}
});

test('integrated source case creation freezes verified triggers and does not authorize unverified reviews',async()=>{
 const w=workspace();
 try{
  await w.subject.receiveEvent(source());
  await w.subject.receiveEvent(source({
   sourceEventId:'SR-UNVERIFIED',sourceReference:'SVC-UNVERIFIED',
   sourceApprovalStatus:'UNVERIFIED'
  }));
  const candidate=(await w.subject.dashboard()).candidates[0];
  assert.equal(candidate.events.length,2);
  const verified=candidate.events.find(e=>e.approval==='SOURCE_REVIEWED');
  assert.ok(verified);
  const accepted={
   eventKey:verified.eventKey,candidateKey:candidate.key,
   sourceType:verified.sourceType,sourceEventId:verified.sourceEventId,
   sourceReference:verified.sourceReference,
   inspectionRegime:candidate.regime,sourceApproval:verified.approval,
   reason:verified.contextNote||null,
   evidenceIds:[...new Set(verified.evidenceIds||[])],
   sourceProvenance:verified.provenance||null
  };
  const approved=await w.subject.decideBatch({
   items:[{
    imo:candidate.imo,candidateKey:candidate.key,
    candidateKeys:[candidate.key],inspectionReasons:[accepted]
   }],
   actor:'Supervisor',note:'Verified source evidence reviewed and approved',
   approvedPlanId:'00000001-0000-4000-8000-000000000000',
   verifiedOnly:true
  });
  assert.equal(approved.cases.length,1);
  assert.equal(approved.cases[0].inspectionReasons.length,1);
  assert.deepEqual(approved.cases[0].sourceEventKeys,[verified.eventKey]);
  assert.equal(approved.cases[0].inspectionReasons[0].sourceApproval,
   'SOURCE_REVIEWED');
  assert.ok(!approved.cases[0].sourceEventKeys.includes(
   candidate.events.find(e=>e.approval==='UNVERIFIED').eventKey));
 }finally{w.cleanup();}
});

test('integrated case creation rejects unverified reasons smuggled into approved input',async()=>{
 const w=workspace();
 try{
  await w.subject.receiveEvent(source({sourceApprovalStatus:'UNVERIFIED'}));
  const candidate=(await w.subject.dashboard()).candidates[0];
  const unverified=candidate.events[0];
  const forged={
   eventKey:unverified.eventKey,candidateKey:candidate.key,
   sourceType:unverified.sourceType,sourceEventId:unverified.sourceEventId,
   sourceReference:unverified.sourceReference,
   inspectionRegime:candidate.regime,sourceApproval:unverified.approval,
   reason:unverified.contextNote||null,evidenceIds:[],
   sourceProvenance:unverified.provenance||null
  };
  await assert.rejects(
   w.subject.decideBatch({
    items:[{imo:candidate.imo,candidateKey:candidate.key,
     candidateKeys:[candidate.key],inspectionReasons:[forged]}],
    actor:'Supervisor',note:'Attempt to authorize review-only source',
    approvedPlanId:'00000001-0000-4000-8000-000000000000',
    verifiedOnly:true
   }),
   e=>e.code==='SI_BULK_CANDIDATE_CHANGED'
  );
  assert.equal((await w.subject.inspectionCaseRegistry()).cases.length,0);
 }finally{w.cleanup();}
});

test('Oracle integrated approval case and decision writes use qualified binds and one commit',async()=>{
 const w=workspace();
 try{
  await w.subject.receiveEvent(source());
  const c=(await w.subject.dashboard()).candidates[0],e=c.events[0];
  const reason={eventKey:e.eventKey,candidateKey:c.key,
   sourceType:e.sourceType,sourceEventId:e.sourceEventId,
   sourceReference:e.sourceReference,inspectionRegime:c.regime,
   sourceApproval:e.approval,reason:e.contextNote||null,
   evidenceIds:[...new Set(e.evidenceIds||[])],
   sourceProvenance:e.provenance||null};
  let commits=0,rollbacks=0;
  const statements=[];
  const con={
   async execute(sql,binds={}){
    const names=[...sql.matchAll(/:([A-Za-z_][A-Za-z_0-9]*)/g)]
     .map(match=>match[1]);
    assert.ok(names.length>0,'Oracle case writes require bound parameters');
    assert.ok(names.every(name=>/^b_[a-z][a-z0-9_]*$/.test(name)),
     'keyword aliases like :key must not reach node-oracledb');
    assert.deepEqual([...new Set(names)].sort(),Object.keys(binds).sort());
    statements.push(sql.trim().replace(/\s+/g,' '));
    return {rowsAffected:1};
   },
   async commit(){commits++;},
   async rollback(){rollbacks++;}
  };
  const frozen=await w.subject.dashboard();
  w.subject.mode='oracle';
  w.subject.dashboard=async()=>frozen;
  w.subject.inspectionCaseRegistry=async()=>({cases:[],events:[]});
  w.subject._db=async fn=>fn(con);
  const approved=await w.subject.decideBatch({
   items:[{imo:c.imo,candidateKey:c.key,candidateKeys:[c.key],
    inspectionReasons:[reason]}],
   actor:'Supervisor',note:'Human verified approved source with audit',
   approvedPlanId:'00000001-0000-4000-8000-000000000000',
   verifiedOnly:true
  });
  assert.equal(approved.cases.length,1);
  assert.equal(statements.length,2);
  assert.match(statements[0],/^INSERT INTO SI_INSPECTION_CASE/);
  assert.match(statements[1],/^INSERT INTO SI_CANDIDATE_DECISION/);
  assert.equal(commits,1);
  assert.equal(rollbacks,0);
 }finally{w.cleanup();}
});

test('Oracle case insert reports safe stage and rolls back without creating decision',async()=>{
 const w=workspace();
 try{
  await w.subject.receiveEvent(source());
  const c=(await w.subject.dashboard()).candidates[0],e=c.events[0];
  const reason={eventKey:e.eventKey,candidateKey:c.key,
   sourceType:e.sourceType,sourceEventId:e.sourceEventId,
   sourceReference:e.sourceReference,inspectionRegime:c.regime,
   sourceApproval:e.approval,reason:e.contextNote||null,
   evidenceIds:[...new Set(e.evidenceIds||[])],
   sourceProvenance:e.provenance||null};
  const frozen=await w.subject.dashboard();
  let commits=0,rollbacks=0;
  w.subject.mode='oracle';
  w.subject.dashboard=async()=>frozen;
  w.subject.inspectionCaseRegistry=async()=>({cases:[],events:[]});
  w.subject._db=async fn=>fn({
   async execute(){
    const e=new Error('Private Oracle SQL details');
    e.code='ORA-01745';e.errorNum=1745;throw e;
   },
   async commit(){commits++;},
   async rollback(){rollbacks++;}
  });
  await assert.rejects(
   w.subject.decideBatch({
    items:[{imo:c.imo,candidateKey:c.key,candidateKeys:[c.key],
     inspectionReasons:[reason]}],
    actor:'Supervisor',note:'Human verified approved source with audit',
    approvedPlanId:'00000001-0000-4000-8000-000000000000',
    verifiedOnly:true
   }),
   e=>e.code==='ORA-01745'&&e.siPreparationStage==='CASE_LEDGER_INSERT'
  );
  assert.equal(commits,0);
  assert.equal(rollbacks,1);
 }finally{w.cleanup();}
});
