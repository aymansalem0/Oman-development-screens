import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
const dir=mkdtempSync(join(tmpdir(),'moei-guided-evidence-'));
process.env.SI_GUIDED_EVIDENCE_DIR=dir;
const {saveGuidedEvidence,listGuidedEvidence,readGuidedImage}
 =await import('../si-guided-evidence.mjs');
const {guidedFinalAssessment}=await import('../si-guided-inspection.mjs');
const id=randomUUID(),step='SI-STEP-'+'a'.repeat(20);
test('inspector question evidence is private, persistent and cryptographically checked',t=>{
 t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const png=Buffer.from('89504e470d0a1a0a000000000000','hex').toString('base64');
 const a=saveGuidedEvidence(id,step,'inspector@example.test',{
  filename:'fire-check.png',mimeType:'image/png',base64:png});
 assert.equal(a.aiAnalyzed,false);
 assert.equal(a.provenance,'INSPECTOR_UPLOADED_UNVERIFIED');
 assert.equal(listGuidedEvidence(id,step)[0].sha256,a.sha256);
 assert.equal(readGuidedImage(id,step,a.id).base64,png);
 assert.deepEqual(listGuidedEvidence(id,'SI-STEP-'+'b'.repeat(20)),[]);
 assert.throws(()=>saveGuidedEvidence(id,step,'inspector@example.test',{
  filename:'fake.pdf',mimeType:'application/pdf',base64:png}),e=>e.code==='SI_GUIDED_EVIDENCE_MAGIC_INVALID');
 assert.throws(()=>saveGuidedEvidence('../evil',step,'inspector@example.test',{
  filename:'a.png',mimeType:'image/png',base64:png}),e=>e.code==='SI_GUIDED_EVIDENCE_INPUT_INVALID');
});
test('final assessment differentiates missing, open, and recorded success pending independent review',()=>{
 const s=(id,status,mandatory=true)=>({
  stepId:id,title:id,mandatory,answered:status!=='PENDING',
  currentStatus:status,severity:status==='DEFICIENCY'?'MAJOR':null,
  members:[{kind:'LIFECYCLE'}]});
 let r=guidedFinalAssessment({steps:[s('one','PASS'),s('two','PENDING')]});
 assert.equal(r.outcome,'INCOMPLETE');assert.equal(r.canSubmit,false);
 r=guidedFinalAssessment({steps:[s('one','PASS'),s('two','DEFICIENCY')]});
 assert.equal(r.outcome,'OPEN_DEFICIENCIES');
 assert.equal(r.open[0].severity,'MAJOR');
 assert.equal(r.canSubmit,true);
 assert.equal(r.officialApproval,false);
 r=guidedFinalAssessment({steps:[s('one','PASS'),s('two','NA')]});
 assert.equal(r.outcome,'NO_RECORDED_DEFICIENCIES_PENDING_REVIEW');
 assert.equal(r.aiStatus,'NOT_AUTOMATICALLY_INVOKED');
 assert.equal(r.canSubmit,true);
});
test('guided APIs require assigned session and explicit opt-in for AI charges',()=>{
});
