import test from 'node:test';
import assert from 'node:assert/strict';
import {SiCandidateTargeting} from '../si-candidate-targeting.mjs';

const event=(id,eta,departureAt)=>({
 eventKey:id,sourceType:'PSC_PORT_CALL',sourceReference:'MSW-'+id,
 approval:'SOURCE_FINAL',eta,departureAt,departureVerified:true,port:'Jebel Ali',
 evidenceIds:['MSW-EVID-'+id]
});
const vessel=(events)=>({
 key:'CANDIDATE-1',imo:'9401221',vesselName:'Falcon Crest',
 flag:'PA',vesselType:'CONTAINER',currentRisk:null,
 regime:'PORT_STATE_CONTROL',eligibility:'MANUAL_REVIEW',priority:'STANDARD',
 status:'PENDING_REVIEW',events
});
const grid=(candidates,operationalEvents=[])=>{
 const candidateService=Object.create(SiCandidateTargeting.prototype);
 return candidateService._vesselCandidates(candidates,new Map(),operationalEvents)[0];
};
test('Candidate row shows source-confirmed ETA and ETD for one IMO in separate fields',()=>{
 const x=grid([vessel([event('1','2026-10-21T08:00',
  '2026-10-21T20:00:00+04:00')])]);
 assert.equal(x.arrivalAt,'2026-10-21T08:00');
 assert.equal(x.arrivalStatus,'VERIFIED');
 assert.equal(x.departureAt,'2026-10-21T20:00:00+04:00');
 assert.equal(x.departureStatus,'VERIFIED');
 assert.equal(x.arrivalSourceReference,'MSW-1');
 assert.equal(x.departureSourceReference,'MSW-1');
});
test('missing ETA is unknown even where verified ETD exists; no ETA fabricated',()=>{
 const x=grid([vessel([event('2',null,'2026-10-21T20:00:00+04:00')])]);
 assert.equal(x.arrivalAt,null);
 assert.equal(x.arrivalStatus,'MISSING');
 assert.equal(x.departureStatus,'VERIFIED');
});
test('conflicting source ETDs and arrivals show conflicts instead of one misleading date',()=>{
 const x=grid([vessel([
  event('1','2026-10-21T08:00','2026-10-21T20:00:00+04:00'),
  event('2','2026-10-21T09:00','2026-10-21T22:00:00+04:00')
 ])]);
 assert.equal(x.arrivalStatus,'CONFLICT');
 assert.equal(x.departureStatus,'CONFLICT');
 assert.equal(x.departureAt,null);
 assert.equal(x.arrivalAt,null);
});
test('operational verified MSW port-call movement is displayed without creating an inspection candidate',()=>{
 const y=grid([vessel([])],[
  {eventKey:'OP-1',payload:{imo:'9401221',sourceType:'PSC_PORT_CALL',
   sourceApprovalStatus:'SOURCE_FINAL',sourceReference:'MSW-OP-1',
   eta:'2026-10-22T07:00',departureAt:'2026-10-22T17:00:00+04:00',
   port:'Jebel Ali'}}
 ]);
 assert.equal(y.arrivalStatus,'VERIFIED');
 assert.equal(y.departureStatus,'VERIFIED');
 assert.equal(y.sourceTypes.length,0,'operational port call must not create PSC eligibility');
});
