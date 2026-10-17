import test from 'node:test';
import assert from 'node:assert/strict';
import {syncSiClosureToNmc} from '../si-nmc-closure-sync.mjs';
const sid='01aaaaaa-1111-4111-8111-000000000001';
const nid='02bbbbbb-2222-4222-8222-000000000002';
const rid='03cccccc-3333-4333-8333-000000000003';
const inspectionCase={id:sid,imo:'9400409',nmcCaseId:nid,nmcReferralId:rid};
const record={stage:'CLOSED',caseId:sid,imo:'9400409',
 report:{status:'APPROVED',summary:'Inspection completed after independent review',supervisor:'supervisor@moei.gov.ae'},
 findings:[{severity:'CRITICAL'}]};
test('linked approved close registers outcome once without resolving NMC risk',async()=>{
 let writes=0;
 const cases={
  async list(){return [{id:nid,imo:'9400409',version:5,status:'IN_PROGRESS',
   inspectionRequests:[{id:rid,status:'SCHEDULED'}],inspectionHistory:[]}]},
  async inspection(id,version,outcome,actor){
   writes++;assert.equal(id,nid);assert.equal(version,5);assert.equal(actor,'SI_SUPERVISOR');
   assert.equal(outcome.inspectionId,sid);assert.equal(outcome.findingsCount,1);
   assert.equal(outcome.criticalFindings,1);return {id:nid,status:'IN_PROGRESS'};
  }
 };
 const result=await syncSiClosureToNmc({caseId:sid,inspectionCase,record,cases});
 assert.equal(result.status,'RECORDED');assert.equal(result.nmcCaseStatus,'IN_PROGRESS');
 assert.equal(result.riskRecalculated,false);assert.equal(writes,1);
});
test('NMC handoff is idempotent and does not repeat Case Management writes',async()=>{
 let writes=0;
 const cases={
  async list(){return [{id:nid,imo:'9400409',version:7,status:'IN_PROGRESS',
   inspectionHistory:[{inspectionId:sid}],inspectionRequests:[{id:rid,status:'COMPLETED'}]}]},
  async inspection(){writes++;}
 };
 const r=await syncSiClosureToNmc({caseId:sid,inspectionCase,record,cases});
 assert.equal(r.status,'ALREADY_RECORDED');assert.equal(writes,0);
});
test('never attach wrong vessel, unrelated referral, unapproved or unclosed inspection',async()=>{
 let writes=0;
 const cases={
  async list(){return [{id:nid,imo:'1234567',version:7,status:'IN_PROGRESS',
   inspectionRequests:[{id:rid,status:'SCHEDULED'}]}]},
  async inspection(){writes++;}
 };
 await assert.rejects(()=>syncSiClosureToNmc({caseId:sid,inspectionCase,record,cases}),
   /SI_NMC_SOURCE_REFERRAL_NOT_UNIQUE/);
 await assert.rejects(()=>syncSiClosureToNmc({caseId:sid,inspectionCase,
  record:{...record,stage:'REPORT_APPROVED'},cases}),/SI_NMC_APPROVED_CLOSURE_REQUIRED/);
 assert.equal(writes,0);
});
test('non NMC-origin inspection never changes NMC case state',async()=>{
 const r=await syncSiClosureToNmc({caseId:sid,inspectionCase:{...inspectionCase,nmcReferralId:null},
  record,cases:{async list(){throw Error('SHOULD_NOT_CALL')}}});
 assert.equal(r.status,'NOT_NMC_ORIGIN');
});
