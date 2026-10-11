import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NmcIncidentFeed,IncidentTriageError,parseIncidentSheet,validateIncidentAI
} from '../nmc-incident-feed.mjs';

const registryHeaders=[
 'Incident_ID','Source_Type','Source_Organization','Source_Reference',
 'Reported_At_UTC','Occurred_At_UTC','IMO','Vessel_Name','Incident_Type',
 'Port_or_Zone','Latitude','Longitude','Incident_Description',
 'Source_Incident_Status','Operational_Status','Reported_Severity',
 'Persons_Affected','Pollution_Reported','Evidence_Reference','Source_URL',
 'Received_At_UTC','Updated_At_UTC','Assigned_Officer','Officer_Notes',
 'Data_Nature','AI_Review_Request'
];
const incidentRow=[
 'INC-POC-0001','PORT_AUTHORITY','Fujairah Port POC','SOURCE-001',
 '2026-10-11T08:20:00Z','2026-10-11T08:05:00Z','9328471',
 'MV Gulf Horizon','FIRE','Fujairah Anchorage','','',
 'Port report indicates smoke in engine room, source not confirmed. Crew requires verification.',
 'REPORTED','RECEIVED','HIGH','0','UNKNOWN','TEST-EVID-001','',
 '2026-10-11T08:23:00Z','2026-10-11T08:23:00Z','','',
 'SYNTHETIC_POC','YES'
];
const candidate={
 category:'FIRE',impact:4,urgency:5,exposure:4,recurrence:1,
 recommendedFollowup:'INCIDENT_RESPONSE',
 reasoning:'Unconfirmed onboard smoke in a populated operational area requires urgent verification.',
 confidence:.84,missingInformation:['Onboard verification']
};
const sheetsHeaders=[
 'Incident_ID','Description_SHA256','Assessment_ID','Assessed_At_UTC',
 'AI_Provider','AI_Model','AI_Incident_Category','Policy_Impact_0_5',
 'Policy_Urgency_0_5','Policy_Exposure_0_5','Policy_Recurrence_0_5',
 'Incident_Risk_Score_0_100','Incident_Risk_Band','AI_Proposed_Followup',
 'AI_Reasoning','AI_Confidence_0_1','Missing_Information',
 'Officer_Decision','Officer_Name','Officer_Reviewed_At_UTC',
 'Approved_Followup_Status','Linked_Case_ID','Assessment_Status','Governance_Notice',
 'AI_Suggested_Followup_State','Officer_Approved_Followup_State','Officer_Review_Reason',
 'A01_Incident_Evidence_IDs','A02_Incident_Compliance_Status',
 'A02_Incident_Evidence_IDs','A02_Incident_Reasoning',
 'Incident_Agent_Contract_Version'
];
function mockFeed(){
 const appended=[];
 const fake=new NmcIncidentFeed({sheetId:'TEST-SHEET',
  agentEnabled:()=>true,executeIncidentAgents:async()=>({}),
  fetchImpl:()=>{throw Error('No network')}});
 fake.sheets=async(method,range,options)=>{
  if(method==='GET'&&range.startsWith('Incident_Registry'))
    return {values:[registryHeaders,incidentRow]};
  if(method==='GET'&&range.startsWith('AI_Assessments'))
    return {values:[sheetsHeaders,...appended]};
  if(method==='POST'&&range.startsWith('AI_Assessments')){
    appended.push(...options.values);
    return {updates:{updatedRows:1}};
  }
  throw Error('Unexpected Sheets operation');
 };
 fake.runAI=async()=>({...validateIncidentAI(candidate),
  aiEvidenceIds:['INCIDENT-INC-POC-0001'],
  a02IncidentCompliance:{
   status:'INSUFFICIENT_EVIDENCE',evidenceIds:['INCIDENT-INC-POC-0001'],
   reasoning:'Compliance evidence is not sufficient to confirm any non-compliance.',
   authoritative:false
  },
  contractVersion:'A01_A02_EXISTING_CONTRACTS_V1'
 });
 return {fake,appended};
}
test('single source incident remains labelled synthetic and preserves its description',()=>{
 const rows=parseIncidentSheet([registryHeaders,incidentRow]);
 assert.equal(rows.length,1);
 assert.equal(rows[0].imo,'9328471');
 assert.equal(rows[0].description,incidentRow[12]);
 assert.equal(rows[0].dataNature,'SYNTHETIC_POC');
 assert.equal(rows[0].operationalStatus,'RECEIVED');
});
test('validates model fields; computes advisory risk 77, not official vessel risk',()=>{
 const result=validateIncidentAI(candidate);
 assert.equal(result.incidentRiskScore,77);
 assert.equal(result.incidentRiskBand,'CRITICAL');
 assert.equal(result.requiresHumanReview,true);
 assert.equal(result.regulatoryEffect,'NONE_POC_ONLY');
});
test('rejects AI inventing unapproved detention, port ban or free-text statuses',()=>{
 assert.throws(()=>validateIncidentAI({...candidate,
  recommendedFollowup:'BAN_ALL_UAE_PORTS'}),/INCIDENT_AI_RESPONSE_INVALID/);
 assert.throws(()=>validateIncidentAI({...candidate,
  recommendedFollowup:'DETAIN'}),/INCIDENT_AI_RESPONSE_INVALID/);
});
test('AI analysis runs only after explicit cost approval; saves separate sheet record',async()=>{
 const {fake,appended}=mockFeed();
 await assert.rejects(()=>fake.analyze('INC-POC-0001'),/INCIDENT_AI_CONFIRMATION_REQUIRED/);
 assert.equal(appended.length,0);
 const r=await fake.analyze('INC-POC-0001',{confirmCost:true});
 assert.equal(r.assessment.incidentRiskScore,77);
 assert.equal(appended.length,1);
 assert.equal(appended[0][11],77);
 assert.equal(appended[0][14],candidate.reasoning);
 assert.equal(appended[0][22],'AI_COMPLETE');
 assert.equal(appended[0][23].includes('not vessel overall risk'),true);
 const reused=await fake.analyze('INC-POC-0001',{confirmCost:true});
 assert.equal(reused.reused,true);
 assert.equal(appended.length,1);
});
test('human modification retains original AI follow-up and adds separate audited row',async()=>{
 const {fake,appended}=mockFeed();
 const ai=await fake.analyze('INC-POC-0001',{confirmCost:true});
 await fake.review('INC-POC-0001',{
  assessmentId:ai.assessment.assessmentId,decision:'MODIFY',
  approvedFollowup:'REFER_SMART_INSPECTION',
  officer:'NMC Inspector',note:'Officer examined reported smoke and requests an inspection review'
 });
 assert.equal(appended.length,2);
 assert.equal(appended[0][13],'INCIDENT_RESPONSE');
 assert.equal(appended[1][13],'INCIDENT_RESPONSE');
 assert.equal(appended[1][20],'REFER_SMART_INSPECTION');
 assert.equal(appended[1][22],'HUMAN_REVIEWED');
 assert.equal(appended[1][17],'MODIFY');
 const feed=await fake.load();
 assert.equal(feed.incidents[0].operationalStatus,'RECEIVED');
 assert.equal(feed.incidents[0].aiAssessment.approvedFollowupStatus,'REFER_SMART_INSPECTION');
 assert.equal(feed.incidents[0].aiAssessment.officerDecision,'MODIFY');
});
test('changes to source description invalidate previous AI assessment',async()=>{
 const {fake,appended}=mockFeed();
 await fake.analyze('INC-POC-0001',{confirmCost:true});
 incidentRow[12]+=' New verified update.';
 try{
  const list=await fake.load();
  assert.equal(list.incidents[0].aiAssessment,null);
  assert.equal(list.incidents[0].aiAssessmentStale,true);
 }finally{incidentRow[12]=incidentRow[12].replace(' New verified update.','');}
 assert.equal(appended.length,1);
});

