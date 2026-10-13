import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {OracleSiChecklistLibrary,OracleSiChecklistField} from '../si-checklist-oracle.mjs';
const uuid='11111111-1111-4111-8111-111111111111';
const clone=x=>structuredClone(x);
class MemoryOracle{
 constructor(){this.templates=new Map();this.revisions=new Map();this.cases=new Map();this.log=[];
  this.pool={getConnection:async()=>new MockConnection(this)};}
}
class MockConnection{
 constructor(db){this.db=db;}
 async execute(sql,b={}){
  const c=sql.replace(/\s+/g,' ').trim().toUpperCase();
  this.db.log.push({sql:c,binds:clone(b)});
  const obj=r=>({rows:r});
  if(c.startsWith('SELECT TABLE_NAME FROM USER_TABLES'))
   return obj(['SI_CHK_MD_GROUP','SI_CHK_MD_VALUE','SI_CHK_TEMPLATE',
    'SI_CHK_REVISION','SI_CHK_APPLICABILITY','SI_CHK_GROUP','SI_CHK_ITEM',
    'SI_CHK_ITEM_FIELD','SI_CHK_CASE_RUN','SI_CHK_CASE_ITEM','SI_CHK_EVIDENCE',
    'SI_CHK_AI_PROPOSAL','SI_CHK_AI_REVIEW','SI_CHK_AUDIT'].map(TABLE_NAME=>({TABLE_NAME})));
  if(c.startsWith('SELECT TEMPLATE_ID FROM SI_CHK_TEMPLATE'))
   return obj([...this.db.templates.keys()].map(TEMPLATE_ID=>({TEMPLATE_ID})));
  if(c.startsWith('SELECT DRAFT_JSON FROM SI_CHK_TEMPLATE WHERE TEMPLATE_ID'))
   return obj(this.db.templates.has(b.id)?[{DRAFT_JSON:JSON.stringify(this.db.templates.get(b.id))}]:[]);
  if(c.startsWith('SELECT DRAFT_JSON FROM SI_CHK_TEMPLATE'))
   return obj([...this.db.templates.values()].map(x=>({DRAFT_JSON:JSON.stringify(x)})));
  if(c.startsWith('INSERT INTO SI_CHK_TEMPLATE')){
   const t=JSON.parse(b.doc.val);this.db.templates.set(t.id,t);return {rowsAffected:1};}
  if(c.startsWith('UPDATE SI_CHK_TEMPLATE')){
   const t=JSON.parse(b.doc.val);this.db.templates.set(t.id,t);return {rowsAffected:1};}
  if(c.startsWith('INSERT INTO SI_CHK_REVISION')){
   this.db.revisions.set(b.template+':'+b.revision,JSON.parse(b.snapshot.val));
   return {rowsAffected:1};
  }
  if(c.startsWith('SELECT R.TEMPLATE_ID,R.REVISION_NO,R.SNAPSHOT_JSON')){
   return obj([...this.db.templates.values()].filter(x=>x.revision>0).map(x=>({
    TEMPLATE_ID:x.id,REVISION_NO:x.revision,
    SNAPSHOT_JSON:JSON.stringify(this.db.revisions.get(x.id+':'+x.revision))})));
  }
  if(c.startsWith('SELECT CASE_ID FROM SI_CHK_CASE_RUN'))
   return obj([...this.db.cases.keys()].map(CASE_ID=>({CASE_ID})));
  if(c.startsWith('SELECT SNAPSHOT_JSON,VERSION_NO FROM SI_CHK_CASE_RUN')){
   const entry=this.db.cases.get(b.id);
   return obj(entry?[{SNAPSHOT_JSON:JSON.stringify(entry),VERSION_NO:entry.version}]:[]);
  }
  if(c.startsWith('SELECT SNAPSHOT_JSON FROM SI_CHK_CASE_RUN')){
   const entry=this.db.cases.get(b.id);
   return obj(entry?[{SNAPSHOT_JSON:JSON.stringify(entry)}]:[]);
  }
  if(c.startsWith('INSERT INTO SI_CHK_CASE_RUN')){
   const e=JSON.parse(b.snapshot.val);this.db.cases.set(e.caseId,e);
   return {rowsAffected:1};
  }
  if(c.startsWith('UPDATE SI_CHK_CASE_RUN')){
   const existing=this.db.cases.get(b.id);
   if(!existing||existing.version!==b.previous)return {rowsAffected:0};
   this.db.cases.set(b.id,JSON.parse(b.snapshot.val));return {rowsAffected:1};
  }
  if(c.startsWith('SELECT CASE_ID FROM SI_INSPECTION_CASE'))return obj([{CASE_ID:uuid}]);
  if(c.startsWith('SELECT'))throw new Error('MOCK_UNEXPECTED_SELECT '+c.slice(0,100));
  return {rowsAffected:1};
 }
 async commit(){}async rollback(){}async close(){}
}
function t(name='Tanker Safety and Certification'){
 return {title:name,description:'Proposed non-statutory test template',mandatory:true,
  applicability:{vesselTypes:['Tanker'],inspectionRegimes:[],sourceTypes:['NMC_CASE'],
   minGT:10000,maxGT:80000,minDWT:null,maxDWT:null},
  groups:[{id:'docs',title:'Documents',ai:{enabled:true,
   instructions:'Review only verified evidence.'},items:[{id:'fire-cert',
   title:'Is Fire Safety Certificate valid?',mandatory:true,
   fields:['BOOLEAN','NOTE','EXPIRY_DATE'],requiredFields:['BOOLEAN','EXPIRY_DATE'],
   ai:{enabled:true,instructions:'Review date, do not certify.'}}]}]};
}
function rig(){
 const dir=mkdtempSync(join(tmpdir(),'si-oracle-'));
 const db=new MemoryOracle(),oracle={pool:db.pool};
 const library=new OracleSiChecklistLibrary({oracle,jsonFile:join(dir,'library.json')});
 const vessel={imo:'9328471',vesselType:'Tanker',grossTonnage:52400};
 const inspectionCase={id:uuid,imo:vessel.imo,status:'CREATED',
  regimes:['FOCUSED_INSPECTION'],inspectionReasons:[{sourceType:'NMC_CASE'}]};
 const field=new OracleSiChecklistField({oracle,library,
  targeting:{inspectionCase:async id=>id===uuid?inspectionCase:null,
   bundles:[{imo:vessel.imo,inlineContext:{vessel}}]},
  imageDirectory:join(dir,'images'),file:join(dir,'field.json'),
  airiaSuggest:async()=>({recommendations:[]})});
 return {db,library,field,vessel,inspectionCase,dir,
  done:()=>rmSync(dir,{recursive:true,force:true})};
}
test('Oracle 017 templates preserve revisions, applicability, group, item and typed field relations',async()=>{
 const x=rig();try{
  await x.library.initialize();await x.field.initialize();
  const v=await x.library.create(t(),'admin');
  assert.equal(v.revision,0);
  assert.equal((await x.library.list()).length,1);
  const pub=await x.library.publish(v.id,'admin',v.updatedAt);
  assert.equal(pub.revision,1);
  const resolved=await x.library.resolve({vessel:x.vessel,inspectionCase:x.inspectionCase});
  assert.equal(resolved.templates.length,1);
  assert.equal(resolved.templates[0].groups[0].items[0].fields.length,3);
  assert.ok(x.db.log.some(q=>q.sql.startsWith('INSERT INTO SI_CHK_REVISION')));
  assert.ok(x.db.log.some(q=>q.sql.startsWith('INSERT INTO SI_CHK_ITEM_FIELD')));
  assert.ok(x.db.log.some(q=>q.sql.startsWith('INSERT INTO SI_CHK_APPLICABILITY')));
  const mod=await x.library.edit(v.id,{...pub.draft,title:'Edited draft',
   expectedRevision:pub.revision,expectedUpdatedAt:pub.updatedAt},'admin');
  assert.equal((await x.library.resolve({vessel:x.vessel,
   inspectionCase:x.inspectionCase})).templates[0].title,t().title,
   'draft never changes published revision');
  assert.equal(mod.published[0].title,t().title);
 }finally{x.done();}
});
test('Oracle case snapshot is immutable per revision; typed answers, AI review and audit are transactional',async()=>{
 const x=rig();try{
  await x.library.initialize();await x.field.initialize();
  const a=await x.library.create(t(),'admin');
  await x.library.publish(a.id,'admin',a.updatedAt);
  const entry=await x.field.start(uuid,'inspector');
  assert.equal(entry.templates.length,1);
  assert.equal(entry.version,1);
  const item=entry.templates[0].groups[0].items[0];
  await assert.rejects(x.field.complete(uuid,{expectedVersion:1,actor:'inspector'}),
   /SI_CHECKLIST_MANDATORY_ANSWERS_MISSING/);
  const saved=await x.field.saveAnswers(uuid,{expectedVersion:1,actor:'inspector',
   answers:[{itemId:item.instanceId,values:{
    BOOLEAN:'YES',NOTE:'Inspected on board',EXPIRY_DATE:'2027-10-12'}}]});
  assert.equal(saved.version,2);
  await assert.rejects(x.field.saveAnswers(uuid,{expectedVersion:1,actor:'inspector',
   answers:[{itemId:item.instanceId,values:{BOOLEAN:'NO'}}]}),
   /SI_CHECKLIST_VERSION_CONFLICT/);
  const submit=await x.field.complete(uuid,{expectedVersion:2,actor:'inspector'});
  assert.equal(submit.status,'SUBMITTED_FOR_REVIEW');
  assert.equal((await x.field.ensureSubmitted(uuid)).required,true);
  assert.equal((await x.field.preview(uuid)).saved.version,3);
  assert.ok(x.db.log.some(q=>q.sql.startsWith('INSERT INTO SI_CHK_CASE_ITEM')));
  assert.ok(x.db.log.some(q=>q.sql.startsWith('UPDATE SI_CHK_CASE_ITEM')));
  assert.ok(x.db.log.some(q=>q.sql.startsWith('INSERT INTO SI_CHK_AUDIT')));
  assert.equal(x.db.cases.get(uuid).version,3);
 }finally{x.done();}
});
test('Never silently switch existing /data JSON templates or inspector cases to empty Oracle',async()=>{
 const x=rig();try{
  writeFileSync(join(x.dir,'library.json'),JSON.stringify({version:1,
   templates:[{id:uuid}]}));
  await assert.rejects(x.library.initialize(),/SI_CHECKLIST_LEGACY_LIBRARY_IMPORT_REQUIRED/);
  writeFileSync(join(x.dir,'library.json'),JSON.stringify({version:1,templates:[]}));
  await x.library.initialize();
  writeFileSync(join(x.dir,'field.json'),JSON.stringify({version:1,cases:{
   [uuid]:{caseId:uuid}}}));
  await assert.rejects(x.field.initialize(),/SI_CHECKLIST_LEGACY_CASE_IMPORT_REQUIRED/);
 }finally{x.done();}
});

