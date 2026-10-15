import test from 'node:test';
import assert from 'node:assert/strict';
import {createAiriaIncidentTriage,INCIDENT_CONTRACT,scoreIncidentFromEvidence}
  from '../nmc-incident-airia.mjs';

const report={
 incidentId:'INC-POC-0001',sourceReference:'PORT-DEMO-26-001',
 sourceType:'PORT_AUTHORITY',sourceOrganization:'Port POC',imo:'9328471',
 incidentType:'FIRE',description:'Crew reports smoke from engine room but source is unconfirmed.',
 reportedSeverity:'HIGH',sourceIncidentStatus:'REPORTED',
 operationalStatus:'RECEIVED',reportedAt:'2026-10-11T08:20:00Z',
 portOrZone:'Fujairah Anchorage'
};
const evidence='INCIDENT-INC-POC-0001';
const saved={
 status:'COMPLETED',assessmentId:'ASSESSMENT-VESSEL-1',
 score:60,level:'Watch',configVersion:'VERSION-1',
 signals:[
  {factor:'movement',severity:20,evidenceIds:['AIS-001'],reason:'Vessel motion'},
  {factor:'history',severity:35,evidenceIds:['PSC-001'],reason:'Historical inspection'},
  {factor:'inspection',severity:50,evidenceIds:['DEF-001'],reason:'Outstanding finding'},
  {factor:'certificate',severity:25,evidenceIds:['CERT-001'],reason:'Certificate review'},
  {factor:'dataQuality',severity:30,evidenceIds:['DQC-001'],reason:'Source discrepancy'}
 ]
};
const bundle={
 imo:'9328471',
 evidenceIds:['AIS-001','PSC-001','DEF-001','CERT-001','DQC-001'],
 inlineContext:{vessel:{imo:'9328471',name:'MV Gulf Horizon'},
   deficiencies:[{status:'OPEN',evidenceId:'DEF-001'}]}
};
const a02={
 signals:['inspection','certificate','dataQuality'].map((factor,i)=>({
  factor,sourceAgent:'A02',status:'AVAILABLE',
  severity:[50,25,30][i],confidence:.83,
  evidenceIds:[['DEF-001','CERT-001','DQC-001'][i]],
  reason:'Existing compliance factor'
 }))
};
const a01={
 summary:'Reported smoke on vessel; source and severity unverified.',
 whyItMatters:'The reported onboard smoke may require additional verification and inspection.',
 evidence:[{type:'INSPECTION',evidenceIds:[evidence]}],
 proposedActions:[{actionId:'priority-inspection-incident',
  actionType:'PRIORITY_INSPECTION',
  title:'Request inspection review',
  reason:'Crew report requires checking',
  priority:'HIGH',confidence:.83,evidenceIds:[evidence],
  requiresHumanApproval:true}]
};
const testAdapter=(override={})=>{
 const calls=[];
 const run=createAiriaIncidentTriage({
  executeAgent:async(agent,payload)=>{
   calls.push({agent,payload});
   if(agent==='a02')return override.a02??{result:a02};
   return override.a01??{result:a01};
  },
  getFleetResult:()=>override.saved===undefined?saved:override.saved,
  getBundle:()=>override.bundle===undefined?bundle:override.bundle,
  enabled:()=>override.enabled??true
 });
 return {calls,run};
};
test('A02 uses EXACT existing fleet signals request and response; A01 uses EXACT existing situation contract',async()=>{
 const {calls,run}=testAdapter();
 const x=await run(report);
 assert.deepEqual(calls.map(v=>v.agent),['a02','a01']);
 assert.deepEqual(Object.keys(calls[0].payload).sort(),[
  'requestMeta','subject','bundleRef','contextMode','officialScoringRequested',
  'inlineContext','requestedSignals'].sort());
 assert.deepEqual(calls[0].payload.requestedSignals,['inspection','certificate','dataQuality']);
 assert.equal(calls[0].payload.inlineContext.incidentReports[0].description,report.description);
 assert.deepEqual(Object.keys(calls[1].payload).sort(),[
  'requestMeta','subject','bundleRef','mode','officialRisk','riskSignalRunId',
  'requestedOutputs','approvedSignalEvidence','provenance'].sort());
 assert.equal(calls[1].payload.mode,'SITUATION_ASSESSMENT');
 assert.deepEqual(calls[1].payload.requestedOutputs,
  ['SUMMARY','WHY_IT_MATTERS','EVIDENCE','ACTIONS']);
 assert.equal(calls[1].payload.approvedSignalEvidence.find(v=>v.factor==='history')
  .evidenceIds.includes(evidence),true);
 assert.equal(calls[1].payload.approvedSignalEvidence.find(v=>v.factor==='history')
  .reason.includes(report.description),true);
 assert.equal(x.contractVersion,INCIDENT_CONTRACT);
 assert.equal(x.agentGrounding,'A01_CITED_INCIDENT_REPORT');
 assert.equal(x.aiProposedFollowup,'REFER_SMART_INSPECTION');
 assert.equal(x.a02IncidentCompliance.status,'VESSEL_COMPLIANCE_SIGNALS_ONLY');
 assert.equal(x.scoringSource,'NMC_DETERMINISTIC_INCIDENT_POLICY');
 assert.equal(x.incidentRiskScore,67);
 assert.equal(saved.score,60);
 assert.deepEqual(saved.signals[1].evidenceIds,['PSC-001']);
});
test('existing A01 response without report evidence citation does NOT count as AI analysis of incident',async()=>{
 const without={...a01,evidence:[],proposedActions:[{
  ...a01.proposedActions[0],evidenceIds:['PSC-001']}]};
 const {run}=testAdapter({a01:{result:without}});
 await assert.rejects(()=>run(report),/INCIDENT_A01_DID_NOT_CITE_REPORT/);
});
test('refuse invalid existing A02 signal payload and do not invoke A01',async()=>{
 const ctx=testAdapter({a02:{result:{signals:[{factor:'dataQuality'}]}}});
 await assert.rejects(()=>ctx.run(report),/INCIDENT_A02_EXISTING_RESPONSE_INVALID/);
 assert.deepEqual(ctx.calls.map(x=>x.agent),['a02']);
});
test('reject made-up A01 evidence and invalid fleet assessment',async()=>{
 const withUnknown={...a01,evidence:[{type:'INSPECTION',evidenceIds:['FAKE-REPORT']} ]};
 await assert.rejects(()=>testAdapter({a01:{result:withUnknown}}).run(report),
  /INCIDENT_A01_UNVERIFIED_EVIDENCE/);
 await assert.rejects(()=>testAdapter({saved:null}).run(report),
  /INCIDENT_SAVED_VESSEL_EVIDENCE_REQUIRED/);
});
test('rules never confuse missing reported severity with verified low-risk incident',()=>{
 const score=scoreIncidentFromEvidence({...report,reportedSeverity:'NOT_SPECIFIED'},
  {whyItMatters:'Unverified source report',confidence:.81,proposedActions:[
   {type:'ENHANCED_MONITORING',priority:'MEDIUM',confidence:.81}]},[]);
 assert.ok(score.missingInformation.includes('Confirm incident severity with reporting authority'));
 assert.equal(score.aiProposedFollowup,'ACTIVE_MONITORING');
 assert.equal(score.scoringSource,'NMC_DETERMINISTIC_INCIDENT_POLICY');
});
test('missing legacy vessel bundle or disabled A01/A02 prevents incident AI calls',async()=>{
 const absent=testAdapter({bundle:null});
 await assert.rejects(()=>absent.run(report),/INCIDENT_VESSEL_BUNDLE_REQUIRED/);
 assert.equal(absent.calls.length,0);
 const disabled=testAdapter({enabled:false});
 await assert.rejects(()=>disabled.run(report),/AIRIA_A01_A02_NOT_ENABLED/);
 assert.equal(disabled.calls.length,0);
});
