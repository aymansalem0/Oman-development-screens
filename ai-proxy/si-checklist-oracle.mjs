/**
 * Oracle-authoritative Smart Inspection checklist persistence.
 * Uses schema 017; never issues DDL and never silently imports /data JSON.
 * Database transaction is committed only once a complete checklist state
 * and its normalized, evidence-linked audit projections have been persisted.
 * API contracts and maritime validation are reused from si-checklist-library.
 */
import oracledb from 'oracledb';
import {randomUUID,createHash} from 'node:crypto';
import {readFileSync,existsSync} from 'node:fs';
import {SiChecklistLibrary,SiChecklistError,matchRule,normalizeVessel} from './si-checklist-library.mjs';
import {SiChecklistField} from './si-checklist-field.mjs';

const json=v=>({val:JSON.stringify(v??null),type:oracledb.DB_TYPE_CLOB});
const rows=async(con,sql,binds={})=>(await con.execute(sql,binds,{
 outFormat:oracledb.OUT_FORMAT_OBJECT,
 fetchInfo:{DRAFT_JSON:{type:oracledb.STRING},SNAPSHOT_JSON:{type:oracledb.STRING}}
})).rows;
const error=(code,status=503)=>new SiChecklistError(code,status);
const parse=x=>typeof x==='string'?JSON.parse(x):x;
const uuidFor=(...parts)=>{
 const x=createHash('sha256').update(JSON.stringify(parts)).digest('hex');
 return x.slice(0,8)+'-'+x.slice(8,12)+'-4'+x.slice(13,16)+'-8'+x.slice(17,20)+'-'+x.slice(20,32);
};
const auditId=()=>randomUUID();
const versionItemId=(t,r,g,i)=>uuidFor('SI-CHK-ITEM-v1',t,r,g,i);
// The UI's item.instanceId identifies an item within a template, and is
// intentionally reused by MANY approved cases. Oracle's global case-item PK
// must include CASE_ID to avoid collisions between different vessels/cases.
export const caseItemOracleId=(caseId,instanceId)=>
 uuidFor('SI-CHK-CASE-ITEM-v1',caseId,instanceId);
const SOURCE_TABLES=['SI_CHK_MD_GROUP','SI_CHK_MD_VALUE','SI_CHK_TEMPLATE',
 'SI_CHK_REVISION','SI_CHK_APPLICABILITY','SI_CHK_GROUP','SI_CHK_ITEM',
 'SI_CHK_ITEM_FIELD','SI_CHK_CASE_RUN','SI_CHK_CASE_ITEM','SI_CHK_EVIDENCE',
 'SI_CHK_AI_PROPOSAL','SI_CHK_AI_REVIEW','SI_CHK_AUDIT'];
