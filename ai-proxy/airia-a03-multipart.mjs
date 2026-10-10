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
export function summarizeA03HttpFailure(status,body,contentType='') {
  let payload=null;
  try{payload=JSON.parse(body);}catch{}
  const errObj=payload?.errors;
  const validationFields=errObj&&typeof errObj==='object'&&!Array.isArray(errObj)?
    Object.keys(errObj).filter(x=>/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(x)).slice(0,10):[];
  const descriptions=[
    payload?.title,payload?.message,payload?.error,payload?.detail,
    ...(errObj&&typeof errObj==='object'?Object.values(errObj).flat().slice(0,10):[])
  ].filter(x=>typeof x==='string').join(' ').toLowerCase();
  const category=
    /multipart|form.data|boundary/.test(descriptions)?'MULTIPART_FORMAT':
    /userinput|user.input/.test(descriptions)?'USER_INPUT':
    /\bfile\b|upload|attachment|\.pdf|content.type/.test(descriptions)?'FILE_ATTACHMENT':
    /pipeline|not.found/.test(descriptions)?'PIPELINE':
    /schema|validation|required|invalid|field/.test(descriptions)?'VALIDATION':
    'UNCLASSIFIED';
  const media=/application\/json/i.test(contentType)?'json':
    /text\/plain/i.test(contentType)?'text':'other';
  return {status:Number(status)||0,category,validationFields,media};
}
