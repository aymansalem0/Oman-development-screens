import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SiInspectionPreparation,SiPreparationError,validateA04,validateA04FieldGuidance,SI_BASE_CHECKLIST,
 a04PocOutputGuidance}
  from '../si-inspection-preparation.mjs';

const caseId='34a10cb2-c542-411b-b915-a661238ce8af';
const imo='9328471';
const approved={id:caseId,imo,regime:'FOCUSED_INSPECTION',status:'CREATED',
  approvedBy:'Supervisor',rulesetVersion:1,nmcReferralId:null,riskAssessmentId:'ASSESS-1'};
const fixture={imo,evidenceIds:['CERT-1','INS-1','DEF-1','TRACK-1'],
  inlineContext:{vessel:{imo,name:'MV Gulf Horizon',flag:'Liberia',vesselType:'CARGO'},
    tracking:{speed:3.1,source:'POC'},
    inspections:[{id:'INS-1',type:'PSC',source:'SYNTHETIC_POC'}],
    deficiencies:[{id:'DEF-1',status:'Open',severity:'Major'}],
    certificates:[{id:'CERT-1',status:'Conditional'}],
    documentManifest:{contentAvailable:false}}
};
const risk={imo,sourceAssessmentId:'ASSESS-1',riskScore:72,riskLevel:'High',
  policyRevision:2,policyVersion:'NMC Risk Ruleset 1.1'};
