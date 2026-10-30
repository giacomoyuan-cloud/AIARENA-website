import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { UPLOAD_LIMITS, MAX_FILE_BASE64_CHARS, uploadDataInfo } from '../web/upload-limits.mjs';
import { validateSkillFiles, fileUploadBody } from './skill-files.js';
import { storeProjectOriginal, readProjectOriginal, downloadProjectOriginal, ORIGINAL_CHUNK_CHARS } from './project-files.js';
const hash=value=>createHash('sha256').update(value).digest('hex');
function store() {
  const values=new Map(),reads=[];
  const kv={get:async key=>{reads.push(key);return values.get(key)??null;},put:async(key,value)=>{assert(Buffer.byteLength(value)<=25*1024*1024,'KV per-value limit');values.set(key,value);},delete:async key=>values.delete(key)};
  return {kv,values,reads};
}
test('a full 20 MiB original validates and streams to the provider in bounded binary chunks',async()=>{
  const data=Buffer.alloc(UPLOAD_LIMITS.fileBytes,90).toString('base64');
  const [file]=validateSkillFiles([{name:'large.zip',mime:'application/zip',data}]);
  assert.equal(file.size,20*1024*1024);
  assert.throws(()=>uploadDataInfo(data.slice(0,-4)+'Wlpa'),/20MB/,'one byte over the decoded limit');
  assert.throws(()=>validateSkillFiles([{name:'a.zip',data},{name:'b.txt',data:'YQ=='}]),/20MB/);
  assert.throws(()=>uploadDataInfo('A'.repeat(MAX_FILE_BASE64_CHARS+4)),/20MB/);
  const upload=fileUploadBody(file),actual=createHash('sha256');let previous,count=0,bytes=0,maxChunk=0;
  for await(const chunk of upload.body){if(previous&&count>1){actual.update(previous);bytes+=previous.length;maxChunk=Math.max(maxChunk,previous.length);}previous=chunk;count++;}
  assert.equal(bytes,file.size);assert(maxChunk<=49152);assert.equal(actual.digest('hex'),hash(Buffer.alloc(file.size,90)));
});
test('streaming multipart retains filenames, MIME and exact bytes',async()=>{
  const file=validateSkillFiles([{name:'中文资料.txt',mime:'text/plain',data:Buffer.from('完整内容\n第二行').toString('base64')}])[0],upload=fileUploadBody(file);
  const form=await new Request('https://fixture.invalid/',{method:'POST',headers:{'Content-Type':upload.contentType},body:upload.body,duplex:'half'}).formData();
  const item=form.get('file');assert.equal(item.name,'中文资料.txt');assert.equal(item.type,'text/plain');assert.equal(await item.text(),'完整内容\n第二行');
});
test('20 MiB project originals round-trip without exceeding one KV value and previews avoid fetching binary parts',async()=>{
  const {kv,values,reads}=store(),data=Buffer.alloc(UPLOAD_LIMITS.fileBytes,71).toString('base64');
  const file={id:'owned-file',name:'large.docx',data,size:UPLOAD_LIMITS.fileBytes,text:'可预览文字'};
  await storeProjectOriginal(kv,'project:owner:A:file:owned-file:original',file);
  assert(values.size>2);assert.equal(JSON.parse(values.get('project:owner:A:file:owned-file:original')).data,undefined);
  const meta=await readProjectOriginal(kv,'project:owner:A:file:owned-file:original');assert.equal(meta.text,file.text);assert.equal(reads.length,1);
  const restored=await readProjectOriginal(kv,'project:owner:A:file:owned-file:original',{withData:true});assert.equal(hash(restored.data),hash(data));assert.equal(restored.size,file.size);
  const response=await downloadProjectOriginal(kv,'project:owner:A:file:owned-file:original');let maxChunk=0;
  const checked=response.body.pipeThrough(new TransformStream({transform(chunk,controller){maxChunk=Math.max(maxChunk,chunk.length);controller.enqueue(chunk);}}));
  const download=await new Response(checked).json();assert.equal(hash(download.file.data),hash(data));assert(maxChunk<=ORIGINAL_CHUNK_CHARS);
});
test('legacy originals remain downloadable and missing chunks fail explicitly',async()=>{
  const {kv,values}=store();await kv.put('legacy',JSON.stringify({name:'old.txt',text:'old',data:'b2xk'}));
  assert.equal((await readProjectOriginal(kv,'legacy',{withData:true})).data,'b2xk');
  await storeProjectOriginal(kv,'large',{text:'text',data:'A'.repeat(ORIGINAL_CHUNK_CHARS+4)});
  values.delete('large:data:1');await assert.rejects(readProjectOriginal(kv,'large',{withData:true}),error=>error.status===503);
  await assert.rejects(downloadProjectOriginal(kv,'large'),error=>error.status===503);
});
test('failed chunk writes do not publish a partial original or leave their own parts',async()=>{
  const {kv,values}=store();let writes=0;
  await assert.rejects(storeProjectOriginal(kv,'new-original',{text:'text',data:'A'.repeat(ORIGINAL_CHUNK_CHARS+4)},async(key,value)=>{if(++writes===2)throw Error('fixture storage failure');await kv.put(key,value);}),/storage failure/);
  assert.equal(values.size,0);
});
