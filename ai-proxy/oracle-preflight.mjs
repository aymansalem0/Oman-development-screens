/**
 * Non-billable Oracle persistence preflight.
 * Replays the SQL storage sequence with representative SYNTHETIC records,
 * then rolls the entire transaction back. NO Airia calls; NO persisted rows.
 * Usage (in existing ai-proxy image):
 *   node oracle-preflight.mjs
 */
import {OracleIntelligenceStore} from './oracle-store.mjs';

const repo=new OracleIntelligenceStore();
const imo='9328471';
const factors=[
  ['movement','A01',20],
  ['inspection','A02',65],
  ['certificate','A02',35],
  ['dataQuality','A02',40],
  ['history','A01',70]
];
const row={
  imo,status:'COMPLETED',score:47,level:'Watch',
  operationalPriority:'Routine',criticalOpenFinding:false,
  inputHash:'DRY_RUN_ONLY_NOT_A_REAL_AI_ASSESSMENT',sourceMode:'GOOGLE_SHEETS_LIVE',
  sourceNature:'SYNTHETIC_NOT_RIYADH_MOU',configVersion:'NMC Risk Ruleset 1.0',
  ruleset:{version:'NMC Risk Ruleset 1.0',mode:'weighted',
    weights:{movement:25,inspection:28,certificate:20,dataQuality:14,history:13},
    thresholds:{watch:45,high:65,critical:85}},
  pscSummary:{inspections:0,detentions:0},
  nextCheckAt:new Date(Date.now()+3600000).toISOString(),
  signals:factors.map(([factor,sourceAgent,severity])=>({
    factor,sourceAgent,severity,confidence:0.8,
    reason:'Rollback-only synthetic Oracle connector test',
    evidenceIds:factor==='inspection'||factor==='history'
      ?['PSC-SIM-0001-01']:['VES-9328471']
  }))
};
try{
  await repo.init();
  const existing=await repo.loadLatest();
  console.log('[preflight] Oracle schema connected, stored states: '+Object.keys(existing).length);
  if(existing[imo]?.status==='COMPLETED')
    console.log('[preflight] Existing completed score remains untouched');
  await repo.saveAssessment(row,{dryRun:true});
  console.log('[preflight] Assessment, five factors, evidence, findings, data quality, state and event SQL: PASSED');
  console.log('[preflight] Transaction ROLLED BACK. Airia calls: 0. No rows inserted.');
}catch(error){
  const code=/^[A-Z][A-Z0-9_]{1,100}$/.test(String(error?.message))?error.message:'ORACLE_PREFLIGHT_FAILED';
  console.error('[preflight] '+code+'; review [nmc-oracle] stage/code printed above');
  process.exitCode=1;
}finally{
  try{await repo.pool?.close(0);}catch{}
}
