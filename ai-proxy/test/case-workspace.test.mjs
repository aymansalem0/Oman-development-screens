import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {NmcAlertWorkspace} from '../alert-workspace.mjs';
import {NmcCaseWorkspace} from '../case-workspace.mjs';
import {normalizeA01Actions} from '../nmc-action-plan.mjs';

const imo='9328471';
const signals=[
 {factor:'movement',evidenceIds:['AIS-636019872']},
 {factor:'inspection',evidenceIds:['INS-2026-01301']},
 {factor:'certificate',evidenceIds:['CERT-SC-9328471']},
 {factor:'history',evidenceIds:['HIST-9328471']},
 {factor:'dataQuality',evidenceIds:['DQC-9328471']}
];
function setup(){
 const dir=mkdtempSync(join(tmpdir(),'nmc-case-a01-'));
 const alerts=new NmcAlertWorkspace({mode:'json',file:join(dir,'alerts.json'),escalationMinutes:20});
 const opts={mode:'json',file:join(dir,'cases.json'),alerts};
 return {alerts,opts,cases:new NmcCaseWorkspace(opts),
   close:()=>rmSync(dir,{recursive:true,force:true})};
}
async function opened({alerts,cases},severity='Critical'){
 await alerts.scanFleet({results:{[imo]:{
   imo,status:'COMPLETED',score:severity==='Critical'?91:75,
   level:severity,criticalOpenFinding:severity==='Critical',
   assessmentId:'AI-VALIDATED-1001',configVersion:'v1'}}});
 let alert=(await alerts.list())[0];
 alert=await alerts.transition(alert.id,'ACKNOWLEDGE',alert.version,'Officer accepted alert');
 return await cases.fromAlert(alert.id);
}
function plan(row){
 const raw={assessmentId:'AISIT-9328471-0004',summary:'Evidence correlated',
   whyItMatters:'Compliance and movement indicators',
   evidence:[{type:'INSPECTION',evidenceIds:['INS-2026-01301']},
     {type:'CERTIFICATE',evidenceIds:['CERT-SC-9328471']},
     {type:'MOVEMENT',evidenceIds:['AIS-636019872']}],
   proposedActions:[
     {actionId:'priority-inspection',actionType:'PRIORITY_INSPECTION',
       priority:'HIGH',confidence:0.91,requiresHumanApproval:true},
     {actionId:'verify-certificate',actionType:'VERIFY_CERTIFICATE',
       priority:'IMMEDIATE',confidence:0.94,requiresHumanApproval:true},
     {actionId:'enhanced-monitoring',actionType:'ENHANCED_MONITORING',
       priority:'MONITOR',confidence:0.96,requiresHumanApproval:false}
   ]};
 return normalizeA01Actions(raw,{
   imo,assessmentId:row.sourceAssessmentId,score:row.sourceScore,
   level:row.sourceLevel,configVersion:'v1',signals});
}
test('Case starts with no fake tasks and requires an acknowledged saved-AI alert',async()=>{
 const db=setup();
 try{
   await db.alerts.scanFleet({results:{[imo]:{
     imo,status:'COMPLETED',score:91,level:'Critical',criticalOpenFinding:true,
     assessmentId:'AI-VALIDATED-1001',configVersion:'v1'}}});
   const event=(await db.alerts.list())[0];
   await assert.rejects(()=>db.cases.fromAlert(event.id),/CASE_ALERT_ACK_REQUIRED/);
   const ack=await db.alerts.transition(event.id,'ACKNOWLEDGE',event.version,'Ack');
   const row=await db.cases.fromAlert(ack.id);
   assert.equal(row.sourceScore,91);
   assert.equal(row.sourceAssessmentId,'AI-VALIDATED-1001');
   assert.deepEqual(row.tasks,[]);
   assert.equal(row.actionPlan,null);
   assert.deepEqual(row.inspectionRequests,[]);
   assert.equal((await db.cases.fromAlert(ack.id)).id,row.id);
 }finally{db.close();}
});
test('Actual A01 actions are validated against stored evidence, not inferred risk',()=>{
 const r=normalizeA01Actions({
   assessmentId:'A01-RUN-1',
   evidence:[{type:'INSPECTION',evidenceIds:['INS-2026-01301','UNKNOWN-REF']}],
   proposedActions:[{actionId:'priority-inspection',actionType:'PRIORITY_INSPECTION',
     priority:'HIGH',confidence:.91,requiresHumanApproval:true}]
 },{imo,assessmentId:'A-1',score:60,level:'Watch',configVersion:'v1',signals});
 assert.deepEqual(r.proposedActions[0].evidenceIds,['INS-2026-01301']);
 assert.equal(r.sourceScore,60);
 assert.throws(()=>normalizeA01Actions({
   proposedActions:[{actionId:'bad-id',actionType:'PRIORITY_INSPECTION',
     confidence:.85,requiresHumanApproval:true,evidenceIds:['FAKE-1']}]
 },{imo,assessmentId:'A-1',score:60,level:'Watch',signals}),/A01_ACTION_EVIDENCE_MISSING/);
 assert.throws(()=>normalizeA01Actions({signals:[]},
   {imo,assessmentId:'A-1',score:60,level:'Watch',signals}),/A01_ACTIONS_NOT_AVAILABLE/);
});
test('A01 accepts safe camelCase and uppercase naming without inventing actions',()=>{
  const proposal=(actionId,actionType)=>({
    actionId,actionType,priority:'HIGH',confidence:0.91,requiresHumanApproval:true
  });
  const ctx={imo,assessmentId:'A-1',score:60,level:'Watch',configVersion:'v1',signals};
  const raw={evidence:[{type:'INSPECTION',evidenceIds:['INS-2026-01301']}],
    proposedActions:[proposal('Priority_Inspection_01','priorityInspection')]};
  const normalized=normalizeA01Actions(raw,ctx);
  assert.equal(normalized.proposedActions[0].actionId,'priority-inspection-01');
  assert.equal(normalized.proposedActions[0].actionType,'PRIORITY_INSPECTION');
  assert.deepEqual(normalized.proposedActions[0].evidenceIds,['INS-2026-01301']);
  const alias=normalizeA01Actions({...raw,
    proposedActions:[proposal('PRIORITY_02','REQUEST_PRIORITY_INSPECTION')]},ctx);
  assert.equal(alias.proposedActions[0].actionType,'PRIORITY_INSPECTION');
  assert.equal(alias.proposedActions[0].actionId,'priority-02');
});

