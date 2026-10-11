import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const server=readFileSync(fileURLToPath(new URL('../server.mjs',import.meta.url)),'utf8');
function count(s){return server.split(s).length-1;}

test('NMC incident GET endpoints are reachable before the generic Airia NOT_FOUND fallback',()=>{
  assert.equal(count('const server = createServer'),1,'a single backend route handler');
  assert.equal(count('server.listen(port'),1,'a single startup listener');
  assert.equal(count("path==='/api/ai/nmc/incidents/health'"),1);
  assert.equal(count("path==='/api/ai/nmc/incidents'"),1);
  assert.equal(count('const triageMatch='),1);
  assert.equal(count('const incidentReviewMatch='),1);
  assert.equal(count("if (!match) return respond(res, 404, { error: 'NOT_FOUND' });"),1);
  const healthIndex=server.indexOf("path==='/api/ai/nmc/incidents/health'");
  const feedIndex=server.indexOf("path==='/api/ai/nmc/incidents'");
  const fallbackIndex=server.indexOf("if (!match) return respond(res, 404, { error: 'NOT_FOUND' });");
  assert.ok(healthIndex>0&&feedIndex>0&&healthIndex<fallbackIndex&&feedIndex<fallbackIndex,
    'incident requests must not fall through to generic A01–A04 NOT_FOUND');
});
test('NMC incident requests do not rely on a distinct incident Google credentials file',()=>{
  const compose=readFileSync(fileURLToPath(new URL('../../compose.incident-google.yaml',import.meta.url)),'utf8');
  assert.match(compose,/NMC_INCIDENT_CREDENTIALS_PATH: \/run\/secrets\/nmc-psc-google\.json/);
  assert.doesNotMatch(compose,/^\s*-\s+\.\/secrets\/nmc-incident-google\.json:/m);
});
