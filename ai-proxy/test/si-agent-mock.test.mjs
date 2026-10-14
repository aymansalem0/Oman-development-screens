import test from 'node:test';
import assert from 'node:assert/strict';
import {buildC01Source,validateC01,unwrapC01AiriaResult,c01RecommendationContractFailure,SiCandidateAgent,summarizeC01Readiness} from '../si-candidate-agent.mjs';
import {mockSiC01,mockSiP01,mockSiA04} from '../si-agent-mock.mjs';
import {validateP01} from '../si-ai-prioritization.mjs';
import {validateA04} from '../si-inspection-preparation.mjs';
import {projectInspectionPlan} from '../si-inspection-plan.mjs';
import {inspectionRanking,compareInspections} from '../si-inspection-ranking.mjs';
import {SiCandidateTargeting} from '../si-candidate-targeting.mjs';

const candidate=(key,sourceType,imo,score)=>({
 key,imo,vesselName:'POC Vessel',regime:'FOCUSED_INSPECTION',
 status:'PENDING_REVIEW',inspectionCase:null,
 eligibility:sourceType==='NMC_CASE'?'MANDATORY':'MANUAL_REVIEW',
 priority:'STANDARD',reasons:[],currentRisk:score===null?null:
 {score,level:'High',assessmentId:'assessment-'+imo,policyRevision:2},
 events:[{eventKey:'evt-'+key,sourceEventId:'id-'+key,
  sourceReference:'ref-'+key,sourceType,
  provenance:'SYNTHETIC_POC',approval:'APPROVED',evidenceIds:['ev-'+key]}]
});
const inputs=()=>({
 policy:{version:3},riskPolicyRevision:2,fleetSnapshotId:'fleet-a',
 candidates:[
  candidate('nmc','NMC_CASE','9328471',81),
  candidate('psc','PSC_PORT_CALL','9400409',null),
  {...candidate('approved','NMC_CASE','9438124',62),status:'INSPECTION_CREATED'}
 ]
});
const agent=(targeting=()=>inputs())=>new SiCandidateAgent({
 targeting:{dashboard:async()=>targeting()},
 pscPolicy:async()=>({version:6}),
 provider:'mock',executeAgent:async body=>mockSiC01(body)
});
test('C01 no-cost preview uses only unapproved real source candidates',async()=>{
 const p=await agent().preview();
 assert.equal(p.status,'PREVIEW_ONLY_NO_AI');
 assert.equal(p.externalCalls,0);
 assert.equal(p.provider,'MOCK');
 assert.equal(p.eligibleCount,2);
 assert.equal(p.pscQuotaPolicyRevision,6);
 assert.ok(p.candidates.every(c=>c.candidateKey!=='approved'));
 assert.equal(p.snapshotHash.length,64);
});
test('new rolling plan C01 includes human-approved scheduled NMC and excludes unselected PSC port calls',()=>{
 const d=inputs();
 d.candidates.push({...candidate('nmc-scheduled','NMC_CASE','9311128',77),
   status:'EXTERNALLY_SCHEDULED'});
 d.candidates.push({...candidate('psc-scheduled','PSC_PORT_CALL','9512344',85),
   status:'EXTERNALLY_SCHEDULED'});
 const data=buildC01Source(d,{version:6});
 assert.ok(data.candidates.some(x=>x.candidateKey==='nmc-scheduled'));
 assert.ok(!data.candidates.some(x=>x.candidateKey==='psc-scheduled'));
 assert.ok(!data.candidates.some(x=>x.candidateKey==='approved'));
});
test('C01 returns stable advisory without approving cases or Airia',async()=>{
 const a=agent(),p=await a.preview();
 const r=await a.run({actor:'reviewer',confirmRun:true,
  expectedSnapshotHash:p.snapshotHash});
 assert.equal(r.provider,'MOCK');
 assert.equal(r.externalCalls,0);
 assert.equal(r.mutations,false);
 assert.equal(r.humanDecisionRequired,true);
 assert.equal(r.recommendations.length,2);
 assert.equal(r.recommendations.find(x=>x.candidateKey==='nmc').recommendation,'SELECT_RECOMMENDED');
 assert.equal(r.recommendations.find(x=>x.candidateKey==='psc').recommendation,'SELECT_RECOMMENDED');
 assert.equal(r.recommendations.find(x=>x.candidateKey==='psc').dataGaps[0],'MISSING_NMC_SAVED_RISK_INFORMATIONAL_ONLY');
});
test('C01 never fabricates risk 0 for missing saved assessment',()=>{
 const source=buildC01Source(inputs(),{version:6});
 const r=mockSiC01(source);
 assert.equal(r.recommendations.find(x=>x.candidateKey==='psc').recommendation,'SELECT_RECOMMENDED');
 assert.equal(source.candidates.find(c=>c.candidateKey==='psc').currentRisk,null);
});
test('C01 rejects stale snapshot before any external request',async()=>{
 let snapshot=inputs(),calls=0;
 const a=new SiCandidateAgent({targeting:{dashboard:async()=>snapshot},
  provider:'mock',executeAgent:async b=>{calls++;return mockSiC01(b)}});
 const preview=await a.preview();
 snapshot={...snapshot,policy:{version:4}};
 await assert.rejects(a.run({actor:'reviewer',confirmRun:true,
   expectedSnapshotHash:preview.snapshotHash}),/SI_C01_SOURCE_CHANGED_REPREVIEW/);
 assert.equal(calls,0);
});
test('C01 input must explicitly authorize even a free mock run',async()=>{
 const a=agent(),p=await a.preview();
 await assert.rejects(a.run({actor:'rev',expectedSnapshotHash:p.snapshotHash}),
  /SI_C01_CONFIRMATION_REQUIRED/);
});
test('C01 Airia mode requires separate paid-cost confirmation',async()=>{
 let calls=0;
 const a=new SiCandidateAgent({targeting:{dashboard:async()=>inputs()},provider:'airia',
  executeAgent:async p=>{calls++;return mockSiC01(p)}});
 const p=await a.preview();
 await assert.rejects(a.run({actor:'rev',confirmRun:true,
  expectedSnapshotHash:p.snapshotHash}),/SI_C01_CONFIRMATION_REQUIRED/);
 assert.equal(calls,0);
});
test('C01 fails closed on unknown evidence, duplicate candidates, and regulatory override',()=>{
 const source=buildC01Source(inputs(),{version:6});
 const valid=mockSiC01(source);
 const forged=structuredClone(valid);
 forged.recommendations[0].evidenceRefs=['invented'];
 assert.throws(()=>validateC01(forged,source),/SI_C01_UNVERIFIED_RECOMMENDATION/);
 const repeated=structuredClone(valid);
 repeated.recommendations[1].candidateKey='nmc';
 assert.throws(()=>validateC01(repeated,source),/SI_C01_UNVERIFIED_RECOMMENDATION/);
 const illegal=structuredClone(valid);
 illegal.recommendations[1].recommendation='SELECT_RECOMMENDED';
 illegal.recommendations[1].suggestedRank=2;
 illegal.recommendations[1].evidenceRefs=[];
 assert.throws(()=>validateC01(illegal,source),/SI_C01_HARD_RULE_OVERRIDE/);
});
test('P01 MOCK response passes unchanged existing validator, without model calls',()=>{
 const input={schemaVersion:'SI-P01-v1',candidates:[
 {candidateKey:'one',allowedEvidence:['EV1'],missingData:[]},
 {candidateKey:'two',allowedEvidence:['EV2'],missingData:['MISSING_HISTORY']}
 ]};
 const result=validateP01(mockSiP01(input),input.candidates);
 assert.deepEqual(result.map(x=>x.suggestedRank),[1,2]);
 assert.equal(result[1].evidenceRefs[0],'EV2');
 assert.equal(result[1].status,'ADVISORY_HUMAN_REVIEW');
});
test('A04 MOCK passes existing model response validator; optional item never mandatory',()=>{
 const input={baseChecklistItemIds:['fire-safety','certificates'],
  evidenceManifestRefs:['EV1','EV2']};
 const r=validateA04(mockSiA04(input),{checkIds:input.baseChecklistItemIds,
  evidenceIds:input.evidenceManifestRefs});
 assert.equal(r.suggestedAdditionalItems.length,1);
 assert.equal(r.suggestedAdditionalItems[0].recommendationOnly,true);
 assert.equal(r.predictedDeficiencies.length,0);
 assert.equal(r.requiresInspectorReview,true);
 assert.equal(r.status,'DRAFT_REVIEW');
});
test('C01 preview is deterministic for identical current evidence',()=>{
 const a=buildC01Source(inputs(),{version:1}),b=buildC01Source(inputs(),{version:1});
 assert.equal(a.snapshotHash,b.snapshotHash);
 assert.notEqual(a.snapshotHash,buildC01Source(inputs(),{version:2}).snapshotHash);
});


