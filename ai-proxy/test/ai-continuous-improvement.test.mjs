import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {AiContinuousImprovementLedger,aggregateContinuousImprovement}
 from '../ai-continuous-improvement.mjs';

test('AI calls persist in POC volume without personal data or prompt payloads',()=>{
 const dir=mkdtempSync(join(tmpdir(),'ci-ledger-'));
 try{
  const file=join(dir,'events.json');
  const clock=()=>new Date('2026-10-17T08:00:00Z');
  const ledger=new AiContinuousImprovementLedger({file,clock});
  assert.equal(ledger.record({agent:'A01',domain:'NMC',result:'SUCCESS',
    prompt:'SECRET_PROMPT',apiKey:'SECRET_API_KEY',imo:'9328471'}),true);
  assert.equal(ledger.record({agent:'V01',domain:'SMART_INSPECTION',result:'FAILURE'}),true);
  assert.equal(ledger.record({agent:'NOT_AN_AGENT',domain:'NMC',result:'SUCCESS'}),false);
  const body=readFileSync(file,'utf8');
  assert.ok(!body.includes('SECRET_PROMPT'));
  assert.ok(!body.includes('SECRET_API_KEY'));
  assert.ok(!body.includes('9328471'));
  const snapshot=new AiContinuousImprovementLedger({file,clock}).snapshot(null);
  assert.equal(snapshot.calls.total,2);
  assert.equal(snapshot.calls.success,1);
  assert.equal(snapshot.calls.failed,1);
  assert.equal(snapshot.calls.successRate,50);
  assert.equal(snapshot.calls.byAgent.A01,1);
  assert.equal(snapshot.calls.byAgent.V01,1);
  assert.equal(snapshot.incidents.sourceAvailable,false);
  assert.equal(snapshot.incidents.modified,null);
  assert.deepEqual(snapshot.calls.monthly,[{name:'2026-10',count:2}]);
 }finally{rmSync(dir,{force:true,recursive:true});}
});
test('officer MODIFY and REJECT decisions count only source reviewed assessments',()=>{
 const incident=(decision,stale=false,status='HUMAN_REVIEWED')=>({
  aiAssessmentStale:stale,
  aiAssessment:{officerDecision:decision,assessmentStatus:status}
 });
 const s=aggregateContinuousImprovement([],[
   incident('ACCEPT'),incident('MODIFY'),incident('REJECT'),
   incident('MODIFY',true),incident('MODIFY',false,'PENDING_HUMAN_REVIEW'),
   incident(null)
 ]);
 assert.equal(s.incidents.sourceAvailable,true);
 assert.equal(s.incidents.reviewed,3);
 assert.equal(s.incidents.accepted,1);
 assert.equal(s.incidents.modified,1);
 assert.equal(s.incidents.rejected,1);
 assert.equal(s.incidents.overrideRate,66.7);
 assert.equal(s.incidents.aiAnalyzed,5);
 assert.equal(s.calls.total,0);
 assert.equal(s.calls.successRate,null);
});
test('unknown incident source is never represented as real zero officer modifications',()=>{
 const s=aggregateContinuousImprovement([],null);
 assert.equal(s.incidents.modified,null);
 assert.equal(s.incidents.accepted,null);
 assert.equal(s.incidents.overrideRate,null);
 assert.equal(s.completeness.globalAiriaHistory,false);
});
