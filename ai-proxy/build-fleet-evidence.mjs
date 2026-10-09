/**
 * Build-time adapter. Executes the SAME TypeScript deterministic fixture/evidence
 * functions Angular uses, in a sandboxed CommonJS transpiler (no browser or API).
 * Produces a versioned, immutable fleet-bundles.json loaded by the Node scheduler.
 * Synthetic fixture content; no secrets, official sources or live AIS.
 */
import ts from 'typescript';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import vm from 'node:vm';

const root=process.cwd();
const cached=new Map();
class BehaviorSubject {
  constructor(v){this.value=v;}
  next(v){this.value=v;}
  asObservable(){return {subscribe:()=>({unsubscribe(){}})};}
}
function load(modulePath){
  const filename=resolve(modulePath.endsWith('.ts')?modulePath:modulePath+'.ts');
  if(cached.has(filename))return cached.get(filename).exports;
  const content=readFileSync(filename,'utf8');
  const js=ts.transpileModule(content,{
    fileName:filename,compilerOptions:{
      module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,
      experimentalDecorators:true,esModuleInterop:true
    }
  }).outputText;
  const mod={exports:{}};cached.set(filename,mod);
  const fakeRequire=(request)=>{
    if(request==='@angular/core')return {Injectable:()=>cls=>cls};
    if(request==='rxjs')return {BehaviorSubject};
    // The browser Risk Engine now imports Angular HTTP and RxJS operators
    // to load central policy. Evidence generation must NEVER contact Oracle
    // or localhost, nor load an HTTP client. The pure fixture evaluation path
    // only requires its deterministic default calculation.
    if(request==='@angular/common/http')return {HttpHeaders:class HttpHeaders{}};
    if(request==='rxjs/operators')return {
      map:()=>source=>source,
      tap:()=>source=>source
    };
    if(request.startsWith('.'))return load(resolve(dirname(filename),request));
    throw new Error('Disallowed import for synthetic evidence build: '+request);
  };
  const compiled=new vm.Script('(function(require,module,exports){'+js+'\n})',{filename,timeout:5000});
  compiled.runInNewContext({console,Date,JSON,Map,Set,Math,Number,String,Array,Object,
    Intl,RegExp,Error,localStorage:undefined,
    // Never run a browser policy poll in a build-time fixture generator.
    setInterval:()=>0,clearInterval:()=>{}},{timeout:5000})(fakeRequire,mod,mod.exports);
  return mod.exports;
}
const expanded=load(root+'/src/app/data/nmc-expanded-vessel-catalog.ts');
const risk=load(root+'/src/app/services/nmc-risk-engine.service.ts');
const evidence=load(root+'/src/app/services/nmc-vessel-evidence.service.ts');
// Simulated offline HttpClient: no networking, timers or database reads.
const offlineHttpClient={get:()=>({subscribe:()=>({unsubscribe(){}})})};
const riskEngine=new risk.NmcRiskEngineService(offlineHttpClient);
const evidenceService=new evidence.NmcVesselEvidenceService(riskEngine);
const vessels=expanded.NMC_OPERATIONAL_VESSELS;
if(!Array.isArray(vessels)||vessels.length!==420||new Set(vessels.map(v=>v.imo)).size!==420)
  throw new Error('EXPECTED_420_UNIQUE_VESSELS');
const bundles=vessels.map(v=>{
  const b=evidenceService.create(v);
  if(b.vessel.imo!==v.imo||b.evidenceIds.length!==new Set(b.evidenceIds).size)
    throw new Error('INVALID_SYNTHETIC_BUNDLE');
  return {imo:v.imo,evidenceIds:b.evidenceIds,inlineContext:b.inlineContext};
});
const content=JSON.stringify(bundles);
writeFileSync(root+'/ai-proxy/fleet-bundles.json',content);
const digest=createHash('sha256').update(content).digest('hex').slice(0,12);
console.log('NMC autonomous fleet evidence: '+bundles.length+' bundles; SHA-256 '+digest+'; bytes '+Buffer.byteLength(content));
