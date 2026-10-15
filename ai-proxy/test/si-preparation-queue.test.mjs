import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SiInspectionPreparation} from '../si-inspection-preparation.mjs';

function fixture(){
 const dir=mkdtempSync(join(tmpdir(),'si02-'));
 const file=join(dir,'preparations.json');
 let calls=0;
 const targeting={
   inspectionCaseRegistry:async()=>({
     cases:[
       {id:'11111111-1111-4111-8111-111111111111',imo:'9328471',
         regime:'FOCUSED_INSPECTION',status:'CREATED',approvedBy:'Officer A',
         createdAt:'2026-10-11T18:00:00Z',
         riskAtApproval:{score:72,level:'High',assessmentId:'source-risk',policyRevision:4}},
       {id:'22222222-2222-4222-8222-222222222222',imo:'9400409',
         regime:'PORT_STATE_CONTROL',status:'CREATED',approvedBy:'Officer B',
         createdAt:'2026-10-11T20:00:00Z',riskAtApproval:null},
       {id:'33333333-3333-4333-8333-333333333333',imo:'9400409',
         regime:'PORT_STATE_CONTROL',status:'DEFERRED',approvedBy:null}
     ],events:[]
   }),
   dashboard:async()=>{calls++;throw Error('live candidate source unavailable')}
 };
 const prep=new SiInspectionPreparation({targeting,mode:'json',file,enabled:false,
   bundles:[{imo:'9328471',inlineContext:{vessel:{name:'Test Vessel',flag:'UAE'}}}]});
 return {prep,file,dir,done:()=>rmSync(dir,{recursive:true,force:true}),
   calls:()=>calls};
}
test('SI-02 list reads approved persisted case registry; not live candidate queue or AI',async()=>{
 const f=fixture();
 try{
  const result=await f.prep.list();
  assert.equal(result.count,2);
  assert.equal(result.cases[0].imo,'9400409');
  assert.equal(result.cases[0].vesselName,'IMO 9400409');
  assert.equal(result.cases[0].riskAtApproval,null);
  assert.equal(result.cases[0].preparationStatus,'NOT_PREPARED');
  assert.equal(result.cases[1].vesselName,'Test Vessel');
  assert.equal(result.cases[1].riskAtApproval.score,72);
  assert.equal(f.calls(),0);
 }finally{f.done()}
});
test('SI-02 saved dossier/status appears on case register without generating any AI',async()=>{
 const f=fixture();
 try{
  writeFileSync(f.file,JSON.stringify({documents:{
    '11111111-1111-4111-8111-111111111111':{
      version:4,status:'DRAFT_REVIEW',preparedAt:'2026-10-11T21:00:00Z',
      dossier:{source:'MOCK'}}
  },audit:[]}));
  const result=await f.prep.list();
  assert.equal(result.cases[1].preparationStatus,'DRAFT_REVIEW');
  assert.equal(result.cases[1].preparationVersion,4);
  assert.equal(result.cases[1].dossierSource,'MOCK');
  assert.equal(f.calls(),0);
 }finally{f.done()}
});
test('missing migration 010 never hides saved approved cases; emits explicit warning',async()=>{
 const f=fixture();
 try{
  f.prep.ready=false;
  const result=await f.prep.list();
  assert.equal(result.count,2);
  assert.equal(result.preparationAvailable,false);
  assert.equal(result.warning,'SI_MIGRATION_010_REQUIRED');
  assert.equal(f.calls(),0);
 }finally{f.done()}
});
test('SI-02 list fails on registry backend error; must not convert outage to empty list',async()=>{
 const f=fixture();
 try{
  f.prep.targeting.inspectionCaseRegistry=async()=>{throw Error('SI_DB_DOWN')};
  await assert.rejects(f.prep.list(),/SI_DB_DOWN/);
 }finally{f.done()}
});
