/**
 * Airia A03 v3.1 multipart-wire contract.
 * JSON part is metadata only; the actual PDF travels in the separate file part.
 * Prevents sending an 8-14 KB extracted document text a second time as userInput.
 */
export function buildA03MultipartUserInput(input) {
  const out={
    requestMeta:{
      correlationId:input?.requestMeta?.correlationId,
      language:input?.requestMeta?.language||'en'
    },
    subject:{type:'VESSEL',imo:input?.subject?.imo},
    evidenceId:input?.evidenceId,
    driveFileId:input?.driveFileId,
    expectedFields:Array.isArray(input?.expectedFields)?
      input.expectedFields.filter(x=>typeof x==='string').slice(0,20):[],
    validationProfile:input?.validationProfile||'MARITIME_CERT_POC_V1'
  };
  // An unrecognized placeholder such as VESSEL_DOCUMENT_EVIDENCE_PACK is not
  // a valid maritime certificate type in the partner's example v3.1 contract.
  // Let Airia classify an unknown document rather than force that enum.
  if(input?.documentTypeHint&&input.documentTypeHint!=='VESSEL_DOCUMENT_EVIDENCE_PACK')
    out.documentTypeHint=input.documentTypeHint;
  return out;
}

/**
 * Return only allowlisted metadata of an upstream 4xx/5xx response.
 * Never print vendor response text, PDF contents, request JSON or API secrets.
 */
const SAFE_ERROR_KEYS=new Set([
  'error','errors','errormessages','message','messages','detail','details',
  'title','type','status','statuscode','code','reason','description','exception',
  'validationerrors','validation','fields','issues','result','response','data',
  'errorcode','success','requestid','traceid','problem','innererror'
]);
function publicKey(value){
  if(typeof value!=='string'||!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value))return null;
  return SAFE_ERROR_KEYS.has(value.toLowerCase())?value:null;
}
function walkError(value,depth,visited,paths,messages,root=''){
  if(depth>5||visited.count++>75||paths.length>=25)return;
  if(typeof value==='string'){
    if(root&&messages.length<25)messages.push(value.slice(0,300)); // only in memory
    return;
  }
  if(Array.isArray(value)){
    for(const item of value.slice(0,12))walkError(item,depth+1,visited,paths,messages,root+'[]');
    return;
  }
  if(!value||typeof value!=='object')return;
  for(const [name,item] of Object.entries(value).slice(0,25)){
    const key=publicKey(name);
    if(!key)continue; // unknown names / dynamic personal data never logged
    const path=(root?root+'.':'')+key;
    paths.push(path);
    walkError(item,depth+1,visited,paths,messages,path);
  }
}
export function summarizeA03HttpFailure(status,body,contentType='') {
  let payload=null;
  try{payload=JSON.parse(body);}catch{}
  const knownPaths=[],messages=[],seen={count:0};
  walkError(payload,0,seen,knownPaths,messages);
  const errObj=payload?.errors||payload?.Errors||payload?.validationErrors;
  const validationFields=errObj&&typeof errObj==='object'&&!Array.isArray(errObj)?
    Object.keys(errObj).filter(x=>/^(userInput|file|files|attachment|pipelineId|asyncOutput|payload|document|metadata)$/i.test(x)).slice(0,10):[];
  const errorText=messages.join(' ').toLowerCase(); // never logged
  const category=
    /multipart|form.data|boundary|unexpected end.of stream/.test(errorText)?'MULTIPART_FORMAT':
    /userinput|user.input|prompt|input string/.test(errorText)?'USER_INPUT':
    /\bfile\b|upload|attachment|\.pdf|content.type|unsupported media/.test(errorText)?'FILE_ATTACHMENT':
    /pipeline|not.found|does.not.exist/.test(errorText)?'PIPELINE':
    /schema|validation|required|invalid|field|parameter|malformed|parse/.test(errorText)?'VALIDATION':
    'UNCLASSIFIED';
  const media=/application\/(?:problem\+)?json/i.test(contentType)?'json':
    /text\/plain/i.test(contentType)?'text':'other';
  const responseShape=payload===null?'NON_JSON':Array.isArray(payload)?'JSON_ARRAY':
    typeof payload==='object'?'JSON_OBJECT':'JSON_SCALAR';
  return {status:Number(status)||0,category,validationFields,media,responseShape,
    knownPaths:[...new Set(knownPaths)].slice(0,20),
    bodyLength:typeof body==='string'?body.length:0};
}
