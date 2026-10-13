/**
 * Configurable SI checklist catalog, POC persisted in protected Docker volume.
 * Published revisions are immutable; editing always changes the draft.
 * Publishing an ADMIN-authored template does not imply statutory endorsement.
 * A ship can match MANY published templates, and an item can request MANY
 * response fields (e.g. YES/NO + NOTES + EXPIRY_DATE simultaneously).
 */
import {randomUUID,createHash} from 'node:crypto';
import {readFileSync,writeFileSync,existsSync,mkdirSync,renameSync} from 'node:fs';
import {dirname} from 'node:path';

const clone=x=>structuredClone(x);
const now=()=>new Date().toISOString();
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const unique=arr=>[...new Set(arr)];
const TYPES=['BOOLEAN','NOTE','EXPIRY_DATE','DATE','NUMBER','TEXT'];
const LEVELS=['TEMPLATE','GROUP','ITEM'];
const ORIGINS=['NMC_CASE','PSC_PORT_CALL','SERVICE_REQUEST'];
const id=()=>randomUUID();
const plain=x=>typeof x==='string'?x.trim():'';
const safe=(x,max=160)=>{let a=plain(x);return a&&a.length<=max?a:null;};
const record=()=>({version:1,templates:[]});
const write=(file,data)=>{
 mkdirSync(dirname(file),{recursive:true});
 const tmp=file+'.'+id()+'.tmp';
 writeFileSync(tmp,JSON.stringify(data,null,2),{mode:0o600});
 renameSync(tmp,file);
};
export class SiChecklistError extends Error{
 constructor(code,status=422){super(code);this.code=code;this.status=status;}
}
const fail=(code,status)=>{throw new SiChecklistError(code,status);};
const arr=(x,max=150)=>Array.isArray(x)&&x.length<=max;
const code=x=>typeof x==='string'&&/^[a-zA-Z0-9_-]{1,70}$/.test(x);
const list=(x,max=30)=>arr(x,max)&&x.every(y=>safe(y,80)!==null);
function applicability(x){
 if(!x||typeof x!=='object'||Array.isArray(x))fail('SI_CHECKLIST_APPLICABILITY_INVALID');
 const vesselTypes=x.vesselTypes||[],inspectionRegimes=x.inspectionRegimes||[],
  sourceTypes=x.sourceTypes||[];
 if(!list(vesselTypes)||!list(inspectionRegimes)||!arr(sourceTypes,3)||
  sourceTypes.some(t=>!ORIGINS.includes(t)))fail('SI_CHECKLIST_RULE_VALUES_INVALID');
 const minGT=x.minGT??null,maxGT=x.maxGT??null,
  minDWT=x.minDWT??null,maxDWT=x.maxDWT??null;
 if([minGT,maxGT,minDWT,maxDWT].some(v=>v!==null&&
    (!Number.isFinite(v)||v<0||v>1e9))||
   (minGT!==null&&maxGT!==null&&minGT>maxGT)||
   (minDWT!==null&&maxDWT!==null&&minDWT>maxDWT))
  fail('SI_CHECKLIST_TONNAGE_RULE_INVALID');
 return {vesselTypes:unique(vesselTypes.map(x=>x.trim())),
  inspectionRegimes:unique(inspectionRegimes.map(x=>x.trim())),
  sourceTypes:unique(sourceTypes),minGT,maxGT,minDWT,maxDWT};
}
function aiOptions(x){
 const enabled=x?.enabled===true;
 const instructions=safe(x?.instructions||'',1200)||'';
 return {enabled,instructions,requiresHumanReview:true};
}
function validateItems(items){
 if(!arr(items,65))fail('SI_CHECKLIST_ITEMS_INVALID');
 const used=new Set();
 return items.map((x,index)=>{
  if(!x||typeof x!=='object'||Array.isArray(x))fail('SI_CHECKLIST_ITEM_INVALID');
  const itemId=code(x.id)?x.id:id(),title=safe(x.title,200);
  if(!title||used.has(itemId))fail('SI_CHECKLIST_ITEM_INVALID');
  used.add(itemId);
  if(!arr(x.fields,7)||!x.fields.length||x.fields.some(t=>!TYPES.includes(t)))
   fail('SI_CHECKLIST_ANSWER_TYPES_INVALID');
  const fields=unique(x.fields),options=x.options||[];
  // One question may display multiple fields simultaneously. Administrators
  // choose exactly which of those fields are mandatory to answer.
  const requiredFields=x.requiredFields===undefined?[fields[0]]:x.requiredFields;
  if(!arr(requiredFields,7)||requiredFields.some(f=>!fields.includes(f)))
   fail('SI_CHECKLIST_REQUIRED_FIELDS_INVALID');
  if(!arr(options,18)||options.some(z=>!safe(z,160)))
   fail('SI_CHECKLIST_ITEM_OPTIONS_INVALID');
  return {id:itemId,title,description:safe(x.description,1300)||'',
   fields,requiredFields:unique(requiredFields),mandatory:x.mandatory!==false,options:unique(options),
   order:Number.isInteger(x.order)&&x.order>=0?x.order:index,
   ai:aiOptions(x.ai),sourceReferences:arr(x.sourceReferences,20)?
    x.sourceReferences.filter(z=>safe(z,180)):[]};
 });
}
function validateGroups(groups){
 if(!arr(groups,30))fail('SI_CHECKLIST_GROUPS_INVALID');
 const used=new Set();
 return groups.map((g,index)=>{
  if(!g||typeof g!=='object'||Array.isArray(g))fail('SI_CHECKLIST_GROUP_INVALID');
  const groupId=code(g.id)?g.id:id(),title=safe(g.title,180);
  if(!title||used.has(groupId))fail('SI_CHECKLIST_GROUP_INVALID');
  used.add(groupId);
  return {id:groupId,title,description:safe(g.description,1000)||'',
   order:Number.isInteger(g.order)&&g.order>=0?g.order:index,
   ai:aiOptions(g.ai),items:validateItems(g.items||[])};
 });
}
export function validateTemplate(body,{existing=null}={}){
 const title=safe(body?.title,160),description=safe(body?.description,1500)||'';
 if(!title)fail('SI_CHECKLIST_TEMPLATE_NAME_REQUIRED');
 return {title,description,mandatory:body?.mandatory!==false,
  applicability:applicability(body.applicability||{}),
  ai:aiOptions(body.ai),groups:validateGroups(body.groups||[])};
}
function normalizeVessel(v){
 const x=v||{}, num=y=>{
  if(typeof y==='number')return Number.isFinite(y)&&y>=0?y:null;
  if(typeof y!=='string')return null;
  // The shipped MOEI synthetic fleet stores e.g. "42,000 GT" and
  // "76,000 DWT", not naked numeric fields.
  const match=/^([0-9][0-9,]*(?:\.[0-9]+)?)\s*(?:GT|DWT)?$/i.exec(y.trim());
  if(!match)return null;
  const normalized=Number(match[1].replace(/,/g,''));
  return Number.isFinite(normalized)&&normalized>=0?normalized:null;
 };
 return {imo:x.imo||null,name:x.name||x.vesselName||null,
  vesselType:plain(x.vesselType||x.type||'')||null,
  grossTonnage:num(x.grossTonnage??x.gt??x.grossTons),
  deadweightTonnage:num(x.deadweightTonnage??x.deadweight??x.dwt)};
}
const matchList=(required,actual)=>!required.length||
  (typeof actual==='string'&&required.some(x=>x.toLowerCase()===actual.toLowerCase()));
