import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateDataQuality} from '../data-quality.mjs';

const base=()=>({
 bundle:{imo:'9328471',evidenceIds:['VES-9328471'],
   inlineContext:{vessel:{imo:'9328471',name:'MV Gulf Horizon',
     flag:'Liberia',vesselType:'Cargo',operator:'Blue Meridian Marine'}}},
 psc:{imo:'9328471',vesselName:'MV Gulf Horizon',flag:'Liberia',vesselType:'Cargo',
   operator:'Blue Meridian Marine',sourceSystem:'SYNTHETIC_PSC',
   datasetVersion:'2026-10-08',retrievedAt:'2026-10-09T06:00:00.000Z',
   authoritative:false,dataNature:'SYNTHETIC_NOT_RIYADH_MOU',
   sourceMode:'GOOGLE_SHEETS_LIVE',pdfContentAvailable:false,
   evidenceIds:['PSC-SIM-0001-01']},
 signals:[{factor:'movement',evidenceIds:['VES-9328471']},
   {factor:'inspection',evidenceIds:['PSC-SIM-0001-01']}]
});

test('fully structurally consistent synthetic evidence caps at 75; NEVER claims confidence',()=>{
 const out=evaluateDataQuality(base());
 assert.equal(out.calculationStatus,'CALCULATED');
 assert.equal(out.qualityScore,75);
 assert.equal(out.disagreements.length,0);
 assert.equal(out.breakdown.comparedFields,4);
 assert.equal(out.breakdown.identityValueSidesPresent,8);
 assert.equal(out.breakdown.identityValueSidesExpected,8);
 assert.equal(out.breakdown.evidenceReferencesLinked,2);
 assert.equal(out.breakdown.evidenceReferencesTotal,2);
 assert.deepEqual(out.breakdown.calculationSteps.map(step=>step.rawContribution),[35,30,20,15]);
 assert.equal(out.breakdown.rawScoreBeforeSyntheticCap,100);
 assert.equal(out.breakdown.syntheticDiscountFactor,.75);
 assert.deepEqual(out.breakdown.fieldComparisons.map(f=>f.status),
   ['MATCHED','MATCHED','MATCHED','MATCHED']);
 assert.equal(out.breakdown.fieldComparisons[0].internalValue,'MV Gulf Horizon');
 assert.equal(out.breakdown.fieldComparisons[0].externalValue,'MV Gulf Horizon');
 assert.equal(out.breakdown.evidenceLinkages.length,2);
 assert.ok(out.breakdown.evidenceLinkages.every(link=>link.matched));
 assert.equal(out.breakdown.independentlyVerifiedDataConfidence,null);
 assert.equal(out.breakdown.verifiedByAuthority,false);
});

test('different populated PSC flag generates one data conflict using only actual evidence IDs',()=>{
 const data=base();
 data.psc.flag='Panama';
 const out=evaluateDataQuality(data);
 assert.equal(out.disagreements.length,1);
 assert.equal(out.disagreements[0].fieldName,'FLAG');
 const compared=out.breakdown.fieldComparisons.find(row=>row.field==='FLAG');
 assert.equal(compared.internalValue,'Liberia');
 assert.equal(compared.externalValue,'Panama');
 assert.equal(compared.status,'MISMATCH');
 assert.equal(out.breakdown.matchingIdentityFields,3);
 assert.equal(out.disagreements[0].sourceAEvidenceId,'VES-9328471');
 assert.equal(out.disagreements[0].sourceBEvidenceId,null);
 assert.ok(out.qualityScore<75);
});

test('missing PSC field is a completeness gap, not a fabricated conflict',()=>{
 const data=base();
 data.psc.flag='';
 const out=evaluateDataQuality(data);
 assert.equal(out.disagreements.length,0);
 assert.equal(out.breakdown.missingFieldSides,1);
 assert.equal(out.breakdown.comparedFields,3);
 assert.equal(out.breakdown.fieldComparisons.find(row=>row.field==='FLAG').status,'MISSING');
 assert.equal(out.breakdown.identityValueSidesPresent,7);
});

test('rejects wrong IMO or incorrectly claimed authoritative provenance',()=>{
 const mismatch=base();mismatch.psc.imo='1234567';
 assert.throws(()=>evaluateDataQuality(mismatch),/QUALITY_SOURCE_PROVENANCE_INVALID/);
 const official=base();official.psc.authoritative=true;
 assert.throws(()=>evaluateDataQuality(official),/QUALITY_SOURCE_PROVENANCE_INVALID/);
});

test('missing signal evidence does not invent quality confidence',()=>{
 const data=base();data.signals=[];
 const out=evaluateDataQuality(data);
 assert.equal(out.qualityScore,null);
 assert.equal(out.calculationStatus,'INSUFFICIENT_EVIDENCE');
});

test('unknown evidence linkage lowers structural score without inventing source evidence',()=>{
 const data=base();data.signals[0].evidenceIds=['NON_EXISTENT_REFERENCE'];
 const out=evaluateDataQuality(data);
 assert.equal(out.breakdown.evidenceLinkagePercent,50);
 assert.equal(out.calculationStatus,'CALCULATED');
});

test('retains exact metadata presence versus the 60% fallback heuristic',()=>{
 const data=base();data.psc.datasetVersion='';
 const out=evaluateDataQuality(data);
 assert.equal(out.breakdown.provenanceMetadataPercent,60);
 assert.equal(out.breakdown.provenanceChecks.filter(x=>x.present).length,2);
 const row=out.breakdown.calculationSteps.find(x=>x.key==='provenance');
 assert.equal(row.percent,60);
 assert.equal(row.rawContribution,9);
 assert.equal(row.numerator,2);
 assert.equal(row.denominator,3);
});

test('the evidence trace records unknown IDs without pretending they are verified',()=>{
 const data=base();data.signals[0].evidenceIds=['MISSING-EVIDENCE'];
 const out=evaluateDataQuality(data);
 assert.equal(out.breakdown.evidenceLinkages[0].matched,false);
 assert.equal(out.breakdown.evidenceLinkages[0].source,'UNKNOWN');
 assert.equal(out.breakdown.evidenceReferencesLinked,1);
 assert.equal(out.breakdown.evidenceReferencesTotal,2);
});
