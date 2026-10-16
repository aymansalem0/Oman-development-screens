/**
 * Smart Inspection STEPS 05-08 — accountable preparation and on-demand A04.
 * No automatic AI on GET/screen-load. The immutable statutory base checklist
 * is never replaced or modified by AI. AI output remains a reviewed overlay.
 * JSON workspace is for offline POC; Oracle mode uses migration 010 only.
 */
import {randomUUID,createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync,existsSync,renameSync} from 'node:fs';
import {dirname} from 'node:path';
import oracledb from 'oracledb';

export const SI_BASE_CHECKLIST=Object.freeze([
  'fire-safety','certificates','navigation','lifesaving',
  'pollution','manning','hull-machinery','security'
]);
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const clone=x=>x===null?null:JSON.parse(JSON.stringify(x));
const clob=x=>({val:JSON.stringify(x),type:oracledb.DB_TYPE_CLOB});
const now=()=>new Date().toISOString();
const validId=x=>typeof x==='string'&&/^[0-9a-f-]{36}$/i.test(x);
const name=x=>typeof x==='string'&&x.trim().length>0&&x.trim().length<=120?x.trim():null;
const clean=(x,n=1000)=>typeof x==='string'?x.trim().slice(0,n):'';
const priorities=['CRITICAL','HIGH','WATCH','NORMAL','PRIORITY','ROUTINE'];
const focusTypes=['NMC_FOCUS','PRIORITY','VERIFY','REVIEW','ADDITIONAL'];
/**
 * POC only: place output-contract guidance INSIDE the existing A04 userInput
 * JSON sent to Airia. The configured Airia agent may ignore added keys, so
 * this never replaces the strict server-side validateA04 safety boundary.
 * This is a request hint, NOT a change to the v3.1/v2.0 wire envelope.
 */
