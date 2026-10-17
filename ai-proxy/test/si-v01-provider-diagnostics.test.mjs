import test from 'node:test';
import assert from 'node:assert/strict';
import {classifySiV01Failure,summarizeSiV01Rejection} from '../si-v01-provider-diagnostics.mjs';

test('SI-V01 classifies provider HTTP codes rather than hiding every failure as 502',()=>{
 const examples=[
  [400,'SI_V01_MULTIPART_REQUEST_REJECTED'],
  [401,'SI_V01_UPSTREAM_AUTH_REJECTED'],
  [403,'SI_V01_UPSTREAM_AUTH_REJECTED'],
  [404,'SI_V01_UPSTREAM_PIPELINE_NOT_FOUND'],
  [413,'SI_V01_IMAGE_TOO_LARGE_UPSTREAM'],
  [415,'SI_V01_UPSTREAM_MEDIA_UNSUPPORTED'],
  [422,'SI_V01_UPSTREAM_REQUEST_INVALID'],
  [429,'SI_V01_UPSTREAM_RATE_LIMITED'],
  [503,'SI_V01_UPSTREAM_SERVER_ERROR']
 ];
 for(const [status,code] of examples){
  const x=classifySiV01Failure(new Error('AIRIA_V01_HTTP_'+status));
  assert.equal(x.error,code);
  assert.equal(x.upstreamStatus,status);
  assert.ok(x.status>=400);
 }
});
test('SI-V01 hides provider bodies and credentials in safe response',()=>{
 const secret='Authorization=secret-key with image description';
 const x=classifySiV01Failure(new Error(secret));
 assert.deepEqual(x,{error:'SI_V01_UPSTREAM_PROVIDER_UNAVAILABLE',status:502});
 assert.ok(!JSON.stringify(x).includes(secret));
 assert.equal(classifySiV01Failure(new Error('AIRIA_V01_RESPONSE_INVALID_JSON')).error,
  'SI_V01_UPSTREAM_INVALID_JSON');
 assert.equal(classifySiV01Failure(Object.assign(new Error('unreachable'),{name:'TimeoutError'})).status,504);
 assert.equal(classifySiV01Failure(new TypeError('fetch failed')).error,
  'SI_V01_UPSTREAM_NETWORK_UNAVAILABLE');
});

test('SI-V01 reports only multipart field names from Airia 400 without upstream values',()=>{
 const source=JSON.stringify({
  title:'Problem SECRET_OPERATOR_DESCRIPTION',
  errors:{userInput:['input is bad: PRIVATE_CASE_ID'],file:['file invalid SECRET_IMAGE']},
  incidentText:'PRIVATE_EVIDENCE_EXTRACT',
  traceId:'SECRET_TRACE_ID'
 });
 const out=summarizeSiV01Rejection(400,source,'application/problem+json');
 assert.equal(out.responseShape,'JSON_OBJECT');
 assert.ok(out.validationFields.includes('userInput'));
 assert.ok(out.validationFields.includes('file'));
 assert.ok(!JSON.stringify(out).includes('PRIVATE'));
 assert.ok(!JSON.stringify(out).includes('SECRET'));
 const html=summarizeSiV01Rejection(400,'<html>Bearer VERY_SECRET</html>','text/html');
 assert.equal(html.responseShape,'NON_JSON');
 assert.equal(html.category,'UNCLASSIFIED');
 assert.ok(!JSON.stringify(html).includes('VERY_SECRET'));
});
