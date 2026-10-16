/**
 * Persisted Google-account allowlist for the local MOEI POC.
 * Only the explicitly approved bootstrap account is provisioned initially.
 * All subsequent changes require an authenticated ADMIN via server endpoints.
 */
import {existsSync,mkdirSync,readFileSync,renameSync,writeFileSync} from 'node:fs';
import {dirname} from 'node:path';
import {randomBytes} from 'node:crypto';

export class MoeiUsersError extends Error{
  constructor(code,status=400){super(code);this.code=code;this.status=status;}
}
export const BOOTSTRAP_EMAIL='aymansalem0@gmail.com';
export function normalizeGoogleEmail(value){
  const email=String(value||'').trim().toLowerCase();
  if(email.length>254||!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(email))
    throw new MoeiUsersError('MOEI_INVALID_EMAIL',400);
  return email;
}
const safeInspectorId=value=>{
 if(value===null||value==='')return null;
 if(typeof value!=='string'||!/^[A-Za-z0-9_-]{2,120}$/.test(value))
  throw new MoeiUsersError('MOEI_INSPECTOR_ID_INVALID',422);
 return value;
};
const safeRole=value=>{
  if(!['ADMIN','VIEWER'].includes(value))throw new MoeiUsersError('MOEI_INVALID_ROLE',400);
  return value;
};
export class MoeiGoogleUsers{
  constructor({path=process.env.MOEI_GOOGLE_USERS_PATH||'/data/moei-google-users.json'}={}){
    this.path=path;
    if(existsSync(path)){
      const json=JSON.parse(readFileSync(path,'utf8'));
      if(!Array.isArray(json.users))throw new MoeiUsersError('MOEI_USERS_STORE_INVALID',500);
      this.users=json.users;
      this.audit=Array.isArray(json.audit)?json.audit:[];
    }else{
      this.users=[{email:BOOTSTRAP_EMAIL,role:'ADMIN',active:true,googleSub:null,addedAt:new Date().toISOString(),addedBy:'system-bootstrap'}];
      this.audit=[];
      this.persist();
    }
  }
  persist(){
    mkdirSync(dirname(this.path),{recursive:true});
    const temp=this.path+'.'+randomBytes(6).toString('hex')+'.tmp';
    writeFileSync(temp,JSON.stringify({version:1,users:this.users,audit:this.audit.slice(-500)},null,2),{mode:0o600});
    renameSync(temp,this.path);
  }
  list(){return this.users.map(({googleSub,...user})=>({...user,
    inspectorId:user.inspectorId||null,
    linkedGoogleAccount:Boolean(googleSub)}))
    .sort((a,b)=>a.email.localeCompare(b.email));}
  find(email){return this.users.find(x=>x.email===normalizeGoogleEmail(email));}
  allowed(email,sub){
    const user=this.find(email);
    return user?.active && (!user.googleSub||user.googleSub===sub)?user:null;
  }
  bind(email,sub){
    if(typeof sub!=='string'||!sub)throw new MoeiUsersError('MOEI_GOOGLE_SUB_REQUIRED',401);
    const user=this.allowed(email,sub);
    if(!user)throw new MoeiUsersError('MOEI_GOOGLE_ACCOUNT_NOT_ALLOWED',403);
    if(!user.googleSub){user.googleSub=sub;this.persist();}
    return {username:user.email,email:user.email,role:user.role,provider:'google',sub};
  }
  record(action,email,actor){
    this.audit.push({action,email,actor,at:new Date().toISOString()});
    this.audit=this.audit.slice(-500);
  }
  add({email,role='VIEWER'},actor){
    const key=normalizeGoogleEmail(email);
    const selectedRole=safeRole(role);
    if(this.users.some(x=>x.email===key))throw new MoeiUsersError('MOEI_USER_ALREADY_EXISTS',409);
    const user={email:key,role:selectedRole,active:true,googleSub:null,
      inspectorId:null,addedAt:new Date().toISOString(),addedBy:actor};
    this.users.push(user);this.record('ADD',key,actor);this.persist();
    return this.list().find(x=>x.email===key);
  }
  update(email,{active,role,inspectorId},actor){
    const user=this.find(email);
    if(!user)throw new MoeiUsersError('MOEI_USER_NOT_FOUND',404);
    if(typeof active!=='boolean'&&role===undefined&&inspectorId===undefined)
      throw new MoeiUsersError('MOEI_NO_CHANGES',400);
    const nextInspectorId=inspectorId===undefined?(user.inspectorId||null):
      safeInspectorId(inspectorId);
    if(nextInspectorId&&this.users.some(x=>
      x.email!==user.email&&x.active&&x.inspectorId===nextInspectorId))
      throw new MoeiUsersError('MOEI_INSPECTOR_ALREADY_LINKED',409);
    const nextRole=role===undefined?user.role:safeRole(role);
    const nextActive=active===undefined?user.active:active;
    if(typeof nextActive!=='boolean')throw new MoeiUsersError('MOEI_INVALID_ACTIVE',400);
    if(user.active&&user.role==='ADMIN'&&(!nextActive||nextRole!=='ADMIN')&&
       this.users.filter(x=>x.active&&x.role==='ADMIN').length<=1)
      throw new MoeiUsersError('MOEI_LAST_ADMIN_REQUIRED',409);
    user.role=nextRole;user.active=nextActive;
    user.inspectorId=nextInspectorId;
    this.record('UPDATE',user.email,actor);this.persist();
    return this.list().find(x=>x.email===user.email);
  }
}