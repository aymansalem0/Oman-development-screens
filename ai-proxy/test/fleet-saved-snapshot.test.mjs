import test from 'node:test';
import assert from 'node:assert/strict';
import {FleetAssessmentManager} from '../fleet-ai.mjs';

test('Fetch Again reads the Oracle persistence projection, does not trigger Airia and preserves the live cache',async()=>{
  let oracleReads=0,airiaCalls=0,pscCalls=0;
  const persisted={
    imo:'9328471',assessmentId:'d48953e9-344c-4c2b-83a2-bf305b624c63',
    status:'COMPLETED',score:60,level:'Watch',
    criticalOpenFinding:true,operationalPriority:'Priority Review',
    assessedAt:'2026-10-09T00:01:55.994Z'
  };
  const repository={loadLatest:async()=>{oracleReads++;return {'9328471':{...persisted}};}};
  const manager=new FleetAssessmentManager({
    repository,
    executeAgent:async()=>{airiaCalls++;throw Error('UNEXPECTED_AIRIA_CALL');},
    getPscVessel:async()=>{pscCalls++;throw Error('UNEXPECTED_PSC_CALL');}
  });
  manager.results={'9328471':{...persisted,score:20,level:'Normal',criticalOpenFinding:false}};
  const database=await manager.savedSnapshot();
  assert.equal(database.counts.assessed,1);
  assert.equal(database.counts.watch,1);
  assert.equal(database.counts.priorityReview,1);
  assert.equal(database.results['9328471'].score,60);
  assert.equal(manager.results['9328471'].score,20);
  assert.equal(oracleReads,1);
  assert.equal(airiaCalls,0);
  assert.equal(pscCalls,0);
});
