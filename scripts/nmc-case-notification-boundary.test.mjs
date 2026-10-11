import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const alertHtml=read('src/app/pages/nmc-alert-center.component.html');
const alertTs=read('src/app/pages/nmc-alert-center.component.ts');
const caseHtml=read('src/app/pages/nmc-case-workspace.component.html');
const caseTs=read('src/app/pages/nmc-case-workspace.component.ts');

test('Alerts inbox has receipt acknowledgment only, with no operational decision buttons',()=>{
  const controls=[...alertHtml.matchAll(/<button\b[\s\S]*?<\/button>/g)]
    .map(match=>match[0]).join('\n');
  assert.match(controls,/acknowledge\(alert\)/);
  assert.match(controls,/toggleDetails\(alert\)/);
  for(const forbidden of [
    'createCase(alert)','dismiss(alert)','START_FOLLOW_UP','ESCALATE',
    'RESOLVE','decision-panel','decision-actions','Operator note / resolution reason'
  ])assert.ok(!alertHtml.includes(forbidden),forbidden);
  assert.ok(!alertTs.includes('this.cases.createFromAlert('));
  assert.ok(!alertTs.includes("this.alerts.act(item,'ESCALATE'"));
  assert.ok(!alertTs.includes("this.alerts.act(item,'RESOLVE'"));
  assert.match(alertTs,/this\.alerts\.act\(item,'ACKNOWLEDGE',''\)/);
});

test('Alerts read-only details and navigation to separate Case Management remain',()=>{
  assert.match(alertHtml,/\['\/moei\/nmc\/vessel',alert\.imo,'case'\]/);
  assert.match(alertHtml,/linkedCase\(alert\)/);
  assert.match(alertHtml,/toggleDetails\(alert\)/);
  assert.match(alertHtml,/استلام التنبيه/);
  assert.match(alertHtml,/إدارة الحالات/);
  assert.match(alertHtml,/سجل الأنشطة/);
});

test('Case opening is explicit, acknowledged-alert-only and confirms A01 usage',()=>{
  assert.match(caseHtml,/createCaseFromAlert\(alert\)/);
  assert.match(caseTs,/\['ACKNOWLEDGED','IN_PROGRESS','ESCALATED'\]\.includes\(a\.status\)/);
  assert.match(caseTs,/createCaseFromAlert\(alert:NmcOperationalAlert\):void/);
  assert.match(caseTs,/window\.confirm\(this\.copy/);
  assert.match(caseTs,/this\.cases\.createFromAlert\(alert\.id\)/);
  assert.match(caseHtml,/توصيات الذكاء الاصطناعي/);
  assert.match(caseHtml,/فتح الحالة/);
});

test('Case creation preserves failed AI response and never substitutes fabricated actions',()=>{
  assert.match(caseTs,/response\.aiActionPlanStatus==='FAILED'/);
  assert.match(caseTs,/this\.centralError=this\.cases\.readableError/);
  assert.match(caseTs,/this\.applyCase\(response\.case\)/);
  assert.match(caseTs,/this\.centralBusy=true/);
  assert.match(caseTs,/this\.centralBusy=false/);
});
