import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {FleetAutoScheduler,DEFAULT_FLEET_RULESET} from '../fleet-scheduler.mjs';
const bundles=Array.from({length:420},(_,i)=>({
  imo:String(1000000+i), evidenceIds:['VES-'+i],
  inlineContext:{vessel:{imo:String(1000000+i)},deficiencies:[]}
}));
const getPsc=(imo,details='unchanged')=>({
  imo,authoritative:false,dataNature:'SYNTHETIC_NOT_RIYADH_MOU',
  inspections:[],deficiencies:[],detentions:[],coverage:'NO_RECORD_IN_FIXTURE',
  sourceMode:'GOOGLE_SHEETS_LIVE',datasetVersion:details,evidenceIds:[]
});
function hashOf(v,psc){
  return createHash('sha256').update(JSON.stringify({
    internal:v.inlineContext,evidenceIds:v.evidenceIds,
    psc:{inspections:psc.inspections,deficiencies:psc.deficiencies,detentions:psc.detentions,
      coverage:psc.coverage,sourceMode:psc.sourceMode,datasetVersion:psc.datasetVersion},
    driveFingerprint:'NOT_CONFIGURED',ruleset:DEFAULT_FLEET_RULESET
  })).digest('hex');
}
function mockFleet(){
  return {
    results:{},job:null,batches:[],persistCount:0,
    start(req){this.batches.push(req);return {id:'JOB',total:req.vessels.length};},
    persist(){this.persistCount++;}
  };
}
test('scheduler disabled by default does not call Airia or PSC',async()=>{
  const fleet=mockFleet();let calls=0;
  const scheduler=new FleetAutoScheduler({fleet,getPscVessel:async imo=>{calls++;return getPsc(imo);},enabled:false,bundles});
  scheduler.start();await scheduler.tick();
  assert.equal(fleet.batches.length,0);
  assert.equal(calls,0);
  scheduler.stop();
});
test('automatic initial bootstrap schedules first 12 missing vessels, no UI input',async()=>{
  const fleet=mockFleet();
  const scheduler=new FleetAutoScheduler({fleet,getPscVessel:async imo=>getPsc(imo),enabled:true,bundles});
  await scheduler.tick();
  assert.equal(fleet.batches.length,1);
  assert.equal(fleet.batches[0].vessels.length,12);
  assert.equal(fleet.batches[0].vessels[0].imo,bundles[0].imo);
  assert.equal(fleet.batches[0].vessels[0]._inputHash.length,64);
  assert.equal(fleet.batches[0].config.version,DEFAULT_FLEET_RULESET.version);
});
test('hourly trigger skips unchanged source content, then requeues only changed vessel',async()=>{
  const fleet=mockFleet();
  for(const v of bundles){
    fleet.results[v.imo]={
      imo:v.imo,status:'COMPLETED',inputHash:hashOf(v,getPsc(v.imo)),
      score:42,level:'Normal',assessedAt:new Date(Date.now()-7200000).toISOString(),
      nextCheckAt:new Date(Date.now()-1000).toISOString()
    };
  }
  const changes=new Map();
  const scheduler=new FleetAutoScheduler({fleet,
    getPscVessel:async imo=>getPsc(imo,changes.get(imo)||'unchanged'),enabled:true,bundles});
  await scheduler.tick();
  assert.equal(fleet.batches.length,0);
  assert.equal(scheduler.status().lastUnchanged,420);
  assert.equal(fleet.persistCount,1);
  const nextDue=new Date(Date.now()-2000).toISOString();
  for(const v of bundles)fleet.results[v.imo].nextCheckAt=nextDue;
  changes.set(bundles[0].imo,'changed-source');
  await scheduler.tick();
  assert.equal(fleet.batches.length,1);
  assert.equal(fleet.batches[0].vessels.length,1);
  assert.equal(fleet.batches[0].vessels[0].imo,bundles[0].imo);
  assert.equal(scheduler.status().lastUnchanged,419);
});
test('PSC outage is fail-closed and retains previously completed assessment',async()=>{
  const fleet=mockFleet();
  const vessel=bundles[0];
  fleet.results[vessel.imo]={imo:vessel.imo,status:'COMPLETED',score:78,level:'High',
    inputHash:hashOf(vessel,getPsc(vessel.imo)),
    nextCheckAt:new Date(Date.now()-1000).toISOString()};
  for(const v of bundles.slice(1))
    fleet.results[v.imo]={imo:v.imo,status:'COMPLETED',score:42,level:'Normal',
      nextCheckAt:new Date(Date.now()+3600000).toISOString()};
  const scheduler=new FleetAutoScheduler({fleet,enabled:true,bundles,
    getPscVessel:async()=>{throw new Error('GOOGLE_SHEETS_UNAVAILABLE');}});
  await scheduler.tick();
  assert.equal(fleet.batches.length,0);
  assert.equal(fleet.results[vessel.imo].status,'COMPLETED');
  assert.equal(fleet.results[vessel.imo].score,78);
  assert.equal(fleet.results[vessel.imo].refreshFailure,'GOOGLE_SHEETS_UNAVAILABLE');
  assert.ok(Date.parse(fleet.results[vessel.imo].nextCheckAt)>Date.now());
});


