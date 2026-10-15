import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {RuntimeSettings,RuntimeSettingsError,validateAiriaUrl,
  SETTINGS_DESCRIPTORS} from '../runtime-settings.mjs';
const scratch=()=>mkdtempSync(join(tmpdir(),'moei-runtime-settings-'));
const sample=()=>({
  NMC_A01_ENABLED:'true',NMC_A02_ENABLED:'true',NMC_A03_ENABLED:'false',
  NMC_A03_AUTO_ENABLED:'false',SI_A04_ENABLED:'false',SI_P01_ENABLED:'false',
  NMC_ALERT_SCAN_ENABLED:'true',NMC_ALERT_SCAN_SECONDS:'30',
  NMC_ALERT_ESCALATE_MINUTES:'15',NMC_FLEET_AUTO_ENABLED:'false',
  NMC_FLEET_AUTO_MAX_VESSELS:'3',NMC_FLEET_AUTO_RETRY_FAILED:'false',
  NMC_FLEET_REFRESH_SECONDS:'3600',
  AIRIA_BASE_URL:'https://api.mena.airia.ai',
  AIRIA_MENA_KEY:'THIS_SHOULD_NOT_LEAK_FROM_ENV'
});
test('runtime API exposes only explicit non-secret keys and effective defaults',()=>{
  const s=new RuntimeSettings({file:'/tmp/does-not-exist/runtime.json',env:sample()});
  const r=s.publicView();
  assert.equal(r.values.NMC_FLEET_AUTO_MAX_VESSELS,3);
  assert.equal(r.values.NMC_ALERT_SCAN_SECONDS,30);
  assert.equal(r.values.AIRIA_BASE_URL,'https://api.mena.airia.ai');
  assert.equal(Object.keys(r.values).length,SETTINGS_DESCRIPTORS.length);
  assert.equal(JSON.stringify(r).includes('THIS_SHOULD_NOT_LEAK_FROM_ENV'),false);
});
test('allow only two exact HTTPS Airia MENA origins',()=>{
  assert.equal(validateAiriaUrl('https://mena.api.airia.ai'),'https://mena.api.airia.ai');
  assert.equal(validateAiriaUrl('https://api.mena.airia.ai/'),'https://api.mena.airia.ai');
  for(const bad of ['http://mena.api.airia.ai','https://evil.example.com',
    'https://mena.api.airia.ai.evil.example.com','https://mena.api.airia.ai:8080',
    'https://username@mena.api.airia.ai','https://mena.api.airia.ai/private',
    'https://mena.api.airia.ai/?token=abc','https://127.0.0.1']){
    assert.throws(()=>validateAiriaUrl(bad),RuntimeSettingsError,bad);
  }
});
test('publisher-confirmed effective overrides are versioned and replay across restart',async()=>{
  const dir=scratch(),file=join(dir,'state.json'),updates=[];
  try{
    const s=new RuntimeSettings({file,env:sample(),onChange:r=>updates.push(r.version)});
    s.load();
    let values={...s.publicView().values,NMC_A03_ENABLED:true,
      NMC_A03_AUTO_ENABLED:true,NMC_ALERT_SCAN_SECONDS:45,
      NMC_FLEET_AUTO_ENABLED:true,NMC_FLEET_AUTO_MAX_VESSELS:3,
      AIRIA_BASE_URL:'https://mena.api.airia.ai'};
    await assert.rejects(s.publish({expectedVersion:0,values,actor:'Test Operator',
      reason:'Enable limited three-vessel pilot',confirmCost:false}),
      /RUNTIME_SETTINGS_EXPLICIT_CONFIRMATION_REQUIRED/);
    const r=await s.publish({expectedVersion:0,values,actor:'Test Operator',
      reason:'Enable limited three-vessel pilot',confirmCost:true});
    assert.equal(r.version,1);assert.deepEqual(updates,[1]);
    assert.equal(r.values.NMC_FLEET_AUTO_ENABLED,true);
    assert.equal(r.sources.NMC_ALERT_SCAN_SECONDS,'RUNTIME_OVERRIDE');
    assert.equal(r.sources.NMC_ALERT_ESCALATE_MINUTES,'ENV_DEFAULT');
    const saved=JSON.parse(readFileSync(file,'utf8'));
    assert.equal(saved.overrides.NMC_A03_AUTO_ENABLED,true);
    assert.equal(saved.overrides.NMC_FLEET_AUTO_MAX_VESSELS,undefined);
    const restarted=new RuntimeSettings({file,env:sample()});
    restarted.load();
    assert.equal(restarted.get('NMC_A03_AUTO_ENABLED'),true);
    assert.equal(restarted.get('AIRIA_BASE_URL'),'https://mena.api.airia.ai');
    await assert.rejects(restarted.publish({expectedVersion:0,values,actor:'Test Operator',
      reason:'Stale concurrent write',confirmCost:true}),
      /RUNTIME_SETTINGS_VERSION_CONFLICT/);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
test('invalid settings, unknown secrets, inactive dependencies and excessive schedules are rejected',async()=>{
  const dir=scratch();
  try{
    const s=new RuntimeSettings({file:join(dir,'state.json'),env:sample()});
    const base={...s.publicView().values};
    const request=values=>s.publish({expectedVersion:0,values,
      actor:'Test Operator',reason:'Explicitly reviewed updated configuration',confirmCost:true});
    await assert.rejects(request({...base,UNKNOWN_SECRET:'value'}),/RUNTIME_SETTINGS_REQUEST_INVALID/);
    await assert.rejects(request({...base,NMC_ALERT_SCAN_SECONDS:1}),/RUNTIME_SETTING_RANGE_INVALID/);
    await assert.rejects(request({...base,NMC_FLEET_AUTO_MAX_VESSELS:421}),/RUNTIME_SETTING_RANGE_INVALID/);
    await assert.rejects(request({...base,NMC_A03_AUTO_ENABLED:true}),/RUNTIME_A03_AUTO_REQUIRES_A03/);
    await assert.rejects(request({...base,NMC_A01_ENABLED:false,NMC_FLEET_AUTO_ENABLED:true}),
      /RUNTIME_FLEET_REQUIRES_A01_A02/);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
