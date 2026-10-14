/**
 * ONLY for a controlled MOEI Smart Inspection POC walkthrough.
 * This is an in-memory, explicitly labelled DEMO overlay. It does not
 * modify the imported ERP Excel snapshot, saved source events, Oracle,
 * inspector qualifications, vessel ownership, or official case state.
 * Production-like execution must use the unchanged ERP source.
 */
import {createHash} from 'node:crypto';
const hash=s=>createHash('sha256').update(String(s)).digest('hex').slice(0,16);
const DUBAI_MS=4*3600000,DAY_MS=24*3600000;
const fmt=ms=>new Date(ms+DUBAI_MS).toISOString().slice(0,16).replace('T',' ');
const localEpoch=s=>typeof s==='string'&&s?
 Date.parse(s.replace(' ','T')+':00+04:00'):NaN;
const dayAt=(day,time)=>Date.parse(day+'T'+time+':00+04:00');
const dubaiDay=ms=>new Date(ms+DUBAI_MS).toISOString().slice(0,10);
const nextLocalDay=now=>dubaiDay(now+DAY_MS);
const availablePorts=snapshot=>(snapshot.data.Ports||[])
 .filter(p=>p.active==='Y'||p.active===true);
export function buildPocErpSchedulingOverlay(snapshot,{clock=()=>Date.now()}={}){
 if(!snapshot?.data?.Ports?.length)throw Error('SI_DEMO_IMPORT_ERP_FIRST');
 const originalPorts=availablePorts(snapshot);
 if(!originalPorts.length)throw Error('SI_DEMO_ACTIVE_PORTS_REQUIRED');
 const data=structuredClone(snapshot.data);
 // Independent and *visibly synthetic* HR availability. Never present
 // imported staff as fully qualified if the source did not say so.
 const regimes=['PSC','SERVICE','FOCUSED','FOLLOW_UP','FLAG'];
 const types=['ANY'];
 const count=Math.max(8,Math.min(16,data.Inspectors?.length||8));
 const day=nextLocalDay(clock()),until='2099-12-31';
 const people=Array.from({length:count},(_,i)=>({
  inspector_id:'DEMO-INS-'+String(i+1).padStart(2,'0'),
  erp_employee_id:'POC-SYNTHETIC-'+String(i+1).padStart(2,'0'),
  display_name:'POC Demo Inspector '+String(i+1).padStart(2,'0'),
  active:'Y',role:'INSPECTOR',home_port_id:originalPorts[i%originalPorts.length].port_id,
  home_city:originalPorts[i%originalPorts.length].city||'UAE',
  daily_capacity:'5',weekly_hours_limit:'60'
 }));
 data.Ports=originalPorts.map(p=>({
  ...p,window_start:'06:00',window_end:'23:00'
 }));
 data.Inspectors=people;
 // Demo inspectors are local to their own home port. Remote inspections
 // use the route travel-time and explicit cross-port approval, not an all-port
 // membership that bypasses travel and authorization checks.
 data.Inspector_Ports=people.map(p=>({
  inspector_id:p.inspector_id,port_id:p.home_port_id,
  assignment_type:'POC_HOME_PORT',
  active:'Y',effective_from:'2025-01-01',effective_to:until
 }));
 data.Qualifications=people.flatMap(p=>regimes.flatMap(regime=>types.map(type=>({
  inspector_id:p.inspector_id,inspection_regime:regime,vessel_type:type,
  qualification_code:'POC_SYNTHETIC_ALL_SCOPES',valid_until:until,active:'Y'
 }))));
 data.Shifts=people.flatMap(p=>['SUN','MON','TUE','WED','THU','FRI','SAT'].map(weekday=>({
  inspector_id:p.inspector_id,weekday,start_local:'06:00',end_local:'23:00',
  status:'WORKING',effective_from:'2025-01-01',effective_to:until
 })));
 data.Leaves=[];data.Blackouts=[];data.Bookings=[];
 data.Travel_Matrix=originalPorts.flatMap(a=>originalPorts.map(b=>({
  from_port_id:a.port_id,to_port_id:b.port_id,
  one_way_minutes:a.port_id===b.port_id?'0':'30',
  route_allowed:'Y',travel_approval_required:'N'
 })));
 return {...snapshot,data,
  snapshotId:'POC-DEMO-'+hash(snapshot.snapshotId+'|'+day),
  demoMode:true,originalErpSnapshotId:snapshot.snapshotId,
  demoAsOf:day,
  provenance:'POC_SYNTHETIC_ENGINEERS_SHIFTS_QUALIFICATIONS_AND_AVAILABILITY'};
}
/**
 * Populate only visit fields missing in source; never falsify a source-final
 * ETA, ETD, event, approval, or recorded port. Dates are deterministically
 * allocated across a bounded presentation horizon from tomorrow.
 */
