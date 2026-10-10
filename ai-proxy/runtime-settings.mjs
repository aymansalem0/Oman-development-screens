/**
 * Safe, effective runtime configuration. ENV values are boot defaults; this
 * versioned JSON overlay applies to a single Node/POC process across restarts.
 * No API key, credential, password, arbitrary ENV entry, file path or arbitrary
 * outbound URL is editable or returned.
 */
import {existsSync,readFileSync,writeFileSync,mkdirSync,renameSync} from 'node:fs';
import {dirname} from 'node:path';

const bool=x=>x===true||x==='true';
const num=(x,fallback,min,max)=>Number.isFinite(Number(x))?Math.max(min,Math.min(max,Math.round(Number(x)))):fallback;
export const SETTINGS_DESCRIPTORS=Object.freeze([
  {key:'NMC_A01_ENABLED',type:'boolean',group:'agents',description:'Maritime situation intelligence (A01)',cost:true},
  {key:'NMC_A02_ENABLED',type:'boolean',group:'agents',description:'Vessel compliance assessment (A02)',cost:true},
  {key:'NMC_A03_ENABLED',type:'boolean',group:'agents',description:'Document extraction pipeline (A03)',cost:true},
  {key:'NMC_A03_AUTO_ENABLED',type:'boolean',group:'agents',description:'Run A03 automatically for changed vessel documents during scheduled fleet assessments',cost:true},
  {key:'SI_A04_ENABLED',type:'boolean',group:'agents',description:'On-demand Smart Inspection AI dossier (A04)',cost:true},
  {key:'SI_P01_ENABLED',type:'boolean',group:'agents',description:'Smart Inspection prioritization P01',cost:true},
  {key:'NMC_ALERT_SCAN_ENABLED',type:'boolean',group:'alerts',description:'Reconcile saved fleet risk alerts'},
  {key:'NMC_ALERT_SCAN_SECONDS',type:'number',min:15,max:3600,group:'alerts',description:'Alert scan interval in seconds'},
  {key:'NMC_ALERT_ESCALATE_MINUTES',type:'number',min:1,max:1440,group:'alerts',description:'Unacknowledged alert escalation time in minutes'},
  {key:'NMC_FLEET_AUTO_ENABLED',type:'boolean',group:'scheduler',description:'Run paid fleet assessments automatically',cost:true},
  {key:'NMC_FLEET_AUTO_MAX_VESSELS',type:'number',min:1,max:420,group:'scheduler',description:'Limit the vessels evaluated during the automatic pilot'},
  {key:'NMC_FLEET_AUTO_RETRY_FAILED',type:'boolean',group:'scheduler',description:'Retry failed paid assessments',cost:true},
  {key:'NMC_FLEET_REFRESH_SECONDS',type:'number',min:60,max:604800,group:'scheduler',description:'Per-vessel refresh interval in seconds'},
  {key:'AIRIA_BASE_URL',type:'url',group:'connectivity',description:'Allowlisted HTTPS Airia MENA API endpoint (no secrets)'}
]);
const allowed=Object.fromEntries(SETTINGS_DESCRIPTORS.map(d=>[d.key,d]));
const DEFAULTS={
  NMC_A01_ENABLED:true,NMC_A02_ENABLED:true,
  NMC_A03_ENABLED:false,NMC_A03_AUTO_ENABLED:false,
  SI_A04_ENABLED:false,SI_P01_ENABLED:false,
  NMC_ALERT_SCAN_ENABLED:true,NMC_ALERT_SCAN_SECONDS:30,
  NMC_ALERT_ESCALATE_MINUTES:15,NMC_FLEET_AUTO_ENABLED:false,
  NMC_FLEET_AUTO_MAX_VESSELS:420,NMC_FLEET_AUTO_RETRY_FAILED:false,
  NMC_FLEET_REFRESH_SECONDS:3600,AIRIA_BASE_URL:'https://api.mena.airia.ai'
};
export class RuntimeSettingsError extends Error{
  constructor(code,status=422){super(code);this.code=code;this.status=status;}
}
export function validateAiriaUrl(v){
  if(typeof v!=='string')throw new RuntimeSettingsError('AIRIA_BASE_URL_INVALID');
  let u;try{u=new URL(v);}catch{throw new RuntimeSettingsError('AIRIA_BASE_URL_INVALID');}
  const hosts=['api.mena.airia.ai','mena.api.airia.ai'];
  if(u.protocol!=='https:'||!hosts.includes(u.hostname.toLowerCase())||
    u.username||u.password||u.port||u.pathname!=='/'||u.search||u.hash)
    throw new RuntimeSettingsError('AIRIA_BASE_URL_NOT_ALLOWED');
  return u.origin;
}
const normalize=(key,value)=>{
  const d=allowed[key];if(!d)throw new RuntimeSettingsError('RUNTIME_SETTING_UNKNOWN');
  if(d.type==='boolean'){
    if(typeof value!=='boolean')throw new RuntimeSettingsError('RUNTIME_SETTING_BOOLEAN_REQUIRED');
    return value;
  }
  if(d.type==='number'){
    if(!Number.isInteger(value)||value<d.min||value>d.max)
      throw new RuntimeSettingsError('RUNTIME_SETTING_RANGE_INVALID');
    return value;
  }
  return validateAiriaUrl(value);
};
function envConfig(env){
  const value={};
  for(const d of SETTINGS_DESCRIPTORS){
    const raw=env[d.key],def=DEFAULTS[d.key];
    if(d.type==='boolean')value[d.key]=raw===undefined?def:bool(raw);
    if(d.type==='number')value[d.key]=num(raw,def,d.min,d.max);
    if(d.type==='url'){
      try{value[d.key]=validateAiriaUrl(raw||def);}
      catch{value[d.key]=DEFAULTS.AIRIA_BASE_URL;}
    }
  }
  return value;
}
export class RuntimeSettings{
  constructor({env=process.env,file=process.env.NMC_RUNTIME_SETTINGS_STORE_PATH||
    '/data/nmc-runtime-settings.json',onChange=()=>{}}={}){
    this.file=file;this.env=envConfig(env);this.onChange=onChange;
    this.version=0;this.overrides={};this.updatedAt=null;this.updatedBy=null;this.history=[];
  }
  load(){
    if(!existsSync(this.file))return this.publicView();
    let parsed;
    try{parsed=JSON.parse(readFileSync(this.file,'utf8'));}
    catch{throw new RuntimeSettingsError('RUNTIME_SETTINGS_STORE_INVALID',503);}
    if(parsed?.schema!==1||!Number.isInteger(parsed.version)||
      parsed.version<1||!parsed.overrides||typeof parsed.overrides!=='object'||
      Array.isArray(parsed.overrides))
      throw new RuntimeSettingsError('RUNTIME_SETTINGS_STORE_INVALID',503);
    try{for(const [k,v] of Object.entries(parsed.overrides))normalize(k,v);}
    catch{throw new RuntimeSettingsError('RUNTIME_SETTINGS_STORE_INVALID',503);}
    this.overrides=parsed.overrides;this.version=parsed.version;
    this.updatedAt=parsed.updatedAt||null;this.updatedBy=parsed.updatedBy||null;
    this.history=Array.isArray(parsed.history)?parsed.history.slice(-100):[];
    return this.publicView();
  }
  get(key){if(!Object.hasOwn(allowed,key))throw new RuntimeSettingsError('RUNTIME_SETTING_UNKNOWN');return this.overrides[key]??this.env[key];}
  publicView(){
    return {status:'ok',version:this.version,values:Object.fromEntries(
      SETTINGS_DESCRIPTORS.map(d=>[d.key,this.get(d.key)])),
      defaults:this.env,descriptors:SETTINGS_DESCRIPTORS,
      sources:Object.fromEntries(SETTINGS_DESCRIPTORS.map(d=>[d.key,
        Object.hasOwn(this.overrides,d.key)?'RUNTIME_OVERRIDE':'ENV_DEFAULT'])),
      updatedAt:this.updatedAt,updatedBy:this.updatedBy,
      history:this.history.map(x=>({...x})).reverse(),
      secretsExposed:false,
      note:'Runtime overrides are persisted outside .env; edits do NOT change OS environment or Docker Compose variables.'};
  }
  async publish({expectedVersion,values,actor,reason,confirmCost}={}){
    if(!Number.isInteger(expectedVersion)||expectedVersion!==this.version)
      throw new RuntimeSettingsError('RUNTIME_SETTINGS_VERSION_CONFLICT',409);
    if(!actor||typeof actor!=='string'||actor.trim().length<3||actor.length>100||
      typeof reason!=='string'||reason.trim().length<8||reason.length>500||
      !values||typeof values!=='object'||Array.isArray(values)||
      Object.keys(values).length!==SETTINGS_DESCRIPTORS.length)
      throw new RuntimeSettingsError('RUNTIME_SETTINGS_REQUEST_INVALID');
    const next={};for(const d of SETTINGS_DESCRIPTORS){
      if(!Object.hasOwn(values,d.key))throw new RuntimeSettingsError('RUNTIME_SETTINGS_REQUIRED_FIELD');
      next[d.key]=normalize(d.key,values[d.key]);
    }
    const enablingCost=SETTINGS_DESCRIPTORS.filter(d=>d.cost&&!this.get(d.key)&&next[d.key]);
    const urlChanged=this.get('AIRIA_BASE_URL')!==next.AIRIA_BASE_URL;
    if((enablingCost.length||urlChanged)&&confirmCost!==true)
      throw new RuntimeSettingsError('RUNTIME_SETTINGS_EXPLICIT_CONFIRMATION_REQUIRED');
    if(next.NMC_A03_AUTO_ENABLED&&!next.NMC_A03_ENABLED)
      throw new RuntimeSettingsError('RUNTIME_A03_AUTO_REQUIRES_A03');
    if(next.NMC_FLEET_AUTO_ENABLED&&(!next.NMC_A01_ENABLED||!next.NMC_A02_ENABLED))
      throw new RuntimeSettingsError('RUNTIME_FLEET_REQUIRES_A01_A02');
    const changedKeys=SETTINGS_DESCRIPTORS
      .filter(d=>this.get(d.key)!==next[d.key]).map(d=>d.key);
    const stamp=new Date().toISOString();
    const previousHistory=[...this.history,{
      version:this.version+1,changedKeys,
      at:stamp,actor:actor.trim(),reason:reason.trim()}].slice(-100);
    const updated={schema:1,version:this.version+1,
      overrides:Object.fromEntries(Object.entries(next)
        .filter(([k,v])=>v!==this.env[k])),
      updatedAt:stamp,updatedBy:actor.trim(),reason:reason.trim(),history:previousHistory};
    try{
      mkdirSync(dirname(this.file),{recursive:true});
      const tmp=this.file+'.tmp-'+process.pid;
      writeFileSync(tmp,JSON.stringify(updated,null,2),{mode:0o600});
      renameSync(tmp,this.file);
    }catch{throw new RuntimeSettingsError('RUNTIME_SETTINGS_SAVE_FAILED',503);}
    this.version=updated.version;this.overrides=updated.overrides;
    this.updatedAt=updated.updatedAt;this.updatedBy=updated.updatedBy;
    this.history=updated.history;
    try{this.onChange(this.publicView());}
    catch{ /* saved desired state persists; next startup will replay safely */ }
    return this.publicView();
  }
}