export function a04PocOutputGuidance({baseChecklistItemIds,evidenceManifestRefs}){
  const checklistIds=[...new Set(baseChecklistItemIds)];
  const evidenceIds=[...new Set(evidenceManifestRefs)];
  return {
    mode:'POC_IN_REQUEST_OUTPUT_GUIDANCE',
    responseFormat:'ONE_JSON_OBJECT_NO_MARKDOWN',
    instructions:[
      'Return ONE JSON object with focusAreas, checklistFocus, suggestedAdditionalItems and agentConfidence. Do not wrap in markdown. The Airia transport may wrap the object in result.',
      'focusAreas[].category and focusAreas[].reason MUST be non-empty strings.',
      'focusAreas[].priority MUST be exactly one of the allowedPriorityValues. Do NOT return MEDIUM; select a permitted value based on the supplied evidence, without guessing or upgrading severity.',
      'focusAreas[].evidenceIds MUST contain at least one exact ID from allowedEvidenceIds. Do not invent IDs.',
      'checklistFocus[].existingItemId MUST be from allowedChecklistItemIds.',
      'checklistFocus[].focus MUST be EXACTLY one allowedChecklistFocusValue: it is a machine-readable enum, NOT natural-language instructions.',
      'Put natural-language inspection suggestions in checklistFocus[].reason and valid evidence references in checklistFocus[].reasonEvidenceIds. Do NOT put instructions in focus.',
      'Never provide suggestedSeverityIfFailed or assign regulatory deficiency severity. Potential deficiencies are hypotheses only, never confirmed findings.',
      'Provide suggestedAdditionalItems as an array (empty if none), optional predictedDeficiencies as hypotheses, optional missingEvidence as an array, and agentConfidence as a number between 0 and 1.',
      'For predictedDeficiencies, include only evidence-backed hypotheses; each entry must include category, hypothesisOnly: true as a JSON boolean, and nonempty evidenceIds selected from allowedEvidenceIds.',
      'If no source-supported hypotheses exist, return predictedDeficiencies: []. The mandatory checklist is always independent of AI results.',
      'Advisory focus only: do not add, change or remove mandatory checklist items, official vessel risk, approved inspection scope, legal findings or bookings. Human inspector review is required.'
    ],
    allowedPriorityValues:[...priorities],
    allowedChecklistFocusValues:[...focusTypes],
    allowedChecklistItemIds:checklistIds,
    allowedEvidenceIds:evidenceIds,
    requiredShape:{
      focusAreas:[{category:'string',priority:'allowedPriorityValues',
        reason:'non-empty string',evidenceIds:['allowedEvidenceIds']}],
      checklistFocus:[{existingItemId:'allowedChecklistItemIds',
        focus:'allowedChecklistFocusValues',reason:'inspection explanation',
        reasonEvidenceIds:['allowedEvidenceIds']}],
      suggestedAdditionalItems:[],
      agentConfidence:'number between 0 and 1'
    },
    optionalPredictedDeficienciesItemShape:{
      category:'non-empty string',hypothesisOnly:true,
      evidenceIds:['allowedEvidenceIds']
    },
    noPredictedDeficienciesResponse:{predictedDeficiencies:[]}
  };
}
function safeJson(data){
  let cur=data;
  for(let n=0;n<7;n++){
    if(typeof cur==='string'){try{cur=JSON.parse(cur);}catch{break;}continue;}
    if(!cur||typeof cur!=='object'||Array.isArray(cur))break;
    if(Array.isArray(cur.focusAreas)&&Array.isArray(cur.checklistFocus))return cur;
    let child;
    for(const k of ['result','response','output','data','finalOutput','outputText','content','value','dossier']){
      if(cur[k]!==undefined){child=cur[k];break;}
    }
    if(child===undefined)break;
    cur=child;
  }
  return cur;
}
export class SiPreparationError extends Error{
  constructor(code,status=400,field=null){super(code);this.code=code;this.status=status;
    // Validation field is an allowlisted schema path, never model text/PII.
    this.field=field;}
}
export function validateA04(raw,{checkIds,evidenceIds}){
  const data=safeJson(raw);
  if(!data||typeof data!=='object'||!Array.isArray(data.focusAreas)||
    !Array.isArray(data.checklistFocus)||!Array.isArray(data.suggestedAdditionalItems||[]))
    throw new SiPreparationError('SI_A04_RESPONSE_INVALID',502);
  const known=new Set(evidenceIds),allowedChecks=new Set(checkIds);
  const refs=(value,required=false)=>{
    if(!Array.isArray(value)||value.length>30||value.some(x=>typeof x!=='string'||!known.has(x))||
      (required&&!value.length))throw new SiPreparationError('SI_A04_UNVERIFIED_EVIDENCE',502);
    return [...new Set(value)];
  };
  if(data.focusAreas.length>20||data.checklistFocus.length>24||
    (data.predictedDeficiencies||[]).length>20)
    throw new SiPreparationError('SI_A04_RESULT_TOO_LARGE',502);
  if(data.predictedDeficiencies!==undefined&&!Array.isArray(data.predictedDeficiencies))
    throw new SiPreparationError('SI_A04_RESPONSE_INVALID',502);
  const focusAreas=data.focusAreas.map((f,index)=>{
    // Model prose may vary by requested response language, but these
    // machine-readable enum tokens are language-neutral contract values.
    // Whitespace/case normalisation changes formatting, NOT priority.
    const prefix='focusAreas['+index+'].';
    if(!f||typeof f!=='object'||Array.isArray(f))
      throw new SiPreparationError('SI_A04_FOCUS_INVALID',502,prefix.slice(0,-1));
    if(typeof f.category!=='string'||!clean(f.category,90))
      throw new SiPreparationError('SI_A04_FOCUS_INVALID',502,prefix+'category');
    const priority=typeof f.priority==='string'?
      f.priority.trim().toUpperCase():'';
    if(!priorities.includes(priority))
      throw new SiPreparationError('SI_A04_FOCUS_INVALID',502,prefix+'priority');
    if(!clean(f.reason,1400))
      throw new SiPreparationError('SI_A04_FOCUS_INVALID',502,prefix+'reason');
    return {category:clean(f.category,90),priority,reason:clean(f.reason,1400),
      evidenceIds:refs(f.evidenceIds,true)};
  });
  const checklistFocus=data.checklistFocus.map((f,index)=>{
    const prefix='checklistFocus['+index+'].';
    if(!f||typeof f!=='object'||Array.isArray(f))
      throw new SiPreparationError('SI_A04_CHECKLIST_REF_INVALID',502,prefix.slice(0,-1));
    if(!allowedChecks.has(f.existingItemId))
      throw new SiPreparationError('SI_A04_CHECKLIST_REF_INVALID',502,prefix+'existingItemId');
    // 'focus' is a controlled checklist overlay enum, NOT a free-text
    // inspection instruction or a severity assigned by the AI model.
    const focus=typeof f.focus==='string'?f.focus.trim().toUpperCase():'';
    if(!focusTypes.includes(focus))
      throw new SiPreparationError('SI_A04_CHECKLIST_REF_INVALID',502,prefix+'focus');
    return {existingItemId:f.existingItemId,focus,
      reason:clean(f.reason,900),
      reasonEvidenceIds:refs(f.reasonEvidenceIds||[])};
  });
  if(new Set(checklistFocus.map(f=>f.existingItemId)).size!==checklistFocus.length)
    throw new SiPreparationError('SI_A04_DUPLICATE_CHECKLIST_ITEM',502);
  const predicted=(data.predictedDeficiencies||[]).map((f,index)=>{
    const field='predictedDeficiencies['+index+']';
    if(!f||typeof f!=='object'||Array.isArray(f))
      throw new SiPreparationError('SI_A04_PREDICTION_NOT_ADVISORY',502,field);
    if(!clean(f.category,90))
      throw new SiPreparationError('SI_A04_PREDICTION_NOT_ADVISORY',502,field+'.category');
    if(f.hypothesisOnly!==true)
      throw new SiPreparationError('SI_A04_PREDICTION_NOT_ADVISORY',502,field+'.hypothesisOnly');
    return {category:clean(f.category,90),hypothesisOnly:true,evidenceIds:refs(f.evidenceIds,true)};
  });
  const additional=(data.suggestedAdditionalItems||[]).map(i=>{
    if(!i||!clean(i.reason,900)||!clean(i.title||i.label,140))
      throw new SiPreparationError('SI_A04_ADDITIONAL_ITEM_INVALID',502);
    return {title:clean(i.title||i.label,140),reason:clean(i.reason,900),
      evidenceIds:refs(i.evidenceIds||[]),recommendationOnly:true};
  });
  const confidence=Number(data.agentConfidence);
  if(!Number.isFinite(confidence)||confidence<0||confidence>1)
    throw new SiPreparationError('SI_A04_CONFIDENCE_INVALID',502);
  return {externalDossierId:name(data.dossierId)||null,focusAreas,checklistFocus,
    predictedDeficiencies:predicted,suggestedAdditionalItems:additional,
    missingEvidence:Array.isArray(data.missingEvidence)?
      data.missingEvidence.filter(x=>typeof x==='string').slice(0,25).map(x=>clean(x,160)):[],
    agentConfidence:confidence,requiresInspectorReview:true,
    agentRunId:name(data.agentRunId)||null,
    source:'AIRIA_A04_UNVERIFIED_ADVISORY',status:'DRAFT_REVIEW'};
}
function atomicWrite(path,doc){
  mkdirSync(dirname(path),{recursive:true});const tmp=path+'.tmp-'+process.pid;
  writeFileSync(tmp,JSON.stringify(doc,null,2),{mode:0o600});renameSync(tmp,path);
}
export class SiInspectionPreparation{
  constructor({mode='json',oracleRepository=null,targeting,riskPolicy,bundles=[],
    executeA04=null,enabled=false,approvedDocuments=null,provider='airia',
    file=process.env.SI_PREPARATION_STORE_PATH||'/data/si-preparations.json'}={}){
    this.mode=mode;this.oracle=oracleRepository;this.targeting=targeting;
    this.riskPolicy=riskPolicy;this.executeA04=executeA04;this.enabled=enabled;this.provider=provider;
    this.approvedDocuments=approvedDocuments;
    this.bundles=new Map(bundles.map(b=>[b.imo,b]));this.file=file;
    this.ready=mode==='json';this.active=new Set();
  }
  async db(fn){
    if(!this.oracle?.pool)throw new SiPreparationError('SI_DB_NOT_READY',503);
    const con=await this.oracle.pool.getConnection();
    try{return await fn(con);}finally{await con.close();}
  }
  async initialize(){
    if(this.mode==='json'){
      if(existsSync(this.file))this.jsonLoad();
      this.ready=true;return;
    }
    try{await this.db(async con=>{
      const r=await con.execute(
        "SELECT TABLE_NAME FROM USER_TABLES WHERE TABLE_NAME IN ('SI_PREPARATION_DOSSIER','SI_PREPARATION_AUDIT')",
        [],{outFormat:oracledb.OUT_FORMAT_OBJECT});
      if(r.rows.length!==2)throw new SiPreparationError('SI_MIGRATION_010_REQUIRED',503);
    });this.ready=true;}
    catch(e){this.ready=false;throw e;}
  }
  assertReady(){if(!this.ready)throw new SiPreparationError('SI_MIGRATION_010_REQUIRED',503);}
  jsonLoad(){
    if(!existsSync(this.file))return {documents:{},audit:[]};
    const r=JSON.parse(readFileSync(this.file,'utf8'));
    if(!r||typeof r.documents!=='object'||!Array.isArray(r.audit))
      throw new SiPreparationError('SI_PREPARATION_STORE_INVALID',503);
    return r;
  }
  async record(id){
    this.assertReady();
    if(this.mode==='json')return clone(this.jsonLoad().documents[id]||null);
    return this.db(async con=>{
      const r=await con.execute('SELECT DOC_JSON FROM SI_PREPARATION_DOSSIER WHERE CASE_ID=:id',
        {id},{outFormat:oracledb.OUT_FORMAT_OBJECT});
      return r.rows.length?JSON.parse(r.rows[0].DOC_JSON):null;
    });
  }
  async persist(id,previous,next,action,actor,reason=''){
    this.assertReady();
    if(this.mode==='json'){
      const state=this.jsonLoad(),cur=state.documents[id]||null;
      if((cur?.version||0)!==(previous?.version||0))
        throw new SiPreparationError('SI_PREPARATION_VERSION_CONFLICT',409);
      state.documents[id]=next;
      state.audit.push({id:randomUUID(),caseId:id,at:now(),action,actor,reason,
        version:next.version});
      atomicWrite(this.file,state);return next;
    }
    return this.db(async con=>{
      try{
        if(previous){
          const result=await con.execute(`UPDATE SI_PREPARATION_DOSSIER
            SET VERSION_NO=:b_new_version,DOC_JSON=:b_doc_json,
            UPDATED_AT=SYSTIMESTAMP
            WHERE CASE_ID=:b_case_id AND VERSION_NO=:b_expected_version`,{
            b_case_id:id,b_new_version:next.version,b_doc_json:clob(next),
            b_expected_version:previous.version});
          if(result.rowsAffected!==1)
            throw new SiPreparationError('SI_PREPARATION_VERSION_CONFLICT',409);
        }else{
          await con.execute(`INSERT INTO SI_PREPARATION_DOSSIER
            (CASE_ID,VERSION_NO,DOC_JSON)
            VALUES (:b_case_id,:b_version_no,:b_doc_json)`,{
            b_case_id:id,b_version_no:next.version,b_doc_json:clob(next)});
        }
        await con.execute(`INSERT INTO SI_PREPARATION_AUDIT
          (AUDIT_ID,CASE_ID,VERSION_NO,ACTION_NAME,ACTOR,REASON)
          VALUES (:b_audit_id,:b_case_id,:b_version_no,:b_action_name,
            :b_actor,:b_reason)`,{
          b_audit_id:randomUUID(),b_case_id:id,b_version_no:next.version,
          b_action_name:action,b_actor:actor,b_reason:clean(reason,500)});
        await con.commit();return next;
      }catch(e){
        await con.rollback();
        if(e.code==='ORA-00001')throw new SiPreparationError('SI_PREPARATION_VERSION_CONFLICT',409);
        throw e;
      }
    });
  }
  /**
   * SI-02 case register uses the immutable approved SI case ledger, NOT the
   * volatile candidate dashboard (resolved referrals can vanish from it).
   * Read-only: never invokes Airia, changes NMC risk or creates cases.
   *
   * A missing migration 010 must still show approved cases with an explicit
   * preparationUnavailable warning instead of a misleading empty register.
   * This list does not depend on the separate lifecycle migration 013.
   */
  async list(){
    const registry=await this.targeting.inspectionCaseRegistry();
    const approved=registry.cases.filter(c=>c.status==='CREATED');
    const documents=this.ready?await this.listSavedStatuses():new Map();
    const cases=approved.map(c=>{
      const vessel=this.bundles.get(c.imo)?.inlineContext?.vessel||{};
      const stored=documents.get(c.id)||null;
      return {
        id:c.id,imo:c.imo,regime:c.regime,
        vesselName:vessel.name||vessel.vesselName||('IMO '+c.imo),
        flag:vessel.flag||null,
        approvedBy:c.approvedBy||null,
        approvedAt:c.createdAt||null,
        riskAtApproval:c.riskAtApproval||null,
        preparationStatus:stored?.status||'NOT_PREPARED',
        preparationVersion:stored?.version||0,
        preparedAt:stored?.preparedAt||null,
        dossierSource:stored?.dossier?.source||null
      };
    }).sort((a,b)=>String(b.approvedAt||'').localeCompare(String(a.approvedAt||'')));
    return {status:'ok',count:cases.length,cases,
      preparationAvailable:this.ready,
      warning:this.ready?null:'SI_MIGRATION_010_REQUIRED'};
  }
  async listSavedStatuses(){
    this.assertReady();
    if(this.mode==='json'){
      const documents=this.jsonLoad().documents||{};
      return new Map(Object.entries(documents));
    }
    return this.db(async con=>{
      const rows=await con.execute('SELECT CASE_ID,DOC_JSON FROM SI_PREPARATION_DOSSIER',[],
        {outFormat:oracledb.OUT_FORMAT_OBJECT});
      return new Map(rows.rows.map(r=>[r.CASE_ID,JSON.parse(r.DOC_JSON)]));
    });
  }
  async currentContext(id){
    if(!validId(id))throw new SiPreparationError('SI_CASE_ID_INVALID',422);
    const inspectionCase=await this.targeting.inspectionCase(id);
    if(!inspectionCase||inspectionCase.status!=='CREATED')
      throw new SiPreparationError('SI_APPROVED_CASE_REQUIRED',404);
    const bundle=this.bundles.get(inspectionCase.imo);
    if(!bundle||!Array.isArray(bundle.evidenceIds))
      throw new SiPreparationError('SI_VESSEL_BUNDLE_MISSING',503);
    if(!this.riskPolicy.ready)throw new SiPreparationError('SI_RISK_POLICY_NOT_READY',503);
    const risk=await this.riskPolicy.vessel(inspectionCase.imo);
    const v=bundle.inlineContext?.vessel||{};
    const approved=this.approvedDocuments?await this.approvedDocuments(inspectionCase.imo):[];
    const docIds=approved.map(x=>x.evidenceId);
    const context={
      inspectionId:inspectionCase.id,caseId:inspectionCase.nmcCaseId||inspectionCase.id,
      nmcReferralId:inspectionCase.nmcReferralId||null,
      siCaseId:inspectionCase.id,imo:inspectionCase.imo,
      vessel:{imo:inspectionCase.imo,name:clean(v.name,140),flag:clean(v.flag,80),
        vesselType:clean(v.vesselType,80)},
      targetRegime:inspectionCase.regime,
      targetRegimes:inspectionCase.regimes||[inspectionCase.regime],
      inspectionReasons:inspectionCase.inspectionReasons||[],
      inspectionScopes:inspectionCase.inspectionScopes||[],
      sourceInspectionObjectives:(inspectionCase.inspectionReasons||[]).map(reason=>({
        objectiveId:'SI-SRC-'+reason.eventKey,
        sourceType:reason.sourceType,
        sourceReference:reason.sourceReference,
        inspectionRegime:reason.inspectionRegime,
        inspectionReason:reason.reason||null,
        evidenceIds:reason.evidenceIds||[],
        status:'TO_BE_VERIFIED_BY_INSPECTOR',
        advisory:false,
        legallyConfirmed:false
      })),
      approvedPlanId:inspectionCase.approvedPlanId||null,
      baseChecklistItemIds:[...SI_BASE_CHECKLIST],
      bundleRef:'VBL-'+inspectionCase.imo,
      risk:risk?{evaluationId:risk.sourceAssessmentId,score:risk.riskScore,
        level:risk.riskLevel,policyRevision:risk.policyRevision,
        rulesetVersion:risk.policyVersion}:null,
      sourceAssessmentId:risk?.sourceAssessmentId||null,
      evidenceManifestRefs:[...new Set([
        ...bundle.evidenceIds,...docIds,
        ...(inspectionCase.inspectionReasons||[]).flatMap(r=>r.evidenceIds||[])
      ])].slice(0,150),
      openFindingRefs:(bundle.inlineContext?.deficiencies||[])
        .filter(f=>f.status==='Open').map(f=>f.id)
        .filter(e=>bundle.evidenceIds.includes(e)).slice(0,35),
      evidenceContext:{tracking:bundle.inlineContext?.tracking||null,
        certificates:bundle.inlineContext?.certificates||[],
        inspectionHistory:bundle.inlineContext?.inspections||[],
        openDeficiencies:(bundle.inlineContext?.deficiencies||[]).filter(f=>f.status==='Open'),
        documentManifest:{source:'GOOGLE_DRIVE_A03_HUMAN_REVIEWED',
          records:approved,authenticityVerified:false,
          requiresInspectorReview:true}},
      provenance:'SYNTHETIC_POC_NOT_OFFICIAL_SOURCE',
      externalDocumentsVerified:false,
      a03ReviewedDocumentCount:approved.length,
      createdCaseApprovedBy:inspectionCase.approvedBy,
      targetingPolicyVersion:inspectionCase.rulesetVersion
    };
    return {inspectionCase,context,sourceHash:sha(context)};
  }
  async get(id){
    const [{inspectionCase,context,sourceHash},saved]=await Promise.all([
      this.currentContext(id),this.record(id)]);
    return {status:'ok',inspectionCase,context,sourceHash,
      saved,stale:Boolean(saved&&saved.sourceHash!==sourceHash),
      canGenerate:Boolean(context.risk)&&this.enabled&&this.ready,
      a04Enabled:this.enabled,a04Provider:this.provider.toUpperCase(),requiresHumanApproval:true,
      message:context.risk?'A04 is optional, gated and called only on explicit request.':
        'No stored current NMC risk; preparation is review-only. Do not invent a score.'};
  }
  async prepare(id,{actor,expectedVersion=0}={}){
    if(!name(actor))throw new SiPreparationError('SI_PREPARER_REQUIRED',422);
    const {context,sourceHash}=await this.currentContext(id),prior=await this.record(id);
    if(prior){
      if(prior.status==='APPROVED')throw new SiPreparationError('SI_PREPARATION_ALREADY_APPROVED',409);
      if(prior.status==='GENERATING')throw new SiPreparationError('SI_A04_ALREADY_RUNNING',409);
      if(prior.version!==expectedVersion)throw new SiPreparationError('SI_PREPARATION_VERSION_CONFLICT',409);
    }else if(expectedVersion!==0)throw new SiPreparationError('SI_PREPARATION_VERSION_CONFLICT',409);
    const next={caseId:id,version:(prior?.version||0)+1,status:'PREPARED',
      sourceHash,context,preparedAt:now(),preparedBy:actor.trim(),dossier:null,
      lastFailure:null,review:null,
      supersedes:prior?.version||null};
    await this.persist(id,prior,next,'PREPARED',actor,
      prior?'Explicit refresh of outdated preparation':'Create approved-case preparation');
    return {status:'ok',saved:next};
  }
  async generate(id,{actor,expectedVersion,confirmCost,language='en'}={}){
    if(!name(actor)||confirmCost!==true)
      throw new SiPreparationError('SI_A04_EXPLICIT_CONFIRMATION_REQUIRED',422);
    if(!this.enabled||typeof this.executeA04!=='function')
      throw new SiPreparationError('SI_A04_NOT_ENABLED',503);
    if(!['en','ar'].includes(language))throw new SiPreparationError('SI_LANGUAGE_INVALID',422);
    if(this.active.has(id))throw new SiPreparationError('SI_A04_ALREADY_RUNNING',409);
    this.active.add(id);
    try{
      const {sourceHash,context}=await this.currentContext(id);
      const prior=await this.record(id);
      if(!prior||prior.status==='APPROVED'||!['PREPARED','FAILED','REJECTED'].includes(prior.status))
        throw new SiPreparationError('SI_PREPARE_FIRST_OR_ALREADY_APPROVED',409);
      if(prior.version!==expectedVersion||prior.sourceHash!==sourceHash)
        throw new SiPreparationError('SI_PREPARATION_STALE_REFRESH_REQUIRED',409);
      if(!context.risk?.evaluationId)
        throw new SiPreparationError('SI_SAVED_CURRENT_RISK_REQUIRED',409);
      if(!context.evidenceManifestRefs.length)
        throw new SiPreparationError('SI_EVIDENCE_MANIFEST_REQUIRED',409);
      // A04 is an explicitly initiated, billable request. Lock in the DB first,
      // so refreshes and duplicate clicks cannot run it again.
      const correlationId='SI-A04-'+randomUUID();
      const generating={...prior,version:prior.version+1,status:'GENERATING',
        requestedBy:actor.trim(),requestedAt:now(),correlationId,lastFailure:null};
      await this.persist(id,prior,generating,'A04_REQUESTED',actor);
      const input={requestMeta:{correlationId,language,schemaVersion:'2.0',requestedAt:now()},
        inspectionId:context.inspectionId,caseId:context.caseId,
        subject:{type:'VESSEL',imo:context.imo,name:context.vessel.name},
        bundleRef:context.bundleRef,targetRegime:context.targetRegime,
        officialRisk:{evaluationId:context.risk.evaluationId,
          score:context.risk.score,level:context.risk.level,
          rulesetVersion:context.risk.rulesetVersion},
        baseChecklistItemIds:context.baseChecklistItemIds,
        openFindingRefs:context.openFindingRefs,
        evidenceManifestRefs:context.evidenceManifestRefs,
        checklistVersion:'SI-POC-BASE-1.0',
        inlineContext:{...context.evidenceContext,
          allInspectionReasons:context.inspectionReasons,
          allInspectionScopes:context.inspectionScopes,
          sourceInspectionObjectives:context.sourceInspectionObjectives},
        inspectionRegimes:context.targetRegimes,
        provenance:context.provenance,
        officialScoringRequested:false,requestedOutputs:['FOCUS_OVERLAY','MISSING_EVIDENCE'],
        // Airia v3.1 transport already stringifies this whole input as userInput.
        // Instructions travel with each explicit POC A04 request, no agent
        // configuration update, schema-version bump, or extra API call.
        outputGuidance:a04PocOutputGuidance({
          baseChecklistItemIds:context.baseChecklistItemIds,
          evidenceManifestRefs:context.evidenceManifestRefs
        })};
      try{
        const raw=await this.executeA04(input);
        const cleanResult=validateA04(raw,{checkIds:context.baseChecklistItemIds,
          evidenceIds:context.evidenceManifestRefs});
        const dossier={...cleanResult,
          source:this.provider==='mock'?'MOCK_SI_A04_TEST_ADVISORY':cleanResult.source,
          mock:this.provider==='mock',externalCalls:this.provider==='mock'?0:1,
          generatedAt:now(),requestCorrelationId:correlationId,
          requestHash:sha(input),sourceHash,baseChecklistVersion:'SI-POC-BASE-1.0'};
        const current=await this.record(id);
        if(current?.version!==generating.version||current?.correlationId!==correlationId)
          throw new SiPreparationError('SI_A04_CONCURRENT_MODIFICATION',409);
        const next={...current,version:current.version+1,status:'DRAFT_REVIEW',dossier};
        await this.persist(id,current,next,'A04_DRAFT_SAVED',actor);
        return {status:'ok',saved:next};
      }catch(e){
        const current=await this.record(id);
        if(current?.version===generating.version&&current?.correlationId===correlationId){
          const failure=e instanceof SiPreparationError?e.code:'SI_A04_PROVIDER_UNAVAILABLE';
          const field=e instanceof SiPreparationError?e.field:null;
          if(failure==='SI_A04_FOCUS_INVALID'||
             failure==='SI_A04_CHECKLIST_REF_INVALID'||
             failure==='SI_A04_PREDICTION_NOT_ADVISORY'){
            // Do not print Airia output, personal data, source evidence,
            // prompt bodies or API credentials to logs.
            console.error('[si-a04] RESPONSE_SCHEMA_VALIDATION_FAILED '+JSON.stringify({
              correlationId,caseId:id,code:failure,
              field:field||'unknown',provider:this.provider
            }));
          }
          await this.persist(id,current,{...current,version:current.version+1,
            status:'FAILED',lastFailure:failure,
            lastFailureField:field||null,dossier:null},'A04_FAILED',actor,failure);
        }
        if(e instanceof SiPreparationError)throw e;
        throw new SiPreparationError('SI_A04_PROVIDER_UNAVAILABLE',502);
      }
    }finally{this.active.delete(id);}
  }
  async review(id,{actor,decision,reason,expectedVersion}={}){
    if(!name(actor)||!['APPROVE','REJECT'].includes(decision)||
      !name(reason)||reason.trim().length<8)
      throw new SiPreparationError('SI_REVIEW_FIELDS_REQUIRED',422);
    const current=await this.record(id);
    if(!current||current.status!=='DRAFT_REVIEW'||!current.dossier)
      throw new SiPreparationError('SI_REVIEW_REQUIRES_DRAFT',409);
    if(current.version!==expectedVersion)
      throw new SiPreparationError('SI_PREPARATION_VERSION_CONFLICT',409);
    const {sourceHash}=await this.currentContext(id);
    if(current.sourceHash!==sourceHash)
      throw new SiPreparationError('SI_PREPARATION_STALE_REFRESH_REQUIRED',409);
    const next={...current,version:current.version+1,
      status:decision==='APPROVE'?'APPROVED':'REJECTED',
      review:{decision,actor:actor.trim(),reason:reason.trim(),at:now(),
        aiOverlayOnly:true,baseChecklistImmutable:true}};
    await this.persist(id,current,next,'A04_'+decision,actor,reason);
    return {status:'ok',saved:next};
  }
}
