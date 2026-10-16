/**
 * Real SI dynamic checklist execution. Immutable template revisions are copied
 * into each case's field-checklist snapshot. An AI guess is NEVER an inspector
 * decision: request -> review -> ACCEPT/EDIT/REJECT with audit trail.
 *
 * POC JSON persistence, protected /data volume. Production requires a DB
 * transactional store + object storage + AV/DLP for uploaded evidence.
 */
import {randomUUID,createHash} from 'node:crypto';
import {readFileSync,writeFileSync,existsSync,mkdirSync,renameSync,unlinkSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {SiChecklistError} from './si-checklist-library.mjs';

const copy=x=>structuredClone(x);
const now=()=>new Date().toISOString();
const id=()=>randomUUID();
const failure=(code,status=422)=>{throw new SiChecklistError(code,status);};
const safe=(v,max=2000)=>typeof v==='string'&&v.trim().length<=max?v.trim():null;
const caseId=v=>typeof v==='string'&&/^[a-f0-9-]{36}$/i.test(v);
const sha=v=>createHash('sha256').update(v).digest('hex');
const MAX_IMAGE=2*1024*1024;
const IMAGE_TYPES={'image/jpeg':'.jpg','image/png':'.png','image/webp':'.webp'};
const EVIDENCE_TYPES={...IMAGE_TYPES,'application/pdf':'.pdf'};
const VALID_UUID=/^[a-f0-9-]{36}$/i;
function evidenceLocation(root,caseKey,reference){
 if(!VALID_UUID.test(caseKey)||!VALID_UUID.test(reference.id)||
   !Object.hasOwn(EVIDENCE_TYPES,reference.mimeType))
  failure('SI_CHECKLIST_EVIDENCE_REFERENCE_INVALID',422);
 return join(root,caseKey,reference.id+EVIDENCE_TYPES[reference.mimeType]);
}
export function parseQuestionAttachment(upload){
 if(!upload||typeof upload!=='object'||Array.isArray(upload)||
   !Object.hasOwn(EVIDENCE_TYPES,upload.mimeType))
  failure('SI_CHECKLIST_EVIDENCE_FORMAT_INVALID');
 const filename=String(upload.filename||'').trim();
 if(!filename||filename.length>135||
   filename.includes('/')||filename.includes('\\')||
   [...filename].some(ch=>ch.charCodeAt(0)<32))
  failure('SI_CHECKLIST_EVIDENCE_FILENAME_INVALID');
 if(upload.mimeType!=='application/pdf'){
  const parsed=parseImage(upload);
  return {...parsed,filename};
 }
 if(typeof upload.base64!=='string'||
   upload.base64.length>Math.ceil(MAX_IMAGE*4/3)+8||
   !/^[A-Za-z0-9+/]+={0,2}$/.test(upload.base64))
  failure('SI_CHECKLIST_EVIDENCE_FORMAT_INVALID');
 const bytes=Buffer.from(upload.base64,'base64');
 if(!bytes.length||bytes.length>MAX_IMAGE)
  failure('SI_CHECKLIST_EVIDENCE_TOO_LARGE',413);
 if(bytes.subarray(0,5).toString('utf8')!=='%PDF-')
  failure('SI_CHECKLIST_EVIDENCE_FORMAT_INVALID');
 return {bytes,type:'application/pdf',extension:'.pdf',
  hash:sha(bytes),filename};
}
function findAdvisoryQuestion(entry,itemId){
 return (entry.aiSuggestedQuestions||[]).find(q=>q.id===itemId)||null;
}

const VALID_LEVELS=['TEMPLATE','GROUP','ITEM'];
const answerKeys=['BOOLEAN','NOTE','EXPIRY_DATE','DATE','NUMBER','TEXT'];
const stamp=(file,data)=>{
 mkdirSync(dirname(file),{recursive:true});
 const tmp=file+'.'+id()+'.tmp';
 writeFileSync(tmp,JSON.stringify(data,null,2),{mode:0o600});
 renameSync(tmp,file);
};
function resolveItem(entry,itemId){
 for(const template of entry.templates)
  for(const group of template.groups)
   for(const item of group.items)
    if(item.instanceId===itemId)return {template,group,item};
 return null;
}
export function validateAnswers(item,values){
 if(!values||typeof values!=='object'||Array.isArray(values))
  failure('SI_CHECKLIST_ANSWER_INVALID');
 const allowed={};
 for(const type of item.fields){
  const val=values[type];
  if(val===undefined||val===null||val===''){continue;}
  switch(type){
   case 'BOOLEAN':
    if(!['YES','NO','NA'].includes(val))failure('SI_CHECKLIST_BOOLEAN_INVALID');
    allowed[type]=val;break;
   case 'NOTE':case 'TEXT':
    if(typeof val!=='string'||val.length>2500)failure('SI_CHECKLIST_TEXT_INVALID');
    allowed[type]=val.trim();break;
   case 'EXPIRY_DATE':case 'DATE':
    if(typeof val!=='string'||!/^\d{4}-\d\d-\d\d$/.test(val)||
     Number.isNaN(Date.parse(val+'T00:00:00Z')))
     failure('SI_CHECKLIST_DATE_INVALID');
    allowed[type]=val;break;
   case 'NUMBER':
    if(typeof val!=='number'||!Number.isFinite(val)||
     Math.abs(val)>1e12)failure('SI_CHECKLIST_NUMBER_INVALID');
    allowed[type]=val;break;
   default:failure('SI_CHECKLIST_TYPE_UNKNOWN');
  }
 }
 if(Object.keys(values).some(k=>!answerKeys.includes(k)||!item.fields.includes(k)))
  failure('SI_CHECKLIST_UNEXPECTED_ANSWER_FIELD');
 return allowed;
}
export function validateAIResult(raw,entry,scope){
 let data=raw;
 for(let i=0;i<6;i++){
  if(typeof data==='string'){try{data=JSON.parse(data);}catch{break;}continue;}
  if(!data||typeof data!=='object')break;
  if(Array.isArray(data.recommendations))break;
  const wrap=['result','response','output','data','finalOutput','outputText','content','value']
   .find(k=>data[k]!==undefined);
  if(!wrap)break;data=data[wrap];
 }
 if(!data||!Array.isArray(data.recommendations)||data.recommendations.length>35)
  failure('SI_CHECKLIST_AI_RESPONSE_INVALID',502);
 const seen=new Set();
 const recommendations=data.recommendations.map(r=>{
  if(!r||typeof r.itemId!=='string'||seen.has(r.itemId))
   failure('SI_CHECKLIST_AI_ITEM_INVALID',502);
  seen.add(r.itemId);
  const found=resolveItem(entry,r.itemId);
  if(!found)failure('SI_CHECKLIST_AI_ITEM_NOT_IN_CASE',502);
  if(scope.level==='ITEM'&&found.item.instanceId!==scope.itemId||
     scope.level==='GROUP'&&found.group.instanceId!==scope.groupId||
     scope.level==='TEMPLATE'&&found.template.templateId!==scope.templateId)
   failure('SI_CHECKLIST_AI_SCOPE_MISMATCH',502);
  if(typeof r.rationale!=='string'||r.rationale.trim().length<10||
     r.rationale.length>1800||!Number.isFinite(r.confidence)||
     r.confidence<0||r.confidence>1)
   failure('SI_CHECKLIST_AI_REASON_INVALID',502);
  const instruction=(typeof r.suggestedInstruction==='string'?r.suggestedInstruction:
    typeof r.inspectionInstruction==='string'?r.inspectionInstruction:'').trim();
  return {itemId:r.itemId,proposedAnswers:validateAnswers(found.item,
   r.answers||r.proposedAnswers||{}),
   rationale:r.rationale.trim(),confidence:r.confidence,
   suggestedInstruction:instruction.length>=8&&instruction.length<=1600?
    instruction:null,
   dataGaps:Array.isArray(r.dataGaps)?r.dataGaps.filter(x=>typeof x==='string')
    .slice(0,12).map(x=>x.slice(0,170)):[]};
 });
 return {recommendations,status:'DRAFT_INSPECTOR_REVIEW_REQUIRED',modelAnswerVerified:false};
}
export function parseImage(image){
 if(!image)return null;
 if(typeof image!=='object'||!Object.hasOwn(IMAGE_TYPES,image.mimeType)||
   typeof image.base64!=='string'||image.base64.length>Math.ceil(MAX_IMAGE*4/3)+8||
   !/^[a-zA-Z0-9+/]+={0,2}$/.test(image.base64))
  failure('SI_CHECKLIST_IMAGE_FORMAT_INVALID');
 const bytes=Buffer.from(image.base64,'base64');
 if(!bytes.length||bytes.length>MAX_IMAGE)failure('SI_CHECKLIST_IMAGE_TOO_LARGE',413);
 const type=image.mimeType;
 if(type==='image/jpeg'&&(bytes[0]!==0xff||bytes[1]!==0xd8)||
   type==='image/png'&&bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||
   type==='image/webp'&&
    (bytes.subarray(0,4).toString()!=='RIFF'||bytes.subarray(8,12).toString()!=='WEBP'))
  failure('SI_CHECKLIST_IMAGE_FORMAT_INVALID');
 return {bytes,type,extension:IMAGE_TYPES[type],hash:sha(bytes)};
}
export class SiChecklistField{
 constructor({library,targeting,
   file=process.env.SI_CHECKLIST_CASES_PATH||'/data/si-checklist-case-answers.json',
   imageDirectory=process.env.SI_CHECKLIST_EVIDENCE_PATH||'/data/si-checklist-evidence',
   airiaSuggest=null,airiaQuestionSuggest=null,getA04Suggestions=null,
   getSetting=()=>10}={}){
  if(!library||!targeting)throw Error('SI_CHECKLIST_FIELD_CONFIGURATION_INVALID');
  this.library=library;this.targeting=targeting;this.file=file;
  this.imageDirectory=imageDirectory;this.airiaSuggest=airiaSuggest;
  this.airiaQuestionSuggest=airiaQuestionSuggest;
  this.getA04Suggestions=getA04Suggestions;
  this.getSetting=getSetting;
  this.active=new Set();
 }
 read(){
  if(!existsSync(this.file))return {version:1,cases:{}};
  try{
   const d=JSON.parse(readFileSync(this.file,'utf8'));
   if(d.version!==1||typeof d.cases!=='object')throw Error('invalid');
   return d;
  }catch{failure('SI_CHECKLIST_CASE_STORE_CORRUPT',503);}
 }
 save(state){stamp(this.file,state);}
 async context(idValue){
  if(!caseId(idValue))failure('SI_APPROVED_CASE_ID_INVALID');
  const c=await this.targeting.inspectionCase(idValue);
  if(!c||c.status!=='CREATED')failure('SI_APPROVED_CASE_REQUIRED',404);
  const b=this.targeting.bundles.find(x=>x.imo===c.imo);
  const vessel={...b?.inlineContext?.vessel,imo:c.imo};
  const resolved=await this.library.resolve({vessel,inspectionCase:c});
  return {caseId:idValue,inspectionCase:c,resolved};
 }
 async preview(idValue){
  const ctx=await this.context(idValue);
  const saved=(await this.read(idValue)).cases[idValue]||null;
  return {status:'ok',caseId:idValue,imo:ctx.inspectionCase.imo,
   vessel:ctx.resolved.vessel,inspectionReasons:ctx.inspectionCase.inspectionReasons||[],
   selectedTemplates:ctx.resolved.templates.map(t=>({
    templateId:t.templateId,revision:t.revision,title:t.title,
    groupCount:t.groups.length,itemCount:t.groups.reduce((n,g)=>n+g.items.length,0),
    mandatory:t.mandatory})),warnings:ctx.resolved.warnings,
   saved:saved?copy(saved):null,
   immutableLegacyBaseline:true,requiresInspectorReview:true};
 }
 async start(idValue,actor){
  if(!safe(actor,120))failure('SI_CHECKLIST_ACTOR_REQUIRED');
  const ctx=await this.context(idValue);
  const state=await this.read(idValue);
  if(state.cases[idValue])return copy(state.cases[idValue]);
  const templates=ctx.resolved.templates.map(t=>({
   templateId:t.templateId,revision:t.revision,title:t.title,
   mandatory:t.mandatory,contentHash:t.contentHash,
   ai:t.ai,
   groups:t.groups.map(g=>({...g,instanceId:t.templateId+':'+g.id,
    items:g.items.map(item=>({...item,
     instanceId:t.templateId+':'+g.id+':'+item.id,
     answers:{},answerStatus:'PENDING',answerUpdatedAt:null,
     answeredBy:null,evidenceRefs:[],reviewHistory:[]}))}))
  }));
  const entry={caseId:idValue,imo:ctx.inspectionCase.imo,
   version:1,status:'IN_PROGRESS',createdAt:now(),createdBy:actor,
   updatedAt:now(),updatedBy:actor,
   vessel:ctx.resolved.vessel,inspectionReasons:ctx.inspectionCase.inspectionReasons||[],
   applicabilityWarnings:ctx.resolved.warnings,
   templates,proposals:[],evidenceFiles:[],aiSuggestedQuestions:[],
   aiQuestionRuns:0,audit:[{at:now(),action:'INITIALIZED',actor,
    templateRevisions:templates.map(t=>[t.templateId,t.revision])}]};
  state.cases[idValue]=entry;await this.save(state);return copy(entry);
 }
 async saveAnswers(idValue,{expectedVersion,answers,actor}){
  if(!safe(actor,120)||!Array.isArray(answers)||answers.length>100||
   !Number.isInteger(expectedVersion))failure('SI_CHECKLIST_ANSWERS_INVALID');
  await this.context(idValue);
  const state=await this.read(idValue),entry=state.cases[idValue];
  if(!entry)failure('SI_CHECKLIST_NOT_INITIALIZED',409);
  if(entry.version!==expectedVersion)failure('SI_CHECKLIST_VERSION_CONFLICT',409);
  if(entry.status!=='IN_PROGRESS')failure('SI_CHECKLIST_ALREADY_SUBMITTED',409);
  const seen=new Set();
  for(const a of answers){
   if(!a?.itemId||seen.has(a.itemId))failure('SI_CHECKLIST_DUPLICATE_ITEM');
   seen.add(a.itemId);
   const found=resolveItem(entry,a.itemId);
   if(!found)failure('SI_CHECKLIST_ITEM_NOT_FOUND',404);
   found.item.answers=validateAnswers(found.item,a.values||{});
   found.item.answerStatus=Object.keys(found.item.answers).length?
     'RECORDED':'PENDING';
   found.item.answeredBy=actor;found.item.answerUpdatedAt=now();
  }
  entry.version++;entry.updatedAt=now();entry.updatedBy=actor;
  entry.audit.push({at:now(),actor,action:'INSPECTOR_SAVED_ANSWERS',
    itemIds:[...seen]});
  await this.save(state);return copy(entry);
 }
 async suggest(idValue,{level='ITEM',templateId,groupId,itemId,
   text,image,evidenceId,actor,confirmCost}={}){
  if(!safe(actor,120)||confirmCost!==true||
   !VALID_LEVELS.includes(level)||(!safe(text||'',2500)&&!image&&!evidenceId))
   failure('SI_CHECKLIST_AI_CONFIRMATION_REQUIRED');
  if(!this.airiaSuggest)failure('SI_CHECKLIST_AIRIA_NOT_CONFIGURED',503);
  await this.context(idValue);
  if(this.active.has(idValue))failure('SI_CHECKLIST_AI_BUSY',409);
  const entry=(await this.read(idValue)).cases[idValue];
  if(!entry)failure('SI_CHECKLIST_NOT_INITIALIZED',409);
  if(entry.status!=='IN_PROGRESS')failure('SI_CHECKLIST_ALREADY_SUBMITTED',409);
  const maxCalls=Number(this.getSetting('SI_CHECKLIST_AI_MAX_CALLS_PER_CASE'))||10;
  if(entry.proposals.length>=maxCalls)
   failure('SI_CHECKLIST_AI_CASE_CALL_LIMIT_EXCEEDED',429);
  let scope;
  if(level==='ITEM'){
   const found=resolveItem(entry,itemId);
   if(!found||found.item.ai?.enabled===false)
    failure('SI_CHECKLIST_ITEM_AI_NOT_ENABLED',409);
   scope={level,itemId,groupId:found.group.instanceId,
    templateId:found.template.templateId,
    instructions:[found.template.ai.instructions,found.group.ai.instructions,
      found.item.ai.instructions].filter(Boolean)};
  }else if(level==='GROUP'){
   const found=entry.templates.flatMap(t=>t.groups.map(g=>({t,g})))
    .find(x=>x.g.instanceId===groupId);
   if(!found||found.g.ai?.enabled===false)
    failure('SI_CHECKLIST_GROUP_AI_NOT_ENABLED',409);
   scope={level,groupId,templateId:found.t.templateId,
    instructions:[found.t.ai.instructions,found.g.ai.instructions].filter(Boolean)};
  }else{
   const template=entry.templates.find(t=>t.templateId===templateId);
   if(!template||template.ai?.enabled===false)
    failure('SI_CHECKLIST_TEMPLATE_AI_NOT_ENABLED',409);
   scope={level,templateId,instructions:[template.ai.instructions].filter(Boolean)};
  }
  let attached=null;
  if(scope.level==='ITEM'&&typeof evidenceId==='string'){
    attached=(entry.evidenceFiles||[]).find(file=>
      file.id===evidenceId&&file.itemId===scope.itemId);
    if(!attached||!Object.hasOwn(IMAGE_TYPES,attached.mimeType))
      failure('SI_CHECKLIST_AI_IMAGE_NOT_LINKED_TO_QUESTION',409);
  }
  const attachedPath=attached?evidenceLocation(this.imageDirectory,idValue,attached):null;
  const attachmentBytes=attached?readFileSync(attachedPath):null;
  if(attached&&sha(attachmentBytes)!==attached.sha256)
    failure('SI_CHECKLIST_EVIDENCE_INTEGRITY_FAILED',409);
  const attachedImage=attached?{mimeType:attached.mimeType,
    base64:attachmentBytes.toString('base64')}:null;
  const parsed=parseImage(image||attachedImage);
  const selected=entry.templates.filter(t=>t.templateId===scope.templateId)
    .flatMap(t=>t.groups.filter(g=>!scope.groupId||g.instanceId===scope.groupId)
      .flatMap(g=>g.items.filter(item=>!scope.itemId||item.instanceId===scope.itemId)
       .map(item=>({itemId:item.instanceId,title:item.title,description:item.description,
        fields:item.fields,mandatory:item.mandatory,
        currentAnswers:item.answers,sourceReferences:item.sourceReferences}))));
  if(!selected.length)failure('SI_CHECKLIST_AI_NO_ELIGIBLE_ITEMS',409);
  this.active.add(idValue);
  try{
   const raw=await this.airiaSuggest({
    schemaVersion:'SI-CHECKLIST-REVIEW-v1',caseId:idValue,imo:entry.imo,
    vessel:entry.vessel,
    inspectionReasons:entry.inspectionReasons,
    level,scope,items:selected,
    operatorInput:safe(text||'',2500)||'',
    image:parsed?{mimeType:parsed.type,
     base64:(image||attachedImage).base64,sha256:parsed.hash}:null,
    instructions:'Analyze only supplied text/images for each requested item. Respond as a JSON object with recommendations[] including itemId, typed answers, rationale, confidence 0..1, suggestedInstruction (practical inspection steps and evidence checks for inspector), and dataGaps[]. If the image is unclear or cannot establish compliance, leave answers empty, state uncertainty and explain what to inspect next. Do not invent vessel facts, statutory requirements, defects or compliance. Never make regulatory decisions. Inspector acceptance/edit/rejection required.'
   });
   const validated=validateAIResult(raw,entry,scope);
   const state=await this.read(idValue),current=state.cases[idValue];
   if(!current||current.version!==entry.version)
    failure('SI_CHECKLIST_SOURCE_CHANGED_DURING_AI',409);
   const proposal={id:id(),at:now(),actor,level,scope,
    imageEvidenceRef:null,inputText:safe(text||'',2500)||'',
    status:'PENDING_HUMAN_REVIEW',provider:'AIRIA',
    ...validated,reviews:[]};
   if(parsed){
    if(attached){
      proposal.imageEvidenceRef={id:attached.id,mimeType:attached.mimeType,
       sha256:attached.sha256,byteLength:attached.byteLength};
    }else{
      const imageId=id(),dir=join(this.imageDirectory,idValue);
      mkdirSync(dir,{recursive:true,mode:0o700});
      const filepath=join(dir,imageId+parsed.extension);
      writeFileSync(filepath,parsed.bytes,{mode:0o600,flag:'wx'});
      proposal.imageEvidenceRef={id:imageId,mimeType:parsed.type,
       sha256:parsed.hash,byteLength:parsed.bytes.length};
    }
   }
   current.proposals.push(proposal);
   current.version++;current.updatedAt=now();current.updatedBy=actor;
   current.audit.push({at:now(),actor,action:'AI_SUGGESTED_NOT_APPROVED',
    proposalId:proposal.id,sourceLevel:level,imageHash:parsed?.hash||null});
   await this.save(state);
   return {proposal:copy(proposal),version:current.version,
    message:'INSPECTOR_REVIEW_REQUIRED_NO_AUTOMATIC_DECISION'};
  }finally{this.active.delete(idValue);}
 }
 async review(idValue,{expectedVersion,proposalId,itemId,decision,
   editedAnswers,actor,reviewNote}={}){
  if(!safe(actor,120)||!['ACCEPT','EDIT','REJECT'].includes(decision)||
   !Number.isInteger(expectedVersion)||!safe(proposalId,90))
    failure('SI_CHECKLIST_AI_REVIEW_INVALID');
  await this.context(idValue);
  const state=await this.read(idValue),entry=state.cases[idValue];
  if(!entry||entry.version!==expectedVersion)failure('SI_CHECKLIST_VERSION_CONFLICT',409);
  if(entry.status!=='IN_PROGRESS')failure('SI_CHECKLIST_ALREADY_SUBMITTED',409);
  const proposal=entry.proposals.find(p=>p.id===proposalId);
  const suggestion=proposal?.recommendations?.find(r=>r.itemId===itemId);
  const found=resolveItem(entry,itemId);
  if(!proposal||!suggestion||!found||
   proposal.reviews.some(r=>r.itemId===itemId))
    failure('SI_CHECKLIST_AI_PROPOSAL_NOT_REVIEWABLE',409);
  let answers=null;
  if(decision==='ACCEPT')answers=suggestion.proposedAnswers;
  if(decision==='EDIT')answers=validateAnswers(found.item,editedAnswers||{});
  if(decision!=='REJECT'){
   found.item.answers=copy(answers);
   found.item.answerStatus='RECORDED';
   found.item.answeredBy=actor;found.item.answerUpdatedAt=now();
   found.item.evidenceRefs=[...new Set([...found.item.evidenceRefs,
     ...(proposal.imageEvidenceRef?['SI-IMG:'+proposal.imageEvidenceRef.id]:[])])];
  }
  proposal.reviews.push({at:now(),actor,itemId,decision,
   note:safe(reviewNote||'',700)||'',answers:answers?copy(answers):null});
  if(proposal.reviews.length===proposal.recommendations.length)
   proposal.status='REVIEW_COMPLETED';
  entry.version++;entry.updatedAt=now();entry.updatedBy=actor;
  entry.audit.push({at:now(),actor,action:'AI_SUGGESTION_'+decision,
    proposalId,itemId,edited:decision==='EDIT'});
  await this.save(state);return copy(entry);
 }

 /**
  * A single item/question may own multiple private image/PDF evidence files.
  * This explicit upload NEVER calls AI or marks the case compliant.
  */
 async attachEvidence(idValue,{itemId,expectedVersion,file,actor}={}){
  if(!safe(actor,120)||!safe(itemId,220)||!Number.isInteger(expectedVersion))
   failure('SI_CHECKLIST_EVIDENCE_INPUT_INVALID');
  await this.context(idValue);
  if(this.active.has(idValue))failure('SI_CHECKLIST_AI_BUSY',409);
  const state=await this.read(idValue),entry=state.cases[idValue];
  if(!entry)failure('SI_CHECKLIST_NOT_INITIALIZED',409);
  if(entry.status!=='IN_PROGRESS')failure('SI_CHECKLIST_ALREADY_SUBMITTED',409);
  if(entry.version!==expectedVersion)failure('SI_CHECKLIST_VERSION_CONFLICT',409);
  const real=resolveItem(entry,itemId)?.item;
  const advisory=findAdvisoryQuestion(entry,itemId);
  if(!real&&!advisory)failure('SI_CHECKLIST_ITEM_NOT_FOUND',404);
  const uploads=(entry.evidenceFiles||[]).filter(e=>e.itemId===itemId);
  if(uploads.length>=8)failure('SI_CHECKLIST_ITEM_EVIDENCE_LIMIT',409);
  const parsed=parseQuestionAttachment(file);
  const evidence={id:id(),itemId,mimeType:parsed.type,
   sha256:parsed.hash,byteLength:parsed.bytes.length,
   filename:parsed.filename,uploadedBy:actor,at:now(),
   provenance:'INSPECTOR_UPLOADED_UNVERIFIED',
   aiAnalyzed:false,scope:real?'PUBLISHED_ITEM':'AI_ADVISORY_ITEM'};
  const filepath=evidenceLocation(this.imageDirectory,idValue,evidence);
  mkdirSync(dirname(filepath),{recursive:true,mode:0o700});
  writeFileSync(filepath,parsed.bytes,{mode:0o600,flag:'wx'});
  try{
   entry.evidenceFiles||=[];
   entry.evidenceFiles.push(evidence);
   const refs=real?real.evidenceRefs||(real.evidenceRefs=[]):
    advisory.evidenceRefs||(advisory.evidenceRefs=[]);
   refs.push('SI-EVIDENCE:'+evidence.id);
   entry.version++;entry.updatedAt=now();entry.updatedBy=actor;
   entry.audit.push({at:now(),actor,action:'INSPECTOR_ATTACHED_EVIDENCE',
    itemId,evidenceId:evidence.id,hash:evidence.sha256,mimeType:evidence.mimeType,
    noAiInvocation:true});
   await this.save(state);
  }catch(error){
   try{unlinkSync(filepath);}catch{/* no loss of an existing file */}
   throw error;
  }
  return {evidence:copy(evidence),version:entry.version,
   explanation:'PRIVATE_QUESTION_EVIDENCE_NO_AI_CALL'};
 }
 /**
  * A04 suggestions are imported only from a current, supervisor-approved
  * dossier. Not billable; import never mutates pinned published checklists.
  */
 async importA04Questions(idValue,{actor,expectedVersion}={}){
  if(!safe(actor,120)||!Number.isInteger(expectedVersion))
   failure('SI_CHECKLIST_AI_IMPORT_INVALID');
  if(!this.getA04Suggestions)
   failure('SI_CHECKLIST_A04_ADAPTER_NOT_CONFIGURED',503);
  await this.context(idValue);
  if(this.active.has(idValue))failure('SI_CHECKLIST_AI_BUSY',409);
  const state=await this.read(idValue),entry=state.cases[idValue];
  if(!entry||entry.version!==expectedVersion)
   failure('SI_CHECKLIST_VERSION_CONFLICT',409);
  if(entry.status!=='IN_PROGRESS')
   failure('SI_CHECKLIST_ALREADY_SUBMITTED',409);
  const dossier=await this.getA04Suggestions(idValue);
  if(!dossier?.approved||!Array.isArray(dossier.suggestions))
   failure('SI_CHECKLIST_A04_SCOPE_NOT_APPROVED',409);
  if(dossier.suggestions.length>30)
   failure('SI_CHECKLIST_A04_QUESTIONS_INVALID',502);
  const existing=new Set((entry.aiSuggestedQuestions||[])
   .filter(q=>q.source==='AIRIA_A04').map(q=>q.sourceHash));
  const imports=[];
  for(const item of dossier.suggestions){
   const title=typeof item?.title==='string'?item.title.trim():'';
   const reason=typeof item?.reason==='string'?item.reason.trim():'';
   if(title.length<5||title.length>220||reason.length>1000)
    failure('SI_CHECKLIST_A04_QUESTIONS_INVALID',502);
   const sourceHash=sha(JSON.stringify([title,reason,item.evidenceIds||[]]));
   if(existing.has(sourceHash))continue;
   existing.add(sourceHash);
   imports.push({
    id:id(),title,description:reason,rationale:reason,
    suggestedInstruction:null,confidence:null,
    fields:['BOOLEAN','NOTE'],requiredFields:[],
    evidenceRefs:[],answerProposals:[],finalAdvisory:null,
    mandatory:false,source:'AIRIA_A04',sourceHash,
    status:'A04_SUPERVISOR_APPROVED_ADVISORY',
    generatedAt:now(),generatedBy:actor,
    officialChecklistItem:false,requiresScopeApproval:false,
    sourceEvidenceIds:Array.isArray(item.evidenceIds)?
      item.evidenceIds.slice(0,16):[]
   });
  }
  if(!imports.length)return {questions:[],version:entry.version,
   imported:0,approvedDossierOnly:true};
  if((entry.aiSuggestedQuestions||[]).length+imports.length>50)
   failure('SI_CHECKLIST_AI_QUESTION_LIMIT',409);
  entry.aiSuggestedQuestions||=[];
  entry.aiSuggestedQuestions.push(...imports);
  entry.version++;entry.updatedAt=now();entry.updatedBy=actor;
  entry.audit.push({at:now(),actor,
   action:'A04_SUPERVISOR_APPROVED_QUESTION_OVERLAY_IMPORTED',
   questionIds:imports.map(q=>q.id)});
  await this.save(state);
  return {questions:copy(imports),version:entry.version,
   imported:imports.length,approvedDossierOnly:true};
 }
 /**
  * On-demand optional questions generated by the configured Airia BUILDER
  * pipeline. They remain advisory even if an inspector reviews the answer.
  */
 async suggestQuestions(idValue,{actor,confirmCost,operatorPrompt=''}={}){
  if(!safe(actor,120)||confirmCost!==true||!safe(operatorPrompt,1800))
   failure('SI_CHECKLIST_AI_CONFIRMATION_REQUIRED');
  if(!this.airiaQuestionSuggest)
   failure('SI_CHECKLIST_AI_QUESTION_PIPELINE_NOT_CONFIGURED',503);
  await this.context(idValue);
  if(this.active.has(idValue))failure('SI_CHECKLIST_AI_BUSY',409);
  const entry=(await this.read(idValue)).cases[idValue];
  if(!entry)failure('SI_CHECKLIST_NOT_INITIALIZED',409);
  if(entry.status!=='IN_PROGRESS')failure('SI_CHECKLIST_ALREADY_SUBMITTED',409);
  if((entry.aiQuestionRuns||0)>=3)
   failure('SI_CHECKLIST_AI_QUESTION_CALL_LIMIT',429);
  const published=entry.templates.flatMap(t=>t.groups.flatMap(g=>g.items
   .map(i=>({title:i.title,description:i.description,mandatory:i.mandatory}))));
  this.active.add(idValue);
  try{
   const raw=await this.airiaQuestionSuggest({
    schemaVersion:'SI-CHECKLIST-ADDITIONAL-QUESTIONS-v1',caseId:idValue,
    imo:entry.imo,vessel:entry.vessel,
    inspectionReasons:entry.inspectionReasons,
    existingPublishedQuestions:published.slice(0,100),
    operatorPrompt,
    instructions:'Suggest up to 8 additional, vessel-specific inspection questions relevant to the supplied evidence, without duplicating published checklist questions. Respond with JSON suggestedItems[] each with title, description, rationale, suggestedInstruction (practical inspection method) and optional confidence 0..1. All suggestions must be optional, advisory, non-statutory and require inspector/supervisor approval; do not invent legal requirements or facts. Never alter approved mandatory checklists.',
    constraints:{output:'JSON suggestedItems[]',mandatory:false,
     humanReviewRequired:true,noRegulatoryConclusion:true}
   });
   const items=raw?.suggestedItems;
   if(!Array.isArray(items)||items.length>8||JSON.stringify(items).length>18000)
    failure('SI_CHECKLIST_AI_QUESTIONS_INVALID',502);
   const seen=new Set();
   const questions=items.map(x=>{
    const title=typeof x?.title==='string'?x.title.trim():'';
    const description=typeof x?.description==='string'?x.description.trim():'';
    const rationale=typeof x?.rationale==='string'?x.rationale.trim():'';
    const instruction=typeof x?.suggestedInstruction==='string'?
      x.suggestedInstruction.trim():'';
    const confidence=x?.confidence;
    if(title.length<10||title.length>220||description.length>1000||
       rationale.length>1200||instruction.length>1300||
       seen.has(title.toLowerCase())||
       (confidence!==undefined&&(!Number.isFinite(confidence)||
        confidence<0||confidence>1)))
     failure('SI_CHECKLIST_AI_QUESTION_FIELDS_INVALID',502);
    seen.add(title.toLowerCase());
    return {id:id(),title,description,rationale,
     suggestedInstruction:instruction||null,
     confidence:Number.isFinite(confidence)?confidence:null,
     fields:['BOOLEAN','NOTE'],requiredFields:[],
     evidenceRefs:[],answerProposals:[],finalAdvisory:null,
     mandatory:false,source:'AIRIA_BUILDER',
     status:'AI_SUGGESTED_PENDING_INSPECTOR_REVIEW',
     generatedAt:now(),generatedBy:actor,
     officialChecklistItem:false,requiresScopeApproval:true};
   });
   const state=await this.read(idValue),current=state.cases[idValue];
   if(!current||current.version!==entry.version)
    failure('SI_CHECKLIST_SOURCE_CHANGED_DURING_AI',409);
   current.aiSuggestedQuestions||=[];
   if(current.aiSuggestedQuestions.length+questions.length>24)
    failure('SI_CHECKLIST_AI_QUESTION_LIMIT',409);
   current.aiSuggestedQuestions.push(...questions);
   current.aiQuestionRuns=(current.aiQuestionRuns||0)+1;
   current.version++;current.updatedAt=now();current.updatedBy=actor;
   current.audit.push({at:now(),actor,action:'AI_QUESTIONS_PROPOSED_NOT_APPROVED',
    questionIds:questions.map(q=>q.id)});
   await this.save(state);
   return {questions:copy(questions),version:current.version,
    requiresInspectorReview:true,notStatutory:true};
  }finally{this.active.delete(idValue);}
 }
 async suggestAdvisoryAnswer(idValue,{questionId,evidenceId,
  text='',confirmCost,actor}={}){
  if(!safe(actor,120)||!safe(questionId,80)||confirmCost!==true||
     (!safe(text,2500)&&!evidenceId))
   failure('SI_CHECKLIST_AI_CONFIRMATION_REQUIRED');
  if(!this.airiaSuggest)failure('SI_CHECKLIST_AIRIA_NOT_CONFIGURED',503);
  await this.context(idValue);
  if(this.active.has(idValue))failure('SI_CHECKLIST_AI_BUSY',409);
  const entry=(await this.read(idValue)).cases[idValue];
  if(!entry||entry.status!=='IN_PROGRESS')
   failure('SI_CHECKLIST_NOT_INITIALIZED',409);
  const question=findAdvisoryQuestion(entry,questionId);
  if(!question)failure('SI_CHECKLIST_AI_QUESTION_NOT_FOUND',404);
  const maxCalls=Number(this.getSetting('SI_CHECKLIST_AI_MAX_CALLS_PER_CASE'))||10;
  const count=(entry.proposals||[]).length+
    (entry.aiSuggestedQuestions||[]).reduce((n,q)=>n+(q.answerProposals||[]).length,0);
  if(count>=maxCalls)failure('SI_CHECKLIST_AI_CASE_CALL_LIMIT_EXCEEDED',429);
  const attached=(entry.evidenceFiles||[]).find(e=>
   e.id===evidenceId&&e.itemId===questionId&&Object.hasOwn(IMAGE_TYPES,e.mimeType));
  if(evidenceId&&!attached)
   failure('SI_CHECKLIST_AI_IMAGE_NOT_LINKED_TO_QUESTION',409);
  const bytes=attached?readFileSync(evidenceLocation(this.imageDirectory,idValue,attached)):null;
  if(attached&&sha(bytes)!==attached.sha256)
   failure('SI_CHECKLIST_EVIDENCE_INTEGRITY_FAILED',409);
  const virtualEntry={templates:[{templateId:'AI-ADVISORY',groups:[{
   instanceId:'AI-ADVISORY-GROUP',items:[{
    instanceId:question.id,fields:question.fields
   }]}]}]};
  const scope={level:'ITEM',itemId:questionId};
  this.active.add(idValue);
  try{
   const raw=await this.airiaSuggest({
    schemaVersion:'SI-CHECKLIST-REVIEW-v1',caseId:idValue,
    imo:entry.imo,vessel:entry.vessel,
    inspectionReasons:entry.inspectionReasons,
    level:'ITEM',scope,
    items:[{itemId:question.id,title:question.title,
     description:question.description,fields:question.fields,
     mandatory:false,currentAnswers:{},sourceReferences:[]}],
    operatorInput:safe(text,2500)||'Analyze the linked image cautiously',
    image:attached?{mimeType:attached.mimeType,
     sha256:attached.sha256,base64:bytes.toString('base64')}:null,
    instructions:'This is an AI-suggested OPTIONAL question, not part of the official or approved mandatory checklist. Analyze only supplied evidence; return JSON recommendations[] with this itemId, answers with BOOLEAN YES/NO/NA and/or NOTE, rationale, confidence, suggestedInstruction (practical inspection procedure), dataGaps. If insufficient visual evidence, leave answers empty and state uncertainty. Human inspector must review. Never create a regulatory finding or mutate official checklist.'
   });
   const validated=validateAIResult(raw,virtualEntry,scope);
   if(validated.recommendations.length!==1)
    failure('SI_CHECKLIST_AI_ITEM_INVALID',502);
   const state=await this.read(idValue),current=state.cases[idValue];
   if(!current||current.version!==entry.version)
    failure('SI_CHECKLIST_SOURCE_CHANGED_DURING_AI',409);
   const q=findAdvisoryQuestion(current,questionId);
   const proposal={id:id(),at:now(),actor,level:'AI_QUESTION',
    scope:{itemId:questionId},status:'PENDING_HUMAN_REVIEW',
    provider:'AIRIA',imageEvidenceRef:attached?{
     id:attached.id,mimeType:attached.mimeType,
     sha256:attached.sha256,byteLength:attached.byteLength}:null,
    inputText:safe(text,2500)||'',
    ...validated,reviews:[]};
   q.answerProposals||=[];q.answerProposals.push(proposal);
   current.version++;current.updatedAt=now();current.updatedBy=actor;
   current.audit.push({at:now(),actor,action:'AI_ADVISORY_ANSWER_NOT_APPROVED',
    questionId,proposalId:proposal.id,evidenceId:attached?.id||null});
   await this.save(state);
   return {proposal:copy(proposal),version:current.version,
    message:'AI_OPTIONAL_QUESTION_INSPECTOR_REVIEW_REQUIRED'};
  }finally{this.active.delete(idValue);}
 }
 async reviewAdvisoryAnswer(idValue,{expectedVersion,questionId,proposalId,
   decision,editedAnswers,reviewNote,actor}={}){
  if(!safe(actor,120)||!Number.isInteger(expectedVersion)||
   !['ACCEPT','EDIT','REJECT'].includes(decision))
   failure('SI_CHECKLIST_AI_REVIEW_INVALID');
  await this.context(idValue);
  const state=await this.read(idValue),entry=state.cases[idValue];
  if(!entry||entry.version!==expectedVersion)
   failure('SI_CHECKLIST_VERSION_CONFLICT',409);
  if(entry.status!=='IN_PROGRESS')
   failure('SI_CHECKLIST_ALREADY_SUBMITTED',409);
  const question=findAdvisoryQuestion(entry,questionId);
  const proposal=question?.answerProposals?.find(p=>p.id===proposalId);
  if(!question||!proposal||proposal.reviews.length)
   failure('SI_CHECKLIST_AI_PROPOSAL_NOT_REVIEWABLE',409);
  let answers=null;
  if(decision==='ACCEPT')
   answers=copy(proposal.recommendations[0].proposedAnswers);
  if(decision==='EDIT')
   answers=validateAnswers(question,editedAnswers||{});
  proposal.reviews.push({at:now(),actor,itemId:question.id,
   decision,note:safe(reviewNote||'',700)||'',answers});
  proposal.status='REVIEW_COMPLETED';
  if(decision!=='REJECT')question.finalAdvisory={
   answers:copy(answers),reviewedBy:actor,reviewedAt:now(),
   proposalId:proposal.id,inspectionInstruction:
    proposal.recommendations[0].suggestedInstruction||null,
   officialComplianceDecision:false
  };
  entry.version++;entry.updatedAt=now();entry.updatedBy=actor;
  entry.audit.push({at:now(),actor,
   action:'AI_OPTIONAL_QUESTION_'+decision+'_ADVISORY_ONLY',
   questionId,proposalId});
  await this.save(state);
  return copy(entry);
 }
 async ensureSubmitted(idValue){
  // After case start, its pinned revision is authoritative. A later
  // publication must not silently change existing inspector obligations.
  const saved=(await this.read(idValue)).cases[idValue];
  if(saved){
   if(!saved.templates.length)return {required:false};
   if(saved.status!=='SUBMITTED_FOR_REVIEW')
    failure('SI_DYNAMIC_CHECKLIST_SUBMISSION_REQUIRED',409);
   return {required:true,version:saved.version};
  }
  const ctx=await this.context(idValue);
  if(!ctx.resolved.templates.length)return {required:false};
  failure('SI_DYNAMIC_CHECKLIST_SUBMISSION_REQUIRED',409);
 }
 async complete(idValue,{expectedVersion,actor}){
  if(!safe(actor,120))failure('SI_CHECKLIST_ACTOR_REQUIRED');
  await this.context(idValue);
  const state=await this.read(idValue),entry=state.cases[idValue];
  if(!entry||entry.version!==expectedVersion)failure('SI_CHECKLIST_VERSION_CONFLICT',409);
  if(entry.status!=='IN_PROGRESS')failure('SI_CHECKLIST_ALREADY_SUBMITTED',409);
  const pending=entry.templates.flatMap(t=>t.groups.flatMap(g=>g.items
   .filter(item=>item.mandatory&&(item.requiredFields||item.fields.slice(0,1)).some(f=>
    item.answers[f]===undefined||item.answers[f]===null||item.answers[f]===''))
   .map(item=>item.instanceId)));
  if(pending.length)failure('SI_CHECKLIST_MANDATORY_ANSWERS_MISSING',409);
  entry.status='SUBMITTED_FOR_REVIEW';entry.version++;entry.updatedAt=now();
  entry.updatedBy=actor;
  entry.audit.push({at:now(),actor,action:'INSPECTOR_SUBMITTED_CHECKLIST'});
  await this.save(state);return copy(entry);
 }
}
