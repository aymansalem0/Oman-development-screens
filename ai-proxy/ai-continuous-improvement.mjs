/** AI Continuous Improvement POC event ledger.
 * New events only: no claim of historical coverage and no fabricated runs.
 * Never store user IDs, vessel IDs, incident IDs, prompt/evidence/model output,
 * keys, error text, costs or official maritime decisions here.
 */
import {readFileSync,writeFileSync,renameSync,mkdirSync} from 'node:fs';
import {dirname} from 'node:path';

const AGENTS=new Set(['A01','A02','A03','A04','C01','P01','S01','V01','R01','X01','DQ01','NMC_DESK']);
const DOMAINS=new Set(['NMC','SMART_INSPECTION','SEAFARERS','CROSS_DOMAIN']);
const safeResult=new Set(['SUCCESS','FAILURE']);
const safeDecision=new Set(['ACCEPT','MODIFY','REJECT']);
const MAX_ROWS=15000;
export function aggregateContinuousImprovement(rows=[],incidentRows=null){
 const calls=rows.filter(x=>x.kind==='INVOCATION');
 const success=calls.filter(x=>x.result==='SUCCESS').length, failed=calls.length-success;
 const byAgent={},byDomain={},trend={};
 for(const row of calls){
  byAgent[row.agent]=(byAgent[row.agent]||0)+1;
  byDomain[row.domain]=(byDomain[row.domain]||0)+1;
  const day=row.at.slice(0,7);
  trend[day]=(trend[day]||0)+1;
 }
 const decisions=(Array.isArray(incidentRows)?incidentRows:[]).filter(x=>
  !x.aiAssessmentStale&&x.aiAssessment?.assessmentStatus==='HUMAN_REVIEWED'&&
  safeDecision.has(x.aiAssessment?.officerDecision));
 const decisionTotals={
  ACCEPT:decisions.filter(x=>x.aiAssessment.officerDecision==='ACCEPT').length,
  MODIFY:decisions.filter(x=>x.aiAssessment.officerDecision==='MODIFY').length,
  REJECT:decisions.filter(x=>x.aiAssessment.officerDecision==='REJECT').length
 };
 const reviewed=decisions.length;
 const aiAnalyzed=Array.isArray(incidentRows)
  ?incidentRows.filter(x=>x.aiAssessment&&!x.aiAssessmentStale).length:null;
 return {
  status:'ok',source:'INSTRUMENTED_POC_LEDGER',
  measurementScope:'INSTRUMENTED_CALLS_SINCE_DEPLOYMENT',
  calls:{total:calls.length,success,failed,
   successRate:calls.length?Math.round(success/calls.length*1000)/10:null,
   byAgent,byDomain,monthly:Object.entries(trend).sort(([a],[b])=>a.localeCompare(b))
    .map(([name,count])=>({name,count}))},
  incidents:{sourceAvailable:Array.isArray(incidentRows),aiAnalyzed,
   reviewed:Array.isArray(incidentRows)?reviewed:null,
   accepted:Array.isArray(incidentRows)?decisionTotals.ACCEPT:null,
   modified:Array.isArray(incidentRows)?decisionTotals.MODIFY:null,
   rejected:Array.isArray(incidentRows)?decisionTotals.REJECT:null,
   overrideRate:Array.isArray(incidentRows)&&reviewed
    ?Math.round((decisionTotals.MODIFY+decisionTotals.REJECT)/reviewed*1000)/10:null},
  completeness:{globalAiriaHistory:false,sdbAgentEvents:false,
   allSIAgentsInstrumented:false,incidentSourceAvailable:Array.isArray(incidentRows)}
 };
}
export class AiContinuousImprovementLedger {
 constructor({file=process.env.AI_CI_LEDGER_PATH||'/data/ai-ci-events.json',clock=()=>new Date()}={}){
  this.file=file;this.clock=clock;
 }
 _load(){
  try{
   const rows=JSON.parse(readFileSync(this.file,'utf8'));
   return Array.isArray(rows)?rows.filter(x=>x&&x.kind==='INVOCATION').slice(-MAX_ROWS):[];
  }catch{return [];}
 }
 record({agent,domain,result}={}){
  if(!AGENTS.has(agent)||!DOMAINS.has(domain)||!safeResult.has(result))return false;
  const now=this.clock().toISOString();
  const rows=this._load();
  rows.push({kind:'INVOCATION',at:now,agent,domain,result});
  try{
   mkdirSync(dirname(this.file),{recursive:true});
   const temp=this.file+'.tmp';
   writeFileSync(temp,JSON.stringify(rows.slice(-MAX_ROWS)),{mode:0o600});
   renameSync(temp,this.file);
   return true;
  }catch{
   // Telemetry failure must never block the maritime workflow or AI response.
   console.error('[ai-ci] LEDGER_WRITE_UNAVAILABLE');
   return false;
  }
 }
 snapshot(incidentRows=null){return aggregateContinuousImprovement(this._load(),incidentRows);}
}
