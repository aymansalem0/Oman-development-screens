import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeAiriaA03,A03ContractError} from '../airia-a03-contract.mjs';
import {validateA03} from '../drive-document-intelligence.mjs';

const source='IMO 9328471. MV Gulf Horizon. Certificate SC-778291 issued by Recognized Organization. Certificate expiry 2027-02-18.';
const v31={
  analysisId:'DOC-AI-9328471-01',
  classification:{type:'SAFETY_CONSTRUCTION_CERTIFICATE',confidence:0.98},
  extractedFields:{
    imo:{value:'9328471',confidence:0.99},
    vesselName:{value:'MV Gulf Horizon',confidence:0.97},
    certificateNumber:{value:'SC-778291',confidence:0.99},
    issuer:{value:'Recognized Organization',confidence:0.94},
    expiryDate:{value:'2027-02-18',confidence:0.96}
  },
  integrity:{tamperSuspected:false,quality:'GOOD',confidence:0.94},
  validation:{status:'PASS_WITH_EXTERNAL_VERIFICATION_REQUIRED',exceptions:[]},
  reviewRequired:true
};
test('v3.1 partner response maps to existing strict NMC review contract',()=>{
  const mapped=normalizeAiriaA03({result:{output:JSON.stringify(v31)}},source);
  const validated=validateA03(mapped,source,'9328471');
  assert.equal(validated.extracted.imo,'9328471');
  assert.equal(validated.extracted.documentType,'SAFETY_CONSTRUCTION_CERTIFICATE');
  assert.equal(validated.documentEntries.length,1);
  assert.equal(validated.documentEntries[0].certificateNumber,'SC-778291');
  assert.equal(mapped.providerDetails.contract,'AIRIA_A03_V3_1');
  assert.equal(mapped.providerDetails.sectionCoverage,'SINGLE_CLASSIFICATION_ONLY');
  assert.equal(mapped.providerDetails.externalVerificationRequired,true);
  assert.ok(mapped.evidenceQuotes.every(q=>source.includes(q)));
});
test('markdown-wrapped JSON message can be unwrapped as a v3.1 document result',()=>{
  const raw={data:{content:[{type:'text',text:'\x60\x60\x60json\n'+JSON.stringify(v31)+'\n\x60\x60\x60'}]}};
  const mapped=normalizeAiriaA03(raw,source);
  assert.equal(validateA03(mapped,source,'9328471').extracted.certificateNumber,'SC-778291');
});
test('v3.1 fabricated certificate number is rejected before Oracle draft',()=>{
  const bad={...v31,extractedFields:{...v31.extractedFields,
    certificateNumber:{value:'CERT-DOES-NOT-EXIST',confidence:.9}}};
  assert.throws(()=>normalizeAiriaA03(bad,source),
    error=>error instanceof A03ContractError&&error.code==='A03_EVIDENCE_NOT_IN_DOCUMENT');
});
test('unsupported free text is rejected rather than inventing fields',()=>{
  assert.throws(()=>normalizeAiriaA03({output:'Looks OK'},source),
    error=>error.code==='A03_RESPONSE_CONTRACT_UNVERIFIED');
});
test('older NMC extracted schema remains compatible',()=>{
  const result={extracted:{imo:'9328471',documentType:'Certificate of Registry'},
    confidence:.8,evidenceQuotes:['IMO 9328471']};
  assert.equal(normalizeAiriaA03({result},source),result);
});
test('tampering indication is preserved and requires review',()=>{
  const result=normalizeAiriaA03({...v31,integrity:{tamperSuspected:true,quality:'LOW'}},source);
  assert.equal(result.providerDetails.tamperSuspected,true);
  assert.equal(result.providerDetails.requiresHumanReview,true);
});