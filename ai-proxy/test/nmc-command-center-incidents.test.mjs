import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const root=new URL('../../',import.meta.url);
const ts=readFileSync(fileURLToPath(new URL('src/app/pages/nmc-command-center.component.ts',root)),'utf8');
const html=readFileSync(fileURLToPath(new URL('src/app/pages/nmc-command-center.component.html',root)),'utf8');
const css=readFileSync(fileURLToPath(new URL('src/app/pages/nmc-command-center.component.css',root)),'utf8');
const policy=readFileSync(fileURLToPath(new URL('src/app/services/nmc-incident-filters.ts',root)),'utf8');

// Runtime smoke tests extract pure TS function bodies without importing
// Angular or requiring the root Angular build dependencies in ai-proxy CI.
function bodyOf(source,signature){
 const start=source.indexOf(signature);
 assert.ok(start>=0,'Missing method or policy function: '+signature);
 const open=source.indexOf('{',start+signature.length);
 assert.ok(open>=0);
 let depth=0;
 for(let i=open;i<source.length;i++){
  if(source[i]==='{')depth++;
  else if(source[i]==='}'&&!--depth)return source.slice(open+1,i);
 }
 throw Error('Unbalanced function: '+signature);
}
const verifiedIncidentBand=new Function('row',bodyOf(policy,
  'export function incidentSeverityBand(row:NmcMaritimeIncident):IncidentSeverityBand'));
const asFn=(signature,args)=>new Function('verifiedIncidentBand',
  'return function('+args.join(',')+') {'+bodyOf(ts,signature)+'}'
)(verifiedIncidentBand);
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
 assert.ok(css.includes('.ship-symbol path:first-child') && css.includes('fill:var(--event-color)'), 'incident severity colors the vessel symbol');
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
  incidentSeverityRank:r=>rank.call({incidentSeverityBand:band},r),
  matchesIncidentFilter:()=>true
 };
 assert.deepEqual(attention.call(ctx).map(v=>v.imo).sort(),['9328471','9404090']);
 assert.match(ts,/\!\(\/\^\[0-9\]\{7\}\$\/\)\.test\(report\.imo\)/);
 assert.match(ts,/!isActiveNmcIncident\(report\)/);
 assert.match(policy,/\['CLOSED','RESOLVED'\]\.includes/);
});
