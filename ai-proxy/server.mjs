import { createServer } from 'node:http';
import { getPscVessel, getPscHealth } from './psc-reader.mjs';
import { FleetAssessmentManager } from './fleet-ai.mjs';
import { FleetAutoScheduler } from './fleet-scheduler.mjs';
import { DashboardWorkspace, DashboardError } from './dashboard-workspace.mjs';
import { NmcAlertWorkspace, NmcAlertError } from './alert-workspace.mjs';
import { NmcCaseWorkspace, NmcCaseError } from './case-workspace.mjs';
import { normalizeA01Actions, ActionPlanError } from './nmc-action-plan.mjs';
import { OperationalGuidance, GuidanceError } from './operational-guidance.mjs';

const port = Number(process.env.PORT || 3000);
const apiKey = (process.env.AIRIA_MENA_KEY || '').trim();
const baseUrl = (process.env.AIRIA_BASE_URL || 'https://mena.api.airia.ai').replace(/\/$/, '');
const timeoutMs = Math.min(180000, Math.max(1000, Number(process.env.AIRIA_TIMEOUT_MS || 120000)));
const maxBytes = 1024 * 1024; // Single agent call body.
const autoEnabled = process.env.NMC_FLEET_AUTO_ENABLED === 'true';
const autoInterval = Number(process.env.NMC_FLEET_REFRESH_SECONDS || 3600) * 1000;

// Partner API guide, 08 Oct 2026, A01-A04 v3.1.
const pipelines = Object.freeze({
  a01: process.env.AIRIA_A01_PIPELINE_ID || '86904bc8-e552-4172-aaa8-1a79cbb9539d',
  a02: process.env.AIRIA_A02_PIPELINE_ID || '73708937-ba16-47e3-b404-55cc0a54b159',
  a03: process.env.AIRIA_A03_PIPELINE_ID || '603d32f6-2f5f-42a8-a592-77af571a2480',
  a04: process.env.AIRIA_A04_PIPELINE_ID || 'bad751da-0e11-48fd-861d-5bde1afbbd8d'
});

async function fleetAgentCall(agent,input) {
  if (!apiKey) throw new Error('AIRIA_NOT_CONFIGURED');
  const upstream=await fetch(baseUrl+'/v1/PipelineExecution/'+pipelines[agent],{
    method:'POST',
    headers:{'X-API-KEY':apiKey,'Content-Type':'application/json','User-Agent':'moei-nmc-fleet/1.0'},
    body:JSON.stringify({userInput:JSON.stringify(input),asyncOutput:false}),
    signal:AbortSignal.timeout(timeoutMs)
  });
  if (!upstream.ok) throw new Error('AIRIA_REQUEST_FAILED_'+upstream.status);
  const raw=await upstream.text();
  try {return JSON.parse(raw);} catch {throw new Error('AIRIA_RESPONSE_INVALID_JSON');}
}
const dbMode=(process.env.NMC_DB_MODE || 'json').toLowerCase();
if(!['json','oracle'].includes(dbMode))throw new Error('NMC_DB_MODE_UNSUPPORTED');
const repository=dbMode==='oracle'
  ? new (await import('./oracle-store.mjs')).OracleIntelligenceStore()
  : null;
let guidance;
const fleet=new FleetAssessmentManager({executeAgent:fleetAgentCall,getPscVessel,repository,
  onAssessmentSaved:async row=>guidance?.materialize(row.imo)});
