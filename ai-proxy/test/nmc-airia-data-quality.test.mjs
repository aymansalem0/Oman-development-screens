import test from 'node:test';import assert from 'node:assert/strict';
import {makeDq01Request,validateDq01Response}
 from '../nmc-airia-data-quality.mjs';
const vessel={imo:'9328471',status:'COMPLETED',assessmentId:'ASMT-SAVED',
  signals:['movement','inspection','certificate','dataQuality','history']
    .map(factor=>({factor,severity:40,evidenceIds:['EV-'+factor]}))};
const bundle={evidenceIds:['EV-inspection','EV-certificate']};
test('DQ-01 only consumes saved evidence, never requests official scoring',()=>{
 const ctx=makeDq01Request('9328471',vessel,bundle);
 assert.equal(ctx.request.officialScoringRequested,false);
 assert.equal(ctx.request.subject.imo,'9328471');
 assert.equal(ctx.request.existingFactorSignals.length,5);
 const raw={response:{factorSignals:[{factor:'provenance',status:'REVIEW_REQUIRED',
   confidence:0.78,reason:'Inspection source requires cross-check',
   evidenceIds:['EV-inspection']}]}};
 const result=validateDq01Response(raw,ctx.known);
 assert.equal(result.agentCode,'DQ-01');
 assert.equal(result.finalQualityScore,null);
 assert.equal(result.officialScoreChanged,false);
 assert.equal(result.factorSignals[0].requiresHumanReview,true);
});
test('DQ-01 blocks fabricated evidence, model official scores, missing saved assessment',()=>{
 const ctx=makeDq01Request('9328471',vessel,bundle);
 assert.throws(()=>validateDq01Response({factorSignals:[{
   factor:'provenance',evidenceIds:['FAKE']}]},ctx.known),
   /DQ01_FACTOR_EVIDENCE_INVALID/);
 assert.throws(()=>validateDq01Response({finalQualityScore:99,factorSignals:[{
   factor:'provenance',evidenceIds:['EV-inspection']}]},ctx.known),
   /DQ01_FINAL_QUALITY_SCORE_FORBIDDEN/);
 assert.throws(()=>makeDq01Request('9328471',{...vessel,signals:[]},bundle),
   /DQ01_SAVED_VESSEL_EVIDENCE_REQUIRED/);
});
