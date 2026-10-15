/**
 * Re-export reproducible PSC fixtures from the repo's 420 synthetic vessel IDs.
 *
 * Run from repo root: node tools/psc/export-psc.mjs
 * Output: data/generated/external-psc-v1/{Vessels,Inspections,Deficiencies,Detentions}.csv
 * This does NOT query Riyadh MoU or connect to Google Drive.
 */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { catalogFromNmcSource, generateExternalPsc, csvEncode } from './psc-fixtures.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const base = readFileSync(resolve(repo, 'src/app/data/nmc-vessel-catalog.ts'), 'utf8');
const expanded = readFileSync(resolve(repo, 'src/app/data/nmc-expanded-vessel-catalog.ts'), 'utf8');
const vessels = catalogFromNmcSource(base, expanded);
const data = generateExternalPsc(vessels);
const output = resolve(repo, 'data/generated/external-psc-v1');
mkdirSync(output, { recursive: true });

const formats = [
  ['Vessels.csv', data.registry, [
    'vesselId','imo','vesselName','flag','vesselType','operator','built',
    'externalInspectionCount','coverage','sourceSystem','datasetVersion','dataNature'
  ]],
  ['Inspections.csv', data.inspections, [
    'inspectionId','imo','vesselName','inspectionDate','port','country','inspectionType',
    'result','deficiencyCount','openDeficiencies','detained','followUpRequired',
    'sourceSystem','reportPdfStatus','reportRef','dataNature'
  ]],
  ['Deficiencies.csv', data.deficiencies, [
    'deficiencyId','inspectionId','imo','inspectionDate','deficiencyCode',
    'category','severity','status','description','recommendedCorrectiveAction',
    'closedDate','evidenceStatus','sourceSystem','dataNature'
  ]],
  ['Detentions.csv', data.detentions, [
    'detentionId','inspectionId','imo','detentionDate','port','country',
    'reason','releaseDate','status','sourceSystem','dataNature'
  ]]
];

for (const [name, rows, headers] of formats) {
  writeFileSync(resolve(output, name), csvEncode(rows, headers), 'utf8');
  console.log(name + ': ' + rows.length + ' records');
}
writeFileSync(resolve(output, 'metadata.json'), JSON.stringify(data.meta, null, 2)+'\n','utf8');
console.log('All records are FICTIONAL PSC SIMULATION and must not be presented as real Riyadh MoU records.');
