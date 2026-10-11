import test from 'node:test';
import assert from 'node:assert/strict';
import {createAiriaIncidentTriage,AIRIA_INCIDENT_CONTRACT} from '../nmc-incident-airia.mjs';

const incident={
 incidentId:'INC-POC-0001',sourceReference:'PORT-DEMO-26-001',
 sourceType:'PORT_AUTHORITY',sourceOrganization:'Fujairah POC',
 imo:'9328471',incidentType:'FIRE',description:
 'Port reports potential smoke near engine room ventilation; unconfirmed.',
 reportedSeverity:'HIGH',sourceIncidentStatus:'REPORTED',
 operationalStatus:'RECEIVED',reportedAt:'2026-10-11T08:20:00Z',
 occurredAt:'2026-10-11T08:05:00Z',portOrZone:'Fujairah Anchorage',
 evidenceReference:'EVID-DEMO-FUJ-001'
};
const saved={
 status:'COMPLETED',assessmentId:'ASSESSMENT-001',
 score:60,level:'Watch',configVersion:'NMC_POC_V1',
 signals:[
  {factor:'movement',severity:20,evidenceIds:['AIS-001'],reason:'No verified change'},
  {factor:'history',severity:35,evidenceIds:['PSC-001'],reason:'Historical inspection'},
  {factor:'inspection',severity:50,evidenceIds:['DEF-001'],reason:'Open finding'},
  {factor:'certificate',severity:25,evidenceIds:['CERT-001'],reason:'Certificate review'},
  {factor:'dataQuality',severity:30,evidenceIds:['DQC-001'],reason:'Unverified source'}
 ]
};
const incidentRef='INCIDENT-INC-POC-0001';
const compliance={
 incidentCompliance:{status:'INSUFFICIENT_EVIDENCE',
  reasoning:'The original smoke report is not verified and does not prove a compliance breach.',
  evidenceIds:[incidentRef,'DEF-001'],confidence:.7,
  missingInformation:['Verified onboard inspection']}
};
const triage={
 incidentTriage:{
  category:'FIRE',impact:4,urgency:5,exposure:4,recurrence:1,
  recommendedFollowup:'INCIDENT_RESPONSE',
  reasoning:'The unverified report of smoke calls for quick confirmation and possible local coordination.',
  confidence:.83,missingInformation:['Smoke source confirmation'],
  evidenceIds:[incidentRef,'AIS-001']
 }
};
const make=(changes={})=>{
 const calls=[];
 const impl=async(agent,payload)=>{
  calls.push({agent,payload});
  return agent==='a02'?changes.a02??compliance:changes.a01??triage;
 };
 return {calls,run:createAiriaIncidentTriage({
  executeAgent:impl,getFleetResult:()=>changes.saved??saved,
  enabled:()=>changes.enabled??true
 })};
};
test('reuses existing A02 then A01 pipelines, preserving official risk',async()=>{
 const {calls,run}=make();
 const result=await run(incident);
 assert.deepEqual(calls.map(x=>x.agent),['a02','a01']);
 assert.equal(calls[0].payload.mode,'COMPLIANCE_EVALUATION');
 assert.equal(calls[1].payload.mode,'SITUATION_ASSESSMENT');
 assert.equal(calls[0].payload.officialRisk.score,60);
 assert.equal(calls[1].payload.officialRisk.score,60);
 assert.equal(calls[1].payload.incidentContext.originalDescription,incident.description);
 assert.equal(result.incidentRiskScore,77);
 assert.equal(result.incidentRiskBand,'CRITICAL');
 assert.equal(result.a02IncidentCompliance.status,'INSUFFICIENT_EVIDENCE');
 assert.equal(result.contractVersion,AIRIA_INCIDENT_CONTRACT);
 assert.deepEqual(result.sourceAgents,['A02','A01']);
 assert.equal(saved.score,60);
});
test('missing legacy A02 incident extension is NOT accepted as incident compliance',async()=>{
 const {run,calls}=make({a02:{signals:[
  {factor:'inspection',severity:91,confidence:.8,evidenceIds:['DEF-001']}]}
 });
 await assert.rejects(()=>run(incident),/INCIDENT_A02_CONTRACT_EXTENSION_REQUIRED/);
 assert.deepEqual(calls.map(x=>x.agent),['a02']);
});
test('missing legacy A01 incident extension is NOT converted from official vessel risk',async()=>{
 const {run,calls}=make({a01:{
  summary:'Unverified smoke',whyItMatters:'Safety concerns',
  proposedActions:[{actionType:'PRIORITY_INSPECTION',confidence:.8}]
 }});
 await assert.rejects(()=>run(incident),/INCIDENT_A01_CONTRACT_EXTENSION_REQUIRED/);
 assert.deepEqual(calls.map(x=>x.agent),['a02','a01']);
});
test('unverified invented agent evidence ID is rejected',async()=>{
 const {run}=make({a01:{incidentTriage:{
  ...triage.incidentTriage,evidenceIds:[incidentRef,'INVENTED-999']
 }}});
 await assert.rejects(()=>run(incident),/INCIDENT_A01_CONTRACT_EXTENSION_REQUIRED/);
});
test('unknown vessel or missing stored A01/A02 scoring prevents incident assessment',async()=>{
 let ctx=make();
 await assert.rejects(()=>ctx.run({...incident,imo:'UNKNOWN'}),/INCIDENT_VESSEL_CONTEXT_REQUIRED/);
 ctx=make({saved:null});
 await assert.rejects(()=>ctx.run(incident),/INCIDENT_SAVED_VESSEL_EVIDENCE_REQUIRED/);
 assert.equal(ctx.calls.length,0);
});
test('disabled shared Airia agents prevent new incident calls',async()=>{
 const ctx=make({enabled:false});
 await assert.rejects(()=>ctx.run(incident),/AIRIA_A01_A02_NOT_ENABLED/);
 assert.equal(ctx.calls.length,0);
});
