import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildSiSupervisorFullReport} from '../si-supervisor-report.mjs';
import {syncSiSupervisorReviewToNmc} from '../si-nmc-review-sync.mjs';
import {SiRegulatoryDrafts} from '../si-supervisor-regulatory-drafts.mjs';
const caseId='f1111111-1111-4111-8111-111111111111';
const nmcId='f2222222-2222-4222-8222-222222222222';
const referral='f3333333-3333-4333-8333-333333333333';
const reportId='f4444444-4444-4444-8444-444444444444';
const view={
 inspectionCase:{id:caseId,imo:'9400631',regime:'PSC',nmcReferralId:referral,nmcCaseId:nmcId},
 record:{caseId,imo:'9400631',stage:'REPORT_APPROVED',checks:[
  {id:'fire-safety',status:'PASS',note:'checked',evidenceRefs:['PHOTO-1']},
  {id:'certificates',status:'DEFICIENCY',note:'certificate missing',
    severity:'MAJOR',evidenceRefs:['DOC-1']}],
  report:{id:reportId,status:'APPROVED',summary:'Inspected two checks',
    supervisor:'supervisor@example.test',submittedBy:'inspector@example.test'},
  findings:[{id:'f-1',severity:'MAJOR'}],actions:[],followUps:[],audit:[]
 },nmcBooking:{id:referral,status:'SCHEDULED'}
};
test('Supervisor joins lifecycle checks and dynamic question answers without inventing findings',()=>{
 const full=buildSiSupervisorFullReport({view,dossier:{
  status:'SOURCE_GROUNDED_VESSEL_DOSSIER',sections:{identity:{imo:'9400631',flag:'AE'}},
  missingEvidence:['SOURCE_NOT_VERIFIED']
 },checklist:{status:'ok',saved:{status:'SUBMITTED',
  evidenceFiles:[{id:'PHOTO-1',filename:'engine.png',mimeType:'image/png'}],
  templates:[{templateId:'T1',title:'Published PSC',
    groups:[{title:'Safety',items:[{id:'I1',title:'Fire Safety',answerStatus:'RECORDED',
      answers:{BOOLEAN:'YES'},evidenceRefs:['PHOTO-1'],answeredBy:'inspector'}]}]}]}}});
 assert.equal(full.inspector.checks.length,2);
 assert.equal(full.inspector.counts.deficiencies,1);
 assert.equal(full.inspector.publishedChecklist.length,1);
 assert.equal(full.inspector.publishedChecklist[0].answers.BOOLEAN,'YES');
 assert.equal(full.inspector.evidenceFiles[0].id,'PHOTO-1');
 assert.equal(full.dossier.sections.identity.flag,'AE');
 assert.equal(full.regulatory.transmissionStatus,'NOT_SUBMITTED');
 assert.equal(full.nmc.linked,true);
});
test('NMC receives human-approved report exactly once; wrong vessel or referral refused',async()=>{
 let writes=0;
 const nmc={id:nmcId,imo:'9400631',status:'IN_PROGRESS',version:3,
  inspectionRequests:[{id:referral}],inspectionReviewHistory:[]};
 const cases={
  async list(){return [nmc]},
  async inspectionReview(id,version,decision,actor){
   writes++;assert.equal(id,nmcId);assert.equal(version,3);
   assert.equal(decision.decision,'APPROVED');assert.equal(actor,'SI_SUPERVISOR');
   return {...nmc,id};
  }
 };
 const first=await syncSiSupervisorReviewToNmc({
  caseId,inspectionCase:view.inspectionCase,record:view.record,cases});
 assert.equal(first.status,'RECORDED');assert.equal(writes,1);
 nmc.inspectionReviewHistory=[{eventId:caseId+':'+reportId+':APPROVED'}];
 const second=await syncSiSupervisorReviewToNmc({
  caseId,inspectionCase:view.inspectionCase,record:view.record,cases});
 assert.equal(second.status,'ALREADY_RECORDED');assert.equal(writes,1);
 await assert.rejects(()=>syncSiSupervisorReviewToNmc({
  caseId,inspectionCase:{...view.inspectionCase,imo:'1234567'},
  record:view.record,cases}),/SI_NMC_REPORT_SOURCE_NOT_UNIQUE|SI_NMC_REVIEW_NOT_FINALIZED/);
 const unrelated=await syncSiSupervisorReviewToNmc({
  caseId,inspectionCase:{...view.inspectionCase,nmcReferralId:null},
  record:view.record,cases});
 assert.equal(unrelated.status,'NOT_NMC_ORIGIN');
});
test('Riyadh MoU and detention referrals stay unsent drafts and require approved PSC report',()=>{
 const dir=mkdtempSync(join(tmpdir(),'si-review-drafts-'));
 try{
  const repo=new SiRegulatoryDrafts({file:join(dir,'drafts.json')});
  const first=repo.prepare({view,type:'PREPARE_RIYADH_MOU_REPORT',
   reason:'Human supervisor requests PSC reporting preparation',actor:'supervisor'});
  assert.equal(first.state,'PREPARED_NOT_SUBMITTED');
  assert.equal(first.externalTransmissionAttempted,false);
  assert.equal(first.regulatoryDecisionExecuted,false);
  assert.equal(repo.list(caseId).length,1);
  assert.throws(()=>repo.prepare({
   view:{...view,inspectionCase:{...view.inspectionCase,regime:'UAE_SERVICE_INSPECTION'}},
   type:'PREPARE_RIYADH_MOU_REPORT',reason:'Human supervisor requests PSC draft',
   actor:'supervisor'}),/SI_REGULATORY_PSC_REVIEW_REQUIRED/);
  assert.throws(()=>repo.prepare({view:{...view,record:{...view.record,
   report:{...view.record.report,status:'PENDING_REVIEW'}}},
   type:'REFER_DETENTION_REVIEW',reason:'Refer to responsible authority',
   actor:'supervisor'}),/SI_REGULATORY_APPROVED_REPORT_REQUIRED/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