test('C01 inclusion is independent of NMC risk and source-trigger scores',()=>{
 const d=inputs();
 d.policy.config={ranking:{criteria:['DEPARTURE_SOON','INCIDENT_SEVERITY']}};
 d.candidates.push(candidate('service-no-risk','SERVICE_REQUEST','9700012',null));
 d.candidates.push(candidate('service-low-risk','SERVICE_REQUEST','9700013',4));
 d.candidates.push(candidate('psc-extra','PSC_PORT_CALL','9700015',99));
 const s=buildC01Source(d,{version:6});
 const advice=validateC01(mockSiC01(s),s);
 for(const key of ['service-no-risk','service-low-risk']){
   const a=advice.find(x=>x.candidateKey===key);
   assert.equal(a.recommendation,'SELECT_RECOMMENDED');
   assert.equal(s.candidates.find(x=>x.candidateKey===key).requiredInPlan,true);
 }
 assert.deepEqual(s.ranking.criteria,['DEPARTURE_SOON','INCIDENT_SEVERITY']);
 assert.equal(s.candidates.find(x=>x.candidateKey==='psc').requiredInPlan,false);
});

test('C01 mock and final plan order: verified ETD first, then human-reviewed incident severity',()=>{
 const now=Date.now();
 const hours=n=>new Date(now+n*3600000).toISOString();
 const d={policy:{version:4,config:{ranking:{criteria:['DEPARTURE_SOON','INCIDENT_SEVERITY']}}},
  fleetSnapshotId:'fixed-fleet',riskPolicyRevision:1,candidates:[
  candidate('incident45','SERVICE_REQUEST','9700015',95),
  candidate('departure4','SERVICE_REQUEST','9700014',2),
  candidate('unknown','SERVICE_REQUEST','9700016',80),
  candidate('incident90','NMC_CASE','9700013',4),
  candidate('departure1','SERVICE_REQUEST','9700012',0)
 ]};
 const signals={
  '9700012':{departureAt:hours(1),departureVerified:true},
  '9700014':{departureAt:hours(4),departureVerified:true},
  '9700013':{incidentSeverity:90,incidentHumanReviewed:true},
  '9700015':{incidentSeverity:45,incidentHumanReviewed:true},
  '9700016':{departureAt:hours(0.5),departureVerified:false,
    incidentSeverity:100,incidentHumanReviewed:false}
 };
 d.vesselCandidates=d.candidates.map(c=>({
  imo:c.imo,vesselName:c.vesselName,flag:'UAE',vesselType:'CARGO',
  currentRisk:c.currentRisk,sourceTypes:[c.events[0].sourceType],
  sourceEvents:c.events,regimes:[c.regime],pendingWorkflows:1,
  createdWorkflows:0,scheduledWorkflows:0,...signals[c.imo]
 }));
 const input=buildC01Source(d,{version:1});
 const response=mockSiC01(input),validated=validateC01(response,input);
 const rows=projectInspectionPlan(d,input,{recommendations:validated},{},{});
 assert.deepEqual(rows.filter(x=>x.planSelected).map(x=>x.imo),
  ['9700012','9700014','9700013','9700015','9700016']);
 assert.deepEqual(rows.filter(x=>x.planSelected).map(x=>x.rankingCriterion),
  ['DEPARTURE_SOON','DEPARTURE_SOON','INCIDENT_SEVERITY','INCIDENT_SEVERITY',
   'PENDING_ADDITIONAL_RULES']);
 assert.equal(rows.find(x=>x.imo==='9700013').incidentSeverity,90);
 assert.equal(rows.find(x=>x.imo==='9700014').risk.score,2);
 const modified=projectInspectionPlan(d,input,{recommendations:validated},{
  '9700014':{selected:false,disposition:'NOT_SELECTED',reason:'Reviewed by officer',
    actor:'Supervisor'}
 },{});
 assert.equal(modified.find(x=>x.imo==='9700014').planSelected,false);
});

