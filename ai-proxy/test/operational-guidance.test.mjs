import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const dir=mkdtempSync(join(tmpdir(),'nmc-guidance-'));
process.env.NMC_GUIDANCE_STORE_PATH=join(dir,'guidance.json');
const {OperationalGuidance,GuidanceError}=await import('../operational-guidance.mjs');

const example={
  imo:'9328471',status:'COMPLETED',score:60,level:'Watch',
  assessmentId:'d48953e9-344c-4c2b-83a2-bf305b624c63',
  assessedAt:'2026-10-09T00:01:55.994Z',operationalPriority:'Priority Review',
  criticalOpenFinding:true,signals:[
    ['movement',22,'A01','AIS-636019872'],
    ['inspection',82,'A02','DEF-2026-401'],
    ['certificate',65,'A02','CERT-SC-9328471'],
    ['dataQuality',55,'A02','DQC-9328471'],
    ['history',82,'A01','HIST-9328471']
  ].map(([factor,severity,sourceAgent,evidenceId])=>({
    factor,severity,sourceAgent,confidence:0.7,evidenceIds:[evidenceId],
    reason:'Synthetic POC fixture evidence'
  }))
};
const withFleet=entry=>new OperationalGuidance({mode:'json',fleet:{getVesselResult:()=>entry}});
test('published platform guidance uses saved AI facts and NEVER calls Airia or creates case tasks',async()=>{
  const service=withFleet(example);await service.initialize();
  const result=await service.evaluate('9328471');
  assert.equal(result.riskScore,60);
  assert.equal(result.rules.length,2);
  assert.deepEqual(result.rules.map(x=>x.ruleId),['NMC-GUIDE-001','NMC-GUIDE-002']);
  assert.deepEqual(result.rules[0].evidenceIds,['DEF-2026-401']);
  assert.equal(result.rules[0].source,'PLATFORM_BUSINESS_RULE');
  assert.equal(result.rules[0].status,'ADVISORY_ONLY');
  assert.ok(result.rules.every(x=>x.assessmentId===example.assessmentId));
  const saved=await service.materialize('9328471');
  assert.equal(saved.rules.length,2);
  await service.materialize('9328471');
  assert.equal(service.jsonState.results.length,2); // idempotency
});
test('rule editing is draft-only; publishing is revisioned with audit',async()=>{
  const service=withFleet(example);await service.initialize();
  const state=(await service.list())[0];
  const draft={...state.published,condition:{field:'inspectionSeverity',operator:'GTE',value:90}};
  const next=await service.change(state.id,state.revision,'EDIT',draft);
  assert.equal(next.publishedRevision,1);
  assert.equal((await service.evaluate('9328471')).rules.length,2);
  await assert.rejects(service.change(state.id,state.revision,'EDIT',draft),
    error=>error instanceof GuidanceError&&error.code==='GUIDANCE_VERSION_CONFLICT');
  const published=await service.change(state.id,next.revision,'PUBLISH');
  assert.equal(published.publishedRevision,3);
  assert.equal((await service.evaluate('9328471')).rules.length,1);
  const audit=await service.history(state.id);
  assert.deepEqual(audit.slice(0,2).map(x=>x.action),['PUBLISH','EDIT']);
});
test('new user-defined rules remain inert as drafts and require explicit publication',async()=>{
  const service=withFleet(example);await service.initialize();
  const custom={id:'NMC-GUIDE-105',title:'Review saved risk over 55',
    titleAr:'مراجعة المخاطر المحفوظة فوق 55',enabled:true,priority:'WATCH',
    ownerRole:'NMC_DUTY_OFFICER',condition:{field:'riskScore',operator:'GTE',value:55}};
  const draft=await service.create(custom);
  assert.equal(draft.status,'DRAFT');assert.equal(draft.published,null);
  assert.equal(draft.publishedRevision,0);
  assert.equal((await service.evaluate('9328471')).rules.some(r=>r.ruleId===custom.id),false);
  await assert.rejects(service.create(custom),e=>e.code==='GUIDANCE_RULE_EXISTS');
  const published=await service.change(custom.id,draft.revision,'PUBLISH');
  assert.equal(published.status,'ACTIVE');
  const output=await service.evaluate('9328471');
  assert.equal(output.rules.find(r=>r.ruleId===custom.id)?.evidenceIds.length>0,true);
  assert.ok((await service.history(custom.id)).some(x=>x.action==='CREATE'));
});
test('unknown or incomplete AI evidence yields no fabricated guidance',async()=>{
  const service=withFleet({...example,signals:example.signals.slice(0,4)});await service.initialize();
  await assert.rejects(service.evaluate('9328471'),e=>e.code==='GUIDANCE_ASSESSMENT_NOT_FOUND');
  const unassessed=withFleet({imo:'9328471',status:'FAILED'});
  await unassessed.initialize();
  await assert.rejects(unassessed.evaluate('9328471'),e=>e.code==='GUIDANCE_ASSESSMENT_NOT_FOUND');
});
test.after(()=>rmSync(dir,{recursive:true,force:true}));