export function matchRule(rule,vessel,inspectionCase){
 const missing=[];
 if(!matchList(rule.vesselTypes,vessel.vesselType)){
  if(!vessel.vesselType)missing.push('VESSEL_TYPE_UNKNOWN');
  else return {matches:false,missing:[]};
 }
 for(const [min,max,value,label] of [
  [rule.minGT,rule.maxGT,vessel.grossTonnage,'GT'],
  [rule.minDWT,rule.maxDWT,vessel.deadweightTonnage,'DWT']]){
  if(min!==null||max!==null){
   if(value===null){missing.push(label+'_UNKNOWN');continue;}
   if(min!==null&&value<min||max!==null&&value>max)return {matches:false,missing:[]};
  }
 }
 if(rule.inspectionRegimes.length&&!rule.inspectionRegimes.some(x=>
  (inspectionCase.regimes||[inspectionCase.regime]).includes(x)))return {matches:false,missing:[]};
 if(rule.sourceTypes.length&&!rule.sourceTypes.some(x=>
  (inspectionCase.inspectionReasons||[]).some(reason=>reason.sourceType===x)))
  return {matches:false,missing:[]};
 return {matches:missing.length===0,missing};
}
export class SiChecklistLibrary{
 constructor({file=process.env.SI_CHECKLIST_LIBRARY_PATH||
   '/data/si-checklist-library.json'}={}){this.file=file;}
 read(){
  if(!existsSync(this.file))return record();
  try{
   const doc=JSON.parse(readFileSync(this.file,'utf8'));
   if(doc.version!==1||!Array.isArray(doc.templates))throw Error('schema');
   return doc;
  }catch{fail('SI_CHECKLIST_LIBRARY_CORRUPT',503);}
 }
 save(state){write(this.file,state);}
 list(){
  return this.read().templates.map(t=>({id:t.id,title:t.draft.title,
   mandatory:t.draft.mandatory,revision:t.revision,
   published:Boolean(t.published?.length),groupCount:t.draft.groups.length,
   itemCount:t.draft.groups.reduce((n,g)=>n+g.items.length,0),
   updatedAt:t.updatedAt,updatedBy:t.updatedBy}));
 }
 get(templateId){
  const t=this.read().templates.find(x=>x.id===templateId);
  if(!t)fail('SI_CHECKLIST_TEMPLATE_NOT_FOUND',404);
  return clone(t);
 }
 create(body,actor){
  if(!safe(actor,120))fail('SI_CHECKLIST_ACTOR_REQUIRED');
  const draft=validateTemplate(body);
  const state=this.read(),at=now();
  const t={id:id(),draft,revision:0,published:[],
   updatedAt:at,updatedBy:actor,createdAt:at,createdBy:actor};
  state.templates.push(t);this.save(state);return clone(t);
 }
 edit(templateId,body,actor){
  const state=this.read(),t=state.templates.find(x=>x.id===templateId);
  if(!t)fail('SI_CHECKLIST_TEMPLATE_NOT_FOUND',404);
  if(!Number.isInteger(body?.expectedRevision)||body.expectedRevision!==t.revision||
   body.expectedUpdatedAt!==t.updatedAt)fail('SI_CHECKLIST_EDIT_CONFLICT',409);
  t.draft=validateTemplate(body);
  t.updatedAt=now();t.updatedBy=actor;this.save(state);return clone(t);
 }
 publish(templateId,actor,expectedUpdatedAt){
  const state=this.read(),t=state.templates.find(x=>x.id===templateId);
  if(!t)fail('SI_CHECKLIST_TEMPLATE_NOT_FOUND',404);
  if(!expectedUpdatedAt||expectedUpdatedAt!==t.updatedAt)
   fail('SI_CHECKLIST_PUBLISH_CONFLICT',409);
  if(!t.draft.groups.length||t.draft.groups.some(g=>!g.items.length))
   fail('SI_CHECKLIST_PUBLISH_REQUIRES_GROUPS_AND_ITEMS');
  const rev=t.revision+1;
  const snapshot={...clone(t.draft),revision:rev,publishedAt:now(),
    publishedBy:actor,contentHash:sha(t.draft),
    regulatoryApprovalVerified:false};
  t.published.push(snapshot);t.revision=rev;
  t.updatedAt=now();t.updatedBy=actor;this.save(state);
  return clone(t);
 }
 resolve({vessel,inspectionCase}){
  const profile=normalizeVessel(vessel);
  const selected=[],warnings=[];
  for(const t of this.read().templates){
   const version=t.published?.at(-1);
   if(!version)continue;
   const m=matchRule(version.applicability,profile,inspectionCase);
   if(m.matches)selected.push({templateId:t.id,revision:version.revision,
    ...clone(version)});
   else if(m.missing.length)warnings.push({templateId:t.id,title:version.title,
    missing:m.missing,action:'REVIEW_SOURCE_DATA_NO_ASSUMPTIONS'});
  }
  return {vessel:profile,templates:selected,warnings};
 }
}
export {TYPES,LEVELS,ORIGINS};
