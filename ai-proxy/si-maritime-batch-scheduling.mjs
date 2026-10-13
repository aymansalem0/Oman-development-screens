/**
 * MOEI Maritime Smart Inspection V2: read-only batch scheduling proposal.
 * Reuses the existing ERP qualifications/shift/leave/booking feasibility
 * engine; GT ranges are deliberately NOT an inspector qualification gate.
 * No inspection cases, ERP bookings, NMC decisions or paid AI requests.
 */
import {createHash} from 'node:crypto';
import {SiError} from './si-erp-workforce.mjs';
const MINUTE=60000,HOUR=3600000,MAX_BATCH=40,BEAM_WIDTH=32;
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
 if(!['MSW_FINAL','OFFICER_FINAL','OFFICER_CONFIRMED'].includes(row.windowSource)||
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

function collides(first,second,data,bufferMs){
 if(first.inspectorId!==second.inspectorId)return false;
 const early=Date.parse(first.startUtc)<Date.parse(second.startUtc)?first:second;
 const late=early===first?second:first;
 const minutes=travel(data,early.portId,late.portId);
 return minutes===null||Date.parse(early.endUtc)+minutes+bufferMs>Date.parse(late.startUtc);
}
const stateSort=(a,b)=>b.schedule.length-a.schedule.length||b.score-a.score||a.key.localeCompare(b.key);
/**
 * No AI invocation. This is a constraint solver to produce the factual,
 * auditable baseline before an optional AI explanation or supervisor action.
 */
export function proposeMaritimeBatchSchedule({
 plan,erpSnapshot,policy,requests=[],nmcReferrals=[],existingBookings=[],
 scheduler,clock=()=>Date.now()
}){
 if(plan?.status!=='APPROVED'||!Array.isArray(plan.approvedVessels))
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
 const workingPolicy={...policy,config:{...policy.config,maxOptions:10}};
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
 const chosen=states[0]?.schedule||[],assignments=new Map(chosen.map(o=>[o.imo,o]));
 const rows=jobs.sort((a,b)=>a.rank-b.rank).map(j=>({
  imo:j.imo,planRank:j.rank,regimes:j.regimes,
  status:assignments.has(j.imo)?'PROPOSED':'UNSCHEDULED',
  assignment:assignments.get(j.imo)||null,
  blocker:assignments.has(j.imo)?null:j.reason||'GLOBAL_PLAN_CONFLICT_OR_CAPACITY',
  alternatives:j.options.length,
  exclusions:assignments.has(j.imo)?[]:j.exclusions
 }));
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
  rows,warnings:[
   'READ_ONLY_NO_CASE_CREATION_OR_BOOKING',
   'SUPERVISOR_MUST_APPROVE_A_FRESHLY_REVALIDATED_SCHEDULE',
   'ETA_ALONE_DOES_NOT_SUPPLY_ETD',
   'ENGINEER_SELECTION_USES_VERIFIED_REGIME_TYPE_SKILLS_NOT_GT_RANGES',
   'ERP_EXCEL_IS_SIMULATED_POC_NOT_LIVE_HR',
   'SOLVER_IS_HEURISTIC_NOT_GUARANTEED_GLOBAL_OPTIMUM',
   'NO_AIRIA_AI_INVOKED'
  ]
 };
}
