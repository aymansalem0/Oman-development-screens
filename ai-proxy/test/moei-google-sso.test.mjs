import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {generateKeyPairSync,sign} from 'node:crypto';
import {MoeiGoogleUsers,BOOTSTRAP_EMAIL} from '../moei-google-users.mjs';
import {MoeiGoogleSso} from '../moei-google-sso.mjs';
import {MoeiPocAuth} from '../moei-poc-auth.mjs';

function fixture(){
 const dir=mkdtempSync(join(tmpdir(),'moei-google-'));
 const users=new MoeiGoogleUsers({path:join(dir,'users.json')});
 return {users,done:()=>rmSync(dir,{recursive:true,force:true})};
}
const request=cookie=>({headers:{cookie},socket:{encrypted:false}});
test('only aymansalem0@gmail.com is initially approved; stored allowlist survives restart',()=>{
 const f=fixture();
 try{
  assert.deepEqual(f.users.list().map(u=>u.email),[BOOTSTRAP_EMAIL]);
  assert.equal(f.users.list()[0].role,'ADMIN');
  assert.equal(f.users.allowed('someone@gmail.com','sub'),null);
  assert.equal(f.users.bind(BOOTSTRAP_EMAIL,'google-stable-sub').role,'ADMIN');
  const reopened=new MoeiGoogleUsers({path:f.users.path});
  assert.equal(reopened.allowed(BOOTSTRAP_EMAIL,'google-stable-sub')?.role,'ADMIN');
  assert.equal(reopened.allowed(BOOTSTRAP_EMAIL,'different-google-sub'),null);
 }finally{f.done();}
});
test('only ADMIN can approve accounts; disabling invalidates active sessions',()=>{
 const f=fixture();
 try{
  const auth=new MoeiPocAuth({sessionValidator:user=>user.provider!=='google'||
    Boolean(f.users.allowed(user.email,user.sub))&&
    f.users.allowed(user.email,user.sub).role===user.role});
  const u=f.users.bind(BOOTSTRAP_EMAIL,'stable-001');
  const session=auth.issueSession(u);
  assert.equal(auth.require(request('MOEI_POC_SESSION='+session.token)).role,'ADMIN');
  f.users.add({email:'viewer@gmail.com'},BOOTSTRAP_EMAIL);
  assert.equal(f.users.allowed('viewer@gmail.com','sub-2').role,'VIEWER');
  const viewer=auth.issueSession(f.users.bind('viewer@gmail.com','sub-2'));
  assert.throws(()=>auth.require(request('MOEI_POC_SESSION='+viewer.token),{mutate:true}),
    /MOEI_ADMIN_REQUIRED/);
  f.users.update('viewer@gmail.com',{active:false},BOOTSTRAP_EMAIL);
  assert.equal(auth.session(request('MOEI_POC_SESSION='+viewer.token)),null);
  assert.throws(()=>f.users.update(BOOTSTRAP_EMAIL,{active:false},BOOTSTRAP_EMAIL),
    /MOEI_LAST_ADMIN_REQUIRED/);
  assert.equal(f.users.list().filter(x=>x.active&&x.role==='ADMIN').length,1);
 }finally{f.done();}
});
test('Google OIDC requires state cookie, PKCE and signed issuer/audience/nonce/verified email',async()=>{
 const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
 const jwk=publicKey.export({format:'jwk'});Object.assign(jwk,{kid:'testing-kid',alg:'RS256',use:'sig'});
 let claims={}, tokenCalls=0;
 const transport=async(url,opts)=>{
  if(url.includes('/certs'))return {ok:true,json:async()=>({keys:[jwk]})};
  assert.equal(url,'https://oauth2.googleapis.com/token');
  tokenCalls++;
  const params=opts.body;
  assert.equal(params.get('code_verifier')?.length>40,true);
  const head=Buffer.from(JSON.stringify({alg:'RS256',kid:'testing-kid'})).toString('base64url');
  const payload=Buffer.from(JSON.stringify(claims)).toString('base64url');
  const sig=sign('RSA-SHA256',Buffer.from(head+'.'+payload),privateKey).toString('base64url');
  return {ok:true,json:async()=>({id_token:head+'.'+payload+'.'+sig})};
 };
 const oidc=new MoeiGoogleSso({clientId:'client.apps.googleusercontent.com',
  clientSecret:'test-secret',transport});
 const started=oidc.start(request(''));
 const url=new URL(started.url);
 assert.equal(url.searchParams.get('code_challenge_method'),'S256');
 assert.equal(url.searchParams.get('scope'),'openid email profile');
 assert.match(started.cookie,/SameSite=Lax/);
 claims={iss:'https://accounts.google.com',
  aud:'client.apps.googleusercontent.com',exp:Math.floor(Date.now()/1000)+300,
  iat:Math.floor(Date.now()/1000),nonce:url.searchParams.get('nonce'),
  sub:'stable-sub-001',email:'aymansalem0@gmail.com',email_verified:true};
 await assert.rejects(
  oidc.callback(request(''),{state:url.searchParams.get('state'),code:'sample'}),
  /MOEI_GOOGLE_STATE_INVALID/);
 assert.equal(tokenCalls,0);
 const valid=oidc.start(request(''));
 const state=new URL(valid.url).searchParams.get('state');
 claims.nonce=new URL(valid.url).searchParams.get('nonce');
 const identity=await oidc.callback(request(valid.cookie.split(';')[0]),
  {state,code:'one-time-code'});
 assert.equal(identity.email,BOOTSTRAP_EMAIL);
 assert.equal(identity.sub,'stable-sub-001');
 assert.equal(tokenCalls,1);
 await assert.rejects(oidc.callback(request(valid.cookie.split(';')[0]),
  {state,code:'replay'}),/MOEI_GOOGLE_STATE_INVALID/);
 const tampered=oidc.start(request(''));
 const state2=new URL(tampered.url).searchParams.get('state');
 claims={...claims,nonce:new URL(tampered.url).searchParams.get('nonce'),
  aud:'wrong-audience'};
 await assert.rejects(oidc.callback(request(tampered.cookie.split(';')[0]),
   {state:state2,code:'second-code'}),/MOEI_GOOGLE_ID_TOKEN_INVALID/);
});