test('A01 rejects unknown actions and normalized duplicate IDs with precise, safe diagnostics',()=>{
  const ctx={imo,assessmentId:'A-1',score:60,level:'Watch',configVersion:'v1',signals};
  const proposal=(actionId,actionType)=>({
    actionId,actionType,priority:'HIGH',confidence:0.91,requiresHumanApproval:true
  });
  assert.throws(()=>normalizeA01Actions({proposedActions:[
    proposal('action-1','DETENTION_ORDER')
  ]},ctx),error=>{
    assert.equal(error.code,'A01_ACTION_TYPE_UNSUPPORTED');
    assert.deepEqual(error.details,{actionIndex:1,actionType:'DETENTION_ORDER'});
    return true;
  });
  assert.throws(()=>normalizeA01Actions({
    evidence:[{type:'CERTIFICATE',evidenceIds:['CERT-SC-9328471']}],
    proposedActions:[
      proposal('Verify_Certificate','VERIFY_CERTIFICATE'),
      proposal('verify-certificate','VERIFY_CERTIFICATE')
    ]
  },ctx),error=>{
    assert.equal(error.code,'A01_ACTION_ID_DUPLICATE');
    assert.deepEqual(error.details,{actionIndex:2,actionId:'verify-certificate'});
    return true;
  });
  assert.throws(()=>normalizeA01Actions({proposedActions:[
    proposal(undefined,'VERIFY_CERTIFICATE')
  ]},ctx),error=>{
    assert.equal(error.code,'A01_ACTION_ID_INVALID');
    assert.equal(error.details.actionIndex,1);
    return true;
  });
  assert.throws(()=>normalizeA01Actions({proposedActions:[null]},ctx),
    /A01_ACTION_ID_INVALID/);
});

