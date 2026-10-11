import test from 'node:test';
import assert from 'node:assert/strict';
import {DashboardAiFocus,DashboardFocusError,validateDashboardMetrics,
  validateDashboardAiChoice,focusPrompt,NMC_DASHBOARD_METRIC_IDS}
  from '../nmc-dashboard-focus.mjs';

const metrics=()=>({
  vesselContacts:420,assessedVessels:42,highRiskVessels:9,
  criticalRiskVessels:2,requiresAttention:13,
  activeAlerts:7,openCases:4,activeIncidents:3
});
const raw=(focusMetricId='activeIncidents')=>({result:{output:JSON.stringify({
  focusMetricId,
  reasonEn:'Three reported incidents remain unresolved and merit duty officer review.',
  reasonAr:'يوجد ثلاثة بلاغات حوادث غير مغلقة ويجب مراجعتها من موظف المركز البحري.',
  confidence:0.91
})}});
test('fixed eight unique KPIs, high and critical risk remain separate',()=>{
  const x=validateDashboardMetrics(metrics());
  assert.equal(NMC_DASHBOARD_METRIC_IDS.length,8);
  assert.equal(x.highRiskVessels,9);
  assert.equal(x.criticalRiskVessels,2);
  assert.equal(x.vesselContacts,420);
  assert.equal(focusPrompt(x).inputMetrics.length,8);
  assert.equal(focusPrompt(x).dataNature,'SYNTHETIC_POC_ADVISORY_NOT_OFFICIAL');
});
test('cannot call paid Airia without explicit confirmation',async()=>{
  let calls=0;
  const focus=new DashboardAiFocus({enabled:true,executeAgent:async()=>{calls++;return raw();}});
  await assert.rejects(focus.run({metrics:metrics()}),
    error=>error.code==='DASHBOARD_FOCUS_CONFIRM_REQUIRED');
  assert.equal(calls,0);
  assert.equal(focus.status().automaticAiCalls,false);
});
test('feature disabled without distinct KPI pipeline; never routes to A01 silently',async()=>{
  const focus=new DashboardAiFocus({enabled:false,executeAgent:async()=>raw()});
  await assert.rejects(focus.run({metrics:metrics(),confirmCost:true}),
    error=>error.code==='DASHBOARD_FOCUS_PIPELINE_NOT_CONFIGURED');
  assert.equal(focus.status().configured,false);
});
test('strict metric schema: missing, unknown, invalid, NaN, string or negative cannot call agent',async()=>{
  let count=0;
  const focus=new DashboardAiFocus({enabled:true,executeAgent:async()=>{count++;return raw();}});
  const cases=[
    {...metrics(),unexpected:7},
    {...metrics(),openCases:-1},
    {...metrics(),openCases:NaN},
    {...metrics(),activeAlerts:'7'},
    {...metrics(),activeIncidents:1.5},
    Object.fromEntries(Object.entries(metrics()).slice(0,7)),
    {...metrics(),vesselContacts:10000001}
  ];
  for(const input of cases)
    await assert.rejects(focus.run({metrics:input,confirmCost:true}),
      e=>e.code==='DASHBOARD_FOCUS_METRICS_INVALID');
  assert.equal(count,0);
});
test('missing source data remains NULL and cannot be selected or invented',()=>{
  const original={...metrics(),openCases:null};
  const values=validateDashboardMetrics(original);
  assert.equal(values.openCases,null);
  assert.throws(()=>validateDashboardAiChoice(raw('openCases'),values),
    e=>e.code==='DASHBOARD_FOCUS_AI_RESPONSE_INVALID');
  const few={...metrics(),activeAlerts:null,openCases:null,activeIncidents:null,
    highRiskVessels:null};
  let count=0;
  return assert.rejects(new DashboardAiFocus({enabled:true,executeAgent:async()=>{
    count++;return raw();
  }}).run({metrics:few,confirmCost:true}),
    e=>e.code==='DASHBOARD_FOCUS_INSUFFICIENT_DATA').then(()=>assert.equal(count,0));
});
test('genuine AI response selects one card, returns exact source number and bilingual reason',async()=>{
  let count=0,agentInput;
  const f=new DashboardAiFocus({enabled:true,executeAgent:async input=>{
    count++;agentInput=input;return raw('activeIncidents');
  }});
  const result=await f.run({metrics:metrics(),confirmCost:true});
  assert.equal(count,1);
  assert.equal(result.modelBased,true);
  assert.equal(result.selection.metricId,'activeIncidents');
  assert.equal(result.selection.value,3);
  assert.match(result.selection.reasonAr,/ثلاثة/);
  assert.equal(result.provider,'AIRIA_DEDICATED_DASHBOARD_PIPELINE');
  assert.equal(agentInput.inputMetrics.length,8);
  assert.equal(result.requiresHumanReview,true);
  assert.match(result.snapshotHash,/^[0-9a-f]{64}$/);
});
test('same snapshot reused without charge; new numbers need separate explicit call',async()=>{
  let count=0,clock=Date.now();
  const f=new DashboardAiFocus({enabled:true,now:()=>clock,executeAgent:async()=>{
    count++;return raw();
  }});
  const first=await f.run({metrics:metrics(),confirmCost:true});
  const again=await f.run({metrics:metrics(),confirmCost:true});
  assert.equal(count,1);assert.equal(first.reused,false);assert.equal(again.reused,true);
  const changed=await f.run({metrics:{...metrics(),activeIncidents:4},confirmCost:true});
  assert.equal(count,2);assert.equal(changed.snapshot.activeIncidents,4);
  clock+=5*60*1000+1;
  await f.run({metrics:{...metrics(),activeIncidents:4},confirmCost:true});
  assert.equal(count,3);
});
test('two simultaneous requests never launch two calls',async()=>{
  let resolve, count=0;
  const promise=new Promise(r=>resolve=r);
  const f=new DashboardAiFocus({enabled:true,executeAgent:async()=>{
    count++;await promise;return raw();
  }});
  const first=f.run({metrics:metrics(),confirmCost:true});
  await assert.rejects(f.run({metrics:metrics(),confirmCost:true}),
    e=>e.code==='DASHBOARD_FOCUS_IN_PROGRESS');
  resolve();
  await first;
  assert.equal(count,1);
});
test('malformed, unknown, invented or unsupported AI output fails closed with NO focus',async()=>{
  for(const output of [
    {result:{focusMetricId:'fabricatedMaritimeEmergency',reasonEn:'Long enough explanation',
      reasonAr:'شرح عربي كاف جدا',confidence:0.5}},
    {result:{focusMetricId:'activeIncidents',reasonEn:'short',reasonAr:'شرح عربي طويل جدا'}},
    {result:{focusMetricId:'activeIncidents',reasonEn:'Long enough explanation',
      reasonAr:'شرح عربي طويل جدا',confidence:5}},
    {result:'not-json'},
    {result:{focusMetricId:'openCases',reasonEn:'A reasonable source-led explanation here.',
      reasonAr:'شرح عربي كاف جدا',confidence:-1}}
  ]) {
    const f=new DashboardAiFocus({enabled:true,executeAgent:async()=>output});
    await assert.rejects(f.run({metrics:metrics(),confirmCost:true}),
      e=>e instanceof DashboardFocusError&&e.code==='DASHBOARD_FOCUS_AI_RESPONSE_INVALID');
  }
});