test('Past ETD, unverified ETA and unreviewed incident are not promoted to priority',()=>{
 const now=Date.now(),past=new Date(now-3600000).toISOString(),
  future=new Date(now+3600000).toISOString();
 assert.equal(inspectionRanking({departureAt:past,departureVerified:true},now).group,2);
 assert.equal(inspectionRanking({eta:future},now).group,2);
 assert.equal(inspectionRanking({departureAt:future,departureVerified:false},now).group,2);
 assert.equal(inspectionRanking({incidentSeverity:95,incidentHumanReviewed:false},now).group,2);
 assert.equal(inspectionRanking({departureAt:future,departureVerified:true},now).group,0);
 assert.equal(inspectionRanking({incidentSeverity:95,incidentHumanReviewed:true},now).group,1);
 assert.ok(compareInspections({imo:'9700012',departureAt:future,departureVerified:true},
  {imo:'9700013',incidentSeverity:95,incidentHumanReviewed:true},now)<0);
});

test('C01 Airia result envelope accepts JSON string output without relaxing business checks',()=>{
  const source=buildC01Source(inputs(),{version:6});
  const valid=mockSiC01(source);
  const variants=[valid,{result:valid},
    {result:JSON.stringify(valid)},
    {result:JSON.stringify({result:valid})},
    JSON.stringify({result:JSON.stringify(valid)})];
  for(const response of variants){
    const parsed=unwrapC01AiriaResult(response);
    assert.ok(parsed);
    assert.deepEqual(validateC01(response,source),
      validateC01(valid,source));
  }
  assert.equal(unwrapC01AiriaResult({result:'not valid JSON'}),null);
  assert.equal(unwrapC01AiriaResult({result:'```json\\n{}\\n```'}),null,
    'markdown fences are not silently accepted');
});
test('C01 rejects truncated Airia result strings and untrusted evidence; no fabricated candidates',()=>{
  const source=buildC01Source(inputs(),{version:6});
  const valid=mockSiC01(source);
  assert.throws(()=>validateC01({
    result:JSON.stringify({recommendations:valid.recommendations.slice(1)})
  },source),e=>e.code==='SI_C01_RESPONSE_INVALID');
  assert.throws(()=>validateC01({result:'unstructured prose'},source),
    e=>e.code==='SI_C01_RESPONSE_INVALID');
  const corrupt=structuredClone(valid);
  corrupt.recommendations[0].evidenceRefs=['INVENTED_BY_MODEL'];
  assert.throws(()=>validateC01({result:JSON.stringify(corrupt)},source),
    e=>e.code==='SI_C01_UNVERIFIED_RECOMMENDATION');
});
test('C01 AIRIA explicit run consumes JSON-string result and remains advisory',async()=>{
  let calls=0;
  const a=new SiCandidateAgent({targeting:{dashboard:async()=>inputs()},
    provider:'airia',executeAgent:async payload=>{
      calls++;
      return {executionId:'partner-test-id',
        result:JSON.stringify(mockSiC01(payload))};
    }});
  const preview=await a.preview();
  const result=await a.run({actor:'supervisor',confirmRun:true,
    confirmCost:true,expectedSnapshotHash:preview.snapshotHash});
  assert.equal(calls,1);
  assert.equal(result.provider,'AIRIA');
  assert.equal(result.mock,false);
  assert.equal(result.externalCalls,1);
  assert.equal(result.humanDecisionRequired,true);
  assert.equal(result.mutations,false);
  assert.equal(result.recommendations.length,preview.eligibleCount);
});

