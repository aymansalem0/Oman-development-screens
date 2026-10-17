/** Safe A04 provider diagnostics: never include request/response bodies or secrets.
 * Classify undici/node-fetch nested causes; returned reason is an allowlisted
 * constant, NEVER a provider message, URL, hostname or arbitrary error code.
 */
function networkCauseCode(error){
 const seen=new Set(),pending=[error];
 for(let i=0;i<pending.length&&i<8;i++){
  const current=pending[i];
  if(!current||typeof current!=='object'||seen.has(current))continue;
  seen.add(current);
  const code=current.code;
  if(typeof code==='string'&&[
   'UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT',
   'ETIMEDOUT','ENOTFOUND','EAI_AGAIN','ECONNREFUSED','ECONNRESET',
   'EHOSTUNREACH','ENETUNREACH','UND_ERR_SOCKET','CERT_HAS_EXPIRED',
   'UNABLE_TO_VERIFY_LEAF_SIGNATURE','SELF_SIGNED_CERT_IN_CHAIN',
   'DEPTH_ZERO_SELF_SIGNED_CERT','ERR_TLS_CERT_ALTNAME_INVALID'
  ].includes(code))return code;
  if(current.cause)pending.push(current.cause);
  if(Array.isArray(current.errors))pending.push(...current.errors.slice(0,4));
 }
 return null;
}
export function classifyA04ProviderFailure(error){
 const message=typeof error?.message==='string'?error.message:'';
 const code=typeof error?.code==='string'?error.code:'';
 const known={'AIRIA_NOT_CONFIGURED':['SI_A04_KEY_MISSING',503],
   'AIRIA_PIPELINE_NOT_CONFIGURED':['SI_A04_PIPELINE_MISSING',503],
   'AIRIA_AGENT_DISABLED':['SI_A04_DISABLED',503],
   'AIRIA_RESPONSE_INVALID_JSON':['SI_A04_UPSTREAM_INVALID_JSON',502],
   'AI_VAULT_KEY_NOT_AVAILABLE':['SI_A04_VAULT_UNAVAILABLE',503],
   'AI_VAULT_DECRYPT_FAILED':['SI_A04_VAULT_UNAVAILABLE',503],
   'AI_VAULT_READ_FAILED':['SI_A04_VAULT_UNAVAILABLE',503]};
 const hit=known[code]||known[message];
 if(hit)return {code:hit[0],status:hit[1]};
 const m=/^AIRIA_REQUEST_FAILED_(\d{3})$/.exec(message);
 if(m){
  const status=Number(m[1]);
  if(status===401||status===403)return {code:'SI_A04_UPSTREAM_AUTH_REJECTED',status:502,upstreamStatus:status};
  if(status===404)return {code:'SI_A04_UPSTREAM_PIPELINE_NOT_FOUND',status:502,upstreamStatus:status};
  if(status===429)return {code:'SI_A04_UPSTREAM_RATE_LIMITED',status:503,upstreamStatus:status};
  if(status>=500)return {code:'SI_A04_UPSTREAM_SERVER_ERROR',status:502,upstreamStatus:status};
  return {code:'SI_A04_UPSTREAM_HTTP_REJECTED',status:502,upstreamStatus:status};
 }
 const cause=networkCauseCode(error);
 if(cause&&[
  'UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT','ETIMEDOUT'
 ].includes(cause))return {code:'SI_A04_UPSTREAM_TIMEOUT',status:504,transportReason:'CONNECT_OR_RESPONSE_TIMEOUT'};
 if(error?.name==='TimeoutError'||error?.name==='AbortError')
  return {code:'SI_A04_UPSTREAM_TIMEOUT',status:504,transportReason:'REQUEST_TIMEOUT'};
 const reasons={
  ENOTFOUND:'DNS_NOT_FOUND',EAI_AGAIN:'DNS_TEMPORARILY_UNAVAILABLE',
  ECONNREFUSED:'CONNECTION_REFUSED',ECONNRESET:'CONNECTION_RESET',
  EHOSTUNREACH:'HOST_UNREACHABLE',ENETUNREACH:'NETWORK_UNREACHABLE',
  UND_ERR_SOCKET:'SOCKET_CLOSED',
  CERT_HAS_EXPIRED:'TLS_CERTIFICATE_INVALID',
  UNABLE_TO_VERIFY_LEAF_SIGNATURE:'TLS_CERTIFICATE_INVALID',
  SELF_SIGNED_CERT_IN_CHAIN:'TLS_CERTIFICATE_INVALID',
  DEPTH_ZERO_SELF_SIGNED_CERT:'TLS_CERTIFICATE_INVALID',
  ERR_TLS_CERT_ALTNAME_INVALID:'TLS_CERTIFICATE_INVALID'};
 if(cause&&reasons[cause])
  return {code:'SI_A04_NETWORK_UNAVAILABLE',status:502,transportReason:reasons[cause]};
 if(error instanceof TypeError||['ECONNREFUSED','ENOTFOUND','ECONNRESET','EAI_AGAIN'].includes(code))
  return {code:'SI_A04_NETWORK_UNAVAILABLE',status:502,transportReason:'TRANSPORT_ERROR_UNCLASSIFIED'};
 return {code:'SI_A04_PROVIDER_UNAVAILABLE',status:502};
}
