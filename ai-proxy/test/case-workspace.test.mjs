import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {NmcAlertWorkspace} from '../alert-workspace.mjs';
import {NmcCaseWorkspace} from '../case-workspace.mjs';

const imo='9328471';
function setup(){
  const dir=mkdtempSync(join(tmpdir(),'nmc-case-v1-'));
  const alertFile=join(dir,'alerts.json'),caseFile=join(dir,'cases.json');
  const alerts=new NmcAlertWorkspace({mode:'json',file:alertFile,escalationMinutes:20});
  const opts={mode:'json',file:caseFile,alerts};
  const cases=new NmcCaseWorkspace(opts);
  return {alerts,cases,opts,close:()=>rmSync(dir,{recursive:true,force:true})};
}
async function assessed(alerts,imo='9328471',severity='Critical'){
  await alerts.scanFleet({results:{[imo]:{
    imo,status:'COMPLETED',score:severity==='Critical'?91:75,
    level:severity,criticalOpenFinding:severity==='Critical',
    assessmentId:'AI-TEST-C',
    configVersion:'v1'
  }}});
  return (await alerts.list()).find(row=>row.imo===imo);
}
test('requires real acknowledged alert before human-triggered case creation',async()=>{
  const {alerts,cases,close}=setup();
  try{
    const alert=await assessed(alerts);
    await assert.rejects(()=>cases.fromAlert(alert.id),/CASE_ALERT_ACK_REQUIRED/);
    assert.deepEqual(await cases.list(),[]);
    const acknowledged=await alerts.transition(alert.id,'ACKNOWLEDGE',alert.version,
      'Officer review','OPERATOR');
    const opened=await cases.fromAlert(acknowledged.id);
    assert.equal(opened.imo,imo);
    assert.equal(opened.sourceScore,91);
    assert.equal(opened.status,'OPEN');
    assert.equal(opened.tasks.length,4);
    assert.equal((await cases.history(opened.id))[0].action,'CREATED');
    assert.equal((await cases.fromAlert(acknowledged.id)).id,opened.id);
  }finally{close();}
});
test('deduplicates active cases by IMO and links additional acknowledged alerts',async()=>{
  const {alerts,cases,close}=setup();
  try{
    let alert=await assessed(alerts,imo,'High');
    alert=await alerts.transition(alert.id,'ACKNOWLEDGE',alert.version,'Noted');
    const first=await cases.fromAlert(alert.id);
    let nextAlert=await assessed(alerts,imo,'Critical');
    nextAlert=(await alerts.list()).find(a=>a.severity==='CRITICAL');
    nextAlert=await alerts.transition(nextAlert.id,'ACKNOWLEDGE',nextAlert.version,'Critical escalation');
    const same=await cases.fromAlert(nextAlert.id);
    assert.equal(same.id,first.id);
    assert.equal(same.alertIds.length,2);
    assert.equal((await cases.list()).length,1);
    assert.equal((await cases.history(first.id))[0].action,'ALERT_LINKED');
  }finally{close();}
});
test('task actions persist centrally with optimistic locking and immutable history',async()=>{
  const {alerts,cases,opts,close}=setup();
  try{
    let alert=await assessed(alerts);
    alert=await alerts.transition(alert.id,'ACKNOWLEDGE',alert.version,'Noted');
    let row=await cases.fromAlert(alert.id);
    row=await cases.task(row.id,row.version,'verify-certificate','START','Verifying certificate');
    assert.equal(row.status,'IN_PROGRESS');
    await assert.rejects(()=>cases.task(row.id,row.version-1,'verify-certificate','COMPLETE'),
      /CASE_VERSION_CONFLICT/);
    row=await cases.task(row.id,row.version,'verify-certificate','COMPLETE','Checked source evidence');
    const reopened=new NmcCaseWorkspace(opts);
    assert.equal((await reopened.get(row.id)).tasks.find(t=>t.id==='verify-certificate').status,'Completed');
    assert.equal((await reopened.history(row.id))[0].action,'TASK_COMPLETE');
    await assert.rejects(()=>reopened.task(row.id,row.version,'priority-inspection','COMPLETE'),
      /CASE_INSPECTION_EVIDENCE_REQUIRED/);
  }finally{close();}
});
test('human AI recommendation decision is evidence-linked and can be audited',async()=>{
  const {alerts,cases,opts,close}=setup();
  try{
    let alert=await assessed(alerts);
    alert=await alerts.transition(alert.id,'ACKNOWLEDGE',alert.version,'Noted');
    let row=await cases.fromAlert(alert.id);
    await assert.rejects(()=>cases.decision(row.id,row.version,{
      recommendationId:'verify-document',decision:'MODIFY',evidenceIds:['CERT-TEST']
    }),/CASE_DECISION_REASON_REQUIRED/);
    row=await cases.decision(row.id,row.version,{
      recommendationId:'verify-document',decision:'MODIFY',
      note:'Check certificate source first',evidenceIds:['CERT-SC-9328471']
    });
    assert.equal(row.decisions[0].decision,'MODIFY');
    assert.deepEqual(row.decisions[0].evidenceIds,['CERT-SC-9328471']);
    assert.equal((await new NmcCaseWorkspace(opts).history(row.id))[0].action,'DECISION_RECORDED');
  }finally{close();}
});
test('inspection outcome is mandatory evidence before priority task can be completed',async()=>{
  const {alerts,cases,close}=setup();
  try{
    let alert=await assessed(alerts);
    alert=await alerts.transition(alert.id,'ACKNOWLEDGE',alert.version,'Noted');
    let row=await cases.fromAlert(alert.id);
    row=await cases.inspection(row.id,row.version,{
      inspectionId:'NMC-INS-2026-8471',findingsCount:1,criticalFindings:0,
      result:'Completed with Findings',summary:'Finding recorded'
    });
    assert.equal(row.inspectionOutcome.findingsCount,1);
    assert.equal(row.tasks.find(t=>t.id==='priority-inspection').status,'Completed');
    await assert.rejects(()=>cases.inspection(row.id,row.version,{
      inspectionId:'NMC-INS-2026-8471',findingsCount:1,criticalFindings:0,
      result:'Completed with Findings',summary:'Duplicate'
    }),/CASE_INSPECTION_ALREADY_RECORDED/);
  }finally{close();}
});
test('supervisor must approve closure after all mandatory tasks and a reason',async()=>{
  const {alerts,cases,close}=setup();
  try{
    let alert=await assessed(alerts);
    alert=await alerts.transition(alert.id,'ACKNOWLEDGE',alert.version,'Noted');
    let row=await cases.fromAlert(alert.id);
    await assert.rejects(()=>cases.resolve(row.id,row.version,'Closed','OPERATOR'),
      /CASE_SUPERVISOR_REQUIRED/);
    await assert.rejects(()=>cases.resolve(row.id,row.version,'Closed','SUPERVISOR'),
      /CASE_MANDATORY_TASKS_INCOMPLETE/);
    row=await cases.task(row.id,row.version,'verify-certificate','COMPLETE','Verified');
    row=await cases.task(row.id,row.version,'enhanced-monitoring','COMPLETE','Monitored');
    row=await cases.inspection(row.id,row.version,{
      inspectionId:'NMC-INS-2026-8471',findingsCount:0,criticalFindings:0,
      result:'Cleared',summary:'No deficiencies'
    });
    assert.equal(row.status,'PENDING_VERIFICATION');
    await assert.rejects(()=>cases.resolve(row.id,row.version,'','SUPERVISOR'),
      /CASE_RESOLUTION_NOTE_REQUIRED/);
    row=await cases.resolve(row.id,row.version,'All evidence verified','SUPERVISOR');
    assert.equal(row.status,'RESOLVED');
    assert.equal((await cases.byImo(imo)).id,row.id);
    assert.equal((await cases.history(row.id))[0].action,'RESOLVED');
  }finally{close();}
});
