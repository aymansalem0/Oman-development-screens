import test from 'node:test';
import assert from 'node:assert/strict';
import {SiIntegratedDraftJobs} from '../si-integrated-draft-jobs.mjs';

const wait=()=>new Promise(r=>setImmediate(r));
const examplePreview={previewId:'draft-preview-123',selectedCount:12,
 feasibleCount:10,unscheduledCount:2};
const args=(execute,overrides={})=>({
 actor:'admin@moei.example',sourceHash:'e'.repeat(64),
 metadata:{title:'October capacity plan',startsOn:'2026-10-16',
  endsOn:'2026-10-22',demoMode:true},
 expectedBatches:5,execute,...overrides
});
const silent={error(){}};
test('POST-style queued C01 job returns immediately; GET polling never invokes extra paid batches',async()=>{
 const m=new SiIntegratedDraftJobs({logger:silent});
 let release,paidCalls=0;
 const pending=new Promise(r=>{release=r;});
 const run=async report=>{
  paidCalls++;
  report({completedBatches:1,batchCount:5});
  await pending;
  report({completedBatches:5,batchCount:5});
  return examplePreview;
 };
 const created=m.start(args(run));
 assert.equal(created.status,'QUEUED');
 assert.ok(/^[a-f0-9-]{36}$/.test(created.jobId));
 const duplicated=m.start(args(run));
 assert.equal(duplicated.jobId,created.jobId);
 await wait();
 const progress=m.view(m.get(created.jobId,'admin@moei.example'));
 assert.equal(progress.status,'RUNNING');
 assert.equal(progress.completedBatches,1);
 assert.equal(paidCalls,1);
 for(let i=0;i<3;i++)m.get(created.jobId,'admin@moei.example');
 assert.equal(paidCalls,1,'GET must be read-only');
 release();await wait();await wait();
 const done=m.view(m.get(created.jobId,'admin@moei.example'));
 assert.equal(done.status,'COMPLETED');
 assert.equal(done.preview.previewId,examplePreview.previewId);
 assert.equal(done.completedBatches,5);
 assert.equal(m.start(args(run)).jobId,created.jobId,
  'identical, recently completed paid job must be reusable');
 assert.equal(paidCalls,1);
 assert.throws(()=>m.get(created.jobId,'other@moei.example'),
  /SI_DRAFT_JOB_NOT_FOUND_OR_EXPIRED/);
});
test('C01 failed batches return diagnostic codes with no raw Airia payload or secrets',async()=>{
 const m=new SiIntegratedDraftJobs({logger:silent});
 const run=async report=>{
  report({completedBatches:2});
  const e=new Error('RAW UPSTREAM KEY sk_secret_do_not_echo');
  e.code='SI_C01_NO_VERIFIED_RECOMMENDATIONS';
  e.batchIndex=3;e.batchCount=5;
  e.expectedCount=25;e.returnedCount=1;
  e.diagnosticCode='RECOMMENDATION_ITEM_SHAPE';
  e.failureCounts={RECOMMENDATION_ITEM_SHAPE:11,secret:'raw-details'};
  throw e;
 };
 const initial=m.start(args(run));
 await wait();await wait();
 const result=m.view(m.get(initial.jobId,'admin@moei.example'));
 assert.equal(result.status,'FAILED');
 assert.equal(result.error,'SI_C01_NO_VERIFIED_RECOMMENDATIONS');
 assert.equal(result.completedBatches,2);
 assert.equal(result.batchIndex,3);
 assert.equal(result.batchCount,5);
 assert.equal(result.expectedCount,25);
 assert.equal(result.returnedCount,1);
 assert.equal(result.failureCounts.RECOMMENDATION_ITEM_SHAPE,11);
 assert.equal(result.failureCounts.secret,undefined);
 assert.doesNotMatch(JSON.stringify(result),/sk_secret|raw-details/);
});
test('server-generated exception detail is suppressed for unexpected errors',async()=>{
 const m=new SiIntegratedDraftJobs({logger:silent});
 const first=m.start(args(async()=>{throw new Error('private bad response');}));
 await wait();await wait();
 const data=m.view(m.get(first.jobId,'admin@moei.example'));
 assert.equal(data.status,'FAILED');
 assert.equal(data.error,'SI_DRAFT_INTERNAL_PROCESSING_ERROR');
 assert.doesNotMatch(JSON.stringify(data),/private bad response/);
});
test('running jobs are not garbage collected while charged Airia is active',async()=>{
 let now=0;let done;
 const promise=new Promise(r=>{done=r;});
 const m=new SiIntegratedDraftJobs({clock:()=>now,ttlMs:10,logger:silent});
 const p=m.start(args(async()=>promise));
 await wait();now=2000;m.cleanup();
 assert.equal(m.get(p.jobId,'admin@moei.example').status,'RUNNING');
 done(examplePreview);await wait();await wait();
 now=2020;m.cleanup();
 assert.throws(()=>m.get(p.jobId,'admin@moei.example'),
  /SI_DRAFT_JOB_NOT_FOUND_OR_EXPIRED/);
});
