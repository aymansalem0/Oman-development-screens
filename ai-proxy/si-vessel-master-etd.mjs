/**
 * Smart Inspection — source-linked operational Vessel Master ETD projection.
 *
 * IMO/name are the fixed 99-vessel partner-demo master identities.
 * ETD is a mutable PORT CALL / maritime-service operational observation, not
 * a permanent vessel registration characteristic. Never insert imaginary
 * dates, change SI source events, overwrite NMC or invoke AI from this view.
 *
 * POC business decision: an imported SOURCE_FINAL ETD is final immediately.
 * No extra departure-date approval. Conflicting active source ETDs are
 * surfaced explicitly instead of silently choosing a winner.
 */
import {AIRIA_DEMO_99_RECORDS} from './airia-demo-cohort.mjs';

const local=ms=>new Date(ms+4*3600000).toISOString().slice(0,16);
const isImo=x=>typeof x==='string'&&/^\d{7}$/.test(x);
const allowedSources=new Set(['PSC_PORT_CALL','SERVICE_REQUEST']);
const statusSet=new Set(['SOURCE_FINAL','SOURCE_REVIEWED']);

/**
 * @param {Object} input
 * @returns {Object} Source-backed, read-only master with one row per IMO.
 */
export function projectVesselMasterEtd({
 identities=AIRIA_DEMO_99_RECORDS,sourceEvents=[],now=Date.now()
}={}){
 if(!Array.isArray(identities)||!Array.isArray(sourceEvents)||
  !Number.isFinite(now)||new Set(identities.map(x=>x.imo)).size!==identities.length)
  throw new TypeError('SI_VESSEL_MASTER_INPUT_INVALID');
 const byImo=new Map(identities.map(x=>[x.imo,[]]));
 for(const wrapper of sourceEvents){
  const p=wrapper?.payload;
  if(!p||!byImo.has(p.imo)||!allowedSources.has(p.sourceType)||
      !statusSet.has(p.sourceApprovalStatus)||
      typeof p.departureAt!=='string'||
      !/^20\d\d-\d\d-\d\dT\d\d:\d\d(?::\d\d)?(?:Z|[+-]\d\d:\d\d)$/.test(p.departureAt))continue;
  const when=Date.parse(p.departureAt);
  if(!Number.isFinite(when))continue;
  const port=typeof p.port==='string'?p.port.trim():'';
  const ev={etdUtc:new Date(when).toISOString(),ms:when,port,
    sourceType:p.sourceType,sourceReference:p.sourceReference||null,
    eventKey:wrapper.eventKey||null,
    sourceNature:p.provenance||'POC_SIMULATOR'};
  byImo.get(p.imo).push(ev);
 }
 const rows=identities.map(v=>{
  if(!isImo(v.imo)||typeof v.name!=='string')throw new TypeError('SI_VESSEL_MASTER_IDENTITY_INVALID');
  const all=byImo.get(v.imo);
  const future=all.filter(x=>x.ms>=now);
  // A mismatch in either future ETD or port is a source conflict. The user
  // wants a final date without date approval, NOT an arbitrary merge.
  const keys=new Set(future.map(x=>x.etdUtc+'|'+x.port.toUpperCase()));
  const conflict=keys.size>1;
  const current=!conflict&&future.length?future[0]:null;
  const sorted=[...future].sort((a,b)=>a.ms-b.ms||a.sourceType.localeCompare(b.sourceType));
  return {imo:v.imo,vesselName:v.name,
   currentPort:current?.port||null,
   etdLocal:current?local(current.ms):null,
   etdUtc:current?.etdUtc||null,
   etdTimeZone:'Asia/Dubai',
   etdStatus:conflict?'CONFLICT':current?'FINAL_POC':all.length?'HISTORICAL_ONLY':'MISSING',
   etdBusinessRule:'FINAL_ON_SOURCE_IMPORT_NO_DATE_APPROVAL',
   etdSourceTypes:[...new Set(sorted.map(x=>x.sourceType))],
   sourceReferences:[...new Set(sorted.map(x=>x.sourceReference).filter(Boolean))],
   futureSourceEventCount:future.length,
   sourceNature:current?.sourceNature||'SYNTHETIC_POC_OR_NOT_AVAILABLE',
   isIdentityMasterNotVesselMovementAuthority:true};
 });
 return {schema:'SI_OPERATIONAL_VESSEL_MASTER_ETD_V1',
  status:'READ_ONLY_SOURCE_JOIN',total:rows.length,
  summary:{
   final:rows.filter(x=>x.etdStatus==='FINAL_POC').length,
   conflicting:rows.filter(x=>x.etdStatus==='CONFLICT').length,
   historicalOnly:rows.filter(x=>x.etdStatus==='HISTORICAL_ONLY').length,
   missing:rows.filter(x=>x.etdStatus==='MISSING').length
  },rows,
  notice:'Source-imported ETD is final for POC without separate date approval. This is synthetic operational metadata, not certified AIS or registration data.'};
}