test('C01 diagnoses the exact invalid provider field without accepting it',()=>{
 const source=buildC01Source(inputs(),{version:6});
 const valid=mockSiC01(source);
 const first=valid.recommendations[0];
 const candidate=source.candidates.find(c=>c.candidateKey===first.candidateKey);
 const bad=[
  [{...first,candidateKey:'UNKNOWN'},'CANDIDATE_KEY_UNKNOWN_OR_MISSING',null],
  [{...first},'CANDIDATE_KEY_DUPLICATE',new Set([first.candidateKey])],
  [{...first,recommendation:'SCHEDULE_DIRECTLY'},'RECOMMENDATION_ENUM_INVALID',null],
  [{...first,confidence:'0.8'},'CONFIDENCE_INVALID_NUMBER_OR_RANGE_0_TO_1',null],
  [{...first,reason:''},'REASON_MISSING_OR_INVALID_LENGTH',null],
  [{...first,suggestedRank:'1'},'SELECTED_SUGGESTED_RANK_INVALID',null],
  [{...first,recommendation:'MANUAL_REVIEW',suggestedRank:1},'NON_SELECTED_RANK_MUST_BE_NULL',null],
  [{...first,evidenceRefs:null},'EVIDENCE_REFS_MISSING_OR_TOO_MANY',null],
  [{...first,evidenceRefs:['FAKE_AI_EVIDENCE']},'EVIDENCE_REF_NOT_IN_SOURCE',null],
  [{...first,dataGaps:null},'DATA_GAPS_MISSING_OR_TOO_MANY',null],
  [{...first,dataGaps:[42]},'DATA_GAP_ENTRY_INVALID',null]
 ];
 for(const [item,expected,seen] of bad){
  assert.equal(c01RecommendationContractFailure(item,
    item.candidateKey===first.candidateKey?candidate:undefined,seen||new Set()),expected);
  const response=structuredClone(valid);
  if(expected==='CANDIDATE_KEY_DUPLICATE'){
   // A seen key becomes a duplicate ONLY if a PRIOR entry carried it.
   // With a single recommendation at index 0 this condition never arises.
   response.recommendations[1].candidateKey=first.candidateKey;
  }else response.recommendations[0]=item;
  assert.throws(()=>validateC01({result:JSON.stringify(response)},source),
   e=>e.code==='SI_C01_UNVERIFIED_RECOMMENDATION'&&e.diagnosticCode===expected);
 }
 assert.equal(c01RecommendationContractFailure(first,candidate),null);
});
test('C01 safe warning logs only static reason + index; never ship/source identifiers',()=>{
 const source=buildC01Source(inputs(),{version:6});
 const response=mockSiC01(source);
 response.recommendations[0].evidenceRefs=['secret-source-ref-should-not-appear'];
 const messages=[],oldWarn=console.warn;
 console.warn=(...args)=>messages.push(args.join(' '));
 try{
  assert.throws(()=>validateC01(response,source),e=>e.code==='SI_C01_UNVERIFIED_RECOMMENDATION');
 }finally{console.warn=oldWarn;}
 assert.equal(messages.length,1);
 assert.match(messages[0],/RECOMMENDATION_CONTRACT_REJECTED field=EVIDENCE_REF_NOT_IN_SOURCE itemIndex=0/);
 assert.doesNotMatch(messages[0],/secret-source-ref|9328471|9400409|evt-nmc/);
});

