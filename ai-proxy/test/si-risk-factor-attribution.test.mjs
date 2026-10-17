import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {approvedFindingEvidence,verifiedFindingFactorAttribution,
 FIVE_NMC_RISK_FACTORS} from '../si-risk-factor-attribution.mjs';
import {approvedInspectionBundle} from '../si-post-inspection-risk.mjs';
import {NmcCaseWorkspace} from '../case-workspace.mjs';

const reportId=randomUUID(),inspectionId=randomUUID(),imo='9400368';
const report={id:reportId,status:'APPROVED',supervisor:'Independent reviewer',
 approvedAt:'2026-10-17T10:00:00Z',summary:'Two recorded and approved deficiencies'};
const findings=[
 {id:'F-FIRE-DOOR',checkId:'FIRE-DOOR',
  title:'Fire door damaged',severity:'MAJOR',
  description:'Observed damaged fire door during physical inspection',
  status:'CONFIRMED_BY_INSPECTOR',
  evidenceRefs:['SI-EVIDENCE:verified-photo']},
 {id:'F-CERT-EXPIRY',checkId:'CERT-EXPIRY',
  title:'Safety certificate expired',severity:'MINOR',
  description:'Certificate was verified expired against onboard documentation',
  status:'CONFIRMED_BY_INSPECTOR',evidenceRefs:['CERT-UPLOAD-012']}
];
const bundle={imo,evidenceIds:['VES-'+imo],
 inlineContext:{vessel:{imo,name:'Demo Vessel'},
  deficiencies:[],certificates:[],inspections:[]}};
const view={inspectionCase:{id:inspectionId,imo},
 record:{report,findings}};
const factors=['movement','inspection','certificate','dataQuality','history'];
const signals=(fs)=>factors.map((factor,i)=>({
 factor,sourceAgent:['movement','history'].includes(factor)?'A01':'A02',
 status:'AVAILABLE',severity:[30,75,70,35,42][i],
 confidence:0.84,reason:'Factor-level evidence assessment',
 evidenceIds:['VES-'+imo,...(fs[factor]||[])]
}));

test('approved confirmed inspector defects are individually identity-bound and published inside existing five-factor A01/A02 payload',()=>{
 const augmented=approvedInspectionBundle(bundle,view);
 const mapped=augmented.siFindingsForAttribution;
 assert.equal(FIVE_NMC_RISK_FACTORS.length,5);
 assert.deepEqual(FIVE_NMC_RISK_FACTORS.map(x=>x.factor),factors);
 assert.equal(mapped.length,2);
 assert.equal(new Set(mapped.map(x=>x.evidenceId)).size,2);
 assert.ok(mapped.every(x=>x.evidenceId.startsWith('SI-FINDING-')));
 assert.ok(mapped.every(x=>augmented.evidenceIds.includes(x.evidenceId)));
 assert.equal(augmented.inlineContext.postInspectionFactorAttribution.requiredFindingEvidenceIds.length,2);
 assert.equal(augmented.inlineContext.approvedInspectionReports[0].reportId,reportId);
 assert.equal(augmented.inlineContext.approvedInspectionReports[0].findings[0].evidenceId,mapped[0].evidenceId);
 assert.deepEqual(bundle.inlineContext.deficiencies,[],'never rewrite original synthetic vessel fixture');
 assert.deepEqual(approvedInspectionBundle(bundle,view).siFindingsForAttribution,mapped,'IDs deterministic across retries');
});

test('AI signal citations may connect one defect to more than one of five factors; unrelated factors are not attributed',()=>{
 const mapped=approvedFindingEvidence(report,findings);
 const refs=Object.fromEntries(mapped.map(x=>[x.findingId,x.evidenceId]));
 const output=signals({
  inspection:[refs['F-FIRE-DOOR']],
  certificate:[refs['F-CERT-EXPIRY']],
  history:[refs['F-FIRE-DOOR']]
 });
 const assessed=verifiedFindingFactorAttribution(mapped,output);
 assert.deepEqual(assessed[0].linkedFactors.map(x=>x.factor),['inspection','history']);
 assert.deepEqual(assessed[1].linkedFactors.map(x=>x.factor),['certificate']);
 assert.ok(assessed.every(x=>x.attributionStatus==='AI_SIGNAL_CITED_VERIFIED_FINDING'));
 assert.deepEqual(output.filter(x=>x.factor==='movement'||x.factor==='dataQuality')
  .flatMap(x=>x.evidenceIds.filter(id=>id.startsWith('SI-FINDING-'))),[]);
});

