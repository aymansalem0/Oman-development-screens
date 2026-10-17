/** Inspector photo -> SI-V01 (candidate finding only). No compliance or state writes. */
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {readGuidedImage} from './si-guided-evidence.mjs';
import {validateSiAiriaReply} from './si-airia-workflow-advisors.mjs';
import {SiPocAdvisorError} from './si-poc-workflow-advisors.mjs';

const fail=(code,status=409)=>{throw new SiPocAdvisorError(code,status);};
const uuid=/^[a-f0-9-]{36}$/i;
const mimeExtensions={'image/jpeg':'.jpg','image/png':'.png','image/webp':'.webp'};
const sha=b=>createHash('sha256').update(b).digest('hex');
const label=(x,max)=>typeof x==='string'?x.slice(0,max):'';
export function loadGuidedV01Image({caseId,step,evidence,evidenceRoot='/data/si-checklist-evidence'}={}){
 if(!uuid.test(caseId||'')||!step||!evidence||!uuid.test(evidence.id||'')||
    !Object.hasOwn(mimeExtensions,evidence.mimeType))
  fail('SI_V01_IMAGE_REFERENCE_INVALID');
 const published=(step.members||[]).some(m=>m.kind==='PUBLISHED'&&m.id===evidence.itemId);
 let bytes;
 if(published){
  try{bytes=readFileSync(join(evidenceRoot,caseId,evidence.id+mimeExtensions[evidence.mimeType]));}
  catch{fail('SI_V01_IMAGE_UNAVAILABLE');}
 }else{
  if(evidence.itemId||!/^SI-STEP-[a-f0-9]{20}$/.test(step.stepId||''))
   fail('SI_V01_IMAGE_NOT_LINKED_TO_STEP');
  let raw;try{raw=readGuidedImage(caseId,step.stepId,evidence.id);}
  catch{fail('SI_V01_IMAGE_UNAVAILABLE');}
  if(raw.mimeType!==evidence.mimeType)fail('SI_V01_IMAGE_INTEGRITY_FAILED');
  bytes=Buffer.from(raw.base64,'base64');
 }
 if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>2*1024*1024||
   sha(bytes)!==evidence.sha256)fail('SI_V01_IMAGE_INTEGRITY_FAILED');
 const magic=(evidence.mimeType==='image/jpeg'&&bytes.subarray(0,3).toString('hex')==='ffd8ff')||
   (evidence.mimeType==='image/png'&&bytes.subarray(0,8).toString('hex')==='89504e470d0a1a0a')||
   (evidence.mimeType==='image/webp'&&bytes.subarray(0,4).toString()==='RIFF'&&
    bytes.subarray(8,12).toString()==='WEBP');
 if(!magic)fail('SI_V01_IMAGE_INTEGRITY_FAILED');
 return {caseId,bytes,evidenceId:evidence.id,mimeType:evidence.mimeType,sha256:evidence.sha256,
   checklistItemId:published?evidence.itemId:step.stepId,
   checklistVersion:published?String(step.members.find(m=>m.kind==='PUBLISHED'&&m.id===evidence.itemId)?.revision||''):'',
   observation:label(step.note||'',500),baseCheckMandatory:step.mandatory===true};
}
export function buildGuidedV01Input({caseId,imo,step,media,caseVersion}){
 if(!uuid.test(caseId||'')||!/^[0-9]{7}$/.test(imo||'')||
   !step||media?.caseId!==caseId||!uuid.test(media.evidenceId||''))
  fail('SI_V01_FIELD_CONTEXT_INVALID',422);
 return {
  requestMeta:{correlationId:'SI-V01-'+randomUUID(),schemaVersion:'SI-V01-POC-1.0',
    requestedAt:new Date().toISOString(),source:'ASSIGNED_INSPECTOR_EXPLICIT_PHOTO_REVIEW'},
  inspectionCaseId:caseId,caseVersion:Number.isInteger(caseVersion)?caseVersion:0,imo,
  checklistItemId:media.checklistItemId,checklistVersion:media.checklistVersion||null,
  evidence:{evidenceId:media.evidenceId,mimeType:media.mimeType,sha256:media.sha256,
    scanStatus:'LOCAL_INSPECTOR_IMAGE_HASH_VERIFIED',captureTimeUtc:null},
  inspectorObservation:media.observation||'',
  context:{baseCheckMandatory:media.baseCheckMandatory,
    question:label(step.title,220),instructions:label(step.systemAction,1200)},
  requestedOutputs:['CANDIDATE_VISUAL_OBSERVATIONS','VISIBLE_FACTS','LIMITATIONS'],
  constraints:{officialFindingCreated:false,requiresInspectorConfirmation:true,
    noAutoComplianceDecision:true}
 };
}
export function validateGuidedV01Reply(raw,{caseId,media}){
 const ctx={state:{caseId},media,allowedEvidence:new Set([media.evidenceId])};
 const result=validateSiAiriaReply('SI-V01',raw,ctx);
 const advice=result.advice?.[0];
 if(!advice||advice.requiresHumanReview!==true||
    !advice.explanation?.trim()||!advice.evidenceRefs.includes(media.evidenceId))
  fail('SI_V01_AIRIA_CONTRACT_INVALID',502);
 return {status:'AI_PHOTO_ADVISORY_ONLY',provider:'AIRIA_SI_V01',
  reviewedEvidence:media.evidenceId,
  recommendations:[{rationale:'Unverified photo observation linked to inspector evidence',
    instruction:label(advice.explanation,1600),
    dataGaps:['Independent inspector verification required before any compliance finding'],
    confidence:null}],
  officialCompliance:false,inspectorReviewRequired:true,
  findingCreated:false,requiresSupervisorReview:true};
}