test('C01 safely explains missing Airia priority prose using deterministic rank rules',()=>{
 const source=buildC01Source(inputs(),{version:6});
 for(const missing of [undefined,'', 'short', 'x'.repeat(1600)]){
  const response=mockSiC01(source);
  response.recommendations[0].priorityRationale=missing;
  const result=validateC01({result:JSON.stringify(response)},source);
  assert.equal(result[0].priorityRationaleSource,'DETERMINISTIC_BUSINESS_RULE');
  assert.match(result[0].priorityRationale,/PENDING_ADDITIONAL_RULES/);
  assert.match(result[0].priorityRationale,/AI did not provide usable/);
  assert.equal(result[0].requiresHumanReview,true);
  assert.equal(result[1].priorityRationaleSource,'AGENT_OUTPUT');
 }
});
test('C01 sends the actual imported MSW ETD, port, ETA and evidence; no invented data',()=>{
 const d=inputs(),future=new Date(Date.now()+86400000).toISOString();
 d.candidates[0].events[0]={
  ...d.candidates[0].events[0],
  port:'Jebel Ali',eta:'2026-10-20T09:00:00+04:00',
  departureAt:future,departureVerified:true,
  departureAuthority:'SOURCE_FINAL_NO_DATE_APPROVAL',
  importFile:'MSW_Service_Requests_POC_99_WITH_ETD.xlsx',
  importBatchId:'saved-import-batch',importExcelRow:2,
  contextNote:'Source event requires inspection'
 };
 d.vesselCandidates=[{imo:'9328471',
  departureAt:future,departureVerified:true,departureStatus:'VERIFIED',
  incidentSeverity:65,incidentHumanReviewed:true,incidentEvidenceRef:'incident-001'
 }];
 const source=buildC01Source(d,{version:6}),item=source.candidates[0];
 assert.equal(item.departureAt,future);
 assert.equal(item.rankingContext.criterion,'DEPARTURE_SOON');
 assert.equal(item.sourceEvents[0].port,'Jebel Ali');
 assert.equal(item.sourceEvents[0].eta,'2026-10-20T09:00:00+04:00');
 assert.equal(item.sourceEvents[0].departureAt,future);
 assert.equal(item.sourceEvents[0].importBatchId,'saved-import-batch');
 assert.ok(item.allowedEvidence.includes(item.sourceEvents[0].eventKey));
 assert.ok(!item.missingData.includes('VERIFIED_ETD_UNAVAILABLE'));
 assert.equal(source.candidates[1].departureAt,null);
 assert.ok(source.candidates[1].missingData.includes('VERIFIED_ETD_UNAVAILABLE'));
});
test('C01 treats contradictory saved future ETDs as conflict and never prioritises a made-up date',()=>{
 const dates=[new Date(Date.now()+86400000).toISOString(),
   new Date(Date.now()+2*86400000).toISOString()];
 const rows=[0,1].map(i=>({
  ...candidate('duplicate-'+i,i?'PSC_PORT_CALL':'SERVICE_REQUEST','9328471',null),
  events:[{eventKey:'evt-conflict-'+i,sourceType:i?'PSC_PORT_CALL':'SERVICE_REQUEST',
    sourceReference:'source-'+i,port:'Jebel Ali',departureVerified:true,
    departureAt:dates[i],evidenceIds:['evidence-'+i]}]
 }));
 const vessels=SiCandidateTargeting.prototype._vesselCandidates.call({},rows);
 assert.equal(vessels.length,1);
 assert.equal(vessels[0].departureStatus,'CONFLICT');
 assert.equal(vessels[0].departureAt,null);
 assert.equal(vessels[0].departureVerified,false);
 const d={policy:{version:1},riskPolicyRevision:1,fleetSnapshotId:'test',
  candidates:rows,vesselCandidates:vessels};
 const c=buildC01Source(d,{version:1}).candidates[0];
 assert.equal(c.departureStatus,'CONFLICT');
 assert.ok(c.missingData.includes('CONFLICTING_VERIFIED_ETD'));
 assert.equal(c.rankingContext.criterion,'PENDING_ADDITIONAL_RULES');
});

