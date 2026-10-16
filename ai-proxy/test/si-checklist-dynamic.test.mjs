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
test('MOEI 420-vessel fixture strings in GT / DWT units select correct rules',()=>{
 const x=make();try{
  const t=x.library.create({...template('Actual tanker range','Tanker',42000,66000),
    applicability:{...template('Actual tanker range','Tanker',42000,66000).applicability,
      minDWT:76000,maxDWT:130000}},'admin');
  x.library.publish(t.id,'admin',t.updatedAt);
  const selection=x.library.resolve({
    vessel:{...x.vessel,grossTonnage:'52,400 GT',deadweight:'93,500 DWT'},
    inspectionCase:x.inspectionCase
  });
  assert.equal(selection.vessel.grossTonnage,52400);
  assert.equal(selection.vessel.deadweightTonnage,93500);
  assert.equal(selection.templates.length,1);
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

test('per-question PDF and image evidence is persisted without calling AI and no official answer changes',async()=>{
 const x=make();
 try{
  const t=x.library.create(template('Safety evidence','Tanker',0,50000),'admin');
  x.library.publish(t.id,'admin',t.updatedAt);
  const session=await x.field.start(uid,'inspector');
  const item=session.templates[0].groups[0].items[0];
  let calls=0;
  x.field.airiaSuggest=async()=>{calls++;return {recommendations:[]};};
  const png='iVBORw0KGgo=';
  const image=await x.field.attachEvidence(uid,{itemId:item.instanceId,
   expectedVersion:session.version,actor:'inspector',file:{
    filename:'equipment-photo.png',mimeType:'image/png',base64:png
   }});
  assert.equal(image.evidence.mimeType,'image/png');
  assert.equal(image.evidence.aiAnalyzed,false);
  assert.equal(calls,0);
  const pdf=await x.field.attachEvidence(uid,{itemId:item.instanceId,
   expectedVersion:image.version,actor:'inspector',file:{
    filename:'maintenance-record.pdf',mimeType:'application/pdf',
    base64:Buffer.from('%PDF-1.7\\nPOC').toString('base64')
   }});
  const downloaded=await x.field.downloadEvidence(uid,image.evidence.id);
  assert.equal(downloaded.mimeType,'image/png');
  assert.equal(downloaded.bytes.toString('base64'),png);
  const downloadedPdf=await x.field.downloadEvidence(uid,pdf.evidence.id);
  assert.equal(downloadedPdf.mimeType,'application/pdf');
  assert.match(downloadedPdf.bytes.toString(),/^%PDF-/);
  await assert.rejects(x.field.downloadEvidence(uid,
    '99999999-9999-4999-8999-999999999999'),
    /SI_CHECKLIST_EVIDENCE_NOT_FOUND/);
  const state=(await x.field.preview(uid)).saved;
  assert.equal(state.evidenceFiles.length,2);
  assert.equal(state.templates[0].groups[0].items[0].evidenceRefs.length,2);
  assert.deepEqual(state.templates[0].groups[0].items[0].answers,{});
  assert.equal(calls,0,'GET and file upload are zero-cost');
  await assert.rejects(x.field.attachEvidence(uid,{itemId:item.instanceId,
    expectedVersion:session.version,actor:'inspector',
    file:{filename:'stale.png',mimeType:'image/png',base64:png}}),
   /SI_CHECKLIST_VERSION_CONFLICT/);
  await assert.rejects(x.field.attachEvidence(uid,{itemId:item.instanceId,
    expectedVersion:pdf.version,actor:'inspector',
    file:{filename:'fake.pdf',mimeType:'application/pdf',base64:png}}),
   /SI_CHECKLIST_EVIDENCE_FORMAT_INVALID/);
  assert.equal((await x.field.preview(uid)).saved.evidenceFiles.length,2);
 }finally{x.done();}
});

test('Airia analyses only the photo linked to the question, returns optional instruction and waits for human review',async()=>{
 const x=make();
 try{
  const draft=x.library.create(template('Visual Safety','Tanker',0,50000),'admin');
  x.library.publish(draft.id,'admin',draft.updatedAt);
  const entry=await x.field.start(uid,'inspector');
  const item=entry.templates[0].groups[0].items[0];
  const photo=await x.field.attachEvidence(uid,{itemId:item.instanceId,
   expectedVersion:entry.version,actor:'inspector',file:{
    filename:'certificate.png',mimeType:'image/png',base64:'iVBORw0KGgo='
   }});
  let calls=0;
  x.field.airiaSuggest=async input=>{
   calls++;
   assert.equal(input.level,'ITEM');
   assert.equal(input.items.length,1);
   assert.equal(input.image.mimeType,'image/png');
   assert.equal(input.image.sha256,photo.evidence.sha256);
   assert.equal(input.image.base64,'iVBORw0KGgo=');
   assert.match(input.instructions,/suggestedInstruction/);
   return {result:JSON.stringify({recommendations:[{
    itemId:item.instanceId,answers:{BOOLEAN:'NO',NOTE:'Text appears blurred'},
    rationale:'The photographed certificate is too blurred for reliable verification.',
    suggestedInstruction:'Inspect the original statutory certificate and cross-check the expiry date with the issuing source.',
    confidence:.47,dataGaps:['Original certificate is not readable']
   }]})};
  };
  const result=await x.field.suggest(uid,{level:'ITEM',itemId:item.instanceId,
   evidenceId:photo.evidence.id,actor:'inspector',confirmCost:true});
  assert.equal(calls,1);
  assert.equal(result.proposal.imageEvidenceRef.id,photo.evidence.id);
  assert.match(result.proposal.recommendations[0].suggestedInstruction,/original statutory certificate/);
  assert.equal((await x.field.preview(uid)).saved.templates[0].groups[0].items[0].answerStatus,'PENDING');
  assert.equal((await x.field.preview(uid)).saved.evidenceFiles.length,1);
  await assert.rejects(x.field.suggest(uid,{level:'ITEM',itemId:item.instanceId,
   evidenceId:'99999999-9999-4999-8999-999999999999',
   actor:'inspector',confirmCost:true}),
   /SI_CHECKLIST_AI_IMAGE_NOT_LINKED_TO_QUESTION/);
  assert.equal(calls,1,'Invalid evidence never incurs a model call');
  const accepted=await x.field.review(uid,{expectedVersion:result.version,
   proposalId:result.proposal.id,itemId:item.instanceId,
   decision:'REJECT',actor:'inspector'});
  assert.deepEqual(accepted.templates[0].groups[0].items[0].answers,{});
  assert.equal(accepted.proposals[0].reviews[0].decision,'REJECT');
 }finally{x.done();}
});

test('Airia builder generates isolated optional questions, each with evidence, photo-based suggested answer and instruction',async()=>{
 const x=make();
 try{
  const t=x.library.create(template('Frozen baseline','Tanker',0,50000),'admin');
  x.library.publish(t.id,'admin',t.updatedAt);
  const session=await x.field.start(uid,'inspector');
  const original=JSON.stringify(session.templates);
  let builderCalls=0,visionCalls=0;
  x.field.airiaQuestionSuggest=async input=>{
   builderCalls++;
   assert.equal(input.caseId,uid);
   assert.equal(input.constraints.mandatory,false);
   return {suggestedItems:[{
    title:'Verify auxiliary fire-control station readiness',
    description:'Inspect readiness during the planned site visit.',
    rationale:'The optional review may improve fire equipment coverage.',
    suggestedInstruction:'Inspect the station safely and collect photographic evidence.',
    confidence:0.79
   }]};
  };
  const suggested=await x.field.suggestQuestions(uid,{
   actor:'inspector',confirmCost:true,operatorPrompt:'Suggest a fire station check'
  });
  assert.equal(builderCalls,1);
  assert.equal(suggested.questions.length,1);
  assert.equal(suggested.questions[0].mandatory,false);
  assert.equal(suggested.questions[0].officialChecklistItem,false);
  assert.equal((await x.field.preview(uid)).saved.templates.length,1);
  assert.equal(JSON.stringify((await x.field.preview(uid)).saved.templates),original);
  const q=suggested.questions[0];
  const photo=await x.field.attachEvidence(uid,{actor:'inspector',
   itemId:q.id,expectedVersion:suggested.version,file:{
    filename:'station.png',mimeType:'image/png',base64:'iVBORw0KGgo='
   }});
  x.field.airiaSuggest=async input=>{
   visionCalls++;
   assert.equal(input.items[0].itemId,q.id);
   assert.equal(input.image.sha256,photo.evidence.sha256);
   return {recommendations:[{
    itemId:q.id,
    answers:{BOOLEAN:'NO',NOTE:'Possible obstruction; verify physically'},
    rationale:'The attached photo appears to show an obstruction; image is not proof.',
    suggestedInstruction:'Inspect access and fire suppression controls in person and record actual conditions.',
    confidence:0.53,dataGaps:['Unclear field of view']
   }]};
  };
  const advisory=await x.field.suggestAdvisoryAnswer(uid,{
   questionId:q.id,evidenceId:photo.evidence.id,
   text:'Inspect only shown evidence',actor:'inspector',confirmCost:true
  });
  assert.equal(visionCalls,1);
  assert.equal(advisory.proposal.recommendations[0].proposedAnswers.BOOLEAN,'NO');
  assert.match(advisory.proposal.recommendations[0].suggestedInstruction,/in person/);
  const before=(await x.field.preview(uid)).saved;
  assert.equal(before.aiSuggestedQuestions[0].finalAdvisory,null);
  assert.equal(JSON.stringify(before.templates),original);
  const reviewed=await x.field.reviewAdvisoryAnswer(uid,{
   expectedVersion:advisory.version,questionId:q.id,proposalId:advisory.proposal.id,
   decision:'EDIT',editedAnswers:{BOOLEAN:'NA',NOTE:'Photo not conclusive'},
   reviewNote:'Actual onboard evidence required',actor:'inspector'
  });
  assert.equal(reviewed.aiSuggestedQuestions[0].finalAdvisory.answers.BOOLEAN,'NA');
  assert.equal(reviewed.aiSuggestedQuestions[0].finalAdvisory.officialComplianceDecision,false);
  assert.equal(JSON.stringify(reviewed.templates),original);
  assert.equal(reviewed.status,'IN_PROGRESS');
 }finally{x.done();}
});

test('A04 advisory import demands source-approved overlay, is idempotent and never calls a model',async()=>{
 const x=make();
 try{
  const t=x.library.create(template('Published','Tanker',0,50000),'admin');
  x.library.publish(t.id,'admin',t.updatedAt);
  const session=await x.field.start(uid,'inspector');
  x.field.getA04Suggestions=async()=>({approved:false,suggestions:[{
    title:'A04 extra safety question',reason:'Review evidence in field'
   }]});
  await assert.rejects(x.field.importA04Questions(uid,{
   expectedVersion:session.version,actor:'inspector'
  }),/SI_CHECKLIST_A04_SCOPE_NOT_APPROVED/);
  x.field.getA04Suggestions=async()=>({approved:true,suggestions:[{
    title:'A04 extra safety question',reason:'Verify recorded safety references',
    evidenceIds:['SI-CASE-001']
   }]});
  const imported=await x.field.importA04Questions(uid,{
   expectedVersion:session.version,actor:'inspector'
  });
  assert.equal(imported.imported,1);
  assert.equal(imported.questions[0].source,'AIRIA_A04');
  assert.equal(imported.questions[0].officialChecklistItem,false);
  const repeated=await x.field.importA04Questions(uid,{
   expectedVersion:imported.version,actor:'inspector'
  });
  assert.equal(repeated.imported,0);
  assert.equal(repeated.version,imported.version);
  assert.equal((await x.field.preview(uid)).saved.aiSuggestedQuestions.length,1);
 }finally{x.done();}
});


test('Airia Vision adapter emits exactly one question-bound multipart photo, keeps typed answer and AI instruction advisory',async()=>{
 const key='test-only-airia-key';
 let uploads=0;
 const provider=new SiChecklistAiria({
  enabled:true,apiKey:key,
  visionPipelineId:'11111111-1111-4111-8111-111111111119',
  transport:async(url,options)=>{
   uploads++;
   assert.match(url,/\/v1\/PipelineExecution\/Multipart\/11111111-1111-4111-8111-111111111119$/);
   assert.equal(options.headers['X-API-KEY'],key);
   assert.equal(options.headers['Content-Type'],undefined,'multipart boundary created by FormData');
   assert.equal(options.body.constructor.name,'FormData');
   const metadata=JSON.parse(options.body.get('userInput'));
   assert.equal(metadata.caseId,uid);
   assert.equal(metadata.items.length,1);
   assert.equal(metadata.items[0].itemId,'Q-ONLY');
   assert.equal(metadata.image.sha256,'a'.repeat(64));
   assert.equal(metadata.image.base64,undefined,'image bytes must travel in file field only');
   const attached=options.body.get('file');
   assert.equal(attached.type,'image/png');
   assert.equal(attached.size,8);
   return {ok:true,json:async()=>({response:JSON.stringify({
    recommendations:[{
      itemId:'Q-ONLY',answers:{BOOLEAN:'NO',NOTE:'Review this observation'},
      confidence:0.62,rationale:'Photo suggests a possible issue; not regulatory proof.',
      suggestedInstruction:'Inspect this equipment aboard and compare original certification.',
      dataGaps:['Certificate source not confirmed']
    }]
   })})};
  }
 });
 const result=await provider.call('vision',{
  schemaVersion:'SI-CHECKLIST-REVIEW-v1',caseId:uid,
  items:[{itemId:'Q-ONLY',title:'Auxiliary safety check',mandatory:false}],
  image:{mimeType:'image/png',sha256:'a'.repeat(64),base64:'iVBORw0KGgo='}
 });
 assert.equal(uploads,1);
 assert.equal(result.recommendations[0].answers.BOOLEAN,'NO');
 assert.match(result.recommendations[0].suggestedInstruction,/Inspect this equipment/);
 assert.ok(result.recommendations[0].dataGaps.length);
});
