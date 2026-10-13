/**
 * Atomic JSON write for the LOCAL JSON fallback stores.
 *
 * On Windows, antivirus/file indexing can briefly hold a destination between
 * write and rename. Retry only those transient filesystem error codes; never
 * delete/overwrite the existing destination as a fallback. A unique sibling
 * temp path prevents colliding with concurrent tests/processes.
 *
 * Oracle-backed repositories do not use this helper.
 */
import {randomUUID} from 'node:crypto';
import {dirname} from 'node:path';
import {mkdirSync,writeFileSync,renameSync,unlinkSync} from 'node:fs';

const TRANSIENT_RENAME_ERRORS=new Set(['EPERM','EACCES','EBUSY','ENOTEMPTY']);
const maxAttempts=6;
const pauseBuffer=new Int32Array(new SharedArrayBuffer(4));
function backoff(ms){Atomics.wait(pauseBuffer,0,0,ms);}

export function atomicJsonWrite(file,data,{
  renameFile=renameSync,sleep=backoff,maxRenameAttempts=maxAttempts
}={}){
  if(!Number.isInteger(maxRenameAttempts)||maxRenameAttempts<1||maxRenameAttempts>10)
    throw new Error('ATOMIC_JSON_INVALID_ATTEMPTS');
  mkdirSync(dirname(file),{recursive:true});
  const temporary=file+'.tmp-'+process.pid+'-'+randomUUID();
  try{
    writeFileSync(temporary,JSON.stringify(data,null,2),{mode:0o600});
    for(let attempt=0;attempt<maxRenameAttempts;attempt++){
      try{
        renameFile(temporary,file);
        return;
      }catch(error){
        if(!TRANSIENT_RENAME_ERRORS.has(error?.code)||
           attempt===maxRenameAttempts-1)throw error;
        sleep(Math.min(400,25*2**attempt));
      }
    }
  }catch(error){
    // Only remove our own unique temporary file. The previously committed
    // destination must survive the error unchanged.
    try{unlinkSync(temporary);}catch{}
    throw error;
  }
}
