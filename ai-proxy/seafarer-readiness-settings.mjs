/**
 * Configurable SDB readiness catalogue and evidence review sandbox.
 * Non-bypass invariant: baseline legal/source checks remain mandatory.
 * Custom requirements can only ADD checks. AI document review is queued,
 * not automatically approved and never claimed to have run.
 */
import {randomUUID} from 'node:crypto';
import {SdbError,evaluateReadiness,SDB_POLICY,COP_TYPES,COP_LABELS} from './seafarer-workspace.mjs';
const error=(code,status=422)=>{throw new SdbError(code,status);};
const INPUTS=['INTEGRATION','PLATFORM_ENTRY','ATTACHMENT'];
const SERVICE_SCOPES=['BOTH','FIRST_ISSUE','RENEWAL'];
const sourceFor=key=>key.startsWith('COP-')?'ACADEMY':
 key.startsWith('SOURCE-')?key.slice(7):
 key==='MEDICAL'?'MARASI':
 key==='PASSPORT'||key==='PHOTO'?'MOI_ICP':
 key.startsWith('CLEARANCE-')?key.slice('CLEARANCE-'.length):
 key==='COC'||key==='ENDORSEMENT'?'REGISTRY':'MOEI';
const english={
 MEDICAL:'Medical fitness',PASSPORT:'Passport verification',PHOTO:'Personal photograph',
 'CLEARANCE-ACADEMY':'Academy no objection','CLEARANCE-COMPANY':'Employer no objection',
 COC:'Certificate of Competency',ENDORSEMENT:'Foreign certificate endorsement'
};
const arabic={
 MEDICAL:'شهادة اللياقة الطبية',PASSPORT:'التحقق من جواز السفر',PHOTO:'الصورة الشخصية',
 'CLEARANCE-ACADEMY':'عدم ممانعة الأكاديمية','CLEARANCE-COMPANY':'عدم ممانعة الشركة المشغلة',
 COC:'شهادة الكفاءة',ENDORSEMENT:'اعتماد الشهادة الأجنبية'
};
export function initialSdbSettings(policy=SDB_POLICY){
 const keys=['SOURCE-ACADEMY','SOURCE-MARASI','SOURCE-MOI_ICP',
  ...COP_TYPES.map(t=>'COP-'+t),'MEDICAL','PASSPORT','PHOTO',
  'CLEARANCE-ACADEMY','CLEARANCE-COMPANY','COC','ENDORSEMENT'];
 const requirements=keys.map((key,i)=>{
  const source=sourceFor(key);
  const label=key.startsWith('COP-')?COP_LABELS[key.slice(4)]:
    key.startsWith('SOURCE-')?source+' source freshness':english[key]||key;
  const labelAr=key.startsWith('COP-')?'شهادة '+key.slice(4):
    key.startsWith('SOURCE-')?'التحقق من مصدر '+source:arabic[key]||key;
  return {
   id:key,title:label,titleAr:labelAr,source,
   inputMode:source==='REGISTRY'?'PLATFORM_ENTRY':'INTEGRATION',
   scope:key==='CLEARANCE-COMPANY'?'RENEWAL':'BOTH',
   active:true,core:true,mandatory:true,reviewUncertain:true,
   order:i+1
  };
 });
 return {version:1,baselinePolicyVersion:policy.version,updatedAt:null,
  updatedBy:null,requirements};
}
export function validateSdbRequirement(row,existing=[]){
 if(!row||typeof row!=='object'||Array.isArray(row))error('SDB_SETTING_INVALID');
 const id=String(row.id||'').trim().toUpperCase();
 if(!/^[A-Z][A-Z0-9_-]{2,63}$/.test(id))error('SDB_SETTING_ID_INVALID');
 const title=String(row.title||'').trim(),titleAr=String(row.titleAr||'').trim();
 if(!title||title.length>140||titleAr.length>140)error('SDB_SETTING_TITLE_REQUIRED');
 const source=String(row.source||'').trim().toUpperCase();
 if(!/^[A-Z][A-Z0-9_]{1,39}$/.test(source))error('SDB_SETTING_SOURCE_INVALID');
 if(!INPUTS.includes(row.inputMode))error('SDB_SETTING_INPUT_MODE_INVALID');
 if(!SERVICE_SCOPES.includes(row.scope))error('SDB_SETTING_SCOPE_INVALID');
 const previous=existing.find(r=>r.id===id);
 if(previous?.core){
  // No admin change may deactivate or de-require a core regulatory check.
  if(row.active===false||row.mandatory===false||row.core===false)
   error('SDB_CORE_REQUIREMENT_IMMUTABLE',409);
 }
 if(row.core===true&&!previous?.core)error('SDB_CORE_REQUIREMENT_IMMUTABLE',409);
 return {id,title,titleAr,source,inputMode:row.inputMode,scope:row.scope,
  active:row.active!==false,mandatory:previous?.core?true:row.mandatory!==false,
  core:!!previous?.core,reviewUncertain:row.reviewUncertain!==false,
  order:Number.isInteger(row.order)&&row.order>=0&&row.order<=10000?
    row.order:existing.length+1};
}
export function computedSdbReadiness(profile,now=Date.now(),policy=SDB_POLICY,
 settings=initialSdbSettings(policy)){
 const base=evaluateReadiness(profile,now,policy);
 const own=profile.documents||[];
 const extra=[];
 for(const req of settings.requirements){
  if(!req.active||!req.mandatory||(
    req.scope!=='BOTH'&&req.scope!==base.service))continue;
  // A core requirement changed to ATTACHMENT adds a second, stricter
  // document-evidence gate; it NEVER replaces the authoritative source check.
  if(req.core&&(req.inputMode!=='ATTACHMENT'||
     !base.checks.some(c=>c.key===req.id)))continue;
  let result='PENDING',reason='Verification from the configured provider is pending';
  let reference=null;
  if(req.inputMode==='ATTACHMENT'){
   const recent=own.filter(d=>d.requirementId===req.id)
    .sort((a,b)=>b.submittedAt.localeCompare(a.submittedAt))[0];
   if(!recent){result='FAIL';reason='Supporting document is missing';}
   else {
    reference=recent.reference;
    if(recent.reviewStatus==='HUMAN_VERIFIED'){
      result='PASS';reason='Sandbox reviewer confirmed document evidence';
    }else if(recent.reviewStatus==='REJECTED'){
      result='FAIL';reason='Document rejected; new evidence required';
    }else{
      result='PENDING';reason='Document awaiting AI triage / human review; no AI decision yet';
    }
   }
  }else if(req.inputMode==='PLATFORM_ENTRY'){
   result='PENDING';reason='Verified platform-entry evidence is required';
  }
  extra.push({key:'REQ-'+req.id,label:req.title,source:req.source,
   result,reason,reference,expiryDate:null,inputMode:req.inputMode,
   configurable:true,policyRequirementId:req.id});
 }
 const checks=[...base.checks,...extra],blockers=checks.filter(c=>c.result!=='PASS');
 return {...base,checks,blockers,passed:checks.length-blockers.length,total:checks.length,
  percent:Math.round((checks.length-blockers.length)/checks.length*100),
  status:checks.some(c=>c.result==='HOLD')?'ON_HOLD':
   blockers.some(c=>c.result==='PENDING')?'PENDING_VERIFICATION':
   blockers.length?'INCOMPLETE':'READY',
  policyVersion:policy.version+'+CONFIG-'+settings.version,
  configurationVersion:settings.version,
  engine:{type:'CONFIG_DRIVEN_AGENTIC_AI_READINESS_POC',
   mode:'EXPLAINABLE_RULE_ENGINE',aiModelInvoked:false,
   agenticFlow:['IDENTIFY_SDB','DISCOVER_REQUIREMENTS','CHECK_PROVIDER_EVIDENCE',
    'CALCULATE_READINESS','ROUTE_UNCERTAIN_DOCUMENTS','HUMAN_CONTROL'],
   humanControlsRequired:true}
 };
}
export function stageSdbDocument(profile,requirement,metadata,now=Date.now()){
 if(requirement.inputMode!=='ATTACHMENT'||!requirement.active)
  error('SDB_REQUIREMENT_NOT_ATTACHMENT',409);
 if(requirement.scope!=='BOTH'&&requirement.scope!==(
   profile.existingSdb?'RENEWAL':'FIRST_ISSUE'))
  error('SDB_REQUIREMENT_SERVICE_MISMATCH',409);
 if(!metadata||typeof metadata!=='object'||Array.isArray(metadata))
  error('SDB_DOCUMENT_INVALID');
 const filename=String(metadata.filename||'').trim();
 const mimeType=String(metadata.mimeType||'').trim();
 const sha256=String(metadata.sha256||'').trim().toLowerCase();
 if(!/^[^\\/\x00-\x1f]{1,130}$/.test(filename)||
   !['application/pdf','image/png','image/jpeg'].includes(mimeType)||
   !/^[0-9a-f]{64}$/.test(sha256)||
   !Number.isInteger(metadata.size)||metadata.size<1||
   metadata.size>10*1024*1024)error('SDB_DOCUMENT_METADATA_INVALID');
 // The sandbox stores only metadata; no attachment bytes are persisted.
 // Never assert a document has been inspected from metadata alone.
 return {id:randomUUID(),profileId:profile.id,requirementId:requirement.id,
  filename,mimeType,size:metadata.size,sha256,
  reference:'POC-DOC-'+randomUUID().slice(0,8),submittedAt:new Date(now).toISOString(),
  reviewStatus:'AI_TRIAGE_QUEUED',aiModelInvoked:false,
  aiDecision:null,confidence:null,humanDecision:null,reviewedBy:null,reviewedAt:null,
  note:'Document metadata only: no binary stored, no model invoked; human review required'};
}
export function decideSdbDocument(actor,document,decision,reason,now=Date.now()){
 if(!['HUMAN_VERIFIED','REJECTED'].includes(decision))
  error('SDB_DOCUMENT_REVIEW_DECISION_INVALID');
 if(!document||!['AI_TRIAGE_QUEUED','PENDING_HUMAN_REVIEW'].includes(document.reviewStatus))
  error('SDB_DOCUMENT_REVIEW_CLOSED',409);
 const note=String(reason||'').trim();
 if(!note||note.length>500)error('SDB_DOCUMENT_REVIEW_REASON_REQUIRED');
 return {...document,reviewStatus:decision,humanDecision:decision,
  reviewedBy:actor,reviewedAt:new Date(now).toISOString(),note};
}
