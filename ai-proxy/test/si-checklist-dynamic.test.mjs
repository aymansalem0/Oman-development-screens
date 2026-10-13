import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SiChecklistLibrary,SiChecklistError} from '../si-checklist-library.mjs';
import {SiChecklistField,parseImage} from '../si-checklist-field.mjs';
import {SiChecklistAiria} from '../si-checklist-airia.mjs';

const uid='11111111-1111-4111-8111-111111111111';
function template(title,type,minGT,maxGT,source='NMC_CASE'){
 return {title,description:'Reviewed source',mandatory:true,
  applicability:{vesselTypes:[type],inspectionRegimes:[],sourceTypes:[source],
   minGT,maxGT,minDWT:null,maxDWT:null},
  ai:{enabled:true,instructions:'Check against recorded evidence.'},
  groups:[{id:'group',title:'Documents',ai:{enabled:true,instructions:'Compare source documents.'},
   items:[{id:'cert',title:'Certificate Validity',fields:['BOOLEAN','NOTE','EXPIRY_DATE'],
    mandatory:true,ai:{enabled:true,instructions:'Verify dates but never certify.'}}]}]};
}
function make(){
 const dir=mkdtempSync(join(tmpdir(),'moei-checklist-'));
 const library=new SiChecklistLibrary({file:join(dir,'library.json')});
 const vessel={imo:'9328471',name:'Tanker Alpha',vesselType:'Tanker',grossTonnage:15000};
 const inspectionCase={id:uid,imo:vessel.imo,status:'CREATED',regime:'FOCUSED_INSPECTION',
  inspectionReasons:[{sourceType:'NMC_CASE',eventKey:'case-one',sourceReference:'NMC-1'}]};
 const targeting={inspectionCase:async id=>id===uid?inspectionCase:null,
  bundles:[{imo:vessel.imo,inlineContext:{vessel}}]};
 const field=new SiChecklistField({library,targeting,
   file:join(dir,'field.json'),imageDirectory:join(dir,'images'),
   airiaSuggest:async()=>({recommendations:[]})});
 return {library,field,vessel,inspectionCase,dir,
  done:()=>rmSync(dir,{recursive:true,force:true})};
}
test('many published mandatory templates match one vessel by GT/type/source; revisions immutable',()=>{
 const x=make();try{
  const t1=x.library.create(template('Certificate checks','Tanker',10000,20000),'admin');
  const t2=x.library.create(template('Tanker safety','Tanker',8000,18000),'admin');
  const t3=x.library.create(template('Passenger only','Passenger',0,20000),'admin');
  const t4=x.library.create(template('Large GT','Tanker',30000,null),'admin');
  for(const t of [t1,t2,t3,t4])x.library.publish(t.id,'admin',t.updatedAt);
  let chosen=x.library.resolve({vessel:x.vessel,inspectionCase:x.inspectionCase});
  assert.deepEqual(chosen.templates.map(t=>t.title),['Certificate checks','Tanker safety']);
  assert.equal(chosen.templates.every(t=>t.mandatory),true);
  assert.deepEqual(chosen.templates[0].groups[0].items[0].fields,
   ['BOOLEAN','NOTE','EXPIRY_DATE']);
  const older=x.library.get(t1.id);
  const updated=x.library.edit(t1.id,{...older.draft,title:'New wording',
   expectedUpdatedAt:older.updatedAt,expectedRevision:1},'admin');
  assert.equal(updated.published[0].title,'Certificate checks','published revision frozen');
  assert.equal(x.library.resolve({vessel:x.vessel,inspectionCase:x.inspectionCase}).templates[0].title,
   'Certificate checks','draft updates never change active field rules');
 }finally{x.done();}
});
test('unknown GT never silently matches tonnage-conditional mandatory template',()=>{
 const x=make();try{
  const t=x.library.create(template('GT-dependent','Tanker',10000,25000),'admin');
  x.library.publish(t.id,'admin',t.updatedAt);
  const result=x.library.resolve({vessel:{...x.vessel,grossTonnage:null},
   inspectionCase:x.inspectionCase});
  assert.equal(result.templates.length,0);
  assert.deepEqual(result.warnings[0].missing,['GT_UNKNOWN']);
 }finally{x.done();}
});
test('case snapshot uses matching templates and saves inspector answers with pinned revision',async()=>{
 const x=make();try{
  for(const t of [template('A','Tanker',0,20000),template('B','Tanker',0,20000)]){
   const d=x.library.create(t,'admin');x.library.publish(d.id,'admin',d.updatedAt);
  }
  const read=await x.field.preview(uid);
  assert.equal(read.selectedTemplates.length,2);
  assert.equal(read.saved,null);
  const session=await x.field.start(uid,'inspector');
  assert.equal(session.templates.length,2);
  assert.notEqual(session.templates[0].groups[0].items[0].instanceId,
    session.templates[1].groups[0].items[0].instanceId);
  await assert.rejects(x.field.complete(uid,{expectedVersion:session.version,actor:'inspector'}),
   /SI_CHECKLIST_MANDATORY_ANSWERS_MISSING/);
  const answers=session.templates.map(t=>({itemId:t.groups[0].items[0].instanceId,
   values:{BOOLEAN:'YES',NOTE:'Reviewed',EXPIRY_DATE:'2027-10-12'}}));
  const saved=await x.field.saveAnswers(uid,{expectedVersion:1,actor:'inspector',answers});
  assert.equal(saved.version,2);
  await assert.rejects(x.field.saveAnswers(uid,{expectedVersion:1,actor:'inspector',answers}),
   /SI_CHECKLIST_VERSION_CONFLICT/);
  const submitted=await x.field.complete(uid,{expectedVersion:2,actor:'inspector'});
  assert.equal(submitted.status,'SUBMITTED_FOR_REVIEW');
  assert.equal((await x.field.ensureSubmitted(uid)).required,true);
 }finally{x.done();}
});
test('AI image/text advice remains pending until human ACCEPT, EDIT or REJECT',async()=>{
 const x=make();try{
  const t=x.library.create(template('Evidence','Tanker',0,50000),'admin');
  x.library.publish(t.id,'admin',t.updatedAt);
  const session=await x.field.start(uid,'inspector');
  const item=session.templates[0].groups[0].items[0];
  const png='iVBORw0KGgo='; // valid PNG signature-only POC transport test
  x.field.airiaSuggest=async input=>{
   assert.equal(input.level,'ITEM');
   assert.equal(input.operatorInput,'Review expiry label');
   assert.equal(input.image.mimeType,'image/png');
   return {recommendations:[{itemId:item.instanceId,
    answers:{BOOLEAN:'NO',NOTE:'Expiration visible on image',EXPIRY_DATE:'2024-01-01'},
    rationale:'The supplied image seems to show an old expiry label; verify on board.',
    confidence:.61,dataGaps:['Unverified document authenticity']}]};
  };
  const suggestion=await x.field.suggest(uid,{level:'ITEM',itemId:item.instanceId,
   text:'Review expiry label',image:{mimeType:'image/png',base64:png},
   actor:'inspector',confirmCost:true});
  assert.equal(suggestion.proposal.status,'DRAFT_INSPECTOR_REVIEW_REQUIRED');
  assert.equal((await x.field.preview(uid)).saved.templates[0].groups[0].items[0].answerStatus,
   'PENDING','model never autofills inspection');
  const reviewed=await x.field.review(uid,{
   expectedVersion:suggestion.version,proposalId:suggestion.proposal.id,
   itemId:item.instanceId,decision:'EDIT',
   editedAnswers:{BOOLEAN:'YES',NOTE:'Inspector validated original certificate',
    EXPIRY_DATE:'2028-01-01'},actor:'inspector'});
  const saved=reviewed.templates[0].groups[0].items[0];
  assert.equal(saved.answers.BOOLEAN,'YES','inspector edit overrides model');
  assert.equal(saved.evidenceRefs.length,1,'private photo evidence linked on acceptance');
  assert.equal(reviewed.proposals[0].reviews[0].decision,'EDIT');
 }finally{x.done();}
});
test('Airia requires explicit real pipeline; never uses fixtures as live image analysis',async()=>{
 const ai=new SiChecklistAiria({enabled:true,apiKey:'ci-key'});
 await assert.rejects(ai.call('vision',{schemaVersion:'SI-CHECKLIST-REVIEW-v1'}),
  /SI_CHECKLIST_AIRIA_PIPELINE_NOT_CONFIGURED/);
 const sent=[];
 const configured=new SiChecklistAiria({enabled:true,apiKey:'ci-key',
  builderPipelineId:'some-builder-pipeline',
  transport:async(url,options)=>{
   sent.push({url,body:JSON.parse(options.body),key:options.headers['X-API-KEY']});
   return {ok:true,json:async()=>({result:{suggestedItems:[{
    title:'Verify certificate',fields:['BOOLEAN','EXPIRY_DATE']} ]}})};
  }});
 const result=await configured.suggestSettings({level:'TEMPLATE',
  template:{title:'Tanker checklist'},operatorPrompt:'Suggest relevant checks'});
 assert.equal(sent.length,1);
 assert.equal(result.status,'DRAFT_REQUIRES_ADMIN_REVIEW');
 assert.equal(result.suggestedItems.length,1);
 assert.equal(result.noRegulatoryVerification,true);
});
test('image parser rejects mislabeled or oversize data',()=>{
 assert.throws(()=>parseImage({mimeType:'image/png',base64:'aGVsbG8='}),
  /SI_CHECKLIST_IMAGE_FORMAT_INVALID/);
 assert.equal(parseImage(null),null);
});
