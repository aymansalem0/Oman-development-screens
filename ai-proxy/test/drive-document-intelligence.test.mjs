import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DriveDocumentIntelligence,DocumentError,validateA03} from '../drive-document-intelligence.mjs';

const IMO='9328471',ROOT='rootDriveFolder123456789',DIR='imoFolder123456789012',FILE='driveFile123456789012';
const excerpt='IMO 9328471. Certificate of Registry No CR-2026-784. Issued by Flag Registry. Expiry 2028-05-17.';
const metadata={
  id:FILE,name:'Certificate of Registry.pdf',mimeType:'text/plain',
  modifiedTime:'2026-10-01T10:00:00.000Z',
  webViewLink:'https://drive.google.com/file/d/'+FILE+'/view'
};
const normalized=()=>({
  documentEntries:[
    {imo:IMO,documentType:'Certificate of Registry',
      certificateNumber:'CR-2026-784',issuingAuthority:'Flag Registry',
      issueDate:null,expiryDate:'2028-05-17',status:'ACTIVE',
      evidenceQuotes:['Certificate of Registry No CR-2026-784']}
  ],
  extracted:{imo:IMO,vesselName:null,documentType:'Certificate of Registry',
    certificateNumber:'CR-2026-784',issuingAuthority:'Flag Registry',
    issueDate:null,expiryDate:'2028-05-17'},
  confidence:0.86,evidenceQuotes:['IMO 9328471','Certificate of Registry No CR-2026-784']
});
function fixture({fakeResult=normalized(),fileModified=metadata.modifiedTime}={}){
  const dir=mkdtempSync(join(tmpdir(),'moei-a03-test-'));
  let agentCount=0,mutated=fileModified;
  const calls=[];
  const request=async(path,q)=>{
    calls.push({path,q});
    if(path==='files'){
      if(q.q.includes(ROOT))return {files:[
        {id:DIR,name:IMO+' - MV Gulf Horizon',mimeType:'application/vnd.google-apps.folder'},
        {id:'anotherImoFolder12345',name:'IMO 9123456',
          mimeType:'application/vnd.google-apps.folder'}]};
      if(q.q.includes(DIR))return {files:[{...metadata,modifiedTime:mutated}]};
      return {files:[]};
    }
    if(path==='files/'+FILE)return Buffer.from(excerpt);
    throw new Error('Unexpected Drive API path: '+path);
  };
  const args={mode:'json',file:join(dir,'document-store.json'),enabled:true,
    rootFolderId:ROOT,driveRequest:request,
    executeA03:async()=>{agentCount++;return fakeResult;}};
  const store=new DriveDocumentIntelligence(args);
  return {store,args,calls,agentCalls:()=>agentCount,modify:time=>{mutated=time;},
    close:()=>rmSync(dir,{recursive:true,force:true})};
}
test('only exact IMO folder is listed; credentials and source text are not returned in metadata',async()=>{
  const a=fixture();
  try{
    const response=await a.store.list(IMO);
    assert.equal(response.driveConnected,true);
    assert.equal(response.documents.length,1);
    assert.equal(response.documents[0].fileId,FILE);
    assert.equal(response.documents[0].savedStatus,'NOT_ANALYZED');
    assert.equal(a.agentCalls(),0);
    assert.equal(JSON.stringify(response).includes(excerpt),false);
    assert.ok(a.calls.every(c=>!JSON.stringify(c).includes('Bearer')));
  }finally{a.close();}
});
test('explicit A03 run captures cited fields, then human APPROVE exposes reviewed evidence to A02/A04',async()=>{
  const a=fixture();
  try{
    await assert.rejects(()=>a.store.analyze(IMO,FILE,{actor:'Inspector X',confirmCost:false}),
      /DOCUMENT_EXPLICIT_APPROVAL_REQUIRED/);
    assert.equal(a.agentCalls(),0);
    const result=await a.store.analyze(IMO,FILE,{actor:'Inspector X',confirmCost:true});
    assert.equal(result.status,'DRAFT_REVIEW');
    assert.equal(result.extracted.imo,IMO);
    assert.equal(result.documentEntries.length,1);
    assert.equal(result.authenticityVerified,false);
    assert.equal(a.agentCalls(),1);
    assert.equal((await a.store.approvedFor(IMO)).length,0);
    await assert.rejects(()=>a.store.review(IMO,FILE,{actor:'Inspector X',
      decision:'APPROVE',reason:'checked document',expectedVersion:1}),
      /DOCUMENT_VERSION_CONFLICT/);
    const approved=await a.store.review(IMO,FILE,{actor:'Inspector X',
      decision:'APPROVE',reason:'Evidence checked manually',expectedVersion:result.version});
    assert.equal(approved.status,'APPROVED');
    const rows=await a.store.approvedFor(IMO);
    assert.equal(rows.length,1);
    assert.ok(rows[0].evidenceId.startsWith('GDOC-'));
    assert.equal(rows[0].expiryDate,'2028-05-17');
    assert.equal(rows[0].documentEntries[0].documentType,'Certificate of Registry');
    assert.equal(rows[0].source,'GOOGLE_DRIVE_A03_HUMAN_REVIEWED_NOT_AUTHENTICATED');
    assert.equal((await new DriveDocumentIntelligence(a.args).savedFor(IMO))[0].status,'APPROVED');
    await assert.rejects(()=>a.store.analyze(IMO,FILE,{actor:'Inspector X',confirmCost:true}),
      /DOCUMENT_ALREADY_APPROVED/);
    assert.equal(a.agentCalls(),1);
  }finally{a.close();}
});
test('A03 hallucinated quotation is blocked; no approved certificate is exposed',async()=>{
  const a=fixture({fakeResult:{...normalized(),evidenceQuotes:['THIS WAS NEVER IN PDF']}});
  try{
    await assert.rejects(()=>a.store.analyze(IMO,FILE,{actor:'Inspector X',confirmCost:true}),
      /A03_EVIDENCE_NOT_IN_DOCUMENT/);
    assert.equal(a.agentCalls(),1);
    assert.equal((await a.store.savedFor(IMO))[0].status,'FAILED');
    assert.equal((await a.store.approvedFor(IMO)).length,0);
  }finally{a.close();}
});
test('IMO conflict cannot be approved, even if quoted source text is valid',async()=>{
  const a=fixture({fakeResult:{...normalized(),extracted:{
    ...normalized().extracted,imo:'9123456'}}});
  try{
    const pending=await a.store.analyze(IMO,FILE,{actor:'Reviewer',confirmCost:true});
    assert.equal(pending.conflicts[0].reason,'VESSEL_IMO_MISMATCH');
    await assert.rejects(()=>a.store.review(IMO,FILE,{actor:'Reviewer',decision:'APPROVE',
      reason:'I trust this anyway',expectedVersion:pending.version}),
      /DOCUMENT_IMO_MATCH_REQUIRED/);
    assert.equal((await a.store.approvedFor(IMO)).length,0);
  }finally{a.close();}
});
test('changed Drive document is flagged stale; previous approved extract does not count as current in browser',async()=>{
  const a=fixture();
  try{
    const pending=await a.store.analyze(IMO,FILE,{actor:'Reviewer',confirmCost:true});
    await a.store.review(IMO,FILE,{actor:'Reviewer',decision:'APPROVE',
      reason:'Manually checked data',expectedVersion:pending.version});
    a.modify('2026-10-10T12:00:00.000Z');
    const found=await a.store.list(IMO);
    assert.equal(found.documents[0].savedStatus,'SOURCE_CHANGED');
    assert.equal(found.documents[0].analysis,null);
    assert.equal((await a.store.approvedFor(IMO)).length,0); // A02/A04 cannot see stale approval
  }finally{a.close();}
});
test('disabled connector produces no agent calls or credentials requests',async()=>{
  const a=fixture();
  try{
    a.store.enabled=false;
    await assert.rejects(()=>a.store.analyze(IMO,FILE,{actor:'X',confirmCost:true}),
      /A03_NOT_ENABLED/);
    assert.equal(a.agentCalls(),0);
  }finally{a.close();}
});
test('rejects malformed A03 object contract and missing quotes',()=>{
  assert.throws(()=>validateA03({extracted:{imo:IMO},confidence:.8,evidenceQuotes:[]},
    excerpt,IMO),/A03_EVIDENCE_MISSING/);
  assert.throws(()=>validateA03({result:'garbage'},excerpt,IMO),
    /A03_RESPONSE_CONTRACT_UNVERIFIED/);
});