const dossier={
  dossierId:'AIRIA-DOSSIER-TEST',focusAreas:[{
    category:'CERTIFICATES',priority:'HIGH',reason:'Verify the stored certificate state',
    evidenceIds:['CERT-1']}],
  checklistFocus:[{existingItemId:'certificates',focus:'VERIFY',
    reasonEvidenceIds:['CERT-1']}],
  predictedDeficiencies:[{category:'FIRE_SAFETY',hypothesisOnly:true,evidenceIds:['DEF-1']}],
  suggestedAdditionalItems:[],missingEvidence:['CURRENT_FIELD_PHOTO'],agentConfidence:.92
};
function harness({enabled=false,assessment=risk,providerResponse=dossier}={}){
  const dir=mkdtempSync(join(tmpdir(),'si-prep-'));let calls=0,returned=assessment;
  const inputs=[];
  const target={inspectionCase:async id=>id===caseId?approved:null};
  const svc=new SiInspectionPreparation({mode:'json',file:join(dir,'prep.json'),
    targeting:target,riskPolicy:{ready:true,vessel:async()=>returned},
    bundles:[fixture],enabled,executeA04:async input=>{calls++;
      inputs.push(structuredClone(input));
      if(providerResponse instanceof Error)throw providerResponse;
      return providerResponse;}});
  return {svc,calls:()=>calls,inputs:()=>inputs,changeRisk:x=>{returned=x;},
    cleanup:()=>rmSync(dir,{recursive:true,force:true})};
}
test('GET never calls Airia; evidence and mandatory checklist remain inspectable without risk',async()=>{
  const h=harness({enabled:false,assessment:null});
  try{
    const result=await h.svc.get(caseId);
    assert.equal(result.saved,null);
    assert.equal(result.canGenerate,false);
    assert.equal(result.context.risk,null);
    assert.equal(result.context.evidenceManifestRefs.length,4);
    assert.deepEqual(result.context.baseChecklistItemIds,SI_BASE_CHECKLIST);
    assert.deepEqual(result.context.openFindingRefs,['DEF-1']);
    assert.equal(h.calls(),0);
  }finally{h.cleanup();}
});
test('explicit prepare stores immutable approved-case context without AI; refresh requires version',async()=>{
  const h=harness();
  try{
    const first=await h.svc.prepare(caseId,{actor:'Inspector',expectedVersion:0});
    assert.equal(first.saved.status,'PREPARED');
    assert.equal(first.saved.version,1);
    assert.equal(h.calls(),0);
    await assert.rejects(()=>h.svc.prepare(caseId,{actor:'Inspector',expectedVersion:0}),
      e=>e.code==='SI_PREPARATION_VERSION_CONFLICT');
    const after=await h.svc.get(caseId);
    assert.equal(after.stale,false);
    assert.equal(after.saved.version,1);
    assert.equal(after.saved.context.risk.score,72);
  }finally{h.cleanup();}
});
test('A04 must opt in and require explicit cost confirmation; rejects missing NMC risk',async()=>{
  const h=harness({enabled:false});
  try{
    await h.svc.prepare(caseId,{actor:'Inspector'});
    await assert.rejects(()=>h.svc.generate(caseId,{actor:'Inspector',
      expectedVersion:1,confirmCost:true}),e=>e.code==='SI_A04_NOT_ENABLED');
    assert.equal(h.calls(),0);
  }finally{h.cleanup();}
  const n=harness({enabled:true,assessment:null});
  try{
    await n.svc.prepare(caseId,{actor:'Inspector'});
    await assert.rejects(()=>n.svc.generate(caseId,{actor:'Inspector',
      expectedVersion:1,confirmCost:true}),e=>e.code==='SI_SAVED_CURRENT_RISK_REQUIRED');
    assert.equal(n.calls(),0);
  }finally{n.cleanup();}
});
test('A04 validated focus-only dossier is persisted; supervisor approval freezes it',async()=>{
  const h=harness({enabled:true});
  try{
    const before=await h.svc.prepare(caseId,{actor:'Inspector'});
    const gen=await h.svc.generate(caseId,{actor:'Inspector',
      expectedVersion:before.saved.version,confirmCost:true,language:'en'});
    assert.equal(gen.saved.status,'DRAFT_REVIEW');
    assert.equal(gen.saved.dossier.focusAreas[0].evidenceIds[0],'CERT-1');
    assert.equal(gen.saved.dossier.requiresInspectorReview,true);
    assert.equal(gen.saved.dossier.predictedDeficiencies[0].hypothesisOnly,true);
    assert.equal(h.calls(),1);
    assert.equal(gen.saved.context.baseChecklistItemIds.length,8);
    await assert.rejects(()=>h.svc.generate(caseId,{actor:'Inspector',
      expectedVersion:gen.saved.version,confirmCost:true}),
      e=>e.code==='SI_PREPARE_FIRST_OR_ALREADY_APPROVED');
    assert.equal(h.calls(),1);
    const done=await h.svc.review(caseId,{actor:'Senior Inspector',
      expectedVersion:gen.saved.version,decision:'APPROVE',
      reason:'Reviewed and accepted evidence-linked focus only'});
    assert.equal(done.saved.status,'APPROVED');
    assert.equal(done.saved.review.aiOverlayOnly,true);
    assert.equal(done.saved.dossier.source,'AIRIA_A04_UNVERIFIED_ADVISORY');
    await assert.rejects(()=>h.svc.prepare(caseId,{actor:'Officer',
      expectedVersion:done.saved.version}),e=>e.code==='SI_PREPARATION_ALREADY_APPROVED');
    assert.equal((await h.svc.get(caseId)).saved.status,'APPROVED');
  }finally{h.cleanup();}
});
test('A04 unsupported evidence IDs / checklist replacements fail closed and require explicit retry',async()=>{
  const corrupt={...dossier,focusAreas:[{...dossier.focusAreas[0],evidenceIds:['NOT_IN_SOURCE']}]};
  assert.throws(()=>validateA04(corrupt,{checkIds:SI_BASE_CHECKLIST,evidenceIds:fixture.evidenceIds}),
    e=>e.code==='SI_A04_UNVERIFIED_EVIDENCE');
  assert.throws(()=>validateA04({...dossier,
    checklistFocus:[{existingItemId:'UNAUTHORIZED_DYNAMIC_CHECK',focus:'VERIFY'}]},
    {checkIds:SI_BASE_CHECKLIST,evidenceIds:fixture.evidenceIds}),
    e=>e.code==='SI_A04_CHECKLIST_REF_INVALID');
  const h=harness({enabled:true,providerResponse:corrupt});
  try{
    await h.svc.prepare(caseId,{actor:'Inspector'});
    await assert.rejects(()=>h.svc.generate(caseId,{actor:'Inspector',
      expectedVersion:1,confirmCost:true}),e=>e.code==='SI_A04_UNVERIFIED_EVIDENCE');
    const current=await h.svc.get(caseId);
    assert.equal(current.saved.status,'FAILED');
    assert.equal(current.saved.dossier,null);
    assert.equal(h.calls(),1);
  }finally{h.cleanup();}
});
test('source risk revision changes block stale dossier generation and review',async()=>{
  const h=harness({enabled:true});
  try{
    await h.svc.prepare(caseId,{actor:'Inspector'});
    h.changeRisk({...risk,riskScore:85,riskLevel:'Critical',policyRevision:3});
    assert.equal((await h.svc.get(caseId)).stale,true);
    await assert.rejects(()=>h.svc.generate(caseId,{actor:'Inspector',
      expectedVersion:1,confirmCost:true}),e=>e.code==='SI_PREPARATION_STALE_REFRESH_REQUIRED');
    assert.equal(h.calls(),0);
    await h.svc.prepare(caseId,{actor:'Inspector',expectedVersion:1});
    assert.equal((await h.svc.get(caseId)).stale,false);
  }finally{h.cleanup();}
});
test('provider failure leaves central FAILED record and no fake success dossier',async()=>{
  const h=harness({enabled:true,providerResponse:new Error('upstream timeout')});
  try{
    await h.svc.prepare(caseId,{actor:'Inspector'});
    await assert.rejects(()=>h.svc.generate(caseId,{actor:'Inspector',
      expectedVersion:1,confirmCost:true}),e=>e.code==='SI_A04_PROVIDER_UNAVAILABLE');
    assert.equal((await h.svc.get(caseId)).saved.status,'FAILED');
  }finally{h.cleanup();}
});

