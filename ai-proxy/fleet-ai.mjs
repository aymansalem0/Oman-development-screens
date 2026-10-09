/**
 * NMC Fleet AI assessment - local synthetic POC, NOT a regulatory decision engine.
 * Autonomous scheduler supplies immutable evidence bundles derived at build-time
 * from the SAME TypeScript Vessel 360 synthetic fixture logic used by Angular.
 * External PSC is fetched per IMO on the server and fails closed when Google Sheets is unavailable.
 * Only validated A01/A02 factors are persisted; neither secrets nor unvalidated agent output are stored.
 */
import {mkdirSync, readFileSync, writeFileSync, renameSync, existsSync} from 'node:fs';
import {dirname} from 'node:path';
import {timingSafeEqual} from 'node:crypto';
import {catalogFromNmcSource} from './psc-fixtures.mjs';
import {evaluateDataQuality} from './data-quality.mjs';

const baseTs=readFileSync(new URL('./nmc-vessel-catalog.ts',import.meta.url),'utf8');
const extraTs=readFileSync(new URL('./nmc-expanded-vessel-catalog.ts',import.meta.url),'utf8');
const catalogue=catalogFromNmcSource(baseTs,extraTs);
const VALID_IMOS=new Set(catalogue.map(v=>v.imo));
const FACTORS=['movement','inspection','certificate','dataQuality','history'];
const AGENT_FACTORS={a01:['movement','history'],a02:['inspection','certificate','dataQuality']};
const DEFAULT_WEIGHTS={movement:25,inspection:28,certificate:20,dataQuality:14,history:13};
const DEFAULT_THRESHOLDS={watch:45,high:65,critical:85};
const MAX_INPUTS=420;
const MAX_CONCURRENCY=1; // One vessel = A01 + A02 concurrently; <=2 Airia requests in flight.
const REASON_RE=/^[A-Z][A-Z0-9_]{1,95}$/;
const file=process.env.NMC_FLEET_STORE_PATH || '/data/fleet-assessments.json';

