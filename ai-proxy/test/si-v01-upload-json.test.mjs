import test from 'node:test';
import assert from 'node:assert/strict';
import {executeGuidedV01UploadJson,extractV01UploadedImageRef,
  SiV01TransportError} from '../si-v01-upload-json.mjs';

const request={requestMeta:{correlationId:'SI-V01-TEST-1'},
 inspectionCaseId:'8e153162-3431-4b83-9e5d-4113f51c3030',
 checklistItemId:'fire-safety',evidence:{evidenceId:'test-id'}};
const media={evidenceId:'12345678-aaaa-bbbb-cccc-123456789abc',
 mimeType:'image/png',bytes:Buffer.from('89504e470d0a1a0a0000000000000000','hex')};
const args={request,media,baseUrl:'https://api.mena.airia.ai',
  key:'LOCAL_TEST_ONLY_KEY',pipelineId:'5006d8c4-f8b5-4811-b767-704daab16e6a'};

test('SI-V01 uploads image first then invokes JSON PipelineExecution with image URL only',async()=>{
 const calls=[];
 const fetchImpl=async(url,opts)=>{
  calls.push({url,opts});
  if(calls.length===1){
   assert.match(url,/\/v1\/upload$/);
   assert.equal(opts.method,'POST');
   assert.equal(opts.body.get('userInput'),null);
   const part=opts.body.get('file');
   assert.equal(part.type,'image/png');
   assert.equal(await part.arrayBuffer().then(x=>Buffer.from(x).equals(media.bytes)),true);
   return new Response(JSON.stringify({id:'uploaded-123',
     image_url:'https://assets.airia.ai/signed/photo?token=PRIVATE_SIGNED'}),{
       status:200,headers:{'Content-Type':'application/json'}});
  }
  assert.match(url,/\/v1\/PipelineExecution\/[a-f0-9-]+$/);
  assert.equal(opts.headers['Content-Type'],'application/json');
  assert.ok(typeof opts.body==='string');
  const data=JSON.parse(opts.body);
  assert.equal(data.asyncOutput,false);
  assert.equal(data.images.length,1);
  assert.ok(data.images[0].startsWith('https://'));
  assert.deepEqual(JSON.parse(data.userInput),request);
  assert.equal(data.file,undefined);
  return new Response(JSON.stringify({result:'{\"officialFindingCreated\":false}'}),{
    status:200,headers:{'Content-Type':'application/json'}});
 };
 const answer=await executeGuidedV01UploadJson({...args,fetchImpl});
 assert.equal(calls.length,2);
 assert.ok(answer.result.includes('officialFindingCreated'));
});
test('SI-V01 does not execute pipeline when Airia upload response lacks a safe image reference',async()=>{
 let calls=0;
 const fetchImpl=async()=>{calls++;return new Response(JSON.stringify({id:'no-url'}),{
   status:200,headers:{'Content-Type':'application/json'}});};
 await assert.rejects(()=>executeGuidedV01UploadJson({...args,fetchImpl}),
   e=>e instanceof SiV01TransportError&&e.code==='SI_V01_UPLOAD_REFERENCE_UNAVAILABLE'
     &&e.stage==='UPLOAD');
 assert.equal(calls,1);
});
test('SI-V01 upload HTTP 400 is identified distinctly and never triggers paid pipeline execution',async()=>{
 let calls=0;
 const fetchImpl=async()=>{calls++;return new Response('PRIVATE_RESPONSE', {status:400});};
 await assert.rejects(()=>executeGuidedV01UploadJson({...args,fetchImpl}),
   e=>e.code==='SI_V01_UPLOAD_REJECTED'&&e.safeDiagnostic.upstreamStatus===400
      &&!JSON.stringify(e.safeDiagnostic).includes('PRIVATE'));
 assert.equal(calls,1);
});
test('SI-V01 JSON execution 400 is distinct from legacy multipart failure',async()=>{
 let calls=0;
 const fetchImpl=async()=>{
  calls++;
  if(calls===1)return new Response(JSON.stringify({
    imageUrl:'https://assets.airia.ai/image.jpg'}),{status:200});
  return new Response('PRIVATE_BODY',{status:400});
 };
 await assert.rejects(()=>executeGuidedV01UploadJson({...args,fetchImpl}),
   e=>e.code==='SI_V01_JSON_EXECUTION_REJECTED'&&
     e.stage==='JSON_EXECUTION'&&e.safeDiagnostic.upstreamStatus===400);
 assert.equal(calls,2);
});
test('SI-V01 blocks unsafe attachment references and malformed local image without calling provider',async()=>{
 assert.equal(extractV01UploadedImageRef({image_url:'http://evil.test/img'}),null);
 assert.equal(extractV01UploadedImageRef({image_url:'https://user:pass@evil.test/img'}),null);
 assert.equal(extractV01UploadedImageRef({data:{image_url:'https://assets.airia.ai/img'}}),
   'https://assets.airia.ai/img');
 let calls=0;
 await assert.rejects(()=>executeGuidedV01UploadJson({
   ...args,media:{...media,mimeType:'image/gif'},fetchImpl:async()=>{calls++;}}),
   e=>e.code==='SI_V01_IMAGE_INVALID');
 assert.equal(calls,0);
});
