import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const root=new URL('../../',import.meta.url);
const read=path=>readFileSync(fileURLToPath(new URL(path,root)),'utf8');
const map=read('src/app/pages/nmc-command-center.component.ts');
const mapHtml=read('src/app/pages/nmc-command-center.component.html');
const vessel=read('src/app/pages/nmc-vessel-360.component.ts');
const vesselHtml=read('src/app/pages/nmc-vessel-360.component.html');

test('Incident / Accident filter is an independent source category alongside vessel risk statuses',()=>{
 assert.match(mapHtml,/<option value="Critical">/);
 assert.match(mapHtml,/<option value="High">/);
 assert.match(mapHtml,/<option value="Normal">/);
 assert.match(mapHtml,/<option value="Incident">/);
 assert.match(map,/this\.riskFilter === 'Incident'\s*\? this\.hasActiveIncidents\(vessel\.imo\)/);
 assert.match(map,/this\.riskFilter!=='Incident'\|\|this\.hasActiveIncidents\(v\.imo\)/);
 assert.match(map,/if\(\['CLOSED','RESOLVED'\]\.includes\(report\.operationalStatus\)\)continue;/);
 assert.match(map,/if\(!report\.imo\|\|!\(\/\^\[0-9\]\{7\}\$\/\)\.test\(report\.imo\)\)continue;/);
 assert.match(mapHtml,/vessels with active reported incidents\/accidents/);
});
test('Correlated sources come from real POC API reads and leave missing services unavailable',()=>{
 assert.match(vessel,/this\.incidentsService\.list\(\)/);
 assert.match(vessel,/this\.casesService\.list\(\)/);
 assert.match(vessel,/this\.externalPscService\.getVessel\(this\.vessel\.imo\)/);
 assert.match(vessel,/this\.documentsService\.list\(this\.vessel\.imo\)/);
 assert.match(vessel,/SYNTHETIC_PSC_GOOGLE/);
 assert.match(vessel,/SYNTHETIC_INCIDENT_GOOGLE/);
 assert.match(vessel,/NMC_POC_CASE/);
 assert.match(vessel,/Google Drive Vessel Documents/);
 assert.match(vessel,/Smart Inspection Referrals/);
 assert.match(vessel,/status:'Unavailable'/);
 assert.match(vessel,/lastSync:'—',confidence:null/);
 assert.match(vesselHtml,/source\.dataNature/);
 assert.match(vesselHtml,/source\.recordId/);
 assert.match(vesselHtml,/source\.route/);
 assert.match(vesselHtml,/Refresh sources/);
});
test('Conflicts are based on saved cross-source mismatches, never synthetic risk threshold',()=>{
 const start=vessel.indexOf('  private buildSources(): SourceStatus[] {');
 const end=vessel.indexOf('  private buildRiskFactors(): RiskFactor[] {',start);
 assert.ok(start>=0&&end>start);
 const body=vessel.slice(start,end);
 assert.match(body,/fieldComparisons/);
 assert.match(body,/f\.status==='MISMATCH'/);
 assert.match(body,/f\.internalValue\.trim\(\)\.length>0/);
 assert.match(body,/f\.externalValue\.trim\(\)\.length>0/);
 assert.match(body,/mismatches\.length\?'Conflict':'Available'/);
 assert.doesNotMatch(body,/hasCertificateConflict|vessel\.risk\s*[><=]/);
 assert.doesNotMatch(body,/22:42:|22:41:|22:40:/);
 assert.doesNotMatch(body,/confidence:\s*100|confidence:\s*95/);
});
test('Opening sources is read-only and cannot bill Airia or modify ministry records',()=>{
 const block=vessel.slice(vessel.indexOf('  private loadDriveSources():void{'),
   vessel.indexOf('  loadExternalPsc(): void {'));
 assert.match(block,/documentsService\.list/);
 assert.match(block,/incidentsService\.list/);
 assert.match(block,/casesService\.list/);
 assert.doesNotMatch(block,/\.analyze\(|\.review\(|\.publish\(|\.apply\(/);
 assert.match(vesselHtml,/Last read/);
 assert.match(vesselHtml,/not live official integrations/);
});

test('every dataNature literal inside buildSources belongs to the SourceStatus TypeScript union',()=>{
 const declaration=vessel.match(/interface SourceStatus\s*\{[\s\S]*?dataNature:([\s\S]*?);/);
 assert.ok(declaration,'SourceStatus.dataNature definition required');
 const accepted=new Set([...declaration[1].matchAll(/'([^']+)'/g)].map(m=>m[1]));
 const start=vessel.indexOf('  private buildSources(): SourceStatus[] {');
 const end=vessel.indexOf('  private buildRiskFactors(): RiskFactor[] {',start);
 assert.ok(start>=0&&end>start);
 const types=[...vessel.slice(start,end).matchAll(/dataNature:'([^']+)'/g)].map(m=>m[1]);
 assert.ok(types.length>=6,'expected static and connected source origin tags');
 for(const type of types)
   assert.ok(accepted.has(type),'Undeclared dataNature '+type+' breaks Angular production build');
 assert.ok(accepted.has('SYNTHETIC_DRIVE_GOOGLE'),'Google Drive source type must be declared');
 assert.ok(!types.includes('SYNTHETIC_POC'),
   'Generic SYNTHETIC_POC is not an allowed SourceStatus provenance type');
});