test('Oracle captures Airia candidate and photo reference; inspector edits before answers are accepted',async()=>{
 const x=rig();try{
  await x.library.initialize();await x.field.initialize();
  const t0=await x.library.create(t('AI evidence'),'admin');
  await x.library.publish(t0.id,'admin',t0.updatedAt);
  const started=await x.field.start(uuid,'inspector');
  const item=started.templates[0].groups[0].items[0];
  x.field.airiaSuggest=async()=>({recommendations:[{
   itemId:item.instanceId,answers:{BOOLEAN:'NO',NOTE:'Visible expiry date',
    EXPIRY_DATE:'2023-01-01'},
   rationale:'Photo appears to show a past expiry date, human verification required.',
   confidence:0.73,dataGaps:['Official document authenticity unknown']}]});
  const proposed=await x.field.suggest(uuid,{level:'ITEM',itemId:item.instanceId,
   text:'Review certificate',image:{mimeType:'image/png',base64:'iVBORw0KGgo='},
   actor:'inspector',confirmCost:true});
  assert.equal((await x.field.preview(uuid)).saved.templates[0].groups[0].items[0]
    .answers.BOOLEAN,undefined,'AI must not modify official answer');
  assert.ok(x.db.log.some(q=>q.sql.startsWith('INSERT INTO SI_CHK_EVIDENCE')));
  assert.ok(x.db.log.some(q=>q.sql.startsWith('INSERT INTO SI_CHK_AI_PROPOSAL')));
  const accepted=await x.field.review(uuid,{expectedVersion:proposed.version,
   proposalId:proposed.proposal.id,itemId:item.instanceId,
   decision:'EDIT',editedAnswers:{BOOLEAN:'YES',EXPIRY_DATE:'2028-01-01',
    NOTE:'Inspector verified original document'},actor:'inspector',
   reviewNote:'Checked original on board'});
  assert.equal(accepted.templates[0].groups[0].items[0].answers.BOOLEAN,'YES');
  assert.ok(x.db.log.some(q=>q.sql.startsWith('INSERT INTO SI_CHK_AI_REVIEW')));
  assert.ok(x.db.log.some(q=>q.sql.startsWith('UPDATE SI_CHK_AI_PROPOSAL')));
 }finally{x.done();}
});
