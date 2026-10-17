import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const ts=read('src/app/pages/moei-seafarer-readiness.component.ts');
const html=read('src/app/pages/moei-seafarer-readiness.component.html');
const route=read('src/app/app.routes.ts');
const page=read('src/app/pages/moei-esdb-specimen-verify.component.ts');
const pageHtml=read('src/app/pages/moei-esdb-specimen-verify.component.html');
const handler=read('ai-proxy/seafarer-http.mjs');
const ws=read('ai-proxy/seafarer-workspace.mjs');

test('Issued sandbox QR encodes an HTTP navigable application URL, not plaintext',()=>{
 assert.match(ts,/'#\/esdb\/verify\/'/);
 assert.match(ts,/encodeURIComponent\(reference\)/);
 assert.match(ts,/encodeURIComponent\(number\)/);
 assert.match(ts,/QRCode\.toDataURL\(url,/);
 assert.doesNotMatch(ts,/MOEI-eSDB-POC\\\\nSDB:/);
 assert.match(ts,/this\.issuedQrUrl = url;/);
 assert.match(html,/data-testid="sdb-qr-open-verification"/);
 assert.match(html,/qrLocalhostOnly/);
 assert.match(ts,/escape\(this\.issuedQrUrl\)/);
});

test('Public eSDB sample route has no SSO guard and is explicitly not official',()=>{
 assert.match(route,/path: 'esdb\/verify\/:reference'/);
 assert.match(route,/path\?\.startsWith\('moei\/seafarers'\)/);
 assert.match(page,/\/api\/seafarers\/v1\/public\/esdb\/verify/);
 assert.match(pageHtml,/data-testid="sdb-public-qr-match"/);
 assert.match(pageHtml,/NOT official verification|NOT official verification|NOT official|NOT OFFICIAL/i);
 assert.match(pageHtml,/specimen/);
 assert.doesNotMatch(pageHtml,/found\.(name|sid|nationalId|payment|email|phone)/);
 assert.match(handler,/path === root \+ "\/public\/esdb\/verify"/);
 assert.match(ws,/verifyEsdbSpecimen\(reference, number\)/);
 assert.match(ws,/officialVerification: false/);
});
