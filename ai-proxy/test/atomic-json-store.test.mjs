import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,renameSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {atomicJsonWrite} from '../atomic-json-store.mjs';

const setup=()=>{
  const directory=mkdtempSync(join(tmpdir(),'moei-atomic-write-'));
  return {directory,file:join(directory,'targeting.json'),
    close:()=>rmSync(directory,{recursive:true,force:true})};
};
test('Windows transient EPERM/EBUSY during rename retries with unique sibling temp, preserves complete JSON',()=>{
  const t=setup();
  try{
    writeFileSync(t.file,JSON.stringify({state:'OLD'}));
    let calls=0,waits=[];
    atomicJsonWrite(t.file,{state:'NEW',events:[{id:'PSC-01'}]},{
      renameFile:(from,to)=>{
        calls++;
        assert.ok(from.includes('.tmp-'));
        assert.equal(to,t.file);
        if(calls<3){
          const err=new Error('Windows file temporarily locked');
          err.code=calls===1?'EPERM':'EBUSY';
          throw err;
        }
        renameSync(from,to);
      },
      sleep:ms=>waits.push(ms)
    });
    assert.equal(calls,3);
    assert.deepEqual(waits,[25,50]);
    assert.deepEqual(JSON.parse(readFileSync(t.file,'utf8')),
      {state:'NEW',events:[{id:'PSC-01'}]});
    assert.deepEqual(readdirSync(t.directory),['targeting.json']);
  }finally{t.close();}
});
test('persistent EPERM fails closed without deleting existing authoritative destination',()=>{
  const t=setup();
  try{
    writeFileSync(t.file,'{"state":"SAFE"}');
    let calls=0,waits=0;
    assert.throws(()=>atomicJsonWrite(t.file,{state:'SHOULD_NOT_WRITE'},{
      renameFile:()=>{
        calls++;
        const error=new Error('locked');
        error.code='EPERM';
        throw error;
      },
      sleep:()=>waits++,
      maxRenameAttempts:3
    }),e=>e.code==='EPERM');
    assert.equal(calls,3);
    assert.equal(waits,2);
    assert.equal(readFileSync(t.file,'utf8'),'{"state":"SAFE"}');
    assert.deepEqual(readdirSync(t.directory),['targeting.json']);
  }finally{t.close();}
});
test('non-transient filesystem errors fail immediately; no fallback direct overwrite',()=>{
  const t=setup();
  try{
    writeFileSync(t.file,'{"source":"EXISTING"}');
    let calls=0;
    assert.throws(()=>atomicJsonWrite(t.file,{source:'UNSAFE'},{
      renameFile:()=>{
        calls++;
        const error=new Error('wrong filesystem');
        error.code='EXDEV';
        throw error;
      },
      sleep:()=>assert.fail('Never retry cross-filesystem errors')
    }),e=>e.code==='EXDEV');
    assert.equal(calls,1);
    assert.equal(readFileSync(t.file,'utf8'),'{"source":"EXISTING"}');
    assert.deepEqual(readdirSync(t.directory),['targeting.json']);
  }finally{t.close();}
});
test('distinct files and repeat writes never leave a dangling shared-PID temporary name',()=>{
  const t=setup();
  try{
    for(let n=0;n<25;n++)atomicJsonWrite(t.file,{revision:n});
    assert.deepEqual(JSON.parse(readFileSync(t.file,'utf8')),{revision:24});
    assert.deepEqual(readdirSync(t.directory),['targeting.json']);
  }finally{t.close();}
});
