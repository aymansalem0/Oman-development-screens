/** Safe SI-V01 transport errors; expose status category, never key/prompt/image/URL. */
export function classifySiV01Failure(error){
 const msg=typeof error?.message==='string'?error.message:'';
 const code=typeof error?.code==='string'?error.code:'';
 const status=/^AIRIA_V01_HTTP_(\d{3})$/.exec(msg);
 if(status){
  const upstreamStatus=Number(status[1]);
  const names={
   400:'SI_V01_MULTIPART_REQUEST_REJECTED',
   401:'SI_V01_UPSTREAM_AUTH_REJECTED',
   403:'SI_V01_UPSTREAM_AUTH_REJECTED',
   404:'SI_V01_UPSTREAM_PIPELINE_NOT_FOUND',
   413:'SI_V01_IMAGE_TOO_LARGE_UPSTREAM',
   415:'SI_V01_UPSTREAM_MEDIA_UNSUPPORTED',
   422:'SI_V01_UPSTREAM_REQUEST_INVALID',
   429:'SI_V01_UPSTREAM_RATE_LIMITED'
  };
  const errorCode=names[upstreamStatus]||
    (upstreamStatus>=500?'SI_V01_UPSTREAM_SERVER_ERROR':'SI_V01_UPSTREAM_HTTP_REJECTED');
  return {error:errorCode,status:upstreamStatus===429?503:502,upstreamStatus};
 }
 if(msg==='AIRIA_V01_NOT_CONFIGURED')return {error:'SI_V01_NOT_CONFIGURED',status:503};
 if(msg==='AIRIA_V01_RESPONSE_INVALID_JSON'||error instanceof SyntaxError)
  return {error:'SI_V01_UPSTREAM_INVALID_JSON',status:502};
 if(error?.name==='TimeoutError'||error?.name==='AbortError'||
    code==='UND_ERR_CONNECT_TIMEOUT'||code==='ETIMEDOUT')
  return {error:'SI_V01_UPSTREAM_TIMEOUT',status:504};
 if(error instanceof TypeError||
   ['ENOTFOUND','ECONNRESET','ECONNREFUSED','EAI_AGAIN'].includes(code))
  return {error:'SI_V01_UPSTREAM_NETWORK_UNAVAILABLE',status:502};
 return {error:'SI_V01_UPSTREAM_PROVIDER_UNAVAILABLE',status:502};
}