test('Saved unselected PSC operational ETD informs NMC ranking but not PSC selection',()=>{
 const future=new Date(Date.now()+24*3600000).toISOString();
 const nmc=candidate('nmc-ref','NMC_CASE','9328471',72);
 const sourceEvents=[{eventKey:'msw-psc-saved',payload:{
  sourceType:'PSC_PORT_CALL',imo:'9328471',
  sourceApprovalStatus:'SOURCE_FINAL',sourceEventId:'psc-visit-1',
  sourceReference:'PSC-REF-1',provenance:'POC_SIMULATOR',
  port:'Jebel Ali',departureAt:future,evidenceIds:['PSC-EVIDENCE-1']
 }}];
 const vessels=SiCandidateTargeting.prototype._vesselCandidates.call({},
  [nmc],new Map(),sourceEvents);
 assert.equal(vessels[0].departureAt,future);
 assert.equal(vessels[0].departureVerified,true);
 assert.deepEqual(vessels[0].sourceTypes,['NMC_CASE']);
 assert.equal(vessels[0].operationalSourceEvents.length,1);
 const d={policy:{version:1},riskPolicyRevision:1,fleetSnapshotId:'fleet',
  candidates:[nmc],vesselCandidates:vessels};
 const input=buildC01Source(d,{version:1});
 assert.equal(input.candidates[0].rankingContext.criterion,'DEPARTURE_SOON');
 assert.ok(input.candidates[0].allowedEvidence.includes('PSC-EVIDENCE-1'));
 assert.ok(input.candidates[0].rankingContext.departureEvidenceRefs.includes('PSC-EVIDENCE-1'));
 assert.deepEqual(input.candidates[0].sourceTypes,['NMC_CASE']);
 assert.equal(input.candidates[0].requiredInPlan,true);
 assert.equal(input.candidates[0].operationalSourceEvents[0].port,'Jebel Ali');
});

