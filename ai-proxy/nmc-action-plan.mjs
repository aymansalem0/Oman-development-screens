/**
 * A01 is the ONLY AI origin of proposed NMC case actions.
 * Strict normalization of an actual Airia situation-assessment response:
 * no fabricated actions, no direct DB writes, no inferred risk scores.
 */
const allowTypes=new Set([
  'VERIFY_CERTIFICATE','ENHANCED_MONITORING','PRIORITY_INSPECTION',
  'REVIEW_DEFICIENCY','VERIFY_DEFICIENCY_CLOSURE',
  'REQUEST_EXTERNAL_VERIFICATION','NO_ACTION'
]);
const groups={
  VERIFY_CERTIFICATE:['CERTIFICATE'],
  ENHANCED_MONITORING:['MOVEMENT'],
  PRIORITY_INSPECTION:['INSPECTION','CERTIFICATE'],
  REVIEW_DEFICIENCY:['INSPECTION'],
  VERIFY_DEFICIENCY_CLOSURE:['INSPECTION'],
  REQUEST_EXTERNAL_VERIFICATION:['CERTIFICATE'],
  NO_ACTION:[]
};
const labels={
  VERIFY_CERTIFICATE:'Verify maritime certificate status',
  ENHANCED_MONITORING:'Maintain enhanced vessel monitoring',
  PRIORITY_INSPECTION:'Request priority vessel inspection',
  REVIEW_DEFICIENCY:'Review open inspection deficiencies',
  VERIFY_DEFICIENCY_CLOSURE:'Verify evidence of deficiency closure',
  REQUEST_EXTERNAL_VERIFICATION:'Request independent evidence verification',
  NO_ACTION:'No further intervention recommended'
};
const roles={
  VERIFY_CERTIFICATE:'COMPLIANCE_OFFICER',
  ENHANCED_MONITORING:'NMC_OFFICER',
  PRIORITY_INSPECTION:'INSPECTION_OFFICER',
  REVIEW_DEFICIENCY:'COMPLIANCE_OFFICER',
  VERIFY_DEFICIENCY_CLOSURE:'COMPLIANCE_OFFICER',
  REQUEST_EXTERNAL_VERIFICATION:'COMPLIANCE_OFFICER',
  NO_ACTION:'NMC_OFFICER'
};
/**
 * Only bounded, non-sensitive action identifiers/types are returned on parse
 * failure. Never return raw Airia content, payload, certificates or evidence.
 */
export class ActionPlanError extends Error{
  constructor(code,status=422,details={}){
    super(code);this.code=code;this.status=status;this.details=details;
  }
}
const safeDiagnostic=value=>typeof value==='string'
  ?value.trim().replace(/[^a-zA-Z0-9 _./-]/g,'?').slice(0,80)
  :'(missing)';
