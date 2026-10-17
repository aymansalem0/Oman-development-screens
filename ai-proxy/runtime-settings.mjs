/**
 * Safe, effective runtime configuration. ENV values are boot defaults; this
 * versioned JSON overlay applies to a single Node/POC process across restarts.
 * No API key, credential, password, arbitrary ENV entry, file path or arbitrary
 * outbound URL is editable or returned.
 */
import {existsSync,readFileSync,writeFileSync,mkdirSync,renameSync} from 'node:fs';
import {dirname} from 'node:path';

const bool=x=>x===true||x==='true';
const uuidPattern=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const num=(x,fallback,min,max)=>Number.isFinite(Number(x))?Math.max(min,Math.min(max,Math.round(Number(x)))):fallback;
export const SETTINGS_DESCRIPTORS=Object.freeze([
  {key:'NMC_A01_ENABLED',type:'boolean',group:'agents',description:'Maritime situation intelligence (A01)',cost:true},
  {key:'NMC_A02_ENABLED',type:'boolean',group:'agents',description:'Vessel compliance assessment (A02)',cost:true},
  {key:'NMC_DASHBOARD_AI_DESIGN_ENABLED',type:'boolean',group:'agents',
    description:'Operator-confirmed Airia NMC Desk dashboard proposals; JSON contract unverified',cost:true},
  {key:'NMC_DASHBOARD_AI_FOCUS_ENABLED',type:'boolean',group:'agents',
    description:'NMC dashboard AI focus: operator-confirmed A02 then A01 (2 tenant agent executions)',cost:true},
  {key:'NMC_A03_ENABLED',type:'boolean',group:'agents',description:'Document extraction pipeline (A03)',cost:true},
  {key:'NMC_A03_AUTO_ENABLED',type:'boolean',group:'agents',description:'Run A03 automatically for changed vessel documents during scheduled fleet assessments',cost:true},
  {key:'SI_A04_ENABLED',type:'boolean',group:'agents',description:'On-demand Smart Inspection AI dossier (A04)',cost:true},
  {key:'SI_P01_ENABLED',type:'boolean',group:'agents',description:'SI-P01 retired from current POC; permanently OFF (history preserved)',cost:false},
  {key:'NMC_ALERT_SCAN_ENABLED',type:'boolean',group:'alerts',description:'Reconcile saved fleet risk alerts'},
  {key:'NMC_ALERT_SCAN_SECONDS',type:'number',min:15,max:3600,group:'alerts',description:'Alert scan interval in seconds'},
  {key:'NMC_ALERT_ESCALATE_MINUTES',type:'number',min:1,max:1440,group:'alerts',description:'Unacknowledged alert escalation time in minutes'},
  {key:'NMC_FLEET_AUTO_ENABLED',type:'boolean',group:'scheduler',description:'Run paid fleet assessments automatically',cost:true},
  {key:'NMC_FLEET_AUTO_MAX_VESSELS',type:'number',min:1,max:420,group:'scheduler',description:'Limit the vessels evaluated during the automatic pilot'},
  {key:'NMC_FLEET_AUTO_RETRY_FAILED',type:'boolean',group:'scheduler',description:'Retry failed paid assessments',cost:true},
  {key:'NMC_FLEET_REFRESH_SECONDS',type:'number',min:60,max:604800,group:'scheduler',description:'Per-vessel refresh interval in seconds'},
  {key:'SI_C01_ENABLED',type:'boolean',group:'agents',description:'Allow C01 selection',cost:true},
  {key:'NMC_DQ01_ENABLED',type:'boolean',group:'agents',description:'Optional Airia maritime data-quality factor signals; never calculates or overrides final score',cost:true},
  {key:'SI_S01_ENABLED',type:'boolean',group:'agents',description:'Airia scheduling rank for saved feasible slots; no booking',cost:true},
  {key:'SI_V01_ENABLED',type:'boolean',group:'agents',description:'Airia field vision on verified case-owned image; inspector confirms',cost:true},
  {key:'SI_R01_ENABLED',type:'boolean',group:'agents',description:'Airia report/CAPA draft from inspector-confirmed findings only',cost:true},
  {key:'SI_X01_ENABLED',type:'boolean',group:'agents',description:'Airia repeat/conflict review with proven history; human verification',cost:true},
  {key:'AIRIA_TIMEOUT_MS',type:'number',min:1000,max:180000,group:'connectivity',description:'Airia request timeout milliseconds'},
  {key:'AIRIA_A03_TRANSPORT',type:'choice',options:['multipart','inline'],group:'pipelines',description:'A03 document transport'},
  {key:'SI_AI_PROVIDER',type:'choice',options:['mock','airia'],group:'agents',
    description:'Smart Inspection C01/P01/A04 provider (MOCK or AIRIA)',cost:true},
  {key:'AIRIA_A01_PIPELINE_ID',type:'pipeline',group:'pipelines',description:'A01 Maritime Intelligence — structured JSON'},
  {key:'AIRIA_A02_PIPELINE_ID',type:'pipeline',group:'pipelines',description:'A02 Vessel Compliance — structured JSON'},
  {key:'AIRIA_A03_PIPELINE_ID',type:'pipeline',group:'pipelines',description:'A03 Document Intelligence — document attachment'},
  {key:'AIRIA_A04_PIPELINE_ID',type:'pipeline',group:'pipelines',description:'A04 Smart Inspection — dossier/evidence structured JSON'},
  {key:'AIRIA_CONVERSATIONAL_SI_PIPELINE_ID',type:'pipeline',group:'pipelines',
    description:'Conversational Smart Inspection — prose assistant (catalog only; NOT structured JSON Builder)'},
  {key:'AIRIA_NMC_DESK_PIPELINE_ID',type:'pipeline',group:'pipelines',
    description:'NMC Situational Desk — conversational partner pipeline (catalog reference)'},
  {key:'AIRIA_SDB_JOURNEY_PIPELINE_ID',type:'pipeline',group:'pipelines',
    description:'SDB Journey — conversational partner pipeline (catalog reference)'},
  {key:'AIRIA_NMC_DQ01_PIPELINE_ID',type:'pipeline',group:'pipelines',description:'DQ-01 Data Quality factor signals — not the final weighted score'},
  {key:'AIRIA_SI_C01_PIPELINE_ID',type:'pipeline',group:'pipelines',description:'C01 Candidate Selection (partner MENA pipeline)'},
  {key:'AIRIA_SI_S01_PIPELINE_ID',type:'pipeline',group:'pipelines',description:'S01 Scheduling slot ranking — verify current provider response schema'},
  {key:'AIRIA_SI_V01_PIPELINE_ID',type:'pipeline',group:'pipelines',description:'V01 Field evidence vision — requires case-owned safe media'},
  {key:'AIRIA_SI_R01_PIPELINE_ID',type:'pipeline',group:'pipelines',description:'R01 Report/CAPA proposals only'},
  {key:'AIRIA_SI_X01_PIPELINE_ID',type:'pipeline',group:'pipelines',description:'X01 Repeat/conflict evidence advice only'},
  {key:'AIRIA_SI_P01_PIPELINE_ID',type:'pipeline',group:'pipelines',description:'P01 future-only (not in current POC; no dedicated MENA UUID)'},
  {key:'SI_CHECKLIST_AIRIA_ENABLED',type:'boolean',group:'checklist',cost:true,
    description:'Enable manually-triggered Airia assistance for checklist design and field review'},
  {key:'AIRIA_SI_CHECKLIST_BUILDER_PIPELINE_ID',type:'pipeline',group:'checklist',
    description:'Builder structured checklist JSON pipeline — do not reuse conversational prose without validation'},
  {key:'AIRIA_SI_CHECKLIST_VISION_PIPELINE_ID',type:'pipeline',group:'checklist',
    description:'Inspector evidence review pipeline — A04 reuse requires typed JSON contract verification'},
  {key:'SI_CHECKLIST_VISION_TRANSPORT',type:'choice',options:['multipart','inline'],group:'checklist',
    description:'Image evidence transport: partner-documented multipart (recommended), inline only if pipeline verified'},
  {key:'SI_CHECKLIST_AI_MAX_CALLS_PER_CASE',type:'number',min:1,max:30,group:'checklist',
    description:'Maximum explicit AI suggestion calls per inspected case'},
  {key:'AIRIA_CONSOLE_PIPELINE_URL_TEMPLATE',type:'ui-template',group:'connectivity',description:'Airia management UI URL template; place {pipelineId} in the URL. Opens browser only, never invokes API.'},
  {key:'AIRIA_BASE_URL',type:'url',group:'connectivity',description:'Allowlisted HTTPS Airia MENA API endpoint (no secrets)'}
]);
const allowed=Object.fromEntries(SETTINGS_DESCRIPTORS.map(d=>[d.key,d]));
const DEFAULTS={
  NMC_A01_ENABLED:true,NMC_A02_ENABLED:true,
  NMC_DASHBOARD_AI_FOCUS_ENABLED:false,
  NMC_DASHBOARD_AI_DESIGN_ENABLED:false,
  NMC_A03_ENABLED:false,NMC_A03_AUTO_ENABLED:false,
  SI_A04_ENABLED:false,SI_P01_ENABLED:false,
  NMC_ALERT_SCAN_ENABLED:true,NMC_ALERT_SCAN_SECONDS:30,
  NMC_ALERT_ESCALATE_MINUTES:15,NMC_FLEET_AUTO_ENABLED:false,
  NMC_FLEET_AUTO_MAX_VESSELS:420,NMC_FLEET_AUTO_RETRY_FAILED:false,
  NMC_FLEET_REFRESH_SECONDS:3600,
  SI_C01_ENABLED:false,NMC_DQ01_ENABLED:false,
  SI_S01_ENABLED:false,SI_V01_ENABLED:false,SI_R01_ENABLED:false,SI_X01_ENABLED:false,
  AIRIA_TIMEOUT_MS:120000,AIRIA_A03_TRANSPORT:'multipart',SI_AI_PROVIDER:'mock',
  AIRIA_A01_PIPELINE_ID:'86904bc8-e552-4172-aaa8-1a79cbb9539d',
  AIRIA_A02_PIPELINE_ID:'73708937-ba16-47e3-b404-55cc0a54b159',
  AIRIA_A03_PIPELINE_ID:'603d32f6-2f5f-42a8-a592-77af571a2480',
  AIRIA_A04_PIPELINE_ID:'bad751da-0e11-48fd-861d-5bde1afbbd8d',
  AIRIA_CONVERSATIONAL_SI_PIPELINE_ID:'e1b776b8-62a4-43e2-abdb-9c114b74d9a1',
  AIRIA_NMC_DESK_PIPELINE_ID:'f332642a-a180-4935-908f-8868984dfcb7',
  AIRIA_SDB_JOURNEY_PIPELINE_ID:'d0b0036d-e8a2-4596-9a65-32164a2b59a7',
  AIRIA_NMC_DQ01_PIPELINE_ID:'c9f3b21d-dce6-4e66-81f2-db15fdb23256',
  AIRIA_SI_C01_PIPELINE_ID:'f0799e63-387e-44dd-a451-cdffef96ee0d',
  AIRIA_SI_S01_PIPELINE_ID:'eee9e630-ec5c-4ad8-b23e-59119696f837',
  AIRIA_SI_V01_PIPELINE_ID:'5006d8c4-f8b5-4811-b767-704daab16e6a',
  AIRIA_SI_R01_PIPELINE_ID:'d0efe143-96ee-4fc0-8f15-93cc81ac97d3',
  AIRIA_SI_X01_PIPELINE_ID:'b82d5bb0-3e84-4265-b8ed-8eb38989b30f',
  AIRIA_SI_P01_PIPELINE_ID:'',
  SI_CHECKLIST_AIRIA_ENABLED:false,
  AIRIA_SI_CHECKLIST_BUILDER_PIPELINE_ID:'',
  AIRIA_SI_CHECKLIST_VISION_PIPELINE_ID:'',
  SI_CHECKLIST_VISION_TRANSPORT:'multipart',
  SI_CHECKLIST_AI_MAX_CALLS_PER_CASE:10,
  AIRIA_CONSOLE_PIPELINE_URL_TEMPLATE:'',
  AIRIA_BASE_URL:'https://api.mena.airia.ai'
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
export function validateAiriaConsoleTemplate(value){
  if(value==='')return '';
  if(typeof value!=='string'||value.length>1200||
     (value.match(/\{pipelineId\}/g)||[]).length!==1)
    throw new RuntimeSettingsError('AIRIA_CONSOLE_URL_TEMPLATE_INVALID');
  let url;
  try{url=new URL(value.replace('{pipelineId}','00000000-0000-0000-0000-000000000000'));}
  catch{throw new RuntimeSettingsError('AIRIA_CONSOLE_URL_TEMPLATE_INVALID');}
  const host=url.hostname.toLowerCase();
  const allowedUiHost=(host==='airia.ai'||host.endsWith('.airia.ai')||
     host==='airia.com'||host.endsWith('.airia.com'));
  if(url.protocol!=='https:'||!allowedUiHost||url.username||url.password||
     url.port||url.hash||url.pathname.startsWith('/v1/'))
    throw new RuntimeSettingsError('AIRIA_CONSOLE_URL_NOT_ALLOWED');
  return value;
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
  if(d.type==='pipeline'){
    if(typeof value!=='string'||(value&&!uuidPattern.test(value)))
      throw new RuntimeSettingsError('AIRIA_PIPELINE_UUID_INVALID');
    return value;
  }
  if(d.type==='ui-template')return validateAiriaConsoleTemplate(value);
  if(d.type==='choice'){
    if(!d.options.includes(value))throw new RuntimeSettingsError('RUNTIME_SETTING_CHOICE_INVALID');
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
    if(d.type==='pipeline'||d.type==='choice'){
      try{value[d.key]=normalize(d.key,raw===undefined?def:raw);}
      catch{value[d.key]=def;}
    }
    if(d.type==='url'){
      try{value[d.key]=validateAiriaUrl(raw||def);}
      catch{value[d.key]=d.type==='ui-template'?'':DEFAULTS.AIRIA_BASE_URL;}
    }
  }
  // Old ENV true must not reactivate SI-P01 in this POC.
  value.SI_P01_ENABLED=false;
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
  get(key){
    if(!Object.hasOwn(allowed,key))throw new RuntimeSettingsError('RUNTIME_SETTING_UNKNOWN');
    if(key==='SI_P01_ENABLED')return false; // old persisted true is historical only
    return this.overrides[key]??this.env[key];
  }
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
    if(next.SI_P01_ENABLED===true)
      throw new RuntimeSettingsError('SI_P01_OUT_OF_CURRENT_POC_SCOPE',409);
    const enablingCost=SETTINGS_DESCRIPTORS.filter(d=>d.cost&&!this.get(d.key)&&next[d.key]);
    const urlChanged=this.get('AIRIA_BASE_URL')!==next.AIRIA_BASE_URL;
    const aiChanged=next.SI_AI_PROVIDER==='airia'&&
      this.get('SI_AI_PROVIDER')!==next.SI_AI_PROVIDER;
    const checklistConfigChanged=next.SI_CHECKLIST_AIRIA_ENABLED&&
      ['AIRIA_SI_CHECKLIST_BUILDER_PIPELINE_ID','AIRIA_SI_CHECKLIST_VISION_PIPELINE_ID',
       'SI_CHECKLIST_VISION_TRANSPORT'].some(k=>this.get(k)!==next[k]);
    if((enablingCost.length||urlChanged||aiChanged||checklistConfigChanged)&&confirmCost!==true)
      throw new RuntimeSettingsError('RUNTIME_SETTINGS_EXPLICIT_CONFIRMATION_REQUIRED');
    // Explicitly enabling paid model execution requires a real structured
    // pipeline. Existing Airia A04 is listed as a CANDIDATE reviewer; the
    // checklist contract must still be validated by an inspector.
    if(next.SI_CHECKLIST_AIRIA_ENABLED&&
      (!next.AIRIA_SI_CHECKLIST_BUILDER_PIPELINE_ID||
       !next.AIRIA_SI_CHECKLIST_VISION_PIPELINE_ID))
      throw new RuntimeSettingsError('AI_GOVERNANCE_CHECKLIST_PIPELINES_REQUIRED');
    // The Airia Partner Guide supplies C01 but NO SI-P01 MENA pipeline ID.
    // Never make C01 activation depend on an unavailable, unrelated P01 agent.
    if(next.SI_AI_PROVIDER==='airia'&&
      (next.SI_C01_ENABLED&&!next.AIRIA_SI_C01_PIPELINE_ID||
       next.SI_P01_ENABLED&&!next.AIRIA_SI_P01_PIPELINE_ID||
       next.SI_A04_ENABLED&&!next.AIRIA_A04_PIPELINE_ID))
      throw new RuntimeSettingsError('AI_GOVERNANCE_SI_PIPELINES_REQUIRED');
    if((next.NMC_DQ01_ENABLED&&!next.AIRIA_NMC_DQ01_PIPELINE_ID)||
       (next.SI_S01_ENABLED&&!next.AIRIA_SI_S01_PIPELINE_ID)||
       (next.SI_V01_ENABLED&&!next.AIRIA_SI_V01_PIPELINE_ID)||
       (next.SI_R01_ENABLED&&!next.AIRIA_SI_R01_PIPELINE_ID)||
       (next.SI_X01_ENABLED&&!next.AIRIA_SI_X01_PIPELINE_ID))
      throw new RuntimeSettingsError('AI_GOVERNANCE_PIPELINE_REQUIRED');
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
