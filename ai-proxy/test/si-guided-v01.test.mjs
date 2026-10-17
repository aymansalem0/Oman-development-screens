import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {loadGuidedV01Image,buildGuidedV01Input,validateGuidedV01Reply}
 from '../si-guided-v01.mjs';
const caseId='8e153162-3431-4b83-9e5d-4113f51c3030';
const imageId='8ea4a12d-9888-4d77-9fa4-a04c5a7e0007';
const hash=b=>createHash('sha256').update(b).digest('hex');
const bytes=Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),Buffer.alloc(24)]);
const step={stepId:'SI-STEP-1234567890abcdef1234',title:'Fire safety',
 systemAction:'Review extinguishers',mandatory:true,
 members:[{kind:'PUBLISHED',id:'check-23',revision:3}]};
const evidence={id:imageId,itemId:'check-23',mimeType:'image/png',sha256:hash(bytes)};
test('SI-V01 accepts only case-owned, hash-checked published photo and builds typed request',()=>{
 const dir=mkdtempSync(join(tmpdir(),'si-v01-'));
 try{
  mkdirSync(join(dir,caseId),{recursive:true});
  writeFileSync(join(dir,caseId,imageId+'.png'),bytes);
  const media=loadGuidedV01Image({caseId,step,evidence,evidenceRoot:dir});
  assert.equal(media.checklistItemId,'check-23');
  assert.equal(media.checklistVersion,'3');
  const request=buildGuidedV01Input({caseId,imo:'9400631',step,media,caseVersion:2});
  assert.equal(request.evidence.evidenceId,imageId);
  assert.equal(request.requestMeta.mode,'ADVISORY_ONLY');
  assert.equal(request.evidence.scanStatus,'CHECKLIST_VERIFIED_LOCAL_POC');
  assert.equal(request.context.baseCheckMandatory,true);
  assert.deepEqual(Object.keys(request).sort(),[
    'requestMeta','inspectionCaseId','caseVersion','imo','checklistItemId',
    'checklistVersion','evidence','inspectorObservation','context'].sort());
  assert.deepEqual(Object.keys(request.requestMeta).sort(),
    ['correlationId','actor','language','mode'].sort());
  for(const unsupported of ['constraints','outputGuidance','requestedOutputs',
      'base64','schemaVersion','image']){
    assert.equal(Object.hasOwn(request,unsupported),false);
  }
  assert.equal(request.inspectorObservation,'');
  assert.equal(request.evidence.evidenceId,imageId);
  assert.throws(()=>loadGuidedV01Image({caseId,step,
   evidence:{...evidence,sha256:'0'.repeat(64)},evidenceRoot:dir}),
   /SI_V01_IMAGE_INTEGRITY_FAILED/);
  assert.throws(()=>loadGuidedV01Image({caseId,step,
   evidence:{...evidence,itemId:'other-question'},evidenceRoot:dir}),
   /SI_V01_IMAGE_NOT_LINKED_TO_STEP/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('SI-V01 contractual reply is only human-reviewed advice, never a finding',()=>{
 const media={evidenceId:imageId,checklistItemId:'check-23'};
 const raw={result:JSON.stringify({
  officialFindingCreated:false,requiresInspectorConfirmation:true,
  inspectionCaseId:caseId,evidenceId:imageId,checklistItemId:'check-23',
  confidence:.78,suggestion:'REVIEW',
  candidateFinding:{reason:'Possible faded extinguisher label',
   visibleFacts:['Label difficult to read'],limitations:['Photo angle insufficient']}
 })};
 const result=validateGuidedV01Reply(raw,{caseId,media});
 assert.equal(result.provider,'AIRIA_SI_V01');
 assert.equal(result.officialCompliance,false);
 assert.equal(result.findingCreated,false);
 assert.equal(result.inspectorReviewRequired,true);
 assert.equal(result.recommendations.length,1);
 assert.throws(()=>validateGuidedV01Reply({result:JSON.stringify({
  ...JSON.parse(raw.result),officialFindingCreated:true
 })},{caseId,media}),/SI_V01_AIRIA_CONTRACT_INVALID/);
 assert.throws(()=>validateGuidedV01Reply({result:JSON.stringify({
  ...JSON.parse(raw.result),evidenceId:'invented-evidence'
 })},{caseId,media}),/SI_V01_AIRIA_CONTRACT_INVALID/);
});
