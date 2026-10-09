import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {NmcAlertWorkspace,NmcAlertError} from '../alert-workspace.mjs';

function setup(minutes=15){
  const dir=mkdtempSync(join(tmpdir(),'nmc-alerts-'));
  const opts={mode:'json',file:join(dir,'alerts.json'),escalationMinutes:minutes};
  return {store:new NmcAlertWorkspace(opts),opts,close:()=>rmSync(dir,{recursive:true,force:true})};
}
function fleet(rows={}){
  return {results:rows};
}
function assessed(imo='9328471',level='Critical',score=91,criticalOpenFinding=true){
  return {imo,status:'COMPLETED',level,score,criticalOpenFinding,
    assessmentId:'AI-TEST-001',configVersion:'NMC-POC-V2'};
}

test('creates an evidence-linked critical alert from saved assessment only and deduplicates',async()=>{
  const {store,close}=setup();
  try{
    const snapshot=fleet({
      '9328471':assessed(),
      '9417731':{...assessed('9417731','Watch',51,false)},
      '9403712':{...assessed('9403712','Critical',89,false),status:'FAILED'}
    });
    assert.deepEqual(await store.scanFleet(snapshot),{created:1,escalated:0});
    assert.deepEqual(await store.scanFleet(snapshot),{created:0,escalated:0});
    const result=await store.overview();
    assert.equal(result.summary.total,1);
    assert.equal(result.summary.unread,1);
    assert.equal(result.alerts[0].imo,'9328471');
    assert.equal(result.alerts[0].severity,'CRITICAL');
    assert.equal(result.alerts[0].sourceAssessmentId,'AI-TEST-001');
    assert.equal(result.alerts[0].provenance,'SYNTHETIC_POC_NON_REGULATORY');
    assert.equal((await store.history(result.alerts[0].id))[0].action,'DETECTED');
  }finally{close();}
});

test('normal and unassessed vessels are never assigned invented risk alerts',async()=>{
  const {store,close}=setup();
  try{
    const rows={
      '9328471':assessed('9328471','Normal',22,false),
      '9417731':assessed('9417731','Watch',53,false),
      '9853312':{...assessed('9853312'),status:'FAILED'},
      '9247813':{...assessed('9247813'),score:null},
      '9403712':{...assessed('9403712','High',76,false),imo:'invalid'}
    };
    const result=await store.scanFleet(fleet(rows));
    assert.equal(result.created,0);
    assert.equal((await store.overview()).summary.active,0);
  }finally{close();}
});

test('high alerts acknowledge, follow-up, escalation and audited resolution persist across reopens',async()=>{
  const {store,opts,close}=setup();
  try{
    await store.scanFleet(fleet({'9417731':assessed('9417731','High',69,false)}));
    let current=(await store.list())[0];
    assert.equal(current.assignedRole,'NMC_OFFICER');
    current=await store.transition(current.id,'ACKNOWLEDGE',current.version,'Reviewing evidence','OPERATOR');
    assert.equal(current.status,'ACKNOWLEDGED');
    current=await store.transition(current.id,'START_FOLLOW_UP',current.version,'Open case workspace','OPERATOR');
    assert.equal(current.status,'IN_PROGRESS');
    current=await store.transition(current.id,'ESCALATE',current.version,'Need supervisor review','OPERATOR');
    assert.equal(current.assignedRole,'NMC_SUPERVISOR');
    assert.equal(current.status,'ESCALATED');
    current=await store.transition(current.id,'RESOLVE',current.version,'Reviewed and cleared','SUPERVISOR');
    assert.equal(current.status,'RESOLVED');
    const persisted=new NmcAlertWorkspace(opts);
    assert.equal((await persisted.get(current.id)).status,'RESOLVED');
    assert.equal((await persisted.overview()).summary.active,0);
    assert.deepEqual((await persisted.history(current.id)).map(x=>x.action),
      ['RESOLVE','ESCALATE','START_FOLLOW_UP','ACKNOWLEDGE','DETECTED']);
    // A new timer poll never opens another alert for the same high band.
    assert.equal((await persisted.scanFleet(fleet({'9417731':assessed('9417731','High',69,false)}))).created,0);
  }finally{close();}
});

test('critical alerts cannot be resolved without supervisor approval',async()=>{
  const {store,close}=setup();
  try{
    await store.scanFleet(fleet({'9328471':assessed()}));
    let a=(await store.list())[0];
    await assert.rejects(()=>store.transition(a.id,'RESOLVE',a.version,'Cleared','OPERATOR'),
      /ALERT_TRANSITION_INVALID/);
    a=await store.transition(a.id,'ACKNOWLEDGE',a.version,'Received','OPERATOR');
    await assert.rejects(()=>store.transition(a.id,'RESOLVE',a.version,'Cleared','OPERATOR'),
      /ALERT_SUPERVISOR_REQUIRED/);
    a=await store.transition(a.id,'RESOLVE',a.version,'Supervisor decision','SUPERVISOR');
    assert.equal(a.status,'RESOLVED');
  }finally{close();}
});

test('optimistic concurrency rejects stale actions without corrupting audit history',async()=>{
  const {store,close}=setup();
  try{
    await store.scanFleet(fleet({'9328471':assessed()}));
    const a=(await store.list())[0];
    const newA=await store.transition(a.id,'ACKNOWLEDGE',a.version,'Checking','OPERATOR');
    await assert.rejects(()=>store.transition(a.id,'ESCALATE',a.version,'Old action','OPERATOR'),
      /ALERT_VERSION_CONFLICT/);
    assert.equal((await store.history(a.id)).length,2);
    assert.equal((await store.get(a.id)).version,newA.version);
    await assert.rejects(()=>store.transition(a.id,'RESOLVE',newA.version,'','SUPERVISOR'),
      /ALERT_RESOLUTION_NOTE_REQUIRED/);
  }finally{close();}
});

test('critical unacknowledged alerts automatically escalate after configured business threshold',async()=>{
  const {store,close}=setup(1);
  try{
    await store.scanFleet(fleet({'9328471':assessed()}));
    const current=(await store.list())[0];
    const db=store._load();
    db.alerts[current.id].createdAt=new Date(Date.now()-90_000).toISOString();
    store._write(db);
    const result=await store.scanFleet(fleet({'9328471':assessed()}));
    assert.equal(result.escalated,1);
    const changed=await store.get(current.id);
    assert.equal(changed.status,'ESCALATED');
    assert.equal(changed.assignedRole,'NMC_SUPERVISOR');
    assert.equal((await store.history(current.id))[0].role,'SYSTEM');
  }finally{close();}
});
