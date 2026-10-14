import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {SETTINGS_DESCRIPTORS} from '../runtime-settings.mjs';

const uiPath=fileURLToPath(new URL(
 '../../src/app/pages/nmc-runtime-settings.component.ts',import.meta.url));
const ui=readFileSync(uiPath,'utf8');
const start=ui.indexOf('export const AI_GOVERNANCE_SECTIONS=[');
const end=ui.indexOf('] as const;',start);

test('AI Governance displays each backend runtime setting exactly once under named agents',()=>{
 assert.ok(start>=0&&end>start,'agent registry must be declared explicitly');
 const catalog=ui.slice(start,end);
 const found=[...catalog.matchAll(/keys:\[([^\]]*)\]/gs)].flatMap(m=>
  [...m[1].matchAll(/'([^']+)'/g)].map(x=>x[1]));
 const actual=SETTINGS_DESCRIPTORS.map(d=>d.key);
 assert.equal(found.length,actual.length,'every existing runtime setting is visible');
 assert.deepEqual([...found].sort(),[...actual].sort(),
  'new or removed backend settings must be assigned a UI section explicitly');
 assert.equal(new Set(found).size,found.length,
  'no duplicated agent setting can be silently edited from two different sections');
 for(const id of ['agent-a01','agent-a02','agent-a03','agent-a04',
   'agent-dq01','agent-c01','agent-p01','agent-s01','agent-v01','agent-r01',
   'agent-x01','agent-checklist-builder','agent-checklist-vision',
   'agent-conversational-si','agent-nmc-desk','agent-sdb'])
  assert.ok(catalog.includes("id:'"+id+"'"),id+' must have its own visible heading');
 assert.match(ui,/\*ngFor="let group of groups"/);
 assert.match(ui,/<details \*ngFor/);
 assert.match(ui,/snapshot\.descriptors\.find\(d=>d\.key===key\)/);
 assert.match(ui,/\/api\/ai\/admin\/runtime-settings/);
 assert.match(ui,/\/api\/ai\/admin\/governance\/credentials/);
});

test('Governance isolates shared fleet, provider, alert and connectivity settings',()=>{
 const catalog=ui.slice(start,end);
 for(const id of ['platform-orchestration','platform-fleet','platform-alerts',
   'platform-connectivity'])
  assert.ok(catalog.includes("id:'"+id+"'"));
 assert.ok(catalog.includes("'SI_AI_PROVIDER'"));
 assert.ok(catalog.includes("'AIRIA_TIMEOUT_MS'"));
 assert.ok(catalog.includes("'NMC_FLEET_AUTO_MAX_VESSELS'"));
 assert.match(ui,/draft\[item\.key\]/,'editable values must remain bound to original persisted keys');
 assert.match(ui,/expectedVersion:this\.snapshot\.version/,'optimistic publish version unchanged');
});
