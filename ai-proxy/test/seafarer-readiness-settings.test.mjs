import test from 'node:test';
import assert from 'node:assert/strict';
import {SeafarerWorkspace,SdbError,evaluateReadiness}
 from '../seafarer-workspace.mjs';
import {initialSdbSettings,validateSdbRequirement,computedSdbReadiness,
 stageSdbDocument} from '../seafarer-readiness-settings.mjs';
import {sdbServiceScenarios} from '../seafarer-sdb-service-scenarios.mjs';

const admin={operations:true,key:'SDB_ADMIN'};
const self={operations:false,key:'SELF',seafarerId:'SF-002',companyId:null};
const other={operations:false,key:'OTHER',seafarerId:'SF-003',companyId:null};
const requirement={
 id:'EXTRA_SEAFARER_EVIDENCE',title:'Additional sea-service evidence',
 titleAr:'مستند خدمة بحرية إضافي',source:'ACADEMY',
 inputMode:'ATTACHMENT',scope:'BOTH',core:false,active:true,
 mandatory:true,reviewUncertain:true,order:30
};
const validMetadata={
 filename:'academy-evidence.pdf',mimeType:'application/pdf',size:1024,
 sha256:'a'.repeat(64)
};
function store(){return new SeafarerWorkspace({file:null});}
test('settings start from versioned mandatory baseline; no core requirement can be disabled',()=>{
 const cfg=initialSdbSettings();
 assert.ok(cfg.requirements.some(r=>r.id==='MEDICAL'&&r.core));
 assert.ok(cfg.requirements.some(r=>r.id==='CLEARANCE-ACADEMY'&&r.core));
 assert.equal(cfg.requirements.filter(r=>r.core).length,cfg.requirements.length);
 const p=cfg.requirements.find(r=>r.id==='MEDICAL');
 assert.throws(()=>validateSdbRequirement({...p,active:false},cfg.requirements),
  e=>e.code==='SDB_CORE_REQUIREMENT_IMMUTABLE');
 assert.throws(()=>validateSdbRequirement({...p,mandatory:false},cfg.requirements),
  e=>e.code==='SDB_CORE_REQUIREMENT_IMMUTABLE');
});

test('custom document requirement immediately changes live readiness without bypassing original medical and academy checks',()=>{
 const s=store();
 assert.equal(s.get(self,'SF-002').readiness.status,'READY');
 const cfg=s.saveRequirement(admin,requirement);
 assert.equal(cfg.version,2);
 assert.equal(cfg.requirements.at(-1).inputMode,'ATTACHMENT');
 const p=s.get(self,'SF-002');
 assert.notEqual(p.readiness.status,'READY');
 assert.equal(p.readiness.blockers.find(c=>c.key==='REQ-EXTRA_SEAFARER_EVIDENCE').result,'FAIL');
 assert.equal(p.readiness.policyVersion.endsWith('CONFIG-2'),true);
 assert.throws(()=>s.requireReady(s.profile('SF-002')),
  e=>e.code==='SDB_READINESS_CHANGED');
 assert.ok(p.readiness.engine.agenticFlow.includes('ROUTE_UNCERTAIN_DOCUMENTS'));
 assert.equal(p.readiness.engine.aiModelInvoked,false);
});

test('uncertain PDF metadata is queued, cannot auto-authorize, and only human review may release a new requirement',()=>{
 const s=store();s.saveRequirement(admin,requirement);
 assert.throws(()=>s.submitEvidence(other,'SF-002',requirement.id,validMetadata),
  e=>e.code==='SDB_APPLICANT_BINDING_REQUIRED');
 const submitted=s.submitEvidence(self,'SF-002',requirement.id,validMetadata);
 assert.equal(submitted.document.reviewStatus,'AI_TRIAGE_QUEUED');
 assert.equal(submitted.document.aiModelInvoked,false);
 assert.equal(submitted.document.aiDecision,null);
 assert.equal(submitted.document.confidence,null);
 assert.equal(submitted.readiness.status,'PENDING_VERIFICATION');
 const queue=s.documentReviewQueue(admin);
 assert.equal(queue.queued.length,1);
 assert.equal(queue.aiProvider,'NOT_CONNECTED');
 assert.throws(()=>s.reviewEvidence(self,submitted.document.id,
  'HUMAN_VERIFIED','approved by self'),
  e=>e.code==='SDB_OPERATIONS_REQUIRED');
 const resolved=s.reviewEvidence(admin,submitted.document.id,
  'HUMAN_VERIFIED','Reviewed attached evidence outside the automated sandbox');
 assert.equal(resolved.document.reviewStatus,'HUMAN_VERIFIED');
 assert.equal(resolved.document.reviewedBy,'SDB_ADMIN');
 assert.equal(resolved.readiness.status,'READY');
 assert.equal(s.documentReviewQueue(admin).queued.length,0);
 assert.ok(s.state.audit.some(x=>x.event==='DOCUMENT_HUMAN_HUMAN_VERIFIED'));
 assert.throws(()=>s.reviewEvidence(admin,submitted.document.id,
  'REJECTED','second review'),e=>e.code==='SDB_DOCUMENT_REVIEW_CLOSED');
});

