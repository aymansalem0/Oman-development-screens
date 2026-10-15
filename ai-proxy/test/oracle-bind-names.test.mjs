import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// Static SQL contract regression for Oracle Free: node-oracledb bind placeholders
// must not contain Oracle pseudocolumns or reserved words such as :level.
test('Oracle assessment insert uses safe, named, corresponding bind parameters',()=>{
  const source=readFileSync(new URL('../oracle-store.mjs',import.meta.url),'utf8');
  const sql=source.split('await con.execute(`INSERT INTO NMC_AI_ASSESSMENT(')[1]?.split('`')[0];
  assert.ok(sql,'Oracle assessment INSERT SQL exists');
  const names=[...sql.matchAll(/:([A-Za-z][A-Za-z0-9_]*)/g)].map(x=>x[1]);
  assert.equal(names.length,13);
  assert.equal(new Set(names).size,13);
  for(const name of names){
    assert.match(name,/^b_[a-z][a-z0-9_]*$/,'Use b_ prefixed bind names, never Oracle keywords');
    assert.ok(source.includes(name+':'),'Missing bind object property '+name);
  }
  assert.ok(!/:(?:level|uid|start|end|version|date)\b/i.test(sql),'Reserved Oracle bind variable detected');
});
