/** Safe A04 provider diagnostics: never include request/response bodies or secrets. */
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
 if(code==='ETIMEDOUT'||code==='UND_ERR_CONNECT_TIMEOUT'||
    error?.name==='TimeoutError'||error?.name==='AbortError')
  return {code:'SI_A04_UPSTREAM_TIMEOUT',status:504};
 if(error instanceof TypeError||code==='ECONNREFUSED'||code==='ENOTFOUND'||
    code==='ECONNRESET'||code==='EAI_AGAIN')
  return {code:'SI_A04_NETWORK_UNAVAILABLE',status:502};
 return {code:'SI_A04_PROVIDER_UNAVAILABLE',status:502};
}