export function fillPocSchedulingVisitContext(context,snapshot,{clock=()=>Date.now()}={}){
 const now=clock(),ports=availablePorts(snapshot);
 if(!ports.length)throw Error('SI_DEMO_ACTIVE_PORTS_REQUIRED');
 const tomorrow=nextLocalDay(now);
 const filled=context.items.map((original,index)=>{
  const v={...original};
  const mockFields=[];
  const add=(key,value)=>{v[key]=value;mockFields.push(key);};
  const sourcePort=v.portId;
  if(!sourcePort){
   const suggestion=snapshot.data.POC_Requests?.find(x=>
    x.imo===v.imo&&ports.some(p=>p.port_id===x.requested_port))?.requested_port;
   const inferred=suggestion||ports[index%ports.length].port_id;
   add('portId',inferred);
   add('portName',ports.find(x=>x.port_id===inferred)?.port_name||inferred);
  }
  const baseDay=new Date(dayAt(tomorrow,'00:00')+Math.floor(index/8)*DAY_MS);
  const demoStart=dayAt(dubaiDay(baseDay.getTime()),'08:00');
  const sourceArrival=localEpoch(v.etaLocal);
  const sourceDeparture=localEpoch(v.etdLocal);
  if(!v.etaLocal){
   const beforeSource=Number.isFinite(sourceDeparture)&&sourceDeparture>now?
    sourceDeparture-18*3600000:NaN;
   const start=Number.isFinite(beforeSource)&&beforeSource>now+90*60000?
    beforeSource:demoStart;
   add('earliestLocal',fmt(start));
  }
  if(!v.etdLocal){
   const arrival=Number.isFinite(sourceArrival)?sourceArrival:
    localEpoch(v.earliestLocal);
   const goodStart=Number.isFinite(arrival)&&arrival>now?
    arrival:demoStart;
   const deadline=Math.max(goodStart+8*3600000,demoStart+12*3600000);
   add('latestFinishLocal',fmt(deadline));
   add('windowSource','POC_DEMO');
   add('windowEvidenceReference','POC-DEMO-WINDOW-'+hash(v.imo+'|'+tomorrow));
   add('etdSource','POC_DEMO_NOT_REAL_ETD');
  }
  if(!v.locationName)add('locationName',
   'POC Demo Inspection Berth · '+v.portName);
  if(!v.locationType)add('locationType','BERTH');
  if(v.siteAccessConfirmed!==true)add('siteAccessConfirmed',true);
  if(!Number.isInteger(Number(v.durationMinutes))||
    Number(v.durationMinutes)<30||Number(v.durationMinutes)>720)
   add('durationMinutes',v.regime==='PSC'?180:120);
  v.demoFilled=mockFields.length>0;
  v.demoFieldNames=mockFields;
  v.demoEvidenceReference=mockFields.length?
    'POC-DEMO-VISIT-'+hash(v.imo+'|'+tomorrow):null;
  v.demoProvenance='SYNTHETIC_PRESENTATION_ONLY_NOT_VERIFIED_ERP_OR_MSW';
  return v;
 });
 return {...context,items:filled,
  erpSnapshotId:snapshot.snapshotId,demoMode:true,
  demoProvenance:'POC_SYNTHETIC_DATA_NOT_REGULATORY_OR_ERP_APPROVED',
  demoNotice:'All demo visit data and demo inspector qualifications/availability are synthetic. No official berth access, booking, or inspector qualification is confirmed.',
  demoFilledVessels:filled.filter(v=>v.demoFilled).length,
  workforce:(snapshot.data.Inspectors||[]).map(p=>({
   inspectorId:p.inspector_id,inspectorName:p.display_name,
   homePortId:p.home_port_id||null,dailyCapacity:Number(p.daily_capacity),
   qualifications:[...new Set((snapshot.data.Qualifications||[])
    .filter(q=>q.inspector_id===p.inspector_id).map(q=>q.inspection_regime))]
  }))
 };
}
export function validatePocSchedulingDemoRequest(context,requests){
 if(!context.demoMode||!Array.isArray(requests))return;
 const rows=new Map(context.items.map(x=>[x.imo,x]));
 for(const req of requests){
  const source=rows.get(req.imo);
  if(!source)throw Error('SI_DEMO_UNKNOWN_APPROVED_VESSEL');
  // Demo source proof is deterministic on server, never generated by client.
  if(!source.etdLocal&&
    (req.windowSource!=='POC_DEMO'||
     req.windowEvidenceReference!==source.windowEvidenceReference))
   throw Error('SI_DEMO_WINDOW_SOURCE_MISMATCH');
 }
}
