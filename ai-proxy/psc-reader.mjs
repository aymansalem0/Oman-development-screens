import { readFileSync } from 'node:fs';
import { createSign } from 'node:crypto';
import { catalogFromNmcSource, generateExternalPsc, PSC_SOURCE, PSC_VERSION } from './psc-fixtures.mjs';

export const PSC_SHEET_ID = process.env.PSC_GOOGLE_SHEET_ID || '1sefQv6E-Avvgmklv4WQbpFBEc7MmlCAcOc0c-rI_Wmg';
export const PSC_SOURCE_MODE = (process.env.PSC_SOURCE_MODE || 'snapshot').trim().toLowerCase();
const HEADERS = {
  registry: ['vesselId','imo','vesselName','flag','vesselType','operator','built','externalInspectionCount','coverage','sourceSystem','datasetVersion','dataNature'],
  inspections: ['inspectionId','imo','vesselName','inspectionDate','port','country','inspectionType','result','deficiencyCount','openDeficiencies','detained','followUpRequired','sourceSystem','reportPdfStatus','reportRef','dataNature'],
  deficiencies: ['deficiencyId','inspectionId','imo','inspectionDate','deficiencyCode','category','severity','status','description','recommendedCorrectiveAction','closedDate','evidenceStatus','sourceSystem','dataNature'],
  detentions: ['detentionId','inspectionId','imo','detentionDate','port','country','reason','releaseDate','status','sourceSystem','dataNature']
};
const BOOL_COLS = new Set(['detained','followUpRequired']);
const NUMBER_COLS = new Set(['vesselId','built','externalInspectionCount','deficiencyCount','openDeficiencies']);
const CACHE_TTL_MS = 120_000;
const catalogueBase = readFileSync(new URL('./nmc-vessel-catalog.ts', import.meta.url), 'utf8');
const catalogueExtra = readFileSync(new URL('./nmc-expanded-vessel-catalog.ts', import.meta.url), 'utf8');
const vessels = catalogFromNmcSource(catalogueBase, catalogueExtra);
const allowedImos = new Set(vessels.map(vessel => vessel.imo));
const localSnapshot = generateExternalPsc(vessels);
let cache = null;
let pending = null;
let tokenCache = null;

const typed = (key, raw) => {
  if (BOOL_COLS.has(key)) return raw === true || String(raw).toUpperCase() === 'TRUE';
  if (NUMBER_COLS.has(key)) return Number(raw || 0);
  return String(raw ?? '');
};
const rowsFromValues = (values, headers) => {
  if (!Array.isArray(values) || !Array.isArray(values[0])) throw new Error('INVALID_PSC_SHEET_HEADER');
  if (headers.some((header,index) => values[0][index] !== header)) throw new Error('PSC_SHEET_COLUMNS_CHANGED');
  return values.slice(1).filter(row => row.length && String(row[0] || '').trim())
    .map(row => Object.fromEntries(headers.map((name,index) => [name,typed(name,row[index])])));
};
const enc = value => Buffer.from(JSON.stringify(value)).toString('base64url');
async function googleToken() {
  if (tokenCache && tokenCache.expires > Date.now() + 60_000) return tokenCache.value;
  const path = process.env.PSC_GOOGLE_CREDENTIALS_PATH || '/run/secrets/nmc-psc-google.json';
  const identity = JSON.parse(readFileSync(path,'utf8'));
  if (identity.type !== 'service_account' || !identity.client_email || !identity.private_key) throw new Error('INVALID_SERVICE_ACCOUNT');
  const now = Math.floor(Date.now()/1000);
  const claims = {
    iss: identity.client_email, scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now+3600
  };
  const content = enc({alg:'RS256',typ:'JWT'}) + '.' + enc(claims);
  const signer = createSign('RSA-SHA256'); signer.update(content); signer.end();
  const assertion = content + '.' + signer.sign(identity.private_key).toString('base64url');
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body: new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion}),
    signal: AbortSignal.timeout(12_000)
  });
  if (!response.ok) throw new Error('GOOGLE_TOKEN_REQUEST_FAILED_'+response.status);
  const json = await response.json();
  if (!json.access_token) throw new Error('GOOGLE_TOKEN_MISSING');
  tokenCache = {value:json.access_token,expires:Date.now()+Number(json.expires_in||3500)*1000};
  return tokenCache.value;
}
async function readLiveSheet() {
  const token = await googleToken();
  const endpoint = new URL('https://sheets.googleapis.com/v4/spreadsheets/'+encodeURIComponent(PSC_SHEET_ID)+'/values:batchGet');
  for (const range of ['Vessels_420!A1:L500','PSC_Inspections!A1:P1900','PSC_Deficiencies!A1:N1900','PSC_Detentions!A1:K300']) {
    endpoint.searchParams.append('ranges',range);
  }
  endpoint.searchParams.set('valueRenderOption','UNFORMATTED_VALUE');
  const response = await fetch(endpoint, {headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(20_000)});
  if (!response.ok) throw new Error('GOOGLE_SHEETS_REQUEST_FAILED_'+response.status);
  const json = await response.json();
  if (!Array.isArray(json.valueRanges) || json.valueRanges.length !== 4) throw new Error('INCOMPLETE_PSC_SHEET');
  const [registry,inspections,deficiencies,detentions] = json.valueRanges.map((item,index) =>
    rowsFromValues(item.values,Object.values(HEADERS)[index]));
  if (registry.length !== 420 || new Set(registry.map(row=>row.imo)).size !== 420 ||
      registry.some(row=>!allowedImos.has(row.imo))) throw new Error('PSC_VESSEL_CATALOGUE_MISMATCH');
  const valid = row => row.sourceSystem === PSC_SOURCE && row.dataNature === 'SYNTHETIC_NOT_RIYADH_MOU';
  if (!registry.every(valid)||!inspections.every(valid)||!detentions.every(valid)||
      !deficiencies.every(row=>row.sourceSystem===PSC_SOURCE&&row.dataNature==='SIMULATED_NOT_OFFICIAL'))
    throw new Error('PSC_SOURCE_PROVENANCE_MISMATCH');
  const inspectionIds=new Set(inspections.map(row=>row.inspectionId));
  if (inspections.some(row=>!allowedImos.has(row.imo)) ||
      deficiencies.some(row=>!allowedImos.has(row.imo)||!inspectionIds.has(row.inspectionId)) ||
      detentions.some(row=>!allowedImos.has(row.imo)||!inspectionIds.has(row.inspectionId))) {
    throw new Error('PSC_REFERENTIAL_INTEGRITY_FAILURE');
  }
  return {registry,inspections,deficiencies,detentions};
}
async function getDataset() {
  if (PSC_SOURCE_MODE === 'snapshot') return {dataset:localSnapshot,mode:'LOCAL_FIXTURE_SNAPSHOT'};
  if (PSC_SOURCE_MODE !== 'google_sheets') throw new Error('INVALID_PSC_SOURCE_MODE');
  if (cache && Date.now() < cache.expires) return {dataset:cache.dataset,mode:'GOOGLE_SHEETS_LIVE'};
  if (!pending) {
    pending = readLiveSheet().then(dataset => {
      cache = {dataset,expires:Date.now()+CACHE_TTL_MS};
      return dataset;
    }).finally(() => {pending = null;});
  }
  return {dataset:await pending,mode:'GOOGLE_SHEETS_LIVE'};
}
/**
 * Fail closed when Google credentials or the workbook are unavailable.
 * Never silently substitute fixture snapshots when google_sheets mode is selected.
 */
