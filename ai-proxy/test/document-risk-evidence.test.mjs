import test from 'node:test';
import assert from 'node:assert/strict';
import {documentEvidenceChecks,documentIntegritySignal} from '../document-risk-evidence.mjs';
const imo='9328471',id='GDOC-0123456789abcdef0123';
const doc={
  vesselImo:imo,evidenceId:id,reviewStatus:'DRAFT_REVIEW',
  sourceModifiedTime:'2026-10-10T00:00:00Z',
  analyzedModifiedTime:'2026-10-10T00:00:00Z',
  documentEntries:[
    {documentType:'Cargo Ship Safety Construction Certificate',
      certificateNumber:'SC-284711',expiryDate:'2026-11-02'},
    {documentType:'Cargo Ship Safety Radio Certificate',
      certificateNumber:'CSR-9328471-2025',expiryDate:'2027-11-17'}
  ]};
const certificates=[
  {type:'Cargo Ship Safety Construction Certificate',number:'CSC-9328471-2026',expiry:'11 Feb 2031'},
  {type:'Cargo Ship Safety Radio Certificate',number:'CSR-9328471-2025',expiry:'17 Nov 2027'}
];
test('A03 comparisons are explicit, document-backed, synthetic and do not claim authenticity',()=>{
  const result=documentEvidenceChecks({imo,documents:[doc],certificates});
  assert.equal(result.available,true);
  assert.equal(result.compared,4);
  assert.equal(result.mismatched,2);
  assert.equal(result.consistencyPercent,50);
  assert.equal(result.provenance,'SYNTHETIC_A03_EXTRACTS_NOT_AUTHORITY_VERIFIED');
  const signal=documentIntegritySignal(result);
  assert.equal(signal.factor,'documentIntegrity');
  assert.equal(signal.sourceAgent,'A03');
  assert.equal(signal.severity,50);
  assert.deepEqual(signal.evidenceIds,[id]);
  assert.doesNotMatch(signal.reason,/document expiry is legal/);
});
test('unanalysed documents are UNKNOWN, never zero-risk or perfect-quality',()=>{
  let r=documentEvidenceChecks({imo,documents:[],certificates});
  assert.equal(r.consistencyPercent,null);
  assert.equal(documentIntegritySignal(r),null);
  r=documentEvidenceChecks({imo,documents:[{...doc,reviewStatus:'FAILED'}],certificates});
  assert.equal(r.available,false);
  assert.equal(documentIntegritySignal(r),null);
});
test('mismatched vessel IMO or modified A03 source cannot affect risk',()=>{
  for(const changed of [{...doc,vesselImo:'9328472'},
    {...doc,analyzedModifiedTime:'2026-10-11T00:00:00Z'}]){
    const result=documentEvidenceChecks({imo,documents:[changed],certificates});
    assert.equal(result.available,false);
    assert.equal(documentIntegritySignal(result),null);
  }
});
test('matching values produce visible zero-severity AFTER evidence exists',()=>{
  const approved={...doc,reviewStatus:'APPROVED',documentEntries:[doc.documentEntries[1]]};
  const result=documentEvidenceChecks({imo,documents:[approved],certificates});
  assert.equal(result.consistencyPercent,100);
  assert.equal(documentIntegritySignal(result).severity,0);
});

test('English maritime certificate dates are deterministic without locale Date.parse (Windows Node 24 regression)',()=>{
  const parse=Date.parse;
  // V8/Windows differs on arbitrary display dates. These two supported
  // formats must not need Date.parse or produce a fabricated expiry conflict.
  Date.parse=()=>{throw Error('Non-ISO parsing must not be necessary');};
  try{
    const full=documentEvidenceChecks({imo,documents:[doc],certificates});
    assert.equal(full.compared,4);
    assert.equal(full.mismatched,2);
    assert.equal(full.consistencyPercent,50);
    const matching={...doc,reviewStatus:'APPROVED',
      documentEntries:[doc.documentEntries[1]]};
    const exact=documentEvidenceChecks({imo,documents:[matching],certificates});
    assert.equal(exact.compared,2);
    assert.equal(exact.mismatched,0);
    assert.equal(exact.consistencyPercent,100);
    assert.equal(documentIntegritySignal(exact).severity,0);
  }finally{Date.parse=parse;}
});
test('invalid impossible expiry dates stay UNKNOWN instead of invented conflicts',()=>{
  const broken={...doc,documentEntries:[{
    ...doc.documentEntries[1],expiryDate:'2027-02-29'
  }]};
  const inspected=documentEvidenceChecks({imo,documents:[broken],certificates});
  assert.equal(inspected.compared,1);
  assert.equal(inspected.mismatched,0);
  assert.equal(inspected.consistencyPercent,100);
  assert.equal(inspected.comparisons[0].field,'A03_RADIO_NUMBER');
});
