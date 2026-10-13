import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {RuntimeSettings} from '../runtime-settings.mjs';
import {AiCredentialVault} from '../ai-credential-vault.mjs';
import {SiChecklistAiria} from '../si-checklist-airia.mjs';

const data=()=>{const dir=mkdtempSync(join(tmpdir(),'ai-gov-'));
 return {dir,done:()=>rmSync(dir,{recursive:true,force:true})};};
const UUID='bad751da-0e11-48fd-861d-5bde1afbbd8d';
test('Airia A01–A04 IDs follow partner catalogue; builder/vision disabled by default',()=>{
 const t=data();try{
  const s=new RuntimeSettings({env:{},file:join(t.dir,'settings.json')});
  s.load();
  assert.equal(s.get('AIRIA_A01_PIPELINE_ID'),'86904bc8-e552-4172-aaa8-1a79cbb9539d');
  assert.equal(s.get('AIRIA_A04_PIPELINE_ID'),UUID);
  assert.equal(s.get('SI_CHECKLIST_AIRIA_ENABLED'),false);
  assert.equal(s.get('AIRIA_SI_CHECKLIST_BUILDER_PIPELINE_ID'),'');
  assert.equal(s.get('SI_CHECKLIST_VISION_TRANSPORT'),'multipart');
  assert.equal(s.get('SI_AI_PROVIDER'),'mock');
  assert.equal(s.publicView().secretsExposed,false);
 }finally{t.done();}
});
test('Settings are versioned and apply on restart; checklist cannot be enabled without real IDs and explicit consent',async()=>{
 const t=data();try{
  const file=join(t.dir,'settings.json');
  const s=new RuntimeSettings({file,env:{}});
  s.load();
  const values={...s.publicView().values,SI_CHECKLIST_AIRIA_ENABLED:true};
  await assert.rejects(s.publish({expectedVersion:0,values,actor:'admin',
   reason:'Activate reviewed checklist agents',confirmCost:true}),
   /AI_GOVERNANCE_CHECKLIST_PIPELINES_REQUIRED/);
  values.AIRIA_SI_CHECKLIST_BUILDER_PIPELINE_ID=UUID;
  values.AIRIA_SI_CHECKLIST_VISION_PIPELINE_ID='603d32f6-2f5f-42a8-a592-77af571a2480';
  await assert.rejects(s.publish({expectedVersion:0,values,actor:'admin',
   reason:'Activate reviewed checklist agents',confirmCost:false}),
   /RUNTIME_SETTINGS_EXPLICIT_CONFIRMATION_REQUIRED/);
  const published=await s.publish({expectedVersion:0,values,
   actor:'admin',reason:'Activate reviewed checklist agents',confirmCost:true});
  assert.equal(published.version,1);
  assert.equal(published.history.length,1);
  assert.equal(published.history[0].actor,'admin');
  const reread=new RuntimeSettings({file,env:{}});
  reread.load();
  assert.equal(reread.get('SI_CHECKLIST_AIRIA_ENABLED'),true);
  assert.equal(reread.get('AIRIA_SI_CHECKLIST_BUILDER_PIPELINE_ID'),UUID);
 }finally{t.done();}
});
test('Governance rejects non-UUID pipeline, missing P01 UUID when P01 enabled, stale edits and arbitrary endpoints',async()=>{
 const t=data();try{
  const s=new RuntimeSettings({env:{},file:join(t.dir,'settings.json')});
  s.load();
  const base={...s.publicView().values};
  await assert.rejects(s.publish({expectedVersion:0,
   values:{...base,AIRIA_A04_PIPELINE_ID:'bad-id'},
   actor:'admin',reason:'Try invalid pipeline'}),/AIRIA_PIPELINE_UUID_INVALID/);
  await assert.rejects(s.publish({expectedVersion:0,
   values:{...base,SI_AI_PROVIDER:'airia',SI_P01_ENABLED:true},
   actor:'admin',reason:'Try unavailable P01 without real pipeline',confirmCost:true}),
   /AI_GOVERNANCE_SI_PIPELINES_REQUIRED/);
  await assert.rejects(s.publish({expectedVersion:99,values:base,
   actor:'admin',reason:'Try stale version',confirmCost:true}),
   /RUNTIME_SETTINGS_VERSION_CONFLICT/);
  await assert.rejects(s.publish({expectedVersion:0,
   values:{...base,AIRIA_BASE_URL:'https://evil.example'},
   actor:'admin',reason:'Try URL change',confirmCost:true}),
   /AIRIA_BASE_URL_NOT_ALLOWED/);
 }finally{t.done();}
});
test('API key is encrypted at rest, returned only as configured boolean and can rotate',()=>{
 const t=data();try{
  const file=join(t.dir,'secret.json'),secret='test-only-airia-key-1234567890';
  const vault=new AiCredentialVault({file,
   env:{MOEI_AI_VAULT_MASTER_KEY:'b'.repeat(64)}});
  const reply=vault.rotate({apiKey:secret,actor:'admin',
   reason:'Authorized first test credential',confirm:true});
  assert.equal(reply.configured,true);
  assert.equal(reply.valueExposed,false);
  assert.equal(vault.get(),secret);
  assert.equal(readFileSync(file,'utf8').includes(secret),false);
  const other=new AiCredentialVault({file,
   env:{MOEI_AI_VAULT_MASTER_KEY:'b'.repeat(64)}});
  assert.equal(other.get(),secret);
  assert.equal(other.status().source,'ENCRYPTED_VAULT');
 }finally{t.done();}
});
test('Airia vision uses live settings and sends images as multipart evidence when selected',async()=>{
 const calls=[],settings={
  SI_CHECKLIST_AIRIA_ENABLED:true,
  AIRIA_BASE_URL:'https://api.mena.airia.ai',
  AIRIA_SI_CHECKLIST_BUILDER_PIPELINE_ID:UUID,
  AIRIA_SI_CHECKLIST_VISION_PIPELINE_ID:UUID,
  SI_CHECKLIST_VISION_TRANSPORT:'multipart'};
 const api=new SiChecklistAiria({getSetting:k=>settings[k],
  getApiKey:()=> 'test-credential-12345678',
  transport:async(url,options)=>{
   calls.push({url,options});return {ok:true,json:async()=>({
    response:{recommendations:[]}})};
  }});
 const png=Buffer.from('89504e470d0a1a0a','hex').toString('base64');
 const data=await api.call('vision',{imo:'9328471',
  image:{mimeType:'image/png',base64:png,sha256:'example'},
  operatorInput:'Verify a photo'});
 assert.deepEqual(data,{recommendations:[]});
 assert.match(calls[0].url,/PipelineExecution\/Multipart\/bad751da/);
 assert.equal(calls[0].options.body instanceof FormData,true);
 assert.equal(calls[0].options.headers['Content-Type'],undefined);
 const included=String(calls[0].options.body.get('userInput'));
 assert.equal(included.includes(png),false,'do not duplicate image in inline JSON');
 settings.SI_CHECKLIST_AIRIA_ENABLED=false;
 await assert.rejects(api.call('vision',{imo:'9328471'}),
  /SI_CHECKLIST_AIRIA_NOT_CONFIGURED/);
});

