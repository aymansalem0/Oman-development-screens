import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {catalogFromNmcSource} from '../../tools/psc/psc-fixtures.mjs';
import {AIRIA_DEMO_99_RECORDS,AIRIA_DEMO_99_IMOS,AIRIA_DEMO_COHORT} from '../airia-demo-cohort.mjs';
import {FleetAssessmentManager} from '../fleet-ai.mjs';

const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const routes=JSON.parse(read('../../src/app/data/airia-offshore-corridors.json'));
test('Airia §8 exactly 99 unique demo identities match unchanged 420-source fixture',()=>{
 const all=catalogFromNmcSource(read('../nmc-vessel-catalog.ts'),read('../nmc-expanded-vessel-catalog.ts'));
 assert.equal(all.length,420,'the original 420-vessel source remains available unchanged');
 const lookup=new Map(all.map(v=>[v.imo,v.name]));
 assert.equal(AIRIA_DEMO_99_RECORDS.length,99);
 assert.equal(AIRIA_DEMO_99_IMOS.size,99);
 assert.equal(AIRIA_DEMO_COHORT.count,99);
 for(const vessel of AIRIA_DEMO_99_RECORDS)
  assert.equal(lookup.get(vessel.imo),vessel.name);
 const manager=new FleetAssessmentManager();
 const snapshot=manager.snapshot({});
 assert.equal(snapshot.fleetSize,99);
 assert.equal(snapshot.counts.total,99);
 assert.equal(snapshot.counts.pending,99);
 assert.equal(manager.snapshot({
  '9328471':{imo:'9328471',status:'COMPLETED',score:88,level:'Critical'},
  '9781207':{imo:'9781207',status:'COMPLETED',score:90,level:'Critical'}
 }).counts.assessed,1,'out-of-cohort risk rows remain stored but hidden from current POC');
});
test('eight offshore corridors have only conservative manually scoped maritime points',()=>{
 assert.equal(Object.keys(routes).length,8);
 for(const [key,route] of Object.entries(routes)){
  assert.ok(route.length>=3);
  const gulf=key.startsWith('airiaGulf');
  const bound=gulf?{minLat:25.5,maxLat:26.2,minLng:52.6,maxLng:54.9}:
   {minLat:24.95,maxLat:25.7,minLng:56.9,maxLng:57.85};
  for(let i=0;i<route.length-1;i++){
   const a=route[i],b=route[i+1];
   for(let n=0;n<=100;n++){
    const t=n/100,lat=a[0]+(b[0]-a[0])*t,
     lng=a[1]+(b[1]-a[1])*t;
    assert.ok(lat>bound.minLat&&lat<bound.maxLat&&
      lng>bound.minLng&&lng<bound.maxLng,
      key+': interpolated segment must remain inside offshore staging bounds');
   }
  }
 }
 const motion=read('../../src/app/data/airia-maritime-motion.ts');
 assert.match(motion,/offshorePoint\(v\.routeKey,phase\)/);
 assert.match(motion,/offshorePoint\(routeKey,progress\)/);
 assert.doesNotMatch(motion,/random\(|Math\.random|laneOffset|jitter/);
});
