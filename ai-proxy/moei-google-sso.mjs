/**
 * Google OpenID Connect authorization-code + PKCE login (server-to-server).
 * Never trust browser-submitted email; verify Google's signed ID token instead.
 */
import {randomBytes,createHash,createPublicKey,verify} from 'node:crypto';
import {MoeiAuthError} from './moei-poc-auth.mjs';

const googleAuthorize='https://accounts.google.com/o/oauth2/v2/auth';
const googleToken='https://oauth2.googleapis.com/token';
const googleCerts='https://www.googleapis.com/oauth2/v3/certs';
const b64=x=>Buffer.from(x).toString('base64url');
const hash=x=>createHash('sha256').update(x).digest();
const limitedFetch=(url,options={})=>fetch(url,{...options,signal:AbortSignal.timeout(12000)});
const decode=x=>JSON.parse(Buffer.from(x,'base64url').toString('utf8'));
const stateCookie='MOEI_GOOGLE_OAUTH_STATE';
export class MoeiGoogleSso{
  constructor({clientId=process.env.MOEI_GOOGLE_CLIENT_ID||'',
    clientSecret=process.env.MOEI_GOOGLE_CLIENT_SECRET||'',
    redirectUri=process.env.MOEI_GOOGLE_REDIRECT_URI||'http://localhost:4200/api/moei/auth/google/callback',
    clock=()=>Date.now(),transport=limitedFetch}={}){
    this.clientId=clientId.trim();this.clientSecret=clientSecret.trim();
    this.redirectUri=redirectUri.trim();this.clock=clock;this.transport=transport;
    this.pending=new Map();
  }
  get configured(){return Boolean(this.clientId&&this.clientSecret&&this.redirectUri);}
  secureCookie(req){
    return req.headers['x-forwarded-proto']==='https'||req.socket?.encrypted===true?'; Secure':'';
  }
  cookie(req,state,age=600){
    return stateCookie+'='+state+'; HttpOnly; SameSite=Lax; Path=/api/moei/auth/google/callback; Max-Age='+age+this.secureCookie(req);
  }
  getCookie(req){
    const parts=String(req.headers.cookie||'').split(';');
    const pair=parts.find(x=>x.trim().startsWith(stateCookie+'='));
    return pair?pair.trim().slice(stateCookie.length+1):'';
  }
  start(req){
    if(!this.configured)throw new MoeiAuthError('MOEI_GOOGLE_SSO_NOT_CONFIGURED',503);
    const now=this.clock();
    for(const [key,entry] of this.pending)if(now-entry.createdAt>600000)this.pending.delete(key);
    const state=b64(randomBytes(32)),nonce=b64(randomBytes(32)),verifier=b64(randomBytes(48));
    this.pending.set(state,{nonce,verifier,createdAt:now});
    const url=new URL(googleAuthorize);
    for(const [k,v] of Object.entries({
      client_id:this.clientId,redirect_uri:this.redirectUri,response_type:'code',
      scope:'openid email profile',state,nonce,
      code_challenge:b64(hash(verifier)),code_challenge_method:'S256',
      prompt:'select_account'}))url.searchParams.set(k,v);
    return {url:url.toString(),cookie:this.cookie(req,state)};
  }
  async callback(req,{state,code}){
    const stored=this.pending.get(state);
    if(state)this.pending.delete(state);
    if(!stored||!state||this.getCookie(req)!==state||this.clock()-stored.createdAt>600000)
      throw new MoeiAuthError('MOEI_GOOGLE_STATE_INVALID',401);
    if(!code||typeof code!=='string')throw new MoeiAuthError('MOEI_GOOGLE_CODE_MISSING',401);
    let tokenResponse;
    try{
      const data=new URLSearchParams({
        code,client_id:this.clientId,client_secret:this.clientSecret,
        redirect_uri:this.redirectUri,grant_type:'authorization_code',code_verifier:stored.verifier
      });
      const result=await this.transport(googleToken,{method:'POST',
        headers:{'Content-Type':'application/x-www-form-urlencoded'},body:data});
      if(!result.ok)throw Error('Google token exchange rejected');
      tokenResponse=await result.json();
    }catch{throw new MoeiAuthError('MOEI_GOOGLE_TOKEN_EXCHANGE_FAILED',401);}
    return this.verifyIdToken(tokenResponse?.id_token,stored.nonce);
  }
  async verifyIdToken(token,nonce){
    try{
      if(typeof token!=='string')throw Error('missing token');
      const parts=token.split('.');
      if(parts.length!==3)throw Error('invalid JWT');
      const header=decode(parts[0]),body=decode(parts[1]);
      if(header.alg!=='RS256'||!header.kid)throw Error('unsupported JWT algorithm');
      const response=await this.transport(googleCerts);
      if(!response.ok)throw Error('JWKS unavailable');
      const jwks=await response.json();
      const key=jwks.keys?.find(k=>k.kid===header.kid&&k.kty==='RSA'&&
        (!k.use||k.use==='sig')&&(!k.alg||k.alg==='RS256'));
      if(!key||!verify('RSA-SHA256',Buffer.from(parts[0]+'.'+parts[1]),
        createPublicKey({key,format:'jwk'}),Buffer.from(parts[2],'base64url')))
        throw Error('bad JWT signature');
      const now=Math.floor(this.clock()/1000);
      if(!['accounts.google.com','https://accounts.google.com'].includes(body.iss)||
         body.aud!==this.clientId||!Number.isInteger(body.exp)||body.exp<=now||
         !Number.isInteger(body.iat)||body.iat>now+60||
         body.nonce!==nonce||!body.sub||body.email_verified!==true||
         typeof body.email!=='string')throw Error('invalid OIDC claims');
      return {email:body.email.trim().toLowerCase(),sub:body.sub};
    }catch{throw new MoeiAuthError('MOEI_GOOGLE_ID_TOKEN_INVALID',401);}
  }
}