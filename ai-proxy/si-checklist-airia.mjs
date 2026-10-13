/** Dedicated, strictly opt-in Airia checklist pipelines.
 * Zero AI calls on GET, preview, publishing, route change or inspection submit.
 * The Vision pipeline must explicitly support image base64 in userInput JSON.
 */
import {SiChecklistError} from './si-checklist-library.mjs';

export function extractAiriaResult(raw){
 let d=raw;
 for(let i=0;i<7;i++){
  if(typeof d==='string'){try{d=JSON.parse(d);}catch{break;}continue;}
  if(!d||typeof d!=='object'||Array.isArray(d))break;
  if(Array.isArray(d.recommendations)||Array.isArray(d.suggestedGroups)||
    Array.isArray(d.suggestedItems))return d;
  const key=['result','response','output','data','finalOutput','outputText','content','value']
    .find(k=>d[k]!==undefined);
  if(!key)break;d=d[key];
 }
 return d;
}
export class SiChecklistAiria{
 constructor({apiKey=process.env.AIRIA_MENA_KEY||'',
  baseUrl=process.env.AIRIA_BASE_URL||'https://api.mena.airia.ai',
  builderPipelineId=process.env.AIRIA_SI_CHECKLIST_BUILDER_PIPELINE_ID||'',
  visionPipelineId=process.env.AIRIA_SI_CHECKLIST_VISION_PIPELINE_ID||'',
  enabled=process.env.SI_CHECKLIST_AIRIA_ENABLED==='true',
  getSetting=null,getApiKey=null,
  timeoutMs=120000,transport=fetch}={}){
  this.staticSettings={SI_CHECKLIST_AIRIA_ENABLED:enabled,
   AIRIA_BASE_URL:baseUrl,
   AIRIA_SI_CHECKLIST_BUILDER_PIPELINE_ID:builderPipelineId,
   AIRIA_SI_CHECKLIST_VISION_PIPELINE_ID:visionPipelineId,
   SI_CHECKLIST_VISION_TRANSPORT:'multipart'};
  this.setting=getSetting||((key)=>this.staticSettings[key]);
  this.secret=getApiKey||(()=>apiKey);
  this.timeoutMs=timeoutMs;this.transport=transport;
 }
 get enabled(){return this.setting('SI_CHECKLIST_AIRIA_ENABLED')===true;}
 get provider(){return 'airia';}
 get builderPipelineId(){return this.setting('AIRIA_SI_CHECKLIST_BUILDER_PIPELINE_ID')||'';}
 get visionPipelineId(){return this.setting('AIRIA_SI_CHECKLIST_VISION_PIPELINE_ID')||'';}
 get baseUrl(){return String(this.setting('AIRIA_BASE_URL')||'https://api.mena.airia.ai').replace(/\/$/,'');}
 get imageTransport(){return this.setting('SI_CHECKLIST_VISION_TRANSPORT')||'multipart';}
 get apiKey(){return this.secret();}
 status(){
  const hasKey=Boolean(this.apiKey);
  return {provider:'AIRIA',enabled:this.enabled,
   builderConfigured:Boolean(this.enabled&&hasKey&&this.builderPipelineId),
   visionConfigured:Boolean(this.enabled&&hasKey&&this.visionPipelineId),
   builderPipelineMapped:Boolean(this.builderPipelineId),
   visionPipelineMapped:Boolean(this.visionPipelineId),
   apiKeyConfigured:hasKey,
   imageTransport:this.imageTransport==='multipart'?
    'PARTNER_MULTIPART_EVIDENCE':'INLINE_JSON_REQUIRES_VERIFIED_MULTIMODAL_PIPELINE',
   automaticRuns:false,
   validatedContract:false,
   humanReviewRequired:true};
 }
 async call(mode,input){
  const key=this.apiKey;
  if(!this.enabled||!key)
   throw new SiChecklistError('SI_CHECKLIST_AIRIA_NOT_CONFIGURED',503);
  const pipeline=mode==='builder'?this.builderPipelineId:
   mode==='vision'?this.visionPipelineId:null;
  if(!pipeline)
   throw new SiChecklistError('SI_CHECKLIST_AIRIA_PIPELINE_NOT_CONFIGURED',503);
  const withImage=mode==='vision'&&input?.image?.base64;
  const multipart=withImage&&this.imageTransport==='multipart';
  let request=JSON.stringify(multipart?{...input,image:{
   mimeType:input.image.mimeType,sha256:input.image.sha256,
   attachedBy:'multipart-form-data'
  }}:input);
  if(request.length>3*1024*1024)
   throw new SiChecklistError('SI_CHECKLIST_AI_PAYLOAD_TOO_LARGE',413);
  const url=this.baseUrl+'/v1/PipelineExecution/'+
   (multipart?'Multipart/':'')+encodeURIComponent(pipeline);
  const headers={'X-API-KEY':key,
    'User-Agent':'moei-smart-inspection-checklist/1.0'};
  let body;
  if(multipart){
   const binary=Buffer.from(input.image.base64,'base64');
   if(binary.length>2*1024*1024)
    throw new SiChecklistError('SI_CHECKLIST_IMAGE_TOO_LARGE',413);
   const form=new FormData();
   form.append('userInput',request);
   form.append('file',new Blob([binary],{type:input.image.mimeType}),
     'inspection-evidence.'+(input.image.mimeType==='image/png'?'png':
      input.image.mimeType==='image/webp'?'webp':'jpg'));
   body=form;
  }else{
   headers['Content-Type']='application/json';
   body=JSON.stringify({userInput:request,asyncOutput:false});
  }
  let response;
  try{
   response=await this.transport(url,{
    method:'POST',headers,body,signal:AbortSignal.timeout(this.timeoutMs)
   });
  }catch{throw new SiChecklistError('SI_CHECKLIST_AIRIA_NETWORK_FAILED',502);}
  if(!response.ok)
   throw new SiChecklistError('SI_CHECKLIST_AIRIA_REQUEST_FAILED_'+response.status,502);
  let result;
  try{result=await response.json();}catch{
   throw new SiChecklistError('SI_CHECKLIST_AIRIA_BAD_RESPONSE',502);
  }
  return extractAiriaResult(result);
 }
 async suggestSettings({level,template,groupId,itemId,instructions,operatorPrompt}){
  if(!['TEMPLATE','GROUP','ITEM'].includes(level)||
   typeof operatorPrompt!=='string'||operatorPrompt.length>2200)
   throw new SiChecklistError('SI_CHECKLIST_BUILDER_INPUT_INVALID');
  const response=await this.call('builder',{
   schemaVersion:'SI-CHECKLIST-BUILDER-v1',level,template,groupId,itemId,
   operatorPrompt,instructions,
   constraints:{
    noAssumedStatutoryRequirements:true,
    requireHumanApproval:true,
    publishedTemplateMutationProhibited:true,
    schema:'JSON suggestedGroups[] or suggestedItems[]; each item must have title, fields[], mandatory boolean, description; include rationale and confidence'
   }
  });
  if(!response||typeof response!=='object'||
   (!Array.isArray(response.suggestedGroups)&&!Array.isArray(response.suggestedItems)))
   throw new SiChecklistError('SI_CHECKLIST_BUILDER_RESPONSE_INVALID',502);
  const raw=Array.isArray(response.suggestedGroups)?response.suggestedGroups:response.suggestedItems;
  if(raw.length>20||JSON.stringify(raw).length>30000)
   throw new SiChecklistError('SI_CHECKLIST_BUILDER_RESPONSE_TOO_LARGE',502);
  return {status:'DRAFT_REQUIRES_ADMIN_REVIEW',
   provider:'AIRIA',suggestedGroups:Array.isArray(response.suggestedGroups)?
    response.suggestedGroups:[],
   suggestedItems:Array.isArray(response.suggestedItems)?
    response.suggestedItems:[],
   rationale:typeof response.rationale==='string'?response.rationale.slice(0,1600):'',
   noRegulatoryVerification:true};
 }
}
