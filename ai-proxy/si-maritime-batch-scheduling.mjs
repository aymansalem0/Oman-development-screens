/**
 * MOEI Maritime Smart Inspection V2: read-only batch scheduling proposal.
 * Reuses the existing ERP qualifications/shift/leave/booking feasibility
 * engine; GT ranges are deliberately NOT an inspector qualification gate.
 * No inspection cases, ERP bookings, NMC decisions or paid AI requests.
 */
import {createHash} from 'node:crypto';
import {SiError} from './si-erp-workforce.mjs';
const MINUTE=60000,HOUR=3600000,MAX_BATCH=500,BEAM_WIDTH=32;
const IMO=/^[0-9]{7}$/;
const TYPES=new Set(['TANKER','CARGO','PASSENGER','OTHER']);
const REGIMES=new Set(['FOCUSED','PSC','FLAG','SERVICE','FOLLOW_UP']);
const active=x=>x==='Y'||x===true;
const norm=x=>typeof x==='string'?x.trim().toUpperCase():'';
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const localMs=s=>{
 if(typeof s!=='string'||!/^\d{4}-\d\d-\d\d \d\d:\d\d$/.test(s))
  throw new SiError('SI_V2_LOCAL_TIME_FORMAT_INVALID',422);
 const ms=Date.parse(s.replace(' ','T')+':00+04:00');
 if(!Number.isFinite(ms)||new Date(ms+4*HOUR).toISOString().slice(0,16).replace('T',' ')!==s)
  throw new SiError('SI_V2_LOCAL_TIME_INVALID',422);
 return ms;
};
const localDate=ms=>new Date(ms+4*HOUR).toISOString().slice(0,10);
const travel=(data,p1,p2)=>{
 if(p1===p2)return 0;
 const row=data.Travel_Matrix.find(x=>x.from_port_id===p1&&x.to_port_id===p2);
 if(!row||!active(row.route_allowed))return null;
 const mins=Number(row.one_way_minutes);
 return Number.isFinite(mins)&&mins>=0?mins*MINUTE:null;
};
export function validateMaritimeSchedulingInput(imo,row,erp,nowMs){
 if(!row)return {reason:'VESSEL_SCHEDULING_DATA_REQUIRED'};
 if(row.imo!==imo)return {reason:'IMO_MISMATCH'};
 const vesselType=norm(row.vesselType),regime=norm(row.regime);
 if(!TYPES.has(vesselType))return {reason:'VERIFIED_VESSEL_TYPE_REQUIRED'};
 if(!REGIMES.has(regime))return {reason:'INSPECTION_REGIME_REQUIRED'};
 if(!erp.Ports.some(p=>p.port_id===row.portId&&active(p.active)))
  return {reason:'VALID_INSPECTION_PORT_REQUIRED'};
 if(!['BERTH','ANCHORAGE','TERMINAL'].includes(row.locationType)||
    !row.locationName||row.siteAccessConfirmed!==true)
  return {reason:'BERTH_ANCHORAGE_AND_ACCESS_CONFIRMATION_REQUIRED'};
 if(!['MSW_FINAL','OFFICER_FINAL','OFFICER_CONFIRMED',
     ...(row.pocDemo===true?['POC_DEMO']:[])].includes(row.windowSource)||
    !row.windowEvidenceReference)
  return {reason:'FINAL_VESSEL_ARRIVAL_DEPARTURE_WINDOW_REQUIRED'};
 let start,end;
 try{start=localMs(row.earliestLocal);end=localMs(row.latestFinishLocal);}
 catch{return {reason:'VESSEL_TIME_WINDOW_INVALID'};}
 const duration=Number(row.durationMinutes);
 if(start<=nowMs||end<=start||end-start>30*24*HOUR||
    !Number.isInteger(duration)||duration<30||duration>720)
  return {reason:'VESSEL_WINDOW_OR_DURATION_INVALID'};
 if(end-start<duration*MINUTE)return {reason:'VESSEL_WINDOW_SHORTER_THAN_INSPECTION'};
 return {value:{imo,portId:row.portId,vesselType,regime,
   earliestLocal:row.earliestLocal,deadlineLocal:row.latestFinishLocal,
   durationMinutes:duration,locationType:row.locationType,
   locationName:String(row.locationName).trim(),
   windowSource:row.windowSource,
   evidenceReference:String(row.windowEvidenceReference).trim()}};
}

