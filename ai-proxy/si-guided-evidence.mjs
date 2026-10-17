/** Inspector-only legacy guided-question evidence, in persistent /data.
 * Published checklist evidence is stored in canonical checklist storage instead.
 * Only the server-authorized assigned inspector may invoke this module.
 */
import {randomUUID,createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync,existsSync,renameSync,unlinkSync} from 'node:fs';
import {join,dirname} from 'node:path';
const root=process.env.SI_GUIDED_EVIDENCE_DIR||'/data/si-guided-evidence';
const fail=(code,status=409)=>{const e=new Error(code);e.code=code;e.status=status;throw e;};
const sha=b=>createHash('sha256').update(b).digest('hex');
const validId=id=>typeof id==='string'&&/^[a-f0-9-]{36}$/.test(id);
const validStep=id=>typeof id==='string'&&/^SI-STEP-[a-f0-9]{20}$/.test(id);
const registry=id=>join(root,id,'manifest.json');
const load=id=>{
 if(!validId(id))fail('SI_GUIDED_EVIDENCE_CASE_INVALID',422);
 const file=registry(id);
 const data=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):{schema:1,items:[]};
 if(data.schema!==1||!Array.isArray(data.items))fail('SI_GUIDED_EVIDENCE_STORE_INVALID',503);
 return data;
};
const atomic=(path,value)=>{
 mkdirSync(dirname(path),{recursive:true,mode:0o700});
 const temp=path+'.'+randomUUID()+'.tmp';
 writeFileSync(temp,JSON.stringify(value),{flag:'wx',mode:0o600});
 renameSync(temp,path);
};
export function listGuidedEvidence(caseId,stepId){
 const data=load(caseId);
 return data.items.filter(x=>x.stepId===stepId).map(x=>({...x}));
}
export function readGuidedImage(caseId,stepId,evidenceId){
 const item=listGuidedEvidence(caseId,stepId).find(x=>x.id===evidenceId);
 if(!item||!item.mimeType.startsWith('image/'))fail('SI_GUIDED_AI_IMAGE_REQUIRED',409);
 const bytes=readFileSync(join(root,caseId,item.id+'.bin'));
 if(sha(bytes)!==item.sha256)fail('SI_GUIDED_EVIDENCE_INTEGRITY_FAILED',409);
 return {mimeType:item.mimeType,base64:bytes.toString('base64'),sha256:item.sha256};
}
export function saveGuidedEvidence(caseId,stepId,actor,file){
 if(!validId(caseId)||!validStep(stepId)||!actor||typeof actor!=='string')
  fail('SI_GUIDED_EVIDENCE_INPUT_INVALID',422);
 if(!file||typeof file.filename!=='string'||!file.filename.trim()||
    file.filename.length>120||typeof file.base64!=='string'||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(file.base64)||file.base64.length>8*1024*1024)
  fail('SI_GUIDED_EVIDENCE_FORMAT_INVALID',422);
 const name=file.filename.trim().replace(/[\\/]/g,'_');
 const bytes=Buffer.from(file.base64,'base64'),mimeType=file.mimeType;
 if(bytes.length===0||bytes.length>5*1024*1024||
   !['image/png','image/jpeg','application/pdf'].includes(mimeType))
  fail('SI_GUIDED_EVIDENCE_TYPE_OR_SIZE_INVALID',413);
 if(mimeType==='application/pdf'&&bytes.subarray(0,5).toString()!=='%PDF-'||
   mimeType==='image/png'&&bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||
   mimeType==='image/jpeg'&&bytes.subarray(0,3).toString('hex')!=='ffd8ff')
  fail('SI_GUIDED_EVIDENCE_MAGIC_INVALID',422);
 const data=load(caseId);
 if(data.items.filter(x=>x.stepId===stepId).length>=8)
  fail('SI_GUIDED_EVIDENCE_LIMIT',409);
 const entry={id:randomUUID(),stepId,filename:name,mimeType,sha256:sha(bytes),
  byteLength:bytes.length,uploadedAt:new Date().toISOString(),uploadedBy:actor,
  provenance:'INSPECTOR_UPLOADED_UNVERIFIED',aiAnalyzed:false};
 const path=join(root,caseId,entry.id+'.bin');
 mkdirSync(dirname(path),{recursive:true,mode:0o700});
 writeFileSync(path,bytes,{flag:'wx',mode:0o600});
 try{data.items.push(entry);atomic(registry(caseId),data);}
 catch(error){try{unlinkSync(path);}catch{}throw error;}
 return {...entry};
}