test('missing citation of any approved defect blocks risk persist; no keyword or severity fallback',()=>{
 const mapped=approvedFindingEvidence(report,findings);
 const output=signals({inspection:[mapped[0].evidenceId]});
 assert.throws(()=>verifiedFindingFactorAttribution(mapped,output),
  /SI_RISK_AI_DID_NOT_ATTRIBUTE_EVERY_DEFECT/);
 assert.throws(()=>verifiedFindingFactorAttribution(mapped,
   output.map(x=>({...x,evidenceIds:['SI-FINDING-invented']}))),
  /SI_RISK_AI_DID_NOT_ATTRIBUTE_EVERY_DEFECT/);
 assert.throws(()=>approvedFindingEvidence(report,[{...findings[0],evidenceRefs:[]}]),
  /SI_RISK_INSPECTOR_FINDING_NOT_VERIFIED/);
 assert.throws(()=>approvedFindingEvidence({...report,status:'PENDING_REVIEW'},findings),
  /SI_RISK_APPROVED_FINDINGS_INVALID/);
 assert.deepEqual(verifiedFindingFactorAttribution([],signals({})),[]);
});

test('persist fact-based new risk and defect attribution without creating a fake historical baseline',async()=>{
 const mapped=approvedFindingEvidence(report,findings);
 const links=verifiedFindingFactorAttribution(mapped,signals({
  inspection:[mapped[0].evidenceId],certificate:[mapped[1].evidenceId]
 }));
 const temp=mkdtempSync(join(tmpdir(),'nmc-si-five-factor-'));
 try{
  const cases=new NmcCaseWorkspace({mode:'json',file:join(temp,'cases.json'),
   alerts:{},singleDecisionMode:true});
  const opened=await cases.fromSiInspection({
   inspectionId,imo,reportId,summary:report.summary,
   supervisor:report.supervisor});
  assert.equal(opened.sourceAssessmentId,null);
  assert.equal(opened.sourceScore,null);
  const factorChanges=factors.map((factor,i)=>({
   factor,previous:null,current:[30,75,70,35,42][i],
   reason:'AI assessment cites verified inspector evidence',
   evidenceIds:links.flatMap(f=>f.linkedFactors.filter(x=>x.factor===factor)
    .map(x=>x.sourceEvidenceId))
  }));
  const result=await cases.recordPostInspectionRisk(opened.id,{
   eventId:inspectionId+':'+reportId,inspectionId,reportId,imo,
   assessmentId:randomUUID(),previousAssessmentId:null,
   previousScore:null,previousLevel:null,
   newScore:54,newLevel:'Watch',policyVersion:'MOEI-Published-v1',
   evidenceId:'SI-REPORT-'+reportId,
   factorChanges,findingFactorAttribution:links
  });
  assert.equal(result.sourceAssessmentId,null);
  assert.equal(result.operationalRisk.score,54);
  assert.equal(result.operationalRisk.previousScore,null);
  assert.equal(result.operationalRisk.factorAttribution.length,2);
  assert.equal(result.postInspectionRiskHistory.length,1);
  assert.equal(result.postInspectionRiskHistory[0].factorChanges.length,5);
  assert.equal(result.postInspectionRiskHistory[0].findingFactorAttribution.length,2);
  assert.equal(result.operationalRisk.regulatoryDecision,false);
  const same=await cases.recordPostInspectionRisk(opened.id,{
   eventId:inspectionId+':'+reportId,inspectionId,reportId,imo,
   assessmentId:randomUUID(),newScore:10,newLevel:'Normal',
   evidenceId:'SI-REPORT-'+reportId,factorChanges,findingFactorAttribution:links
  });
  assert.equal(same.operationalRisk.score,54,'idempotent event must not overwrite risk');
 }finally{rmSync(temp,{recursive:true,force:true});}
});