test('Oracle dossier preparation insert and audit never use keyword bind identifiers',async()=>{
 const h=harness(),calls=[];let commits=0,rollbacks=0;
 const con={
  async execute(sql,binds){
   const names=[...sql.matchAll(/:([A-Za-z_][A-Za-z_0-9]*)/g)].map(x=>x[1]);
   assert.ok(names.length);
   assert.ok(names.every(x=>/^b_[a-z][a-z0-9_]*$/.test(x)));
   assert.deepEqual([...new Set(names)].sort(),Object.keys(binds).sort());
   calls.push(sql.trim().replace(/\s+/g,' '));
   return {rowsAffected:1};
  },
  async commit(){commits++;},
  async rollback(){rollbacks++;}
 };
 try{
  h.svc.mode='oracle';h.svc.db=async fn=>fn(con);
  await h.svc.persist(caseId,null,{
   caseId,version:1,status:'PREPARED',sourceHash:'TEST',
   context:{},preparedBy:'inspector@moei.example',audit:[]
  },'PREPARED','inspector@moei.example','Create approved-case preparation');
  assert.deepEqual(calls.map(x=>x.match(/^(INSERT INTO [A-Z_]+)/)[1]),[
   'INSERT INTO SI_PREPARATION_DOSSIER','INSERT INTO SI_PREPARATION_AUDIT'
  ]);
  assert.equal(commits,1);assert.equal(rollbacks,0);
 }finally{h.cleanup();}
});

