import test from 'node:test';
import assert from 'node:assert/strict';
import {SiScheduleOrders} from '../si-schedule-orders.mjs';
import {pocInspectorIdForActor,matchesAssignedInspector,
 resolveAssignedInspector} from '../si-inspector-identity.mjs';
import {buildPocErpSchedulingOverlay} from '../si-scheduling-poc-fixtures.mjs';
import {projectGuidedInspection,findGuidedStep,
 buildA04FocusedFieldRequest,projectA04FocusedFieldAdvice,
 normalizeInspectionQuestion,guidedFindingRequirements,guidedFinalAssessment}
 from '../si-guided-inspection.mjs';
import {assemblePendingWorkOrderDossier} from '../si-vessel-dossier.mjs';

const actor='inspector@example.test',other='other@example.test';
const inspectorId=pocInspectorIdForActor(actor);
const assigned={inspectorId,inspectorName:'Example Inspector (POC - My Account)',
 portId:'DXB',portName:'Jebel Ali',startLocal:'2026-10-20T08:00'};
const order={id:'12345678-1234-4234-8234-123456789012',
 planId:'12345678-1234-4234-8234-123456789013',
 scheduleId:'12345678-1234-4234-8234-123456789014',
 caseId:'12345678-1234-4234-8234-123456789015',
 imo:'9000001',status:'FIELD_STARTED',assignment:assigned};
const lifecycle={record:{stage:'IN_FIELD',version:8,
 checks:[
  {id:'fire-safety',mandatory:true,status:'PASS',note:'Extinguisher observed',
    evidenceRefs:['E-1']},
  {id:'certificates',mandatory:true,status:'PENDING'},
  {id:'navigation',mandatory:true,status:'PENDING'},
  {id:'lifesaving',mandatory:true,status:'PENDING'},
  {id:'pollution',mandatory:true,status:'PENDING'},
  {id:'manning',mandatory:true,status:'PENDING'},
  {id:'hull-machinery',mandatory:true,status:'PENDING'},
  {id:'security',mandatory:true,status:'PENDING'},
  {id:'additional-1',title:'Fire safety',mandatory:false,status:'PENDING'},
  {id:'additional-2',title:'Verify emergency fire doors',
    mandatory:false,status:'PENDING'}
 ]}};
const preparation={
 context:{imo:'9000001',inspectionId:order.caseId,caseId:order.caseId,
  vessel:{name:'POC Safe Voyager'},targetRegime:'PORT_STATE_CONTROL',
  targetRegimes:['PORT_STATE_CONTROL'],bundleRef:'VBL-9000001',
  inspectionReasons:[{sourceType:'PSC_PORT_CALL',sourceReference:'PSC-123'}],
  evidenceManifestRefs:['E-1','E-2'],baseChecklistItemIds:[
   'fire-safety','certificates','navigation','lifesaving','pollution',
   'manning','hull-machinery','security'],
  risk:{evaluationId:'RISK-1',score:80,level:'HIGH',rulesetVersion:7},
  evidenceContext:{certificates:[]}},
 stale:false,saved:{status:'APPROVED',dossier:{
  agentConfidence:0.83,
  checklistFocus:[{existingItemId:'fire-safety',focus:'VERIFY',
   reason:'Check visible fire-doors, markings and the reviewed service evidence.',
   reasonEvidenceIds:['E-1']}],
  suggestedAdditionalItems:[
   {title:'Fire safety',reason:'This is equivalent to mandatory fire safety.',
    evidenceIds:['E-1']},
   {title:'Verify emergency fire doors',
    reason:'Observe closing mechanism and verify service record against E-2.',
    evidenceIds:['E-2']},
   {title:'Inspect extra lifeboat battery',
    reason:'Not supervisor approved in this case.',evidenceIds:[]}
  ]}}
};
const item=(template,group,id,title,answers={},answerStatus='PENDING')=>({
 instanceId:template+':'+group+':'+id,title,description:'Inspect and record observed evidence.',
 mandatory:true,fields:['BOOLEAN','NOTE'],requiredFields:['BOOLEAN'],
 sourceReferences:['E-1'],answers,answerStatus
});
const checklist={saved:{version:3,templates:[
 {templateId:'TPL-1',revision:3,title:'Main PSC',groups:[
  {title:'Safety',items:[
   item('TPL-1','G-1','fire','Fire safety',{BOOLEAN:'YES'},'RECORDED'),
   item('TPL-1','G-1','cert','Certificates and documents')]
  }]},
 {templateId:'TPL-2',revision:1,title:'Flag',groups:[
  {title:'Safety',items:[
   item('TPL-2','G-1','fire','Fire safety'),
   item('TPL-2','G-1','radar','Radar equipment check')]
  }]}
 ]}};
