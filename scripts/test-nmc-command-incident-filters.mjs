import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Exercise the SAME pure TypeScript helpers compiled by Angular, without a
// browser, Google Sheets, Oracle, credentials or any AI request.
const source=new URL('../src/app/services/nmc-incident-filters.ts',import.meta.url);
const js=ts.transpileModule(readFileSync(source,'utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
}).outputText;
const exports={};
vm.runInNewContext(js,{exports,console});
const {isActiveNmcIncident,incidentSeverityBand,
  incidentPendingHumanReview,vesselMatchesIncidentFilter}=exports;

const incident=(id,imo,status='RECEIVED',reportedSeverity='HIGH',extras={})=>({
  incidentId:id,imo,operationalStatus:status,reportedSeverity,
  aiAssessment:null,aiAssessmentStale:false,caseIncidentDecisionStatus:null,...extras
});
const a=incident('INC-POC-0001','9328471');
const b=incident('INC-POC-0003','9328471','UNDER_VERIFICATION','CRITICAL',
  {caseIncidentDecisionStatus:'PENDING_HUMAN_REVIEW'});
const c=incident('INC-POC-0002','9400409','RECEIVED','LOW',
  {aiAssessment:{incidentRiskBand:'HIGH',assessmentStatus:'ASSESSED'}});
const all=[a,b,c];

test('real fixture IMOs show 2 incident vessels, with 2 and 1 active reports',()=>{
  const imos=['9328471','9400409','9702281'];
  const grouped=Object.fromEntries(imos.map(imo=>[imo,all.filter(row=>row.imo===imo)]));
  const visible=imos.filter(imo=>vesselMatchesIncidentFilter('Active',grouped[imo]));
  assert.equal(visible.length,2);
  assert.equal(grouped['9328471'].length,2);
  assert.equal(grouped['9400409'].length,1);
  assert.equal(visible.includes('9702281'),false);
});

test('Critical and High use current incident-specific AI severity or clearly reported severity',()=>{
  assert.equal(incidentSeverityBand(b),'CRITICAL');
  assert.equal(incidentSeverityBand(c),'HIGH');
  assert.equal(vesselMatchesIncidentFilter('Critical',[a,b]),true);
  assert.equal(vesselMatchesIncidentFilter('High',[c]),true);
  assert.equal(vesselMatchesIncidentFilter('Critical',[c]),false);
  assert.equal(vesselMatchesIncidentFilter('High',[b]),false);
  assert.equal(incidentSeverityBand({...c,aiAssessmentStale:true}),'LOW');
  assert.equal(vesselMatchesIncidentFilter('High',[{...c,aiAssessmentStale:true}]),false);
});

test('Pending Human Review means actual officer-pending case or saved incident AI assessment',()=>{
  assert.equal(incidentPendingHumanReview(b),true);
  assert.equal(incidentPendingHumanReview(c),true);
  assert.equal(incidentPendingHumanReview(a),false);
  assert.equal(vesselMatchesIncidentFilter('PendingReview',[a,b]),true);
  assert.equal(vesselMatchesIncidentFilter('PendingReview',[c]),true);
  const done=incident('DONE','9400409','RECEIVED','HIGH',{
    caseIncidentDecisionStatus:'OFFICER_APPROVED',
    aiAssessment:{incidentRiskBand:'HIGH',assessmentStatus:'HUMAN_REVIEWED'}
  });
  assert.equal(vesselMatchesIncidentFilter('PendingReview',[done]),false);
});

test('closed/resolved incidents never bring an inactive vessel into the attention incident filter',()=>{
  const closed=incident('CLOSED1','9328471','CLOSED','CRITICAL');
  const resolved=incident('CLOSED2','9328471','RESOLVED','HIGH');
  assert.equal(isActiveNmcIncident(closed),false);
  assert.equal(isActiveNmcIncident(resolved),false);
  assert.equal(vesselMatchesIncidentFilter('Active',[closed,resolved]),false);
  assert.equal(vesselMatchesIncidentFilter('Critical',[closed]),false);
  assert.equal(vesselMatchesIncidentFilter('None',[closed,resolved]),true);
  assert.equal(vesselMatchesIncidentFilter('None',[a,b]),false);
  assert.equal(vesselMatchesIncidentFilter('All',[]),true);
});

test('regression: both map and attention must use the same incident filter',()=>{
  const component=readFileSync(new URL('../src/app/pages/nmc-command-center.component.ts',import.meta.url),'utf8');
  const template=readFileSync(new URL('../src/app/pages/nmc-command-center.component.html',import.meta.url),'utf8');
  assert.match(component,/matchesSearch && matchesRisk && matchesAssessment && matchesType &&\s*this\.matchesIncidentFilter\(vessel\.imo\)/);
  assert.match(component,/this\.matchesIncidentFilter\(v\.imo\)/);
  assert.match(component,/bActive-aActive \|\| bRank-aRank/);
  assert.match(template,/\[\(ngModel\)\]="incidentFilter"/);
  for(const option of ['All','Active','Critical','High','PendingReview','None'])
    assert.ok(template.includes('value="'+option+'"'),'Missing incident filter '+option);
  assert.match(template,/attention-incident-shortcut/);
  assert.match(template,/hasActiveIncidents\(vessel\.imo\)/);
});
