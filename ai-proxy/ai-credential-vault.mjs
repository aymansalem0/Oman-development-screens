/**
 * Write-only Airia credential rotation for the MOEI POC. The encryption
 * key MUST be provisioned by host/secret manager (32-byte hex or base64);
 * it is never browser-readable or stored alongside the ciphertext.
 */
import {randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';
import {existsSync,readFileSync,writeFileSync,mkdirSync,renameSync} from 'node:fs';
import {dirname} from 'node:path';

export class AiSecretError extends Error{
 constructor(code,status=422){super(code);this.code=code;this.status=status;}
}
export class AiCredentialVault{
 constructor({env=process.env,file=process.env.MOEI_AI_VAULT_PATH||
   '/data/moei-ai-credentials.enc.json'}={}){
  this.file=file;this.env=env;
  this.key=this.parseKey(env.MOEI_AI_VAULT_MASTER_KEY||'');
  this.bootstrapKey=String(env.AIRIA_MENA_KEY||'').trim();
 }
 parseKey(input){
  let b=Buffer.alloc(0);
  if(/^[a-f0-9]{64}$/i.test(input))b=Buffer.from(input,'hex');
  else if(typeof input==='string'&&/^[a-zA-Z0-9+/]{43}=$/.test(input))
    b=Buffer.from(input,'base64');
  return b.length===32?b:null;
 }
 status(){
  return {provider:'AIRIA',configured:Boolean(this.get()),rotatable:Boolean(this.key),
   source:existsSync(this.file)?'ENCRYPTED_VAULT':
    this.bootstrapKey?'SERVER_BOOTSTRAP':'NOT_CONFIGURED',
   valueExposed:false,requiresAdministrator:true,requiresAuditReason:true,
   note:this.key?'The API key is write-only and encrypted at rest.':
    'Set the server-side MOEI_AI_VAULT_MASTER_KEY once to enable secure UI key rotation.'};
 }
 get(){
  if(!existsSync(this.file))return this.bootstrapKey;
  if(!this.key)throw new AiSecretError('AI_VAULT_KEY_NOT_AVAILABLE',503);
  let doc;
  try{doc=JSON.parse(readFileSync(this.file,'utf8'));}
  catch{throw new AiSecretError('AI_VAULT_READ_FAILED',503);}
  try{
   if(doc.version!==1)throw Error('version');
   const iv=Buffer.from(doc.iv,'base64'),tag=Buffer.from(doc.tag,'base64');
   const crypt=Buffer.from(doc.ciphertext,'base64');
   const dec=createDecipheriv('aes-256-gcm',this.key,iv);
   dec.setAAD(Buffer.from('MOEI-AIRIA-KEY-V1'));dec.setAuthTag(tag);
   return Buffer.concat([dec.update(crypt),dec.final()]).toString('utf8');
  }catch{throw new AiSecretError('AI_VAULT_DECRYPT_FAILED',503);}
 }
 rotate({apiKey,actor,reason,confirm}={}){
  if(!this.key)throw new AiSecretError('AI_VAULT_MASTER_KEY_REQUIRED',503);
  if(typeof apiKey!=='string'||apiKey.trim().length<16||apiKey.length>2048||
    !actor||typeof actor!=='string'||actor.trim().length<3||
    typeof reason!=='string'||reason.trim().length<8||reason.length>500||
    confirm!==true)
    throw new AiSecretError('AI_VAULT_ROTATION_REQUEST_INVALID');
  const iv=randomBytes(12);
  const enc=createCipheriv('aes-256-gcm',this.key,iv);
  enc.setAAD(Buffer.from('MOEI-AIRIA-KEY-V1'));
  const ciphertext=Buffer.concat([enc.update(apiKey.trim(),'utf8'),enc.final()]);
  const doc={version:1,algorithm:'AES-256-GCM',
    iv:iv.toString('base64'),tag:enc.getAuthTag().toString('base64'),
    ciphertext:ciphertext.toString('base64'),updatedAt:new Date().toISOString(),
    updatedBy:actor.trim(),reason:reason.trim()};
  mkdirSync(dirname(this.file),{recursive:true});
  const temp=this.file+'.'+randomBytes(8).toString('hex')+'.tmp';
  writeFileSync(temp,JSON.stringify(doc),{mode:0o600,flag:'wx'});
  renameSync(temp,this.file);
  return this.status();
 }
}
