import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SiInspectionPreparation,SiPreparationError,validateA04,SI_BASE_CHECKLIST}
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
  const target={inspectionCase:async id=>id===caseId?approved:null};
  const svc=new SiInspectionPreparation({mode:'json',file:join(dir,'prep.json'),
    targeting:target,riskPolicy:{ready:true,vessel:async()=>returned},
    bundles:[fixture],enabled,executeA04:async()=>{calls++;
      if(providerResponse instanceof Error)throw providerResponse;
      return providerResponse;}});
  return {svc,calls:()=>calls,changeRisk:x=>{returned=x;},
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
