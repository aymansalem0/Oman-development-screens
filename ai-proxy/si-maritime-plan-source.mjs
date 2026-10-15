/**
 * Source-first construction of scheduling fields. Nothing here updates the
 * NMC Case Workspace, PSC quota, MSW events, or inspection records.
 * MSW ETD is FINAL on import (no additional date approval), though a POC
 * Excel source remains clearly identified as synthetic, not live MSW.
 */
import {SiError} from './si-erp-workforce.mjs';
const localFromUtc=raw=>{
 if(typeof raw!=='string'||!Number.isFinite(Date.parse(raw)))return '';
 return new Date(Date.parse(raw)+4*3600000).toISOString().slice(0,16).replace('T',' ');
};
const vesselClass=text=>{
 const t=String(text||'').toUpperCase();
 return t.includes('TANK')?'TANKER':t.includes('PASSENGER')||t.includes('FERRY')?
  'PASSENGER':t.includes('CARGO')||t.includes('BULK')||t.includes('CONTAINER')?
  'CARGO':'OTHER';
};
const regime=x=>({
 PORT_STATE_CONTROL:'PSC',FOCUSED_INSPECTION:'FOCUSED',
 UAE_SERVICE_INSPECTION:'SERVICE',FOLLOW_UP_INSPECTION:'FOLLOW_UP'
}[x]||'FOCUSED');
export function maritimePlanSchedulingContext(plan,dashboard,snapshot){
 if(plan.status!=='APPROVED'||!Array.isArray(plan.approvedVessels))
  throw new SiError('SI_V2_APPROVED_PLAN_REQUIRED',409);
 const ports=snapshot.data.Ports;
 const findPort=x=>ports.find(p=>p.port_id===x||p.port_name?.toUpperCase()===String(x||'').toUpperCase());
 const context=plan.approvedVessels.map(entry=>{
  const original=dashboard.vesselCandidates.find(x=>x.imo===entry.imo);
  const eventKeys=new Set(entry.inspectionReasons.flatMap(x=>[x.eventKey]));
  const events=(original?.sourceEvents||[]).filter(x=>eventKeys.has(x.eventKey));
  // The source's exact dates are used. No ETA-derived fake ETD.
  const dateEvent=events.find(x=>x.departureAt&&
   ['SOURCE_FINAL','SOURCE_REVIEWED'].includes(x.approval));
  const portEvent=dateEvent||events.find(e=>e.port)||null;
  const port=findPort(portEvent?.port);
  // Pair ETA with the same verified port call as the source-final ETD.
  // Never combine an unrelated historical arrival with another departure.
  const candidates=events.filter(e=>e.eta&&
   ['SOURCE_FINAL','SOURCE_REVIEWED'].includes(e.approval)&&
   Number.isFinite(Date.parse(e.eta.replace(' ','T')+':00+04:00'))&&
   (!dateEvent||!dateEvent.port||e.port===dateEvent.port));
  const etaValues=new Set(candidates.map(e=>e.eta.replace('T',' ')));
  const etaEvent=dateEvent?.eta&&etaValues.has(dateEvent.eta.replace('T',' '))?
   dateEvent:etaValues.size===1?candidates[0]:null;
  const arrivalLocal=etaEvent?.eta?etaEvent.eta.replace('T',' '):'';
  const departureLocal=dateEvent?localFromUtc(dateEvent.departureAt):'';
  const nmc=entry.inspectionReasons.filter(x=>x.sourceType==='NMC_CASE')
   .map(x=>({id:x.sourceEventId,caseReference:x.sourceReference}));
  const primaryRegime=entry.regimes.includes('PORT_STATE_CONTROL')?'PSC':
   entry.regimes.includes('UAE_SERVICE_INSPECTION')?'SERVICE':
   regime(entry.regimes[0]);
  return {imo:entry.imo,name:original?.vesselName||('IMO '+entry.imo),
   sourceTypes:[...new Set(entry.inspectionReasons.map(x=>x.sourceType))],
   regimes:entry.regimes,regime:primaryRegime,
   vesselType:vesselClass(original?.vesselType),
   portId:port?.port_id||'',portName:port?.port_name||portEvent?.port||'',
   // Only a verified source-provided port is immutable. An officer-selected
   // port in the form must remain editable before schedule preview.
   portSourceLocked:!!port?.port_id,
   etaLocal:arrivalLocal,etdLocal:departureLocal,
   etaSourceReference:etaEvent?.sourceReference||null,
   // The POC MSW feed currently has no recorded berth-arrival timestamp.
   // A supervisor/officer may attest a later berth time with evidence while
   // leaving the final ETA and ETD unchanged.
   berthAtLocal:'',berthConfirmed:false,berthEvidenceReference:'',
   etdSource:dateEvent?'SOURCE_FINAL_NO_DATE_APPROVAL':'ETD_NOT_PROVIDED',
   dateEvidenceReference:dateEvent?.sourceReference||'',
   nmcReferrals:nmc,
   locationType:'BERTH',locationName:'',siteAccessConfirmed:false,
   durationMinutes:primaryRegime==='PSC'?180:120,
   earliestLocal:arrivalLocal,latestFinishLocal:departureLocal,
   windowSource:dateEvent?'MSW_FINAL':'',
   windowEvidenceReference:dateEvent?.sourceReference||''};
 });
 // Only work-relevant, active POC scheduling fields are returned; do not
 // expose personal HR leave descriptions, phone numbers or raw ERP rows.
 const inspectors=(snapshot.data.Inspectors||[])
  .filter(p=>p.active==='Y'||p.active===true)
  .map(p=>({
   inspectorId:p.inspector_id,inspectorName:p.display_name||p.inspector_id,
   homePortId:p.home_port_id||null,
   dailyCapacity:Number(p.daily_capacity)||0,
   qualifications:[...new Set((snapshot.data.Qualifications||[])
     .filter(q=>q.inspector_id===p.inspector_id&&
       (q.active==='Y'||q.active===true)&&
       q.valid_until>=new Date().toISOString().slice(0,10))
     .map(q=>q.inspection_regime))].sort()
  })).sort((a,b)=>a.inspectorName.localeCompare(b.inspectorName)||
   a.inspectorId.localeCompare(b.inspectorId));
 return {status:'SCHEDULE_INPUT_REQUIRED',planId:plan.id,
  approvedVessels:context.length,ports:ports.filter(p=>p.active==='Y').map(p=>({
   portId:p.port_id,name:p.port_name,
   windowStart:p.window_start,windowEnd:p.window_end
  })),
  erpSnapshotId:snapshot.snapshotId,
  workforce:inspectors,items:context,
  instruction:'ETD from MSW is final on import. Supervisor approves only the resulting schedule, not the date.',
  warning:'The inspection can start at ETA or a later confirmed berth arrival, and must finish no later than final ETD. Missing vessel access/ETD remains UNSCHEDULED, not fabricated.'};
}
export function validateOperatorScheduleAgainstSource(context,requests,{demo=false,context:demoContext=null}={}){
 if(!Array.isArray(requests)||requests.length>500)
  throw new SiError('SI_V2_INVALID_SCHEDULE_REQUEST_COUNT',422);
 const indexed=new Map(context.items.map(x=>[x.imo,x]));
 for(const row of requests){
  const source=indexed.get(row.imo);
  if(!source)throw new SiError('SI_V2_SCHEDULE_IMO_OUTSIDE_APPROVED_PLAN',422);
  const derived=demo?demoContext?.items?.find(x=>x.imo===row.imo):null;
  if(demo&&!derived)throw new SiError('SI_POC_DEMO_VESSEL_NOT_IN_CONTEXT',422);
  if(demo){
   // Mock filling is generated by server only and cannot overwrite final
   // port/ETA/ETD, change a source regime, or invent an arbitrary time window.
   if(!source.portId&&row.portId!==derived.portId)
    throw new SiError('SI_POC_DEMO_PORT_CHANGED',409);
   if(!source.etaLocal&&row.earliestLocal!==derived.earliestLocal)
    throw new SiError('SI_POC_DEMO_START_CHANGED',409);
   if(!source.etdLocal&&row.latestFinishLocal!==derived.latestFinishLocal)
    throw new SiError('SI_POC_DEMO_DEADLINE_CHANGED',409);
  }
  // For populated MSW ETA/ETD, dates are final. Do not silently accept
  // revised client dates or require a second approval.
  if(source.etdLocal&&row.latestFinishLocal!==source.etdLocal)
   throw new SiError('SI_V2_FINAL_MSW_ETD_IMMUTABLE',409);
  if(source.etaLocal&&row.earliestLocal!==source.etaLocal)
   throw new SiError('SI_V2_FINAL_MSW_ETA_IMMUTABLE',409);
  if(row.vesselType!==source.vesselType||row.regime!==source.regime)
   throw new SiError('SI_V2_VESSEL_TYPE_OR_REGIME_CHANGED',409);
  if(source.portId&&row.portId!==source.portId)
   throw new SiError('SI_V2_APPROVED_SOURCE_PORT_CHANGED',409);
  if(source.etdLocal&&row.windowSource!=='MSW_FINAL')
   throw new SiError('SI_V2_FINAL_MSW_SOURCE_REQUIRED',409);
  if(source.etdLocal&&row.windowEvidenceReference!==source.dateEvidenceReference)
   throw new SiError('SI_V2_FINAL_MSW_ETD_PROVENANCE_INVALID',409);
  // Berthing time is an optional officer-confirmed ADDITIONAL constraint.
  // It may tighten a verified ETA→ETD window, never replace source dates.
  if(row.berthAtLocal){
   if(typeof row.berthAtLocal!=='string'||
      !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(row.berthAtLocal)||
      row.locationType!=='BERTH'||row.siteAccessConfirmed!==true||
      row.berthConfirmed!==true||
      typeof row.berthEvidenceReference!=='string'||
      row.berthEvidenceReference.trim().length<6)
    throw new SiError('SI_V2_BERTHING_CONFIRMATION_EVIDENCE_REQUIRED',422);
   const epoch=x=>Date.parse(x.replace(' ','T')+':00+04:00');
   const berth=epoch(row.berthAtLocal);
   if(!Number.isFinite(berth)||
      (source.etaLocal&&berth<epoch(source.etaLocal))||
      (source.etdLocal&&berth>=epoch(source.etdLocal)))
    throw new SiError('SI_V2_BERTHING_OUTSIDE_SOURCE_WINDOW',409);
  }
 }
}