test('C01 preflight shows truthful saved evidence and missing ETD without an AI call',()=>{
 const snapshot=buildC01Source(inputs(),{version:6});
 const coverage=summarizeC01Readiness(snapshot);
 assert.equal(coverage.schemaVersion,'SI_C01_READINESS_V1');
 assert.equal(coverage.sourceSnapshotHash,snapshot.snapshotHash);
 assert.equal(coverage.externalAiCalls,0);
 assert.equal(coverage.eligibleWorkflows,2);
 assert.equal(coverage.eligibleVessels,2);
 assert.equal(coverage.confirmedEtdVessels,0);
 assert.equal(coverage.missingConfirmedEtdVessels,2);
 assert.equal(coverage.riskAssessedVessels,1);
 assert.equal(coverage.evidenceBackedVessels,2);
 assert.equal(coverage.withoutExecutionSignalVessels,2);
 assert.equal(coverage.status,'READY_WITH_GAPS');
});
test('C01 readiness deduplicates same IMO workflows and makes conflicting ETD visible',()=>{
 const future=new Date(Date.now()+86400000).toISOString();
 const source={snapshotHash:'b'.repeat(64),candidates:[
  {imo:'9328471',regime:'UAE_SERVICE_INSPECTION',candidateKey:'service',
   departureAt:future,departureVerified:true,incidentHumanReviewed:false,
   currentRisk:{score:65},allowedEvidence:['MSW-1']},
  {imo:'9328471',regime:'PORT_STATE_CONTROL',candidateKey:'psc',
   departureAt:future,departureVerified:true,departureStatus:'VERIFIED',
   allowedEvidence:['PSC-1']},
  {imo:'9400409',regime:'FOCUSED_INSPECTION',candidateKey:'nmc',
   departureAt:null,departureVerified:false,departureStatus:'CONFLICT',
   incidentSeverity:85,incidentHumanReviewed:true,
   allowedEvidence:[]}
 ]};
 const result=summarizeC01Readiness(source);
 assert.equal(result.eligibleWorkflows,3);
 assert.equal(result.eligibleVessels,2);
 assert.equal(result.confirmedEtdVessels,1);
 assert.equal(result.incidentReviewedVessels,1);
 assert.equal(result.conflictingEtdVessels,1);
 assert.equal(result.evidenceBackedVessels,1);
 assert.equal(result.status,'REVIEW_RECOMMENDED');
 const over=summarizeC01Readiness({
  ...source,candidates:Array.from({length:101},(_,i)=>({
   imo:String(9000000+i),allowedEvidence:['EV-'+i]
  }))
 });
 assert.equal(over.status,'SCOPE_LIMIT');
 assert.equal(summarizeC01Readiness({candidates:[]}).status,'NO_CANDIDATES');
});

test('C01 processes >100 quota-selected workflows in verified batches after explicit call-count consent',async()=>{
 const dashboard={policy:{version:4},riskPolicyRevision:2,fleetSnapshotId:'PSC-FLEET',
  candidates:Array.from({length:125},(_,i)=>candidate('psc-'+i,
   'PSC_PORT_CALL',String(9300000+i),null))};
 const calls=[];
 const quotaSnapshot={scope:'NATIONAL',eligibleEvents:125,
  shortlistedEvents:125,modelMayOverrideQuota:false};
 const a=new SiCandidateAgent({provider:'airia',
  targeting:{dashboard:async()=>dashboard},
  pscPolicy:async()=>({version:8,quotaSnapshot}),
  executeAgent:async input=>{
   calls.push(input);
   return {result:JSON.stringify(mockSiC01(input))};
  }});
 const p=await a.preview();
 assert.equal(p.eligibleCount,125);
 assert.equal(p.expectedBatches,2);
 assert.equal(p.estimatedAiriaCalls,2);
 await assert.rejects(()=>a.run({actor:'PSC officer',confirmRun:true,
  confirmCost:true,expectedSnapshotHash:p.snapshotHash}),
  e=>e.code==='SI_C01_BATCH_COUNT_CONFIRMATION_REQUIRED');
 assert.equal(calls.length,0);
 const result=await a.run({actor:'PSC officer',confirmRun:true,
  confirmCost:true,expectedSnapshotHash:p.snapshotHash,confirmBatchCount:2});
 assert.equal(result.externalCalls,2);
 assert.equal(result.batchesValidated,2);
 assert.equal(result.candidatesAnalyzed,125);
 assert.equal(result.recommendations.length,125);
 assert.equal(new Set(result.recommendations.map(x=>x.candidateKey)).size,125);
 assert.deepEqual(calls.map(c=>c.candidates.length),[100,25]);
 assert.ok(calls.every(c=>c.pscQuotaSnapshot.modelMayOverrideQuota===false));
 assert.equal(calls[0].requestMeta.batchCount,2);
 assert.equal(calls[1].requestMeta.batchIndex,2);
 assert.notEqual(calls[0].requestMeta.correlationId,
   calls[1].requestMeta.correlationId,
   'Airia batch requests must have distinct correlation IDs');
 assert.equal(calls[0].requestMeta.parentCorrelationId,
   calls[1].requestMeta.parentCorrelationId);
 assert.ok(result.recommendations.every(x=>x.requiresHumanReview===true));
});
test('C01 discards all batch output when one Airia batch violates evidence contract',async()=>{
 const dashboard={policy:{version:4},riskPolicyRevision:2,fleetSnapshotId:'PSC-FLEET',
  candidates:Array.from({length:105},(_,i)=>candidate('multi-'+i,
   'PSC_PORT_CALL',String(9400000+i),null))};
 let seen=0;
 const a=new SiCandidateAgent({provider:'airia',
  targeting:{dashboard:async()=>dashboard},
  executeAgent:async p=>{
   seen++;
   const payload=mockSiC01(p);
   if(seen===2)payload.recommendations[0].evidenceRefs=['FORGED-EVIDENCE'];
   return payload;
  }});
 const p=await a.preview();
 await assert.rejects(()=>a.run({actor:'PSC officer',confirmRun:true,confirmCost:true,
  expectedSnapshotHash:p.snapshotHash,confirmBatchCount:2}),
  e=>e.code==='SI_C01_UNVERIFIED_RECOMMENDATION');
 assert.equal(seen,2);
 assert.equal(a.latest,null,'No partial recommendation set may be persisted');
});