export async function getPscVessel(imo) {
  if (!/^\d{7}$/.test(String(imo)) || !allowedImos.has(String(imo))) {
    const error = new Error('UNKNOWN_VESSEL_IMO');error.status=404;throw error;
  }
  const {dataset,mode}=await getDataset();
  const vessel=dataset.registry.find(item=>item.imo===String(imo));
  if (!vessel) throw new Error('PSC_VESSEL_NOT_IN_WORKBOOK');
  const inspections=dataset.inspections.filter(row=>row.imo===String(imo))
    .sort((a,b)=>b.inspectionDate.localeCompare(a.inspectionDate));
  const deficiencies=dataset.deficiencies.filter(row=>row.imo===String(imo));
  const detentions=dataset.detentions.filter(row=>row.imo===String(imo));
  const evidenceIds=[...inspections.map(r=>r.inspectionId),...deficiencies.map(r=>r.deficiencyId),...detentions.map(r=>r.detentionId)];
  if (inspections.length !== vessel.externalInspectionCount) throw new Error('PSC_VESSEL_COUNT_MISMATCH');
  const coverage=inspections.length?'SIMULATED_RECORDS':'NO_RECORD_IN_FIXTURE';
  return {
    // Actual registry row values; do not infer these from the internal fixture.
    imo:vessel.imo,vesselName:vessel.vesselName,
    flag:vessel.flag,vesselType:vessel.vesselType,operator:vessel.operator,
    sourceSystem:PSC_SOURCE, datasetVersion:PSC_VERSION, sourceMode:mode,
    dataNature:'SYNTHETIC_NOT_RIYADH_MOU', authoritative:false,
    externalEvidenceVerified:false, pdfContentAvailable:false, coverage,
    asOf:'2026-10-08', retrievedAt:new Date().toISOString(),
    googleSheetsConnected:mode==='GOOGLE_SHEETS_LIVE',
    inspections,deficiencies,detentions,evidenceIds,
    summary: {inspections:inspections.length,deficiencies:deficiencies.length,
      openDeficiencies:deficiencies.filter(d=>d.status==='OPEN').length,
      detentions:detentions.length},
    disclaimer:'Fictional external PSC test fixtures, NOT actual Riyadh MoU/port authority reports. No PDF evidence uploaded.'
  };
}
export function getPscHealth() {
  return {status:'ok',sourceMode:PSC_SOURCE_MODE,googleSheetsConfigured:PSC_SOURCE_MODE==='google_sheets',
    liveDataConnected:PSC_SOURCE_MODE==='google_sheets'&&Boolean(cache),
    datasetVersion:PSC_VERSION,expectedVessels:vessels.length,refreshSeconds:CACHE_TTL_MS/1000};
}
