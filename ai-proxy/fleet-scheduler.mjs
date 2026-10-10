/**
 * Autonomous, server-side per-vessel hourly trigger for the synthetic NMC POC.
 * The Command Center does not start agent calls or hold any admin token.
 * An hourly check reads source records; unchanged evidence skips paid AI calls.
 * Missing vessels are bootstrapped first, then changed/due vessels.
 *
 * Startup is gated by NMC_FLEET_AUTO_ENABLED=true because the initial pass
 * can incur up to 840 paid Airia executions. No UI button, token or action.
 */
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

const HOUR=60*60*1000;
const RETRY_DELAY=15*60*1000;
const LOOP_INTERVAL=15000;
const MAX_BATCH=12;
const capVessels=value=>Math.max(1,Math.min(420,Number.isFinite(Number(value))?Math.floor(Number(value)):420));
export const DEFAULT_FLEET_RULESET=Object.freeze({
  version:'NMC Risk Ruleset 1.0',mode:'weighted',
  weights:{movement:25,inspection:28,certificate:20,dataQuality:14,history:13,documentIntegrity:0},
  thresholds:{watch:45,high:65,critical:85}
});

export class FleetAutoScheduler {
  constructor({fleet,getPscVessel,getRiskConfig=null,getDocumentFingerprint=null,enabled=false,bundles=null,intervalMs=HOUR,config=DEFAULT_FLEET_RULESET,maxVessels=420,retryFailed=false}){
    this.fleet=fleet;this.getPscVessel=getPscVessel;
    this.getRiskConfig=getRiskConfig;this.getDocumentFingerprint=getDocumentFingerprint;
    this.enabled=enabled;
    this.intervalMs=Math.max(60000,Number(intervalMs)||HOUR);
    this.config=config;
    // For safe first deployment set maxVessels=1. No browser UI trigger.
    this.maxVessels=capVessels(maxVessels);
    this.retryFailed=Boolean(retryFailed);
    this.bundles=bundles||JSON.parse(readFileSync(new URL('./fleet-bundles.json',import.meta.url),'utf8'));
    if(this.bundles.length!==420||new Set(this.bundles.map(v=>v.imo)).size!==420)
      throw new Error('INVALID_AUTONOMOUS_FLEET_BUNDLES');
    this.runningTick=false;this.timer=null;
    this.lastTickAt=null;this.lastError=null;
    this.lastSelected=0;this.lastUnchanged=0;
    this.lastDocumentSourceUnavailable=0;this.lastDocumentSourceNotConfigured=0;
  }
  status(){
    return {
      mode:'AUTONOMOUS_PER_VESSEL',enabled:this.enabled,
      checkIntervalSeconds:Math.round(this.intervalMs/1000),
      enabledVessels:this.maxVessels,retryFailed:this.retryFailed,
      startupMode:'SERVER_SIDE_BACKGROUND',noDashboardAgentExecution:true,
      lastTickAt:this.lastTickAt,lastError:this.lastError,
      lastSelected:this.lastSelected,lastUnchanged:this.lastUnchanged,
      blockedFailedVessels:this.retryFailed?0:
        this.bundles.slice(0,this.maxVessels)
          .filter(v=>this.fleet.results[v.imo]?.status==='FAILED'||
            Boolean(this.fleet.results[v.imo]?.refreshFailure)).length,
      lastDocumentSourceUnavailable:this.lastDocumentSourceUnavailable,
      lastDocumentSourceNotConfigured:this.lastDocumentSourceNotConfigured,
      batchRunning:this.fleet.job?.status==='RUNNING'
    };
  }
  start(){
    if(!this.enabled||this.timer)return;
    this.timer=setInterval(()=>void this.tick(),LOOP_INTERVAL);
    this.timer.unref?.();
    void this.tick();
  }
  stop(){
    if(this.timer)clearInterval(this.timer);
    this.timer=null;
  }
  async tick(){
    if(!this.enabled||this.fleet.persistenceHealthy===false||this.runningTick||this.fleet.job?.status==='RUNNING')return;
    this.runningTick=true;
    this.lastTickAt=new Date().toISOString();this.lastSelected=0;this.lastUnchanged=0;
    this.lastDocumentSourceUnavailable=0;this.lastDocumentSourceNotConfigured=0;
    try{
      const now=Date.now();
      const activeConfig=this.getRiskConfig?await this.getRiskConfig():this.config;
      // Complete missing/failing vessels before refreshing previously completed ones.
      const candidates=this.bundles.slice(0,this.maxVessels).filter(v=>{
        const row=this.fleet.results[v.imo];
        // Failed AI calls must not incur repeated charges every 15 minutes by default.
        // Rollout must opt into retries explicitly and evaluate real Airia response contracts first.
        if(!this.retryFailed&&(row?.status==='FAILED'||row?.refreshFailure))return false;
        const due=Date.parse(row?.nextCheckAt||row?.lastCheckedAt||row?.assessedAt||'')||0;
        if(row?.status==='FAILED')return now>=Math.max(due,Date.parse(row.attemptedAt||'')+RETRY_DELAY||0);
        return now>=due;
      }).sort((a,b)=>{
        const as=this.fleet.results[a.imo]?.status==='COMPLETED'?1:0;
        const bs=this.fleet.results[b.imo]?.status==='COMPLETED'?1:0;
        return as-bs;
      });
      const selected=[];
      for(const v of candidates){
        if(selected.length>=MAX_BATCH)break;
        const previous=this.fleet.results[v.imo];
        let psc;
        try {psc=await this.getPscVessel(v.imo);}
        catch(e){
          const code=String(e?.message||'PSC_SOURCE_UNAVAILABLE');
          const safe=/^[A-Z][A-Z0-9_]{1,95}$/.test(code)?code:'PSC_SOURCE_UNAVAILABLE';
          await this.noteFailure(v.imo,safe);
          continue;
        }
        if(psc.imo!==v.imo||psc.authoritative!==false||
           psc.dataNature!=='SYNTHETIC_NOT_RIYADH_MOU')
          {await this.noteFailure(v.imo,'PSC_PROVENANCE_INVALID');continue;}
        // Drive metadata is read-only. A03 runs only later, inside the
        // selected paid assessment. New/modified documents invalidate hash.
        let driveFingerprint='NOT_CONFIGURED';
        const documentsRequired=Number(activeConfig.weights?.documentIntegrity||0)>0;
        try{if(this.getDocumentFingerprint)
          driveFingerprint=await this.getDocumentFingerprint(v.imo);}
        catch{
          if(documentsRequired){
            await this.noteFailure(v.imo,'A03_DRIVE_METADATA_UNAVAILABLE');
            continue;
          }
          // The optional Drive connector can go offline independently of
          // PSC, A01 and A02. A stable marker ensures that restoration causes
          // a new fingerprint at the next scheduled refresh.
          driveFingerprint='A03_DRIVE_METADATA_UNAVAILABLE';
          this.lastDocumentSourceUnavailable++;
        }
        if(driveFingerprint==='NO_DRIVE_CONFIGURATION'){
          this.lastDocumentSourceNotConfigured++;
          if(documentsRequired){
            await this.noteFailure(v.imo,'DOCUMENT_INTEGRITY_EVIDENCE_REQUIRED');
            continue;
          }
        }
        const hash=createHash('sha256').update(JSON.stringify({
          internal:v.inlineContext,
          evidenceIds:v.evidenceIds,
          psc:{inspections:psc.inspections,deficiencies:psc.deficiencies,detentions:psc.detentions,
            coverage:psc.coverage,sourceMode:psc.sourceMode,datasetVersion:psc.datasetVersion},
          driveFingerprint,ruleset:activeConfig
        })).digest('hex');
        if(previous?.status==='COMPLETED'&&previous?.inputHash===hash){
          previous.lastCheckedAt=new Date().toISOString();
          previous.nextCheckAt=new Date(Date.now()+this.intervalMs).toISOString();
          previous.refreshFailure=null;
          this.lastUnchanged++;
          continue;
        }
        selected.push({...v,_inputHash:hash,_refreshIntervalMs:this.intervalMs});
      }
      if(this.lastUnchanged)await this.fleet.persist();
      this.lastSelected=selected.length;
      if(selected.length){
        this.fleet.start({vessels:selected,config:activeConfig});
      }
      this.lastError=null;
    }catch(error){
      this.lastError=/^[A-Z][A-Z0-9_]{1,95}$/.test(String(error?.message))?
        String(error.message):'FLEET_AUTONOMOUS_TICK_FAILED';
      console.error('[fleet-auto] '+this.lastError);
    }finally{this.runningTick=false;}
  }
  async noteFailure(imo,code){
    const prev=this.fleet.results[imo];
    const now=new Date();
    const next=new Date(now.getTime()+RETRY_DELAY).toISOString();
    if(prev?.status==='COMPLETED'){
      this.fleet.results[imo]={...prev,refreshFailure:code,
        lastCheckedAt:now.toISOString(),nextCheckAt:next};
    }else{
      this.fleet.results[imo]={imo,status:'FAILED',reasonCode:code,
        attemptedAt:now.toISOString(),lastCheckedAt:now.toISOString(),
        nextCheckAt:next,authoritative:false};
    }
    await this.fleet.persist();
  }
}
