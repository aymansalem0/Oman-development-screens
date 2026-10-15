/**
 * MOEI Smart Inspection EXECUTION ORDER, independent of selection eligibility.
 * Business-approved sequence (2026-10-13):
 *  1. Nearer CONFIRMED future departure (ETD, never ETA).
 *  2. ACTIVE HUMAN-REVIEWED incident, incident-specific severity descending.
 *  3. Unknown/no verified signals: review, stable IMO ordering.
 * No invented departure window, third criterion, missing time, or risk score.
 */
export const SI_RANKING_CRITERIA=Object.freeze(['DEPARTURE_SOON','INCIDENT_SEVERITY']);
export function getSiRankingPolicy(config){
  const criteria=config?.ranking?.criteria||SI_RANKING_CRITERIA;
  if(!Array.isArray(criteria)||criteria.length!==2||
     criteria[0]!=='DEPARTURE_SOON'||criteria[1]!=='INCIDENT_SEVERITY')
    throw new TypeError('SI_RANKING_POLICY_INVALID');
  return {criteria:[...criteria]};
}
const verifiedIso=(date)=>{
  if(typeof date!=='string'||!/^20\d\d-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/.test(date))
    return null;
  const value=Date.parse(date);
  return Number.isFinite(value)?value:null;
};
export function inspectionRanking(vessel,clock=Date.now()){
  const rawEtD=vessel?.departureAt;
  // This field comes only from an explicitly reviewed departure SOURCE, never
  // port ETA or projected arrival. Past departures are not 'approaching'.
  const departure=verifiedIso(rawEtD);
  if(vessel?.departureVerified===true&&departure!==null&&departure>=clock)
    return {group:0,criterion:'DEPARTURE_SOON',departureAt:rawEtD,
      departureMs:departure,incidentSeverity:null,
      reason:'Verified ETD (departure), earliest departure first'};
  const severity=vessel?.incidentSeverity;
  if(vessel?.incidentHumanReviewed===true&&
      Number.isFinite(severity)&&severity>=0&&severity<=100)
    return {group:1,criterion:'INCIDENT_SEVERITY',departureAt:null,
      departureMs:null,incidentSeverity:severity,
      reason:'Human-reviewed active NMC incident risk score (not vessel risk)'};
  return {group:2,criterion:'PENDING_ADDITIONAL_RULES',departureAt:null,
    departureMs:null,incidentSeverity:null,
    reason:'ETD or human-reviewed incident severity unavailable; further criteria not yet defined'};
}
export function compareInspections(a,b,clock=Date.now()){
  const x=inspectionRanking(a,clock),y=inspectionRanking(b,clock);
  return x.group-y.group||
    (x.group===0?x.departureMs-y.departureMs:0)||
    (x.group===1?y.incidentSeverity-x.incidentSeverity:0)||
    String(a.imo||'').localeCompare(String(b.imo||''))||
    String(a.candidateKey||'').localeCompare(String(b.candidateKey||''));
}
