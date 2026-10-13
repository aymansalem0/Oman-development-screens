/**
 * Derive deterministic A03 risk and structural cross-source checks from
 * citation-validated, version-current documents. Unreviewed extracts are
 * provisional and NEVER count as authenticated statutory certificates.
 * DocumentIntegrity measures inconsistencies, not expiry/compliance risk,
 * which belongs to A02's separate 'certificate' factor.
 */
const canonical=x=>String(x??'').normalize('NFKC').trim().toUpperCase().replace(/[^\p{L}\p{N}]/gu,'');
// Certificate source dates include maritime display format "17 Nov 2027".
// Date.parse on that non-ISO string is runtime/platform dependent (notably
// Windows Node 24), so normalize explicit English DD Mon YYYY deterministically.
// Do not interpret invalid/impossible dates as evidence of a mismatch.
const monthNumber=Object.freeze({JAN:1,FEB:2,MAR:3,APR:4,MAY:5,JUN:6,
  JUL:7,AUG:8,SEP:9,OCT:10,NOV:11,DEC:12});
const verifiedDate=(year,month,day)=>{
  const y=Number(year),m=Number(month),d=Number(day);
  if(!Number.isInteger(y)||y<1000||y>9999||
     !Number.isInteger(m)||m<1||m>12||
     !Number.isInteger(d)||d<1||d>31)return null;
  const at=new Date(Date.UTC(y,m-1,d));
  if(at.getUTCFullYear()!==y||at.getUTCMonth()!==m-1||
     at.getUTCDate()!==d)return null;
  return at.toISOString().slice(0,10);
};
const dateString=x=>{
  if(!x)return null;
  const value=String(x).trim();
  const maritime=value.match(/^(\\d{1,2})\\s+([A-Za-z]{3,9})\\s+(\\d{4})$/);
  if(maritime){
    const mon=monthNumber[maritime[2].slice(0,3).toUpperCase()];
    return mon?verifiedDate(maritime[3],mon,maritime[1]):null;
  }
  const simpleIso=value.match(/^(\\d{4})-(\\d{2})-(\\d{2})$/);
  if(simpleIso)return verifiedDate(simpleIso[1],simpleIso[2],simpleIso[3]);
  // RFC 3339 timestamp with explicit timezone is deterministic; non-standard
  // date formats must not silently acquire a locale-specific interpretation.
  if(!/^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|[+-]\\d{2}:\\d{2})$/i.test(value))
    return null;
  const ts=Date.parse(value);
  return Number.isFinite(ts)?new Date(ts).toISOString().slice(0,10):null;
};
const types=['construction','equipment','radio','security'];
const cleanStatus=x=>String(x||'').toUpperCase().replace(/[^A-Z]/g,'');
export function documentEvidenceChecks({imo,documents=[],certificates=[]}={}){
  const checks=[],conflicts=[];
  const valid=documents.filter(d=>d?.vesselImo===imo&&
    ['DRAFT_REVIEW','APPROVED'].includes(d.reviewStatus)&&
    d.sourceModifiedTime===d.analyzedModifiedTime&&
    /^GDOC-[a-f0-9]{20}$/.test(String(d.evidenceId||''))&&
    Array.isArray(d.documentEntries));
  const seen=new Set();
  for(const doc of valid){
    for(const entry of doc.documentEntries){
      const keyword=types.find(x=>String(entry.documentType||'').toLowerCase().includes(x));
      if(!keyword)continue;
      const baseline=certificates.find(c=>String(c.type||'').toLowerCase().includes(keyword));
      if(!baseline)continue;
      const comparable=[
        ['NUMBER',entry.certificateNumber,baseline.number,canonical],
        ['EXPIRY',dateString(entry.expiryDate),dateString(baseline.expiry),x=>x],
      ];
      for(const [field,documentValue,storedValue,normalizer] of comparable){
        if(!documentValue||!storedValue)continue;
        const id=keyword.toUpperCase()+'_'+field;
        if(seen.has(id))continue;seen.add(id);
        const match=normalizer(documentValue)===normalizer(storedValue);
        const record={field:'A03_'+id,
          sourceValue:String(storedValue).slice(0,200),
          documentValue:String(documentValue).slice(0,200),
          evidenceId:doc.evidenceId,documentType:entry.documentType,
          status:match?'MATCHED':'MISMATCH',
          source:'VESSEL_360_SYNTHETIC_VS_GOOGLE_DRIVE_SYNTHETIC',
          reviewStatus:doc.reviewStatus};
        checks.push(record);
        if(!match)conflicts.push(record);
      }
    }
  }
  const matchCount=checks.length-conflicts.length;
  // A mismatch has a POC impact only; it cannot automatically prove fraud.
  const score=checks.length?Math.round(matchCount*100/checks.length):null;
  return {available:checks.length>0,compared:checks.length,matched:matchCount,
    mismatched:conflicts.length,consistencyPercent:score,
    comparisons:checks,conflicts,
    documentCount:valid.length,evidenceIds:[...new Set(valid.map(x=>x.evidenceId))],
    provenance:'SYNTHETIC_A03_EXTRACTS_NOT_AUTHORITY_VERIFIED',
    note:'POC cross-source disagreement, not proof which source is correct. Human/issuer verification needed.'};
}
export function documentIntegritySignal(checks){
  if(!checks?.available||!checks.evidenceIds?.length)return null;
  // Score ONLY unique cross-source document inconsistencies. Certificate
  // expiry/condition and document missingness are considered by A02/quality,
  // preventing double-counting the same statutory failure.
  return {
    factor:'documentIntegrity',sourceAgent:'A03',
    status:'AVAILABLE',severity:Math.min(100,checks.mismatched*25),
    confidence:0.65, // fixed POC evidence-quality indicator, NOT probability
    evidenceIds:checks.evidenceIds.slice(0,30),
    reason:'Synthetic document-vs-Vessel360 mismatches='+checks.mismatched+
      ', compared='+checks.compared+
      '. A03 extractions have grounded quotations; no authority authenticity verification.'
  };
}