function fileRows(file,field){
 if(!existsSync(file))return [];
 let data;
 try{data=JSON.parse(readFileSync(file,'utf8'));}
 catch{throw error('SI_CHECKLIST_LEGACY_JSON_CORRUPT');}
 if(data?.version!==1)throw error('SI_CHECKLIST_LEGACY_JSON_INVALID');
 return field==='templates'?data.templates||[]:Object.values(data.cases||{});
}
const value=v=>v===null||v===undefined?null:v;
const initial=(entry)=>entry?.version===1&&entry?.audit?.[0]?.action==='INITIALIZED';
export class OracleSiChecklistLibrary{
 constructor({oracle,jsonFile=process.env.SI_CHECKLIST_LIBRARY_PATH||
  '/data/si-checklist-library.json'}={}){
  if(!oracle)throw new Error('SI_CHECKLIST_ORACLE_REQUIRED');
  this.oracle=oracle;this.jsonFile=jsonFile;this.ready=false;
 }
 async connection(){
  if(!this.oracle.pool)throw error('SI_CHECKLIST_ORACLE_POOL_UNAVAILABLE');
  return this.oracle.pool.getConnection();
 }
 async initialize(){
  const con=await this.connection();
  try{
   const found=await rows(con,"SELECT TABLE_NAME FROM USER_TABLES WHERE TABLE_NAME IN ("+
    SOURCE_TABLES.map((_,i)=>':n'+i).join(',')+")",
    Object.fromEntries(SOURCE_TABLES.map((n,i)=>['n'+i,n])));
   if(found.length!==SOURCE_TABLES.length)
    throw error('SI_CHECKLIST_ORACLE_MIGRATION_017_REQUIRED');
   const legacy=fileRows(this.jsonFile,'templates');
   if(legacy.length){
    const saved=await rows(con,'SELECT TEMPLATE_ID FROM SI_CHK_TEMPLATE');
    const known=new Set(saved.map(x=>x.TEMPLATE_ID));
    if(legacy.some(x=>!known.has(x.id)))
     throw error('SI_CHECKLIST_LEGACY_LIBRARY_IMPORT_REQUIRED');
   }
   this.ready=true;
  }finally{await con.close();}
 }
 assertReady(){if(!this.ready)throw error('SI_CHECKLIST_ORACLE_NOT_READY');}
 async _all(con){
  const data=await rows(con,'SELECT DRAFT_JSON FROM SI_CHK_TEMPLATE');
  return {version:1,templates:data.map(x=>parse(x.DRAFT_JSON))};
 }
 async list(){
  this.assertReady();const con=await this.connection();
  try{
   const engine=new SiChecklistLibrary();const state=await this._all(con);
   engine.read=()=>state;return engine.list();
  }finally{await con.close();}
 }
 async get(templateId){
  this.assertReady();const con=await this.connection();
  try{
   const x=await rows(con,'SELECT DRAFT_JSON FROM SI_CHK_TEMPLATE WHERE TEMPLATE_ID=:id',
    {id:templateId});
   if(!x.length)throw error('SI_CHECKLIST_TEMPLATE_NOT_FOUND',404);
   return parse(x[0].DRAFT_JSON);
  }finally{await con.close();}
 }
 async resolve({vessel,inspectionCase}){
  this.assertReady();const profile=normalizeVessel(vessel),templates=[],warnings=[];
  const con=await this.connection();
  try{
   const raw=await rows(con,'SELECT r.TEMPLATE_ID,r.REVISION_NO,r.SNAPSHOT_JSON FROM SI_CHK_REVISION r '+
    'JOIN SI_CHK_TEMPLATE t ON t.TEMPLATE_ID=r.TEMPLATE_ID '+
    'WHERE r.REVISION_NO=t.CURRENT_REVISION');
   for(const x of raw){
    const snapshot=parse(x.SNAPSHOT_JSON);
    const m=matchRule(snapshot.applicability,profile,inspectionCase);
    if(m.matches)templates.push({templateId:x.TEMPLATE_ID,revision:x.REVISION_NO,
      ...structuredClone(snapshot)});
    else if(m.missing.length)warnings.push({templateId:x.TEMPLATE_ID,title:snapshot.title,
      missing:m.missing,action:'REVIEW_SOURCE_DATA_NO_ASSUMPTIONS'});
   }
   return {vessel:profile,templates,warnings};
  }finally{await con.close();}
 }
 async _modify(op,{templateId,body,actor,expectedUpdatedAt}={}){
  this.assertReady();const con=await this.connection();
  try{
   let old=null;
   if(templateId){
    const locked=await rows(con,'SELECT DRAFT_JSON FROM SI_CHK_TEMPLATE '+
      'WHERE TEMPLATE_ID=:id FOR UPDATE',{id:templateId});
    if(!locked.length)throw error('SI_CHECKLIST_TEMPLATE_NOT_FOUND',404);
    old=parse(locked[0].DRAFT_JSON);
   }
   let state={version:1,templates:old?[old]:[]};
   const engine=new SiChecklistLibrary();
   engine.read=()=>state;
   engine.save=updated=>{state=updated;};
   const item=op==='create'?engine.create(body,actor):
    op==='edit'?engine.edit(templateId,body,actor):
    engine.publish(templateId,actor,expectedUpdatedAt);
   if(op==='create'){
    await con.execute(`INSERT INTO SI_CHK_TEMPLATE
       (TEMPLATE_ID,TEMPLATE_CODE,TITLE_EN,DESCRIPTION_TEXT,IS_MANDATORY,STATUS,
        DRAFT_JSON,CURRENT_REVISION,CREATED_BY,UPDATED_BY)
       VALUES (:id,:code,:title,:description,:mandatory,'DRAFT',:doc,0,:actor,:actor)`,{
      id:item.id,code:'CHK-'+item.id,title:item.draft.title,
      description:item.draft.description||null,mandatory:item.draft.mandatory?'Y':'N',
      doc:json(item),actor});
   }else{
    await con.execute(`UPDATE SI_CHK_TEMPLATE SET TITLE_EN=:title,
       DESCRIPTION_TEXT=:description,IS_MANDATORY=:mandatory,
       STATUS=:status,DRAFT_JSON=:doc,CURRENT_REVISION=:rev,
       UPDATED_BY=:actor,UPDATED_AT=SYSTIMESTAMP
       WHERE TEMPLATE_ID=:id`,{
      title:item.draft.title,description:item.draft.description||null,
      mandatory:item.draft.mandatory?'Y':'N',status:item.revision?'PUBLISHED':'DRAFT',
      doc:json(item),rev:item.revision,actor,id:item.id});
   }
   if(op==='publish')await this._publishNormalized(con,item,item.published.at(-1),actor);
   await con.execute(`INSERT INTO SI_CHK_AUDIT
      (AUDIT_ID,TEMPLATE_ID,EVENT_TYPE,ACTOR,DETAILS_JSON)
      VALUES(:id,:template,:event,:actor,:doc)`,{
     id:auditId(),template:item.id,event:op.toUpperCase()+'_CHECKLIST',
     actor,doc:json({revision:item.revision,updatedAt:item.updatedAt})});
   await con.commit();return item;
  }catch(e){await con.rollback();throw e;}
  finally{await con.close();}
 }
 async _publishNormalized(con,item,snapshot,actor){
  // Named bind variables are deliberately prefixed: Oracle rejects reserved
  // SQL words such as :group (ORA-01745). The old POC implementation used
  // :group while writing SI_CHK_ITEM and failed when publishing a DRAFT.
  await con.execute(`INSERT INTO SI_CHK_REVISION
   (TEMPLATE_ID,REVISION_NO,SNAPSHOT_JSON,CONTENT_SHA256,POLICY_REVIEWED,PUBLISHED_BY)
   VALUES(:p_template_id,:p_revision_no,:p_snapshot_json,:p_content_hash,'N',:p_actor)`,{
    p_template_id:item.id,p_revision_no:snapshot.revision,
    p_snapshot_json:json(snapshot),p_content_hash:snapshot.contentHash,p_actor:actor});
  const r=snapshot.applicability;
  // Matching is always on full immutable RULE_JSON (lists are OR within each
  // dimension). Scalar columns are null to avoid falsely implying single rule.
  await con.execute(`INSERT INTO SI_CHK_APPLICABILITY
   (RULE_ID,TEMPLATE_ID,REVISION_NO,MIN_GT,MAX_GT,MIN_DWT,MAX_DWT,RULE_JSON)
   VALUES(:p_rule_id,:p_template_id,:p_revision_no,:p_min_gt,:p_max_gt,:p_min_dwt,:p_max_dwt,:p_rule_json)`,{
    p_rule_id:randomUUID(),p_template_id:item.id,p_revision_no:snapshot.revision,
    p_min_gt:value(r.minGT),p_max_gt:value(r.maxGT),
    p_min_dwt:value(r.minDWT),p_max_dwt:value(r.maxDWT),
    p_rule_json:json(r)});
  for(const g of snapshot.groups){
   const groupId=uuidFor('SI-CHK-GROUP-v1',item.id,snapshot.revision,g.id);
   await con.execute(`INSERT INTO SI_CHK_GROUP
      (GROUP_ID,TEMPLATE_ID,REVISION_NO,TITLE,DISPLAY_ORDER,AI_ENABLED,AI_PROMPT)
      VALUES(:p_group_id,:p_template_id,:p_revision_no,:p_title,:p_order,:p_ai_enabled,:p_ai_prompt)`,{
     p_group_id:groupId,p_template_id:item.id,p_revision_no:snapshot.revision,
     p_title:g.title,p_order:g.order,p_ai_enabled:g.ai.enabled?'Y':'N',
     p_ai_prompt:g.ai.instructions||null});
   for(const it of g.items){
    const itemId=versionItemId(item.id,snapshot.revision,g.id,it.id);
    await con.execute(`INSERT INTO SI_CHK_ITEM
     (ITEM_ID,GROUP_ID,TITLE,DESCRIPTION_TEXT,MANDATORY,DISPLAY_ORDER,
      AI_ENABLED,AI_PROMPT,REFERENCE_JSON)
     VALUES(:p_item_id,:p_group_id,:p_title,:p_description,:p_mandatory,:p_order,
      :p_ai_enabled,:p_ai_prompt,:p_references)`,{
      p_item_id:itemId,p_group_id:groupId,p_title:it.title,
      p_description:it.description||null,p_mandatory:it.mandatory?'Y':'N',
      p_order:it.order,p_ai_enabled:it.ai.enabled?'Y':'N',
      p_ai_prompt:it.ai.instructions||null,
      p_references:json(it.sourceReferences||[])});
    for(let i=0;i<it.fields.length;i++){
     const fieldType=it.fields[i];
     await con.execute(`INSERT INTO SI_CHK_ITEM_FIELD
      (ITEM_ID,FIELD_TYPE,MASTER_GROUP_CODE,IS_REQUIRED,DISPLAY_ORDER)
      VALUES(:p_item_id,:p_field_type,'ANSWER_FIELD_TYPE',:p_is_required,:p_order)`,{
       p_item_id:itemId,p_field_type:fieldType,
       p_is_required:it.requiredFields.includes(fieldType)?'Y':'N',p_order:i});
    }
   }
  }
 }
 create(body,actor){return this._modify('create',{body,actor});}
 edit(templateId,body,actor){return this._modify('edit',{templateId,body,actor});}
 publish(templateId,actor,expectedUpdatedAt){
  return this._modify('publish',{templateId,actor,expectedUpdatedAt});}
 /**
  * Explicit, idempotent import for the migration utility only.
  * Imports a PRE-VALIDATED historical JSON document unchanged, preserving
  * published content hashes, revision numbers, stable item identity and audit.
  */
 async importTemplate(t){
  this.assertReady();
  const con=await this.connection();
  try{
   const old=await rows(con,
    'SELECT DRAFT_JSON FROM SI_CHK_TEMPLATE WHERE TEMPLATE_ID=:id',{id:t.id});
   if(old.length){
    if(JSON.stringify(parse(old[0].DRAFT_JSON))!==JSON.stringify(t))
     throw error('SI_CHECKLIST_IMPORT_TEMPLATE_CONFLICT',409);
    return {skipped:true,id:t.id};
   }
   await con.execute(`INSERT INTO SI_CHK_TEMPLATE
    (TEMPLATE_ID,TEMPLATE_CODE,TITLE_EN,DESCRIPTION_TEXT,IS_MANDATORY,STATUS,
     DRAFT_JSON,CURRENT_REVISION,CREATED_BY,UPDATED_BY)
    VALUES(:id,:code,:title,:description,:mandatory,:status,:doc,:rev,:createdBy,:updatedBy)`,{
    id:t.id,code:'CHK-'+t.id,title:t.draft.title,description:t.draft.description||null,
    mandatory:t.draft.mandatory?'Y':'N',status:t.revision?'PUBLISHED':'DRAFT',
    doc:json(t),rev:t.revision,createdBy:t.createdBy,updatedBy:t.updatedBy});
   for(const snap of t.published||[])await this._publishNormalized(con,t,snap,snap.publishedBy);
   await con.commit();return {imported:true,id:t.id};
  }catch(e){await con.rollback();throw e;}finally{await con.close();}
 }
}

