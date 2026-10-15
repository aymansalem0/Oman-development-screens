import type {NmcMaritimeIncident} from './nmc-incidents.service';

/** Shared, source-grounded incident filters for Command Center (never vessel risk). */
export type NmcIncidentFilter='All'|'Active'|'Critical'|'High'|'PendingReview'|'None';
export type IncidentSeverityBand='CRITICAL'|'HIGH'|'MODERATE'|'LOW'|'UNASSESSED';

export function isActiveNmcIncident(row:NmcMaritimeIncident):boolean{
  return !['CLOSED','RESOLVED'].includes((row.operationalStatus||'').toUpperCase());
}

/** AI severity is authoritative only for a current saved incident-specific result.
 *  Otherwise display the source's REPORTED severity, not an invented AI score. */
export function incidentSeverityBand(row:NmcMaritimeIncident):IncidentSeverityBand{
  if(row.aiAssessment&&!row.aiAssessmentStale)
    return row.aiAssessment.incidentRiskBand;
  switch((row.reportedSeverity||'').toUpperCase()){
    case 'CRITICAL':return 'CRITICAL';
    case 'HIGH':return 'HIGH';
    case 'MEDIUM':return 'MODERATE';
    case 'LOW':return 'LOW';
    default:return 'UNASSESSED';
  }
}

/** Human approval is tracked independently in the central case and in
 *  incident-source AI review. A pending AI analysis is NOT a human decision. */
export function incidentPendingHumanReview(row:NmcMaritimeIncident):boolean{
  if(row.caseIncidentDecisionStatus==='PENDING_HUMAN_REVIEW')return true;
  const ai=row.aiAssessment;
  return !!ai&&!row.aiAssessmentStale&&ai.assessmentStatus!=='HUMAN_REVIEWED';
}

/** All filters other than All/None apply to ACTIVE incidents of an exact IMO.
 *  The caller must supply only incidents already joined by that IMO.
 *  Does not infer incidents from vessel A01/A02 risk scores or map fixtures. */
export function vesselMatchesIncidentFilter(filter:NmcIncidentFilter,
  incidentRows:readonly NmcMaritimeIncident[]):boolean{
  if(filter==='All')return true;
  const active=incidentRows.filter(isActiveNmcIncident);
  if(filter==='None')return active.length===0;
  if(filter==='Active')return active.length>0;
  if(filter==='Critical')
    return active.some(row=>incidentSeverityBand(row)==='CRITICAL');
  if(filter==='High')
    return active.some(row=>incidentSeverityBand(row)==='HIGH');
  if(filter==='PendingReview')
    return active.some(incidentPendingHumanReview);
  return false;
}