test('A04 focus accepts only harmless case/whitespace differences in advisory priority',()=>{
 const result=validateA04({...dossier,focusAreas:[{
  category:'SAFETY',priority:' high ',reason:'Inspection focus supported by source evidence',
  evidenceIds:['CERT-1']
 }]},{checkIds:SI_BASE_CHECKLIST,evidenceIds:fixture.evidenceIds});
 assert.equal(result.focusAreas[0].priority,'HIGH');
 assert.deepEqual(result.focusAreas[0].evidenceIds,['CERT-1']);
 assert.equal(result.requiresInspectorReview,true);
});

test('A04 focus schema reports only safe field paths without returning untrusted model text',()=>{
 const examples=[
  {patch:{category:null},field:'focusAreas[0].category'},
  {patch:{category:' '},field:'focusAreas[0].category'},
  {patch:{priority:'MEDIUM'},field:'focusAreas[0].priority'},
  {patch:{priority:{untrusted:'value'}},field:'focusAreas[0].priority'},
  {patch:{reason:''},field:'focusAreas[0].reason'}
 ];
 for(const row of examples){
  const value={...dossier,focusAreas:[{...dossier.focusAreas[0],...row.patch}]};
  assert.throws(()=>validateA04(value,{
   checkIds:SI_BASE_CHECKLIST,evidenceIds:fixture.evidenceIds
  }),e=>e instanceof SiPreparationError&&
   e.code==='SI_A04_FOCUS_INVALID'&&e.field===row.field);
 }
});

test('failed A04 provider priority leaves traceable path, zero fabricated dossiers and no retry',async()=>{
 const bad={...dossier,focusAreas:[{...dossier.focusAreas[0],priority:'MEDIUM'}]};
 const h=harness({enabled:true,providerResponse:bad});
 try{
  await h.svc.prepare(caseId,{actor:'Inspector'});
  await assert.rejects(()=>h.svc.generate(caseId,{
   actor:'Inspector',expectedVersion:1,confirmCost:true,language:'en'
  }),e=>e.code==='SI_A04_FOCUS_INVALID');
  const result=await h.svc.get(caseId);
  assert.equal(result.saved.status,'FAILED');
  assert.equal(result.saved.lastFailureField,'focusAreas[0].priority');
  assert.equal(result.saved.dossier,null);
  assert.equal(h.calls(),1,'no silent second billable agent call');
 }finally{h.cleanup();}
});

test('actual Airia envelope reveals MEDIUM priority and narrative checklist focus as separate schema errors',()=>{
 const source={
  responseType:'CREATE_DOSSIER',dossierId:'DOSSIER-INS-POC-001',
  focusAreas:[{
   category:'FIRE_SAFETY',priority:'CRITICAL',
   reason:'Review open fire safety evidence.',evidenceIds:['DEF-1','INS-1']
  },{
   category:'CERTIFICATES',priority:'HIGH',
   reason:'Verify statutory certificates.',evidenceIds:['CERT-1']
  },{
   category:'PREVIOUS_INSPECTION_FOLLOW_UP',priority:'MEDIUM',
   reason:'Follow up earlier PSC inspection.',evidenceIds:['INS-1']
  }],
  checklistFocus:[{
   existingItemId:'fire-safety',
   focus:'Verify closure of open deficiency and fire systems.',
   suggestedSeverityIfFailed:'CRITICAL'
  }],
  suggestedAdditionalItems:[],agentConfidence:0.7
 };
 const wrap=data=>({'$type':'string',result:JSON.stringify(data),
  isGuardrailBlock:false,report:null});
 const args={checkIds:SI_BASE_CHECKLIST,evidenceIds:fixture.evidenceIds};
 assert.throws(()=>validateA04(wrap(source),args),
  e=>e.code==='SI_A04_FOCUS_INVALID'&&
   e.field==='focusAreas[2].priority');
 const allowedPriority={...source,focusAreas:[
  ...source.focusAreas.slice(0,2),{...source.focusAreas[2],priority:'WATCH'}
 ]};
 assert.throws(()=>validateA04(wrap(allowedPriority),args),
  e=>e.code==='SI_A04_CHECKLIST_REF_INVALID'&&
   e.field==='checklistFocus[0].focus');
 const compliant={...allowedPriority,checklistFocus:[{
  existingItemId:'fire-safety',focus:'VERIFY',
  reason:'Verify closure of open fire safety deficiency.',
  reasonEvidenceIds:['DEF-1']
 }]};
 const ok=validateA04(wrap(compliant),args);
 assert.equal(ok.focusAreas[2].priority,'WATCH');
 assert.equal(ok.checklistFocus[0].focus,'VERIFY');
 assert.equal(ok.checklistFocus[0].reasonEvidenceIds[0],'DEF-1');
 assert.ok(!Object.hasOwn(ok.checklistFocus[0],'suggestedSeverityIfFailed'));
 assert.equal(ok.source,'AIRIA_A04_UNVERIFIED_ADVISORY');
 assert.equal(ok.requiresInspectorReview,true);
});

