import test from 'node:test';
import assert from 'node:assert/strict';
import {buildA03MultipartUserInput,summarizeA03HttpFailure} from '../airia-a03-multipart.mjs';

test('A03 multipart contains v3.1 metadata only and sends PDF in separate file part',()=>{
  const result=buildA03MultipartUserInput({
    requestMeta:{correlationId:'test-123',language:'en',schemaVersion:'A03-DOC-POC-1'},
    subject:{type:'VESSEL',imo:'9328471'},
    evidenceId:'GDOC-123',driveFileId:'1ZwRR34zZ89N2iYKKXEEFWSMDCoaPtQEA',
    documentTypeHint:'VESSEL_DOCUMENT_EVIDENCE_PACK',
    expectedFields:['imo','certificateNumber'],validationProfile:'MARITIME_CERT_POC_V1',
    document:{extractedText:'CONFIDENTIAL_PDF_TEXT'},
    instructions:'CONFIDENTIAL_INSTRUCTIONS',
    attachment:{bytes:Buffer.from('CONFIDENTIAL_PDF_BYTES')}
  });
  const wire=JSON.stringify(result);
  assert.equal(result.requestMeta.correlationId,'test-123');
  assert.equal(result.subject.imo,'9328471');
  assert.equal(result.validationProfile,'MARITIME_CERT_POC_V1');
  assert.equal(Object.hasOwn(result,'documentTypeHint'),false);
  assert.equal(Object.hasOwn(result.requestMeta,'schemaVersion'),false);
  assert.ok(!wire.includes('CONFIDENTIAL'));
  assert.ok(!wire.includes('attachment'));
  assert.ok(!wire.includes('instructions'));
  assert.ok(!wire.includes('document'));
});
test('redacted upstream validation details report field names not messages',()=>{
  const response=JSON.stringify({
    title:'One or more validation errors occurred.',
    errors:{userInput:['Invalid value SECRET_PDF_DATA'],file:['Missing SECRET_API_KEY']}
  });
  const out=summarizeA03HttpFailure(400,response,'application/problem+json');
  assert.equal(out.status,400);
  assert.ok(out.validationFields.includes('userInput'));
  assert.ok(out.validationFields.includes('file'));
  assert.ok(!JSON.stringify(out).includes('SECRET'));
});
test('unexpected upstream body is never exposed in diagnostic object',()=>{
  const out=summarizeA03HttpFailure(400,'secret bearer ABC123','text/plain');
  assert.equal(out.status,400);
  assert.equal(out.category,'UNCLASSIFIED');
  assert.ok(!JSON.stringify(out).includes('ABC123'));
});
