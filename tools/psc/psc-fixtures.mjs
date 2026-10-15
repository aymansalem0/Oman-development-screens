/**
 * Reproducible EXTERNAL PSC data fixture generator for the NMC POC.
 * Every record is synthetic, NOT Riyadh MoU data and NOT a real PSC finding.
 * Does not use vessel.risk or pre-existing MOEI deficiency scores to generate
 * external inspections: findings are built independently from IMO/id/type/age.
 */
export const PSC_SOURCE = 'NMC_POC_EXTERNAL_PSC_SIMULATED';
export const PSC_VERSION = 'PSC-SIM-v1.0';

const FLAGS = ['UAE','Liberia','Panama','Marshall Is.','Singapore','Malta','Hong Kong','Bahamas'];
const TYPES = ['Cargo','Tanker','Container','Bulk Carrier','Passenger','Offshore','Tug'];
const PORTS = [
  ['Sohar', 'Oman'], ['Salalah', 'Oman'], ['Muscat', 'Oman'],
  ['Hamad', 'Qatar'], ['Khalifa', 'UAE'], ['Jebel Ali', 'UAE'],
  ['Dammam', 'Saudi Arabia'], ['Kuwait', 'Kuwait'], ['Khalifa Bin Salman', 'Bahrain']
];
const FINDINGS = [
  ['FIRE_SAFETY','07109','Fire detection and alarm maintenance deficiency','Confirm functional test and corrective maintenance'],
  ['LIFE_SAVING','11101','Life-saving appliance inspection records incomplete','Verify records and inspect affected appliances'],
  ['NAVIGATION','10109','Navigation equipment test evidence incomplete','Perform system test and provide record'],
  ['POLLUTION','14104','Oil pollution prevention checklist discrepancy','Reconcile records and verify pollution control'],
  ['MACHINERY','13101','Machinery maintenance record deficiency','Review maintenance log and corrective evidence'],
  ['ISM','15106','Safety management procedure not fully evidenced','Review ISM corrective-action trail'],
  ['DOCUMENTS','01105','Required document copy not available at inspection','Provide controlled document copy']
];
const dateBase = Date.UTC(2026, 9, 8);
const dateStr = daysAgo => new Date(dateBase - daysAgo * 86400000).toISOString().slice(0, 10);
const hash = (n, salt = 0) => (((n * 2654435761 + salt * 2246822519) >>> 0) ^ ((n * 97 + salt * 37) >>> 0)) >>> 0;
const pad = (n, width = 4) => String(n).padStart(width, '0');

/** Build the EXACT 420 ID/IMO/name/flag/type/operator/year catalogue from repo TS fixture sources. */
export function catalogFromNmcSource(baseTs, expandedTs) {
  const base = [];
  const lines = baseTs.match(/^\s*\{id:\d+,name:[^\n]+\},?$/gm) || [];
  for (const line of lines) {
    const readStr = key => {
      const found = line.match(new RegExp('\\b' + key + ":'([^']*)'"));
      if (!found) throw new Error('Missing ' + key + ' in base catalog');
      return found[1];
    };
    const readInt = key => {
      const found = line.match(new RegExp('\\b' + key + ':(\\d+)'));
      if (!found) throw new Error('Missing ' + key + ' in base catalog');
      return Number(found[1]);
    };
    base.push({
      id: readInt('id'), name: readStr('name'), imo: readStr('imo'),
      flag: readStr('flag'), type: readStr('type'),
      operator: readStr('operator'), built: readInt('built')
    });
  }
  if (base.length !== 30) throw new Error('Expected exactly 30 base vessels, got ' + base.length);
  const parseArray = name => {
    const m = expandedTs.match(new RegExp('const ' + name + ' = \\[([\\s\\S]*?)\\];'));
    if (!m) throw new Error('Missing array ' + name);
    return Array.from(m[1].matchAll(/'([^']+)'/g), z => z[1]);
  };
  const prefixes = parseArray('prefixes'), suffixes = parseArray('suffixes');
  const flags = parseArray('flags'), types = parseArray('types');
  if (flags.length !== 8 || types.length !== 7) throw new Error('Unexpected generated catalogue configuration');
  const seenNames = new Set(base.map(v => v.name));
  const generated = [];
  for (let id = 31; id <= 420; id++) {
    const n = id - 31;
    const prefix = prefixes[n % prefixes.length];
    const suffix = suffixes[Math.floor(n / prefixes.length) % suffixes.length];
    const candidate = prefix + ' ' + suffix;
    const name = seenNames.has(candidate) ? candidate + ' II' : candidate;
    const flag = flags[id % flags.length];
    const type = types[(id * 3) % types.length];
    const six = String(940000 + id).slice(-6).padStart(6,'0');
    const check = six.split('').reduce((sum, digit, index) => sum + Number(digit) * [7,6,5,4,3,2][index],0) % 10;
    generated.push({
      id, name, imo: six + check, flag, type,
      operator: flag === 'UAE' ? prefix + ' Maritime Services LLC' : prefix + ' Ship Management',
      built: 1998 + ((id * 7) % 27)
    });
  }
  const combined = base.concat(generated);
  if (combined.length !== 420 || new Set(combined.map(x=>x.imo)).size !== 420) {
    throw new Error('Bad vessel catalogue: duplicate/missing IMO');
  }
  return combined;
}