export class OracleSiChecklistField extends SiChecklistField{
 constructor({oracle,...rest}={}){
  super(rest);
  if(!oracle)throw new Error('SI_CHECKLIST_ORACLE_REQUIRED');
  this.oracle=oracle;this.ready=false;
 }
 async connection(){
  if(!this.oracle.pool)throw error('SI_CHECKLIST_ORACLE_POOL_UNAVAILABLE');
  return this.oracle.pool.getConnection();
 }
 async initialize(){
  const con=await this.connection();
  try{
   const legacy=fileRows(this.file,'cases');
   if(legacy.length){
    const saved=await rows(con,'SELECT CASE_ID FROM SI_CHK_CASE_RUN');
    const known=new Set(saved.map(x=>x.CASE_ID));
    if(legacy.some(x=>!known.has(x.caseId)))
     throw error('SI_CHECKLIST_LEGACY_CASE_IMPORT_REQUIRED');
   }
   this.ready=true;
  }finally{await con.close();}
 }
 assertReady(){if(!this.ready)throw error('SI_CHECKLIST_ORACLE_NOT_READY');}
 async read(idValue){
  this.assertReady();
  if(typeof idValue!=='string')throw error('SI_CHECKLIST_CASE_ID_REQUIRED');
  const con=await this.connection();
  try{
   const found=await rows(con,'SELECT SNAPSHOT_JSON FROM SI_CHK_CASE_RUN WHERE CASE_ID=:id',
    {id:idValue});
   return {version:1,cases:found.length?{[idValue]:parse(found[0].SNAPSHOT_JSON)}:{}};
  }finally{await con.close();}
 }
 async save(state){
  this.assertReady();
  const entries=Object.values(state.cases||{});
  if(entries.length!==1)throw error('SI_CHECKLIST_CASE_SAVE_SCOPE_INVALID');
  const entry=entries[0];
  const con=await this.connection();
  try{
   const stored=await rows(con,'SELECT SNAPSHOT_JSON,VERSION_NO '+
    'FROM SI_CHK_CASE_RUN WHERE CASE_ID=:id FOR UPDATE',{id:entry.caseId});
   const prev=stored.length?parse(stored[0].SNAPSHOT_JSON):null;
   if(!prev){
    if(!initial(entry))throw error('SI_CHECKLIST_NOT_INITIALIZED',409);
    await con.execute(`INSERT INTO SI_CHK_CASE_RUN
     (RUN_ID,CASE_ID,STATUS,SNAPSHOT_JSON,VERSION_NO,STARTED_BY)
     VALUES(:id,:caseId,:status,:snapshot,:version,:actor)`,{
      id:entry.caseId,caseId:entry.caseId,status:entry.status,
      snapshot:json(entry),version:entry.version,actor:entry.createdBy});
   }else{
    if(Number(stored[0].VERSION_NO)!==entry.version-1)
     throw error('SI_CHECKLIST_VERSION_CONFLICT',409);
    const update=await con.execute(`UPDATE SI_CHK_CASE_RUN SET
     STATUS=:status,SNAPSHOT_JSON=:snapshot,VERSION_NO=:version,
     SUBMITTED_BY=:submittedBy,SUBMITTED_AT=CASE WHEN :submitted IS NULL
       THEN SUBMITTED_AT ELSE SYSTIMESTAMP END
     WHERE CASE_ID=:id AND VERSION_NO=:previous`,{
      status:entry.status,snapshot:json(entry),version:entry.version,
      submittedBy:entry.status==='SUBMITTED_FOR_REVIEW'?entry.updatedBy:null,
      submitted:entry.status==='SUBMITTED_FOR_REVIEW'?'Y':null,
      id:entry.caseId,previous:prev.version});
    if(update.rowsAffected!==1)throw error('SI_CHECKLIST_VERSION_CONFLICT',409);
   }
   await this._materialize(con,entry,prev);
   await con.commit();
  }catch(e){
   await con.rollback();
   if(e?.code==='ORA-00001')throw error('SI_CHECKLIST_VERSION_CONFLICT',409);
   throw e;
  }finally{await con.close();}
 }
 async _materialize(con,entry,prev){
  const oldAudits=prev?.audit?.length||0;
  for(const t of entry.templates){
   for(const g of t.groups){
    for(const it of g.items){
     const itId=versionItemId(t.templateId,t.revision,g.id,it.id);
     const binds={instance:caseItemOracleId(entry.caseId,it.instanceId),
       run:entry.caseId,item:itId,
       answer:json(it.answers||{}),status:it.answerStatus,
       actor:it.answeredBy||null};
     if(!prev){
      await con.execute(`INSERT INTO SI_CHK_CASE_ITEM
       (INSTANCE_ID,RUN_ID,ITEM_ID,ANSWERS_JSON,STATUS,ANSWERED_BY,ANSWERED_AT)
       VALUES(:instance,:run,:item,:answer,:status,:actor,
        CASE WHEN :actor2 IS NULL THEN NULL ELSE SYSTIMESTAMP END)`,
      {...binds,actor2:binds.actor});
     }else{
      await con.execute(`UPDATE SI_CHK_CASE_ITEM SET
        ANSWERS_JSON=:answer,STATUS=:status,ANSWERED_BY=:actor,
        ANSWERED_AT=CASE WHEN :actor2 IS NULL THEN NULL ELSE SYSTIMESTAMP END
        WHERE INSTANCE_ID=:instance AND RUN_ID=:run`,{
         answer:binds.answer,status:binds.status,actor:binds.actor,
         actor2:binds.actor,instance:binds.instance,run:binds.run});
     }
    }
   }
  }
  const oldProps=new Map((prev?.proposals||[]).map(p=>[p.id,p]));
  for(const proposal of entry.proposals||[]){
   const before=oldProps.get(proposal.id);
   let evidenceId=null;
   if(proposal.imageEvidenceRef){
    const e=proposal.imageEvidenceRef;
    evidenceId=e.id;
    if(!before?.imageEvidenceRef){
     const ext={'image/png':'.png','image/jpeg':'.jpg','image/webp':'.webp'}[e.mimeType];
     if(!ext)throw error('SI_CHECKLIST_IMAGE_TYPE_INVALID');
     await con.execute(`INSERT INTO SI_CHK_EVIDENCE
       (EVIDENCE_ID,RUN_ID,STORAGE_REFERENCE,CONTENT_SHA256,
        MIME_TYPE,BYTE_LENGTH,UPLOADED_BY)
       VALUES(:id,:run,:path,:hash,:mime,:size,:actor)`,{
       id:e.id,run:entry.caseId,
       path:'SI_CHECKLIST_EVIDENCE_PATH/'+entry.caseId+'/'+e.id+ext,
       hash:e.sha256,mime:e.mimeType,size:e.byteLength,actor:proposal.actor});
    }
   }
   if(!before){
    await con.execute(`INSERT INTO SI_CHK_AI_PROPOSAL
     (PROPOSAL_ID,RUN_ID,SCOPE_LEVEL,SCOPE_REFERENCE,INPUT_TEXT,
      EVIDENCE_ID,RESULT_JSON,REVIEW_STATUS,REQUESTED_BY)
     VALUES(:id,:run,:level,:scope,:input,:evidence,:result,:status,:actor)`,{
      id:proposal.id,run:entry.caseId,level:proposal.level,
      scope:(()=>{
       const key=proposal.scope.itemId||proposal.scope.groupId||
        proposal.scope.templateId||null;
       return key&&key.length>160?uuidFor('SI-CHK-AI-SCOPE-v1',entry.caseId,key):key;
      })(),
      input:proposal.inputText||null,evidence:evidenceId,
      result:json(proposal),status:proposal.status,actor:proposal.actor});
   }else if(before.status!==proposal.status){
    await con.execute(`UPDATE SI_CHK_AI_PROPOSAL SET REVIEW_STATUS=:status
      WHERE PROPOSAL_ID=:id`,{status:proposal.status,id:proposal.id});
   }
   for(const review of proposal.reviews?.slice(before?.reviews?.length||0)||[]){
    await con.execute(`INSERT INTO SI_CHK_AI_REVIEW
      (REVIEW_ID,PROPOSAL_ID,INSTANCE_ID,DECISION,FINAL_ANSWERS_JSON,
       REVIEW_NOTE,REVIEWED_BY)
      VALUES(:id,:proposal,:item,:decision,:answers,:note,:actor)`,{
       id:randomUUID(),proposal:proposal.id,
       item:caseItemOracleId(entry.caseId,review.itemId),
       decision:review.decision,answers:json(review.answers),
       note:review.note||null,actor:review.actor});
   }
  }
  for(const audit of entry.audit.slice(oldAudits)){
   await con.execute(`INSERT INTO SI_CHK_AUDIT
    (AUDIT_ID,RUN_ID,EVENT_TYPE,ACTOR,DETAILS_JSON)
    VALUES(:id,:run,:event,:actor,:doc)`,{
    id:auditId(),run:entry.caseId,event:audit.action,
    actor:audit.actor,doc:json(audit)});
  }
 }
 async importCase(entry){
  this.assertReady();
  if(!entry?.caseId||entry.version<1)throw error('SI_CHECKLIST_IMPORT_CASE_INVALID',422);
  const existing=await this.read(entry.caseId);
  if(existing.cases[entry.caseId]){
   if(JSON.stringify(existing.cases[entry.caseId])!==JSON.stringify(entry))
    throw error('SI_CHECKLIST_IMPORT_CASE_CONFLICT',409);
   return {skipped:true,id:entry.caseId};
  }
  // Historical data is inserted as a pinned snapshot, and projections receive
  // every historical review/evidence/audit in one transaction.
  const con=await this.connection();
  try{
   await con.execute(`INSERT INTO SI_CHK_CASE_RUN
    (RUN_ID,CASE_ID,STATUS,SNAPSHOT_JSON,VERSION_NO,STARTED_BY,
     SUBMITTED_BY,SUBMITTED_AT)
    VALUES(:id,:caseId,:status,:snapshot,:version,:actor,:submittedBy,
     CASE WHEN :submitted IS NULL THEN NULL ELSE SYSTIMESTAMP END)`,{
     id:entry.caseId,caseId:entry.caseId,status:entry.status,
     snapshot:json(entry),version:entry.version,actor:entry.createdBy,
     submittedBy:entry.status==='SUBMITTED_FOR_REVIEW'?entry.updatedBy:null,
     submitted:entry.status==='SUBMITTED_FOR_REVIEW'?'Y':null});
   await this._materialize(con,entry,null);
   await con.commit();return {imported:true,id:entry.caseId};
  }catch(e){await con.rollback();throw e;}finally{await con.close();}
 }
}
