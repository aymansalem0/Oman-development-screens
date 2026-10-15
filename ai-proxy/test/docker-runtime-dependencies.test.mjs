import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('production ai-proxy Dockerfile packages all direct relative imports from server.mjs',()=>{
  const dockerfile=readFileSync(new URL('../Dockerfile',import.meta.url),'utf8');
  const server=readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
  const files=[...server.matchAll(/from\s+['"]\.\/([^'"]+)['"]/g)].map(match=>match[1]);
  assert.ok(files.includes('operational-guidance.mjs'));
  for(const file of files){
    assert.match(dockerfile,new RegExp('ai-proxy/'+file.replaceAll('.','\\.')),
      'Missing in production image: '+file);
  }
});
