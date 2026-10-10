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
  constructor(code,status=400){super(code);this.code=code;this.status=status;}
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
  const focusAreas=data.focusAreas.map(f=>{
    if(!f||typeof f.category!=='string'||!priorities.includes(f.priority)||
      !clean(f.reason,1400))throw new SiPreparationError('SI_A04_FOCUS_INVALID',502);
    return {category:clean(f.category,90),priority:f.priority,reason:clean(f.reason,1400),
      evidenceIds:refs(f.evidenceIds,true)};
  });
  const checklistFocus=data.checklistFocus.map(f=>{
    if(!f||!allowedChecks.has(f.existingItemId)||
      !focusTypes.includes(f.focus))throw new SiPreparationError('SI_A04_CHECKLIST_REF_INVALID',502);
    return {existingItemId:f.existingItemId,focus:f.focus,
      reason:clean(f.reason,900),
      reasonEvidenceIds:refs(f.reasonEvidenceIds||[])};
  });
  if(new Set(checklistFocus.map(f=>f.existingItemId)).size!==checklistFocus.length)
    throw new SiPreparationError('SI_A04_DUPLICATE_CHECKLIST_ITEM',502);
  const predicted=(data.predictedDeficiencies||[]).map(f=>{
    if(!f||f.hypothesisOnly!==true||!clean(f.category,90))
      throw new SiPreparationError('SI_A04_PREDICTION_NOT_ADVISORY',502);
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
    executeA04=null,enabled=false,approvedDocuments=null,
    file=process.env.SI_PREPARATION_STORE_PATH||'/data/si-preparations.json'}={}){
    this.mode=mode;this.oracle=oracleRepository;this.targeting=targeting;
    this.riskPolicy=riskPolicy;this.executeA04=executeA04;this.enabled=enabled;
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
            SET VERSION_NO=:newVersion,DOC_JSON=:doc,UPDATED_AT=SYSTIMESTAMP
            WHERE CASE_ID=:id AND VERSION_NO=:expected`,{
            id,newVersion:next.version,doc:clob(next),expected:previous.version});
          if(result.rowsAffected!==1)
            throw new SiPreparationError('SI_PREPARATION_VERSION_CONFLICT',409);
        }else{
          await con.execute(`INSERT INTO SI_PREPARATION_DOSSIER
            (CASE_ID,VERSION_NO,DOC_JSON) VALUES (:id,:version,:doc)`,
            {id,version:next.version,doc:clob(next)});
        }
        await con.execute(`INSERT INTO SI_PREPARATION_AUDIT
          (AUDIT_ID,CASE_ID,VERSION_NO,ACTION_NAME,ACTOR,REASON)
          VALUES (:uid,:id,:version,:action,:actor,:reason)`,
          {uid:randomUUID(),id,version:next.version,action,actor,reason:clean(reason,500)});
        await con.commit();return next;
      }catch(e){
        await con.rollback();
        if(e.code==='ORA-00001')throw new SiPreparationError('SI_PREPARATION_VERSION_CONFLICT',409);
        throw e;
      }
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
      targetRegime:inspectionCase.regime,baseChecklistItemIds:[...SI_BASE_CHECKLIST],
      bundleRef:'VBL-'+inspectionCase.imo,
      risk:risk?{evaluationId:risk.sourceAssessmentId,score:risk.riskScore,
        level:risk.riskLevel,policyRevision:risk.policyRevision,
        rulesetVersion:risk.policyVersion}:null,
      sourceAssessmentId:risk?.sourceAssessmentId||null,
      evidenceManifestRefs:[...bundle.evidenceIds,...docIds].slice(0,150),
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
      a04Enabled:this.enabled,requiresHumanApproval:true,
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
        inlineContext:context.evidenceContext,
        provenance:context.provenance,
        officialScoringRequested:false,requestedOutputs:['FOCUS_OVERLAY','MISSING_EVIDENCE']};
      try{
        const raw=await this.executeA04(input);
        const cleanResult=validateA04(raw,{checkIds:context.baseChecklistItemIds,
          evidenceIds:context.evidenceManifestRefs});
        const dossier={...cleanResult,generatedAt:now(),requestCorrelationId:correlationId,
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
          await this.persist(id,current,{...current,version:current.version+1,
            status:'FAILED',lastFailure:failure,dossier:null},'A04_FAILED',actor,failure);
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