test('proposed incident follow-up is a separate next-step state, not a regulatory incident status',async()=>{
 const {fake,appended}=mockFeed();
 const result=await fake.analyze('INC-POC-0001',{confirmCost:true});
 assert.equal(result.assessment.aiProposedFollowup,'INCIDENT_RESPONSE');
 assert.equal(result.assessment.suggestedFollowupState,'RESPONSE_COORDINATION_PENDING');
 assert.equal(appended[0].length,32);
 assert.equal(appended[0][24],'RESPONSE_COORDINATION_PENDING');
 assert.equal(appended[0][28],'INSUFFICIENT_EVIDENCE');
 const view=await fake.load();
 assert.equal(view.incidents[0].operationalStatus,'RECEIVED');
 assert.deepEqual(view.incidents[0].nextFollowup,{
  status:'RESPONSE_COORDINATION_PENDING',approval:'AI_PROPOSED',
  reason:candidate.reasoning
 });
});
test('officer-modified next-step is distinct from AI advice and immutable source status',async()=>{
 const {fake,appended}=mockFeed();
 const evaluated=await fake.analyze('INC-POC-0001',{confirmCost:true});
 const reason='Source report examined; send evidence for an inspection referral review';
 const reviewed=await fake.review('INC-POC-0001',{
  assessmentId:evaluated.assessment.assessmentId,decision:'MODIFY',
  approvedFollowup:'REFER_SMART_INSPECTION',officer:'NMC Inspector',note:reason
 });
 assert.equal(reviewed.approvedFollowupState,'INSPECTION_REFERRAL_PENDING');
 assert.equal(appended[0][24],'RESPONSE_COORDINATION_PENDING');
 assert.equal(appended[1][24],'RESPONSE_COORDINATION_PENDING');
 assert.equal(appended[1][25],'INSPECTION_REFERRAL_PENDING');
 assert.equal(appended[1][26],reason);
 assert.equal(appended[1].length,32);
 assert.equal(appended[1][31],'NMC_INCIDENT_A01_A02_EXT_V1');
 const view=await fake.load();
 assert.equal(view.incidents[0].operationalStatus,'RECEIVED');
 assert.equal(view.incidents[0].nextFollowup.approval,'OFFICER_APPROVED');
 assert.equal(view.incidents[0].nextFollowup.status,'INSPECTION_REFERRAL_PENDING');
 await assert.rejects(()=>fake.analyze('INC-POC-0001',{
  confirmCost:true,force:true}),/INCIDENT_ALREADY_REVIEWED/);
});
test('scheduled triage remains off by default; when enabled it respects source opt-in and no duplicate assessments',async()=>{
 const {fake,appended}=mockFeed();
 assert.equal((await fake.autoTick()).enabled,false);
 assert.equal(appended.length,0);
 fake.autoEnabled=true;fake.autoMaxPerCycle=1;
 incidentRow[25]='NO';
 try{
  const blocked=await fake.autoTick();
  assert.equal(blocked.assessed,0);
  assert.equal(appended.length,0);
 }finally{incidentRow[25]='YES';}
 const once=await fake.autoTick();
 assert.equal(once.assessed,1);
 assert.equal(appended.length,1);
 const twice=await fake.autoTick();
 assert.equal(twice.assessed,0);
 assert.equal(appended.length,1);
});

