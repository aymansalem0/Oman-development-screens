import test from 'node:test';
import assert from 'node:assert/strict';
import {buildInspectionManagementView} from '../si-management-report.mjs';

const makeCase=(id,imo='9328471',regime='FOCUSED_INSPECTION')=>({
 id,imo,vesselName:'Test POC Vessel',regime,stage:'NOT_STARTED',risk:null,
 sourceEvents:[],updatedAt:'2026-10-01T12:00:00Z'
});
const entry=(caseId,{stage='CLOSED',imo='9328471',startedAt='2026-10-01T00:00:00Z',
 closedAt='2026-10-02T00:00:00Z',findings=[],actions=[],audit=[],inspector='Inspector-A'}={})=>({
 caseId,imo,stage,startedAt,closedAt,updatedAt:closedAt,
 findings,actions,audit,assignment:{inspector},version:8
});
const build=(cases,records,summary={candidateVessels:8,pendingVessels:5})=>
 buildInspectionManagementView({candidates:{summary},cases,records,
   at:'2026-10-12T08:00:00Z'});

test('empty POC: no invented cases, trend, averages, findings or overdue actions',()=>{
 const r=build([],{});
 assert.equal(r.kpis.approvedCases,0);
 assert.equal(r.kpis.closedCases,0);
 assert.equal(r.kpis.averageClosureHours,null);
 assert.equal(r.kpis.findings,0);
 assert.equal(r.recurringChecks.length,0);
 assert.equal(r.cases.length,0);
 assert.equal(r.autoAiCalls,false);assert.equal(r.mutations,false);
 assert.equal(r.kpis.uniqueCandidateVessels,8);
});
test('read-only stages, case counts and closed-case times only from original records',()=>{
 const cases=[makeCase('A'),makeCase('B'),makeCase('C')];
 const records={
   A:entry('A'),
   B:entry('B',{stage:'REPORT_PENDING_REVIEW',closedAt:null}),
   C:null
 };
 const r=build(cases,records);
 assert.equal(r.kpis.approvedCases,3);
 assert.equal(r.kpis.closedCases,1);
 assert.equal(r.kpis.inProgressCases,1);
 assert.equal(r.kpis.notStartedCases,1);
 assert.equal(r.kpis.pendingReportReview,1);
 assert.equal(r.kpis.averageClosureHours,24);
 assert.equal(r.kpis.timedClosedCases,1);
 assert.equal(r.byStage.find(x=>x.stage==='NOT_STARTED').count,1);
 assert.equal(r.workload[0].inspector,'Inspector-A');
 assert.equal(r.workload[0].assigned,1);
});
test('findings and overdue: only unverified actions with due day BEFORE current day',()=>{
 const cases=[makeCase('A')];
 const actions=[
  {id:'x1',status:'OPEN',dueDate:'2026-10-11'},
  {id:'x2',status:'VERIFIED',dueDate:'2026-10-01'},
  {id:'x3',status:'PENDING_VERIFICATION',dueDate:'2026-10-12'},
  {id:'x4',status:'REJECTED',dueDate:'2026-10-10'}
 ];
 const r=build(cases,{A:entry('A',{stage:'ACTIONS_OPEN',actions,findings:[
   {checkId:'fire-safety',title:'Fire',severity:'MAJOR'},
   {checkId:'certificates',title:'Certificates',severity:'CRITICAL'}
 ]})});
 assert.equal(r.kpis.findings,2);
 assert.equal(r.kpis.majorFindings,1);
 assert.equal(r.kpis.criticalFindings,1);
 assert.equal(r.kpis.openCorrectiveActions,3);
 assert.equal(r.kpis.overdueCorrectiveActions,2);
 assert.equal(r.cases[0].overdueActions,2);
 assert.equal(r.cases[0].openActions,3);
});
test('repeat deficiency means same check on same IMO in separate approved cases',()=>{
 const cases=[makeCase('A'),makeCase('B'),makeCase('C','9400409')];
 const f=checkId=>({checkId,title:checkId,severity:'MINOR'});
 const r=build(cases,{
  A:entry('A',{findings:[f('certificates'),f('fire-safety')]}),
  B:entry('B',{findings:[f('certificates')]}),
  C:entry('C',{imo:'9400409',findings:[f('certificates')]})
 });
 assert.equal(r.kpis.repeatDeficiencyVessels,1);
 assert.equal(r.kpis.repeatedVesselCheckPairs,1);
 assert.equal(r.recurringChecks[0].findings,3);
 assert.equal(r.recurringChecks[0].affectedVessels,2);
 assert.equal(r.recurringChecks[0].affectedCases,3);
});
test('unavailable candidate source is UNKNOWN, never represented as zero',()=>{
 const r=build([makeCase('A')],{},{
  candidateVessels:null,pendingVessels:null
 });
 assert.equal(r.kpis.uniqueCandidateVessels,null);
 assert.equal(r.kpis.pendingCandidateVessels,null);
 assert.equal(r.kpis.approvedCases,1);
});
test('historical returned report decisions survive later supervisor approval',()=>{
 const r=build([makeCase('A')],{A:entry('A',{
  stage:'REPORT_APPROVED',
  audit:[{action:'RETURN_REPORT'},{action:'SAVE_CHECKS'},
    {action:'SUBMIT_FIELD'},{action:'APPROVE_REPORT'}]})});
 assert.equal(r.kpis.returnedReports,1);
 assert.equal(r.kpis.pendingReportReview,0);
});
test('duplicate persistent case ids and unknown lifecycle stages fail closed',()=>{
 assert.throws(()=>build([makeCase('A'),makeCase('A')],{}),
   /SI_MANAGEMENT_DUPLICATE_CASE_ID/);
 assert.throws(()=>build([makeCase('A')],{A:entry('A',{stage:'INVENTED'})}),
   /SI_MANAGEMENT_UNKNOWN_STAGE/);
});
test('no rescore or AI semantics appear in management results',()=>{
 const r=build([makeCase('A')],{A:entry('A')});
 assert.match(r.source,/SAVED_SI_INSPECTION_LEDGER/);
 assert.match(r.dataNature,/SYNTHETIC_POC_NOT_OFFICIAL/);
 assert.equal(r.cases[0].priorityRisk,null);
 assert.deepEqual(Object.keys(r.kpis).includes('riskScore'),false);
});
