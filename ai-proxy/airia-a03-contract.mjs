/**
 * Airia A03 v3.1 -> NMC evidence-review adapter.
 * Evidence is copied verbatim from the retrieved document text.
 */
export class A03ContractError extends Error {
  constructor(code) { super(code); this.code=code; }
}
const clean=v=>typeof v==='string'?v.trim().slice(0,250):null;
const field=v=>v&&typeof v==='object'&&!Array.isArray(v)?v.value:v;
const isObj=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const envelopeKeys=['result','response','output','data','finalOutput','outputText',
  'content','value','message','messages','results','text','body','generatedText',
  'executionResult','pipelineOutput','items'];

function parseJson(value) {
  if(typeof value!=='string')return value;
  let raw=value.trim();
  raw=raw.replace(/^\x60{3}(?:json)?\s*/i,'').replace(/\s*\x60{3}$/,'').trim();
  try{return JSON.parse(raw);}catch{return null;}
}
function locate(value,level=0){
  if(level>10)return null;
  const data=parseJson(value);
  if(Array.isArray(data)){
    for(const item of data.slice(0,16)){
      const found=locate(item,level+1);
      if(found)return found;
    }
    return null;
  }
  if(!isObj(data))return null;
  if(isObj(data.extracted)||(isObj(data.extractedFields)&&isObj(data.classification)))
    return data;
  for(const k of envelopeKeys){
    if(data[k]===undefined)continue;
    const found=locate(data[k],level+1);
    if(found)return found;
  }
  return null;
}
function sourceQuote(source,value) {
  if(!value||typeof value!=='string')return null;
  const index=source.toLowerCase().indexOf(value.trim().toLowerCase());
  if(index<0)return null;
  const start=Math.max(0,index-45);
  const end=Math.min(source.length,index+value.trim().length+65);
  const quote=source.slice(start,Math.min(end,start+250)).trim();
  return quote.length>=5?quote:null;
}
const asDate=v=>{
  const x=clean(field(v));
  return x&&/^\d{4}-\d{2}-\d{2}$/.test(x)?x:null;
};
const val=(fields,name)=>clean(field(fields[name]));
const fieldConfidence=v=>{
  const n=Number(v&&typeof v==='object'?v.confidence:NaN);
  return Number.isFinite(n)&&n>=0&&n<=1?n:null;
};
const allowedStatus=v=>clean(v)||'REVIEW_REQUIRED';

export function normalizeAiriaA03(raw,sourceText){
  const response=locate(raw);
  if(!response)throw new A03ContractError('A03_RESPONSE_CONTRACT_UNVERIFIED');
  if(isObj(response.extracted))return response;
  const fields=response.extractedFields;
  const classification=clean(response.classification?.type);
  if(!classification||!isObj(fields))
    throw new A03ContractError('A03_RESPONSE_CONTRACT_UNVERIFIED');

  const imo=val(fields,'imo');
  const vesselName=val(fields,'vesselName');
  const certificateNumber=val(fields,'certificateNumber');
  const issuingAuthority=val(fields,'issuer')||val(fields,'issuingAuthority');
  const expiryDate=asDate(fields.expiryDate);
  const issueDate=asDate(fields.issueDate);
  const candidates=[certificateNumber,vesselName,imo].filter(Boolean);
  if(!candidates.length)
    throw new A03ContractError('A03_REQUIRED_FIELDS_MISSING');
  for(const value of candidates){
    if(!sourceQuote(sourceText,value))
      throw new A03ContractError('A03_EVIDENCE_NOT_IN_DOCUMENT');
  }
  const quotes=[...new Set(candidates.map(v=>sourceQuote(sourceText,v)).filter(Boolean))].slice(0,12);
  if(!quotes.length)throw new A03ContractError('A03_EVIDENCE_MISSING');
  const rawConfidence=Number(response.classification?.confidence);
  const confidence=Number.isFinite(rawConfidence)&&rawConfidence>=0&&rawConfidence<=1?
    rawConfidence:0;
  const extracted={imo,vesselName,documentType:classification,certificateNumber,
    issuingAuthority,issueDate,expiryDate};
  // v3.1 returns one classification: never treat it as full-pack coverage.
  const documentEntries=[{imo,documentType:classification,certificateNumber,
    issuingAuthority,issueDate,expiryDate,
    status:allowedStatus(response.validation?.status),
    evidenceQuotes:quotes.slice(0,8)}];
  const validationStatus=clean(response.validation?.status);
  const integrity=response.integrity||{};
  const providerDetails={
    contract:'AIRIA_A03_V3_1',
    analysisId:clean(response.analysisId),
    classificationConfidence:confidence,
    fieldConfidence:{
      imo:fieldConfidence(fields.imo),
      vesselName:fieldConfidence(fields.vesselName),
      certificateNumber:fieldConfidence(fields.certificateNumber),
      issuer:fieldConfidence(fields.issuer||fields.issuingAuthority),
      issueDate:fieldConfidence(fields.issueDate),
      expiryDate:fieldConfidence(fields.expiryDate)
    },
    validationStatus,
    validationExceptions:Array.isArray(response.validation?.exceptions)?
      response.validation.exceptions.slice(0,12).map(clean).filter(Boolean):[],
    tamperSuspected:integrity.tamperSuspected===true,
    imageQuality:clean(integrity.quality),
    integrityConfidence:Number.isFinite(Number(integrity.confidence))?
      Number(integrity.confidence):null,
    externalVerificationRequired:true,
    requiresHumanReview:true,
    sectionCoverage:'SINGLE_CLASSIFICATION_ONLY'
  };
  return {extracted,documentEntries,confidence,evidenceQuotes:quotes,providerDetails};
}