import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateCaseAssessment,historicalApprovalValid} from '../case-source-provenance.mjs';

const saved=(id,score,assessedAt='2026-10-10T23:39:21.792Z')=>({
  assessmentId:id,imo:'9702281',score,level:'High',status:'COMPLETED',
  assessedAt,signals:Array.from({length:5},(_,i)=>({
    factor:'factor-'+i,severity:40,evidenceIds:['EV-ONE']
  }))
});
const originalId='834f549a-7c49-4840-b322-639b44e505ba';
const latestId='5508048e-1b76-46c7-b8b2-219d2cb0ce0f';
const caseRow={imo:'9702281',sourceAssessmentId:originalId,sourceScore:48,sourceLevel:'High'};

test('historical case remains anchored to 48 while current fleet has 50',()=>{
  const p=evaluateCaseAssessment(caseRow,saved(latestId,50),saved(originalId,48));
  assert.equal(p.ready,true);
  assert.equal(p.isHistorical,true);
  assert.equal(p.source.assessmentId,originalId);
  assert.equal(p.source.score,48);
  assert.equal(p.latestScore,50);
  assert.equal(p.requiresHistoricalAcknowledgement,true);
  assert.deepEqual(historicalApprovalValid(p),{
    ok:false,error:'CASE_HISTORICAL_ASSESSMENT_REVIEW_REQUIRED'
  });
  assert.deepEqual(historicalApprovalValid(p,{
    acknowledgeHistoricalAssessment:true,reviewedLatestAssessmentId:latestId
  }),{ok:true});
});

test('approval is invalid if latest assessment changed after human preview',()=>{
  const p=evaluateCaseAssessment(caseRow,saved('NEW-LATEST',52),saved(originalId,48));
  assert.deepEqual(historicalApprovalValid(p,{
    acknowledgeHistoricalAssessment:true,reviewedLatestAssessmentId:latestId
  }),{ok:false,error:'CASE_HISTORICAL_ASSESSMENT_CONTEXT_CHANGED'});
});

test('historical source mismatch never falls back to newer saved assessment',()=>{
  for(const bad of [
    null,saved(originalId,49),
    {...saved(originalId,48),imo:'9400409'},
    {...saved(originalId,48),signals:[]},
    {...saved('wrong-id',48)},
    {...saved(originalId,48),status:'FAILED'}
  ]){
    const p=evaluateCaseAssessment(caseRow,saved(latestId,50),bad);
    assert.equal(p.ready,false);
    assert.equal(p.source,null);
    assert.deepEqual(historicalApprovalValid(p),{
      ok:false,error:'CASE_SOURCE_ASSESSMENT_UNAVAILABLE'
    });
  }
});

test('current saved case assessment does not require historical consent',()=>{
  const c=saved(originalId,48);
  const p=evaluateCaseAssessment(caseRow,c);
  assert.equal(p.ready,true);
  assert.equal(p.isHistorical,false);
  assert.deepEqual(historicalApprovalValid(p),{ok:true});
});

test('legacy cases with null assessment id can be validated without inventing it',()=>{
  const c=saved(originalId,48);
  const p=evaluateCaseAssessment({...caseRow,sourceAssessmentId:null},c);
  assert.equal(p.ready,true);
  assert.equal(p.caseAssessmentId,null);
  assert.equal(p.isHistorical,false);
});

test('missing live current snapshot demands historical review rather than silent acceptance',()=>{
  const p=evaluateCaseAssessment(caseRow,null,saved(originalId,48));
  assert.equal(p.ready,true);
  assert.equal(p.isHistorical,true);
  assert.equal(p.latestAssessmentId,null);
  assert.deepEqual(historicalApprovalValid(p),{
    ok:false,error:'CASE_HISTORICAL_ASSESSMENT_REVIEW_REQUIRED'
  });
});

test('SI-origin reports without an AI baseline do not borrow the latest fleet score',()=>{
 const siCase={imo:'9400368',source:'SI_APPROVED_INSPECTION',
   sourceAssessmentId:null,sourceScore:null,sourceLevel:null};
 const unrelatedFleetAssessment={...saved(originalId,44),imo:'9400368'};
 const preview=evaluateCaseAssessment(siCase,unrelatedFleetAssessment);
 assert.equal(preview.ready,false);
 assert.equal(preview.source,null);
 assert.equal(preview.caseScore,null);
 assert.deepEqual(historicalApprovalValid(preview),{
   ok:false,error:'CASE_SOURCE_ASSESSMENT_UNAVAILABLE'});
});
