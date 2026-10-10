/**
 * NMC A03 Document Intelligence POC.
 * Dedicated read-only Google Drive service account, restricted to ONE configured
 * folder and immediate vessel-IMO subfolders. Never traverses the entire Drive.
 * A03 requires explicit editor action + cost confirmation; outputs are draft
 * until an operator reviews them. No automatic registry/risk updates.
 */
import {createSign,createHash,randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,existsSync,mkdirSync,renameSync} from 'node:fs';
import {dirname} from 'node:path';
import oracledb from 'oracledb';

const now=()=>new Date().toISOString();
const sha=x=>createHash('sha256').update(x).digest('hex');
const clone=x=>JSON.parse(JSON.stringify(x));
const imoOk=x=>typeof x==='string'&&/^\d{7}$/.test(x);
const idOk=x=>typeof x==='string'&&/^[a-zA-Z0-9_-]{8,130}$/.test(x);
const folderOk=x=>typeof x==='string'&&/^[a-zA-Z0-9_-]{10,160}$/.test(x);
const safe=x=>typeof x==='string'?x.trim().slice(0,250):'';
const clob=x=>({val:JSON.stringify(x),type:oracledb.DB_TYPE_CLOB});
const allowedTypes=new Set(['application/pdf','text/plain','application/vnd.google-apps.document']);
const MAX_DOCUMENT_BYTES=8*1024*1024,MAX_AI_TEXT=14000;
const key=(imo,id)=>imo+':'+id;

export class DocumentError extends Error{
  constructor(code,status=400){super(code);this.code=code;this.status=status;}
}

function unwrap(raw){
  let v=raw;
  for(let i=0;i<7;i++){
    if(typeof v==='string'){try{v=JSON.parse(v);}catch{break;}continue;}
    if(!v||typeof v!=='object'||Array.isArray(v))break;
    if(v.extracted&&typeof v.extracted==='object')return v;
    const next=['result','response','output','data','finalOutput','outputText','content','value']
      .find(k=>v[k]!==undefined);
    if(!next)break;
    v=v[next];
  }
  return v;
}
const date=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&
  !Number.isNaN(Date.parse(x+'T00:00:00Z'))?x:null;

/** Do not trust LLM output as evidence. Every quote must occur in downloaded text. */
export function validateA03(raw,sourceText,expectedImo){
  const data=unwrap(raw);
  if(!data||typeof data!=='object'||Array.isArray(data)||
     !data.extracted||typeof data.extracted!=='object'||Array.isArray(data.extracted))
    throw new DocumentError('A03_RESPONSE_CONTRACT_UNVERIFIED',502);
  const d=data.extracted;
  if(!Array.isArray(data.evidenceQuotes)||data.evidenceQuotes.length<1||
     data.evidenceQuotes.length>12)throw new DocumentError('A03_EVIDENCE_MISSING',502);
  const quotes=data.evidenceQuotes.map(q=>{
    const text=typeof q==='string'?q:typeof q?.text==='string'?q.text:'';
    const value=text.trim();
    if(value.length<5||value.length>300||!sourceText.includes(value))
      throw new DocumentError('A03_EVIDENCE_NOT_IN_DOCUMENT',502);
    return value;
  });
  const confidence=Number(data.confidence);
  if(!Number.isFinite(confidence)||confidence<0||confidence>1)
    throw new DocumentError('A03_CONFIDENCE_INVALID',502);
  const extracted={
    imo:safe(d.imo).slice(0,7)||null,
    vesselName:safe(d.vesselName)||null,
    documentType:safe(d.documentType)||null,
    certificateNumber:safe(d.certificateNumber)||null,
    issuingAuthority:safe(d.issuingAuthority)||null,
    issueDate:date(d.issueDate),
    expiryDate:date(d.expiryDate)
  };
  if(!extracted.documentType||!(extracted.imo||extracted.certificateNumber||extracted.vesselName))
    throw new DocumentError('A03_REQUIRED_FIELDS_MISSING',502);
  if(extracted.imo&&!imoOk(extracted.imo))
    throw new DocumentError('A03_IMO_INVALID',502);
  const conflicts=[];
  if(extracted.imo&&extracted.imo!==expectedImo)
    conflicts.push({field:'imo',documentValue:extracted.imo,expectedValue:expectedImo,
      reason:'VESSEL_IMO_MISMATCH'});
  if(extracted.expiryDate&&extracted.expiryDate<now().slice(0,10))
    conflicts.push({field:'expiryDate',documentValue:extracted.expiryDate,
      expectedValue:null,reason:'CERTIFICATE_DATE_IN_PAST'});
  return {extracted,confidence,evidenceQuotes:quotes,conflicts,
    analysisNature:'AIRIA_A03_ADVISORY_UNVERIFIED',
    authenticityVerified:false,manualReviewRequired:true};
}