const normalizeIdentifier=value=>{
  if(typeof value!=='string')return null;
  // A01 may use camelCase, UPPER_SNAKE_CASE or kebab-case. The platform
  // requires safe lowercase kebab-case for persisted tasks and API paths.
  const normalized=value.trim()
    .replace(/([a-z0-9])([A-Z])/g,'$1-$2')
    .replace(/[_\s]+/g,'-').toLowerCase();
  return /^[-a-z0-9]{1,60}$/.test(normalized)?normalized:null;
};
const aliases=Object.freeze({
  REQUEST_PRIORITY_INSPECTION:'PRIORITY_INSPECTION',
  CREATE_PRIORITY_INSPECTION:'PRIORITY_INSPECTION',
  VERIFY_CERTIFICATE_STATUS:'VERIFY_CERTIFICATE',
  MAINTAIN_ENHANCED_MONITORING:'ENHANCED_MONITORING',
  REVIEW_OPEN_DEFICIENCY:'REVIEW_DEFICIENCY',
  REQUEST_INDEPENDENT_VERIFICATION:'REQUEST_EXTERNAL_VERIFICATION'
});
const normalizeActionType=value=>{
  if(typeof value!=='string')return '';
  const canonical=value.trim()
    .replace(/([a-z0-9])([A-Z])/g,'$1_$2')
    .replace(/[\s-]+/g,'_').toUpperCase();
  return aliases[canonical]||canonical;
};
function extract(raw){
  let value=raw;
  for(let i=0;i<6;i++){
    if(value===undefined||value===null)
      throw new ActionPlanError('A01_ACTIONS_NOT_AVAILABLE');
    if(typeof value==='string'){
      try{value=JSON.parse(value);}catch{throw new ActionPlanError('A01_UNSUPPORTED_RESPONSE');}
    }
    if(Array.isArray(value)){
      if(value.length!==1)throw new ActionPlanError('A01_UNSUPPORTED_RESPONSE');
      value=value[0];continue;
    }
    if(!value||typeof value!=='object')
      throw new ActionPlanError('A01_UNSUPPORTED_RESPONSE');
    if(Array.isArray(value.proposedActions))return value;
    value=value.result??value.output??value.response??value.data??
      value.finalOutput??value.outputText??value.content??value.text;
  }
  throw new ActionPlanError('A01_ACTIONS_NOT_AVAILABLE');
}
const safeText=(v,max=400)=>typeof v==='string'?v.trim().slice(0,max):'';
const unique=x=>[...new Set(x)];
export function normalizeA01Actions(raw,{imo,assessmentId,score,level,configVersion,signals}){
  const src=extract(raw);
  if(!src.proposedActions.length||src.proposedActions.length>20)
    throw new ActionPlanError('A01_ACTIONS_NOT_AVAILABLE');
  const verified=new Set((signals||[]).flatMap(s=>Array.isArray(s.evidenceIds)?s.evidenceIds:[])
    .filter(e=>typeof e==='string'&&e.length<=100));
  const evidenceGroups=new Map();
  for(const evidence of src.evidence||[]){
    if(!evidence||typeof evidence!=='object')continue;
    const type=safeText(evidence.type,40).toUpperCase();
    const refs=(Array.isArray(evidence.evidenceIds)?evidence.evidenceIds:[])
      .filter(id=>verified.has(id));
    evidenceGroups.set(type,unique([...(evidenceGroups.get(type)||[]),...refs]));
  }
  const ids=new Set();
  const proposedActions=src.proposedActions.map((a,index)=>{
    const actionIndex=index+1;
    if(!a||typeof a!=='object'||Array.isArray(a))
      throw new ActionPlanError('A01_ACTION_ID_INVALID',422,{actionIndex,actionId:'(missing)'});
    const rawId=a.actionId;
    const actionId=normalizeIdentifier(rawId);
    if(!actionId){
      throw new ActionPlanError('A01_ACTION_ID_INVALID',422,{
        actionIndex,actionId:safeDiagnostic(rawId)
      });
    }
    if(ids.has(actionId)){
      throw new ActionPlanError('A01_ACTION_ID_DUPLICATE',422,{
        actionIndex,actionId
      });
    }
    const actionType=normalizeActionType(a?.actionType);
    if(!allowTypes.has(actionType)){
      throw new ActionPlanError('A01_ACTION_TYPE_UNSUPPORTED',422,{
        actionIndex,actionType:safeDiagnostic(a?.actionType)
      });
    }
    ids.add(actionId);
    if(a.requiresHumanApproval!==true && a.requiresHumanApproval!==false)
      throw new ActionPlanError('A01_APPROVAL_METADATA_MISSING');
    const confidence=Number(a.confidence);
    if(!Number.isFinite(confidence)||confidence<0||confidence>1)
      throw new ActionPlanError('A01_ACTION_CONFIDENCE_INVALID');
    const explicit=Array.isArray(a.evidenceIds)?a.evidenceIds.filter(id=>verified.has(id)):[];
    const correlated=groups[actionType].flatMap(g=>evidenceGroups.get(g)||[]);
    const evidenceIds=unique([...explicit,...correlated]);
    if(actionType!=='NO_ACTION'&&!evidenceIds.length)
      throw new ActionPlanError('A01_ACTION_EVIDENCE_MISSING');
    const rawPriority=safeText(a.priority,20).toUpperCase();
    const priority=['IMMEDIATE','CRITICAL','HIGH','MEDIUM','MONITOR','ROUTINE'].includes(rawPriority)
      ?rawPriority:'HIGH';
    return {actionId,actionType,title:safeText(a.title,140)||labels[actionType],
      reason:safeText(a.reason||a.rationale,400)||
        'A01 recommendation linked to the validated source evidence IDs',
      ownerRole:roles[actionType],priority,confidence,evidenceIds,
      requiresHumanApproval:a.requiresHumanApproval,decision:'PENDING'};
  });
  return {
    source:'AIRIA_A01_SITUATION_ASSESSMENT',
    imo,sourceAssessmentId:assessmentId||null,sourceScore:score,
    sourceLevel:level,configVersion:configVersion||null,
    agentAssessmentId:safeText(src.assessmentId,100)||null,
    summary:safeText(src.summary,800),whyItMatters:safeText(src.whyItMatters,800),
    createdAt:new Date().toISOString(),proposedActions
  };
}