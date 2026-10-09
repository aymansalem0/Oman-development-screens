import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {CentralRiskPolicy,calculateRiskPolicy,validateRiskConfig} from '../risk-policy.mjs';

const baseline={
  version:'NMC Risk Ruleset 1.0',name:'National Maritime Risk Model',mode:'weighted',
  weights:{movement:25,inspection:28,certificate:20,dataQuality:14,history:13},
  thresholds:{watch:45,high:65,critical:85}
};
const assessment={
  imo:'9328471',assessmentId:'00000000-0000-4000-8000-000000000123',
  status:'COMPLETED',score:60,level:'Watch',criticalOpenFinding:true,
  signals:[['movement',22],['inspection',82],['certificate',65],['dataQuality',55],['history',82]]
    .map(([factor,severity])=>({factor,severity,evidenceIds:[factor+'-synthetic']}))
};
test('central policy calculation preserves original score and source assessment id',()=>{
  const p=calculateRiskPolicy(assessment,baseline,1);
  assert.equal(p.riskScore,60);assert.equal(p.riskLevel,'Watch');
  assert.equal(p.originalScore,60);assert.equal(p.criticalOpenFinding,true);
  const changed={...baseline,thresholds:{watch:10,high:30,critical:50}};
  const next=calculateRiskPolicy(assessment,changed,2);
  assert.equal(next.riskScore,60);assert.equal(next.riskLevel,'Critical');
  assert.equal(next.sourceAssessmentId,assessment.assessmentId);
  assert.equal(assessment.level,'Watch');
});
test('invalid policies and incomplete evidence fail without substituting synthetic risk',()=>{
  assert.throws(()=>validateRiskConfig({...baseline,weights:{...baseline.weights,movement:40}}));
  assert.throws(()=>validateRiskConfig({...baseline,thresholds:{watch:70,high:30,critical:50}}));
  assert.equal(calculateRiskPolicy({...assessment,signals:assessment.signals.slice(0,4)},baseline,1),null);
});
test('publishing creates immutable versions, active pointer, stale revision rejection and historical projections',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'nmc-policy-'));
  const file=join(dir,'policy.json');
  try{
    const fleet={results:{'9328471':assessment}};
    const service=new CentralRiskPolicy({mode:'json',file,fleet});
    await service.initialize();
    assert.equal((await service.active()).revision,1);
    const candidate={...baseline,thresholds:{watch:10,high:30,critical:50}};
    const published=await service.publish({expectedRevision:1,config:candidate,
      reason:'Test stricter risk policy thresholds',publishedBy:'NMC Risk Supervisor'});
    assert.equal(published.revision,2);
    assert.equal(published.projectionCount,1);
    assert.equal((await service.vessel('9328471')).riskLevel,'Critical');
    assert.equal((await service.active()).previousRevision,1);
    assert.deepEqual((await service.history()).map(r=>r.revision),[2,1]);
    await assert.rejects(service.publish({expectedRevision:1,config:candidate,
      reason:'Outdated version publish attempt',publishedBy:'NMC Risk Supervisor'}),
      e=>e.code==='RISK_POLICY_VERSION_CONFLICT');
    assert.equal((await service.projectionHistory('9328471')).length,1);
    const restarted=new CentralRiskPolicy({mode:'json',file,fleet});
    await restarted.initialize();
    assert.equal((await restarted.active()).revision,2);
    assert.equal(assessment.score,60);assert.equal(assessment.level,'Watch');
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('Oracle risk policy binds avoid reserved SQL keywords that block central seed',()=>{
  const source=readFileSync(new URL('../risk-policy.mjs',import.meta.url),'utf8');
  const oracleValues=source.match(/VALUES\([^)]*\)/g)||[];
  assert.ok(oracleValues.length>=4);
  for(const sql of oracleValues){
    assert.doesNotMatch(sql,/:(?:level|by|ref)\b/i);
  }
  assert.match(source,/:b_published_by/);
  assert.match(source,/:b_risk_level/);
});