/**
 * Read-only board projection of the same chosen solver slots. Keeps the
 * scheduling facts distinct from a supervisor-approved/ERP-booked assignment.
 * One row per vessel; groups NEVER authorize cases or reserve engineers.
 */
export function projectMaritimeSchedulingBoard(rows=[]){
 if(!Array.isArray(rows))throw new SiError('SI_V2_BOARD_ROWS_INVALID',422);
 const byEngineer=new Map(),byDate=new Map(),unscheduled=[];
 for(const row of rows){
  if(row.status!=='PROPOSED'||!row.assignment){
   unscheduled.push({imo:row.imo,planRank:row.planRank,
    blocker:row.blocker||'NO_FEASIBLE_SLOT',
    diagnostics:row.diagnostics||null});continue;
  }
  const a=row.assignment,date=String(a.startLocal||'').slice(0,10);
  const slot={imo:row.imo,planRank:row.planRank,
   inspectorId:a.inspectorId,inspectorName:a.inspectorName,
   dateLocal:date,startLocal:a.startLocal,endLocal:a.endLocal,
   portId:a.portId,portName:a.portName,locationName:a.locationName,
   locationType:a.locationType,score:a.score,
   crossPort:a.crossPort===true,originPortId:a.originPortId||a.portId,
   originPortName:a.originPortName||a.portName,
   travelMinutes:Number(a.travelMinutes)||0,
   manualReasons:a.manualReasons||[]};
  const engineer=byEngineer.get(a.inspectorId)||{
   inspectorId:a.inspectorId,inspectorName:a.inspectorName,
   vesselCount:0,dates:[],assignments:[]};
  engineer.assignments.push(slot);engineer.vesselCount++;
  if(!engineer.dates.includes(date))engineer.dates.push(date);
  byEngineer.set(a.inspectorId,engineer);
  const day=byDate.get(date)||{dateLocal:date,vesselCount:0,assignments:[]};
  day.assignments.push(slot);day.vesselCount++;
  byDate.set(date,day);
 }
 const sort=(a,b)=>a.startLocal.localeCompare(b.startLocal)||
   a.imo.localeCompare(b.imo);
 const engineers=[...byEngineer.values()].sort((a,b)=>
   a.inspectorName.localeCompare(b.inspectorName)||
   a.inspectorId.localeCompare(b.inspectorId));
 for(const e of engineers){e.dates.sort();e.assignments.sort(sort);}
 const days=[...byDate.values()].sort((a,b)=>a.dateLocal.localeCompare(b.dateLocal));
 for(const day of days)day.assignments.sort(sort);
 return {status:'UNAPPROVED_PREVIEW_ONLY',engineers,days,
   unscheduled:unscheduled.sort((a,b)=>a.planRank-b.planRank||
     a.imo.localeCompare(b.imo)),allocatedVessels:rows.length-unscheduled.length,
   approvalRequired:true,bookingWrites:0,caseWrites:0};
}
function collides(first,second,data,bufferMs){
 if(first.inspectorId!==second.inspectorId)return false;
 const early=Date.parse(first.startUtc)<Date.parse(second.startUtc)?first:second;
 const late=early===first?second:first;
 const minutes=travel(data,early.portId,late.portId);
 return minutes===null||Date.parse(early.endUtc)+minutes+bufferMs>Date.parse(late.startUtc);
}
const stateSort=(a,b)=>b.schedule.length-a.schedule.length||b.score-a.score||a.key.localeCompare(b.key);

