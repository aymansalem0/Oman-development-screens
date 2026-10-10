/**
 * NMC Smart Inspection POC: deterministic, human-approved inspection slots.
 * This module does not call Airia or alter saved fleet/AI assessments.
 * Times are stored as UTC ISO instants. A valid assignment reserves the
 * inspector/team for the whole interval, not just the start minute.
 */
const permittedDurations=new Set([30,60,90,120,150,180,210,240]);
const shortText=(x,max)=>typeof x==='string'&&x.trim().length>0&&
  x.trim().length<=max&&x.trim().length>=2;
const identity=x=>String(x||'').trim().replace(/\s+/g,' ').toLocaleLowerCase('en-US');

export class InspectionScheduleError extends Error{
  constructor(code,status=400){super(code);this.code=code;this.status=status;}
}
export function normalizeInspectionSlot(input,clock=Date.now()){
  const {scheduledAt,port,inspector}=input||{};
  const durationMinutes=input?.durationMinutes??60;
  // Enforce explicit UTC or offset. The Angular datetime-local value must
  // be converted with new Date(localValue).toISOString() before transmission.
  if(typeof scheduledAt!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/.test(scheduledAt)||
     !Number.isFinite(Date.parse(scheduledAt))||Date.parse(scheduledAt)<=clock||
     !shortText(port,120)||!shortText(inspector,120)||
     !Number.isInteger(durationMinutes)||!permittedDurations.has(durationMinutes))
    throw new InspectionScheduleError('CASE_SCHEDULE_INVALID');
  const start=Date.parse(scheduledAt);
  return {
    scheduledAt:new Date(start).toISOString(),
    scheduledEndAt:new Date(start+durationMinutes*60000).toISOString(),
    durationMinutes,
    port:port.trim().replace(/\s+/g,' '),
    inspector:inspector.trim().replace(/\s+/g,' ')
  };
}
export function overlappingInspectorAppointments(referrals,slot,excludeRequestId=null){
  const start=Date.parse(slot.scheduledAt);
  const end=Date.parse(slot.scheduledEndAt);
  return referrals.filter(r=>{
    if(r.id===excludeRequestId||r.status!=='SCHEDULED'||
       identity(r.inspector)!==identity(slot.inspector))return false;
    const otherStart=Date.parse(r.scheduledAt||'');
    if(!Number.isFinite(otherStart))return false;
    const otherEnd=Number.isFinite(Date.parse(r.scheduledEndAt||''))
      ?Date.parse(r.scheduledEndAt):otherStart+60*60000; // legacy 60m slots
    return start<otherEnd&&otherStart<end;
  });
}
export function scheduleSummary(referrals,clock=Date.now()){
  const summary={pending:0,upcoming:0,completed:0,elapsedUncompleted:0};
  for(const r of referrals){
    if(r.status==='PENDING_SCHEDULING')summary.pending++;
    if(r.status==='COMPLETED')summary.completed++;
    if(r.status==='SCHEDULED'){
      if(Date.parse(r.scheduledEndAt||'')>clock ||
         (!r.scheduledEndAt&&Date.parse(r.scheduledAt||'')+3600000>clock))summary.upcoming++;
      else summary.elapsedUncompleted++;
    }
  }
  return summary;
}
