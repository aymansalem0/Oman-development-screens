/**
 * NMC V1 structural data-quality and cross-source disagreement analyzer.
 * This is a deterministic, non-AI comparison of SYNTHETIC_POC inputs.
 * A high structural score is NOT a confidence/truth/authenticity score.
 * No undocumented source records, conflicts, verified PDFs or authority approval.
 */
import {documentEvidenceChecks} from './document-risk-evidence.mjs';
const FIELDS=[
  {field:'VESSEL_NAME',internal:'name',external:'vesselName'},
  {field:'FLAG',internal:'flag',external:'flag'},
  {field:'VESSEL_TYPE',internal:'vesselType',external:'vesselType'},
  {field:'OPERATOR_NAME',internal:'operator',external:'operator'}
];
const clean=v=>typeof v==='string'?v.normalize('NFKC').trim().replace(/\s+/g,' '):'';
const canonical=v=>clean(v).toUpperCase().replace(/[^\p{L}\p{N}]/gu,'');
const clamp=n=>Math.min(100,Math.max(0,Math.round(n)));

export function evaluateDataQuality({bundle,psc,signals,documents=[]}){
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
  const fieldComparisons=[];
  const disagreements=[];
  const values=[];
  for(const field of FIELDS){
    const a=clean(internal[field.internal]);
    const b=clean(psc[field.external]);
    values.push(Boolean(a),Boolean(b));
    const available=Boolean(a)&&Boolean(b);
    const matched=available&&canonical(a)===canonical(b);
    fieldComparisons.push({
      field:field.field,internalValue:a||null,externalValue:b||null,
      internalSource:'NMC_INTERNAL_SIM',externalSource:'PSC_GOOGLE_SIM',
      internalEvidenceId:(bundle.evidenceIds||[]).includes('VES-'+internalId)?'VES-'+internalId:null,
      externalEvidenceId:null, // The synthetic PSC registry row provides no stable record ID.
      status:!available?'MISSING':matched?'MATCHED':'MISMATCH',
      comparisonRule:'Unicode NFKC; trim; collapse whitespace; case-insensitive; ignore punctuation.'
    });
    if(!available)continue; // Missing values are missing, not proof of disagreement.
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

  const internalIds=new Set(bundle.evidenceIds||[]);
  const externalIds=new Set(psc.evidenceIds||[]);
  const documentChecks=documentEvidenceChecks({imo:internalId,documents,
    certificates:bundle.inlineContext?.certificates||[]});
  const documentIds=new Set(documentChecks.evidenceIds);
  const knownIds=new Set([...internalIds,...externalIds,...documentIds]);
  const evidenceLinkages=(signals||[]).flatMap(signal=>
    (Array.isArray(signal.evidenceIds)?signal.evidenceIds:[]).map(id=>({
      factor:signal.factor||'UNKNOWN',agent:signal.sourceAgent||'NOT_RECORDED',
      evidenceId:id,matched:knownIds.has(id),
      source:internalIds.has(id)?'NMC_INTERNAL_SIM':externalIds.has(id)?'PSC_GOOGLE_SIM':documentIds.has(id)?'A03_DRIVE_SYNTHETIC':'UNKNOWN'
    })));
  const links=evidenceLinkages.map(row=>row.evidenceId);
  const linked=evidenceLinkages.filter(row=>row.matched).length;
  const completeness=clamp(values.filter(Boolean).length/values.length*100);
  const consistency=comparisons.length?clamp(comparisons.filter(c=>c.matched).length/comparisons.length*100):null;
  const evidenceCoverage=links.length?clamp(linked/links.length*100):null;
  // Current V1 heuristic treats source metadata as one all-or-nothing check,
  // not three separately weighted sub-scores.
  const provenanceChecks=[
    {field:'sourceSystem',value:psc.sourceSystem||null,present:Boolean(psc.sourceSystem)},
    {field:'datasetVersion',value:psc.datasetVersion||null,present:Boolean(psc.datasetVersion)},
    {field:'retrievedAt',value:psc.retrievedAt||null,present:Boolean(psc.retrievedAt)}
  ];
  const provenance=provenanceChecks.every(row=>row.present)?100:60;
  const insufficient=!comparisons.length||!links.length||evidenceCoverage===null;
  // Transparent structural heuristic. Synthetic source/absence of PDF evidence
  // cap at 75, avoiding a misleading 100% confidence claim.
  const hasA03=documentChecks.available;
  // Preserve the original four-metric formula for assessments with NO A03
  // evidence, avoiding a misleading 'perfect quality' from missing PDFs.
  // With document comparisons, reserve 15% for A03 cross-source consistency
  // while retaining the baseline metric mix proportionally (85%).
  const baselineRaw=completeness*.35+consistency*.30+
    evidenceCoverage*.20+provenance*.15;
  const uncapped=insufficient?null:Math.round(
    hasA03?baselineRaw*.85+documentChecks.consistencyPercent*.15:baselineRaw);
  // Proportional uncertainty discount: even one inconsistency lowers the score.
  // A simple cap would hide discrepancies until uncapped quality fell below 75.
  const score=uncapped===null?null:Math.min(75,Math.round(uncapped*.75));
  const metric=(key,label,percent,weight,numerator,denominator)=>({
    key,label,percent,weightPercent:weight,numerator,denominator,
    rawContribution:percent===null?null:Math.round(percent*weight)/100
  });
  const calculationSteps=[
    metric('completeness','Populated identity values',completeness,hasA03?29.75:35,
      values.filter(Boolean).length,values.length),
    metric('consistency','Matching compared identity fields',consistency,hasA03?25.5:30,
      comparisons.filter(row=>row.matched).length,comparisons.length),
    metric('evidenceLinkage','Recognized AI evidence references',evidenceCoverage,hasA03?17:20,linked,links.length),
    metric('provenance','PSC metadata rule: all 3 fields present = 100, otherwise = 60',provenance,hasA03?12.75:15,
      provenanceChecks.filter(row=>row.present).length,provenanceChecks.length)
  ];
  if(hasA03)calculationSteps.push(metric('documentConsistency',
    'A03 citation-validated synthetic document-vs-Vessel360 field agreement',
    documentChecks.consistencyPercent,15,documentChecks.matched,documentChecks.compared));
  for(const conflict of documentChecks.conflicts){
    disagreements.push({
      fieldName:conflict.field.slice(0,80),sourceA:'VESSEL_360_SYNTHETIC',
      sourceB:'A03_GOOGLE_DRIVE_SYNTHETIC',sourceAEvidenceId:'VES-'+internalId,
      sourceBEvidenceId:conflict.evidenceId,
      summary:'A03 compared '+conflict.documentType+' '+conflict.field+
        ': Vessel360='+conflict.sourceValue+'; Drive PDF='+conflict.documentValue+
        '. Both synthetic. Manual source verification required.'
    });
  }
  return {
    calculationStatus:insufficient?'INSUFFICIENT_EVIDENCE':'CALCULATED',
    calculationVersion:hasA03?'NMC Structural Quality 2.0 A03':'NMC Structural Quality 1.0',
    qualityScore:score,
    disagreements,
    breakdown:{
      scoreKind:'STRUCTURAL_QUALITY_NOT_DATA_CONFIDENCE',
      calculationVersion:hasA03?'NMC Structural Quality 2.0 A03':'NMC Structural Quality 1.0',
      calculationSteps,
      documentComparison:documentChecks,
      a03DocumentCount:documentChecks.documentCount,
      documentConsistencyPercent:documentChecks.consistencyPercent,
      documentComparisons:documentChecks.comparisons,
      fieldComparisons,
      evidenceLinkages,
      provenanceChecks,
      sourceProvenance:{
        internalSystem:'NMC_INTERNAL_SIM',
        externalSystem:'PSC_GOOGLE_SIM',
        pscSourceSystem:psc.sourceSystem||null,
        pscDatasetVersion:psc.datasetVersion||null,
        pscRetrievedAt:psc.retrievedAt||null,
        pscMode:psc.sourceMode,
        reconstruction:'SOURCE_AT_QUALITY_CALCULATION_TIME_NOT_HISTORICAL_PSC_SNAPSHOT'
      },
      matchingIdentityFields:comparisons.filter(row=>row.matched).length,
      identityValueSidesPresent:values.filter(Boolean).length,
      identityValueSidesExpected:values.length,
      evidenceReferencesLinked:linked,
      evidenceReferencesTotal:links.length,
      rawWeightedContributionMethod:'SUM(percent * weightPercent / 100), then round to whole score',
      syntheticDiscountFactor:0.75,
      finalScoreMethod:'MIN(75, ROUND(rawWeightedScore * 0.75))',
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
      a03Disagreements:documentChecks.mismatched,
      sourceMode:psc.sourceMode,
      sourceNature:'SYNTHETIC_NOT_RIYADH_MOU',
      verifiedByAuthority:false,
      externalReportPdfAvailable:psc.pdfContentAvailable===true,
      independentlyVerifiedDataConfidence:null,
      note:'Structural quality only. With A03, 15% covers grounded document cross-source comparisons (not issuer verification). Missing A03 remains UNKNOWN; no fake zero or 100. No accuracy probability is claimed.'
    }
  };
}
