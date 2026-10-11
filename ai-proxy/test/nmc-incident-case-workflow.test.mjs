import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {NmcAlertWorkspace} from '../alert-workspace.mjs';
import {NmcCaseWorkspace} from '../case-workspace.mjs';

const imo='9328471';
const originalVesselRisk={imo,status:'COMPLETED',assessmentId:'FLEET-A01A02-1',
  score:60,level:'Watch'};
const source=id=>({
 incidentId:id,imo,sourceOrganization:'Fujairah Port - SYNTHETIC',
 sourceType:'PORT_AUTHORITY',sourceReference:'PORT-26-01',
 sourceIncidentStatus:'REPORTED',operationalStatus:'RECEIVED',
 incidentType:'FIRE',portOrZone:'Fujairah Anchorage',
 description:'Crew reports smoke around engine room. Causes are not verified.',
 reportedSeverity:'HIGH',descriptionHash:'sha256-test-'+id,
 receivedAt:'2026-10-11T20:00:00Z'
});
const scored=x=>({
 assessmentId:'ASSESSMENT-'+x.incidentId,
 descriptionHash:x.descriptionHash,
 assessmentStatus:'AI_COMPLETE',assessedAt:'2026-10-11T20:08:00Z',
 incidentRiskScore:73,incidentRiskBand:'HIGH',
 aiProposedFollowup:'REFER_SMART_INSPECTION',
 suggestedFollowupState:'INSPECTION_REFERRAL_PENDING',
 contractVersion:'A01_A02_EXISTING_CONTRACTS_V1',
 aiEvidenceIds:['INCIDENT-'+x.incidentId,'INS-2026-01301'],
 a02IncidentCompliance:{status:'VESSEL_COMPLIANCE_SIGNALS_ONLY'}
});
function setup(){
 const dir=mkdtempSync(join(tmpdir(),'nmc-auto-inc-case-'));
 const alerts=new NmcAlertWorkspace({mode:'json',file:join(dir,'alerts.json')});
 const cases=new NmcCaseWorkspace({mode:'json',file:join(dir,'cases.json'),alerts});
 return {cases,close:()=>rmSync(dir,{recursive:true,force:true})};
}
test('auto source intake makes one audited pending case, never an inspection or approved task',async()=>{
 const db=setup();
 try{
  const incident=source('INC-POC-0001'),ai=scored(incident);
  const created=await db.cases.fromIncident(incident,ai,originalVesselRisk);
  assert.equal(created.source,'GOOGLE_SHEETS_INCIDENT');
  assert.equal(created.sourceScore,60);
  assert.equal(created.incidentEvents[0].incidentRiskScore,73);
  assert.equal(created.incidentEvents[0].decisionStatus,'PENDING_HUMAN_REVIEW');
  assert.deepEqual(created.tasks,[]);
  assert.deepEqual(created.inspectionRequests,[]);
  const repeated=await db.cases.fromIncident(incident,ai,originalVesselRisk);
  assert.equal(repeated.id,created.id);
  assert.equal(repeated.version,1,'idempotent re-poll must not add an audit event');
  const history=await db.cases.history(created.id);
  assert.equal(history.length,1);
  assert.equal(history[0].action,'INCIDENT_CASE_CREATED');
 }finally{db.close();}
});
test('two incidents for same IMO join existing NMC case, not duplicate vessel cases',async()=>{
 const db=setup();
 try{
  const first=source('INC-POC-0001'),second=source('INC-POC-0003');
  const one=await db.cases.fromIncident(first,scored(first),originalVesselRisk);
  const two=await db.cases.fromIncident(second,scored(second),originalVesselRisk);
  assert.equal(two.id,one.id);
  assert.equal(two.incidentEvents.length,2);
  assert.equal((await db.cases.list()).length,1);
  assert.equal(two.tasks.length,0);
 }finally{db.close();}
});
test('only authorized case-review decision creates an accountable Smart Inspection referral',async()=>{
 const db=setup();
 try{
  const incident=source('INC-POC-0001');
  const opened=await db.cases.fromIncident(incident,scored(incident),originalVesselRisk);
  await assert.rejects(()=>db.cases.decideIncident(opened.id,opened.version,incident.incidentId,{
   decision:'ACCEPT',approvedFollowup:'REFER_SMART_INSPECTION',
   officer:'MOEI Officer',note:'short'
  }),/CASE_INCIDENT_DECISION_INVALID/);
  const approved=await db.cases.decideIncident(opened.id,opened.version,incident.incidentId,{
   decision:'ACCEPT',approvedFollowup:'REFER_SMART_INSPECTION',
   officer:'MOEI Officer',
   note:'Port incident requires focused verification through the approved Smart Inspection queue.'
  });
  assert.equal(approved.incidentEvents[0].decisionStatus,'OFFICER_APPROVED');
  assert.equal(approved.incidentEvents[0].approvedFollowup,'REFER_SMART_INSPECTION');
  assert.ok(approved.tasks.length>0);
  assert.ok(approved.tasks.every(t=>t.provenance==='NMC_INCIDENT_HUMAN_APPROVED'));
  assert.equal(approved.inspectionRequests.length,1);
  assert.equal(approved.inspectionRequests[0].status,'PENDING_SCHEDULING');
  assert.equal(approved.inspectionRequests[0].incidentId,incident.incidentId);
  assert.equal(approved.sourceScore,60);
  await assert.rejects(()=>db.cases.decideIncident(opened.id,opened.version,incident.incidentId,{
   decision:'ACCEPT',approvedFollowup:'REFER_SMART_INSPECTION',officer:'MOEI Officer',
   note:'Trying to approve the same case decision again.'
  }),/CASE_VERSION_CONFLICT/);
  const history=await db.cases.history(opened.id);
  assert.equal(history[0].action,'INCIDENT_DECISION_ACCEPT');
  const result=await db.cases.listInspectionRequests();
  assert.equal(result.length,1);
 }finally{db.close();}
});
test('source report without grounded saved existing A01/A02 assessment is rejected',async()=>{
 const db=setup();
 try{
  const inc=source('INC-POC-0001');
  await assert.rejects(()=>db.cases.fromIncident(inc,{
   ...scored(inc),contractVersion:'UNSUPPORTED_FAKE_V2'
  },originalVesselRisk),/CASE_INCIDENT_ASSESSMENT_NOT_VERIFIED/);
  await assert.rejects(()=>db.cases.fromIncident(inc,{
   ...scored(inc),aiEvidenceIds:['OTHER-REFERENCE']
  },originalVesselRisk),/CASE_INCIDENT_ASSESSMENT_NOT_VERIFIED/);
  assert.equal((await db.cases.list()).length,0);
 }finally{db.close();}
});
test('case rejects officer action mismatches and creates manual verification tasks on rejection',async()=>{
 const db=setup();
 try{
  const inc=source('INC-POC-0001');
  const opened=await db.cases.fromIncident(inc,scored(inc),originalVesselRisk);
  const note='The report cannot be confirmed; seek original port source evidence.';
  await assert.rejects(()=>db.cases.decideIncident(opened.id,opened.version,inc.incidentId,{
   decision:'MODIFY',approvedFollowup:'REFER_SMART_INSPECTION',note,officer:'Officer'
  }),/CASE_INCIDENT_DECISION_MISMATCH/);
  const reviewed=await db.cases.decideIncident(opened.id,opened.version,inc.incidentId,{
   decision:'REJECT',approvedFollowup:'VERIFY_INFORMATION',note,officer:'Officer'
  });
  assert.equal(reviewed.tasks.length,2);
  assert.deepEqual(reviewed.inspectionRequests,[]);
  assert.equal(reviewed.incidentEvents[0].officerDecision,'REJECT');
 }finally{db.close();}
});
