import test from 'node:test';
import assert from 'node:assert/strict';
import {getPscVessel, getPscHealth} from '../psc-reader.mjs';

test('snapshot adapter reports origin explicitly', async () => {
  const health=getPscHealth();
  assert.equal(health.expectedVessels,420);
  assert.equal(health.sourceMode,'snapshot');
  assert.equal(health.googleSheetsConfigured,false);
  assert.equal(health.liveDataConnected,false);
});
test('matching selected IMO returns PSC inspections and coherent evidence IDs', async () => {
  const vessel=await getPscVessel('9328471');
  assert.equal(vessel.sourceMode,'LOCAL_FIXTURE_SNAPSHOT');
  assert.equal(vessel.googleSheetsConnected,false);
  assert.equal(vessel.authoritative,false);
  assert.equal(vessel.imo,'9328471');
  assert.equal(vessel.inspections.length,4);
  assert.equal(vessel.detentions.length,1);
  assert.ok(vessel.deficiencies.length);
  assert.equal(vessel.evidenceIds.length,vessel.inspections.length+vessel.deficiencies.length+vessel.detentions.length);
  assert.ok(vessel.evidenceIds.every(id=>/^PSC-SIM-|^DET-PSC-SIM-/.test(id)));
  assert.ok(vessel.deficiencies.every(d=>vessel.inspections.some(i=>i.inspectionId===d.inspectionId)));
  assert.ok(vessel.detentions.every(d=>vessel.inspections.some(i=>i.inspectionId===d.inspectionId)));
  assert.match(vessel.disclaimer,/NOT actual Riyadh MoU/i);
});
test('different IMO never receives Gulf Horizon evidence', async () => {
  const vessel=await getPscVessel('9904410');
  assert.equal(vessel.imo,'9904410');
  assert.ok(vessel.evidenceIds.every(id=>!id.includes('0001-')));
});
test('unknown IMO fails closed with 404', async () => {
  await assert.rejects(()=>getPscVessel('1234567'),e=>e.status===404);
  await assert.rejects(()=>getPscVessel('9328471/../'),e=>e.status===404);
});
test('absent historical records are not interpreted as cleared inspection', async () => {
  const imo = '9400589'; // may change if fixture catalogue changes; locate by known in-code mapping below.
  const firstNoHistory = Array.from({length:420},(_,index)=>index+1).find(id=>id%29===0);
  assert.equal(firstNoHistory,29);
  // Vessel #29 in NMC's first 30 is Jumeirah Star.
  const vessel=await getPscVessel('9871140');
  assert.equal(vessel.coverage,'NO_RECORD_IN_FIXTURE');
  assert.equal(vessel.inspections.length,0);
  assert.equal(vessel.summary.detentions,0);
});
