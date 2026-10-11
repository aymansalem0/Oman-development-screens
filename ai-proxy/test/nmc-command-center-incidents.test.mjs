import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const root=new URL('../../',import.meta.url);
const ts=readFileSync(fileURLToPath(new URL('src/app/pages/nmc-command-center.component.ts',root)),'utf8');
const html=readFileSync(fileURLToPath(new URL('src/app/pages/nmc-command-center.component.html',root)),'utf8');
const css=readFileSync(fileURLToPath(new URL('src/app/pages/nmc-command-center.component.css',root)),'utf8');

// Extract the actual simple TypeScript method *body* for a runtime Node smoke test
// without importing Angular packages in the backend test suite.
function methodBody(signature){
 const start=ts.indexOf(signature);
 assert.ok(start>=0,'Missing command-center method: '+signature);
 const open=ts.indexOf('{',start+signature.length);
 assert.ok(open>=0);
 let depth=0;
 for(let i=open;i<ts.length;i++){
  if(ts[i]==='{')depth++;
  else if(ts[i]==='}'&&!--depth)return ts.slice(open+1,i);
 }
 throw Error('Unbalanced method: '+signature);
}
const asFn=(signature,args)=>new Function(...args,methodBody(signature));
const band=asFn('incidentSeverityBand(row:NmcMaritimeIncident):',['row']);
const rank=asFn('incidentSeverityRank(row:NmcMaritimeIncident):',['row']);
const forVessel=asFn('incidentsForVessel(imo:string):',['imo']);
const representative=asFn('incidentRepresentative(imo:string):',['imo']);
const cls=asFn('incidentClass(imo:string):',['imo']);
const attention=asFn('get allAttentionVessels():',['__unused__']);

test('Commands remain centered on original summary and attention list, without incident card wall',()=>{
 assert.doesNotMatch(html,/nmc-incidents-operational|nmc-incident-records/);
 assert.match(html,/nmc-incident-ribbon/);
 assert.match(html,/attention-incident-button/);
 assert.match(html,/attention-incident-details/);
 assert.match(html,/incident\.description|report\.description/);
 assert.match(html,/incident-map-legend/);
 assert.match(ts,/incident-outer-ring/);
 assert.match(css,/incident-outer-ring/);
});
test('AI scoring wins only when fresh; reported severity is not called AI when unassessed',()=>{
 const ai={reportedSeverity:'LOW',aiAssessment:{incidentRiskBand:'CRITICAL'},aiAssessmentStale:false};
 assert.equal(band(ai),'CRITICAL');
 assert.equal(rank.call({incidentSeverityBand:band},ai),4);
 assert.equal(band({...ai,aiAssessmentStale:true}),'LOW');
 assert.equal(band({reportedSeverity:'HIGH',aiAssessment:null}),'HIGH');
 assert.equal(band({reportedSeverity:'MEDIUM',aiAssessment:null}),'MODERATE');
 assert.equal(band({reportedSeverity:'NOT_SPECIFIED',aiAssessment:null}),'UNASSESSED');
});
test('Multiple active source incidents on same IMO yield a single marker with worst-severity ring',()=>{
 const incidentHigh={incidentId:'INC-POC-0001',reportedSeverity:'HIGH',aiAssessment:null};
 const incidentLow={incidentId:'INC-POC-0003',reportedSeverity:'LOW',aiAssessment:null};
 const ctx={activeIncidentsByImo:new Map([['9328471',[incidentHigh,incidentLow]]])};
 ctx.incidentsForVessel=imo=>forVessel.call(ctx,imo);
 ctx.incidentRepresentative=imo=>representative.call(ctx,imo);
 ctx.incidentSeverityBand=band;
 assert.equal(cls.call(ctx,'9328471'),'incident-high');
 assert.equal(cls.call(ctx,'9404090'),'');
 assert.equal(forVessel.call(ctx,'9328471').length,2);
});
test('Active incident vessel remains in attention list even when official fleet risk is pending',()=>{
 const vessel1={id:1,imo:'9328471',risk:-1};
 const vessel2={id:2,imo:'9404090',risk:60};
 const ctx={
  vessels:[vessel1,vessel2],
  hasSavedFleetAttention:v=>v.risk>=0,
  hasActiveIncidents:imo=>imo==='9328471',
  fleetResult:()=>null,
  incidentRepresentative:imo=>imo==='9328471'?{reportedSeverity:'HIGH',aiAssessment:null}:null,
  incidentSeverityRank:r=>rank.call({incidentSeverityBand:band},r)
 };
 assert.deepEqual(attention.call(ctx).map(v=>v.imo).sort(),['9328471','9404090']);
 assert.match(ts,/\!\(\/\^\[0-9\]\{7\}\$\/\)\.test\(report\.imo\)/);
 assert.match(ts,/\['CLOSED','RESOLVED'\]\.includes\(report\.operationalStatus\)/);
});