test('checklist Focus paths are diagnosable while unknown free-text remains rejected',()=>{
 const checks=[
  {value:'Propose extra checklist items',field:'checklistFocus[0].focus'},
  {value:'MEDIUM',field:'checklistFocus[0].focus'}
 ];
 for(const {value,field} of checks){
  const payload={...dossier,checklistFocus:[{
   existingItemId:'fire-safety',focus:value,
   reason:'text only',reasonEvidenceIds:['CERT-1']
  }]};
  assert.throws(()=>validateA04(payload,{
   checkIds:SI_BASE_CHECKLIST,evidenceIds:fixture.evidenceIds
  }),e=>e.code==='SI_A04_CHECKLIST_REF_INVALID'&&e.field===field);
 }
 const compliant=validateA04({...dossier,checklistFocus:[{
  existingItemId:'fire-safety',focus:' verify ',reason:'Review old case.',
  reasonEvidenceIds:['INS-1']
 }]},{checkIds:SI_BASE_CHECKLIST,evidenceIds:fixture.evidenceIds});
 assert.equal(compliant.checklistFocus[0].focus,'VERIFY');
});

test('POC A04 includes source-bound output guidance INSIDE the single billable request userInput',async()=>{
 const h=harness({enabled:true});
 try{
  await h.svc.prepare(caseId,{actor:'Inspector'});
  const generated=await h.svc.generate(caseId,{
   actor:'Inspector',expectedVersion:1,confirmCost:true,language:'en'
  });
  assert.equal(generated.saved.status,'DRAFT_REVIEW');
  assert.equal(h.calls(),1,'no extra Airia call to configure the contract');
  const [request]=h.inputs();
  assert.equal(request.requestMeta.schemaVersion,'2.0');
  assert.equal(request.requestMeta.language,'en');
  assert.equal(request.officialScoringRequested,false);
  assert.deepEqual(request.requestedOutputs,['FOCUS_OVERLAY','MISSING_EVIDENCE']);
  assert.equal(request.outputGuidance.mode,'POC_IN_REQUEST_OUTPUT_GUIDANCE');
  assert.equal(request.outputGuidance.responseFormat,'ONE_JSON_OBJECT_NO_MARKDOWN');
  assert.deepEqual(request.outputGuidance.allowedPriorityValues,
   ['CRITICAL','HIGH','WATCH','NORMAL','PRIORITY','ROUTINE']);
  assert.deepEqual(request.outputGuidance.allowedChecklistFocusValues,
   ['NMC_FOCUS','PRIORITY','VERIFY','REVIEW','ADDITIONAL']);
  assert.deepEqual(request.outputGuidance.allowedChecklistItemIds,
   request.baseChecklistItemIds);
  assert.deepEqual(request.outputGuidance.allowedEvidenceIds,
   request.evidenceManifestRefs);
  assert.ok(request.outputGuidance.instructions.some(v=>v.includes('Do NOT return MEDIUM')));
  assert.ok(request.outputGuidance.instructions.some(v=>v.includes('NOT natural-language')));
  assert.ok(request.outputGuidance.instructions.some(v=>v.includes('Human inspector review')));
  const wrapped={userInput:JSON.stringify(request),asyncOutput:false};
  const inputFromAiria=JSON.parse(wrapped.userInput);
  assert.deepEqual(inputFromAiria.outputGuidance,request.outputGuidance,
   'the existing Airia transport stringifies all output hints into userInput');
  assert.equal(generated.saved.dossier.requiresInspectorReview,true);
 }finally{h.cleanup();}
});

