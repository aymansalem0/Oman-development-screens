/** Exact §8 Airia partner demo 99 IMO/name pairs. Names/IMOs only are partner supplied.
 * All richer fields are from existing deterministic synthetic POC fixture.
 * NEVER treat A03 partner-reported packs as downloaded/verified local documents.
 */
import manifest from '../../../ai-proxy/airia-demo-99.json';
import {NMC_OPERATIONAL_VESSELS} from './nmc-expanded-vessel-catalog';
const records=manifest.records;
export const AIRIA_DEMO_99_IMOS=new Set<string>(records.map(r=>r.imo));
export const AIRIA_DEMO_PACK_METADATA={
  schemaVersion:manifest.schemaVersion,source:manifest.source,
  sourceDate:manifest.sourceDate,documentPackStatus:manifest.documentPackStatus,
  count:records.length,detailSource:'EXISTING_SYNTHETIC_POC_FIXTURE'
} as const;
export const AIRIA_DEMO_OPERATIONAL_VESSELS=NMC_OPERATIONAL_VESSELS.filter(
  v=>AIRIA_DEMO_99_IMOS.has(v.imo));
if(records.length!==99||AIRIA_DEMO_99_IMOS.size!==99||
   AIRIA_DEMO_OPERATIONAL_VESSELS.length!==99||
   records.some(r=>!AIRIA_DEMO_OPERATIONAL_VESSELS.some(v=>
     v.imo===r.imo&&v.name===r.name)))
  throw new Error('AIRIA_99_COHORT_MISMATCH_WITH_SYNTHETIC_FIXTURES');
export const AIRIA_DEMO_99_ORDER=records.map(r=>r.imo);
