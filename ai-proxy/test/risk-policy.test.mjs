import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
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

test('save draft is durable and never changes active score; publish reuses the same AI factors',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'nmc-risk-draft-'));
  try{
    const file=join(dir,'workspace.json');
    const fleet={results:{'9328471':assessment}};
    const svc=new CentralRiskPolicy({mode:'json',file,fleet});
    await svc.initialize();
    const initial=await svc.projectCurrent();
    const proposed={...baseline,
      weights:{movement:35,inspection:18,certificate:20,dataQuality:14,history:13}};
    const draft=await svc.saveDraft({config:proposed,
      expectedRevision:1,expectedDraftRevision:0,updatedBy:'Business Risk Editor'});
    assert.equal(draft.draftRevision,1);
    assert.equal((await svc.active()).revision,1);
    assert.equal((await svc.projectCurrent()).projections[0].riskScore,
      initial.projections[0].riskScore);
    const restarted=new CentralRiskPolicy({mode:'json',file,fleet});
    await restarted.initialize();
    assert.equal((await restarted.draft()).config.weights.movement,35);
    await assert.rejects(restarted.saveDraft({config:proposed,
      expectedRevision:1,expectedDraftRevision:0,updatedBy:'Business Risk Editor'}),
      e=>e.code==='RISK_DRAFT_VERSION_CONFLICT');
    const published=await restarted.publish({expectedRevision:1,config:proposed,
      reason:'Approved factor weighting change for fleet',publishedBy:'NMC Supervisor'});
    assert.equal(published.revision,2);
    const p=(await restarted.vessel('9328471'));
    assert.equal(p.factorSnapshot.factors.find(f=>f.key==='inspection').severity,82);
    assert.equal(p.factorSnapshot.factors.find(f=>f.key==='inspection').weight,18);
    assert.equal(p.factorSnapshot.factors.find(f=>f.key==='inspection').weightedContribution,14.76);
    const timeline=await restarted.projectionHistory('9328471');
    assert.equal(timeline[0].factorSnapshot.clampedAndRoundedScore,p.riskScore);
    assert.equal((await restarted.draft()).baseRevision,1);
    assert.equal(assessment.signals.find(x=>x.factor==='inspection').severity,82);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
test('published risk factor snapshots preserve source references and explain calculation-mode adjustment',()=>{
  const revised={...baseline,mode:'max-signal'};
  const p=calculateRiskPolicy(assessment,revised,3);
  assert.equal(p.factorSnapshot.calculationMode,'max-signal');
  assert.equal(p.factorSnapshot.factors.length,5);
  assert.deepEqual(p.factorSnapshot.factors[0].evidenceIds,['movement-synthetic']);
  assert.equal(Math.round(p.factorSnapshot.weightedSubtotal+
    p.factorSnapshot.modeAdjustment),p.riskScore);
});

test('old risk policy projections are explained only when saved source assessment exactly matches',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'nmc-risk-legacy-'));
  try{
    const file=join(dir,'risk.json'),fleet={results:{'9328471':assessment}};
    const svc=new CentralRiskPolicy({mode:'json',file,fleet});
    await svc.initialize();
    await svc.publish({expectedRevision:1,config:baseline,
      reason:'Legacy publication for backwards compatibility',publishedBy:'NMC Supervisor'});
    const data=JSON.parse(readFileSync(file,'utf8'));
    delete data.projections[0].factorSnapshot;
    writeFileSync(file,JSON.stringify(data));
    const reloaded=new CentralRiskPolicy({mode:'json',file,fleet});
    await reloaded.initialize();
    const old=(await reloaded.projectionHistory('9328471'))[0];
    assert.equal(old.factorSnapshotReconstructed,true);
    assert.equal(old.factorSnapshot.clampedAndRoundedScore,old.riskScore);
    const changed={results:{'9328471':{...assessment,assessmentId:'SOME-OTHER-ASSESSMENT'}}};
    const nonmatching=new CentralRiskPolicy({mode:'json',file,fleet:changed});
    await nonmatching.initialize();
    const unavailable=(await nonmatching.projectionHistory('9328471'))[0];
    assert.equal(unavailable.factorSnapshot,null);
    assert.equal(unavailable.factorSnapshotReconstructed,false);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('published A03 weight recalculates only source assessments with a validated document factor',()=>{
  const configWithDoc={...baseline,weights:{movement:23,inspection:25,
    certificate:18,dataQuality:13,history:11,documentIntegrity:10}};
  assert.equal(validateRiskConfig(configWithDoc).weights.documentIntegrity,10);
  assert.equal(calculateRiskPolicy(assessment,configWithDoc,4),null);
  const supplemented={...assessment,signals:[
    ...assessment.signals,{factor:'documentIntegrity',severity:50,confidence:0.65,
      sourceAgent:'A03',evidenceIds:['GDOC-0123456789abcdef0123']}]};
  const projected=calculateRiskPolicy(supplemented,configWithDoc,4);
  assert.ok(projected);assert.equal(projected.factorSnapshot.factors.length,6);
  assert.equal(projected.factorSnapshot.factors.at(-1).key,'documentIntegrity');
  assert.equal(projected.factorSnapshot.factors.at(-1).weight,10);
  assert.equal(validateRiskConfig(baseline).weights.documentIntegrity,0);
  assert.equal(calculateRiskPolicy(assessment,baseline,1).factorSnapshot.factors.length,5);
});

test('legacy A03 zero POC preview is explicitly opt-in, risk-labeled and never source evidence',async()=>{
  const policy={...baseline,weights:{movement:23,inspection:25,
    certificate:18,dataQuality:13,history:11,documentIntegrity:10}};
  const synthetic={...assessment,sourceNature:'SYNTHETIC_NOT_RIYADH_MOU'};
  assert.equal(calculateRiskPolicy(synthetic,policy,4),null,
    'Default must fail closed without A03');
  const p=calculateRiskPolicy(synthetic,policy,4,{legacyA03ZeroPreview:true});
  assert.ok(p);
  assert.equal(p.provisional,true);
  assert.equal(p.operationalDecisionAllowed,false);
  assert.equal(p.provisionalReason,'A03_NOT_ASSESSED_ZERO_PLACEHOLDER');
  assert.equal(p.factorSnapshot.factors.length,6);
  const doc=p.factorSnapshot.factors.at(-1);
  assert.equal(doc.key,'documentIntegrity');
  assert.equal(doc.severity,0);
  assert.equal(doc.weight,10);
  assert.equal(doc.evidenceStatus,'NOT_ASSESSED');
  assert.equal(doc.confidence,0);
  assert.deepEqual(doc.evidenceIds,[]);
  assert.equal(p.operationalPriority,'Pending A03 Evidence');
  assert.equal(assessment.signals.length,5);
  assert.equal(assessment.score,60);
  const actualDoc={...synthetic,signals:[
    ...synthetic.signals,{factor:'documentIntegrity',severity:57,
      sourceAgent:'A03',confidence:0.7,evidenceIds:['GDOC-SYNTHETIC']} ]};
  assert.equal(calculateRiskPolicy(actualDoc,policy,4)?.provisional,false);
  assert.equal(calculateRiskPolicy({...synthetic,sourceNature:'VERIFIED_AUTHORITY'},
    policy,4,{legacyA03ZeroPreview:true}),null);
  const dir=mkdtempSync(join(tmpdir(),'nmc-policy-provisional-'));
  try{
    const file=join(dir,'risk.json');
    const fleet={results:{'9328471':synthetic}};
    const svc=new CentralRiskPolicy({mode:'json',file,fleet,legacyA03ZeroPreview:true});
    await svc.initialize();
    const resp=await svc.publish({expectedRevision:1,config:policy,
      publishedBy:'NMC POC Operator',reason:'Exercise provisional zero under six factors'});
    assert.equal(resp.projectionCount,1);
    const current=await svc.projectCurrent();
    assert.equal(current.assessed,0);
    assert.equal(current.provisionalAssessed,1);
    assert.equal(current.projections[0].provisional,true);
    assert.equal((await svc.projectionHistory('9328471'))[0].factorSnapshot.provisional,1);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
