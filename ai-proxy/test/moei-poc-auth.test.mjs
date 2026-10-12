import test from 'node:test';
import assert from 'node:assert/strict';
import {MoeiPocAuth} from '../moei-poc-auth.mjs';

const user='admin',pass='test-only-password-long-enough-2026';
const req=(token,headers={})=>({
 headers:{cookie:'MOEI_POC_SESSION='+token,...headers},
 socket:{encrypted:false,remoteAddress:'127.0.0.1'}
});
test('ADMIN login fails closed when no password is configured',()=>{
 const auth=new MoeiPocAuth({username:user,password:''});
 assert.throws(()=>auth.authenticate(user,'whatever'),/MOEI_ADMIN_LOGIN_NOT_CONFIGURED/);
});
test('authenticated cookie session permits Admin across Editor/Publisher scopes',()=>{
 let now=1_000_000;
 const auth=new MoeiPocAuth({username:user,password:pass,clock:()=>now});
 const session=auth.authenticate(user,pass);
 const request=req(session.token);
 assert.equal(auth.require(request).role,'ADMIN');
 assert.equal(request.moeiUser.username,user);
 assert.match(auth.cookie(request,session.token),/HttpOnly; SameSite=Strict;/);
 assert.doesNotMatch(auth.cookie(request,session.token),/Secure/);
 assert.match(auth.cookie({...request,headers:{'x-forwarded-proto':'https'}},session.token),/Secure;/);
 assert.equal(auth.sessions.size,1);
 now+=8*60*60*1000+1;
 assert.throws(()=>auth.require(request),/MOEI_LOGIN_REQUIRED/);
});
test('all mutations must present CSRF header; GET is read-only',()=>{
 const auth=new MoeiPocAuth({password:pass});
 const s=auth.authenticate(user,pass);
 assert.equal(auth.require(req(s.token)).role,'ADMIN');
 assert.throws(()=>auth.require(req(s.token),{mutate:true}),/MOEI_CSRF_REQUIRED/);
 assert.equal(auth.require(req(s.token,{'x-moei-csrf':'1'}),{mutate:true}).role,'ADMIN');
 assert.throws(()=>auth.require(req('bad-token',{'x-moei-csrf':'1'}),{mutate:true}),
   /MOEI_LOGIN_REQUIRED/);
});
test('logout revokes server-side session immediately',()=>{
 const auth=new MoeiPocAuth({password:pass});
 const s=auth.authenticate(user,pass);
 auth.logout(req(s.token));
 assert.throws(()=>auth.require(req(s.token)),/MOEI_LOGIN_REQUIRED/);
});
test('unknown user/wrong password produce identical rejection; login rate limited',()=>{
 let now=123_000;
 const auth=new MoeiPocAuth({password:pass,clock:()=>now});
 for(let i=0;i<5;i++){
  assert.throws(()=>auth.authenticate(i%2?'unknown':user,'wrong','test-ip'),
    /MOEI_INVALID_CREDENTIALS/);
 }
 assert.throws(()=>auth.authenticate(user,pass,'test-ip'),/MOEI_LOGIN_RATE_LIMITED/);
 now+=61_000;
 assert.equal(auth.authenticate(user,pass,'test-ip').user.role,'ADMIN');
});
test('cookie never contains password or role, password is never issued to client',()=>{
 const auth=new MoeiPocAuth({password:pass});
 const s=auth.authenticate(user,pass);
 assert.ok(!auth.cookie(req(s.token),s.token).includes(pass));
 assert.equal(s.user.role,'ADMIN');
 assert.equal(s.user.password,undefined);
 assert.equal(s.user.username,'admin');
});
