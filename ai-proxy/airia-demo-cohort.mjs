/** Airia Partner Guide §8: 99 demo vessel identities only.
 * Non-destructive display/AI cohort: original 420 synthetic records remain
 * in the read-only source file and historical Oracle/JSON assessments.
 */
import {readFileSync} from 'node:fs';
const source=JSON.parse(readFileSync(new URL('./airia-demo-99.json',import.meta.url),'utf8'));
if(source.records?.length!==99||new Set(source.records.map(x=>x.imo)).size!==99||
 source.records.some((r,i)=>r.sequence!==i+1||!/^[0-9]{7}$/.test(r.imo)||!r.name))
 throw Error('AIRIA_DEMO_COHORT_INVALID');
export const AIRIA_DEMO_99_RECORDS=Object.freeze(source.records);
export const AIRIA_DEMO_99_IMOS=new Set(source.records.map(x=>x.imo));
export const AIRIA_DEMO_COHORT={
 count:99,source:source.source,sourceDate:source.sourceDate,
 identityProvenance:'PARTNER_SUPPLIED_IMO_NAME_ONLY',
 detailProvenance:'EXISTING_SYNTHETIC_POC_FIXTURE',
 documentPackStatus:'PARTNER_REPORTED_UNVERIFIED',
 disclaimer:'Synthetic POC maritime data, NOT observed live AIS, official registry, or downloaded Airia A03 documents'
};
export function airiaDemoVessels(records,{strict=true}={}){
 const map=new Map(records.map(r=>[String(r.imo),r]));
 const result=AIRIA_DEMO_99_RECORDS.map(r=>map.get(r.imo)).filter(Boolean);
 if(strict&&result.length!==99)throw Error('AIRIA_DEMO_99_DETAILS_MISSING');
 if(strict&&result.some(r=>AIRIA_DEMO_99_RECORDS.find(x=>x.imo===r.imo)?.name!==
 (r.inlineContext?.vessel?.name||r.name)))throw Error('AIRIA_DEMO_IDENTITY_MISMATCH');
 return result;
}