test('staged automatic deployment checks only first vessel, never sends a paid retry after failure',async()=>{
  const fleet=mockFleet();
  let lookups=0;
  const scheduler=new FleetAutoScheduler({
    fleet,enabled:true,bundles,maxVessels:1,retryFailed:false,
    getPscVessel:async imo=>{lookups++;return getPsc(imo);}
  });
  await scheduler.tick();
  assert.equal(fleet.batches.length,1);
  assert.equal(fleet.batches[0].vessels.length,1);
  assert.equal(lookups,1);
  fleet.results[bundles[0].imo]={imo:bundles[0].imo,status:'FAILED',
    reasonCode:'FLEET_AI_RESPONSE_INVALID',
    nextCheckAt:new Date(Date.now()-1000).toISOString()};
  await scheduler.tick();
  assert.equal(fleet.batches.length,1);
  assert.equal(lookups,1);
  assert.equal(scheduler.status().enabledVessels,1);
  assert.equal(scheduler.status().retryFailed,false);
});

test('missing Google Drive is an optional source: schedule A01/A02 without marking failed',async()=>{
  const fleet=mockFleet(),v=bundles[0];
  const scheduler=new FleetAutoScheduler({
    fleet,enabled:true,bundles,maxVessels:1,
    getPscVessel:async imo=>getPsc(imo),
    getDocumentFingerprint:async()=>{throw new Error('GOOGLE_TOKEN_REQUEST_FAILED_403');}
  });
  await scheduler.tick();
  assert.equal(fleet.batches.length,1);
  assert.equal(fleet.batches[0].vessels[0].imo,v.imo);
  assert.equal(fleet.results[v.imo],undefined);
  assert.equal(scheduler.status().lastDocumentSourceUnavailable,1);
  assert.equal(scheduler.status().lastError,null);
  assert.equal(scheduler.status().lastSelected,1);
});
test('published document integrity weight FAILS CLOSED when Google Drive unavailable',async()=>{
  const fleet=mockFleet(),v=bundles[0];
  const config={...DEFAULT_FLEET_RULESET,weights:{
    movement:23,inspection:25,certificate:18,dataQuality:13,history:11,documentIntegrity:10}};
  const scheduler=new FleetAutoScheduler({
    fleet,enabled:true,bundles,maxVessels:1,
    getRiskConfig:async()=>config,
    getPscVessel:async imo=>getPsc(imo),
    getDocumentFingerprint:async()=>{throw new Error('GOOGLE_TOKEN_REQUEST_FAILED_403');}
  });
  await scheduler.tick();
  assert.equal(fleet.batches.length,0);
  assert.equal(fleet.results[v.imo].reasonCode,'A03_DRIVE_METADATA_UNAVAILABLE');
  assert.equal(fleet.results[v.imo].status,'FAILED');
  assert.equal(scheduler.status().blockedFailedVessels,1);
  assert.equal(fleet.persistCount,1);
});
test('even when A03 is optional, failed paid assessments are never retried without consent',async()=>{
  const fleet=mockFleet(),v=bundles[0];
  fleet.results[v.imo]={imo:v.imo,status:'FAILED',reasonCode:'GOOGLE_DRIVE_NOT_CONFIGURED',
    nextCheckAt:new Date(Date.now()-10000).toISOString()};
  const scheduler=new FleetAutoScheduler({
    fleet,enabled:true,bundles,maxVessels:1,retryFailed:false,
    getPscVessel:async()=>{throw new Error('UNEXPECTED_PSC');},
    getDocumentFingerprint:async()=>{throw new Error('UNEXPECTED_DRIVE');}
  });
  await scheduler.tick();
  assert.equal(fleet.batches.length,0);
  assert.equal(scheduler.status().blockedFailedVessels,1);
  assert.equal(scheduler.status().lastSelected,0);
});
test('missing Drive root is reported and optional when no A03 risk weight exists',async()=>{
  const fleet=mockFleet(),scheduler=new FleetAutoScheduler({
    fleet,enabled:true,bundles,maxVessels:1,
    getPscVessel:async imo=>getPsc(imo),
    getDocumentFingerprint:async()=> 'NO_DRIVE_CONFIGURATION'
  });
  await scheduler.tick();
  assert.equal(fleet.batches.length,1);
  assert.equal(scheduler.status().lastDocumentSourceNotConfigured,1);
  assert.equal(scheduler.status().lastSelected,1);
});
