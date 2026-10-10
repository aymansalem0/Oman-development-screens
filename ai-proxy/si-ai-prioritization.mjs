/**
 * SI-P01 — On-demand maritime inspection prioritization, not NMC risk.
 * Published rules determine strict priority tiers. Airia may rank candidates
 * WITHIN a tier and explain known source evidence; it cannot override hard rules,
 * modify eligibility, invent inspection findings, or create/approve cases.
 * No AI is called by GET, policy preview, importing Excel or publishing settings.
 */
import {createHash,randomUUID} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync,renameSync} from 'node:fs';
import {dirname} from 'node:path';
import oracledb from 'oracledb';
import {getSiPrioritySettings} from './si-candidate-targeting.mjs';

const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const clone=x=>JSON.parse(JSON.stringify(x));
const now=()=>new Date().toISOString();
const clob=x=>({type:oracledb.DB_TYPE_CLOB,val:JSON.stringify(x)});
const safe=x=>typeof x==='string'?x.trim():'';
const openStatus=new Set(['PENDING_REVIEW']);
export class SiPriorityError extends Error{
  constructor(code,status=400){super(code);this.code=code;this.status=status;}
}
function agentBody(raw){
  let cur=raw;
  for(let i=0;i<7;i++){
    if(typeof cur==='string'){try{cur=JSON.parse(cur);}catch{break;}continue;}
    if(!cur||typeof cur!=='object'||Array.isArray(cur))break;
    if(Array.isArray(cur.recommendations))return cur;
    const key=['result','response','output','data','finalOutput','outputText','content','value']
      .find(x=>cur[x]!==undefined);
    if(!key)break;cur=cur[key];
  }
  return cur;
}
const onlyText=(a,max=150)=>typeof a==='string'&&a.trim().length>0&&a.length<=max;
export function validateP01(raw,items){
  const data=agentBody(raw);
  if(!data||!Array.isArray(data.recommendations)||
    data.recommendations.length!==items.length)
    throw new SiPriorityError('SI_P01_RESPONSE_INVALID',502);
  const byKey=new Map(items.map(x=>[x.candidateKey,x]));
  const keys=new Set(),ranks=new Set();
  const validated=data.recommendations.map(r=>{
    const item=byKey.get(r?.candidateKey);
    if(!item||keys.has(r.candidateKey)||!Number.isInteger(r.suggestedRank)||
      r.suggestedRank<1||r.suggestedRank>items.length||ranks.has(r.suggestedRank)||
      !onlyText(r.rationale,1200)||r.rationale.length<10||
      !Array.isArray(r.evidenceRefs)||!r.evidenceRefs.length||r.evidenceRefs.length>20||
      r.evidenceRefs.some(id=>typeof id!=='string'||!item.allowedEvidence.includes(id))||
      !Array.isArray(r.dataGaps)||r.dataGaps.length>12||
      r.dataGaps.some(x=>!onlyText(x,160))||
      !Number.isFinite(r.confidence)||r.confidence<0||r.confidence>1)
      throw new SiPriorityError('SI_P01_UNVERIFIED_RECOMMENDATION',502);
    keys.add(r.candidateKey);ranks.add(r.suggestedRank);
    return {candidateKey:r.candidateKey,suggestedRank:r.suggestedRank,
      rationale:r.rationale.trim(),evidenceRefs:[...new Set(r.evidenceRefs)],
      dataGaps:r.dataGaps.map(x=>x.trim()),confidence:r.confidence,
      status:'ADVISORY_HUMAN_REVIEW'};
  });
  return validated;
}
function factorSignals(candidate,clock,priorityPolicy){
  const risk=candidate.currentRisk?.score??null;
  const sources=new Set(candidate.events.map(e=>e.sourceType));
  // Illustrative operational urgency scales, not official maritime law.
  const trigger=Math.max(...[...sources].map(
    x=>priorityPolicy.sourceTriggerScores[x]).filter(Number.isFinite));
  const eta=candidate.events.map(e=>e.eta)
    .filter(x=>typeof x==='string'&&x.length>=16)
    .map(x=>Date.parse(x.length===16?x+':00+04:00':x)).filter(Number.isFinite).sort((a,b)=>a-b)[0];
  const hours=eta===undefined?null:(eta-clock)/3600000;
  const deadline=hours===null?null:hours<0?90:hours<=24?85:hours<=72?65:30;
  return {risk,trigger,history:null,deadline,urgency:null};
}
function scoreCandidate(candidate,config,clock){
  const policy=getSiPrioritySettings(config),signals=factorSignals(candidate,clock,policy);
  const factors=Object.entries(policy.weights).map(([key,weight])=>({
    key,weight,signal:signals[key]??null,
    contribution:signals[key]===null?null:
      Math.round(weight*signals[key]*100/100)/100
  }));
  const known=factors.filter(x=>x.signal!==null),availableWeight=known.reduce((n,x)=>n+x.weight,0);
  // Scored on KNOWN evidence only; never fill absent NMC risk with zero.
  const provisionalScore=availableWeight>0?
    Math.round(known.reduce((n,x)=>n+x.signal*x.weight,0)/availableWeight):null;
  const evidenceRefs=[...new Set([
    ...candidate.events.flatMap(e=>[e.eventKey,e.sourceEventId,e.sourceReference,
      ...(e.evidenceIds||[])]),
    ...(candidate.currentRisk?.assessmentId?[candidate.currentRisk.assessmentId]:[])
  ])];
  const missingData=factors.filter(x=>x.signal===null).map(x=>'MISSING_'+x.key.toUpperCase());
  const protectedTier=candidate.eligibility==='MANDATORY'?0:
    candidate.currentRisk?.score>=config.riskPriorityThreshold?1:
    candidate.currentRisk?2:3;
  return {
    candidateKey:candidate.key,imo:candidate.imo,vesselName:candidate.vesselName,
    inspectionRegime:candidate.regime,eligibility:candidate.eligibility,
    sourceEvents:candidate.events.map(e=>({
      sourceType:e.sourceType,eventKey:e.eventKey,reference:e.sourceReference,
      origin:e.provenance,port:e.port||null,eta:e.eta||null,
      evidenceIds:e.evidenceIds||[]
    })),
    risk:candidate.currentRisk?{...candidate.currentRisk}:null,
    rulePriority:candidate.priority,protectedTier,provisionalScore,availableWeight,
    factors,missingData,allowedEvidence:evidenceRefs
  };
}
export function buildSiPrioritySnapshot(dashboard,clock=Date.now()){
  const policy=getSiPrioritySettings(dashboard.policy.config);
  const items=dashboard.candidates.filter(c=>openStatus.has(c.status))
    .map(c=>scoreCandidate(c,dashboard.policy.config,clock));
  const ordered=[...items].sort((a,b)=>a.protectedTier-b.protectedTier||
    (b.provisionalScore??-1)-(a.provisionalScore??-1)||
    a.candidateKey.localeCompare(b.candidateKey));
  ordered.forEach((item,index)=>item.ruleRank=index+1);
  const byKey=new Map(ordered.map(x=>[x.candidateKey,x]));
  // Fingerprint deliberately excludes timestamp/ETA countdown and evaluatedAt:
  // stale when sources, approvals, settings or official risk change.
  const fingerprint=sha({
    policyVersion:dashboard.policy.version,policy,
    riskPolicyRevision:dashboard.riskPolicyRevision,fleetSnapshotId:dashboard.fleetSnapshotId,
    candidates:dashboard.candidates.map(c=>({
      key:c.key,status:c.status,eligibility:c.eligibility,priority:c.priority,
      regime:c.regime,currentRisk:c.currentRisk,
      events:c.events.map(e=>({eventKey:e.eventKey,sourceType:e.sourceType,
        sourceReference:e.sourceReference,eta:e.eta,port:e.port,
        importBatchId:e.importBatchId}))
    })).sort((a,b)=>a.key.localeCompare(b.key))
  });
  return {snapshotHash:fingerprint,policyVersion:dashboard.policy.version,
    riskPolicyRevision:dashboard.riskPolicyRevision,
    fleetSnapshotId:dashboard.fleetSnapshotId,policy,eligibleCount:ordered.length,
    items:ordered,byKey};
}
export class SiAiPrioritization{
  constructor({targeting,mode='json',oracleRepository=null,executeAgent=null,enabled=false,
    clock=()=>Date.now(),file=process.env.SI_P01_STORE_PATH||'/data/si-ai-priority.json'}={}){
    if(!targeting||!['oracle','json'].includes(mode))throw Error('SI_P01_CONFIG_INVALID');
    this.targeting=targeting;this.mode=mode;this.oracle=oracleRepository;
    this.executeAgent=executeAgent;this.enabled=enabled;this.clock=clock;
    this.file=file;this.ready=mode==='json';this.inProgress=false;
  }
  async connection(cb){
    if(!this.oracle?.pool)throw new SiPriorityError('SI_P01_ORACLE_UNAVAILABLE',503);
    const con=await this.oracle.pool.getConnection();
    try{return await cb(con);}finally{await con.close();}
  }
  async initialize(){
    if(this.mode==='json'){
      if(existsSync(this.file))this.readJson();this.ready=true;return;
    }
    try{
      await this.connection(async con=>{
        const result=await con.execute(
          "SELECT TABLE_NAME FROM USER_TABLES WHERE TABLE_NAME='SI_AI_PRIORITY_RUN'",
          [],{outFormat:oracledb.OUT_FORMAT_OBJECT});
        if(result.rows.length!==1)throw new SiPriorityError('SI_MIGRATION_011_REQUIRED',503);
      });
      this.ready=true;
    }catch(e){this.ready=false;throw e;}
  }
  assertReady(){if(!this.ready)throw new SiPriorityError('SI_MIGRATION_011_REQUIRED',503);}
  readJson(){const s=existsSync(this.file)?JSON.parse(readFileSync(this.file,'utf8')):{runs:[]};
    if(!Array.isArray(s.runs))throw new SiPriorityError('SI_P01_STORE_INVALID',503);
    return s;
  }
  async save(run){
    this.assertReady();
    if(this.mode==='json'){
      const state=this.readJson();
      state.runs.push(run);
      mkdirSync(dirname(this.file),{recursive:true});
      const tmp=this.file+'.tmp-'+process.pid;
      writeFileSync(tmp,JSON.stringify(state,null,2),{mode:0o600});
      renameSync(tmp,this.file);
      return;
    }
    await this.connection(async con=>{
      try{
        await con.execute(`INSERT INTO SI_AI_PRIORITY_RUN
          (RUN_ID,POLICY_VERSION,RISK_POLICY_REVISION,SNAPSHOT_HASH,RUN_STATUS,DOC_JSON)
          VALUES (:id,:policy,:risk,:hash,:status,:doc)`,{
          id:run.id,policy:run.policyVersion,risk:run.riskPolicyRevision,
          hash:run.snapshotHash,status:run.status,doc:clob(run)});
        await con.commit();
      }catch(e){await con.rollback();throw e;}
    });
  }
  async history(limit=12){
    this.assertReady();
    if(this.mode==='json')return this.readJson().runs.slice(-limit).reverse();
    return this.connection(async con=>{
      const r=await con.execute(`SELECT DOC_JSON FROM SI_AI_PRIORITY_RUN
        ORDER BY CREATED_AT DESC FETCH FIRST :limit ROWS ONLY`,
        {limit:Math.min(50,limit)},{outFormat:oracledb.OUT_FORMAT_OBJECT});
      return r.rows.map(row=>JSON.parse(row.DOC_JSON));
    });
  }
  async preview(){
    this.assertReady();
    const snapshot=buildSiPrioritySnapshot(await this.targeting.dashboard(),this.clock());
    return {status:'RULE_PREVIEW_ONLY_NO_AI',enabled:this.enabled,
      snapshotHash:snapshot.snapshotHash,policyVersion:snapshot.policyVersion,
      riskPolicyRevision:snapshot.riskPolicyRevision,eligibleCount:snapshot.eligibleCount,
      policy:snapshot.policy,items:snapshot.items};
  }
  async status(){
    const preview=await this.preview();
    const records=await this.history(1),latest=records[0]||null;
    return {status:'ok',enabled:this.enabled,preview:{
      snapshotHash:preview.snapshotHash,policyVersion:preview.policyVersion,
      riskPolicyRevision:preview.riskPolicyRevision,eligibleCount:preview.eligibleCount},
      latest:latest?{
        ...latest,isStale:latest.snapshotHash!==preview.snapshotHash
      }:null};
  }
  async run(request){
    this.assertReady();
    if(!this.enabled||typeof this.executeAgent!=='function')
      throw new SiPriorityError('SI_P01_NOT_ENABLED',503);
    if(this.inProgress)throw new SiPriorityError('SI_P01_ALREADY_RUNNING',409);
    if(request?.confirmCost!==true||!onlyText(request?.actor,120)||
      !/^[0-9a-f]{64}$/i.test(request?.expectedSnapshotHash||''))
      throw new SiPriorityError('SI_P01_EXPLICIT_CONFIRMATION_REQUIRED',422);
    this.inProgress=true;
    try{
      const snapshot=buildSiPrioritySnapshot(await this.targeting.dashboard(),this.clock());
      if(snapshot.snapshotHash!==request.expectedSnapshotHash)
        throw new SiPriorityError('SI_P01_SOURCE_CHANGED_REPREVIEW',409);
      if(!snapshot.items.length)throw new SiPriorityError('SI_P01_NO_PENDING_CANDIDATES',422);
      if(snapshot.items.length>100)
        throw new SiPriorityError('SI_P01_BATCH_LIMIT_100_REQUIRES_SCOPING',422);
      const base={id:randomUUID(),actor:request.actor.trim(),
        startedAt:now(),policyVersion:snapshot.policyVersion,
        riskPolicyRevision:snapshot.riskPolicyRevision,
        fleetSnapshotId:snapshot.fleetSnapshotId,
        snapshotHash:snapshot.snapshotHash,
        rules:snapshot.policy,requestedCandidates:snapshot.items.length,
        source:'AIRIA_SI_P01_UNVERIFIED_ADVISORY',
        approvedNmcFirst:true,humanDecisionRequired:true};
      let run;
      try{
        // Exactly ONE explicitly authorized chargeable Airia request. No call
        // is made by data refresh, settings publication or Excel import.
        const response=await this.executeAgent({
          schemaVersion:'SI-P01-v1',
          instructions:'Provide evidence-grounded advisory ranks, not NMC risk or legal eligibility. Return JSON with recommendations[]: {candidateKey,suggestedRank,rationale,evidenceRefs,dataGaps,confidence}. Every candidate exactly once.',
          policy:{version:snapshot.policyVersion,...snapshot.policy},
          riskPolicyRevision:snapshot.riskPolicyRevision,
          snapshotHash:snapshot.snapshotHash,
          candidates:snapshot.items.map(({candidateKey,imo,vesselName,inspectionRegime,eligibility,
            sourceEvents,risk,rulePriority,protectedTier,provisionalScore,availableWeight,
            factors,missingData,allowedEvidence,ruleRank})=>({
              candidateKey,imo,vesselName,inspectionRegime,eligibility,sourceEvents,risk,
              rulePriority,protectedTier,provisionalScore,availableWeight,
              factors,missingData,allowedEvidence,ruleRank
            }))
        });
        const recommendations=validateP01(response,snapshot.items);
        const byKey=new Map(recommendations.map(x=>[x.candidateKey,x]));
        // Effective order is hard-rule tier first, AI within each tier only.
        const order=[...snapshot.items].sort((a,b)=>
          a.protectedTier-b.protectedTier||
          byKey.get(a.candidateKey).suggestedRank-byKey.get(b.candidateKey).suggestedRank||
          a.candidateKey.localeCompare(b.candidateKey));
        const outputs=order.map((item,i)=>({
          ...byKey.get(item.candidateKey),imo:item.imo,vesselName:item.vesselName,
          regime:item.inspectionRegime,ruleRank:item.ruleRank,
          rulePriority:item.rulePriority,protectedTier:item.protectedTier,
          provisionalScore:item.provisionalScore,availableWeight:item.availableWeight,
          missingRuleData:item.missingData,officialRisk:item.risk,
          effectiveRank:i+1,
          tierEnforced:item.ruleRank!==i+1&&
            item.protectedTier!==snapshot.items[i]?.protectedTier
        }));
        run={...base,status:'SUCCEEDED',completedAt:now(),
          recommendations:outputs};
      }catch(e){
        const code=e instanceof SiPriorityError?e.code:'SI_P01_PROVIDER_UNAVAILABLE';
        run={...base,status:'FAILED',completedAt:now(),errorCode:code,
          recommendations:[]};
      }
      await this.save(run);
      if(run.status==='FAILED')throw new SiPriorityError(run.errorCode,502);
      return run;
    }finally{this.inProgress=false;}
  }
}
