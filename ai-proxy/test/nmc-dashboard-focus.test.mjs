import test from 'node:test';
import assert from 'node:assert/strict';
import {DashboardAiFocus,DashboardFocusError,validateDashboardMetrics,
  validateA02DashboardResponse,validateA01DashboardResponse,
  buildLegacyDashboardRequests,NMC_DASHBOARD_METRIC_IDS,
  selectDashboardFocusVessel}
  from '../nmc-dashboard-focus.mjs';

const metrics=()=>({
  vesselContacts:420,assessedVessels:60,highRiskVessels:16,
  criticalRiskVessels:3,requiresAttention:40,
  activeAlerts:19,openCases:5,activeIncidents:3
});
const factors=['movement','inspection','certificate','dataQuality','history'];
const signals=factors.map((factor,index)=>({
  factor,severity:12+index*9,confidence:0.86,status:'AVAILABLE',
  sourceAgent:index===0||index===4?'A01':'A02',
  evidenceIds:['EV-'+factor],reason:'Verified POC context for '+factor
}));
const vessel={imo:'9328471',assessmentId:'SAVED-ASSMT-123',
  configVersion:'NMC-RISK-V1',score:48,level:'High',
  status:'COMPLETED',signals};
const bundle={evidenceIds:factors.map(f=>'EV-'+f),
  inlineContext:{vessel:{name:'Synthetic POC Vessel'}}};
const candidate=()=>({vessel,bundle});
const a02=()=>({result:{signals:signals.filter(s=>s.sourceAgent==='A02')}});
const a01=(focusMetricId='criticalRiskVessels')=>({response:{
  assessmentId:'AISIT-PROBE',priority:'IMMEDIATE_REVIEW',
  summary:'Evidence-backed situation assessment for POC maritime duty officer.',
  whyItMatters:'Saved vessel inspection/certificate signals suggest prompt review. FOCUS_KPI:'+focusMetricId,
  evidence:[{id:'inspection',type:'INSPECTION',evidenceIds:['EV-inspection'],title:'Existing inspection evidence'}],
  proposedActions:[{actionId:'verify-certificate',actionType:'VERIFY_CERTIFICATE',
    priority:'HIGH',requiresHumanApproval:true,confidence:0.94,
    evidenceIds:['EV-certificate']}],
  agentConfidence:0.84
}});
const focus=(calls,options={})=>new DashboardAiFocus({
  enabled:true,selectVessel:candidate,executeAgent:async(agent,input)=>{
    calls.push({agent,input});
    return agent==='a02'?a02():a01();
  },...options
});
test('regression: 60 assessed dashboard rows have no signals; raw saved Oracle records do',async()=>{
  const fleet={
    snapshot:()=>({counts:{assessed:60},results:{
      '9328471':{imo:'9328471',status:'COMPLETED',
        assessmentId:vessel.assessmentId,score:vessel.score}
    }}),
    getVesselResult:imo=>imo==='9328471'?vessel:null
  };
  // The public DTO MUST NOT be treated as evidence: it omits signals.
  assert.equal(fleet.snapshot().results['9328471'].signals,undefined);
  const bundles=new Map([['9328471',bundle]]);
  const chosen=selectDashboardFocusVessel(fleet,bundles);
  assert.equal(chosen.vessel.imo,'9328471');
  assert.equal(chosen.vessel.signals.length,5);
  const calls=[];
  const service=new DashboardAiFocus({
    enabled:true,
    selectVessel:()=>selectDashboardFocusVessel(fleet,bundles),
    executeAgent:async(agent,input)=>{
      calls.push({agent,input});return agent==='a02'?a02():a01();
    }
  });
  const result=await service.run({metrics:metrics(),confirmCost:true});
  assert.equal(result.sourceImo,'9328471');
  assert.equal(calls.length,2);
  assert.equal(calls[1].input.approvedSignalEvidence.length,5);
});

test('eligible source fail-closed: no bundle or no verified saved signals means zero paid calls',async()=>{
  const fake={snapshot:()=>({results:{'9328471':{
    imo:'9328471',assessmentId:vessel.assessmentId,status:'COMPLETED',score:48}}}),
    getVesselResult:()=>({...vessel,signals:[]})};
  const records=new Map([['9328471',bundle]]);
  assert.equal(selectDashboardFocusVessel(fake,records),null);
  fake.getVesselResult=()=>vessel;
  assert.equal(selectDashboardFocusVessel(fake,new Map()),null);
  let called=0;
  const focus=new DashboardAiFocus({
    enabled:true,selectVessel:()=>selectDashboardFocusVessel(fake,new Map()),
    executeAgent:async()=>{called++;return a01();}
  });
  await assert.rejects(focus.run({metrics:metrics(),confirmCost:true}),
    /DASHBOARD_FOCUS_VESSEL_EVIDENCE_UNAVAILABLE/);
  assert.equal(called,0);
});