const serializeError=err=>{
  const msg=String(err?.message||'');
  return REASON_RE.test(msg)?msg:'FLEET_ASSESSMENT_FAILED';
};
const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
const unpack=(input,depth=0)=>{
  if(depth>8||input==null)return null;
  if(typeof input==='string'){try{return unpack(JSON.parse(input.trim()),depth+1);}catch{return null;}}
  if(Array.isArray(input)){for(const item of input){const r=unpack(item,depth+1);if(r)return r;}return null;}
  if(typeof input!=='object')return null;
  if(Array.isArray(input.signals))return input;
  for(const key of ['result','response','output','data','finalOutput','outputText','content','text','value']){
    if(key in input){const result=unpack(input[key],depth+1);if(result)return result;}
  }
  return null;
};
const normalizedConfig=(config)=>{
  if(!config||typeof config!=='object')throw new Error('INVALID_FLEET_RULESET');
  const weights=Object.fromEntries(FACTORS.map(k=>[k,Number(config.weights?.[k])]));
  const total=Object.values(weights).reduce((s,n)=>s+n,0);
  if(Object.values(weights).some(n=>!Number.isFinite(n)||n<0)||Math.abs(total-100)>0.01)
    throw new Error('INVALID_FLEET_WEIGHTS');
  const t=config.thresholds||{};
  const thresholds=Object.fromEntries(['watch','high','critical'].map(k=>[k,Number(t[k])]));
  if(!Number.isFinite(thresholds.watch)||!Number.isFinite(thresholds.high)||
    !Number.isFinite(thresholds.critical)||!(0<thresholds.watch&&thresholds.watch<thresholds.high&&
    thresholds.high<thresholds.critical&&thresholds.critical<=100))
    throw new Error('INVALID_FLEET_THRESHOLDS');
  const mode=String(config.mode||'weighted');
  if(!['weighted','conservative','max-signal'].includes(mode))throw new Error('INVALID_FLEET_MODE');
  return {version:String(config.version||'NMC POC Ruleset').slice(0,80),weights,thresholds,mode};
};
export function evaluateFleetSignals(signals,config){
  const cfg=normalizedConfig(config);
  const values=Object.fromEntries(signals.map(s=>[s.factor,s.severity]));
  if(FACTORS.some(k=>!Number.isFinite(values[k])))throw new Error('INCOMPLETE_FLEET_SIGNALS');
  let score=FACTORS.reduce((sum,k)=>sum+values[k]*cfg.weights[k],0)/100;
  const max=Math.max(...FACTORS.map(k=>values[k]));
  if(cfg.mode==='conservative')score+=Math.max(0,max-score)*0.28;
  if(cfg.mode==='max-signal')score=score*0.68+max*0.32;
  score=Math.round(clamp(score,0,100));
  const level=score>=cfg.thresholds.critical?'Critical':
    score>=cfg.thresholds.high?'High':score>=cfg.thresholds.watch?'Watch':'Normal';
  return {score,level,configVersion:cfg.version};
}
export function verifyFleetSignals(a01,a02,knownIds,pscIds,requirePsc){
  const outputs={a01:unpack(a01),a02:unpack(a02)};
  if(!outputs.a01||!outputs.a02)throw new Error('FLEET_AI_RESPONSE_INVALID');
  const allow=new Set(knownIds);
  const external=new Set(pscIds);
  const all=[];
  for(const [agent,factors] of Object.entries(AGENT_FACTORS)){
    for(const factor of factors){
      const candidates=outputs[agent].signals.filter(s=>s&&s.factor===factor);
      if(candidates.length!==1)throw new Error('FLEET_AI_FACTOR_MISSING');
      const s=candidates[0];
      if(String(s.status||'').toUpperCase()!=='AVAILABLE')throw new Error('FLEET_AI_INSUFFICIENT_EVIDENCE');
      if(s.sourceAgent!==agent.toUpperCase())throw new Error('FLEET_AI_AGENT_MISMATCH');
      if(!Number.isFinite(s.severity)||s.severity<0||s.severity>100||
         !Number.isFinite(s.confidence)||s.confidence<0||s.confidence>1)
        throw new Error('FLEET_AI_INVALID_SCORE');
      if(!Array.isArray(s.evidenceIds)||!s.evidenceIds.length||
         s.evidenceIds.some(id=>typeof id!=='string'||!allow.has(id)))
        throw new Error('FLEET_AI_UNVERIFIED_EVIDENCE_ID');
      // Require actual PSC references where external inspection history is present.
      if(requirePsc&&((factor==='history'&&agent==='a01')||(factor==='inspection'&&agent==='a02'))&&
         !s.evidenceIds.some(id=>external.has(id)))
        throw new Error('FLEET_AI_PSC_EVIDENCE_NOT_CITED');
      all.push({factor,severity:s.severity,confidence:s.confidence,
        sourceAgent:s.sourceAgent,evidenceIds:s.evidenceIds,
        reason:String(s.reason||'').slice(0,1800)});
    }
  }
  if(all.length!==5)return null;
  return FACTORS.map(k=>all.find(s=>s.factor===k));
}
export function fleetAdminAuthorized(provided,secret){
  if(typeof secret!=='string'||secret.length<24||typeof provided!=='string')return false;
  const a=Buffer.from(provided),b=Buffer.from(secret);
  return a.length===b.length&&timingSafeEqual(a,b);
}
function loadStore(){
  if(!existsSync(file))return {};
  try{
    const doc=JSON.parse(readFileSync(file,'utf8'));
    if(doc.schema===1&&doc.results&&typeof doc.results==='object')return doc.results;
  }catch{console.error('[fleet] STORE_LOAD_FAILED');}
  return {};
}
export class FleetAssessmentManager {
  constructor({executeAgent,getPscVessel,repository=null}){
    this.executeAgent=executeAgent;
    this.getPscVessel=getPscVessel;
    this.repository=repository;
    this.results=repository?{}:loadStore();
    this.persistenceHealthy=true;
    this.job=null;
  }
  async initialize(bundles){
    if(!this.repository)return;
    await this.repository.init();
    await this.repository.seedVessels(bundles);
    this.results=await this.repository.loadLatest();
  }
  async persist(){
    if(this.repository){
      try {await this.repository.saveStateBatch(Object.values(this.results));}
      catch(error){this.persistenceHealthy=false;throw error;}
      return;
    }
    mkdirSync(dirname(file),{recursive:true});
    const tmp=file+'.tmp';
    writeFileSync(tmp,JSON.stringify({schema:1,updatedAt:new Date().toISOString(),results:this.results}),{encoding:'utf8',mode:0o600});
    renameSync(tmp,file);
  }
  snapshot(){
    const values=Object.values(this.results).filter(x=>VALID_IMOS.has(x.imo));
    const counts={total:420,assessed:0,pending:420,normal:0,watch:0,high:0,critical:0,
      priorityReview:0,failed:0,refreshFailed:0};
    for(const r of values){
      if(r.status==='COMPLETED'){
        if(r.refreshFailure)counts.refreshFailed++;
        counts.assessed++;
        const key=r.level.toLowerCase();
        if(Object.hasOwn(counts,key))counts[key]++;
        if(r.operationalPriority==='Priority Review')counts.priorityReview++;
      }else if(r.status==='FAILED')counts.failed++;
    }
    counts.pending=420-counts.assessed;
    return {status:'ok',provenance:'SYNTHETIC_POC_AI_NOT_AUTHORITATIVE',
      fleetSize:420,counts,job:this.job&&{
        id:this.job.id,status:this.job.status,total:this.job.total,completed:this.job.completed,
        failed:this.job.failed,startedAt:this.job.startedAt,finishedAt:this.job.finishedAt||null
      },results:Object.fromEntries(values.map(v=>[v.imo,{imo:v.imo,status:v.status,score:v.score,level:v.level,operationalPriority:v.operationalPriority,criticalOpenFinding:v.criticalOpenFinding,assessedAt:v.assessedAt,reasonCode:v.reasonCode,configVersion:v.configVersion,sourceMode:v.sourceMode,
        lastCheckedAt:v.lastCheckedAt,nextCheckAt:v.nextCheckAt,refreshFailure:v.refreshFailure||null}]))};
  }
  getVesselResult(imo){return VALID_IMOS.has(imo)?(this.results[imo]||null):null;}
  /**
   * Read-only dashboard facts from stored, validated A01/A02 factor severities.
   * No agent execution and no recalculation of persisted historical assessments.
   * Ruleset what-if scores are calculated by the consumer's deterministic engine.
   */
  analytics(){
    const factors=['movement','inspection','certificate','dataQuality','history'];
    const records=Object.values(this.results).filter(row=>
      VALID_IMOS.has(row.imo)&&row.status==='COMPLETED');
    const assessments=[];
    for(const row of records){
      if(!Array.isArray(row.signals)||row.signals.length!==5)continue;
      const values={};
      for(const key of factors){
        const matches=row.signals.filter(s=>s?.factor===key);
        if(matches.length!==1||!Number.isFinite(matches[0].severity)||
           matches[0].severity<0||matches[0].severity>100)break;
        values[key]=matches[0].severity;
      }
      if(factors.some(key=>!Object.hasOwn(values,key)))continue;
      assessments.push({
        imo:row.imo,assessmentId:row.assessmentId||null,
        assessedAt:row.assessedAt||null,
        savedRiskScore:row.score,
        savedRiskLevel:row.level,
        rulesetVersion:row.configVersion||null,
        criticalOpenFinding:Boolean(row.criticalOpenFinding),
        factorSeverities:values
      });
    }
    return {status:'ok',fleetSize:420,assessments};
  }
  start(input){
    if(this.job?.status==='RUNNING')throw new Error('FLEET_JOB_ALREADY_RUNNING');
    if(!input||!Array.isArray(input.vessels)||input.vessels.length<1||
       input.vessels.length>MAX_INPUTS)throw new Error('INVALID_FLEET_BATCH_SIZE');
    const cfg=normalizedConfig(input.config);
    const seen=new Set();
    for(const v of input.vessels){
      if(!v||!VALID_IMOS.has(v.imo)||seen.has(v.imo)||
        !v.inlineContext||typeof v.inlineContext!=='object'||
        !Array.isArray(v.evidenceIds)||v.evidenceIds.length<1||
        v.evidenceIds.length>150||v.evidenceIds.some(id=>typeof id!=='string')||
        v.inlineContext?.vessel?.imo!==v.imo)
        throw new Error('INVALID_FLEET_INPUT_BUNDLE');
      seen.add(v.imo);
    }
    const job={
      id:'FLEET-'+Date.now(),status:'RUNNING',total:input.vessels.length,
      completed:0,failed:0,startedAt:new Date().toISOString(),finishedAt:null,
      cancelled:false
    };
    if(!this.persistenceHealthy)throw new Error('FLEET_PERSISTENCE_UNAVAILABLE');
    this.job=job;
    const queue=[...input.vessels];
    // Queued only by the server-side scheduler. No browser-triggered agent execution.
    void this.runQueue(job,queue,cfg);
    return {id:job.id,status:job.status,total:job.total,estimatedAiriaCalls:job.total*2};
  }
  cancel(){
    if(!this.job||this.job.status!=='RUNNING')throw new Error('NO_RUNNING_FLEET_JOB');
    this.job.cancelled=true;
    return {id:this.job.id,status:'CANCELLATION_REQUESTED',
      note:'In-flight agents may still finish; queued vessels will not start.'};
  }
  async runQueue(job,queue,cfg){
    const worker=async()=>{
      while(queue.length&&!job.cancelled&&this.persistenceHealthy){
        const v=queue.shift();
        try{
          const output=await this.assess(v,cfg);
          const current={...output,status:'COMPLETED',
            inputHash:v._inputHash||null,lastCheckedAt:output.assessedAt,
            nextCheckAt:new Date(Date.now()+(v._refreshIntervalMs||3600000)).toISOString(),
            refreshFailure:null};
          const previous=this.results[v.imo];
          if(this.repository){
            const assessmentId=await this.repository.saveAssessment(current,{previous,jobId:job.id});
            current.assessmentId=assessmentId;
          }
          this.results[v.imo]=current;
          job.completed++;
        }catch(error){
          const reasonCode=serializeError(error);
          console.error('[fleet] imo='+v.imo+' reasonCode='+reasonCode);
          if(this.repository&&reasonCode.startsWith('ORACLE_')){
            this.persistenceHealthy=false;
            job.failed++;
            queue.length=0; // Do not spend additional Airia calls when Oracle is unavailable.
            break;
          }
          const previous=this.results[v.imo];
          const failedAt=new Date().toISOString();
          const failed=previous?.status==='COMPLETED'
            ? {...previous,refreshFailure:reasonCode,lastCheckedAt:failedAt,
              nextCheckAt:new Date(Date.now()+900000).toISOString()}
            : {imo:v.imo,status:'FAILED',reasonCode,attemptedAt:failedAt,
              lastCheckedAt:failedAt,nextCheckAt:new Date(Date.now()+900000).toISOString(),
              authoritative:false};
          if(this.repository){
            try{await this.repository.saveStateBatch([failed]);}
            catch{this.persistenceHealthy=false;queue.length=0;job.failed++;break;}
          }
          this.results[v.imo]=failed;
          job.failed++;
        }
        if(!this.repository){
          try{await this.persist();}catch{console.error('[fleet] STORE_WRITE_FAILED');}
        }
      }
    };
    try{
      if(this.repository)await this.repository.saveJob(job);
      await Promise.all(Array.from({length:Math.min(MAX_CONCURRENCY,queue.length)},()=>worker()));
    }catch(error){
      this.persistenceHealthy=false;
      console.error('[fleet] ORACLE_JOB_WRITE_FAILED');
    }finally{
      job.status=!this.persistenceHealthy?'FAILED':job.cancelled?'CANCELLED':'COMPLETED';
      job.finishedAt=new Date().toISOString();
      if(this.repository&&this.persistenceHealthy){
        try{await this.repository.saveJob(job);}
        catch{this.persistenceHealthy=false;console.error('[fleet] ORACLE_JOB_WRITE_FAILED');}
      }
    }
  }
  async intelligence(imo){
    if(!VALID_IMOS.has(imo))return null;
    if(!this.repository)return {imo,assessmentId:null,
      quality:{score:null,status:'NOT_CALCULATED',version:null,breakdown:null},
      conflicts:[],independentlyVerifiedDataConfidence:null,
      dataNature:'SYNTHETIC_POC_NOT_OFFICIAL',storage:'JSON_NO_INTELLIGENCE'};
    return this.repository.intelligence(imo);
  }
  async history(imo){
    if(!VALID_IMOS.has(imo))return null;
    if(!this.repository)return {imo,assessments:[],events:[],storage:'JSON_NO_HISTORY'};
    return this.repository.history(imo);
  }
  async assess(v,cfg){
    const psc=await this.getPscVessel(v.imo); // errors fail closed, never fall back from live to fixture.
    if(psc.authoritative!==false||psc.dataNature!=='SYNTHETIC_NOT_RIYADH_MOU'||
      !Array.isArray(psc.evidenceIds)||psc.imo!==v.imo)throw new Error('FLEET_PSC_PROVENANCE_INVALID');
    const ids=[...v.evidenceIds,...psc.evidenceIds];
    const context={...v.inlineContext,externalPsc:{
      sourceSystem:psc.sourceSystem,sourceMode:psc.sourceMode,dataNature:psc.dataNature,
      authoritative:false,verifiedByAuthority:false,coverage:psc.coverage,
      retrievedAt:psc.retrievedAt,inspections:psc.inspections,deficiencies:psc.deficiencies,
      detentions:psc.detentions,evidenceIds:psc.evidenceIds,
      missingEvidence:psc.pdfContentAvailable?[]:['EXTERNAL_PSC_REPORT_PDFS'],
      note:'SYNTHETIC external PSC only. NOT real Riyadh MoU. Absence means unknown, not clearance.'
    }};
    const base={requestMeta:{correlationId:'FLEET-'+v.imo+'-'+Date.now(),language:'en'},
      subject:{type:'VESSEL',imo:v.imo},bundleRef:'VBL-'+v.imo,
      contextMode:'INLINE',officialScoringRequested:false,inlineContext:context};
    const [a01,a02]=await Promise.all([
      this.executeAgent('a01',{...base,requestedSignals:AGENT_FACTORS.a01}),
      this.executeAgent('a02',{...base,requestedSignals:AGENT_FACTORS.a02})
    ]);
    const signals=verifyFleetSignals(a01,a02,ids,psc.evidenceIds,psc.inspections.length>0);
    const risk=evaluateFleetSignals(signals,cfg);
    const quality=evaluateDataQuality({bundle:v,psc,signals});
    const internal=v.inlineContext.deficiencies||[];
    const criticalOpen=internal.some(x=>x.status==='Open'&&x.severity==='Critical')||
      psc.deficiencies.some(x=>x.status==='OPEN'&&x.severity==='CRITICAL');
    const priority=criticalOpen?'Priority Review':risk.level==='Critical'?'Priority Review':
      risk.level==='High'?'Enhanced Monitoring':'Routine';
    return {
      imo:v.imo,score:risk.score,level:risk.level,
      operationalPriority:priority,criticalOpenFinding:criticalOpen,
      reviewedByHuman:false,authoritative:false,
      sourceMode:psc.sourceMode,pscSummary:psc.summary,
      signals,quality,configVersion:risk.configVersion,ruleset:cfg,
      assessedAt:new Date().toISOString(),
      sourceNature:'SYNTHETIC_NOT_RIYADH_MOU',evidenceVerified:false,
      disclaimer:'Provisional simulation. Internal fixture conditions may reflect synthetic baseline. No regulatory action.'
    };
  }
}
