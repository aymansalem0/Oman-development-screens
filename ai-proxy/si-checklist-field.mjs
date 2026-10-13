/**
 * Real SI dynamic checklist execution. Immutable template revisions are copied
 * into each case's field-checklist snapshot. An AI guess is NEVER an inspector
 * decision: request -> review -> ACCEPT/EDIT/REJECT with audit trail.
 *
 * POC JSON persistence, protected /data volume. Production requires a DB
 * transactional store + object storage + AV/DLP for uploaded evidence.
 */
import {randomUUID,createHash} from 'node:crypto';
import {readFileSync,writeFileSync,existsSync,mkdirSync,renameSync} from 'node:fs';
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
  return {itemId:r.itemId,proposedAnswers:validateAnswers(found.item,r.answers||{}),
   rationale:r.rationale.trim(),confidence:r.confidence,
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
   airiaSuggest=null}={}){
  if(!library||!targeting)throw Error('SI_CHECKLIST_FIELD_CONFIGURATION_INVALID');
  this.library=library;this.targeting=targeting;this.file=file;
  this.imageDirectory=imageDirectory;this.airiaSuggest=airiaSuggest;
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
  const resolved=this.library.resolve({vessel,inspectionCase:c});
  return {caseId:idValue,inspectionCase:c,resolved};
 }
 async preview(idValue){
  const ctx=await this.context(idValue);
  const saved=this.read().cases[idValue]||null;
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
  const state=this.read();
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
   templates,proposals:[],audit:[{at:now(),action:'INITIALIZED',actor,
    templateRevisions:templates.map(t=>[t.templateId,t.revision])}]};
  state.cases[idValue]=entry;this.save(state);return copy(entry);
 }
 async saveAnswers(idValue,{expectedVersion,answers,actor}){
  if(!safe(actor,120)||!Array.isArray(answers)||answers.length>100||
   !Number.isInteger(expectedVersion))failure('SI_CHECKLIST_ANSWERS_INVALID');
  await this.context(idValue);
  const state=this.read(),entry=state.cases[idValue];
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
  this.save(state);return copy(entry);
 }
 async suggest(idValue,{level='ITEM',templateId,groupId,itemId,
   text,image,actor,confirmCost}={}){
  if(!safe(actor,120)||confirmCost!==true||
   !VALID_LEVELS.includes(level)||!safe(text||'',2500)&&!image)
   failure('SI_CHECKLIST_AI_CONFIRMATION_REQUIRED');
  if(!this.airiaSuggest)failure('SI_CHECKLIST_AIRIA_NOT_CONFIGURED',503);
  await this.context(idValue);
  if(this.active.has(idValue))failure('SI_CHECKLIST_AI_BUSY',409);
  const entry=this.read().cases[idValue];
  if(!entry)failure('SI_CHECKLIST_NOT_INITIALIZED',409);
  if(entry.status!=='IN_PROGRESS')failure('SI_CHECKLIST_ALREADY_SUBMITTED',409);
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
  const parsed=parseImage(image);
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
    image:parsed?{mimeType:parsed.type,base64:image.base64,sha256:parsed.hash}:null,
    instructions:'Analyze supplied information only. Propose typed values matching the provided fields. Do not invent vessel certificates, law, missing images, or regulatory compliance. Respond with JSON recommendations[] containing itemId, answers object, rationale, confidence 0..1, dataGaps[]. Inspector approval required.'
   });
   const validated=validateAIResult(raw,entry,scope);
   const state=this.read(),current=state.cases[idValue];
   if(!current||current.version!==entry.version)
    failure('SI_CHECKLIST_SOURCE_CHANGED_DURING_AI',409);
   const proposal={id:id(),at:now(),actor,level,scope,
    imageEvidenceRef:null,inputText:safe(text||'',2500)||'',
    status:'PENDING_HUMAN_REVIEW',provider:'AIRIA',
    ...validated,reviews:[]};
   if(parsed){
    const imageId=id(),dir=join(this.imageDirectory,idValue);
    mkdirSync(dir,{recursive:true,mode:0o700});
    const filepath=join(dir,imageId+parsed.extension);
    writeFileSync(filepath,parsed.bytes,{mode:0o600,flag:'wx'});
    proposal.imageEvidenceRef={id:imageId,mimeType:parsed.type,
      sha256:parsed.hash,byteLength:parsed.bytes.length};
   }
   current.proposals.push(proposal);
   current.version++;current.updatedAt=now();current.updatedBy=actor;
   current.audit.push({at:now(),actor,action:'AI_SUGGESTED_NOT_APPROVED',
    proposalId:proposal.id,sourceLevel:level,imageHash:parsed?.hash||null});
   this.save(state);
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
  const state=this.read(),entry=state.cases[idValue];
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
  this.save(state);return copy(entry);
 }
 async ensureSubmitted(idValue){
  const ctx=await this.context(idValue);
  if(!ctx.resolved.templates.length)return {required:false};
  const saved=this.read().cases[idValue];
  if(!saved||saved.status!=='SUBMITTED_FOR_REVIEW')
   failure('SI_DYNAMIC_CHECKLIST_SUBMISSION_REQUIRED',409);
  return {required:true,version:saved.version};
 }
 async complete(idValue,{expectedVersion,actor}){
  if(!safe(actor,120))failure('SI_CHECKLIST_ACTOR_REQUIRED');
  await this.context(idValue);
  const state=this.read(),entry=state.cases[idValue];
  if(!entry||entry.version!==expectedVersion)failure('SI_CHECKLIST_VERSION_CONFLICT',409);
  if(entry.status!=='IN_PROGRESS')failure('SI_CHECKLIST_ALREADY_SUBMITTED',409);
  const pending=entry.templates.flatMap(t=>t.groups.flatMap(g=>g.items
   .filter(item=>item.mandatory&&item.fields.some(f=>
    item.answers[f]===undefined||item.answers[f]===null||item.answers[f]===''))
   .map(item=>item.instanceId)));
  if(pending.length)failure('SI_CHECKLIST_MANDATORY_ANSWERS_MISSING',409);
  entry.status='SUBMITTED_FOR_REVIEW';entry.version++;entry.updatedAt=now();
  entry.updatedBy=actor;
  entry.audit.push({at:now(),actor,action:'INSPECTOR_SUBMITTED_CHECKLIST'});
  this.save(state);return copy(entry);
 }
}
