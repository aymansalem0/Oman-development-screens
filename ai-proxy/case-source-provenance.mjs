/**
 * NMC case A01 provenance preflight. Pure / non-billable and fail closed.
 *
 * A case's saved source assessment is immutable. A newer saved vessel risk
 * assessment must NEVER replace the original AI evidence silently.
 */
export function evaluateCaseAssessment(caseRow,current,historical=null){
  const sourceId=caseRow?.sourceAssessmentId||null;
  const currentId=current?.assessmentId||null;
  const isHistorical=Boolean(sourceId)&&sourceId!==currentId;
  const source=isHistorical?historical:current;
  const identityMatches=Boolean(source)&&source.imo===caseRow?.imo&&
    source.status==='COMPLETED'&&
    Number.isFinite(source.score)&&source.score===caseRow.sourceScore&&
    source.level===caseRow.sourceLevel&&
    Array.isArray(source.signals)&&[5,6].includes(source.signals.length)&&
    (!sourceId||source.assessmentId===sourceId);
  return {
    ready:Boolean(identityMatches),
    isHistorical,
    source:identityMatches?source:null,
    caseAssessmentId:sourceId,
    latestAssessmentId:currentId,
    caseScore:caseRow?.sourceScore??null,
    latestScore:Number.isFinite(current?.score)?current.score:null,
    latestAssessedAt:current?.assessedAt||null,
    caseLevel:caseRow?.sourceLevel??null,
    latestLevel:current?.level||null,
    sourceAssessedAt:identityMatches?source.assessedAt||null:null,
    requiresHistoricalAcknowledgement:isHistorical&&Boolean(identityMatches)
  };
}

/**
 * Pure check to guard a user's explicit approval against a race between the
 * preview and the paid A01 call (a new latest assessment may be saved).
 */
export function historicalApprovalValid(preview,{acknowledgeHistoricalAssessment=false,
  reviewedLatestAssessmentId=undefined}={}){
  if(!preview?.ready)return {ok:false,error:'CASE_SOURCE_ASSESSMENT_UNAVAILABLE'};
  if(!preview.isHistorical)return {ok:true};
  if(acknowledgeHistoricalAssessment!==true)
    return {ok:false,error:'CASE_HISTORICAL_ASSESSMENT_REVIEW_REQUIRED'};
  if(reviewedLatestAssessmentId!==preview.latestAssessmentId)
    return {ok:false,error:'CASE_HISTORICAL_ASSESSMENT_CONTEXT_CHANGED'};
  return {ok:true};
}
