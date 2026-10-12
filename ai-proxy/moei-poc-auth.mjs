/**
 * Single ADMIN account for local MOEI NMC + Smart Inspection POC.
 * No embedded password, no browser-managed API keys. In-memory, revocable
 * cryptographically random HttpOnly cookie sessions, expiry, CSRF protection
 * and failed-login rate limiting. This is not production IAM / UAE PASS.
 */
import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';

const sha256=x=>createHash('sha256').update(x).digest();
const cookieName='MOEI_POC_SESSION';
const MAX_AGE_SECONDS=8*60*60;
const equal=(a,b)=>timingSafeEqual(sha256(String(a)),sha256(String(b)));
export class MoeiAuthError extends Error{
 constructor(code,status=401){super(code);this.code=code;this.status=status;}
}
function cookies(header){
 return Object.fromEntries(String(header||'').split(';').map(s=>{
  const n=s.indexOf('=');return n<0?[]:[s.slice(0,n).trim(),s.slice(n+1).trim()];
 }).filter(x=>x.length===2));
}
export class MoeiPocAuth {
 constructor({username=process.env.MOEI_ADMIN_USERNAME||'admin',
   password=process.env.MOEI_ADMIN_PASSWORD||'',clock=()=>Date.now(),
   sessionValidator=()=>true}={}){
  this.username=username.trim();this.password=password;this.clock=clock;
  this.sessions=new Map();this.failures=new Map();this.sessionValidator=sessionValidator;
  this.configured=this.username.length>=3&&this.password.length>=12;
 }
 cookie(req,token,age=MAX_AGE_SECONDS){
  const https=req.headers['x-forwarded-proto']==='https'||
    req.socket?.encrypted===true;
  return cookieName+'='+token+'; Path=/; HttpOnly; SameSite=Strict; '+
    (https?'Secure; ':'')+'Max-Age='+age;
 }
 issueSession(identity){
  if(!['ADMIN','VIEWER'].includes(identity?.role))throw new MoeiAuthError('MOEI_ROLE_INVALID',403);
  const now=this.clock();
  const token=randomBytes(32).toString('base64url'),key=sha256(token).toString('hex');
  const user={username:identity.username,role:identity.role};
  if(identity.email)user.email=identity.email;
  if(identity.provider)user.provider=identity.provider;
  if(identity.sub)user.sub=identity.sub;
  this.sessions.set(key,{user,expiresAt:now+MAX_AGE_SECONDS*1000});
  return {token,user,expiresAt:new Date(now+MAX_AGE_SECONDS*1000).toISOString()};
 }
 authenticate(username,password,ip='local'){
  if(!this.configured)throw new MoeiAuthError('MOEI_ADMIN_LOGIN_NOT_CONFIGURED',503);
  const now=this.clock();
  const recent=(this.failures.get(ip)||[]).filter(at=>now-at<60_000);
  if(recent.length>=5){this.failures.set(ip,recent);throw new MoeiAuthError('MOEI_LOGIN_RATE_LIMITED',429);}
  if(!equal(username,this.username)||!equal(password,this.password)){
    recent.push(now);this.failures.set(ip,recent);
    throw new MoeiAuthError('MOEI_INVALID_CREDENTIALS',401);
  }
  this.failures.delete(ip);
  for(const [key,value] of this.sessions){
    if(value.expiresAt<=now)this.sessions.delete(key);
  }
  return this.issueSession({username:this.username,role:'ADMIN',provider:'local'});
 }
 session(req){
  const token=cookies(req.headers.cookie)[cookieName];
  if(!token)return null;
  const key=sha256(token).toString('hex'),saved=this.sessions.get(key);
  if(!saved)return null;
  if(saved.expiresAt<=this.clock()||!this.sessionValidator(saved.user)){
   this.sessions.delete(key);return null;
  }
  return {...saved.user,expiresAt:new Date(saved.expiresAt).toISOString()};
 }
 require(req,{mutate=false}={}){
  const user=this.session(req);
  if(!user)throw new MoeiAuthError('MOEI_LOGIN_REQUIRED',401);
  if(mutate&&user.role!=='ADMIN')throw new MoeiAuthError('MOEI_ADMIN_REQUIRED',403);
  if(mutate&&req.headers['x-moei-csrf']!=='1')
    throw new MoeiAuthError('MOEI_CSRF_REQUIRED',403);
  req.moeiUser=user;return user;
 }
 logout(req){
  const token=cookies(req.headers.cookie)[cookieName];
  if(token)this.sessions.delete(sha256(token).toString('hex'));
 }
}
