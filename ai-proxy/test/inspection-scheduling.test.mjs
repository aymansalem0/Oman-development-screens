import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {NmcAlertWorkspace} from '../alert-workspace.mjs';
import {NmcCaseWorkspace} from '../case-workspace.mjs';
import {normalizeInspectionSlot,overlappingInspectorAppointments,scheduleSummary} from '../inspection-scheduling.mjs';

const inHours=n=>new Date(Date.now()+n*3600000).toISOString();
test('electronic appointment validates timezone, future, inspector, port, duration and calculates UTC end',()=>{
  const start=inHours(24);
  const slot=normalizeInspectionSlot({scheduledAt:start,port:' Jebel Ali ',
    inspector:'  Inspector   Team A  ',durationMinutes:90});
  assert.equal(slot.port,'Jebel Ali');
  assert.equal(slot.inspector,'Inspector Team A');
  assert.equal(Date.parse(slot.scheduledEndAt)-Date.parse(slot.scheduledAt),90*60000);
  assert.throws(()=>normalizeInspectionSlot({scheduledAt:'2026-12-01T10:00',port:'Jebel Ali',
    inspector:'Team A'}),/CASE_SCHEDULE_INVALID/); // no explicit timezone
  assert.throws(()=>normalizeInspectionSlot({scheduledAt:'2020-01-01T00:00:00Z',port:'Jebel Ali',
    inspector:'Team A'}),/CASE_SCHEDULE_INVALID/);
  assert.throws(()=>normalizeInspectionSlot({scheduledAt:start,port:'Jebel Ali',
    inspector:'Team A',durationMinutes:37}),/CASE_SCHEDULE_INVALID/);
});
test('overlapping intervals conflict by normalized team, not by port, and touching boundaries do not overlap',()=>{
  const slot=normalizeInspectionSlot({scheduledAt:inHours(24),port:'Khalifa Port',
    inspector:'INSPECTOR  TEAM A',durationMinutes:90});
  const old={id:'REQ-1',status:'SCHEDULED',inspector:'Inspector Team A',
    scheduledAt:new Date(Date.parse(slot.scheduledAt)-15*60000).toISOString(),
    scheduledEndAt:new Date(Date.parse(slot.scheduledAt)+45*60000).toISOString()};
  const boundary={...old,id:'REQ-2',scheduledAt:slot.scheduledEndAt,
    scheduledEndAt:new Date(Date.parse(slot.scheduledEndAt)+3600000).toISOString()};
  const completed={...old,id:'REQ-3',status:'COMPLETED'};
  assert.deepEqual(overlappingInspectorAppointments([old,boundary,completed],slot).map(r=>r.id),['REQ-1']);
  assert.equal(scheduleSummary([old,boundary,completed,{status:'PENDING_SCHEDULING'}]).pending,1);
});
test('POC central case scheduling serializes overlapping submissions without Airia or overwriting source risk',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'nmc-schedule-'));
  try{
    const file=join(dir,'cases.json');
    const makeCase=(imo)=>{
      const id=randomUUID(),rid=randomUUID();
      return {id,imo,sourceScore:61,sourceLevel:'Watch',status:'OPEN',
        version:1,createdAt:inHours(-24),updatedAt:inHours(-24),
        tasks:[],actionPlan:{},inspectionRequests:[{id:rid,caseId:id,imo,
          status:'PENDING_SCHEDULING',version:1,createdAt:inHours(-24)}]};
    };
    const a=makeCase('9328471'),b=makeCase('9781207');
    writeFileSync(file,JSON.stringify({schema:1,cases:{[a.id]:a,[b.id]:b},
      history:{[a.id]:[],[b.id]:[]}}));
    const alerts=new NmcAlertWorkspace({mode:'json',file:join(dir,'alerts.json')});
    const cases=new NmcCaseWorkspace({mode:'json',file,alerts});
    const start=inHours(48),slot={scheduledAt:start,port:'Jebel Ali',
      inspector:'Team Alpha',durationMinutes:120};
    const [first,second]=await Promise.allSettled([
      cases.scheduleInspection(a.id,1,a.inspectionRequests[0].id,slot),
      cases.scheduleInspection(b.id,1,b.inspectionRequests[0].id,
        {...slot,inspector:'TEAM  ALPHA',port:'Khalifa Port'})
    ]);
    assert.equal(first.status,'fulfilled');
    assert.equal(second.status,'rejected');
    assert.equal(second.reason.code,'INSPECTION_INSPECTOR_SLOT_CONFLICT');
    assert.equal((await cases.inspectionAvailability(slot)).available,false);
    assert.equal((await cases.inspectionAvailability({...slot,inspector:'Team Beta'})).available,true);
    assert.equal((await cases.get(a.id)).sourceScore,61);
    assert.equal((await cases.get(b.id)).inspectionRequests[0].status,'PENDING_SCHEDULING');
    const alternative=await cases.scheduleInspection(b.id,1,b.inspectionRequests[0].id,
      {...slot,inspector:'Team Beta'});
    assert.equal(alternative.inspectionRequests[0].status,'SCHEDULED');
    assert.equal(alternative.inspectionRequests[0].durationMinutes,120);
    assert.equal((await cases.history(b.id))[0].action,'INSPECTION_SCHEDULED');
  }finally{rmSync(dir,{recursive:true,force:true});}
});
