import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyA04ProviderFailure} from '../si-a04-provider-diagnostics.mjs';

test('A04 distinguishes credentials, pipeline, rate limit, timeout and network without raw bodies',()=>{
 const rows=[
  [new Error('AIRIA_NOT_CONFIGURED'),'SI_A04_KEY_MISSING'],
  [new Error('AIRIA_PIPELINE_NOT_CONFIGURED'),'SI_A04_PIPELINE_MISSING'],
  [new Error('AIRIA_REQUEST_FAILED_401'),'SI_A04_UPSTREAM_AUTH_REJECTED'],
  [new Error('AIRIA_REQUEST_FAILED_403'),'SI_A04_UPSTREAM_AUTH_REJECTED'],
  [new Error('AIRIA_REQUEST_FAILED_404'),'SI_A04_UPSTREAM_PIPELINE_NOT_FOUND'],
  [new Error('AIRIA_REQUEST_FAILED_429'),'SI_A04_UPSTREAM_RATE_LIMITED'],
  [new Error('AIRIA_REQUEST_FAILED_503'),'SI_A04_UPSTREAM_SERVER_ERROR'],
  [Object.assign(new Error('timed out'),{name:'TimeoutError'}),'SI_A04_UPSTREAM_TIMEOUT'],
  [new TypeError('fetch failed'),'SI_A04_NETWORK_UNAVAILABLE'],
  [new Error('AIRIA_RESPONSE_INVALID_JSON'),'SI_A04_UPSTREAM_INVALID_JSON'],
  [Object.assign(new Error('secret-in-body'),{code:'AI_VAULT_DECRYPT_FAILED'}),'SI_A04_VAULT_UNAVAILABLE']
 ];
 for(const [error,expected] of rows){
  const result=classifyA04ProviderFailure(error);
  assert.equal(result.code,expected);
  assert.ok(!JSON.stringify(result).includes('secret-in-body'));
 }
});
test('unknown provider errors remain opaque and do not leak upstream message',()=>{
 const r=classifyA04ProviderFailure(new Error('token=my-secret'));
 assert.deepEqual(r,{code:'SI_A04_PROVIDER_UNAVAILABLE',status:502});
});

test('A04 resolves nested undici fetch cause into safe transport categories',()=>{
 const cases=[
  ['UND_ERR_CONNECT_TIMEOUT','SI_A04_UPSTREAM_TIMEOUT',504,'CONNECT_OR_RESPONSE_TIMEOUT'],
  ['ENOTFOUND','SI_A04_NETWORK_UNAVAILABLE',502,'DNS_NOT_FOUND'],
  ['EAI_AGAIN','SI_A04_NETWORK_UNAVAILABLE',502,'DNS_TEMPORARILY_UNAVAILABLE'],
  ['ECONNREFUSED','SI_A04_NETWORK_UNAVAILABLE',502,'CONNECTION_REFUSED'],
  ['ECONNRESET','SI_A04_NETWORK_UNAVAILABLE',502,'CONNECTION_RESET'],
  ['CERT_HAS_EXPIRED','SI_A04_NETWORK_UNAVAILABLE',502,'TLS_CERTIFICATE_INVALID'],
  ['UNABLE_TO_VERIFY_LEAF_SIGNATURE','SI_A04_NETWORK_UNAVAILABLE',502,'TLS_CERTIFICATE_INVALID']
 ];
 for(const [cause,code,status,reason] of cases){
  const error=new TypeError('fetch failed: secret https://upstream.example/secret',{
   cause:Object.assign(new Error('upstream has private identity and URL'),{code:cause})
  });
  const classified=classifyA04ProviderFailure(error);
  assert.deepEqual(classified,{code,status,transportReason:reason});
  const printed=JSON.stringify(classified);
  assert.ok(!printed.includes('secret'));
  assert.ok(!printed.includes('upstream.example'));
  assert.ok(!printed.includes('private identity'));
 }
});
