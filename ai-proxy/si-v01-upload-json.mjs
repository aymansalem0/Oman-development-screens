/**
 * Guided SI-V01 photo transport (single explicit inspector action).
 * Partner SI-P1 agents are specified as JSON PipelineExecution agents.
 * Images are first uploaded as Airia attachments, then passed using
 * the SDK-documented 'images' array of secure uploaded URLs.
 *
 * No implicit fallback to Multipart; a failing upload never executes
 * the pipeline, and a failing execution is NEVER automatically retried.
 */
export class SiV01TransportError extends Error {
 constructor(code,status,stage,diagnostic=null){
  super(code);this.code=code;this.status=status;this.stage=stage;
  if(diagnostic)this.safeDiagnostic=diagnostic;
 }
}
const types={'image/jpeg':'.jpg','image/png':'.png','image/webp':'.webp'};
const isRecord=x=>x&&typeof x==='object'&&!Array.isArray(x);
const safeDiagnostic=(stage,status)=>({
  stage,upstreamStatus:Number(status)||0,
  category:'UNCLASSIFIED',validationFields:[],responseShape:'UNKNOWN',media:'other'
});
const approvedRef=value=>{
 if(typeof value!=='string'||value.length>2048)return null;
 try{const url=new URL(value);
  if(url.protocol!=='https:'||!url.hostname||url.username||url.password)return null;
  return url.toString();
 }catch{return null;}
};
export function extractV01UploadedImageRef(response){
 if(!isRecord(response))return null;
 const x=isRecord(response.data)?response.data:response;
 // Partner's public SDK exposes image_url; variants cover JS/.NET serializers.
 const urls=[x.image_url,x.imageUrl,x.signed_url,x.signedUrl,x.url];
 for(const uri of urls){const ref=approvedRef(uri);if(ref)return ref;}
 return null;
}
async function safeBodyJson(reply){
 const body=await reply.text();
 if(body.length>65536)throw new SiV01TransportError(
   'SI_V01_UPLOAD_RESPONSE_TOO_LARGE',502,'UPLOAD');
 try{return JSON.parse(body);}
 catch{throw new SiV01TransportError(
   'SI_V01_UPLOAD_INVALID_JSON',502,'UPLOAD');}
}
const filename=media=>media.evidenceId+(types[media.mimeType]||'.bin');
export async function executeGuidedV01UploadJson({
 request,media,baseUrl,key,pipelineId,
 fetchImpl=fetch,timeoutMs=120000
}={}){
 if(!key||!pipelineId||!baseUrl)
  throw new SiV01TransportError('SI_V01_NOT_CONFIGURED',503,'SETUP');
 if(!request?.requestMeta?.correlationId||!media||!Buffer.isBuffer(media.bytes)||
    !media.bytes.length||media.bytes.length>2*1024*1024||
    !Object.hasOwn(types,media.mimeType))
  throw new SiV01TransportError('SI_V01_IMAGE_INVALID',422,'SETUP');
 if(typeof fetchImpl!=='function')
  throw new SiV01TransportError('SI_V01_FETCH_INVALID',500,'SETUP');
 const form=new FormData();
 form.set('file',new Blob([media.bytes],{type:media.mimeType}),filename(media));
 const base=baseUrl.replace(/\/$/,'');
 // Every screenshot is uploaded only after the user explicitly confirms cost.
 // Never log file bytes, signed URLs, metadata, API credentials, or request body.
 let uploaded;
 try{
  uploaded=await fetchImpl(base+'/v1/upload',{
    method:'POST',headers:{'X-API-KEY':key,'User-Agent':'moei-si-v01/1.1'},
    body:form,signal:AbortSignal.timeout(timeoutMs)
  });
 }catch(error){
  if(error?.name==='TimeoutError'||error?.name==='AbortError')
   throw new SiV01TransportError('SI_V01_UPLOAD_TIMEOUT',504,'UPLOAD');
  throw new SiV01TransportError('SI_V01_UPLOAD_NETWORK_UNAVAILABLE',502,'UPLOAD');
 }
 if(!uploaded.ok)throw new SiV01TransportError(
  'SI_V01_UPLOAD_REJECTED',502,'UPLOAD',safeDiagnostic('UPLOAD',uploaded.status));
 const imageRef=extractV01UploadedImageRef(await safeBodyJson(uploaded));
 if(!imageRef)throw new SiV01TransportError(
  'SI_V01_UPLOAD_REFERENCE_UNAVAILABLE',502,'UPLOAD',
  {stage:'UPLOAD',category:'UNRECOGNIZED_IMAGE_REFERENCE',
   responseShape:'JSON_OBJECT',validationFields:[],media:'json'});
 // Execute the documented JSON endpoint with image reference, not Multipart.
 const body={userInput:JSON.stringify(request),asyncOutput:false,images:[imageRef]};
 let response;
 try{
  response=await fetchImpl(base+'/v1/PipelineExecution/'+pipelineId,{
    method:'POST',headers:{'X-API-KEY':key,'Content-Type':'application/json',
      'User-Agent':'moei-si-v01/1.1'},
    body:JSON.stringify(body),signal:AbortSignal.timeout(timeoutMs)
  });
 }catch(error){
  if(error?.name==='TimeoutError'||error?.name==='AbortError')
   throw new SiV01TransportError('SI_V01_JSON_EXECUTION_TIMEOUT',504,'JSON_EXECUTION');
  throw new SiV01TransportError('SI_V01_JSON_EXECUTION_NETWORK_UNAVAILABLE',
    502,'JSON_EXECUTION');
 }
 if(!response.ok)throw new SiV01TransportError(
  'SI_V01_JSON_EXECUTION_REJECTED',response.status===429?503:502,
  'JSON_EXECUTION',safeDiagnostic('JSON_EXECUTION',response.status));
 try{return await response.json();}
 catch{throw new SiV01TransportError(
   'SI_V01_JSON_EXECUTION_INVALID_JSON',502,'JSON_EXECUTION');}
}