/**
 * Explain an unscheduled vessel against the selected whole-plan allocation.
 * This is a bounded, heuristic solver: NEVER infer global physical
 * impossibility merely from a truncated option set or beam-search outcome.
 */
export function explainUnscheduledMaritimeJob(job,schedule,erpSnapshot,policy,existingBookings=[]){
 const input=job.input||null;
 const exclusions=(job.exclusions||[]).map(item=>({
  inspectorId:item.inspectorId,
  reasonCodes:(item.reasons||[]).slice(0,8)
 })).slice(0,20);
 const evidence={
  code:job.reason||'GLOBAL_PLAN_CONFLICT_OR_CAPACITY',
  category:'INPUT_OR_ELIGIBILITY',
  source:'DETERMINISTIC_ERP_PLANNING_PREVIEW',
  scopeCodes:job.regimes||[],
  portId:input?.portId||null,
  earliestLocal:input?.earliestLocal||null,
  deadlineLocal:input?.deadlineLocal||null,
  durationMinutes:input?.durationMinutes||null,
  candidateOptions:job.options.length,
  candidateInspectors:new Set(job.options.map(x=>x.inspectorId)).size,
  timeOrTravelConflicts:0,dailyCapacityConflicts:0,
  optionsStillInsertable:0,competingVisits:[],
  inspectorExclusions:exclusions,
  nextAction:job.reason?'VERIFY_INPUT_OR_ERP_ELIGIBILITY':'REVIEW_PLAN_ALTERNATIVES',
  advisoryOnly:true
 };
 if(job.reason||!job.options.length)return evidence;
 const competitors=new Map();
 const bufferMs=Number(policy.config.travelBufferMinutes||0)*MINUTE;
 let time=0,capacity=0,insertable=0;
 for(const opt of job.options){
  const collision=schedule.filter(a=>collides(a,opt,erpSnapshot.data,bufferMs));
  const employee=erpSnapshot.data.Inspectors.find(x=>x.inspector_id===opt.inspectorId);
  const limit=Math.min(Number(employee?.daily_capacity)||0,
   Number(policy.config.maxDailyInspections)||0);
  const day=localDate(Date.parse(opt.startUtc));
  const used=schedule.filter(x=>x.inspectorId===opt.inspectorId&&
   localDate(Date.parse(x.startUtc))===day).length+
   existingBookings.filter(x=>x.inspectorId===opt.inspectorId&&
    localDate(Date.parse(x.startUtc))===day).length;
  if(collision.length){
   time++;
   for(const other of collision){
    const key=other.imo+'|'+other.inspectorId+'|'+other.startUtc;
    if(!competitors.has(key))competitors.set(key,{
     imo:other.imo,inspectorId:other.inspectorId,
     inspectorName:other.inspectorName,
     portId:other.portId,startLocal:other.startLocal,
     endLocal:other.endLocal
    });
   }
  }
  if(!limit||used>=limit)capacity++;
  if(!collision.length&&limit>0&&used<limit)insertable++;
 }
 evidence.timeOrTravelConflicts=time;
 evidence.dailyCapacityConflicts=capacity;
 evidence.optionsStillInsertable=insertable;
 evidence.competingVisits=[...competitors.values()].slice(0,10);
 if(insertable){
  evidence.category='OPTIMIZER_SEARCH_LIMIT';
  evidence.code='HEURISTIC_SEARCH_LEFT_AVAILABLE_OPTION';
  evidence.nextAction='REOPTIMIZE_WITH_MORE_CANDIDATES';
 }else{
  evidence.category='PLAN_RESOURCE_CONTENTION';
  evidence.nextAction='REVIEW_COMPETING_ASSIGNMENTS_AND_VISIT_WINDOW';
 }
 return evidence;
}

/**
 * No AI invocation. This is a constraint solver to produce the factual,
 * auditable baseline before an optional AI explanation or supervisor action.
 */
