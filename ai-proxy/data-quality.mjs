/**
 * NMC V1 structural data-quality and cross-source disagreement analyzer.
 * This is a deterministic, non-AI comparison of SYNTHETIC_POC inputs.
 * A high structural score is NOT a confidence/truth/authenticity score.
 * No undocumented source records, conflicts, verified PDFs or authority approval.
 */
const FIELDS=[
  {field:'VESSEL_NAME',internal:'name',external:'vesselName'},
  {field:'FLAG',internal:'flag',external:'flag'},
  {field:'VESSEL_TYPE',internal:'vesselType',external:'vesselType'},
  {field:'OPERATOR_NAME',internal:'operator',external:'operator'}
];
const clean=v=>typeof v==='string'?v.normalize('NFKC').trim().replace(/\s+/g,' '):'';
const canonical=v=>clean(v).toUpperCase().replace(/[^\p{L}\p{N}]/gu,'');
const clamp=n=>Math.min(100,Math.max(0,Math.round(n)));

export function evaluateDataQuality({bundle,psc,signals}){
  const internal=bundle?.inlineContext?.vessel;
  if(!internal || !psc || internal.imo!==psc.imo ||
     psc.authoritative!==false ||
     psc.dataNature!=='SYNTHETIC_NOT_RIYADH_MOU' ||
     !['GOOGLE_SHEETS_LIVE','LOCAL_FIXTURE_SNAPSHOT'].includes(psc.sourceMode))
    throw new Error('QUALITY_SOURCE_PROVENANCE_INVALID');
  const internalId=String(bundle.imo||'');
  if(internalId!==internal.imo||!/^\d{7}$/.test(internalId))
    throw new Error('QUALITY_VESSEL_ID_INVALID');

  const comparisons=[];
  const disagreements=[];
  const values=[];
  for(const field of FIELDS){
    const a=clean(internal[field.internal]);
    const b=clean(psc[field.external]);
    values.push(Boolean(a),Boolean(b));
    if(!a||!b)continue; // Missing values are missing, not proof of disagreement.
    const matched=canonical(a)===canonical(b);
    comparisons.push({field:field.field,matched});
    if(!matched)disagreements.push({
      fieldName:field.field,
      sourceA:'NMC_INTERNAL_SIM',sourceB:'PSC_GOOGLE_SIM',
      sourceAEvidenceId:(bundle.evidenceIds||[]).includes('VES-'+internalId)
        ?'VES-'+internalId:null,
      sourceBEvidenceId:null, // PSC registry lacks a stable evidence ID.
      summary:'Synthetic internal vessel fixture and synthetic PSC registry disagree on '+field.field+'. Authority verification required.'
    });
  }

  const knownIds=new Set([...(bundle.evidenceIds||[]),...(psc.evidenceIds||[])]);
  const links=(signals||[]).flatMap(signal=>Array.isArray(signal.evidenceIds)?signal.evidenceIds:[]);
  const linked=links.filter(id=>knownIds.has(id)).length;
  const completeness=clamp(values.filter(Boolean).length/values.length*100);
  const consistency=comparisons.length?clamp(comparisons.filter(c=>c.matched).length/comparisons.length*100):null;
  const evidenceCoverage=links.length?clamp(linked/links.length*100):null;
  const provenance=psc.sourceSystem&&psc.datasetVersion&&psc.retrievedAt?100:60;
  const insufficient=!comparisons.length||!links.length||evidenceCoverage===null;
  // Transparent structural heuristic. Synthetic source/absence of PDF evidence
  // cap at 75, avoiding a misleading 100% confidence claim.
  const uncapped=insufficient?null:Math.round(
    completeness*.35+consistency*.30+evidenceCoverage*.20+provenance*.15);
  const score=uncapped===null?null:Math.min(75,uncapped);
  return {
    calculationStatus:insufficient?'INSUFFICIENT_EVIDENCE':'CALCULATED',
    calculationVersion:'NMC Structural Quality 1.0',
    qualityScore:score,
    disagreements,
    breakdown:{
      scoreKind:'STRUCTURAL_QUALITY_NOT_DATA_CONFIDENCE',
      calculationVersion:'NMC Structural Quality 1.0',
      completenessPercent:completeness,
      consistencyPercent:consistency,
      evidenceLinkagePercent:evidenceCoverage,
      provenanceMetadataPercent:provenance,
      rawScoreBeforeSyntheticCap:uncapped,
      syntheticUnverifiedScoreCap:75,
      comparedFields:comparisons.length,
      missingFieldSides:values.length-values.filter(Boolean).length,
      disagreementCount:disagreements.length,
      conflictFields:disagreements.map(c=>c.fieldName),
      sourceMode:psc.sourceMode,
      sourceNature:'SYNTHETIC_NOT_RIYADH_MOU',
      verifiedByAuthority:false,
      externalReportPdfAvailable:psc.pdfContentAvailable===true,
      independentlyVerifiedDataConfidence:null,
      note:'Illustrative structural completeness/consistency score only. Synthetic records are not authority-verified. No accuracy probability is claimed.'
    }
  };
}