test('A01 VERIFY_DEFICIENCY_CLOSURE becomes a reviewed evidence-backed task, not an inspection or auto-closure',async()=>{
  const db=setup();
  try {
    let row=await opened(db);
    const originalScore=row.sourceScore;
    const valid=normalizeA01Actions({
      assessmentId:'AIRIA-A01-REAL-EXAMPLE',
      summary:'Follow up historical inspection deficiency',
      evidence:[{
        type:'INSPECTION',
        evidenceIds:['INS-2026-01301','INVALID-UNVERIFIED-REF']
      }],
      proposedActions:[{
        actionId:'verify_deficiency_closure',
        actionType:'VERIFY_DEFICIENCY_CLOSURE',
        priority:'HIGH',confidence:0.92,requiresHumanApproval:true
      }]
    },{
      imo,assessmentId:row.sourceAssessmentId,score:row.sourceScore,
      level:row.sourceLevel,configVersion:'v1',signals
    });
    const proposed=valid.proposedActions[0];
    assert.equal(proposed.actionId,'verify-deficiency-closure');
    assert.equal(proposed.actionType,'VERIFY_DEFICIENCY_CLOSURE');
    assert.equal(proposed.title,'Verify evidence of deficiency closure');
    assert.equal(proposed.ownerRole,'COMPLIANCE_OFFICER');
    assert.deepEqual(proposed.evidenceIds,['INS-2026-01301']);
    row=await db.cases.saveActionPlan(row.id,row.version,valid);
    assert.equal(row.tasks.length,0);
    assert.equal((await db.cases.listInspectionRequests()).length,0);
    row=await db.cases.decideAction(row.id,row.version,proposed.actionId,'ACCEPT');
    assert.equal(row.tasks.length,1);
    assert.equal(row.tasks[0].actionType,'VERIFY_DEFICIENCY_CLOSURE');
    assert.equal(row.tasks[0].status,'Assigned');
    assert.equal(row.tasks[0].provenance,'AIRIA_A01_HUMAN_APPROVED');
    assert.deepEqual(row.inspectionRequests,[]);
    assert.equal(row.inspectionOutcome,null);
    assert.equal(row.sourceScore,originalScore);
    // A01 cannot claim closure without a validated inspection evidence reference.
    assert.throws(()=>normalizeA01Actions({
      proposedActions:[{
        actionId:'unverified-closure',actionType:'VERIFY_DEFICIENCY_CLOSURE',
        priority:'HIGH',confidence:0.92,requiresHumanApproval:true,
        evidenceIds:['INS-NOT-PRESENT']
      }]
    },{
      imo,assessmentId:row.sourceAssessmentId,score:row.sourceScore,
      level:row.sourceLevel,configVersion:'v1',signals
    }),/A01_ACTION_EVIDENCE_MISSING/);
  } finally {db.close();}
});

