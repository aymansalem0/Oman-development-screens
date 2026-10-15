/**
 * Smart Inspection management KPI roll-up (SI-09).
 * Read-only projections from existing approved candidate queue, saved inspection
 * case ledger and audit state. Never fabricates completed inspections, findings,
 * regulatory compliance or AI findings. No provider / DB mutation.
 */
const STAGES=[
  'NOT_STARTED','PREPARATION_READY','SCOPE_APPROVED','ASSIGNED','IN_FIELD',
  'REPORT_PENDING_REVIEW','REPORT_RETURNED','REPORT_APPROVED','ACTIONS_OPEN',
  'FOLLOW_UP_PENDING','READY_TO_CLOSE','CLOSED'
];
const terminal=new Set(['CLOSED']);
const nonNegativeInt=x=>Number.isInteger(x)&&x>=0?x:null;
const utcDay=(iso)=>{
  const v=String(iso||'').slice(0,10);
  return /^\d{4}-\d{2}-\d{2}$/.test(v)?v:null;
};
const integerTime=value=>{
  const t=Date.parse(value||'');
  return Number.isFinite(t)?t:null;
};
export function buildInspectionManagementView({candidates,cases,records,at=new Date().toISOString()}={}){
  if(!candidates||!Array.isArray(cases)||!records||typeof records!=='object')
    throw new TypeError('SI_MANAGEMENT_INPUT_INVALID');
  const today=utcDay(at);
  if(!today)throw new TypeError('SI_MANAGEMENT_DATE_INVALID');
  const stages=Object.fromEntries(STAGES.map(stage=>[stage,0]));
  const byRegime={};
  const byInspector=new Map();
  const byCheck=new Map();
  let active=0,completed=0,notStarted=0,pendingReports=0,returnedReports=0,
      openCorrectiveActions=0,overdueCorrectiveActions=0,
      majorFindings=0,criticalFindings=0,allFindings=0,
      repeatDeficiencyVessels=new Set(),repeatDeficiencyPairs=0,
      totalClosureHours=0,timedClosureCount=0,stale=false;
  const seenCaseIds=new Set(),checkImoCount=new Map(),detail=[];
  for(const c of cases){
    if(!c?.id||seenCaseIds.has(c.id))throw new TypeError('SI_MANAGEMENT_DUPLICATE_CASE_ID');
    seenCaseIds.add(c.id);
    const record=records[c.id]||null;
    // A case approved for execution may not yet have a lifecycle.
    const stage=record?.stage||'NOT_STARTED';
    if(!STAGES.includes(stage))throw new TypeError('SI_MANAGEMENT_UNKNOWN_STAGE');
    stages[stage]++;
    byRegime[c.regime]=(byRegime[c.regime]||0)+1;
    if(terminal.has(stage))completed++;
    else if(stage==='NOT_STARTED')notStarted++;
    else active++;
    if(['REPORT_PENDING_REVIEW','REPORT_RETURNED'].includes(stage))pendingReports++;
    if(stage==='REPORT_RETURNED')returnedReports++;
    if(record?.audit){
      returnedReports+=record.audit.filter(e=>e.action==='RETURN_REPORT').length-
        (stage==='REPORT_RETURNED'?1:0);
    }
    const findings=Array.isArray(record?.findings)?record.findings:[];
    const actions=Array.isArray(record?.actions)?record.actions:[];
    const unresolved=actions.filter(a=>a.status!=='VERIFIED');
    openCorrectiveActions+=unresolved.length;
    const overdue=unresolved.filter(a=>utcDay(a.dueDate)&&utcDay(a.dueDate)<today).length;
    overdueCorrectiveActions+=overdue;
    allFindings+=findings.length;
    majorFindings+=findings.filter(x=>x.severity==='MAJOR').length;
    criticalFindings+=findings.filter(x=>x.severity==='CRITICAL').length;
    for(const finding of findings){
      const key=String(finding.checkId||'').trim();
      if(!key)continue;
      const cat=byCheck.get(key)||{checkId:key,title:finding.title||key,
        count:0,caseIds:new Set(),vesselImos:new Set()};
      cat.count++;cat.caseIds.add(c.id);cat.vesselImos.add(c.imo);
      byCheck.set(key,cat);
      const pair=String(c.imo)+'|'+key;
      const prev=checkImoCount.get(pair)||0;
      if(prev===1){repeatDeficiencyPairs++;repeatDeficiencyVessels.add(c.imo);}
      checkImoCount.set(pair,prev+1);
    }
    const owner=record?.assignment?.inspector||null;
    if(owner&&!terminal.has(stage)){
      const entry=byInspector.get(owner)||{inspector:owner,assigned:0,inField:0,
        pendingReports:0,openActions:0};
      entry.assigned++;
      if(stage==='IN_FIELD')entry.inField++;
      if(['REPORT_PENDING_REVIEW','REPORT_RETURNED'].includes(stage))entry.pendingReports++;
      entry.openActions+=unresolved.length;
      byInspector.set(owner,entry);
    }
    if(stage==='CLOSED'){
      const started=integerTime(record?.startedAt),closed=integerTime(record?.closedAt);
      if(started!==null&&closed!==null&&closed>=started){
        totalClosureHours+=(closed-started)/3600000;
        timedClosureCount++;
      }
    }
    detail.push({id:c.id,imo:c.imo,vesselName:c.vesselName||('IMO '+c.imo),
      regime:c.regime,stage,inspector:owner,
      sourceEvents:c.sourceEvents||[],priorityRisk:c.risk||null,
      findings:findings.length,major:findings.filter(x=>x.severity==='MAJOR').length,
      critical:findings.filter(x=>x.severity==='CRITICAL').length,
      overdueActions:overdue,openActions:unresolved.length,
      updatedAt:record?.updatedAt||c.updatedAt||null,
      closedAt:record?.closedAt||null,
      caseVersion:record?.version||0});
  }
  const recurring=[...byCheck.values()]
    .map(x=>({checkId:x.checkId,title:x.title,findings:x.count,
      affectedCases:x.caseIds.size,affectedVessels:x.vesselImos.size}))
    .sort((a,b)=>b.findings-a.findings||a.checkId.localeCompare(b.checkId));
  const caseDetails=detail.sort((a,b)=>b.overdueActions-a.overdueActions||
    b.critical-a.critical||b.major-a.major||
    String(b.updatedAt||'').localeCompare(String(a.updatedAt||'')));
  return {
    status:'ok',source:'SAVED_SI_INSPECTION_LEDGER_AND_CURRENT_CANDIDATE_QUEUE',
    dataNature:'SYNTHETIC_POC_NOT_OFFICIAL',
    generatedAt:at,asOfDate:today,autoAiCalls:false,mutations:false,
    limitations:[
      'POC source data and case timestamps are not official MOEI performance statistics.',
      'Inspection counts include only approved SI cases in the persistent case registry.',
      'Repeat deficiency means the same check ID recurred on the same IMO in more than one saved inspection case.',
      'Vessel risk is informational; the dashboard does not recalculate official NMC scores.'
    ],
    kpis:{
      uniqueCandidateVessels:nonNegativeInt(candidates.summary?.candidateVessels),
      pendingCandidateVessels:nonNegativeInt(candidates.summary?.pendingVessels),
      approvedCases:cases.length,notStartedCases:notStarted,
      inProgressCases:active,closedCases:completed,pendingReportReview:pendingReports,
      returnedReports,openCorrectiveActions,overdueCorrectiveActions,
      findings:allFindings,majorFindings,criticalFindings,
      repeatDeficiencyVessels:repeatDeficiencyVessels.size,
      repeatedVesselCheckPairs:repeatDeficiencyPairs,
      averageClosureHours:timedClosureCount
        ?Math.round(totalClosureHours/timedClosureCount*10)/10:null,
      timedClosedCases:timedClosureCount
    },
    byStage:STAGES.map(stage=>({stage,count:stages[stage]})),
    byRegime:Object.entries(byRegime).map(([regime,count])=>({regime,count}))
      .sort((a,b)=>b.count-a.count||a.regime.localeCompare(b.regime)),
    workload:[...byInspector.values()].sort((a,b)=>b.assigned-a.assigned||
      a.inspector.localeCompare(b.inspector)),
    recurringChecks:recurring,
    cases:caseDetails
  };
}
