import { createServer } from 'node:http';
import { getPscVessel, getPscHealth } from './psc-reader.mjs';
import { FleetAssessmentManager, fleetAdminAuthorized } from './fleet-ai.mjs';

const port = Number(process.env.PORT || 3000);
const apiKey = (process.env.AIRIA_MENA_KEY || '').trim();
const baseUrl = (process.env.AIRIA_BASE_URL || 'https://mena.api.airia.ai').replace(/\/$/, '');
const timeoutMs = Math.min(180000, Math.max(1000, Number(process.env.AIRIA_TIMEOUT_MS || 120000)));
const maxBytes = 1024 * 1024; // Single agent call body.
const fleetAdminToken = (process.env.NMC_FLEET_ADMIN_TOKEN || '').trim();

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
const fleet=new FleetAssessmentManager({executeAgent:fleetAgentCall,getPscVessel});

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

const server = createServer(async (req, res) => {
  const path = new URL(req.url || '/', 'http://localhost').pathname;

  if (req.method === 'GET' && path === '/api/ai/health') {
    return respond(res, 200, { status: 'ok', aiConfigured: Boolean(apiKey), adapter: 'nmc-airia-proxy' });
  }

  if (req.method === 'GET' && path === '/api/ai/psc/health') {
    return respond(res, 200, getPscHealth());
  }
  if (req.method === 'GET' && path === '/api/ai/fleet/status') {
    return respond(res,200,fleet.snapshot());
  }
  const fleetResultMatch = /^\/api\/ai\/fleet\/results\/(\d{7})$/.exec(path);
  if (req.method === 'GET' && fleetResultMatch) {
    const record=fleet.getVesselResult(fleetResultMatch[1]);
    return respond(res,record?200:404,record||{error:'FLEET_ASSESSMENT_NOT_FOUND'});
  }
  if (path === '/api/ai/fleet/start' || path === '/api/ai/fleet/cancel') {
    if (req.method !== 'POST') return respond(res,405,{error:'METHOD_NOT_ALLOWED'});
    if (fleetAdminToken.length < 24) {
      return respond(res,503,{error:'FLEET_ADMIN_TOKEN_NOT_CONFIGURED'});
    }
    const provided=String(req.headers['x-nmc-fleet-admin-token'] || '');
    if (!fleetAdminAuthorized(provided,fleetAdminToken)) {
      return respond(res,403,{error:'FLEET_ADMIN_UNAUTHORIZED'});
    }
    try {
      if (path.endsWith('/cancel')) return respond(res,200,fleet.cancel());
      const input=await requestJson(req,12*1024*1024);
      return respond(res,202,fleet.start(input));
    } catch(err) {
      const reason=String(err?.message||'FLEET_START_FAILED');
      const safe=/^[A-Z][A-Z0-9_]{1,95}$/.test(reason)?reason:'FLEET_START_FAILED';
      return respond(res, safe==='FLEET_JOB_ALREADY_RUNNING'?409:400, {error:safe});
    }
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

server.listen(port, '0.0.0.0', () => {
  console.log(`NMC AI local proxy listening on port ${port}; Airia configured: ${Boolean(apiKey)}`);
});
