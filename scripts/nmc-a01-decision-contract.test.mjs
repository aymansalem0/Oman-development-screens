import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const contract=JSON.parse(readFileSync(new URL(
  '../docs/contracts/examples/nmc-a01-case-decision-9328471.example.json',
  import.meta.url),'utf8'));

const ACTION_TYPES=new Set([
  'VERIFY_CERTIFICATE','ENHANCED_MONITORING','PRIORITY_INSPECTION',
  'REVIEW_DEFICIENCY','VERIFY_DEFICIENCY_CLOSURE',
  'REQUEST_EXTERNAL_VERIFICATION','NO_ACTION'
]);
const bilingual=item=>['titleAr','titleEn','rationaleAr','rationaleEn',
  'expectedOutcomeAr','expectedOutcomeEn'].every(k=>
  typeof item[k]==='string'&&item[k].trim().length>=15);

test('A01 contract fixture has exactly one primary case decision and preserves saved risk',()=>{
  assert.equal(contract.schemaVersion,'nmc-case-decision.v1');
  assert.equal(contract.sourceRisk.score,60);
  assert.equal(contract.sourceRisk.level,'Watch');
  assert.equal(contract.sourceRisk.immutable,true);
  assert.ok(contract.primaryProposedDecision);
  assert.ok(bilingual(contract.primaryProposedDecision));
  assert.ok(['REVIEW_REQUIRED','PENDING_EXTERNAL_OUTCOME'].includes(
    contract.primaryProposedDecision.finality));
  assert.ok(contract._fixtureNotice.includes('Not an Airia response'));
});

test('The primary decision cites real fixture evidence IDs and all referenced actions',()=>{
  const decision=contract.primaryProposedDecision;
  const actions=contract.proposedActions;
  const ids=new Set(actions.map(a=>a.actionId));
  const availableEvidence=new Set(contract.evidence.flatMap(e=>e.evidenceIds));
  assert.equal(ids.size,actions.length,'action IDs must be unique');
  assert.ok(decision.requestedActionIds.length>0);
  assert.ok(decision.requestedActionIds.every(id=>ids.has(id)));
  assert.ok(decision.evidenceIds.length>0);
  assert.ok(decision.evidenceIds.every(id=>availableEvidence.has(id)));
  assert.ok(actions.every(a=>a.evidenceIds.every(id=>availableEvidence.has(id))));
});

test('Actions preserve existing allowed types and have specific operator-readable reasons',()=>{
  const actions=contract.proposedActions;
  assert.ok(actions.every(a=>ACTION_TYPES.has(a.actionType)));
  assert.ok(actions.every(a=>a.requiresHumanApproval===true));
  assert.ok(actions.every(a=>['titleAr','titleEn','businessReasonAr','businessReasonEn']
    .every(k=>typeof a[k]==='string'&&a[k].trim().length>=15)));
  assert.ok(actions.every(a=>a.reason!=='A01 recommendation linked to the validated source evidence IDs'));
  assert.ok(actions.every(a=>a.dependsOnActionIds.every(id=>
    actions.some(b=>b.actionId===id)&&id!==a.actionId)));
});

test('Unverified simulated external PSC does not authorize closure or risk changes',()=>{
  assert.equal(contract.decisionReadiness,'REQUIRES_VERIFICATION');
  assert.ok(contract.primaryProposedDecision.uncertainties.some(x=>
    x.kind==='CONFLICTING_SOURCES'));
  assert.ok(contract.primaryProposedDecision.outcomeVerification);
  assert.equal(contract.primaryProposedDecision.externalExecutionSuggested,true);
  assert.equal(contract.proposedActions.find(a=>a.actionType==='PRIORITY_INSPECTION')
    .relationship,'CONDITIONAL_STEP');
});
