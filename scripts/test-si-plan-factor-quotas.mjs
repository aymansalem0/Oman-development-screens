import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
import ts from 'typescript';

// Angular consumes the TypeScript source directly. Transpile the SAME pure
// calculation module under Node 20; no parallel production algorithm or mock
// reconstruction that can diverge from the UI.
const file='src/app/pages/si-plan-factor-quotas.ts';
const compiled=ts.transpileModule(readFileSync(file,'utf8'),{
 compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
}).outputText;
const exports={};
new Script('(function(exports){'+compiled+'\n})',{filename:file}).runInThisContext()(exports);
const {calculateInspectionFactorQuotas,isUaeFlag}=exports;
const vessel=(imo,{flag='PANAMA',sources=['PSC_PORT_CALL'],risk=null}={})=>({
 imo,flag,sourceTypes:sources,
 currentRisk:risk===null?null:{score:risk,level:'TEST_ASSESSED'}
});

test('PSC+risk and UAE flag percentages use separate denominator and never need to sum 100',()=>{
 const cohort=[
  vessel('9400101',{risk:91}),
  vessel('9400102',{risk:52,flag:'UAE'}),
  vessel('9400103',{risk:68}),
  vessel('9400104',{risk:30}),
  vessel('9400105',{sources:['SERVICE_REQUEST'],flag:'United Arab Emirates'}),
  vessel('9400106',{sources:['NMC_CASE'],flag:'AE'}),
  vessel('9400107',{sources:['SERVICE_REQUEST'],flag:'LIBERIA'})
 ];
 const p=calculateInspectionFactorQuotas(cohort,50,100);
 assert.equal(p.factors[0].eligibleVessels,4);
 assert.equal(p.factors[0].targetVessels,2);
 assert.deepEqual(p.factors[0].selectedImos,['9400101','9400103'],
  'PSC risk must be ranked using documented saved risk');
 assert.equal(p.factors[1].eligibleVessels,3);
 assert.equal(p.factors[1].targetVessels,3);
 assert.deepEqual(p.factors[1].selectedImos,['9400102','9400105','9400106']);
 assert.equal(p.uniqueSelectedCount,5);
 assert.deepEqual(p.overlappingImos,[]);
 assert.equal(p.overallEligibleCandidates,7);
 assert.equal(p.advisoryOnly,true);
});
test('overlap counts once in final unique IMO proposal, without consuming another factor quota',()=>{
 const p=calculateInspectionFactorQuotas([
  vessel('9400101',{risk:91,flag:'ARE'}),
  vessel('9400102',{risk:40}),
  vessel('9400103',{sources:['SERVICE_REQUEST'],flag:'UAE'}),
  vessel('9400104',{risk:10})
 ],50,100);
 assert.deepEqual(p.factors[0].selectedImos,['9400101']);
 assert.deepEqual(p.factors[1].selectedImos,['9400101','9400103']);
 assert.deepEqual(p.overlappingImos,['9400101']);
 assert.equal(p.uniqueSelectedCount,2);
});
test('repeated IMO and source events never inflate a denominator',()=>{
 const p=calculateInspectionFactorQuotas([
  vessel('9400101',{risk:70,sources:['PSC_PORT_CALL'],flag:'UAE'}),
  vessel('9400101',{risk:null,sources:['PSC_PORT_CALL','SERVICE_REQUEST']}),
  vessel('9400102',{risk:null})
 ],100,100);
 assert.equal(p.factors[0].eligibleVessels,2);
 assert.equal(p.factors[1].eligibleVessels,1);
 assert.equal(p.uniqueSelectedCount,2);
 assert.deepEqual(p.overlappingImos,['9400101']);
});
test('missing saved risk is recorded as missing and ordered after verified scored PSC records',()=>{
 const p=calculateInspectionFactorQuotas([
  vessel('9400101',{risk:null}),
  vessel('9400102',{risk:45}),
  vessel('9400103',{risk:80}),
  vessel('9400104',{risk:null})
 ],50,0);
 assert.deepEqual(p.factors[0].selectedImos,['9400103','9400102']);
 assert.equal(p.factors[0].riskAvailableVessels,2);
 assert.equal(p.factors[0].riskMissingVessels,2);
});
test('flag classification recognizes explicit UAE flag and rejects a foreign-flagged UAE visitor',()=>{
 for(const flag of ['UAE','AE','ARE','United Arab Emirates','الإمارات العربية المتحدة'])
  assert.equal(isUaeFlag(flag),true,flag);
 for(const flag of ['PANAMA','JEBEL ALI','UNITED KINGDOM',''])
  assert.equal(isUaeFlag(flag),false,flag);
});
test('each rate is independently valid including 0%, with per-pool floor calculation',()=>{
 const cohort=Array.from({length:11},(_,i)=>
  vessel(String(9400101+i),{flag:i<5?'UAE':'PANAMA',risk:99-i}));
 const p=calculateInspectionFactorQuotas(cohort,15,60);
 assert.equal(p.factors[0].targetVessels,1,'11 * 15% floors to 1');
 assert.equal(p.factors[1].targetVessels,3,'5 * 60% = 3');
 assert.equal(calculateInspectionFactorQuotas(cohort,0,0).uniqueSelectedCount,0);
 assert.throws(()=>calculateInspectionFactorQuotas(cohort,101,0),/PERCENT_INVALID/);
 assert.throws(()=>calculateInspectionFactorQuotas(cohort,50.5,0),/PERCENT_INVALID/);
 assert.throws(()=>calculateInspectionFactorQuotas(cohort,50,-1),/PERCENT_INVALID/);
});
