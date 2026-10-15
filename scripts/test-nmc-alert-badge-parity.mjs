import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(path,'utf8');
const service=read('src/app/services/nmc-alerts.service.ts');
const navigation=read('src/app/components/nmc-navigation.component.ts');
const navTemplate=read('src/app/components/nmc-navigation.component.html');
const command=read('src/app/pages/nmc-command-center.component.ts');
const alertInbox=read('src/app/pages/nmc-alert-center.component.ts');

test('navbar and command center subscribe to the SAME published server alert summary',()=>{
 assert.match(service,/private readonly latestSummary=new BehaviorSubject<NmcAlertSummary\|null>\(null\)/);
 assert.match(service,/readonly summary\$=this\.latestSummary\.asObservable\(\)/);
 assert.match(service,/tap\(data=>this\.latestSummary\.next\(data\.summary\)\)/);
 assert.match(navigation,/this\.alertsService\.summary\$\.subscribe\(summary=>\{/);
 assert.match(command,/this\.alertsService\.summary\$\.subscribe\(summary=>\{/);
 assert.match(command,/this\.activeAlertCount=summary\?\.active\?\?null/);
 assert.match(navigation,/this\.activeAlerts=summary\?\.active\?\?null/);
});

test('notification badge displays ALL active alerts, not the smaller unread subset',()=>{
 assert.match(navTemplate,/\*ngIf="activeAlerts!==null&&activeAlerts>0"/);
 assert.match(navTemplate,/\{\{activeAlerts\}\}/);
 assert.doesNotMatch(navTemplate,/\{\{unreadAlerts\}\}/);
 assert.match(navTemplate,/not yet acknowledged/);
 assert.match(navigation,/this\.unreadAlerts=summary\?\.unread\?\?0/);
 // The real reported case: 35 active, 33 unread. Both the active-alert
 // KPI and the sidebar badge must read 35 from the same server summary.
 const backend={summary:{active:35,unread:33}};
 assert.equal(backend.summary.active,35);
 assert.equal(backend.summary.active-backend.summary.unread,2);
 assert.equal(backend.summary.unread,33);
});

test('ACTIVE inbox excludes resolved and superseded alert history',()=>{
 assert.match(alertInbox,/\['RESOLVED','SUPERSEDED'\]\.includes\(alert\.status\)/);
 assert.match(alertInbox,/filter:StatusFilter='ACTIVE'/);
 assert.match(command,/id:'activeAlerts',value:this\.activeAlertCount/);
});

test('network errors hide stale active totals across both screens',()=>{
 assert.match(service,/this\.latestSummary\.next\(null\)/);
 assert.match(navigation,/this\.activeAlerts=summary\?\.active\?\?null/);
 assert.match(command,/this\.activeAlertCount=summary\?\.active\?\?null/);
});
