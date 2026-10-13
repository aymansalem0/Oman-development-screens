import test from 'node:test';
import assert from 'node:assert/strict';
import {SiRollingPlanStore} from '../si-rolling-plan-store.mjs';
const CASE_ID='0e44926c-f34a-4d5e-91a9-33049ccc6b44';
const BATCH_ID='31b1552b-f40f-4215-aed3-f0d4d2f7416c';
class MockOracle{
 constructor({missing=[]}={}){
  this.tables=new Set(['SI_PLAN_ROLLING','SI_PLAN_ROLLING_VERSION',
   'SI_PLAN_ROLLING_AUDIT','SI_PLAN_ROLLING_VESSEL','SI_PLAN_ROLLING_REASON']
   .filter(x=>!missing.includes(x)));
  this.records=new Map();this.versions=[];this.audit=[];this.vessels=[];
  this.reasons=[];this.sql=[];
  this.pool={getConnection:async()=>new Connection(this)};
 }
}
class Connection{
 constructor(backend){this.db=backend;}
 async execute(sql,binds={}){
  const q=sql.replace(/\s+/g,' ').toUpperCase().trim();
  const db=this.db;db.sql.push(q);
  const answer=rows=>({rows});
  if(q.startsWith('SELECT TABLE_NAME FROM USER_TABLES'))
   return answer([...db.tables].map(TABLE_NAME=>({TABLE_NAME})));
  if(q.startsWith('SELECT STATE_JSON FROM SI_PLAN_ROLLING ORDER BY'))
   return answer([...db.records.values()].map(x=>({STATE_JSON:JSON.stringify(x)})));
  if(q.startsWith('SELECT STATE_JSON FROM SI_PLAN_ROLLING WHERE'))
   return answer(db.records.has(binds.id)?
    [{STATE_JSON:JSON.stringify(db.records.get(binds.id))}]:[]);
  if(q.startsWith('SELECT PLAN_ID FROM SI_PLAN_ROLLING_VESSEL'))
   return answer(db.vessels.filter(v=>v.caseId===binds.id)
    .map(v=>({PLAN_ID:v.plan})));
  if(q.startsWith('INSERT INTO SI_PLAN_ROLLING (')){
   const p=JSON.parse(binds.state.val);db.records.set(p.id,p);
   return {rowsAffected:1};
  }
  if(q.startsWith('UPDATE SI_PLAN_ROLLING SET')){
   const p=JSON.parse(binds.state.val);db.records.set(p.id,p);
   return {rowsAffected:1};
  }
  if(q.startsWith('INSERT INTO SI_PLAN_ROLLING_VERSION')){
   db.versions.push({id:binds.id,version:binds.version??0,
    state:JSON.parse(binds.state.val)});return {rowsAffected:1};
  }
  if(q.startsWith('INSERT INTO SI_PLAN_ROLLING_AUDIT')){
   db.audit.push(binds);return {rowsAffected:1};
  }
  if(q.startsWith('INSERT INTO SI_PLAN_ROLLING_VESSEL')){
   db.vessels.push(binds);return {rowsAffected:1};
  }
  if(q.startsWith('INSERT INTO SI_PLAN_ROLLING_REASON')){
   db.reasons.push(binds);return {rowsAffected:1};
  }
  throw Error('MOCK_UNEXPECTED_ORACLE_QUERY '+q.slice(0,95));
 }
 async commit(){}async rollback(){}async close(){}
}
const make=db=>new SiRollingPlanStore({mode:'oracle',oracleRepository:db});
test('Oracle 018 initialization fails closed when a plan table is missing',async()=>{
 const db=new MockOracle({missing:['SI_PLAN_ROLLING_REASON']});
 await assert.rejects(make(db).initialize(),/SI_ROLLING_MIGRATION_018_REQUIRED/);
 assert.equal(db.records.size,0);
});
test('Oracle 018 persists numbered plans, immutable versions, source keys, linked approved case and completion audit',async()=>{
 const db=new MockOracle(),store=make(db);
 await store.initialize();
 const initial=await store.create({title:'Rolling UAT',startsOn:'2026-10-13',
  endsOn:'2026-10-17',port:'Khalifa'},'user@moei');
 assert.equal(Object.hasOwn(initial,'port'),false,
  'legacy port payload must not appear on a newly created rolling plan');
 assert.equal(Object.hasOwn(db.records.get(initial.id),'port'),false,
  'Oracle STATE_JSON must not save a port');
 assert.match(initial.number,/^IP-/);
 assert.equal((await store.list()).length,1);
 assert.equal(db.versions[0].version,0);
 const draft=await store.saveDraft(initial.id,0,'officer@moei',p=>{
  p.status='READY_FOR_APPROVAL';p.latest={agentRunId:'C01-1',rows:[{
   imo:'9328471',planSelected:true}]};return p;
 });
 assert.equal(draft.revision,1);
 assert.equal(db.versions.length,2);
 const approved=await store.approve(initial.id,{
  expectedRevision:1,batchId:BATCH_ID,actor:'supervisor@moei',
  cases:[{imo:'9328471',caseId:CASE_ID,planRank:1,
   regimes:['FOCUSED_INSPECTION'],inspectionReasons:[{
    eventKey:'NMC-CASE-20261013-1',sourceType:'NMC_CASE',
    sourceReference:'Human-approved NMC case'}]}]});
 assert.equal(approved.status,'APPROVED');
 assert.equal(db.vessels[0].caseId,CASE_ID);
 assert.equal(db.reasons[0].key,'NMC-CASE-20261013-1');
 assert.equal(JSON.parse(db.reasons[0].reason.val).sourceType,'NMC_CASE');
 const same=await store.approve(initial.id,{
  expectedRevision:1,batchId:BATCH_ID,actor:'supervisor@moei',cases:approved.approvedVessels});
 assert.deepEqual(same,approved,'idempotent same-batch retries');
 const active=await store.setExecutionState(initial.id,'IN_EXECUTION','supervisor@moei');
 assert.equal(active.status,'IN_EXECUTION');
 await store.completeIfAllClosed(CASE_ID,'supervisor@moei',{
  list:async()=>({cases:[{id:CASE_ID,stage:'CLOSED'}]})});
 const done=await store.get(initial.id);
 assert.equal(done.status,'COMPLETED');
 assert.equal(done.approvedVessels[0].inspectionReasons[0].eventKey,
  'NMC-CASE-20261013-1','full original source immutable');
 assert.deepEqual(db.versions.map(x=>x.state.status),
  ['DRAFT','READY_FOR_APPROVAL','APPROVED','IN_EXECUTION','COMPLETED']);
 assert.equal(db.audit.length,5);
 await assert.rejects(store.cancel(initial.id,done.revision,'supervisor',
  'Retrospectively alter legally approved plan'),
  /SI_ROLLING_APPROVED_PLAN_IMMUTABLE/);
});
