/**
 * Derive deterministic A03 risk and structural cross-source checks from
 * citation-validated, version-current documents. Unreviewed extracts are
 * provisional and NEVER count as authenticated statutory certificates.
 * DocumentIntegrity measures inconsistencies, not expiry/compliance risk,
 * which belongs to A02's separate 'certificate' factor.
 */
const canonical=x=>String(x??'').normalize('NFKC').trim().toUpperCase().replace(/[^\p{L}\p{N}]/gu,'');
const dateString=x=>{
  if(!x)return null;
  const ts=Date.parse(String(x));
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