guidance=new OperationalGuidance({mode:dbMode,oracleRepository:repository,fleet});
const dashboards=new DashboardWorkspace({mode:dbMode,oracleRepository:repository});
const alerts=new NmcAlertWorkspace({mode:dbMode,oracleRepository:repository});
const cases=new NmcCaseWorkspace({mode:dbMode,oracleRepository:repository,alerts});
const actionPlanRuns=new Set(); // process-local duplicate A01 invocation guard; version-lock remains authoritative
const alertScanEnabled=process.env.NMC_ALERT_SCAN_ENABLED!=='false';
const alertScanIntervalMs=Math.max(15000,Number(process.env.NMC_ALERT_SCAN_SECONDS||30)*1000);
async function scanExistingFleetForAlerts(){
  try{
    // Intentionally read saved in-memory fleet records only. No Airia calls.
    const result=await alerts.scanFleet(fleet.snapshot());
    if(result?.created||result?.escalated)
      console.info('[nmc-alerts] detected='+result.created+' escalated='+result.escalated);
  }catch(error){
    const code=error instanceof NmcAlertError?error.code:'ALERT_SCAN_FAILED';
    console.error('[nmc-alerts] '+code);
  }
}
const scheduler=new FleetAutoScheduler({fleet,getPscVessel,
  enabled:autoEnabled && Boolean(apiKey),intervalMs:autoInterval,
  maxVessels:process.env.NMC_FLEET_AUTO_MAX_VESSELS || 420,
  retryFailed:process.env.NMC_FLEET_AUTO_RETRY_FAILED === 'true'});

function respond(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(body);
}