test('dashboard focus is OFF by default, explicitly cost-confirmed, versioned and live-publishable',async()=>{
 const t=data();try{
  const file=join(t.dir,'settings.json');
  const s=new RuntimeSettings({env:{},file});s.load();
  assert.equal(s.get('NMC_DASHBOARD_AI_FOCUS_ENABLED'),false);
  assert.equal(s.get('NMC_A01_ENABLED'),true);
  assert.equal(s.get('NMC_A02_ENABLED'),true);
  const values={...s.publicView().values,NMC_DASHBOARD_AI_FOCUS_ENABLED:true};
  await assert.rejects(s.publish({expectedVersion:0,values,actor:'admin',
   reason:'Enable manually requested dashboard AI focus',confirmCost:false}),
   /RUNTIME_SETTINGS_EXPLICIT_CONFIRMATION_REQUIRED/);
  assert.equal(s.publicView().version,0);
  const published=await s.publish({expectedVersion:0,values,actor:'admin',
   reason:'Enable manually requested dashboard AI focus',confirmCost:true});
  assert.equal(published.version,1);
  assert.equal(published.values.NMC_DASHBOARD_AI_FOCUS_ENABLED,true);
  assert.equal(published.values.NMC_FLEET_AUTO_ENABLED,false);
  assert.deepEqual(published.history[0].changedKeys,['NMC_DASHBOARD_AI_FOCUS_ENABLED']);
  const reloaded=new RuntimeSettings({env:{},file});reloaded.load();
  assert.equal(reloaded.get('NMC_DASHBOARD_AI_FOCUS_ENABLED'),true);
 }finally{t.done();}
});

test('MENA partner catalogue contains explicit DQ01/C01/S01/V01/R01/X01 IDs; P01 remains unset',async()=>{
 const t=data();try{
  const s=new RuntimeSettings({env:{},file:join(t.dir,'settings.json')});s.load();
  const expected={
   AIRIA_NMC_DQ01_PIPELINE_ID:'c9f3b21d-dce6-4e66-81f2-db15fdb23256',
   AIRIA_SI_C01_PIPELINE_ID:'f0799e63-387e-44dd-a451-cdffef96ee0d',
   AIRIA_SI_S01_PIPELINE_ID:'eee9e630-ec5c-4ad8-b23e-59119696f837',
   AIRIA_SI_V01_PIPELINE_ID:'5006d8c4-f8b5-4811-b767-704daab16e6a',
   AIRIA_SI_R01_PIPELINE_ID:'d0efe143-96ee-4fc0-8f15-93cc81ac97d3',
   AIRIA_SI_X01_PIPELINE_ID:'b82d5bb0-3e84-4265-b8ed-8eb38989b30f'
  };
  for(const [k,v] of Object.entries(expected))assert.equal(s.get(k),v);
  assert.equal(s.get('AIRIA_SI_P01_PIPELINE_ID'),'');
  for(const k of ['SI_C01_ENABLED','SI_S01_ENABLED','SI_V01_ENABLED',
                   'SI_R01_ENABLED','SI_X01_ENABLED','NMC_DQ01_ENABLED'])
    assert.equal(s.get(k),false);
  // User can turn on a provisioned C01 without inventing an unrelated P01 ID.
  const values={...s.publicView().values,SI_AI_PROVIDER:'airia',
    SI_C01_ENABLED:true};
  const saved=await s.publish({expectedVersion:0,values,actor:'admin',
    reason:'Enable reviewed candidate selection pilot',confirmCost:true});
  assert.equal(saved.values.SI_AI_PROVIDER,'airia');
  assert.equal(saved.values.SI_P01_ENABLED,false);
  assert.equal(saved.values.AIRIA_SI_P01_PIPELINE_ID,'');
 }finally{t.done();}
});
