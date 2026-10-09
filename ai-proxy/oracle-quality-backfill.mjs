/**
 * NON-BILLABLE one-vessel data-quality calculation, optional persistence.
 * No Airia calls. NEVER deletes risk assessments, historical events or volumes.
 * Dry-run: node oracle-quality-backfill.mjs 9328471
 * Apply:   node oracle-quality-backfill.mjs 9328471 --apply
 *
 * IMPORTANT: this recomputes quality using the CURRENT synthetic PSC workbook.
 * It does not reconstruct immutable historical PSC evidence because V1 only
 * stored the risk signals and PSC summary. It never changes the old risk score.
 */
import {readFileSync} from 'node:fs';
import {OracleIntelligenceStore} from './oracle-store.mjs';
import {getPscVessel} from './psc-reader.mjs';
import {evaluateDataQuality} from './data-quality.mjs';

const imo=process.argv[2]||'';
const apply=process.argv[3]==='--apply';
if(!/^[0-9]{7}$/.test(imo)||process.argv.length>4||
   (process.argv[3]&&process.argv[3]!=='--apply')){
  console.error('Usage: node oracle-quality-backfill.mjs <7-digit-imo> [--apply]');
  process.exit(2);
}
const repository=new OracleIntelligenceStore();
try{
  await repository.init();
  const existing=await repository.loadLatest();
  const previous=existing[imo];
  if(!previous||previous.status!=='COMPLETED'||!previous.assessmentId||
     !Array.isArray(previous.signals)||previous.signals.length!==5){
    throw new Error('QUALITY_BACKFILL_SAVED_ASSESSMENT_REQUIRED');
  }
  const bundles=JSON.parse(readFileSync(new URL('./fleet-bundles.json',import.meta.url),'utf8'));
  const bundle=bundles.find(item=>item.imo===imo);
  if(!bundle)throw new Error('QUALITY_BACKFILL_VESSEL_BUNDLE_NOT_FOUND');
  const psc=await getPscVessel(imo);
  if(psc.sourceMode!==previous.sourceMode)
    throw new Error('QUALITY_BACKFILL_SOURCE_MODE_CHANGED');
  const quality=evaluateDataQuality({bundle,psc,signals:previous.signals});
  quality.breakdown.reconstructionNotice=
    'Retrospective quality check using CURRENT synthetic PSC source. Historical PSC snapshot not persisted in V1. Risk score unchanged.';
  const result=await repository.backfillDataQuality(imo,previous.assessmentId,quality,{dryRun:!apply});
  console.log(JSON.stringify({
    status:apply?'APPLIED':'DRY_RUN_ROLLED_BACK',
    imo,assessmentId:result.assessmentId,qualityScore:result.qualityScore,
    calculationStatus:quality.calculationStatus,
    comparedFields:quality.breakdown.comparedFields,
    detectedDisagreements:result.detectedDisagreements,
    sourceMode:psc.sourceMode,airiaCalls:0,
    note:'Synthetic structural score only; not independently verified confidence. Saved AI risk score unchanged.'
  },null,2));
}catch(error){
  const code=/^[A-Z][A-Z0-9_]{1,100}$/.test(String(error?.message))
    ?error.message:'QUALITY_BACKFILL_FAILED';
  console.error('[quality-backfill] '+code);
  process.exitCode=1;
}finally{
  try{await repository.pool?.close(0);}catch{}
}