/** independent historical PSC fixture generation keyed by vessel ID and vessel attributes */
export function generateExternalPsc(vessels) {
  const registry=[], inspections=[], deficiencies=[], detentions=[];
  for (const vessel of vessels) {
    const age = 2026 - vessel.built;
    const vesselSeed = hash(vessel.id, 10);
    const count = vessel.id % 29 === 0 ? 0 : 2 + (hash(vessel.id, 11) % 4);
    registry.push({
      vesselId:vessel.id, imo:vessel.imo, vesselName:vessel.name, flag:vessel.flag,
      vesselType:vessel.type, operator:vessel.operator, built:vessel.built,
      externalInspectionCount:count, coverage:count ? 'SIMULATED_RECORDS' : 'NO_RECORD_IN_FIXTURE',
      sourceSystem:PSC_SOURCE, datasetVersion:PSC_VERSION, dataNature:'SYNTHETIC_NOT_RIYADH_MOU'
    });
    for (let k=0;k<count;k++) {
      const recordKey = hash(vessel.id, 30+k);
      const inspectionId = 'PSC-SIM-' + pad(vessel.id) + '-' + pad(k+1,2);
      const [port,country] = PORTS[hash(vessel.id,41+k) % PORTS.length];
      const date = dateStr(18+(hash(vessel.id,65)%75)+k*190 + (k%2)*17);
      let items = hash(vessel.id,17+k)%100 < (age >= 20 ? 67 : age >= 12 ? 51 : 34)
        ? 1 + (hash(vessel.id,22+k)%3) : 0;
      if (vessel.imo==='9328471' && k===0) items=2; // specifically scripted SYNTHETIC high-concern demonstration
      if (vessel.imo==='9904410') items= k===0?0:items; // scripted routine demonstration
      const incoming=[];
      for (let j=0;j<items;j++){
        const f = FINDINGS[hash(vessel.id,60+k*17+j)%FINDINGS.length];
        let severity = hash(vessel.id,70+k*11+j)%100 < 11 ? 'CRITICAL' :
          hash(vessel.id,71+k*11+j)%100 < 38 ? 'MAJOR' : 'MINOR';
        if (vessel.imo==='9328471' && k===0 && j===0) severity='CRITICAL';
        const closed = hash(vessel.id,95+k*13+j)%100 < (k===0?42:85);
        const deficiencyId = inspectionId + '-DEF-' + pad(j+1,2);
        const rec = {
          deficiencyId, inspectionId, imo:vessel.imo, inspectionDate:date,
          deficiencyCode:f[1], category:f[0], severity, status:closed?'CLOSED':'OPEN',
          description:f[2], recommendedCorrectiveAction:f[3],
          closedDate:closed?dateStr(Math.max(0, 5+(hash(vessel.id,124+k+j)%25)+k*190)):'',
          evidenceStatus:'NO_SUPPORTING_PDF_UPLOADED',
          sourceSystem:PSC_SOURCE, dataNature:'SIMULATED_NOT_OFFICIAL'
        };
        incoming.push(rec); deficiencies.push(rec);
      }
      const canDetain = incoming.some(x=>x.severity==='CRITICAL'||x.severity==='MAJOR');
      const detained = canDetain && (hash(vessel.id,151+k)%100 < 13 || (vessel.imo==='9328471'&&k===0));
      const open = incoming.filter(x=>x.status==='OPEN').length;
      const status = detained ? 'DETAINED_AND_RELEASED' : incoming.length?'DEFICIENCIES_FOUND':'NO_DEFICIENCIES';
      inspections.push({
        inspectionId, imo:vessel.imo, vesselName:vessel.name, inspectionDate:date,
        port,country, inspectionType:'PORT_STATE_CONTROL_SIMULATION',
        result:status, deficiencyCount:incoming.length, openDeficiencies:open,
        detained, followUpRequired:open>0, sourceSystem:PSC_SOURCE,
        reportPdfStatus:'NOT_UPLOADED', reportRef:'',
        dataNature:'SYNTHETIC_NOT_RIYADH_MOU'
      });
      if (detained) {
        detentions.push({
          detentionId:'DET-'+inspectionId, inspectionId, imo:vessel.imo,
          detentionDate:date, port, country,
          reason:incoming.filter(x=>x.severity!=='MINOR').map(x=>x.category).join(' / '),
          releaseDate:dateStr(Math.max(0, 18+(hash(vessel.id,65)%75)+k*190+(k%2)*17 - (1+recordKey%6))),
          status:'RELEASED_IN_SYNTHETIC_FIXTURE',
          sourceSystem:PSC_SOURCE, dataNature:'SYNTHETIC_NOT_RIYADH_MOU'
        });
      }
    }
  }
  return {registry,inspections,deficiencies,detentions,meta:{
    sourceSystem:PSC_SOURCE, version:PSC_VERSION, vesselCount:registry.length,
    inspectionCount:inspections.length, deficiencyCount:deficiencies.length,
    detentionCount:detentions.length, vesselsWithoutHistory:registry.filter(x=>x.externalInspectionCount===0).length,
    asOf:'2026-10-08', sourceOfTruth:'Synthetic POC fixture (independent of baseRisk)',
    legalDisclaimer:'NOT Riyadh MoU data. All vessel-associated findings are fictional and must never be presented as verified PSC records.'
  }};
}

export function csvEncode(rows,headers) {
  const escape = v => {
    const s=String(v===null||v===undefined?'':v);
    return /[",\r\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;
  };
  return [headers.join(','),...rows.map(row=>headers.map(h=>escape(row[h])).join(','))].join('\r\n')+'\r\n';
}