test('unrecognised and malformed evidence remains fail-closed without persistence',()=>{
 const s=store();s.saveRequirement(admin,requirement);
 const previous=JSON.stringify(s.state);
 assert.throws(()=>s.submitEvidence(self,'SF-002',requirement.id,
  {...validMetadata,sha256:'bad'}),e=>e.code==='SDB_DOCUMENT_METADATA_INVALID');
 assert.equal(JSON.stringify(s.state),previous);
 const submitted=s.submitEvidence(self,'SF-002',requirement.id,validMetadata);
 const rej=s.reviewEvidence(admin,submitted.document.id,
  'REJECTED','Document cannot be confirmed');
 assert.equal(rej.readiness.status,'INCOMPLETE');
 assert.equal(rej.readiness.blockers.find(x=>x.key==='REQ-EXTRA_SEAFARER_EVIDENCE').result,'FAIL');
});

test('core medical or academy HOLD cannot be upgraded by custom evidence, labels or configuration',()=>{
 const s=store();
 const p=s.profile('SF-002');
 p.medical=null;
 p.clearances.ACADEMY.status='HOLD';
 const medicalCheck=evaluateReadiness(p,s.clock(),s.policy);
 assert.notEqual(medicalCheck.status,'READY');
 s.saveRequirement(admin,requirement);
 const uploaded=s.submitEvidence(self,'SF-002',requirement.id,validMetadata);
 s.reviewEvidence(admin,uploaded.document.id,
  'HUMAN_VERIFIED','Custom evidence verified by human');
 const r=s.get(self,'SF-002').readiness;
 assert.equal(r.status,'ON_HOLD');
 assert.equal(r.checks.find(c=>c.key==='MEDICAL').result,'FAIL');
 assert.equal(r.checks.find(c=>c.key==='CLEARANCE-ACADEMY').result,'HOLD');
 assert.throws(()=>s.saveRequirement(admin,{
  ...s.readinessConfiguration(admin).requirements.find(x=>x.id==='MEDICAL'),
  source:'UNVERIFIED_SITE'
 }),e=>e.code==='SDB_CORE_SOURCE_IMMUTABLE');
});

test('eight demo scenarios are recalculated from updated configuration version',()=>{
 const s=store(),config=s.saveRequirement(admin,requirement);
 const rows=sdbServiceScenarios(s.clock(),s.policy,config);
 assert.equal(rows.length,8);
 assert.ok(rows.every(x=>x.readiness.configurationVersion===2));
 assert.ok(rows.every(x=>x.readiness.blockers.some(
  b=>b.key==='REQ-EXTRA_SEAFARER_EVIDENCE')));
 assert.ok(rows.every(x=>x.advisor.modelInvoked===false));
});

test('changing a core source method to attachment creates an additional guarded review check, never replaces MARASI verification',()=>{
 const s=store();const baseline=s.get(self,'SF-002').readiness;
 assert.equal(baseline.status,'READY');
 const settings=s.readinessConfiguration(admin);
 const medical=settings.requirements.find(r=>r.id==='MEDICAL');
 const updated=s.saveRequirement(admin,{...medical,inputMode:'ATTACHMENT'});
 assert.equal(updated.version,2);
 let r=s.get(self,'SF-002').readiness;
 assert.equal(r.checks.find(c=>c.key==='MEDICAL').result,'PASS');
 assert.equal(r.checks.find(c=>c.key==='REQ-MEDICAL').result,'FAIL');
 assert.equal(r.status,'INCOMPLETE');
 const staged=s.submitEvidence(self,'SF-002','MEDICAL',validMetadata);
 assert.equal(staged.readiness.status,'PENDING_VERIFICATION');
 const verified=s.reviewEvidence(admin,staged.document.id,'HUMAN_VERIFIED',
  'Clinician source remains separately authoritative');
 assert.equal(verified.readiness.status,'READY');
 s.profile('SF-002').medical=null;
 r=s.get(self,'SF-002').readiness;
 assert.notEqual(r.status,'READY');
 assert.equal(r.checks.find(c=>c.key==='MEDICAL').result,'FAIL');
 assert.equal(r.checks.find(c=>c.key==='REQ-MEDICAL').result,'PASS');
});