test('POC response guidance is generated only from approved source identifiers, not a free-form user prompt',()=>{
 const input={baseChecklistItemIds:['fire-safety','certificates','fire-safety'],
  evidenceManifestRefs:['CERT-1','DEF-1','CERT-1']};
 const guidance=a04PocOutputGuidance(input);
 assert.deepEqual(guidance.allowedChecklistItemIds,['fire-safety','certificates']);
 assert.deepEqual(guidance.allowedEvidenceIds,['CERT-1','DEF-1']);
 assert.ok(!JSON.stringify(guidance).includes('AIRIA_API_KEY'));
 assert.equal(input.baseChecklistItemIds.length,3,'no mutation of original checklist');
});

test('request instructions never override server-side validation when a model returns MEDIUM',async()=>{
 const incorrect={...dossier,focusAreas:[{
  ...dossier.focusAreas[0],priority:'MEDIUM'
 }]};
 const h=harness({enabled:true,providerResponse:incorrect});
 try{
  await h.svc.prepare(caseId,{actor:'Inspector'});
  await assert.rejects(()=>h.svc.generate(caseId,{
   actor:'Inspector',expectedVersion:1,confirmCost:true
  }),e=>e.code==='SI_A04_FOCUS_INVALID');
  assert.equal(h.calls(),1);
  assert.equal(h.inputs()[0].outputGuidance.mode,'POC_IN_REQUEST_OUTPUT_GUIDANCE');
  const record=await h.svc.get(caseId);
  assert.equal(record.saved.status,'FAILED');
  assert.equal(record.saved.dossier,null);
 }finally{h.cleanup();}
});

test('A04 accepts empty or omitted potential deficiencies without dropping mandatory checklist',async()=>{
 const args={checkIds:SI_BASE_CHECKLIST,evidenceIds:fixture.evidenceIds};
 for(const response of [
  {...dossier,predictedDeficiencies:[]},
  Object.fromEntries(Object.entries(dossier).filter(([k])=>k!=='predictedDeficiencies'))
 ]){
  const validated=validateA04(response,args);
  assert.deepEqual(validated.predictedDeficiencies,[]);
  assert.equal(validated.requiresInspectorReview,true);
  const h=harness({enabled:true,providerResponse:response});
  try{
   const prepared=await h.svc.prepare(caseId,{actor:'Inspector'});
   const result=await h.svc.generate(caseId,{actor:'Inspector',
    expectedVersion:prepared.saved.version,confirmCost:true});
   assert.equal(result.saved.status,'DRAFT_REVIEW');
   assert.deepEqual(result.saved.context.baseChecklistItemIds,SI_BASE_CHECKLIST);
   assert.deepEqual(result.saved.dossier.predictedDeficiencies,[]);
   assert.equal(result.saved.dossier.requiresInspectorReview,true);
   assert.equal(h.calls(),1);
  }finally{h.cleanup();}
 }
});

