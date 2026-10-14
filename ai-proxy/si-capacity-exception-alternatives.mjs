/**
 * Evidence-grounded next actions for vessels that did not fit the proposed
 * capacity plan. CONDITIONAL ONLY: no unapproved overtime slot, cross-port
 * booking, regulatory cancellation or invented source permission is created.
 *
 * SI-S01's existing Airia contract ranks actual feasible schedule variants;
 * it never receives or authorizes these conditional operational exceptions.
 */
const active=v=>v===true||v==='Y';
const regimeCode=v=>({
 PORT_STATE_CONTROL:'PSC',UAE_SERVICE_INSPECTION:'SERVICE',
 FOCUSED_INSPECTION:'FOCUSED',FOLLOW_UP_INSPECTION:'FOLLOW_UP'
}[v]||v);
const norm=v=>String(v||'').trim().toUpperCase();
const allowedQualification=(data,inspector,vessel,when)=>{
 const date=String(when||'').slice(0,10);
 const regimes=(vessel?.regimes||[]).map(regimeCode);
 return regimes.length>0&&regimes.every(regime=>
  data.Qualifications?.some(q=>
   q.inspector_id===inspector.inspector_id&&active(q.active)&&
   q.inspection_regime===regime&&
   (norm(q.vessel_type)==='ANY'||norm(q.vessel_type)===norm(vessel.vesselType))&&
   q.valid_until>=date));
};
export function suggestCapacityExceptionActions({
 proposal,selection,erpSnapshot,policy
}={}){
 if(!proposal?.rows||!selection?.roster||!erpSnapshot?.data)
  throw Error('SI_CAPACITY_EXCEPTION_INPUT_INVALID');
 const data=erpSnapshot.data;
 const selectedByImo=new Map(selection.roster.map(v=>[v.imo,v]));
 const mandatory=new Set(selection.mandatoryImos||[]);
 return proposal.rows.filter(row=>row.status==='UNSCHEDULED').map(row=>{
  const vessel=selectedByImo.get(row.imo),details=row.diagnostics||{};
  const portId=details.portId;
  const expectedDate=details.earliestLocal;
  const candidateInspectors=(data.Inspectors||[]).filter(person=>
   active(person.active)&&allowedQualification(data,person,vessel,expectedDate));
  const exclusions=new Map((row.exclusions||[]).map(x=>
   [x.inspectorId,x.reasons||[]]));
  const crossPort=portId&&policy?.config?.allowCrossPort?
   candidateInspectors.filter(person=>
    person.home_port_id!==portId&&
    (data.Travel_Matrix||[]).some(route=>
     route.from_port_id===person.home_port_id&&
     route.to_port_id===portId&&active(route.route_allowed)&&
     Number.isFinite(Number(route.one_way_minutes))&&
     Number(route.one_way_minutes)>=0)):[];

  const overtime=candidateInspectors.filter(person=>
   exclusions.get(person.inspector_id)?.includes('NO_WORKING_SHIFT'));
  const actions=[];
  if(crossPort.length)actions.push({
   code:'CROSS_PORT_ALTERNATIVE_REVIEW',
   inspectorIds:crossPort.slice(0,8).map(v=>v.inspector_id),
   prerequisiteCodes:['VALID_TRAVEL_ROUTE','HUMAN_SUPERVISOR_SIGNOFF',
    'REVALIDATE_SHIFT_LEAVE_CONFLICTS_AND_CAPACITY'],
   status:'CONDITIONAL_NOT_BOOKABLE',
   canExecuteAutomatically:false
  });
  if(overtime.length)actions.push({
   code:'OUT_OF_HOURS_SHIFT_APPROVAL_REVIEW',
   inspectorIds:overtime.slice(0,8).map(v=>v.inspector_id),
   prerequisiteCodes:['EXPLICIT_HR_OVERTIME_APPROVAL',
    'INSPECTOR_CONFIRMATION','PORT_ACCESS_WINDOW',
    'REVALIDATE_SHIFT_LEAVE_CONFLICTS_AND_CAPACITY'],
   status:'CONDITIONAL_NOT_BOOKABLE',
   canExecuteAutomatically:false
  });
  if(mandatory.has(row.imo)){
   actions.push({
    code:'ESCALATE_MANDATORY_INSPECTION_CAPACITY',
    inspectorIds:[],prerequisiteCodes:['REGULATORY_OFFICER_RESOLUTION'],
    status:'MANDATORY_CANNOT_BE_CANCELLED_AUTOMATICALLY',
    canExecuteAutomatically:false
   });
  }else{
   // No source-provided legal cancellation permission exists in the current
   // candidate model. An officer may seek a documented legal ruling, but
   // the system MUST NOT pretend that cancellation is already permitted.
   actions.push({
    code:'CHECK_REGULATORY_CANCELLATION_OR_DEFERRAL_ELIGIBILITY',
    inspectorIds:[],prerequisiteCodes:[
     'SOURCE_BACKED_PERMISSION_TO_CANCEL_OR_DEFER',
     'AUTHORIZED_OFFICER_DECISION','AUDITED_DISPOSITION'],
    status:'PERMISSION_UNVERIFIED_NO_CANCELLATION',
    canExecuteAutomatically:false
   });
  }
  return {imo:row.imo,sourceReason:row.blocker||null,
   diagnostics:details,mandatory:mandatory.has(row.imo),
   actions,readOnly:true,acceptedInspectorAssignment:null,
   aiProviderCalls:0,bookingsCreated:0,sourceDataChanged:false};
 });
}
