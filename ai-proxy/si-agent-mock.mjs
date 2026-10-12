/**
 * POC ONLY — stable shape-compatible responses replacing paid Airia calls
 * until the real agents and their schemas are approved.
 * These are deterministic TEST TEMPLATES, NOT image/document/vessel analyses.
 *
 * Strictly no HTTP requests, model calls or persisted business decisions.
 * C01 uses genuine candidate keys and submitted evidence references.
 * P01 and A04 retain their EXISTING downstream validators and contracts.
 */
export const SI_MOCK_MARKER='MOCK_POC_NOT_REAL_AI';
const unique=a=>[...new Set(a.filter(x=>typeof x==='string'&&x.trim()))];

export function mockSiP01(input){
  if(input?.schemaVersion!=='SI-P01-v1'||!Array.isArray(input.candidates))
    throw new TypeError('SI_P01_MOCK_INPUT_INVALID');
  return {recommendations:input.candidates.map((c,i)=>{
    const refs=unique(c.allowedEvidence||[]);
    if(!c.candidateKey||!refs.length)throw new TypeError('SI_P01_MOCK_EVIDENCE_REQUIRED');
    return {candidateKey:c.candidateKey,suggestedRank:i+1,
      rationale:'MOCK advisory ranking from saved inspection-case snapshot; the deterministic protected tier and published rules remain authoritative.',
      evidenceRefs:refs.slice(0,10),dataGaps:c.missingData||[],confidence:0.8};
  })};
}
export function mockSiA04(input){
  if(!Array.isArray(input?.baseChecklistItemIds)||
     !Array.isArray(input?.evidenceManifestRefs)||
     !input.evidenceManifestRefs.length||!input.baseChecklistItemIds.length)
    throw new TypeError('SI_A04_MOCK_EVIDENCE_REQUIRED');
  const evidenceIds=unique(input.evidenceManifestRefs);
  const checkIds=input.baseChecklistItemIds;
  // No predicted findings. No real analysis performed.
  const focusCheck=checkIds.includes('fire-safety')?'fire-safety':checkIds[0];
  return {
    dossierId:'MOCK-A04-POC',agentRunId:'MOCK-A04',
    focusAreas:[{category:'Documented inspection focus (MOCK)',
      priority:'WATCH',
      reason:'MOCK test recommendation only. Review available source evidence and physically inspect before recording any deficiency.',
      evidenceIds:evidenceIds.slice(0,1)}],
    checklistFocus:[{existingItemId:focusCheck,focus:'REVIEW',
      reason:'MOCK focus overlay: review mandatory checklist item with the inspector.',
      reasonEvidenceIds:evidenceIds.slice(0,1)}],
    predictedDeficiencies:[],
    suggestedAdditionalItems:[{
      title:'Visual check of fire-door closure condition (MOCK optional)',
      reason:'MOCK optional checklist extension for supervisor review. Not a confirmed finding or statutory requirement.',
      evidenceIds:evidenceIds.slice(0,1)}],
    missingEvidence:[],
    agentConfidence:0.8
  };
}
export function mockSiC01(input){
  if(input?.schemaVersion!=='SI-C01-v1'||!Array.isArray(input.candidates))
    throw new TypeError('SI_C01_MOCK_INPUT_INVALID');
  // C01 mock returns deterministic selection AND priority fields.
  // In Airia mode the same JSON contract is expected from the provider.
  const threshold=Number.isInteger(input.selectionRiskThreshold)?
    input.selectionRiskThreshold:65;
  const eligibleForAdvice=c=>{
    const nmc=c.sourceTypes?.includes('NMC_CASE');
    const risk=c.currentRisk?.score;
    return Number.isFinite(risk)&&(c.allowedEvidence||[]).length>0&&
      (nmc||risk>=threshold);
  };
  const ranked=input.candidates.filter(eligibleForAdvice)
    .sort((a,b)=>
      Number(b.sourceTypes?.includes('NMC_CASE'))-
        Number(a.sourceTypes?.includes('NMC_CASE'))||
      b.currentRisk.score-a.currentRisk.score||
      a.candidateKey.localeCompare(b.candidateKey));
  const orders=new Map(ranked.map((c,i)=>[c.candidateKey,i+1]));
  return {recommendations:input.candidates.map(c=>{
    if(!c.candidateKey||!Array.isArray(c.allowedEvidence))
      throw new TypeError('SI_C01_MOCK_CANDIDATE_INVALID');
    const evidenceRefs=unique(c.allowedEvidence).slice(0,12);
    const noRisk=!c.currentRisk||!Number.isFinite(c.currentRisk.score);
    const nmc=c.sourceTypes.includes('NMC_CASE');
    // Not even a POC demo may imply source selection when evidence is absent.
    const recommendation=eligibleForAdvice(c)?'SELECT_RECOMMENDED':'MANUAL_REVIEW';
    return {candidateKey:c.candidateKey,recommendation,confidence:0.8,
      suggestedRank:recommendation==='SELECT_RECOMMENDED'?orders.get(c.candidateKey):null,
      priorityRationale:'MOCK order uses published NMC referral tier followed by saved risk descending. It never grants inspection approval; missing risk remains unknown.',
      reason:noRisk?'MOCK: NMC saved risk unavailable; supervisor must verify, never assume zero risk.':
        nmc?'MOCK: approved NMC referral with saved risk; officer must decide.':
        recommendation==='SELECT_RECOMMENDED'?
          'MOCK: source-backed PSC/service candidate meets saved-risk threshold; officer must approve separately.':
          'MOCK: PSC/service candidate below saved-risk threshold; officer review is required.',
      evidenceRefs,dataGaps:[
        ...(noRisk?['MISSING_NMC_SAVED_RISK']:[]),
        ...(!evidenceRefs.length?['MISSING_SOURCE_EVIDENCE']:[])
      ]};
  })};
}