export function proposeMaritimeBatchSchedule({
 plan,erpSnapshot,policy,requests=[],nmcReferrals=[],existingBookings=[],
 scheduler,clock=()=>Date.now()
}){
 if(!['APPROVED','IN_EXECUTION'].includes(plan?.status)||!Array.isArray(plan.approvedVessels))
  throw new SiError('SI_V2_APPROVED_PLAN_REQUIRED',409);
 const vessels=plan.approvedVessels;
 if(!vessels.length||vessels.length>MAX_BATCH||
   vessels.some(v=>!IMO.test(v.imo))||
   new Set(vessels.map(v=>v.imo)).size!==vessels.length)
  throw new SiError('SI_V2_PLAN_VESSELS_INVALID',422);
 if(!erpSnapshot?.snapshotId||!Array.isArray(erpSnapshot.data?.Inspectors))
  throw new SiError('SI_V2_ERP_SNAPSHOT_REQUIRED',409);
 if(!policy?.config||typeof scheduler?.buildOptions!=='function'||
   !Array.isArray(requests)||!Array.isArray(nmcReferrals)||
   !Array.isArray(existingBookings))
  throw new SiError('SI_V2_SCHEDULING_INPUT_INVALID',422);
 const byImo=new Map();
 const byNmcRef=new Map(nmcReferrals.map(x=>[x.id,x]));
 for(const request of requests){
  if(!IMO.test(request?.imo)||byImo.has(request.imo))
   throw new SiError('SI_V2_DUPLICATE_REQUEST_IMO',422);
  if(!vessels.some(v=>v.imo===request.imo))
   throw new SiError('SI_V2_OUT_OF_PLAN_IMO',422);
  byImo.set(request.imo,request);
 }
 const nowMs=clock();
 // Max 10 timeslots per vessel; the bounded beam solver can consider
 // several alternatives while leaving room for specialist-only inspections.
 const mockOverlay=erpSnapshot.demoMode===true&&
  requests.every(x=>x.pocDemo===true);
 // POC-only cross-port opt-in: never modify the published real ERP policy.
 const workingPolicy={...policy,config:{...policy.config,maxOptions:10,
  ...(mockOverlay?{allowCrossPort:true,crossPortRequiresApproval:true}:{})}};
 const jobs=vessels.map((v,i)=>{
  // The plan's human-approved NMC provenance is authoritative: an NMC
  // referral cannot be invented through uploaded MSW/PSC source rows.
  const triggers=v.inspectionReasons||[];
  const nmc=triggers.filter(x=>x.sourceType==='NMC_CASE');
  if(nmc.length){
    const linked=nmc.map(x=>byNmcRef.get(x.sourceEventId));
    if(linked.some(x=>!x||x.imo!==v.imo||
      !['PENDING_SCHEDULING','SCHEDULED'].includes(x.status)||
      x.caseStatus==='RESOLVED'))
      return {imo:v.imo,rank:Number(v.planRank)||i+1,
       regimes:v.regimes||[],options:[],
       reason:'NMC_APPROVED_REFERRAL_MISSING_OR_CLOSED',exclusions:[]};
    // Do not allocate the same referral twice if it is already scheduled.
    if(linked.some(x=>x.status==='SCHEDULED'))
      return {imo:v.imo,rank:Number(v.planRank)||i+1,
       regimes:v.regimes||[],options:[],
       reason:'NMC_REFERRAL_ALREADY_SCHEDULED_RECONCILE',exclusions:[]};
  }
  const validated=validateMaritimeSchedulingInput(v.imo,byImo.get(v.imo),
   erpSnapshot.data,nowMs);
  const base={imo:v.imo,rank:Number(v.planRank)||i+1,
   regimes:v.regimes||[],options:[],reason:validated.reason||null,
   exclusions:[]};
  if(!validated.value)return base;
  const input=validated.value;
  let out;
  try{
   out=scheduler.buildOptions(input,{snapshot:erpSnapshot,policy:workingPolicy,
    confirmed:existingBookings});
  }catch(e){return {...base,reason:e.code||'SCHEDULER_VALIDATION_FAILED'};}
  // A combined visit can satisfy multiple source obligations ONLY if the
  // assigned engineer holds a valid regime/type qualification for EVERY scope.
  // One PSC engineer alone is not presumed qualified for a service inspection.
  const required=(v.regimes||[]).map(s=>({
    PORT_STATE_CONTROL:'PSC',FOCUSED_INSPECTION:'FOCUSED',
    UAE_SERVICE_INSPECTION:'SERVICE',FOLLOW_UP_INSPECTION:'FOLLOW_UP'
  }[s])).filter(Boolean);
  const filtered=out.options.filter(opt=>required.every(r=>
    erpSnapshot.data.Qualifications.some(q=>
      q.inspector_id===opt.inspectorId&&q.inspection_regime===r&&
      ['ANY',input.vesselType].includes(norm(q.vessel_type))&&
      active(q.active)&&q.valid_until>=localDate(Date.parse(opt.startUtc)))));
  return {...base,input,options:filtered.map(o=>({
   ...o,imo:v.imo,locationType:input.locationType,
   locationName:input.locationName,
   vesselType:input.vesselType,regime:input.regime,
   windowSource:input.windowSource,evidenceReference:input.evidenceReference,
   requiresSupervisorApproval:true})),
   exclusions:out.exclusions,
   reason:filtered.length?null:'NO_FEASIBLE_ERP_SHIFT_QUALIFICATION_PORT_OR_WINDOW'};
 });
 const schedulable=jobs.filter(j=>j.options.length).sort((a,b)=>
   a.options.length-b.options.length||
   localMs(a.input.deadlineLocal)-localMs(b.input.deadlineLocal)||
   a.rank-b.rank||a.imo.localeCompare(b.imo));
 let states=[{schedule:[],score:0,key:''}];
 for(const job of schedulable){
  const branches=[];
  for(const state of states){
   branches.push({...state,key:state.key+':'+job.imo+'-NONE'});
   for(const opt of job.options){
    if(state.schedule.some(x=>collides(x,opt,erpSnapshot.data,
      Number(policy.config.travelBufferMinutes||0)*MINUTE)))continue;
    const limitRow=erpSnapshot.data.Inspectors.find(x=>x.inspector_id===opt.inspectorId);
    const limit=Math.min(Number(limitRow?.daily_capacity)||0,
      Number(policy.config.maxDailyInspections)||0);
    const day=localDate(Date.parse(opt.startUtc));
    const current=state.schedule.filter(x=>x.inspectorId===opt.inspectorId&&
      localDate(Date.parse(x.startUtc))===day).length;
    const booked=existingBookings.filter(x=>x.inspectorId===opt.inspectorId&&
      localDate(Date.parse(x.startUtc))===day).length;
    if(!limit||booked+current>=limit)continue;
    branches.push({schedule:[...state.schedule,opt],
      score:state.score+opt.score,key:state.key+':'+job.imo+'-'+opt.optionId});
   }
  }
  branches.sort(stateSort);states=branches.slice(0,BEAM_WIDTH);
 }
 const chosen=states[0]?.schedule||[];
 const sortedJobs=[...jobs].sort((a,b)=>a.rank-b.rank||a.imo.localeCompare(b.imo));
 const rowsFor=schedule=>{
  const allocations=new Map(schedule.map(o=>[o.imo,o]));
  return sortedJobs.map(j=>({
   imo:j.imo,planRank:j.rank,regimes:j.regimes,
   status:allocations.has(j.imo)?'PROPOSED':'UNSCHEDULED',
   assignment:allocations.get(j.imo)||null,
   blocker:allocations.has(j.imo)?null:j.reason||'GLOBAL_PLAN_CONFLICT_OR_CAPACITY',
   alternatives:j.options.length,
   exclusions:allocations.has(j.imo)?[]:j.exclusions,
   diagnostics:allocations.has(j.imo)?null:
    explainUnscheduledMaritimeJob(j,schedule,erpSnapshot,policy,existingBookings)
  }));
 };
 const rows=rowsFor(chosen);
 // The AI may rank only complete, already ERP-verified alternative schedules
 // with the SAME maximum vessel coverage. It cannot invent a slot, exceed
 // inspector capacity, drop a scheduled vessel or book an engineer.
 const seen=new Set(),variants=[];
 for(const state of states){
  if(state.schedule.length!==chosen.length)continue;
  const ordered=[...state.schedule].sort((a,b)=>a.imo.localeCompare(b.imo));
  const signature=ordered.map(x=>x.imo+':'+x.optionId).join('|');
  if(seen.has(signature))continue;
  seen.add(signature);
  const alternativeRows=rowsFor(state.schedule);
  variants.push({
   optionId:'SI-S01-'+sha(signature).slice(0,16),
   allocatedVessels:state.schedule.length,
   objectiveScore:state.score,
   assignments:ordered.map(x=>({
    imo:x.imo,inspectorId:x.inspectorId,inspectorName:x.inspectorName,
    portId:x.portId,portName:x.portName,
    startUtc:x.startUtc,endUtc:x.endUtc,
    startLocal:x.startLocal,endLocal:x.endLocal,
    locationName:x.locationName,
    crossPort:x.crossPort===true,originPortId:x.originPortId||x.portId,
    originPortName:x.originPortName||x.portName,
    travelMinutes:Number(x.travelMinutes)||0,
    manualReasons:x.manualReasons||[],
    optionId:x.optionId,score:x.score
   })),
   rows:alternativeRows,
   board:projectMaritimeSchedulingBoard(alternativeRows)
  });
  if(variants.length===3)break;
 }
 return {
  schema:'SI-MARITIME-BATCH-SCHEDULE-V1',
  status:'DRAFT_REQUIRES_SUPERVISOR_APPROVAL',
  createdAt:new Date(nowMs).toISOString(),
  proposalHash:sha({planId:plan.id,planRevision:plan.revision,
   approvedVessels:plan.approvedVessels,erpSnapshotId:erpSnapshot.snapshotId,
   policyRevision:policy.revision,requests,nmcReferrals,existingBookings}),
  planId:plan.id,planNumber:plan.number,planRevision:plan.revision,
  erpSnapshotId:erpSnapshot.snapshotId,policyRevision:policy.revision,
  solver:'HARD_CONSTRAINTS_PLUS_BOUNDED_BEAM_SEARCH_NO_GENERATIVE_AI',
  summary:{total:rows.length,proposed:chosen.length,
   unscheduled:rows.length-chosen.length,caseWrites:0,bookingWrites:0},
  rows,variants,board:projectMaritimeSchedulingBoard(rows),warnings:[
   'READ_ONLY_NO_CASE_CREATION_OR_BOOKING',
   'SUPERVISOR_MUST_APPROVE_A_FRESHLY_REVALIDATED_SCHEDULE',
   'ETA_ALONE_DOES_NOT_SUPPLY_ETD',
   'ENGINEER_SELECTION_USES_VERIFIED_REGIME_TYPE_SKILLS_NOT_GT_RANGES',
   'ERP_EXCEL_IS_SIMULATED_POC_NOT_LIVE_HR',
   ...(mockOverlay?['POC_CROSS_PORT_FALLBACK_REQUIRES_SUPERVISOR_APPROVAL']:[]),
   'SOLVER_IS_HEURISTIC_NOT_GUARANTEED_GLOBAL_OPTIMUM',
   'NO_AIRIA_AI_INVOKED'
  ]
 };
}