test('authenticated POC user is a qualified synthetic engineer, not a real ERP employee',()=>{
 const master={snapshotId:'ERP-SOURCE-A',
  data:{Ports:[{port_id:'DXB',port_name:'Jebel Ali',active:'Y',city:'Dubai'}],
   Inspectors:[{inspector_id:'ERP-1',display_name:'ERP original'}]}};
 const generated=buildPocErpSchedulingOverlay(master,{
  operator:{email:actor,displayName:'Example Inspector'},
  clock:()=>Date.parse('2026-10-15T04:00:00Z')});
 assert.equal(master.data.Inspectors[0].inspector_id,'ERP-1');
 assert.equal(generated.data.Inspectors[0].inspector_id,inspectorId);
 assert.match(generated.data.Inspectors[0].display_name,/Example Inspector/);
 assert.equal(generated.demoMode,true);
 assert.equal(matchesAssignedInspector(actor,assigned,'POC_MOCK').id,inspectorId);
 assert.equal(matchesAssignedInspector(other,assigned,'POC_MOCK'),null);
 assert.equal(matchesAssignedInspector(actor,assigned,'ERP_EXCEL_POC'),null);
 assert.equal(resolveAssignedInspector(actor,assigned,'{}'),null);
 assert.notEqual(buildPocErpSchedulingOverlay(master,{
  operator:{email:other},clock:()=>Date.parse('2026-10-15T04:00:00Z')
 }).snapshotId,generated.snapshotId);
});
test('My work order and dossier are invisible to another session',async()=>{
 const mock=new SiScheduleOrders({mode:'json',targeting:{bundles:[]},
  rolling:{},preparation:{},checklists:{},lifecycle:{},cases:{}});
 mock.all=async()=>[{id:order.scheduleId,planId:order.planId,
  mode:'POC_MOCK',orders:[order]}];
 const mine=await mock.mine(actor);
 assert.equal(mine.length,1);
 assert.equal(mine[0].vesselName,'IMO 9000001');
 assert.equal((await mock.mine(other)).length,0);
 assert.equal((await mock.mineOrder(actor,order.id)).order.id,order.id);
 await assert.rejects(mock.mineOrder(other,order.id),
  /SI_WORK_ORDER_NOT_ASSIGNED_TO_SESSION/);
});
test('approved A04 scope + frozen published checklist + eight baseline questions dedupe conservatively',()=>{
 const g=projectGuidedInspection({order,lifecycle,preparation,checklist});
 assert.equal(g.progress.total,10);
 const fire=g.steps.find(x=>normalizeInspectionQuestion(x.title)==='fire safety');
 assert.ok(fire);
 assert.equal(fire.members.length,4,'one visible question, four authoritative saved IDs');
 assert.equal(g.steps.filter(x=>x.title==='Fire safety').length,1);
 assert.equal(fire.aiAdvice.length,2,'approved A04 question and checklist focus attached');
 assert.equal(fire.answered,false,
  'the third frozen published duplicate and approved AI check are still pending');
 assert.equal(g.numberOfMergedDuplicateQuestions,4,
  'fire safety duplicates plus shared certificates question are displayed once');
 assert.ok(g.steps.some(x=>x.title==='Verify emergency fire doors'));
 assert.equal(g.steps.some(x=>x.title==='Inspect extra lifeboat battery'),false);
 assert.equal(g.pendingAiSuggestions.length,1);
 assert.equal(findGuidedStep(g,fire.stepId)?.stepId,fire.stepId);
 assert.ok(g.steps.every(x=>x.stepId));
 assert.equal(g.publishedSnapshotVersion,3);
 assert.equal(g.lifecycleVersion,8);
});
test('unreviewed A04 never changes the executable checklist',()=>{
 const p={...preparation,saved:{status:'DRAFT_REVIEW',
  dossier:preparation.saved.dossier}};
 const g=projectGuidedInspection({order,lifecycle,preparation:p,checklist});
 assert.equal(g.aiApproved,false);
 assert.equal(g.aiDraftNotApproved,true);
 assert.equal(g.steps.some(x=>x.title==='Verify emergency fire doors'),false);
 assert.ok(g.pendingAiSuggestions.length>0);
 assert.equal(g.steps.find(x=>x.title==='Fire safety').aiAdvice.length,0);
});
test('per-step A04 request references only source-authorized evidence and cannot auto-answer',()=>{
 const g=projectGuidedInspection({order,lifecycle,preparation,checklist});
 const step=g.steps.find(x=>x.title==='Fire safety');
 const request=buildA04FocusedFieldRequest({preparation,step,language:'ar'});
 assert.equal(request.officialScoringRequested,false);
 assert.deepEqual(request.evidenceManifestRefs,['E-1','E-2']);
 assert.equal(request.inlineContext.focusedFieldStep.stepId,step.stepId);
 const advisory=projectA04FocusedFieldAdvice({
  checklistFocus:[{existingItemId:'fire-safety',focus:'VERIFY',
   reason:'Inspect the fire doors.',reasonEvidenceIds:['E-1']}],
  focusAreas:[],missingEvidence:[],agentConfidence:0.9
 },step);
 assert.equal(advisory.stepSpecific,true);
 assert.equal(advisory.findingsCreated,0);
 assert.equal(advisory.answersSaved,0);
 assert.equal(advisory.actions.length,1);
 const dynamic=g.steps.find(x=>x.title==='Radar equipment check');
 const exact=projectA04FocusedFieldAdvice({
  checklistFocus:[],
  focusAreas:[{category:'Radar equipment check',priority:'VERIFY',
   reason:'Check the radar display, record the observed functional test and compare maintenance evidence with the onboard log.',
   evidenceIds:['E-2']}],
  missingEvidence:[],agentConfidence:0.82
 },dynamic);
 assert.equal(exact.stepSpecific,true);
 assert.equal(exact.actions.length,1);
 assert.equal(exact.actions[0].focus,'EXACT_CHECKLIST_QUESTION');
 assert.deepEqual(exact.actions[0].evidenceRefs,['E-2']);
});
test('pre-case dossier displays current saved evidence without inventing a case',()=>{
 const d=assemblePendingWorkOrderDossier({order:{...order,caseId:null},
 schedule:{id:order.scheduleId,mode:'POC_MOCK'},
 bundle:{imo:order.imo,evidenceIds:['E-1'],
  inlineContext:{vessel:{name:'POC Safe Voyager',flag:'UAE'},
   certificates:[{number:'DOC-SOURCE-1'}],inspections:[],deficiencies:[]}},
 plan:{approvedVessels:[{imo:order.imo,
  regimes:['PORT_STATE_CONTROL'],inspectionReasons:[{
    sourceType:'PSC_PORT_CALL',sourceReference:'PSC-123',
    sourceApproval:'SOURCE_FINAL',evidenceIds:['E-1']}]}]},
 risk:{riskScore:80,riskLevel:'HIGH',sourceAssessmentId:'RISK-1'}
 });
 assert.equal(d.caseId,null);
 assert.equal(d.sections.identity.vesselName,'POC Safe Voyager');
 assert.equal(d.sections.sourceEvidence.certificates.length,1);
 assert.equal(d.readOnly,true);
 assert.equal(d.caseWrites,0);
 assert.equal(d.aiCallsOnGet,0);
});

