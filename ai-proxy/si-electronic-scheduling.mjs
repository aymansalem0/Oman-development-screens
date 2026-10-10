/**
 * Deterministic NMC -> Smart Inspection electronic scheduling POC.
 * No AI calls or HR updates. The only operational write is to an existing,
 * human-approved NMC inspection referral via cases.scheduleInspection().
 * No Oracle schema migration: scheduling proposals/audit use /data POC volume.
 */
import {randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync,renameSync,mkdirSync,existsSync} from 'node:fs';
import {dirname} from 'node:path';
import {SiError} from './si-erp-workforce.mjs';

const MINUTE=60000,DAY=86400000,DUBAI_OFFSET=4*60*MINUTE;
const WEEKDAYS=['SUN','MON','TUE','WED','THU','FRI','SAT'];
const RISK_ORDER=['Normal','Watch','High','Critical'];
const DEFAULT_POLICY=Object.freeze({
  approvalMode:'HYBRID',autoApproveNmcReferrals:false,autoMaxRiskLevel:'Watch',
  allowCrossPort:true,crossPortRequiresApproval:true,
  pendingLeaveRequiresApproval:true,maxSnapshotAgeHours:24,
  slotMinutes:30,maxHorizonDays:14,maxOptions:3,
  prepMinutes:15,travelBufferMinutes:30,maxDailyInspections:2,
  weights:{earliness:25,travel:20,workload:25,availability:20,continuity:10}
});
const clone=x=>JSON.parse(JSON.stringify(x));
const active=x=>x==='Y'||x===true;
const parseLocal=x=>{
  if(typeof x!=='string'||!/^\d{4}-\d\d-\d\d \d\d:\d\d$/.test(x))
    throw new SiError('SI_LOCAL_DATE_REQUIRED');
  const ms=Date.parse(x.replace(' ','T')+':00+04:00');
  if(!Number.isFinite(ms))throw new SiError('SI_LOCAL_DATE_INVALID');
  return ms;
};
const localDate=ms=>new Date(ms+DUBAI_OFFSET).toISOString().slice(0,10);
const localTime=ms=>new Date(ms+DUBAI_OFFSET).toISOString().slice(11,16);
const localDateTime=ms=>localDate(ms)+' '+localTime(ms);
const dayName=ms=>WEEKDAYS[new Date(ms+DUBAI_OFFSET).getUTCDay()];
const startDay=ms=>Math.floor((ms+DUBAI_OFFSET)/DAY)*DAY-DUBAI_OFFSET;
const intervalOverlap=(a,b,c,d)=>a<d&&c<b;
const inEffective=(date,a,b)=> (!a||date>=a)&&(!b||date<=b);
const unique=(rows,kind)=>new Set(rows.map(x=>x[kind]));
function validation(p){
  if(!p||!['AUTO','MANUAL','HYBRID'].includes(p.approvalMode)||
    !RISK_ORDER.includes(p.autoMaxRiskLevel))
    throw new SiError('SI_POLICY_MODE_INVALID');
  for(const k of ['autoApproveNmcReferrals','allowCrossPort','crossPortRequiresApproval','pendingLeaveRequiresApproval'])
    if(typeof p[k]!=='boolean')throw new SiError('SI_POLICY_BOOLEAN_INVALID');
  const limits={slotMinutes:[15,120],maxHorizonDays:[1,30],maxOptions:[1,10],
    prepMinutes:[0,240],travelBufferMinutes:[0,240],maxDailyInspections:[1,10],
    maxSnapshotAgeHours:[1,168]};
  for(const [key,[min,max]] of Object.entries(limits))
    if(!Number.isInteger(p[key])||p[key]<min||p[key]>max)throw new SiError('SI_POLICY_LIMIT_INVALID');
  if(!p.weights||Object.values(p.weights).some(x=>!Number.isInteger(x)||x<0||x>100)||
    ['earliness','travel','workload','availability','continuity'].some(k=>!Number.isInteger(p.weights[k]))||
    Object.keys(p.weights).length!==5||Object.values(p.weights).reduce((a,b)=>a+b,0)!==100)
    throw new SiError('SI_POLICY_WEIGHTS_INVALID');
  return clone(p);
}
function writeAtomic(path,data){
  mkdirSync(dirname(path),{recursive:true});
  const tmp=path+'.tmp-'+process.pid;
  writeFileSync(tmp,JSON.stringify(data,null,2),{mode:0o600});renameSync(tmp,path);
}
export class SiElectronicScheduler{
  constructor({erp,cases,path=process.env.SI_SCHEDULING_STORE_PATH||'/data/si-scheduling-poc.json',clock=()=>Date.now()}){
    this.erp=erp;this.cases=cases;this.path=path;this.clock=clock;this.lock=false;
    this.state={schema:1,policyHistory:[{revision:1,publishedAt:new Date(clock()).toISOString(),
      publishedBy:'SYSTEM',reason:'Conservative NMC POC baseline',config:DEFAULT_POLICY}],
      proposals:[],confirmed:[],audit:[]};
    if(existsSync(path)){
      try{const value=JSON.parse(readFileSync(path,'utf8'));
        if(value?.schema===1&&Array.isArray(value.policyHistory)&&Array.isArray(value.confirmed))
          this.state=value;
      }catch{console.error('[si-scheduling] saved POC workspace unreadable; fail closed');}
    }
  }
  save(){writeAtomic(this.path,this.state);}
  getPolicy(){return clone(this.state.policyHistory.at(-1));}
  publishPolicy({expectedRevision,reason,publishedBy,config}){
    const prev=this.getPolicy();
    if(expectedRevision!==prev.revision)throw new SiError('SI_POLICY_VERSION_CONFLICT',409);
    if(typeof reason!=='string'||reason.trim().length<8||reason.length>500||
       typeof publishedBy!=='string'||!publishedBy.trim()||publishedBy.length>100)
      throw new SiError('SI_POLICY_REASON_REQUIRED');
    const next={revision:prev.revision+1,publishedAt:new Date(this.clock()).toISOString(),
      publishedBy:publishedBy.trim(),reason:reason.trim(),config:validation(config)};
    this.state.policyHistory.push(next);this.state.audit.push({event:'POLICY_PUBLISHED',
      at:next.publishedAt,revision:next.revision});
    this.save();return clone(next);
  }
  history(){return clone(this.state.policyHistory).reverse();}
  async referrals(){return (await this.cases.listInspectionRequests()).filter(
    r=>r.caseStatus!=='RESOLVED'&&r.status==='PENDING_SCHEDULING'
  );}
  async centralBookings(snapshot){
    // Existing NMC schedules may have been made using the legacy human form.
    // Include those allocations rather than considering only bookings made here.
    // Legacy cases store a start but no duration; reserve a conservative 3 hours.
    const refs=await this.cases.listInspectionRequests();
    const people=snapshot.data.Inspectors;
    return refs.filter(r=>r.status==='SCHEDULED'&&r.scheduledAt&&r.inspector)
      .flatMap(r=>{
        const person=people.find(p=>p.display_name===r.inspector);
        const start=Date.parse(r.scheduledAt);
        return person&&Number.isFinite(start)?[{
          inspectorId:person.inspector_id,startUtc:new Date(start).toISOString(),
          endUtc:new Date(start+180*MINUTE).toISOString()
        }]:[];
      });
  }
  buildOptions(input,{snapshot,policy,confirmed=[]}){
    const data=snapshot.data,cfg=policy.config;
    const port=data.Ports.find(x=>x.port_id===input.portId&&active(x.active));
    if(!port)throw new SiError('SI_UNKNOWN_PORT',422);
    if(!['CARGO','TANKER','PASSENGER','OTHER'].includes(input.vesselType?.toUpperCase()))
      throw new SiError('SI_VESSEL_TYPE_REQUIRED');
    if(!['FOCUSED','PSC','FLAG'].includes(input.regime))throw new SiError('SI_INVALID_REGIME');
    if(!Number.isInteger(input.durationMinutes)||input.durationMinutes<30||input.durationMinutes>720)
      throw new SiError('SI_DURATION_INVALID');
    const start=parseLocal(input.earliestLocal),end=parseLocal(input.deadlineLocal);
    if(start<=this.clock()||end<=start||end-start>cfg.maxHorizonDays*DAY)
      throw new SiError('SI_INSPECTION_WINDOW_INVALID',422);
    const exclusions=[],options=[],slotMs=cfg.slotMinutes*MINUTE,duration=input.durationMinutes*MINUTE;
    const startSlot=Math.ceil(start/slotMs)*slotMs;
    const upper=Math.min(end,this.clock()+cfg.maxHorizonDays*DAY);
    for(const engineer of data.Inspectors){
      const reasons=[];
      const qualifications=data.Qualifications.filter(q=>q.inspector_id===engineer.inspector_id&&active(q.active)
        &&q.inspection_regime===input.regime
        &&['ANY',input.vesselType.toUpperCase()].includes(q.vessel_type.toUpperCase())
        &&q.valid_until>=localDate(startSlot));
      if(!active(engineer.active))reasons.push('EMPLOYEE_INACTIVE');
      if(!qualifications.length)reasons.push('QUALIFICATION_MISSING_OR_EXPIRED');
      const effectivePorts=data.Inspector_Ports.filter(r=>r.inspector_id===engineer.inspector_id&&active(r.active)
        &&inEffective(localDate(startSlot),r.effective_from,r.effective_to));
      let crossPort=false,travelMinutes=0;
      const assigned=effectivePorts.some(r=>r.port_id===input.portId);
      if(!assigned){
        crossPort=true;
        const route=data.Travel_Matrix.find(r=>r.from_port_id===engineer.home_port_id&&r.to_port_id===input.portId
          &&active(r.route_allowed));
        if(!cfg.allowCrossPort||!route)reasons.push('PORT_NOT_ELIGIBLE');
        else travelMinutes=Number(route.one_way_minutes);
      }
      if(reasons.length){exclusions.push({inspectorId:engineer.inspector_id,reasons});continue;}
      let sawApprovedLeave=false,sawConflict=false,sawShift=false,sawCapacity=false,sawBlackout=false;
      const candidateSlots=[];
      for(let slot=startSlot;slot+duration<=upper;slot+=slotMs){
        const date=localDate(slot),time=localTime(slot),day=dayName(slot);
        if(!qualifications.some(q=>q.valid_until>=date))continue;
        if(!crossPort&&!effectivePorts.some(r=>r.port_id===input.portId&&
          inEffective(date,r.effective_from,r.effective_to)))continue;
        const prep=(cfg.prepMinutes+(crossPort?travelMinutes+cfg.travelBufferMinutes:0))*MINUTE;
        const shift=data.Shifts.some(s=>s.inspector_id===engineer.inspector_id&&
          s.weekday===day&&s.status==='WORKING'&&inEffective(date,s.effective_from,s.effective_to)&&
          slot-prep>=parseLocal(date+' '+s.start_local)&&
          slot+duration<=parseLocal(date+' '+s.end_local));
        if(!shift){sawShift=true;continue;}
        // Port access windows are hard constraints, independent of inspector shift.
        if(slot<parseLocal(date+' '+port.window_start)||
           slot+duration>parseLocal(date+' '+port.window_end)){
          sawShift=true;continue;
        }
        const blocked=data.Blackouts.some(b=>active(b.blocks_booking)&&(b.port_id_or_ALL==='ALL'||b.port_id_or_ALL===port.port_id)
          &&intervalOverlap(slot,slot+duration,parseLocal(b.start_local),parseLocal(b.end_local)));
        if(blocked){sawBlackout=true;continue;}
        const approved=data.Leaves.some(l=>l.inspector_id===engineer.inspector_id&&l.approval_status==='APPROVED'
          &&intervalOverlap(slot-prep,slot+duration,parseLocal(l.start_local),parseLocal(l.end_local)));
        if(approved){sawApprovedLeave=true;continue;}
        const pending=data.Leaves.some(l=>l.inspector_id===engineer.inspector_id&&l.approval_status==='PENDING'
          &&intervalOverlap(slot-prep,slot+duration,parseLocal(l.start_local),parseLocal(l.end_local)));
        const currentBookings=[
          ...data.Bookings.filter(b=>b.inspector_id===engineer.inspector_id&&
            ['CONFIRMED','IN_PROGRESS'].includes(b.booking_status)).map(b=>({start:parseLocal(b.start_local),end:parseLocal(b.end_local)})),
          ...confirmed.filter(b=>b.inspectorId===engineer.inspector_id)
            .map(b=>({start:Date.parse(b.startUtc),end:Date.parse(b.endUtc)}))
        ];
        if(currentBookings.some(b=>intervalOverlap(slot-prep,slot+duration+cfg.travelBufferMinutes*MINUTE,
          b.start,b.end))){sawConflict=true;continue;}
        if(currentBookings.filter(b=>localDate(b.start)===date).length>=
          Math.min(cfg.maxDailyInspections,Number(engineer.daily_capacity))){
          sawCapacity=true;continue;
        }
        const reasons=[];
        if(crossPort&&cfg.crossPortRequiresApproval)reasons.push('CROSS_PORT_REQUIRES_APPROVAL');
        if(pending&&cfg.pendingLeaveRequiresApproval)reasons.push('PENDING_LEAVE_REQUIRES_APPROVAL');
        const dayBookings=currentBookings.filter(b=>localDate(b.start)===date).length;
        const delayRatio=Math.min(1,(slot-start)/Math.max(slotMs,end-start));
        const travelRatio=Math.min(1,travelMinutes/240);
        const capacityRatio=dayBookings/Math.max(1,Number(engineer.daily_capacity));
        const score=Math.max(0,Math.round(100-
          (delayRatio*cfg.weights.earliness+travelRatio*cfg.weights.travel+
          capacityRatio*cfg.weights.workload+delayRatio*cfg.weights.availability)));
        candidateSlots.push({optionId:engineer.inspector_id+'-'+slot,
          inspectorId:engineer.inspector_id,inspectorName:engineer.display_name,
          portId:input.portId,portName:port.port_name,
          startUtc:new Date(slot).toISOString(),
          endUtc:new Date(slot+duration).toISOString(),startLocal:localDateTime(slot),
          endLocal:localDateTime(slot+duration),crossPort,travelMinutes,
          score,manualReasons:reasons});
      }
      if(candidateSlots.length){
        candidateSlots.sort((a,b)=>b.score-a.score||a.startUtc.localeCompare(b.startUtc));
        options.push(...candidateSlots.slice(0,3));
      }else{
        if(sawApprovedLeave)reasons.push('APPROVED_LEAVE');
        if(sawConflict)reasons.push('BOOKING_CONFLICT');
        if(sawBlackout)reasons.push('PORT_BLACKOUT');
        if(sawCapacity)reasons.push('CAPACITY_EXCEEDED');
        if(sawShift)reasons.push('NO_WORKING_SHIFT');
        exclusions.push({inspectorId:engineer.inspector_id,reasons:reasons.length?reasons:['NO_FEASIBLE_SLOT']});
      }
    }
    options.sort((a,b)=>b.score-a.score||a.startUtc.localeCompare(b.startUtc));
    return {options:options.slice(0,cfg.maxOptions),exclusions};
  }
  async propose(body){
    const rows=await this.referrals();
    const referral=rows.find(r=>r.id===body?.referralId);
    if(!referral)throw new SiError('SI_APPROVED_NMC_REFERRAL_REQUIRED',404);
    const snapshot=this.erp.requireSnapshot(),policy=this.getPolicy();
    const input={
      referralId:referral.id,caseId:referral.caseId,imo:referral.imo,
      sourceLevel:referral.sourceLevel||'High',sourceAssessmentId:referral.sourceAssessmentId,
      portId:body.portId,earliestLocal:body.earliestLocal,deadlineLocal:body.deadlineLocal,
      regime:body.regime||'FOCUSED',vesselType:String(body.vesselType||'').toUpperCase(),
      durationMinutes:body.durationMinutes
    };
    const centralBookings=await this.centralBookings(snapshot);
    const calculated=this.buildOptions(input,{snapshot,policy,
      confirmed:[...this.state.confirmed,...centralBookings]});
    // An old ERP sheet cannot be made "fresh" merely by re-uploading it.
    // Use the oldest employee update timestamp for conservative auto-approval.
    const sourceDates=snapshot.data.Inspectors.map(r=>parseLocal(r.source_updated_at));
    const oldestSourceUpdate=Math.min(...sourceDates);
    const ageHours=(this.clock()-Math.min(Date.parse(snapshot.importedAt),oldestSourceUpdate))/3600000;
    const reasons=[];
    if(ageHours>policy.config.maxSnapshotAgeHours)reasons.push('ERP_SNAPSHOT_STALE');
    if(policy.config.approvalMode==='MANUAL')reasons.push('MANUAL_MODE');
    if(!policy.config.autoApproveNmcReferrals)reasons.push('NMC_REFERRALS_REQUIRE_APPROVAL');
    if(RISK_ORDER.indexOf(input.sourceLevel)>RISK_ORDER.indexOf(policy.config.autoMaxRiskLevel))
      reasons.push('RISK_REQUIRES_APPROVAL');
    const proposal={id:randomUUID(),status:calculated.options.length?'PROPOSED':'NO_FEASIBLE_SLOT',
      createdAt:new Date(this.clock()).toISOString(),expiresAt:new Date(this.clock()+10*MINUTE).toISOString(),
      erpSnapshotId:snapshot.snapshotId,policyRevision:policy.revision,
      referral,input,options:calculated.options.map(option=>{
        const manualReasons=[...new Set([...reasons,...option.manualReasons])];
        return {...option,approval:policy.config.approvalMode==='AUTO'&&!manualReasons.length?
          'AUTO_ELIGIBLE':policy.config.approvalMode==='HYBRID'&&!manualReasons.length?
          'AUTO_ELIGIBLE':'MANUAL_APPROVAL_REQUIRED',approvalReasons:manualReasons};
      }),exclusions:calculated.exclusions};
    this.state.proposals.push(proposal);
    if(this.state.proposals.length>200)this.state.proposals.shift();
    this.state.audit.push({event:'PROPOSAL_GENERATED',id:proposal.id,at:proposal.createdAt,
      referralId:referral.id,status:proposal.status});this.save();
    return clone(proposal);
  }
  list(){return clone(this.state.proposals).reverse().slice(0,50);}
  async confirm({proposalId,optionId,allowManual=false}){
    if(this.lock)throw new SiError('SI_SCHEDULING_BUSY',409);
    this.lock=true;
    try{
      const proposal=this.state.proposals.find(p=>p.id===proposalId);
      if(!proposal||proposal.status!=='PROPOSED'||this.clock()>Date.parse(proposal.expiresAt))
        throw new SiError('SI_PROPOSAL_EXPIRED',409);
      const option=proposal.options.find(o=>o.optionId===optionId);
      if(!option)throw new SiError('SI_OPTION_NOT_FOUND',404);
      if(option.approval==='MANUAL_APPROVAL_REQUIRED'&&!allowManual)
        throw new SiError('SI_SUPERVISOR_APPROVAL_REQUIRED',403);
      const snapshot=this.erp.requireSnapshot(),policy=this.getPolicy();
      const sourceDates=snapshot.data.Inspectors.map(r=>parseLocal(r.source_updated_at));
      const freshness=Math.min(Date.parse(snapshot.importedAt),...sourceDates);
      if(snapshot.snapshotId!==proposal.erpSnapshotId||policy.revision!==proposal.policyRevision||
        (this.clock()-freshness)/3600000>policy.config.maxSnapshotAgeHours)
        throw new SiError('SI_PROPOSAL_STALE',409);
      const referral=(await this.referrals()).find(r=>r.id===proposal.referral.id&&
        r.caseId===proposal.referral.caseId);
      if(!referral)throw new SiError('SI_REFERRAL_NO_LONGER_PENDING',409);
      const centralBookings=await this.centralBookings(snapshot);
      const recomputed=this.buildOptions(proposal.input,{snapshot,policy,
        confirmed:[...this.state.confirmed,...centralBookings]});
      if(!recomputed.options.some(x=>x.optionId===optionId&&x.startUtc===option.startUtc))
        throw new SiError('SI_RESOURCE_UNAVAILABLE_REPLAN',409);
      const caseRow=await this.cases.get(referral.caseId);
      if(!caseRow||caseRow.status==='RESOLVED')throw new SiError('SI_CASE_UNAVAILABLE',409);
      const result=await this.cases.scheduleInspection(referral.caseId,caseRow.version,
        referral.id,{scheduledAt:option.startUtc,port:option.portName,inspector:option.inspectorName});
      const booked={proposalId,optionId,referralId:referral.id,caseId:referral.caseId,
        inspectorId:option.inspectorId,inspectorName:option.inspectorName,
        portId:option.portId,startUtc:option.startUtc,endUtc:option.endUtc,
        approvalMode:option.approval==='AUTO_ELIGIBLE'?'AUTO':'SUPERVISOR',
        policyRevision:proposal.policyRevision,erpSnapshotId:proposal.erpSnapshotId,
        confirmedAt:new Date(this.clock()).toISOString()};
      proposal.status='CONFIRMED';proposal.confirmed=booked;
      this.state.confirmed.push(booked);this.state.audit.push({event:'SCHEDULE_CONFIRMED',...booked});
      this.save();
      return {status:'ok',booking:clone(booked),caseVersion:result.version};
    }finally{this.lock=false;}
  }
}