test('Published C01 rules reach Airia and low-confidence choices require manual review',async()=>{
 const config={ranking:{criteria:['DEPARTURE_SOON','INCIDENT_SEVERITY']},
  aiAdvisory:{selectionSignals:['SOURCE_EVENT_EVIDENCE','REVIEWED_INCIDENT'],
   minimumSelectionConfidence:0.9,
   selectionInstructions:'Explain verified inspection trigger evidence for officer review.',
   priorityInstructions:'Cite current reviewed incident severity; disclose missing ETD.'}};
 const dashboard={...inputs(),policy:{version:8,config}};
 let received=null;
 const agent=new SiCandidateAgent({targeting:{dashboard:async()=>dashboard},
  pscPolicy:async()=>({version:3}),
  provider:'airia',executeAgent:async body=>{
   received=body;
   return mockSiC01(body);
  }});
 const preview=await agent.preview();
 assert.equal(preview.aiAdvisory.minimumSelectionConfidence,0.9);
 assert.equal(preview.aiAdvisory.selectionInstructions,
   config.aiAdvisory.selectionInstructions);
 const result=await agent.run({actor:'MOEI Supervisor',confirmRun:true,confirmCost:true,
  expectedSnapshotHash:preview.snapshotHash});
 assert.deepEqual(received.aiAdvisory.selectionSignals,
  ['SOURCE_EVENT_EVIDENCE','REVIEWED_INCIDENT']);
 assert.equal(received.aiAdvisory.priorityInstructions,
  config.aiAdvisory.priorityInstructions);
 assert.equal(received.analysisInstructions.doNotOverrideEligibilityOrPSCQuota,true);
 assert.equal(result.recommendations[0].modelRecommendation,'SELECT_RECOMMENDED');
 assert.equal(result.recommendations[0].recommendation,'MANUAL_REVIEW');
 assert.equal(result.recommendations[0].selectionReviewGate,'BELOW_PUBLISHED_CONFIDENCE');
 assert.equal(result.recommendations[0].suggestedRank,null);
 assert.equal(result.recommendations[0].confidence,0.8);
 assert.equal(result.humanDecisionRequired,true);
 assert.equal(result.mutations,false);
});
test('C01 guidance publication changes snapshot identity but never vessel eligibility',()=>{
 const dashboard=inputs();
 const base=buildC01Source(dashboard,{version:1});
 const candidates=base.candidates.map(x=>x.candidateKey);
 dashboard.policy.config={ranking:{criteria:['DEPARTURE_SOON','INCIDENT_SEVERITY']},
  aiAdvisory:{selectionSignals:['VERIFIED_ETD'],minimumSelectionConfidence:0.95,
   selectionInstructions:'Document evidence',priorityInstructions:'Cite ETD'}};
 const changed=buildC01Source(dashboard,{version:1});
 assert.notEqual(changed.snapshotHash,base.snapshotHash);
 assert.deepEqual(changed.candidates.map(x=>x.candidateKey),candidates);
 assert.deepEqual(changed.ranking,base.ranking);
});
