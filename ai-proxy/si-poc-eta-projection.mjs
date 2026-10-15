/**
 * POC-only, read-only *display* projection for missing vessel ETA.
 * NEVER write this value to MSW/Oracle source events; it is NOT evidence of
 * actual vessel presence, eligibility, PSC trigger or inspection approval.
 * The derived value is stable per IMO and UAE calendar day.
 */
import {createHash} from 'node:crypto';
const DUBAI=4*3600000,DAY=86400000,HOUR=3600000;
const fmt=ms=>new Date(ms+DUBAI).toISOString().slice(0,16).replace('T',' ');
const day=ms=>new Date(ms+DUBAI).toISOString().slice(0,10);
const local=(d,t)=>Date.parse(d+'T'+t+':00+04:00');
const asMs=raw=>{
 if(typeof raw!=='string'||!raw)return NaN;
 const s=raw.trim().replace(' ','T');
 return /(?:Z|[+-]\d\d:\d\d)$/.test(s)?
  Date.parse(s):Date.parse(s+':00+04:00');
};
/**
 * When imported MSW has no verified ETA, suggest a non-authoritative
 * training example, NOT a prediction or back-calculation from ETD.
 * A known ETD is a *hard upper limit*; if no sensible future demo arrival
 * fits, leave ETA absent instead of contradicting a verified departure.
 */
export function projectMissingPocEta(imo,{
 now=Date.now(),verifiedDepartureAt=null
}={}){
 if(typeof imo!=='string'||!/^[0-9]{7}$/.test(imo)||
  !Number.isFinite(now))return null;
 const token=createHash('sha256').update('MOEI-POC-ETA:'+imo).digest();
 const futureDate=day(now+DAY*(1+(token[0]%3)));
 const suggested=local(futureDate,['07:00','09:00','11:00','13:00'][token[1]%4]);
 const departure=asMs(verifiedDepartureAt);
 if(verifiedDepartureAt&&(!Number.isFinite(departure)||departure<=now+3*HOUR))
  return null;
 let at=suggested;
 if(Number.isFinite(departure)&&at+2*HOUR>departure){
  // Next-day training arrival is still NOT possible before this final ETD.
  // Consider a near-term POC arrival based on current time (not ETD - X).
  const near=now+HOUR;
  if(near+2*HOUR>departure)return null;
  at=Math.ceil(near/(30*60000))*30*60000;
 }
 if(at<=now)at=Math.ceil((now+HOUR)/(30*60000))*30*60000;
 if(Number.isFinite(departure)&&at+2*HOUR>departure)return null;
 return {etaLocal:fmt(at),status:'POC_ESTIMATE_ONLY',
  provenance:'SYNTHETIC_POC_ETA_NOT_SOURCE_VERIFIED'};
}
