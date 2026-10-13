/** §8 Airia 99-vessel POC cohort. Read-only selection; no persisted deletion. */
import {readFileSync} from 'node:fs';
const manifest=JSON.parse(readFileSync(new URL('./airia-demo-99.json',import.meta.url),'utf8'));
const records=manifest.records;
if(records.length!==99||new Set(records.map(r=>r.imo)).size!==99||
 records.some((r,i)=>r.sequence!==i+1||!/^[0-9]{7}$/.test(r.imo)||!r.name))
 throw Error('AIRIA_99_MANIFEST_INVALID');
export const AIRIA_99_METADATA=Object.freeze({
 schemaVersion:manifest.schemaVersion,
 source:manifest.source, sourceDate:manifest.sourceDate,
 count:99,detailSource:'EXISTING_SYNTHETIC_POC_FIXTURE',
 documentPackStatus:manifest.documentPackStatus
});
export const AIRIA_99_RECORDS=Object.freeze(records);
export const AIRIA_99_IMOS=new Set(records.map(r=>r.imo));
export function onlyAiria99(rows,readImo=x=>x.imo){
 if(!Array.isArray(rows))throw Error('AIRIA_99_INPUT_REQUIRED');
 const byImo=new Map(rows.map(row=>[String(readImo(row)),row]));
 const chosen=records.map(r=>byImo.get(r.imo)).filter(Boolean);
 if(chosen.length!==99)throw Error('AIRIA_99_DETAIL_BUNDLES_MISSING');
 for(const r of records){
  const row=byImo.get(r.imo);
  const actual=row?.inlineContext?.vessel?.name||row?.name;
  if(actual!==r.name)throw Error('AIRIA_99_VESSEL_NAME_MISMATCH_'+r.imo);
 }
 return chosen;
}