test('8 distinct operational metrics pass exact schema, High excludes Critical in caller',()=>{
  const x=validateDashboardMetrics(metrics());
  assert.equal(NMC_DASHBOARD_METRIC_IDS.length,8);
  assert.equal(x.highRiskVessels,16);assert.equal(x.criticalRiskVessels,3);
  assert.equal(x.requiresAttention,40);
});
test('no AI request on GET or without explicit user confirmation',async()=>{
  const calls=[],f=focus(calls);
  assert.equal(f.status().automaticAiCalls,false);
  assert.equal(f.status().assessmentContextReady,true);
  assert.equal(f.status().sourceImo,'9328471');
  assert.deepEqual(f.status().agentIds,['A02','A01']);
  await assert.rejects(f.run({metrics:metrics()}),/DASHBOARD_FOCUS_CONFIRM_REQUIRED/);
  assert.equal(calls.length,0);
});
test('disabled feature does not call existing A01 or A02',async()=>{
  const calls=[],f=focus(calls,{enabled:false});
  await assert.rejects(f.run({metrics:metrics(),confirmCost:true}),
    /DASHBOARD_FOCUS_A01_A02_NOT_ENABLED/);
  assert.equal(calls.length,0);
  // Diagnostically distinguish DISABLED from missing saved Oracle evidence.
  assert.equal(f.status().assessmentContextReady,true);
  assert.equal(f.status().configured,false);
});
test('governance toggle is live, opt-in and never makes a paid call on status',async()=>{
  let enabled=false;const calls=[];
  const f=focus(calls,{enabled:()=>enabled});
  assert.equal(f.status().configured,false);
  assert.equal(f.status().assessmentContextReady,true);
  assert.equal(f.status().sourceImo,'9328471');
  await assert.rejects(f.run({metrics:metrics(),confirmCost:true}),
    /DASHBOARD_FOCUS_A01_A02_NOT_ENABLED/);
  assert.equal(calls.length,0);
  enabled=true;
  assert.equal(f.status().configured,true);
  assert.equal(f.status().potentialAgentCalls,2);
  assert.equal(calls.length,0);
  const result=await f.run({metrics:metrics(),confirmCost:true});
  assert.equal(result.sourceImo,'9328471');
  assert.deepEqual(calls.map(x=>x.agent),['a02','a01']);
  enabled=false;
  assert.equal(f.status().configured,false);
  await assert.rejects(f.run({metrics:metrics(),confirmCost:true}),
    /DASHBOARD_FOCUS_A01_A02_NOT_ENABLED/);
  assert.equal(calls.length,2);
});
test('uses existing A02 and A01 input KEYS, preserves original five risk evidence values',async()=>{
  const calls=[],f=focus(calls);
  const r=await f.run({metrics:metrics(),confirmCost:true});
  assert.deepEqual(calls.map(x=>x.agent),['a02','a01']);
  const [call02,call01]=calls.map(x=>x.input);
  assert.deepEqual(Object.keys(call02),[
    'requestMeta','subject','bundleRef','contextMode','officialScoringRequested',
    'inlineContext','requestedSignals']);
  assert.deepEqual(call02.requestedSignals,['inspection','certificate','dataQuality']);
  assert.equal(call02.subject.type,'VESSEL');
  assert.equal(call02.subject.imo,vessel.imo);
  assert.equal(call02.inlineContext.dashboardOperationalSnapshot.kpis.length,8);
  assert.deepEqual(Object.keys(call01),[
    'requestMeta','subject','bundleRef','mode','officialRisk','riskSignalRunId',
    'requestedOutputs','approvedSignalEvidence','provenance']);
  assert.equal(call01.mode,'SITUATION_ASSESSMENT');
  assert.deepEqual(call01.requestedOutputs,
    ['SUMMARY','WHY_IT_MATTERS','EVIDENCE','ACTIONS']);
  assert.deepEqual(call01.approvedSignalEvidence.map(s=>s.factor),factors);
  assert.deepEqual(call01.approvedSignalEvidence.map(s=>s.severity),
    signals.map(s=>s.severity));
  assert.deepEqual(call01.approvedSignalEvidence.map(s=>s.evidenceIds),
    signals.map(s=>s.evidenceIds));
  assert.ok(call01.approvedSignalEvidence.find(s=>s.factor==='history')
    .reason.includes('activeAlerts=19'));
  assert.equal(r.selection.metricId,'criticalRiskVessels');
  assert.equal(r.selection.value,3);
  assert.equal(r.provider,'AIRIA_EXISTING_A01_A02');
  assert.equal(r.sourceAssessmentId,vessel.assessmentId);
  assert.deepEqual(r.a02VerifiedFactors,['inspection','certificate','dataQuality']);
  assert.equal(r.selection.a01Priority,'IMMEDIATE_REVIEW');
});
test('A01 response format remains original keys; parses one KPI marker in whyItMatters',()=>{
  const out=a01();
  const val=validateA01DashboardResponse(out,metrics(),new Set(bundle.evidenceIds));
  assert.equal(val.metricId,'criticalRiskVessels');
  assert.match(val.reasonEn,/inspection\/certificate/);
  assert.doesNotMatch(val.reasonEn,/FOCUS_KPI/);
  assert.equal(val.confidence,0.84);
});
test('A02 invalid existing signals prevents A01 request',async()=>{
  const calls=[],f=new DashboardAiFocus({
    enabled:true,selectVessel:candidate,
    executeAgent:async agent=>{calls.push(agent);return {result:{signals:[]}};}
  });
  await assert.rejects(f.run({metrics:metrics(),confirmCost:true}),
    /DASHBOARD_FOCUS_A02_INVALID/);
  assert.deepEqual(calls,['a02']);
});
test('reject invalid/missing/unavailable/ambiguous A01 metric marker, no invented AI card',()=>{
  for(const bad of ['fakeMetric','openCases']) {
    const m=bad==='openCases'?{...metrics(),openCases:null}:metrics();
    assert.throws(()=>validateA01DashboardResponse(a01(bad),m,new Set(bundle.evidenceIds)),
      /DASHBOARD_FOCUS_A01_MARKER_INVALID/);
  }
  const noMarker=a01();noMarker.response.whyItMatters='An urgent action should be reviewed.';
  assert.throws(()=>validateA01DashboardResponse(noMarker,metrics(),
    new Set(bundle.evidenceIds)),/DASHBOARD_FOCUS_A01_MARKER_MISSING/);
  const repeated=a01();repeated.response.whyItMatters+=' FOCUS_KPI:openCases';
  assert.throws(()=>validateA01DashboardResponse(repeated,metrics(),
    new Set(bundle.evidenceIds)),/DASHBOARD_FOCUS_A01_MARKER_MISSING/);
});
test('A01 invented or uncited evidence never authorizes highlighted number',()=>{
  const noEvidence=a01();noEvidence.response.evidence=[];
  noEvidence.response.proposedActions=[{actionType:'MONITOR'}];
  assert.throws(()=>validateA01DashboardResponse(noEvidence,metrics(),
    new Set(bundle.evidenceIds)),/DASHBOARD_FOCUS_A01_INVALID/);
  const fake=a01();fake.response.evidence[0].evidenceIds=['NOT-REAL'];
  assert.throws(()=>validateA01DashboardResponse(fake,metrics(),
    new Set(bundle.evidenceIds)),/DASHBOARD_FOCUS_A01_EVIDENCE_INVALID/);
});
test('same snapshot reuses 2 AI results without paid calls; changed counts run A02+A01 again',async()=>{
  const calls=[],f=focus(calls);
  const first=await f.run({metrics:metrics(),confirmCost:true});
  const again=await f.run({metrics:metrics(),confirmCost:true});
  assert.equal(calls.length,2);assert.equal(first.reused,false);assert.equal(again.reused,true);
  const changed=await f.run({metrics:{...metrics(),activeAlerts:20},confirmCost:true});
  assert.equal(calls.length,4);assert.equal(changed.snapshot.activeAlerts,20);
});
test('concurrent requests blocked, preserving explicit two-request budget',async()=>{
  const calls=[];let resolve;
  const pending=new Promise(r=>resolve=r);
  const f=focus(calls,{executeAgent:async(agent)=>{
    calls.push({agent});if(agent==='a02')await pending;
    return agent==='a02'?a02():a01();
  }});
  const first=f.run({metrics:metrics(),confirmCost:true});
  await assert.rejects(f.run({metrics:metrics(),confirmCost:true}),
    /DASHBOARD_FOCUS_IN_PROGRESS/);
  resolve();await first;assert.equal(calls.length,2);
});
test('invalid KPI client input cannot trigger a model request',async()=>{
  const calls=[],f=focus(calls);
  const invalid=[
    {...metrics(),madeUp:22},{...metrics(),openCases:-1},
    {...metrics(),activeAlerts:NaN},{...metrics(),activeAlerts:'19'},
    Object.fromEntries(Object.entries(metrics()).slice(0,7))
  ];
  for(const data of invalid)
    await assert.rejects(f.run({metrics:data,confirmCost:true}),
      /DASHBOARD_FOCUS_METRICS_INVALID/);
  assert.equal(calls.length,0);
});
test('cannot send synthetic dashboard as a nonexistent maritime vessel',()=>{
  const bad={vessel:{...vessel,imo:'DASHBOARD'},bundle};
  assert.throws(()=>buildLegacyDashboardRequests(metrics(),bad),
    /DASHBOARD_FOCUS_VESSEL_EVIDENCE_UNAVAILABLE/);
});