test('potential deficiencies stay strict hypotheses and never silently gain legal status',()=>{
 const args={checkIds:SI_BASE_CHECKLIST,evidenceIds:fixture.evidenceIds};
 const sample={category:'FIRE_SAFETY',evidenceIds:['DEF-1']};
 for(const entry of [sample,{...sample,hypothesisOnly:false},
  {...sample,hypothesisOnly:'true'}]){
  assert.throws(()=>validateA04({...dossier,predictedDeficiencies:[entry]},args),
   e=>e.code==='SI_A04_PREDICTION_NOT_ADVISORY'&&
     e.field==='predictedDeficiencies[0].hypothesisOnly');
 }
 const approved=validateA04({...dossier,
  predictedDeficiencies:[{...sample,hypothesisOnly:true}]},args);
 assert.deepEqual(approved.predictedDeficiencies,[{...sample,hypothesisOnly:true}]);
 assert.equal(approved.requiresInspectorReview,true);
 const guidance=a04PocOutputGuidance({baseChecklistItemIds:SI_BASE_CHECKLIST,
  evidenceManifestRefs:fixture.evidenceIds});
 assert.ok(guidance.instructions.some(i=>i.includes('hypothesisOnly: true')));
 assert.ok(guidance.instructions.some(i=>i.includes('predictedDeficiencies: []')));
 assert.equal(guidance.optionalPredictedDeficienciesItemShape.hypothesisOnly,true);
 assert.deepEqual(guidance.noPredictedDeficienciesResponse,{predictedDeficiencies:[]});
 assert.deepEqual(guidance.allowedChecklistItemIds,SI_BASE_CHECKLIST);
});


test('Field-only A04 request discards invalid optional checklist mappings but retains verified focus actions',()=>{
 const invalid={...dossier,
  focusAreas:[{category:'Fire safety',priority:'HIGH',
    reason:'Check portable extinguisher labels against the source record',
    evidenceIds:['CERT-1']}],
  checklistFocus:[{existingItemId:'FIRE_CHECK_NOT_IN_SOURCE',focus:'VERIFY',
    reason:'Never promote unknown statutory checks',reasonEvidenceIds:['CERT-1']},
   {existingItemId:'certificates',focus:'Look for the current inspection stamp',
    reasonEvidenceIds:['CERT-1']},
   {existingItemId:'fire-safety',focus:'VERIFY',
    reason:'Review source-linked maintenance documentation',
    reasonEvidenceIds:['CERT-1']}]
 };
 const args={checkIds:SI_BASE_CHECKLIST,evidenceIds:fixture.evidenceIds};
 assert.throws(()=>validateA04(invalid,args),
   e=>e.code==='SI_A04_CHECKLIST_REF_INVALID');
 const result=validateA04FieldGuidance(invalid,args);
 assert.equal(result.discardedChecklistFocus,2);
 assert.deepEqual(result.fieldGuidanceWarnings,
   ['A04_INVALID_CHECKLIST_ADVICE_DISCARDED']);
 assert.equal(result.checklistFocus.length,1);
 assert.equal(result.checklistFocus[0].existingItemId,'fire-safety');
 assert.equal(result.focusAreas[0].evidenceIds[0],'CERT-1');
 assert.equal(result.requiresInspectorReview,true);
});

test('Field-only A04 guidance NEVER accepts invented source evidence or invalid focus priorities',()=>{
 const args={checkIds:SI_BASE_CHECKLIST,evidenceIds:fixture.evidenceIds};
 const unverified={...dossier,
  focusAreas:[{...dossier.focusAreas[0],evidenceIds:['FAKE-EVIDENCE']}],
  checklistFocus:[{existingItemId:'NOT_ALLOWED',focus:'INVALID'}]};
 assert.throws(()=>validateA04FieldGuidance(unverified,args),
   e=>e.code==='SI_A04_UNVERIFIED_EVIDENCE');
 const unsupported={...dossier,focusAreas:[{...dossier.focusAreas[0],priority:'MEDIUM'}],
   checklistFocus:[{existingItemId:'NOT_ALLOWED',focus:'INVALID'}]};
 assert.throws(()=>validateA04FieldGuidance(unsupported,args),
   e=>e.code==='SI_A04_FOCUS_INVALID');
});
