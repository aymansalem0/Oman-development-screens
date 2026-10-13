import {NMC_OPERATIONAL_VESSELS} from './nmc-expanded-vessel-catalog';
import type {NmcVesselProfile} from './nmc-vessel-catalog';
import cohort from '../../../ai-proxy/airia-demo-99.json';
/** Airia §8 canonical 99 IMO/name identities; vessel details remain synthetic. */
export const AIRIA_DEMO_99_IMOS = new Set<string>(cohort.records.map(row=>row.imo));
export const AIRIA_DEMO_99_LIST = cohort.records.map(row=>({
 sequence:row.sequence,imo:row.imo,name:row.name
}));
const byImo=new Map<string,NmcVesselProfile>(NMC_OPERATIONAL_VESSELS.map(v=>[v.imo,v]));
export const AIRIA_DEMO_99_VESSELS:NmcVesselProfile[]=AIRIA_DEMO_99_LIST.map(r=>{
 const vessel=byImo.get(r.imo);
 if(!vessel||vessel.name!==r.name)throw new Error('AIRIA_DEMO_CATALOGUE_MISMATCH_'+r.imo);
 return vessel;
});
if(AIRIA_DEMO_99_IMOS.size!==99||AIRIA_DEMO_99_VESSELS.length!==99)
 throw new Error('AIRIA_DEMO_SIZE_NOT_99');
export const AIRIA_DEMO_DETAILS_NOTICE='99 partner-supplied IMO/name identities; other particulars and AIS positions are SYNTHETIC POC only.';