async function requestJson(req, limit = maxBytes) {
  let received = 0;
  const chunks = [];
  for await (const chunk of req) {
    received += chunk.length;
    if (received > limit) {
      const error = new Error('JSON request exceeds permitted limit');
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  let parsed;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    const error = new Error('Request must be valid JSON');
    error.status = 400;
    throw error;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    const error = new Error('Request must contain a JSON object');
    error.status = 400;
    throw error;
  }
  return parsed;
}


// Only an explicit operator creation or retry calls Airia A01: never GET,
// dashboard display, alert scanning or page refresh.
async function prepareCaseA01Actions(caseId,version){
          const existing=await cases.get(caseId);
          if(!existing)throw new NmcCaseError('CASE_NOT_FOUND',404);
          if(existing.version!==version)throw new NmcCaseError('CASE_VERSION_CONFLICT',409);
          if(existing.status==='RESOLVED')throw new NmcCaseError('CASE_ALREADY_RESOLVED',409);
          if(existing.actionPlan)throw new NmcCaseError('CASE_ACTION_PLAN_EXISTS',409);
          if(actionPlanRuns.has(caseId))throw new NmcCaseError('CASE_ACTION_PLAN_IN_PROGRESS',409);
          if(!apiKey)throw new NmcCaseError('AIRIA_NOT_CONFIGURED',503);
          // Strong provenance check: use ONLY the exact saved A01/A02 assessment
          // that initiated this case. Never silently use the synthetic fixture or
          // a newer scored assessment that superseded the event.
          const source=fleet.getVesselResult(existing.imo);
          if(!source||source.status!=='COMPLETED'||
            source.score!==existing.sourceScore||source.level!==existing.sourceLevel||
            !Array.isArray(source.signals)||source.signals.length!==5)
            throw new NmcCaseError('CASE_SOURCE_ASSESSMENT_UNAVAILABLE',409);
          // Older PR42 alerts omitted the assessment ID from the snapshot.
          // Reconcile ONLY when the persisted alert timestamp/ruleset and current
          // saved AI source prove it was already assessed before that alert.
          let legacyReconciled=false;
          if(source.assessmentId!==existing.sourceAssessmentId){
            const alert=existing.sourceAssessmentId===null&&existing.alertIds?.length
              ?await alerts.get(existing.alertIds[0]):null;
            const assessedAt=Date.parse(source.assessedAt||'');
            const alertedAt=Date.parse(alert?.createdAt||'');
            if(!alert||alert.imo!==existing.imo||
              alert.sourceAssessmentId!==null||
              alert.sourceScore!==source.score||alert.sourceLevel!==source.level||
              !alert.sourceRulesetVersion||
              alert.sourceRulesetVersion!==source.configVersion||
              !source.assessmentId||!Number.isFinite(assessedAt)||
              !Number.isFinite(alertedAt)||assessedAt>alertedAt)
              throw new NmcCaseError('CASE_SOURCE_ASSESSMENT_UNAVAILABLE',409);
            legacyReconciled=true;
          }
          actionPlanRuns.add(caseId);
          try {
            const input={
              requestMeta:{correlationId:'CASE-'+caseId+'-'+existing.version,language:'en'},
              subject:{type:'VESSEL',imo:existing.imo},bundleRef:'VBL-'+existing.imo,
              mode:'SITUATION_ASSESSMENT',
              officialRisk:{
                evaluationId:existing.sourceAssessmentId,score:existing.sourceScore,
                level:existing.sourceLevel,rulesetVersion:source.configVersion
              },
              riskSignalRunId:existing.sourceAssessmentId,
              requestedOutputs:['SUMMARY','WHY_IT_MATTERS','EVIDENCE','ACTIONS'],
              approvedSignalEvidence:source.signals.map(s=>({
                factor:s.factor,severity:s.severity,evidenceIds:s.evidenceIds,
                reason:s.reason
              })),
              provenance:'SYNTHETIC_POC_NOT_REGULATORY'
            };
            const raw=await fleetAgentCall('a01',input);
            const plan=normalizeA01Actions(raw,{
              imo:existing.imo,assessmentId:existing.sourceAssessmentId,
              score:existing.sourceScore,level:existing.sourceLevel,
              configVersion:source.configVersion,signals:source.signals
            });
            // Provenance of the evidence actually supplied to A01, distinct from
            // the immutable legacy case field that may have been null.
            plan.evidenceAssessmentId=source.assessmentId;
            plan.legacySourceReconciled=legacyReconciled;
            return await cases.saveActionPlan(caseId,version,plan);
          }finally{actionPlanRuns.delete(caseId);}
}

const server = createServer(async (req, res) => {
  const path = new URL(req.url || '/', 'http://localhost').pathname;

  if (req.method === 'GET' && path === '/api/ai/health') {
    const db=repository?await repository.health():{mode:'json',ready:true};
    return respond(res, db.ready?200:503, {
      status:db.ready?'ok':'degraded',aiConfigured:Boolean(apiKey),
      adapter:'nmc-airia-proxy',fleetAutoEnabled:scheduler.enabled,
      persistence:db,persistenceHealthy:fleet.persistenceHealthy
    });
  }

  if (req.method === 'GET' && path === '/api/ai/psc/health') {
    return respond(res, 200, getPscHealth());
  }
  if (req.method === 'GET' && path === '/api/ai/fleet/status') {
    return respond(res,200,{...fleet.snapshot(),storageMode:dbMode,persistenceHealthy:fleet.persistenceHealthy,scheduler:scheduler.status()});
  }
  // Fetch Again: fresh direct Oracle read, no dashboard-triggered AI.
  if(req.method==='GET'&&path==='/api/ai/fleet/saved-status'){
    try{
      const saved=await fleet.savedSnapshot();
      return respond(res,200,{...saved,storageMode:dbMode,
        persistenceHealthy:fleet.persistenceHealthy,scheduler:scheduler.status(),
        fetchedFrom:dbMode==='oracle'?'ORACLE':'PERSISTED_JSON',
        fetchedAt:new Date().toISOString()});
    }catch(error){
      console.error('[nmc-fleet] SAVED_STATUS_READ_FAILED');
      return respond(res,503,{error:'FLEET_SAVED_READ_FAILED'});
    }
  }
  if (req.method === 'GET' && path === '/api/ai/fleet/analytics') {
    return respond(res, 200, fleet.analytics());
  }
  const fleetResultMatch = /^\/api\/ai\/fleet\/results\/(\d{7})$/.exec(path);
  if (req.method === 'GET' && fleetResultMatch) {
    const record=fleet.getVesselResult(fleetResultMatch[1]);
    return respond(res,record?200:404,record||{error:'FLEET_ASSESSMENT_NOT_FOUND'});
  }
  const intelligenceMatch = /^\/api\/ai\/fleet\/intelligence\/(\d{7})$/.exec(path);
  if(req.method==='GET' && intelligenceMatch){
    try {
      const data=await fleet.intelligence(intelligenceMatch[1]);
      return respond(res,data?200:404,data||{error:'FLEET_INTELLIGENCE_NOT_FOUND'});
    }catch{return respond(res,503,{error:'FLEET_INTELLIGENCE_UNAVAILABLE'});}
  }
  const historyMatch = /^\/api\/ai\/fleet\/history\/(\d{7})$/.exec(path);
  if(req.method==='GET' && historyMatch){
    try{
      const data=await fleet.history(historyMatch[1]);
      return respond(res,data?200:404,data||{error:'UNKNOWN_VESSEL'});
    }catch{return respond(res,503,{error:'FLEET_HISTORY_UNAVAILABLE'});}
  }
  // Platform guidance is NOT an AI agent. GET is strictly read-only and never calls Airia.
  if(path==='/api/ai/guidance/rules'||path.startsWith('/api/ai/guidance/')){
    try{
      if(path==='/api/ai/guidance/rules'&&req.method==='GET')
        return respond(res,200,{status:'ok',rules:await guidance.list()});
      if(path==='/api/ai/guidance/rules'&&req.method==='POST'){
        dashboards.assertRole(req,'EDITOR');
        const body=await requestJson(req,16384);
        return respond(res,201,{status:'ok',rule:await guidance.create(body.rule)});
      }
      const ruleMatch=/^\/api\/ai\/guidance\/rules\/(NMC-GUIDE-[0-9]{3,5})(?:\/(history|publish))?$/.exec(path);
      if(ruleMatch){
        const [,id,action]=ruleMatch;
        if(req.method==='GET'&&action==='history')
          return respond(res,200,{status:'ok',history:await guidance.history(id)});
        if(req.method==='PUT'&&!action){
          dashboards.assertRole(req,'EDITOR');
          const body=await requestJson(req,16384);
          return respond(res,200,{status:'ok',rule:await guidance.change(id,body.revision,'EDIT',body.rule)});
        }
        if(req.method==='POST'&&action==='publish'){
          dashboards.assertRole(req,'PUBLISHER');
          const body=await requestJson(req,4096);
          return respond(res,200,{status:'ok',rule:await guidance.change(id,body.revision,'PUBLISH')});
        }
      }
      const vesselMatch=/^\/api\/ai\/guidance\/vessels\/(\d{7})(?:\/(materialize))?$/.exec(path);
      if(vesselMatch){
        const [,imo,action]=vesselMatch;
        if(req.method==='GET'&&!action)return respond(res,200,await guidance.evaluate(imo));
        if(req.method==='POST'&&action==='materialize'){
          dashboards.assertRole(req,'PUBLISHER');
          return respond(res,200,await guidance.materialize(imo));
        }
      }
      return respond(res,405,{error:'METHOD_NOT_ALLOWED'});
    }catch(error){
      if(error instanceof GuidanceError||error instanceof DashboardError)
        return respond(res,error.status,{error:error.code});
      console.error('[nmc-guidance] API_FAILURE');
      return respond(res,503,{error:'GUIDANCE_UNAVAILABLE'});
    }
  }

  // Read-only cross-domain Smart Inspection scheduling queue from centrally saved cases.
  // Legacy synthetic targeting candidates remain a separate information source.
  if(path==='/api/ai/inspection-referrals'){
    if(req.method!=='GET')return respond(res,405,{error:'METHOD_NOT_ALLOWED'});
    try{return respond(res,200,{status:'ok',requests:await cases.listInspectionRequests()});}
    catch{return respond(res,503,{error:'CASE_STORE_UNAVAILABLE'});}
  }

  // A case is opened only after a human acknowledges a saved alert.
  // Audit and task changes are server-side, never browser-local session state.
  if(path==='/api/ai/cases'||path.startsWith('/api/ai/cases/')){
    const segments=path.split('/').filter(Boolean);
    const [, , resource, first, action, second, third]=segments;
    if(resource!=='cases')return respond(res,404,{error:'CASE_NOT_FOUND'});
    try{
      if(req.method==='GET'){
        if(!first)return respond(res,200,{status:'ok',cases:await cases.list()});
        if(first==='by-imo'&&/^\d{7}$/.test(action)&&!second){
          const item=await cases.byImo(action);
          return respond(res,200,{status:'ok',case:item});
        }
        if(/^[a-f\d-]{36}$/i.test(first)&&!second){
          if(action==='history')
            return respond(res,200,{status:'ok',history:await cases.history(first)});
          if(!action){
            const item=await cases.get(first);
            return respond(res,item?200:404,item?{status:'ok',case:item}:{error:'CASE_NOT_FOUND'});
          }
        }
        return respond(res,404,{error:'CASE_NOT_FOUND'});
      }
      if(req.method==='POST'){
        if(first==='from-alert'&&!action){
          dashboards.assertRole(req,'EDITOR');
          const body=await requestJson(req,4096);
          if(body.withAiActionPlan!==true)
            throw new NmcCaseError('CASE_CREATION_AI_REQUIRED',400);
          if(!apiKey)throw new NmcCaseError('AIRIA_NOT_CONFIGURED',503);
          const item=await cases.fromAlert(body.alertId);
          if(item.actionPlan)
            return respond(res,200,{status:'ok',case:item,aiActionPlanStatus:'READY'});
          try{
            // Exactly one requested A01 call as part of Create Maritime Case.
            // The case is persisted before A01, so retries never duplicate it.
            const planned=await prepareCaseA01Actions(item.id,item.version);
            return respond(res,200,{status:'ok',case:planned,aiActionPlanStatus:'READY'});
          }catch(error){
            // Fail closed: preserve the case and prior audit, but never pretend
            // AI proposals exist if the agent failed or returned invalid data.
            if(!(error instanceof NmcCaseError||error instanceof ActionPlanError||
                 String(error?.message||'').startsWith('AIRIA_')))throw error;
            const code=error instanceof NmcCaseError||error instanceof ActionPlanError
              ?error.code:'A01_ACTION_PLAN_UNAVAILABLE';
            const stored=await cases.get(item.id);
            return respond(res,200,{status:'ok',case:stored,
              aiActionPlanStatus:'FAILED',aiActionPlanError:{
                code,details:error instanceof ActionPlanError?error.details:{}
              }});
          }
        }
        if(!/^[a-f\d-]{36}$/i.test(first))return respond(res,404,{error:'CASE_NOT_FOUND'});
        if(action==='action-plan'&&second==='generate'&&!third){
          dashboards.assertRole(req,'EDITOR');
          const body=await requestJson(req,4096);
          const item=await prepareCaseA01Actions(first,body.version);
          return respond(res,200,{status:'ok',case:item});
        }
        if(action==='actions'&&second&&third==='decision'){
          dashboards.assertRole(req,'EDITOR');
          const body=await requestJson(req,4096);
          const item=await cases.decideAction(first,body.version,second,
            body.decision,body.note||'');
          return respond(res,200,{status:'ok',case:item});
        }
        if(action==='inspections'&&second&&third==='schedule'){
          dashboards.assertRole(req,'EDITOR');
          const body=await requestJson(req,4096);
          const item=await cases.scheduleInspection(first,body.version,second,body);
          return respond(res,200,{status:'ok',case:item});
        }
        if(action==='task'&&!second){
          dashboards.assertRole(req,'EDITOR');
          const body=await requestJson(req,4096);
          const item=await cases.task(first,body.version,body.taskId,
            body.action,body.note||'');
          return respond(res,200,{status:'ok',case:item});
        }
        if(action==='decision'&&!second){
          dashboards.assertRole(req,'EDITOR');
          const body=await requestJson(req,16384);
          const item=await cases.decision(first,body.version,body);
          return respond(res,200,{status:'ok',case:item});
        }
        if(action==='inspection'&&!second){
          dashboards.assertRole(req,'EDITOR');
          const body=await requestJson(req,8192);
          const item=await cases.inspection(first,body.version,body.outcome);
          return respond(res,200,{status:'ok',case:item});
        }
        if(action==='resolve'&&!second){
          dashboards.assertRole(req,'PUBLISHER');
          const body=await requestJson(req,4096);
          const item=await cases.resolve(first,body.version,body.note);
          return respond(res,200,{status:'ok',case:item});
        }
      }
      return respond(res,405,{error:'METHOD_NOT_ALLOWED'});
    }catch(error){
      if(error instanceof ActionPlanError)
        return respond(res,error.status,{error:error.code,details:error.details});
      if(error instanceof NmcCaseError||error instanceof NmcAlertError||
         error instanceof DashboardError)
        return respond(res,error.status,{error:error.code});
      if(Number.isInteger(error?.status)&&error.status>=400&&error.status<500)
        return respond(res,error.status,{error:'INVALID_REQUEST'});
      // Upstream AI faults must never be mistaken for case-store failures.
      const upstreamCode=String(error?.message||'');
      if(upstreamCode==='AIRIA_NOT_CONFIGURED')
        return respond(res,503,{error:'AIRIA_NOT_CONFIGURED'});
      if(upstreamCode.startsWith('AIRIA_'))
        return respond(res,502,{error:'A01_ACTION_PLAN_UNAVAILABLE'});
      console.error('[nmc-cases] API_FAILURE');
      return respond(res,503,{error:'CASE_STORE_UNAVAILABLE'});
    }
  }

  // In-app notifications and business alert workflow. Risk source is SAVED AI.
  // Shared POC editor/publisher secrets stand in for operator/supervisor
  // authorization until an authenticated IAM solution is installed.
  if(path==='/api/ai/alerts'||path.startsWith('/api/ai/alerts/')){
    const match=/^\/api\/ai\/alerts(?:\/([a-fA-F0-9-]{36})(?:\/(history|acknowledge|follow-up|escalate|resolve))?)?$/.exec(path);
    if(!match)return respond(res,404,{error:'ALERT_NOT_FOUND'});
    const [,id,action]=match;
    try{
      if(req.method==='GET'){
        if(!id)return respond(res,200,await alerts.overview());
        if(action==='history')return respond(res,200,{status:'ok',history:await alerts.history(id)});
        if(action)return respond(res,404,{error:'ALERT_NOT_FOUND'});
        const item=await alerts.get(id);
        return respond(res,item?200:404,item?{status:'ok',alert:item}:{error:'ALERT_NOT_FOUND'});
      }
      if(req.method==='POST'&&id&&action){
        const operations={
          acknowledge:'ACKNOWLEDGE','follow-up':'START_FOLLOW_UP',
          escalate:'ESCALATE',resolve:'RESOLVE'
        };
        if(!operations[action])return respond(res,405,{error:'METHOD_NOT_ALLOWED'});
        const supervisor=action==='resolve';
        dashboards.assertRole(req,supervisor?'PUBLISHER':'EDITOR');
        const body=await requestJson(req,4096);
        const updated=await alerts.transition(id,operations[action],
          body.version,body.note||'',supervisor?'SUPERVISOR':'OPERATOR');
        return respond(res,200,{status:'ok',alert:updated});
      }
      return respond(res,405,{error:'METHOD_NOT_ALLOWED'});
    }catch(error){
      if(error instanceof NmcAlertError||error instanceof DashboardError)
        return respond(res,error.status,{error:error.code});
      if(Number.isInteger(error?.status)&&error.status>=400&&error.status<500)
        return respond(res,error.status,{error:'INVALID_REQUEST'});
      console.error('[nmc-alerts] API_FAILURE');
      return respond(res,503,{error:'ALERT_STORE_UNAVAILABLE'});
    }
  }

  // Read-only, published-only sidebar navigation: never return drafts or templates.
  if(path==='/api/ai/dashboards/published'&&req.method==='GET'){
    try{return respond(res,200,{status:'ok',dashboards:await dashboards.publishedMenu()});}
    catch(error){
      if(error instanceof DashboardError)return respond(res,error.status,{error:error.code});
      return respond(res,503,{error:'DASHBOARD_STORE_UNAVAILABLE'});
    }
  }
  // Published dashboard sharing is read-only and intentionally excludes drafts.
  const publishedMatch = /^\/api\/ai\/dashboards\/published\/([a-zA-Z0-9_-]{1,100})$/.exec(path);
  if (publishedMatch) {
    if (req.method !== 'GET') return respond(res,405,{error:'METHOD_NOT_ALLOWED'});
    try {
      const board = await dashboards.get(publishedMatch[1]);
      if (!board || board.status !== 'PUBLISHED') {
        return respond(res,404,{error:'PUBLISHED_DASHBOARD_NOT_FOUND'});
      }
      return respond(res,200,{status:'ok',dashboard:board});
    } catch (error) {
      if (error instanceof DashboardError) return respond(res,error.status,{error:error.code});
      return respond(res,503,{error:'DASHBOARD_STORE_UNAVAILABLE'});
    }
  }

  // Dashboard read operations remain independent of Airia and Fleet scheduler.
  // Writes require a server-managed access key. Role labels are shared-key
  // permissions, not end-user identity. Integrate real IAM before production.
  if (path === '/api/ai/dashboards' || path.startsWith('/api/ai/dashboards/')) {
    const match=/^\/api\/ai\/dashboards(?:\/([a-zA-Z0-9_-]{1,100})(?:\/(publish|revisions|placement|edit))?)?$/.exec(path);
    if(!match)return respond(res,404,{error:'NOT_FOUND'});
    const [,id,action]=match;
    try{
      if(req.method==='GET'){
        if(!id)return respond(res,200,{status:'ok',dashboards:await dashboards.list()});
        if(action==='revisions')return respond(res,200,{status:'ok',revisions:await dashboards.revisions(id)});
        if(action)return respond(res,404,{error:'NOT_FOUND'});
        const item=await dashboards.get(id);
        return respond(res,item?200:404,item?{status:'ok',dashboard:item}:{error:'DASHBOARD_NOT_FOUND'});
      }
      if(req.method==='POST'&&!id&&!action){
        dashboards.assertRole(req,'EDITOR');
        const body=await requestJson(req,1024*128);
        return respond(res,201,{status:'ok',dashboard:await dashboards.create(body.dashboard)});
      }
      if(req.method==='PUT'&&id&&!action){
        dashboards.assertRole(req,'EDITOR');
        const body=await requestJson(req,1024*128);
        return respond(res,200,{status:'ok',dashboard:await dashboards.save(id,body.dashboard)});
      }
      if(req.method==='POST'&&id&&action==='edit'){
        dashboards.assertRole(req,'EDITOR');
        return respond(res,201,{
          status:'ok',dashboard:await dashboards.startPublishedEdit(id)
        });
      }
      if(req.method==='POST'&&id&&action==='publish'){
        dashboards.assertRole(req,'PUBLISHER');
        const body=await requestJson(req,1024*16);
        return respond(res,200,{status:'ok',dashboard:await dashboards.publish(id,body.version)});
      }
      if(req.method==='PATCH'&&id&&action==='placement'){
        dashboards.assertRole(req,'PUBLISHER');
        const body=await requestJson(req,1024*8);
        return respond(res,200,{status:'ok',
          dashboard:await dashboards.movePublished(id,body.menuPlacement,body.version)});
      }
      if(req.method==='DELETE'&&id&&!action){
        dashboards.assertRole(req,'EDITOR');
        const body=await requestJson(req,1024*16);
        await dashboards.archive(id,body.version);
        return respond(res,200,{status:'ok'});
      }
      return respond(res,405,{error:'METHOD_NOT_ALLOWED'});
    }catch(error){
      if(error instanceof DashboardError)return respond(res,error.status,{error:error.code});
      if(Number.isInteger(error?.status)&&error.status>=400&&error.status<500)
        return respond(res,error.status,{error:'INVALID_REQUEST'});
      console.error('[nmc-dashboard] request failure');
      return respond(res,503,{error:'DASHBOARD_STORE_UNAVAILABLE'});
    }
  }

  // Fleet mutation is internal to the Node scheduler; the dashboard is read-only.
  if (path === '/api/ai/fleet/start' || path === '/api/ai/fleet/cancel') {
    return respond(res,405,{error:'AUTONOMOUS_FLEET_ONLY'});
  }

  const pscMatch = /^\/api\/ai\/psc\/vessels\/(\d{7})$/.exec(path);
  if (req.method === 'GET' && pscMatch) {
    try { return respond(res, 200, await getPscVessel(pscMatch[1])); }
    catch (error) {
      const reason = error?.message || 'PSC_BACKEND_ERROR';
      const safeReason = /^[A-Z][A-Z0-9_]{1,90}$/.test(reason) ? reason : 'PSC_BACKEND_ERROR';
      console.error('[psc-reader] '+safeReason); // No Google credentials, records or stack traces logged.
      return respond(res, error?.status === 404 ? 404 : 503, {
        error: error?.status === 404 ? 'PSC_VESSEL_NOT_FOUND' : 'PSC_DATA_UNAVAILABLE',
        reasonCode: safeReason, sourceMode:getPscHealth().sourceMode
      });
    }
  }

  const match = /^\/api\/ai\/execute\/(a01|a02|a03|a04)$/i.exec(path);
  if (!match) return respond(res, 404, { error: 'NOT_FOUND' });
  if (req.method !== 'POST') return respond(res, 405, { error: 'METHOD_NOT_ALLOWED' });
  if (!apiKey) return respond(res, 503, { error: 'AIRIA_NOT_CONFIGURED', message: 'Set AIRIA_MENA_KEY in the local .env file.' });

  const agent = match[1].toLowerCase();
  let input;
  try {
    const parsed = await requestJson(req);
    input = Object.hasOwn(parsed, 'payload') ? parsed.payload : parsed;
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return respond(res, 400, { error: 'INVALID_PAYLOAD', message: 'payload must be a JSON object.' });
    }
  } catch (error) {
    return respond(res, error.status || 400, { error: 'INVALID_REQUEST', message: error.message });
  }

  try {
    // Airia requires userInput to be a JSON-serialized STRING, not a nested object.
    const upstream = await fetch(`${baseUrl}/v1/PipelineExecution/${pipelines[agent]}`, {
      method: 'POST',
      headers: {
        'X-API-KEY': apiKey,
        'Content-Type': 'application/json',
        'User-Agent': 'moei-nmc-adapter/1.0'
      },
      body: JSON.stringify({ userInput: JSON.stringify(input), asyncOutput: false }),
      signal: AbortSignal.timeout(timeoutMs)
    });

    const raw = await upstream.text();
    if (!upstream.ok) {
      // Do not reflect upstream error bodies or secrets to the browser.
      return respond(res, 502, { error: 'AIRIA_REQUEST_FAILED', upstreamStatus: upstream.status, agent });
    }

    let result;
    try { result = JSON.parse(raw); } catch { result = raw; }
    return respond(res, 200, { agent, result });
  } catch (error) {
    const timeout = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    // Report an allowlisted transport code only: never log headers, API key,
    // request body or the upstream error message (which may contain secrets).
    const rawCode = String(error?.cause?.code || error?.code || 'UNKNOWN');
    const reasonCode = /^[A-Z][A-Z0-9_]{0,63}$/.test(rawCode) ? rawCode : 'UNKNOWN';
    const errorName = String(error?.name || 'Error');
    console.error(`[airia-proxy] agent=${agent} errorName=${errorName} reasonCode=${reasonCode}`);
    return respond(res, timeout ? 504 : 502, {
      error: timeout ? 'AIRIA_TIMEOUT' : 'AIRIA_UNAVAILABLE',
      reasonCode,
      agent
    });
  }
});

try{
  await fleet.initialize(scheduler.bundles);
  try{await guidance.initialize();}
  catch(error){
    // Guidance requires migration 006, but an optional UI module must never
    // take down the live risk scheduler, existing cases, or saved Oracle scores.
    console.error('[nmc-guidance] GUIDANCE_SCHEMA_NOT_READY');
  }
  server.listen(port,'0.0.0.0',()=>{
    console.log(`NMC AI proxy listening on ${port}; mode=${dbMode}; fleet-auto=${scheduler.enabled}`);
    if(scheduler.enabled)scheduler.start();
    if(alertScanEnabled){
      void scanExistingFleetForAlerts();
      setInterval(()=>void scanExistingFleetForAlerts(),alertScanIntervalMs);
    }
  });
}catch(error){
  // Fail closed: no AI requests if Oracle schema / credentials are not ready.
  const code=/^[A-Z][A-Z0-9_]{1,95}$/.test(String(error?.message||''))
    ?error.message:'ORACLE_STARTUP_FAILED';
  console.error('[nmc-db] '+code);
  process.exitCode=1;
}
