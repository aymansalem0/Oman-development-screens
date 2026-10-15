/**
 * Read-only vessel visit-window eligibility against an execution plan.
 * Distinguishes source-confirmed ETA / ETD from missing evidence. Vessel
 * inclusion is NOT inspection approval and this module never amends sources.
 * All comparisons use UAE (+04:00) calendar boundaries, not server timezone.
 */
import {isSiVerifiedEvent} from './si-candidate-targeting.mjs';
const DAY=86400000;
const day=raw=>typeof raw==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(raw)&&
 Number.isFinite(Date.parse(raw+'T00:00:00+04:00'));
const localMs=raw=>{
 if(typeof raw!=='string'||!raw)return NaN;
 const s=raw.trim().replace(' ','T');
 if(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(s))
  return Date.parse(s+'+04:00');
 return /(?:Z|[+-]\d{2}:\d{2})$/.test(s)?Date.parse(s):NaN;
};
export function checkVesselPlanPeriod(vessel,period){
 if(!day(period?.startsOn)||!day(period?.endsOn)||
  period.endsOn<period.startsOn)
  throw new Error('SI_EXECUTION_PLAN_PERIOD_INVALID');
 const begin=Date.parse(period.startsOn+'T00:00:00+04:00');
 const finish=Date.parse(period.endsOn+'T00:00:00+04:00')+DAY;
 const events=(vessel?.sourceEvents||vessel?.events||[])
  .filter(isSiVerifiedEvent);
 const confirmed=events.flatMap(e=>{
  // Source recorded departureAt is UTC with offset. ETA is UAE-local MSW.
  const arrival=localMs(e.eta);
  const departure=localMs(e.departureAt);
  if(!Number.isFinite(arrival)&&!Number.isFinite(departure))return [];
  if(Number.isFinite(arrival)&&Number.isFinite(departure)&&arrival>departure)
   return [{kind:'SOURCE_DATES_CONFLICT',eventRef:e.sourceReference||null}];
  return [{kind:arrival>=finish?'ARRIVAL_AFTER_PLAN_END':
     departure<=begin?'DEPARTURE_BEFORE_PLAN_START':'OVERLAPPING_WINDOW',
    arrival:Number.isFinite(arrival)?arrival:null,
    departure:Number.isFinite(departure)?departure:null,
    eventRef:e.sourceReference||null}];
 });
 if(confirmed.some(x=>x.kind==='OVERLAPPING_WINDOW'))
  return {status:'WITHIN_SOURCE_WINDOW',reasonCode:null,
   firstSourceRef:confirmed.find(x=>x.kind==='OVERLAPPING_WINDOW').eventRef,
   planStartsOn:period.startsOn,planEndsOn:period.endsOn};
 if(!confirmed.length||confirmed.some(x=>x.kind==='SOURCE_DATES_CONFLICT'))
  return {status:'NEEDS_CAPACITY_CHECK',reasonCode:confirmed.length?
   'SOURCE_DATES_CONFLICT':'VISIT_WINDOW_NOT_CONFIRMED',
   firstSourceRef:confirmed[0]?.eventRef||null,
   planStartsOn:period.startsOn,planEndsOn:period.endsOn};
 // If different verified source events contradict each other (some suggest
 // earlier departure, some later arrival), require review, not a false block.
 const kinds=new Set(confirmed.map(x=>x.kind));
 if(kinds.size>1)
  return {status:'NEEDS_CAPACITY_CHECK',reasonCode:'MULTIPLE_SOURCE_WINDOWS_REVIEW',
   firstSourceRef:confirmed[0]?.eventRef||null,
   planStartsOn:period.startsOn,planEndsOn:period.endsOn};
 return {status:'OUTSIDE_EXECUTION_PLAN',
  reasonCode:confirmed[0].kind,firstSourceRef:confirmed[0].eventRef,
  planStartsOn:period.startsOn,planEndsOn:period.endsOn};
}
export function proposedVisitInsideExecutionPeriod(assignment,period){
 if(!day(period?.startsOn)||!day(period?.endsOn)||
  period.endsOn<period.startsOn)return false;
 const start=localMs(assignment?.startLocal);
 const end=localMs(assignment?.endLocal);
 return Number.isFinite(start)&&Number.isFinite(end)&&start<end&&
  start>=Date.parse(period.startsOn+'T00:00:00+04:00')&&
  end<=Date.parse(period.endsOn+'T00:00:00+04:00')+DAY;
}
