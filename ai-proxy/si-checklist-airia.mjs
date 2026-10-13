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
  timeoutMs=120000,transport=fetch}={}){
  this.apiKey=apiKey;this.baseUrl=baseUrl.replace(/\/$/,'');
  this.builderPipelineId=builderPipelineId;
  this.visionPipelineId=visionPipelineId;
  this.enabled=enabled;this.timeoutMs=timeoutMs;this.transport=transport;
 }
 status(){
  return {provider:'AIRIA',enabled:this.enabled,
   builderConfigured:Boolean(this.enabled&&this.apiKey&&this.builderPipelineId),
   visionConfigured:Boolean(this.enabled&&this.apiKey&&this.visionPipelineId),
   imageTransport:'JSON_INLINE_BASE64_REQUIRES_MULTIMODAL_AIRIA_PIPELINE',
   automaticRuns:false};
 }
 async call(mode,input){
  if(!this.enabled||!this.apiKey)
   throw new SiChecklistError('SI_CHECKLIST_AIRIA_NOT_CONFIGURED',503);
  const pipeline=mode==='builder'?this.builderPipelineId:
    mode==='vision'?this.visionPipelineId:null;
  if(!pipeline)throw new SiChecklistError('SI_CHECKLIST_AIRIA_PIPELINE_NOT_CONFIGURED',503);
  const request=JSON.stringify(input);
  if(request.length>3*1024*1024)
   throw new SiChecklistError('SI_CHECKLIST_AI_PAYLOAD_TOO_LARGE',413);
  let response;
  try{
   response=await this.transport(
    this.baseUrl+'/v1/PipelineExecution/'+encodeURIComponent(pipeline),{
     method:'POST',
     headers:{'X-API-KEY':this.apiKey,'Content-Type':'application/json',
      'User-Agent':'moei-smart-inspection-checklist/1.0'},
     body:JSON.stringify({userInput:request,asyncOutput:false}),
     signal:AbortSignal.timeout(this.timeoutMs)
    });
  }catch{throw new SiChecklistError('SI_CHECKLIST_AIRIA_NETWORK_FAILED',502);}
  if(!response.ok)
   throw new SiChecklistError('SI_CHECKLIST_AIRIA_REQUEST_FAILED_'+response.status,502);
  let body;
  try{body=await response.json();}catch{
   throw new SiChecklistError('SI_CHECKLIST_AIRIA_BAD_RESPONSE',502);
  }
  return extractAiriaResult(body);
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