test('Arabic officer names can approve an incident follow-up without changing reported status',async()=>{
 const {fake}=mockFeed();
 const ai=await fake.analyze('INC-POC-0001',{confirmCost:true});
 const reviewed=await fake.review('INC-POC-0001',{
  assessmentId:ai.assessment.assessmentId,
  decision:'ACCEPT',
  approvedFollowup:'INCIDENT_RESPONSE',
  officer:'موظف المركز البحري',
  note:'تمت مراجعة وصف البلاغ ويلزم التنسيق للتحقق من حالة الدخان'
 });
 assert.equal(reviewed.saved,true);
 const output=await fake.load();
 assert.equal(output.incidents[0].aiAssessment.officerName,'موظف المركز البحري');
 assert.equal(output.incidents[0].operationalStatus,'RECEIVED');
});

test('automatic source triage creates or links a central Case only after saved assessment',async()=>{
 const {fake,appended}=mockFeed();
 const linked=[];
 fake.autoEnabled=true;
 fake.autoMaxPerCycle=2;
 fake.onAssessmentReady=async incident=>{
   linked.push({incidentId:incident.incidentId,assessmentId:incident.aiAssessment?.assessmentId});
 };
 const run=await fake.autoTick();
 assert.equal(run.assessed,1);
 assert.equal(run.casesLinked,1);
 assert.equal(run.casesFailed,0);
 assert.equal(appended.length,1);
 assert.equal(linked[0].incidentId,'INC-POC-0001');
 assert.ok(linked[0].assessmentId);
 const repeated=await fake.autoTick();
 assert.equal(repeated.assessed,0);
 assert.equal(repeated.casesLinked,1,
  'previously assessed incident is rechecked for idempotent case linking without AI billing');
 assert.equal(appended.length,1);
});
test('case persistence unavailable does not trigger expensive repeated analysis',async()=>{
 const {fake,appended}=mockFeed();
 fake.autoEnabled=true;
 fake.onAssessmentReady=async()=>{throw new Error('CASE_STORE_UNAVAILABLE');};
 const run=await fake.autoTick();
 assert.equal(run.assessed,1);
 assert.equal(run.casesFailed,1);
 assert.equal(appended.length,1);
 const second=await fake.autoTick();
 assert.equal(second.assessed,0);
 assert.equal(second.casesFailed,1);
 assert.equal(appended.length,1);
});