test('A01 plan cannot be published twice and does not create tasks before human approval',async()=>{
 const db=setup();
 try{
   let row=await opened(db);
   const original=row.sourceScore;
   row=await db.cases.saveActionPlan(row.id,row.version,plan(row));
   assert.equal(row.tasks.length,0);
   assert.equal(row.actionPlan.proposedActions.length,3);
   assert.equal(row.sourceScore,original);
   await assert.rejects(()=>db.cases.saveActionPlan(row.id,row.version,plan(row)),/CASE_ACTION_PLAN_EXISTS/);
   const reopened=new NmcCaseWorkspace(db.opts);
   assert.equal((await reopened.get(row.id)).actionPlan.proposedActions.length,3);
   assert.equal((await reopened.history(row.id))[0].action,'A01_ACTION_PLAN_RECORDED');
 }finally{db.close();}
});
test('Approved inspection action creates one scheduled-queue candidate; reject creates none',async()=>{
 const db=setup();
 try{
   let row=await opened(db);
   row=await db.cases.saveActionPlan(row.id,row.version,plan(row));
   await assert.rejects(()=>db.cases.decideAction(row.id,row.version,'unknown','ACCEPT'),/CASE_ACTION_NOT_FOUND/);
   row=await db.cases.decideAction(row.id,row.version,'enhanced-monitoring','REJECT','Not necessary now');
   assert.deepEqual(row.tasks,[]);
   row=await db.cases.decideAction(row.id,row.version,'priority-inspection','ACCEPT');
   assert.equal(row.tasks.length,1);
   assert.equal(row.tasks[0].provenance,'AIRIA_A01_HUMAN_APPROVED');
   assert.equal(row.inspectionRequests.length,1);
   assert.equal(row.inspectionRequests[0].status,'PENDING_SCHEDULING');
   assert.equal((await db.cases.listInspectionRequests()).length,1);
   await assert.rejects(()=>db.cases.decideAction(row.id,row.version,'priority-inspection','ACCEPT'),
     /CASE_ACTION_ALREADY_DECIDED/);
   assert.equal((await db.cases.byImo(imo)).inspectionRequests.length,1);
 }finally{db.close();}
});
test('Scheduling is explicit, role-side and optimistic version-locked; inspection requires scheduled request',async()=>{
 const db=setup();
 try{
   let row=await opened(db);
   row=await db.cases.saveActionPlan(row.id,row.version,plan(row));
   row=await db.cases.decideAction(row.id,row.version,'priority-inspection','ACCEPT');
   const req=row.inspectionRequests[0];
   await assert.rejects(()=>db.cases.inspection(row.id,row.version,{
     inspectionId:'NMC-INS-2026-8471',findingsCount:0,criticalFindings:0,
     result:'Cleared',summary:'All pass'}),/CASE_INSPECTION_NOT_SCHEDULED/);
   const scheduledAt=new Date(Date.now()+48*3600*1000).toISOString();
   await assert.rejects(()=>db.cases.scheduleInspection(row.id,row.version,req.id,{
     scheduledAt:'2020-01-01T00:00:00Z',port:'Jebel Ali',inspector:'Inspector A'
   }),/CASE_SCHEDULE_INVALID/);
   const stale=row.version;
   row=await db.cases.scheduleInspection(row.id,row.version,req.id,{
     scheduledAt,port:'Jebel Ali',inspector:'Inspector A'});
   assert.equal(row.inspectionRequests[0].status,'SCHEDULED');
   await assert.rejects(()=>db.cases.scheduleInspection(row.id,stale,req.id,{
     scheduledAt,port:'Jebel Ali',inspector:'Inspector A'}),/CASE_VERSION_CONFLICT/);
   await assert.rejects(()=>db.cases.scheduleInspection(row.id,row.version,req.id,{
     scheduledAt,port:'Jebel Ali',inspector:'Inspector A'}),/CASE_INSPECTION_SCHEDULE_CONFLICT/);
   row=await db.cases.inspection(row.id,row.version,{
     inspectionId:'NMC-INS-2026-8471',findingsCount:0,criticalFindings:0,
     result:'Cleared',summary:'All pass'});
   assert.equal(row.inspectionRequests[0].status,'COMPLETED');
   assert.equal(row.tasks.find(t=>t.id==='priority-inspection').status,'Completed');
   assert.equal(row.sourceScore,91);
   assert.equal((await db.cases.history(row.id))[0].action,'INSPECTION_RECORDED');
 }finally{db.close();}
});
test('Human supervisor closes only when mandatory actions are completed',async()=>{
 const db=setup();
 try{
   let row=await opened(db);
   row=await db.cases.saveActionPlan(row.id,row.version,plan(row));
   row=await db.cases.decideAction(row.id,row.version,'verify-certificate','ACCEPT');
   row=await db.cases.decideAction(row.id,row.version,'priority-inspection','REJECT',
     'Reviewed; no new physical inspection required');
   row=await db.cases.decideAction(row.id,row.version,'enhanced-monitoring','REJECT',
     'No additional monitoring ordered');
   await assert.rejects(()=>db.cases.resolve(row.id,row.version,'Completed','OPERATOR'),
     /CASE_SUPERVISOR_REQUIRED/);
   await assert.rejects(()=>db.cases.resolve(row.id,row.version,'Completed','SUPERVISOR'),
     /CASE_MANDATORY_TASKS_INCOMPLETE/);
   row=await db.cases.task(row.id,row.version,'verify-certificate','COMPLETE','Evidence verified');
   row=await db.cases.resolve(row.id,row.version,'Verified and closed','SUPERVISOR');
   assert.equal(row.status,'RESOLVED');
   assert.equal((await db.cases.byImo(imo)).id,row.id);
 }finally{db.close();}
});