/** Stable evidence ID for approved, reviewable document extracts (not official proof). */
const documentEvidenceId=id=>'GDOC-'+sha(id).slice(0,20);

export class DriveDocumentIntelligence {
  constructor({mode='json',oracleRepository=null,executeA03=null,
    enabled=process.env.NMC_A03_ENABLED==='true',
    rootFolderId=process.env.NMC_DRIVE_ROOT_FOLDER_ID||'',
    credentialsPath=process.env.NMC_DRIVE_CREDENTIALS_PATH||'/run/secrets/nmc-drive-google.json',
    file=process.env.NMC_DOCUMENT_STORE_PATH||'/data/nmc-document-intelligence.json',
    driveRequest=null}={}){
    this.mode=mode;this.oracle=oracleRepository;this.executeA03=executeA03;
    this.enabled=enabled;this.rootFolderId=rootFolderId.trim();
    this.credentialsPath=credentialsPath;this.file=file;
    this.driveRequest=driveRequest; // injectable for offline fixture tests
    this.ready=mode==='json';this.pending=new Set();this.token=null;
  }
  async initialize(){
    if(this.mode==='json'){this.ready=true;return;}
    await this.db(async con=>{
      await con.execute('SELECT DOC_KEY FROM NMC_VESSEL_DOCUMENT WHERE ROWNUM=1');
      await con.execute('SELECT DOCUMENT_ID FROM NMC_VESSEL_DOCUMENT_AUDIT WHERE ROWNUM=1');
    });this.ready=true;
  }
  ensureReady(){if(!this.ready)throw new DocumentError('DOCUMENT_SCHEMA_NOT_READY',503);}
  async db(task){
    if(!this.oracle?.pool)throw new DocumentError('DOCUMENT_DB_UNAVAILABLE',503);
    const con=await this.oracle.pool.getConnection();
    try{return await task(con);}finally{await con.close();}
  }
  jsonRead(){
    if(!existsSync(this.file))return {schema:1,records:{},audit:{}};
    try{
      const doc=JSON.parse(readFileSync(this.file,'utf8'));
      if(doc.schema===1&&doc.records&&doc.audit)return doc;
    }catch{}
    throw new DocumentError('DOCUMENT_STORE_UNAVAILABLE',503);
  }
  jsonWrite(data){
    try{
      mkdirSync(dirname(this.file),{recursive:true});
      const tmp=this.file+'.tmp-'+process.pid;
      writeFileSync(tmp,JSON.stringify(data),{mode:0o600});
      renameSync(tmp,this.file);
    }catch{throw new DocumentError('DOCUMENT_STORE_UNAVAILABLE',503);}
  }
  async read(imo,fileId){
    this.ensureReady();
    if(!imoOk(imo)||!idOk(fileId))throw new DocumentError('DOCUMENT_ID_INVALID',422);
    const docKey=key(imo,fileId);
    if(this.mode==='json')return clone(this.jsonRead().records[docKey]||null);
    return this.db(async con=>{
      const r=await con.execute('SELECT DOC_JSON FROM NMC_VESSEL_DOCUMENT WHERE DOC_KEY=:docKey',
        {docKey},{outFormat:oracledb.OUT_FORMAT_OBJECT});
      return r.rows.length?JSON.parse(r.rows[0].DOC_JSON):null;
    });
  }
  async savedFor(imo){
    this.ensureReady();
    if(!imoOk(imo))throw new DocumentError('VESSEL_IMO_INVALID',422);
    if(this.mode==='json')return Object.values(this.jsonRead().records)
      .filter(x=>x.imo===imo).map(clone);
    return this.db(async con=>{
      const r=await con.execute('SELECT DOC_JSON FROM NMC_VESSEL_DOCUMENT WHERE IMO=:imo',
        {imo},{outFormat:oracledb.OUT_FORMAT_OBJECT});
      return r.rows.map(x=>JSON.parse(x.DOC_JSON));
    });
  }
  async approvedFor(imo){
    const docs=await this.savedFor(imo);
    return docs.filter(d=>d.status==='APPROVED'&&
      d.extracted?.imo===imo&&d.sourceModifiedTime===d.analyzedModifiedTime)
      .map(d=>({
        evidenceId:documentEvidenceId(d.fileId),documentId:d.id,
        sourceFileId:d.fileId,sourceModifiedTime:d.sourceModifiedTime,
        type:d.extracted.documentType,certificateNumber:d.extracted.certificateNumber,
        vesselImo:d.extracted.imo,issuer:d.extracted.issuingAuthority,
        expiryDate:d.extracted.expiryDate,issueDate:d.extracted.issueDate,
        confidence:d.confidence,evidenceQuotes:d.evidenceQuotes,
        reviewedBy:d.reviewedBy,reviewedAt:d.reviewedAt,
        source:'GOOGLE_DRIVE_A03_HUMAN_REVIEWED_NOT_AUTHENTICATED'
      })).slice(0,30);
  }
  async record(current,next,action,actor){
    this.ensureReady();
    if(this.mode==='json'){
      const db=this.jsonRead(),existing=db.records[next.docKey]||null;
      if((existing?.version||0)!==(current?.version||0))
        throw new DocumentError('DOCUMENT_VERSION_CONFLICT',409);
      db.records[next.docKey]=next;
      db.audit[next.docKey]=[{version:next.version,action,actor,at:next.updatedAt},
        ...(db.audit[next.docKey]||[])];
      this.jsonWrite(db);return next;
    }
    return this.db(async con=>{
      try{
        const got=await con.execute('SELECT VERSION_NO FROM NMC_VESSEL_DOCUMENT WHERE DOC_KEY=:docKey FOR UPDATE',
          {docKey:next.docKey},{outFormat:oracledb.OUT_FORMAT_OBJECT});
        if((got.rows[0]?.VERSION_NO||0)!==(current?.version||0))
          throw new DocumentError('DOCUMENT_VERSION_CONFLICT',409);
        if(got.rows.length){
          await con.execute('UPDATE NMC_VESSEL_DOCUMENT SET VERSION_NO=:v,DOC_JSON=:doc,UPDATED_AT=SYSTIMESTAMP WHERE DOC_KEY=:docKey',
            {v:next.version,doc:clob(next),docKey:next.docKey});
        }else{
          await con.execute('INSERT INTO NMC_VESSEL_DOCUMENT (DOC_KEY,DOCUMENT_ID,IMO,FILE_ID,VERSION_NO,DOC_JSON) VALUES (:docKey,:id,:imo,:fileId,:v,:doc)',
            {docKey:next.docKey,id:next.id,imo:next.imo,fileId:next.fileId,v:next.version,doc:clob(next)});
        }
        await con.execute('INSERT INTO NMC_VESSEL_DOCUMENT_AUDIT (AUDIT_ID,DOCUMENT_ID,DOC_KEY,VERSION_NO,ACTION_NAME,ACTOR,STATE_JSON) VALUES (:audit,:id,:docKey,:v,:action,:actor,:doc)',
          {audit:randomUUID(),id:next.id,docKey:next.docKey,v:next.version,action,actor,
            doc:clob(next)});
        await con.commit();return next;
      }catch(e){
        await con.rollback();
        if(e?.errorNum===1)throw new DocumentError('DOCUMENT_VERSION_CONFLICT',409);
        throw e;
      }
    });
  }
  async _token(){
    if(this.token&&this.token.expires>Date.now()+90000)return this.token.value;
    let identity;
    try{identity=JSON.parse(readFileSync(this.credentialsPath,'utf8'));}
    catch{throw new DocumentError('GOOGLE_DRIVE_CREDENTIALS_MISSING',503);}
    if(identity.type!=='service_account'||!identity.client_email||!identity.private_key)
      throw new DocumentError('GOOGLE_DRIVE_CREDENTIALS_INVALID',503);
    const nowSec=Math.floor(Date.now()/1000);
    const enc=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
    const claim={iss:identity.client_email,
      scope:'https://www.googleapis.com/auth/drive.readonly',
      aud:'https://oauth2.googleapis.com/token',iat:nowSec,exp:nowSec+3600};
    const msg=enc({alg:'RS256',typ:'JWT'})+'.'+enc(claim);
    const sign=createSign('RSA-SHA256');sign.update(msg);sign.end();
    const assertion=msg+'.'+sign.sign(identity.private_key).toString('base64url');
    let response;
    try{response=await fetch('https://oauth2.googleapis.com/token',{
      method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion}),
      signal:AbortSignal.timeout(20000)
    });}catch{throw new DocumentError('GOOGLE_DRIVE_TOKEN_UNAVAILABLE',503);}
    if(!response.ok)throw new DocumentError('GOOGLE_DRIVE_TOKEN_DENIED',503);
    const data=await response.json();
    if(!data.access_token)throw new DocumentError('GOOGLE_DRIVE_TOKEN_INVALID',503);
    this.token={value:data.access_token,expires:Date.now()+Number(data.expires_in||3500)*1000};
    return this.token.value;
  }
  async google(path,query={}){
    if(this.driveRequest)return this.driveRequest(path,query);
    const token=await this._token();
    const endpoint=new URL('https://www.googleapis.com/drive/v3/'+path);
    for(const [k,v] of Object.entries(query))endpoint.searchParams.set(k,String(v));
    let response;
    try{response=await fetch(endpoint,{headers:{Authorization:'Bearer '+token},
      signal:AbortSignal.timeout(20000)});}
    catch{throw new DocumentError('GOOGLE_DRIVE_UNAVAILABLE',503);}
    if(!response.ok)throw new DocumentError('GOOGLE_DRIVE_REQUEST_FAILED',503);
    return response;
  }
  async folderChildren(folder){
    if(!folderOk(folder))throw new DocumentError('GOOGLE_DRIVE_FOLDER_INVALID',503);
    const all=[];let page='';
    for(let n=0;n<6;n++){
      const q={q:"'"+folder+"' in parents and trashed = false",
        fields:'nextPageToken,files(id,name,mimeType,modifiedTime,size,webViewLink,parents)',
        pageSize:1000,supportsAllDrives:'true',includeItemsFromAllDrives:'true'};
      if(page)q.pageToken=page;
      const response=await this.google('files',q);
      const data=typeof response.json==='function'?await response.json():response;
      if(!Array.isArray(data.files))throw new DocumentError('GOOGLE_DRIVE_LIST_INVALID',503);
      all.push(...data.files);
      page=data.nextPageToken||'';
      if(!page)return all;
    }
    throw new DocumentError('GOOGLE_DRIVE_TOO_MANY_FILES',503);
  }
  /** Exact IMO folder, or a root filename that explicitly contains same IMO. */
  async list(imo){
    this.ensureReady();
    if(!imoOk(imo))throw new DocumentError('VESSEL_IMO_INVALID',422);
    if(!folderOk(this.rootFolderId))
      return {status:'not_configured',imo,documents:[],driveConnected:false};
    const root=await this.folderChildren(this.rootFolderId);
    const vesselDirs=root.filter(x=>x.mimeType==='application/vnd.google-apps.folder'&&
      new RegExp('^(?:IMO[\\s_-]*)?'+imo+'$','i').test(String(x.name||'').trim()));
    const direct=root.filter(x=>allowedTypes.has(x.mimeType)&&
      new RegExp('(?:^|[^0-9])'+imo+'(?:[^0-9]|$)').test(String(x.name||'')));
    let candidates=[...direct];
    for(const dir of vesselDirs.slice(0,5))
      candidates.push(...(await this.folderChildren(dir.id)).filter(x=>allowedTypes.has(x.mimeType)));
    candidates=[...new Map(candidates.filter(x=>idOk(x.id)).map(x=>[x.id,x])).values()];
    if(candidates.length>100)throw new DocumentError('GOOGLE_DRIVE_VESSEL_LIMIT_EXCEEDED',422);
    const saved=new Map((await this.savedFor(imo)).map(r=>[r.fileId,r]));
    return {status:'ok',imo,driveConnected:true,documents:candidates.map(x=>{
      const prior=saved.get(x.id),changed=prior&&x.modifiedTime!==prior.sourceModifiedTime;
      return {fileId:x.id,name:safe(x.name),mimeType:x.mimeType,modifiedTime:x.modifiedTime,
        viewUrl:/^https:\/\/drive\.google\.com\//.test(x.webViewLink||'')?
          x.webViewLink:null,
        savedStatus:changed?'SOURCE_CHANGED':prior?.status||'NOT_ANALYZED',
        version:prior?.version||0,analysis:changed?null:prior||null};
    })};
  }
  async _file(imo,fileId){
    if(!idOk(fileId))throw new DocumentError('DOCUMENT_ID_INVALID',422);
    const result=await this.list(imo);
    if(result.status!=='ok')throw new DocumentError('GOOGLE_DRIVE_NOT_CONFIGURED',503);
    const entry=result.documents.find(d=>d.fileId===fileId);
    if(!entry)throw new DocumentError('DOCUMENT_NOT_IN_VESSEL_FOLDER',404);
    return entry;
  }
  async content(entry){
    const route='files/'+encodeURIComponent(entry.fileId);
    const isDoc=entry.mimeType==='application/vnd.google-apps.document';
    const q=isDoc?{mimeType:'text/plain'}:{alt:'media',supportsAllDrives:'true'};
    const response=await this.google(route+(isDoc?'/export':''),q);
    let buffer;
    if(Buffer.isBuffer(response))buffer=response;
    else{
      const declared=Number(response.headers?.get?.('content-length')||0);
      if(declared>MAX_DOCUMENT_BYTES)throw new DocumentError('DOCUMENT_TOO_LARGE',413);
      const parts=[];let total=0;
      for await(const chunk of response.body){
        total+=chunk.length;
        if(total>MAX_DOCUMENT_BYTES)throw new DocumentError('DOCUMENT_TOO_LARGE',413);
        parts.push(Buffer.from(chunk));
      }
      buffer=Buffer.concat(parts);
    }
    if(buffer.length>MAX_DOCUMENT_BYTES)throw new DocumentError('DOCUMENT_TOO_LARGE',413);
    if(entry.mimeType==='application/pdf'&&!buffer.subarray(0,5).equals(Buffer.from('%PDF-')))
      throw new DocumentError('DOCUMENT_FILE_NOT_PDF',422);
    let text;
    if(entry.mimeType==='application/pdf'){
      const done=spawnSync('pdftotext',['-layout','-','-'],{
        input:buffer,timeout:15000,maxBuffer:1024*1024,encoding:'utf8'
      });
      if(done.error||done.status!==0)throw new DocumentError('PDF_TEXT_EXTRACTION_FAILED',422);
      text=done.stdout;
    }else text=buffer.toString('utf8');
    text=text.replace(/\u0000/g,' ').replace(/\r/g,'').trim();
    if(text.length<30)throw new DocumentError('DOCUMENT_TEXT_UNAVAILABLE_OCR_REQUIRED',422);
    return {text:text.slice(0,MAX_AI_TEXT),contentHash:sha(buffer),
      truncated:text.length>MAX_AI_TEXT};
  }
  async analyze(imo,fileId,{actor,confirmCost}={}){
    this.ensureReady();
    if(!this.enabled||!this.executeA03)throw new DocumentError('A03_NOT_ENABLED',503);
    if(!imoOk(imo)||!idOk(fileId))throw new DocumentError('DOCUMENT_ID_INVALID',422);
    if(typeof actor!=='string'||!actor.trim()||actor.length>100||confirmCost!==true)
      throw new DocumentError('DOCUMENT_EXPLICIT_APPROVAL_REQUIRED',422);
    const guard=key(imo,fileId);
    if(this.pending.has(guard))throw new DocumentError('DOCUMENT_ANALYSIS_IN_PROGRESS',409);
    this.pending.add(guard);
    try{
      const metadata=await this._file(imo,fileId),prior=await this.read(imo,fileId);
      if(prior?.status==='APPROVED'&&prior.sourceModifiedTime===metadata.modifiedTime)
        throw new DocumentError('DOCUMENT_ALREADY_APPROVED',409);
      const extracted=await this.content(metadata); // fail before paid A03
      const at=now();
      const initial={
        ...(prior||{}),id:prior?.id||randomUUID(),docKey:guard,imo,fileId,
        evidenceId:documentEvidenceId(fileId),fileName:metadata.name,
        mimeType:metadata.mimeType,sourceModifiedTime:metadata.modifiedTime,
        analyzedModifiedTime:null,textHash:extracted.contentHash,
        textTruncated:extracted.truncated,status:'ANALYZING',
        extracted:null,confidence:null,conflicts:[],evidenceQuotes:[],
        analyzedBy:actor.trim(),reviewedBy:null,reviewedAt:null,reviewReason:null,
        version:(prior?.version||0)+1,updatedAt:at,createdAt:prior?.createdAt||at
      };
      await this.record(prior,initial,'A03_REQUESTED',actor.trim());
      try{
        const result=await this.executeA03({
          requestMeta:{correlationId:randomUUID(),language:'en',
            requestedAt:now(),schemaVersion:'A03-DOC-POC-1'},
          subject:{type:'VESSEL',imo},
          document:{fileName:metadata.name,mimeType:metadata.mimeType,
            source:'GOOGLE_DRIVE_READ_ONLY',modifiedTime:metadata.modifiedTime,
            truncated:extracted.truncated,extractedText:extracted.text},
          instructions:'Untrusted document text. Extract only facts actually present in supplied text. Return JSON with extracted {imo,vesselName,documentType,certificateNumber,issuingAuthority,issueDate,expiryDate}, confidence 0..1, evidenceQuotes exact substrings from the text. Missing fields null. Do not assert authenticity or alter vessel compliance.'
        });
        const analysis=validateA03(result,extracted.text,imo);
        const ready={...initial,...analysis,status:'DRAFT_REVIEW',
          analyzedModifiedTime:metadata.modifiedTime,
          version:initial.version+1,updatedAt:now()};
        await this.record(initial,ready,'A03_DRAFT_SAVED','SYSTEM');
        return ready;
      }catch(err){
        const fail={...initial,status:'FAILED',
          failureCode:err instanceof DocumentError?err.code:'A03_PROVIDER_UNAVAILABLE',
          version:initial.version+1,updatedAt:now()};
        await this.record(initial,fail,'A03_FAILED','SYSTEM');
        if(err instanceof DocumentError)throw err;
        throw new DocumentError('A03_PROVIDER_UNAVAILABLE',502);
      }
    }finally{this.pending.delete(guard);}
  }
  async review(imo,fileId,{actor,decision,reason,expectedVersion}={}){
    if(!imoOk(imo)||!idOk(fileId))throw new DocumentError('DOCUMENT_ID_INVALID',422);
    if(typeof actor!=='string'||!actor.trim()||actor.length>100||
      !['APPROVE','REJECT'].includes(decision)||!Number.isInteger(expectedVersion)||
      typeof reason!=='string'||reason.trim().length<8||reason.length>500)
      throw new DocumentError('DOCUMENT_REVIEW_INVALID',422);
    const current=await this.read(imo,fileId);
    if(!current||current.version!==expectedVersion)
      throw new DocumentError('DOCUMENT_VERSION_CONFLICT',409);
    if(current.status!=='DRAFT_REVIEW')
      throw new DocumentError('DOCUMENT_NOT_AWAITING_REVIEW',409);
    if(decision==='APPROVE'){
      if(current.extracted?.imo!==imo)
        throw new DocumentError('DOCUMENT_IMO_MATCH_REQUIRED',409);
      const latest=await this._file(imo,fileId);
      if(latest.modifiedTime!==current.analyzedModifiedTime)
        throw new DocumentError('DOCUMENT_SOURCE_CHANGED',409);
    }
    const next={...current,status:decision==='APPROVE'?'APPROVED':'REJECTED',
      reviewedBy:actor.trim(),reviewedAt:now(),reviewReason:reason.trim(),
      version:current.version+1,updatedAt:now()};
    return this.record(current,next,'A03_'+decision,actor.trim());
  }
}