test('final assessment identifies exactly which saved deficiency lacks an inspector note or proof',()=>{
 const steps=[
  {stepId:'STEP-MINOR',title:'Fire safety',answered:true,mandatory:true,
   currentStatus:'DEFICIENCY',severity:'MINOR',
   members:[{kind:'LIFECYCLE',id:'fire-safety'}]},
  {stepId:'STEP-MAJOR',title:'Navigation equipment',answered:true,mandatory:true,
   currentStatus:'DEFICIENCY',severity:'MAJOR',
   members:[{kind:'LIFECYCLE',id:'navigation'}]},
  {stepId:'STEP-CRITICAL',title:'Life saving equipment',answered:true,mandatory:true,
   currentStatus:'DEFICIENCY',severity:'CRITICAL',
   members:[{kind:'LIFECYCLE',id:'lifesaving'}]}
 ];
 const guide={steps,evidenceByStep:{
   'STEP-MINOR':[],
   'STEP-MAJOR':[{reference:'SI-GUIDED:uploaded-but-not-attached'}],
   'STEP-CRITICAL':[]
 }};
 const record={checks:[
  {id:'fire-safety',status:'DEFICIENCY',severity:'MINOR',
   note:'  ',evidenceRefs:[]},
  {id:'navigation',status:'DEFICIENCY',severity:'MAJOR',
   note:'Verified defective navigation light',evidenceRefs:[]},
  {id:'lifesaving',status:'DEFICIENCY',severity:'CRITICAL',
   note:'Inflatable raft expired',evidenceRefs:['SI-EVIDENCE:linked']}
 ]};
 const gaps=guidedFindingRequirements(guide,record);
 assert.equal(gaps.length,2,'critical has note and linked evidence');
 assert.deepEqual(gaps.map(x=>x.stepId),['STEP-MINOR','STEP-MAJOR']);
 assert.equal(gaps[0].missingNote,true);
 assert.equal(gaps[0].missingEvidence,false,
   'minor must not require an attachment');
 assert.equal(gaps[1].missingNote,false);
 assert.equal(gaps[1].missingEvidence,true);
 assert.equal(gaps[1].uploadedButNotLinked,true,
   'upload alone is insufficient until an inspector SAVES the finding');
 const assessment=guidedFinalAssessment(guide,record);
 assert.equal(assessment.outcome,'FINDINGS_NEED_DOCUMENTATION');
 assert.equal(assessment.canSubmit,false);
 assert.equal(assessment.missingFindingRequirements.length,2);
 // Fill only missing authoritative inspector fields; no mocked AI evidence.
 record.checks[0].note='Observed worn fire hose';
 record.checks[1].evidenceRefs=['SI-GUIDED:uploaded-but-not-attached'];
 const ready=guidedFinalAssessment(guide,record);
 assert.equal(ready.canSubmit,true);
 assert.equal(ready.missingFindingRequirements.length,0);
 assert.equal(ready.outcome,'OPEN_DEFICIENCIES');
});
