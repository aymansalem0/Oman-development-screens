import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {NmcAlertWorkspace} from '../alert-workspace.mjs';
import {NmcCaseWorkspace} from '../case-workspace.mjs';
import {normalizeA01Actions} from '../nmc-action-plan.mjs';
import {buildSingleProposal,DECISION_CATALOGUE} from '../nmc-decision-policy.mjs';

const imo='9328471';
const signals=[
  {factor:'movement',evidenceIds:['AIS-01']},
  {factor:'inspection',evidenceIds:['DEF-2026-401']},
  {factor:'certificate',evidenceIds:['CERT-01']},
  {factor:'history',evidenceIds:['HIST-01']},
  {factor:'dataQuality',evidenceIds:['DQ-01']}
];
function normalized(row,types=['PRIORITY_INSPECTION','VERIFY_CERTIFICATE']){
  const raw={summary:'Recorded risk requires follow up',
    whyItMatters:'Evidence-backed verification is needed',
    evidence:[
      {type:'INSPECTION',evidenceIds:['DEF-2026-401']},
      {type:'CERTIFICATE',evidenceIds:['CERT-01']}
    ],
    proposedActions:types.map((type,i)=>({
      actionId:'a01-'+i,actionType:type,
      title:'A01 original '+type,reason:'Saved evidence requires follow-up',
      priority:'HIGH',confidence:.8+i*.05,
      requiresHumanApproval:true,
      evidenceIds:type==='VERIFY_CERTIFICATE'?['CERT-01']:['DEF-2026-401']
    }))
  };
  return normalizeA01Actions(raw,{imo,assessmentId:row.sourceAssessmentId,
    score:row.sourceScore,level:row.sourceLevel,configVersion:'v1',signals});
}
function setup(){
  const dir=mkdtempSync(join(tmpdir(),'nmc-single-decision-'));
  const alerts=new NmcAlertWorkspace({mode:'json',file:join(dir,'alerts.json')});
  const cases=new NmcCaseWorkspace({mode:'json',file:join(dir,'cases.json'),alerts});
  return {alerts,cases,close:()=>rmSync(dir,{recursive:true,force:true})};
}
async function opened(db){
  await db.alerts.scanFleet({results:{[imo]:{
    imo,status:'COMPLETED',score:60,level:'Watch',
    criticalOpenFinding:true,assessmentId:'VALID-A01-01',configVersion:'v1'
  }}});
  const item=(await db.alerts.list())[0];
  assert.ok(item,'Expected critical-finding alert in fixture');
  const acknowledged=await db.alerts.transition(
    item.id,'ACKNOWLEDGE',item.version,'Operator received the alert');
  return db.cases.fromAlert(acknowledged.id);
}
test('No legal enforcement decision is selected solely from risk or A01 actions',()=>{
  const plan={proposedActions:[{actionId:'a1',actionType:'PRIORITY_INSPECTION',
    title:'Review need for inspection',reason:'Validated source requires review',
    confidence:.8,evidenceIds:['DEF-2026-401'],priority:'HIGH',decision:'PENDING'}]};
  const chosen=buildSingleProposal(plan);
  assert.equal(chosen.code,'REFER_SMART_INSPECTION');
  assert.equal(chosen.selectionSource,'NMC_POLICY_MAPPED_FROM_AIRIA_A01');
  assert.equal(chosen.regulatoryEffect,'NONE_POC_ONLY');
  assert.equal(DECISION_CATALOGUE.DETAIN_PENDING_RECTIFICATION.regulated,true);
  assert.equal(DECISION_CATALOGUE.PORT_ENTRY_RESTRICTION.regulated,true);
});
test('Human acceptance creates linked Smart Inspection referral but never changes overall risk',async()=>{
  const db=setup();
  try{
    let row=await opened(db);
    row=await db.cases.saveActionPlan(row.id,row.version,normalized(row,['PRIORITY_INSPECTION']));
    assert.equal(row.tasks.length,0);
    assert.equal(row.operationalDecision.code,'REFER_SMART_INSPECTION');
    row=await db.cases.decideOperational(row.id,row.version,{decision:'ACCEPT'});
    assert.equal(row.tasks.length,1);
    assert.equal(row.inspectionRequests.length,1);
    assert.equal(row.inspectionRequests[0].status,'PENDING_SCHEDULING');
    assert.equal(row.tasks[0].actionType,'PRIORITY_INSPECTION');
    assert.equal(row.sourceScore,60);
    assert.equal(row.restriction,null);
    await assert.rejects(()=>db.cases.decideOperational(
      row.id,row.version,{decision:'ACCEPT'}),/CASE_ACTION_ALREADY_DECIDED/);
  }finally{db.close();}
});
test('Unmapped human decision is safely routed to one Smart Inspection referral',async()=>{
  const db=setup();
  try{
    let row=await opened(db);
    row=await db.cases.saveActionPlan(row.id,row.version,normalized(row,['VERIFY_CERTIFICATE']));
    row=await db.cases.decideOperational(row.id,row.version,{
      decision:'MODIFY',newDecisionCode:'UNMAPPED_TO_INSPECTION',
      note:'Unusual source conflict requires human inspection review'
    });
    assert.equal(row.operationalDecision.originalA01Proposal.actionType,'VERIFY_CERTIFICATE');
    assert.equal(row.operationalDecision.approvedCode,'UNMAPPED_TO_INSPECTION');
    assert.equal(row.inspectionRequests.length,1);
    assert.equal(row.decisionFeedback.length,1);
    assert.equal(row.decisionFeedback[0].originalA01Proposal.actionType,'VERIFY_CERTIFICATE');
    assert.equal(row.decisionFeedback[0].humanApprovedCode,'UNMAPPED_TO_INSPECTION');
    assert.equal(row.decisionFeedback[0].status,'QUEUED_AWAITING_AGENT_INTEGRATION');
    assert.equal(row.decisionFeedback[0].aiTransmissionCount,0);
  }finally{db.close();}
});
test('Ban/entry restriction remains POC-only and requires separate supervisor reference',async()=>{
  const db=setup();
  try{
    let row=await opened(db);
    row=await db.cases.saveActionPlan(row.id,row.version,normalized(row,['VERIFY_CERTIFICATE']));
    row=await db.cases.decideOperational(row.id,row.version,{
      decision:'MODIFY',newDecisionCode:'PORT_ENTRY_RESTRICTION',
      note:'Regulatory officer to review documented jurisdiction and grounds'
    });
    assert.equal(row.restriction.status,'PENDING_AUTHORITY_APPROVAL');
    assert.equal(row.restriction.pocOnly,true);
    assert.equal(row.restriction.legalAuthorityConfirmed,false);
    assert.equal(row.sourceScore,60);
    await assert.rejects(()=>db.cases.task(
      row.id,row.version,row.tasks[0].id,'COMPLETE'),/CASE_RESTRICTION_AUTHORIZATION_REQUIRED/);
    await assert.rejects(()=>db.cases.authorizeRestriction(
      row.id,row.version,{authorityReference:'X',legalBasis:'no'}),/CASE_RESTRICTION_AUTHORITY_EVIDENCE_REQUIRED/);
    row=await db.cases.authorizeRestriction(row.id,row.version,{
      authorityReference:'POC-AUTH-123',legalBasis:'Sample internal review; no live legal authority'
    });
    assert.equal(row.restriction.status,'SIMULATED_ACTIVE');
    await assert.rejects(()=>db.cases.resolve(
      row.id,row.version,'Case closure','SUPERVISOR'),/CASE_RESTRICTION_STILL_ACTIVE/);
    row=await db.cases.releaseRestriction(row.id,row.version,{
      authorityReference:'POC-REL-123',rectificationEvidenceRef:'POC-EVID-123'
    });
    assert.equal(row.restriction.status,'SIMULATED_RELEASED');
  }finally{db.close();}
});
test('Detention modification queues original AI action, never applies real no-departure ban',async()=>{
  const db=setup();
  try{
    let row=await opened(db);
    row=await db.cases.saveActionPlan(row.id,row.version,normalized(row,['PRIORITY_INSPECTION']));
    row=await db.cases.decideOperational(row.id,row.version,{
      decision:'MODIFY',newDecisionCode:'DETAIN_PENDING_RECTIFICATION',
      note:'POC operator proposes detention for competent-authority inspection review'
    });
    assert.equal(row.restriction.type,'DETENTION');
    assert.equal(row.restriction.status,'PENDING_AUTHORITY_APPROVAL');
    assert.equal(row.decisionFeedback[0].originalA01Proposal.actionType,'PRIORITY_INSPECTION');
    assert.equal(row.decisionFeedback[0].humanApprovedCode,'DETAIN_PENDING_RECTIFICATION');
    assert.equal(row.inspectionRequests.length,0);
    assert.equal(row.tasks.every(t=>t.regulatedEnforcement),true);
  }finally{db.close();}
});
