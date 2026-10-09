import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const scratch=mkdtempSync(join(tmpdir(),'nmc-fleet-ai-'));
process.env.NMC_FLEET_STORE_PATH=join(scratch,'fleet.json');
const {evaluateFleetSignals,verifyFleetSignals,fleetAdminAuthorized,FleetAssessmentManager}=await import('../fleet-ai.mjs');
const config={version:'NMC Risk Ruleset 1.0',weights:{movement:25,inspection:28,certificate:20,dataQuality:14,history:13},
  thresholds:{watch:45,high:65,critical:85},mode:'weighted'};
const factors=['movement','inspection','certificate','dataQuality','history'];
const severities=[22,82,68,45,82];
const signals=factors.map((factor,i)=>({factor,severity:severities[i],confidence:0.75,
  status:'AVAILABLE',sourceAgent:['movement','history'].includes(factor)?'A01':'A02',
  evidenceIds:factor==='history'||factor==='inspection'?['PSC-SIM-0001-01']:['VES-9328471'],
  reason:'Synthetic test evidence'}));
test('five validated severities reproduce existing Gulf Horizon weighted score 59 Watch',()=>{
  const risk=evaluateFleetSignals(signals,config);
  assert.equal(risk.score,59);assert.equal(risk.level,'Watch');
  assert.throws(()=>evaluateFleetSignals(signals,{...config,weights:{...config.weights,history:99}}),/INVALID_FLEET_WEIGHTS/);
});
test('agent contracts require exact evidence IDs, external PSC references and AVAILABLE status',()=>{
  const a01={signals:signals.filter(s=>s.sourceAgent==='A01')};
  const a02={signals:signals.filter(s=>s.sourceAgent==='A02')};
  assert.equal(verifyFleetSignals(a01,a02,['VES-9328471','PSC-SIM-0001-01'],
    ['PSC-SIM-0001-01'],true).length,5);
  assert.throws(()=>verifyFleetSignals(a01,{signals:a02.signals.map(s=>s.factor==='inspection'?
    {...s,status:'INSUFFICIENT_EVIDENCE'}:s)},['VES-9328471','PSC-SIM-0001-01'],
    ['PSC-SIM-0001-01'],true),/FLEET_AI_INSUFFICIENT_EVIDENCE/);
  assert.throws(()=>verifyFleetSignals(a01,{signals:a02.signals.map(s=>s.factor==='inspection'?
    {...s,evidenceIds:['VES-9328471']}:s)},['VES-9328471','PSC-SIM-0001-01'],
    ['PSC-SIM-0001-01'],true),/FLEET_AI_PSC_EVIDENCE_NOT_CITED/);
  assert.throws(()=>verifyFleetSignals(a01,{signals:a02.signals.map(s=>s.factor==='inspection'?
    {...s,evidenceIds:['FAKE-EVIDENCE']}:s)},['VES-9328471','PSC-SIM-0001-01'],
    ['PSC-SIM-0001-01'],true),/FLEET_AI_UNVERIFIED_EVIDENCE_ID/);
});
test('admin token must be configured, long enough and equal',()=>{
  const secret='NMC_POC_INTEGRATION_1234567890';
  assert.equal(fleetAdminAuthorized(secret,secret),true);
  assert.equal(fleetAdminAuthorized('wrong',secret),false);
  assert.equal(fleetAdminAuthorized(secret,''),false);
  assert.equal(fleetAdminAuthorized('',secret),false);
});
test('batch runner persistently stores only validated five-factor assessments',async()=>{
  const calls=[];
  const fleet=new FleetAssessmentManager({
    executeAgent:async(agent,payload)=>{
      calls.push(agent);
      assert.equal(payload.inlineContext.externalPsc.authoritative,false);
      assert.equal(payload.subject.imo,'9328471');
      return {signals:signals.filter(s=>s.sourceAgent===agent.toUpperCase())};
    },
    getPscVessel:async imo=>({
      imo,authoritative:false,dataNature:'SYNTHETIC_NOT_RIYADH_MOU',
      sourceSystem:'NMC_POC_EXTERNAL_PSC_SIMULATED',sourceMode:'LOCAL_FIXTURE_SNAPSHOT',
      coverage:'SIMULATED_RECORDS',retrievedAt:new Date().toISOString(),
      pdfContentAvailable:false,inspections:[{inspectionId:'PSC-SIM-0001-01'}],
      deficiencies:[{status:'OPEN',severity:'CRITICAL'}],detentions:[],
      evidenceIds:['PSC-SIM-0001-01'],
      summary:{inspections:1,deficiencies:1,openDeficiencies:1,detentions:0}
    })
  });
  const input={vessels:[{
    imo:'9328471',evidenceIds:['VES-9328471'],
    inlineContext:{vessel:{imo:'9328471'},deficiencies:[]}
  }],config};
  const queued=fleet.start(input);
  assert.equal(queued.total,1);assert.equal(queued.estimatedAiriaCalls,2);
  for(let k=0;k<100&&fleet.snapshot().job?.status==='RUNNING';k++){
    await new Promise(r=>setTimeout(r,5));
  }
  const summary=fleet.snapshot();
  assert.equal(summary.job.status,'COMPLETED');
  assert.equal(summary.counts.assessed,1);
  assert.equal(summary.counts.priorityReview,1);
  assert.equal(summary.results['9328471'].score,59);
  assert.equal(summary.results['9328471'].operationalPriority,'Priority Review');
  assert.equal(calls.length,2);
  assert.equal(JSON.parse(readFileSync(process.env.NMC_FLEET_STORE_PATH,'utf8')).results['9328471'].signals.length,5);
  assert.throws(()=>fleet.start({vessels:[input.vessels[0],input.vessels[0]],config}),/INVALID_FLEET_INPUT_BUNDLE/);
  rmSync(scratch,{recursive:true,force:true});
});
