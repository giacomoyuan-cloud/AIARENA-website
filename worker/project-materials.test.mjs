import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import worker,{ChatRun} from './worker.js';
import {projectLibrary} from './project-library.js';
import {readProject,ReadingPaused,consumeReadingStream} from './project-reading.js';
import Files from '../arena-project-files.js';
import {usageSummary} from './billing-ledger.js';

const pass='synthetic-project-files-password-hash';
function setup(t){
  const data=new Map(['tester','another'].map(u=>['user:'+u,JSON.stringify({hash:pass})])),objects=new Map(),blobs=new Map(),uploads=new Map();
  const kv={get:async k=>data.get(k)||null,put:async(k,v)=>data.set(k,v),delete:async k=>data.delete(k),list:async({prefix})=>({keys:[...data.keys()].filter(k=>k.startsWith(prefix)).map(name=>({name}))})};
  const bucket={async createMultipartUpload(key){const uploadId=crypto.randomUUID();uploads.set(uploadId,{key,parts:new Map()});return {uploadId};},resumeMultipartUpload(key,id){return {
    async uploadPart(n,body){const bytes=new Uint8Array(await new Response(body).arrayBuffer());uploads.get(id).parts.set(n,bytes);return {partNumber:n,etag:'part-'+n+'-'+bytes.length};},
    async complete(parts){const value=uploads.get(id),size=parts.reduce((n,p)=>n+value.parts.get(p.partNumber).length,0),bytes=new Uint8Array(size);let offset=0;for(const p of parts){const b=value.parts.get(p.partNumber);bytes.set(b,offset);offset+=b.length;}blobs.set(key,bytes);uploads.delete(id);return {size};},async abort(){uploads.delete(id);}
  };},async head(key){return blobs.has(key)?{size:blobs.get(key).length}:null;},async get(key){return blobs.has(key)?{body:blobs.get(key),size:blobs.get(key).length}:null;},async delete(key){blobs.delete(key);}};
  const env={BIZ_KV:kv,MEMORY_KV:kv,PROJECT_DOCUMENTS:bucket,PASSWORD:'synthetic-global-password',ANTHROPIC_API_KEY:'synthetic-anthropic-key'};
  env.CHAT_RUNS={idFromName:name=>name,get(name){if(!objects.has(name)){
    const db=new DatabaseSync(':memory:');t.after(()=>db.close());
    const ctx={storage:{sql:{exec(sql,...args){const stmt=db.prepare(sql),result=stmt.columns().length?stmt.all(...args):(stmt.run(...args),[]);return {toArray:()=>result};}},transactionSync(fn){db.exec('BEGIN');try{const v=fn();db.exec('COMMIT');return v;}catch(e){db.exec('ROLLBACK');throw e;}},setAlarm:async()=>{}}};
    objects.set(name,new ChatRun(ctx,env));}return {fetch:request=>objects.get(name).fetch(request)};}};
  async function api(action,extra={}){const response=await worker.fetch(new Request('https://api.pickandcase.com/projects',{method:'POST',body:JSON.stringify({username:'tester',password:pass,action,...extra})}),env),value=await response.json();if(!response.ok)throw Object.assign(Error(value.error),{status:response.status});return value;}
  async function binary(path,options){const headers=options.method==='PUT'?{Authorization:'Bearer '+Buffer.from(JSON.stringify(options.credentials)).toString('base64')}:{'Content-Type':'application/json'};
    const response=await worker.fetch(new Request('https://api.pickandcase.com'+path,{method:options.method,headers,body:options.method==='PUT'?options.body:JSON.stringify({...options.body,...options.credentials})}),env);if(!response.ok)throw Object.assign(Error((await response.json()).error),{status:response.status});return response;}
  return {env,data,blobs,uploads,objects,api,binary};
}
async function material(s,projectId,{name='reference.txt',text='Document source budget 73921.50',size=text.length,segments=[{ordinal:0,location:'第 1 页',text}],coverage}={}){
  const id=crypto.randomUUID(),start=await s.api('library_start',{projectId,file:{id,name,size,type:'text/plain'}}),count=Math.max(1,Math.ceil(size/start.partSize)),parts=[];
  for(let n=1;n<=count;n++){const response=await s.binary('/project-upload?project='+projectId+'&file='+id+'&part='+n,{method:'PUT',credentials:{username:'tester',password:pass},body:new Blob([new Uint8Array(Math.min(start.partSize,size-(n-1)*start.partSize))])});parts.push((await response.json()).part);}
  await s.api('library_original_complete',{projectId,fileId:id,parts});
  for(let n=0;n<segments.length;n+=24)await s.api('library_segments',{projectId,fileId:id,segments:segments.slice(n,n+24)});
  const result=await s.api('library_commit',{projectId,fileId:id,segments:segments.length,coverage});return result.file;
}
test('multipart storage accepts a file above the old 8 MB limit, verifies bytes and keeps originals private',async t=>{
  const s=setup(t),p=(await s.api('create',{name:'Private files'})).project;
  const file=await material(s,p.id,{name:'large.pdf',size:9*1024*1024});assert.equal(file.status,'ready');assert.equal(file.size,9*1024*1024);assert.ok(!file.objectKey&&!file.uploadId);
  const other=(await s.api('create',{name:'Other project'})).project;
  await assert.rejects(s.api('preview',{projectId:other.id,fileId:file.id}),e=>e.status===404);
  await assert.rejects(s.api('preview',{projectId:p.id,fileId:file.id,username:'another'}),e=>e.status===404);
  await assert.rejects(s.binary('/project-original',{method:'POST',credentials:{username:'another',password:pass},body:{projectId:p.id,fileId:file.id}}),e=>e.status===404);
  const downloaded=await s.binary('/project-original',{method:'POST',credentials:{username:'tester',password:pass},body:{projectId:p.id,fileId:file.id}});assert.equal(Number(downloaded.headers.get('Content-Length')),9*1024*1024);
  assert.match(downloaded.headers.get('Cache-Control'),/private/);assert.equal((await downloaded.arrayBuffer()).byteLength,file.size);
});
test('index retries are idempotent, missing segments never become ready, and scanned pages are marked partial',async t=>{
  const s=setup(t),p=(await s.api('create',{name:'Coverage'})).project,id=crypto.randomUUID();
  const start=await s.api('library_start',{projectId:p.id,file:{id,name:'scan.pdf',size:1}});
  const part=(await(await s.binary('/project-upload?project='+p.id+'&file='+id+'&part=1',{method:'PUT',credentials:{username:'tester',password:pass},body:new Blob(['x'])})).json()).part;
  await s.api('library_original_complete',{projectId:p.id,fileId:id,parts:[part]});
  const segments=[{ordinal:0,location:'第 1 页',text:'Page one secret detail'}];
  await s.api('library_segments',{projectId:p.id,fileId:id,segments});await s.api('library_segments',{projectId:p.id,fileId:id,segments});
  await assert.rejects(s.api('library_commit',{projectId:p.id,fileId:id,segments:2}),e=>e.status===409);
  await assert.rejects(s.api('library_segments',{projectId:p.id,fileId:id,segments:[{ordinal:0,text:'changed'}]}),e=>e.status===409);
  const result=await s.api('library_commit',{projectId:p.id,fileId:id,segments:1,coverage:{units:2,emptyUnits:1}});assert.equal(result.file.status,'partial');assert.deepEqual(result.file.coverage,{units:2,emptyUnits:1});
  await assert.rejects(readProject({files:[result.file],question:'review',history:[],model:'test',scope:p.id,library:()=>{throw Error('must not read');}}),/OCR/);
});
test('search indexes Chinese and English and excludes removed files without crossing project scopes',async t=>{
  const s=setup(t),p=(await s.api('create',{name:'Search'})).project;
  const file=await material(s,p.id,{text:'音乐剧排练预算为 73921.50 元。Invoice ZEBRA12 is approved.'});
  const search=query=>projectLibrary(s.env,'tester',p.id,'search',{query});
  assert.equal((await search('音乐剧预算')).hits[0].file.id,file.id);assert.ok((await search('ZEBRA12')).hits[0].text.includes('ZEBRA12'));
  await s.api('remove_file',{projectId:p.id,fileId:file.id});assert.equal((await search('ZEBRA12')).hits.length,0);
  assert.equal((await s.api('removed_files',{projectId:p.id})).files[0].id,file.id);await s.api('restore_file',{projectId:p.id,fileId:file.id});assert.equal((await search('ZEBRA12')).hits.length,1);
});
test('full reading visits the last segment, saves progress and never repeats a completed paid batch',async t=>{
  const s=setup(t),p=(await s.api('create',{name:'Full reading'})).project,segments=Array.from({length:35},(_,i)=>({ordinal:i,location:'第 '+(i+1)+' 页',text:'SOURCE_'+i+' '+'.'.repeat(2350)})),file=await material(s,p.id,{segments});
  let revision;const seen=[],library=(action,extra)=>{if(action==='scope')revision=extra.scope;return projectLibrary(s.env,'tester',p.id,action,extra);},options={files:[file],question:'逐页核查',history:[],model:'synthetic-low',scope:p.id,library,batchLegacy:async function*(){},progress:async()=>{},budget:1,complete:async prompt=>{seen.push(prompt);return {text:'Reading notes '+seen.length};}};
  await assert.rejects(readProject(options),e=>e instanceof ReadingPaused&&e.progress.done>0&&e.progress.complete===false);
  const result=await readProject({...options,budget:24});assert.equal(result.coverage.complete,true);assert.equal(result.coverage.done,35);assert.ok(seen.some(p=>p.includes('SOURCE_34')));assert.equal(seen.filter(p=>p.includes('SOURCE_0 ')).length,1);
  const count=seen.length;await readProject({...options,budget:24});assert.equal(seen.length,count);
  await s.api('remove_file',{projectId:p.id,fileId:file.id});await assert.rejects(library('batch',{scope:revision,offset:0}),e=>e.status===409);
  await assert.rejects(library('batch',{scope:'forged-scope',offset:0}),/阅读范围无效/);
});
test('upload client streams text beyond 400000 characters in acknowledged bounded batches without base64',async()=>{
  const text='汉字 and emoji 😺\n'.repeat(40000),file=new File([text],'large.txt'),all=[];let max=0;
  const result=await Files.parseInWorker(file,async batch=>{max=Math.max(max,batch.length);all.push(...batch);});
  assert.ok(text.length>400000);assert.equal(all.map(s=>s.text).join(''),text);assert.ok(max<=24);assert.equal(result.segments,all.length);assert.ok(all.every(s=>s.text.length<=2400));
});
test('PDF parsing has no 200-page cutoff and empty pages cannot masquerade as readable text',async()=>{
  const prior=globalThis.pdfjsLib;globalThis.pdfjsLib={GlobalWorkerOptions:{},getDocument:()=>({promise:Promise.resolve({numPages:205,getPage:async n=>({getTextContent:async()=>({items:n===3?[]:[{str:'PAGE_'+n,hasEOL:true}]}),cleanup(){}}),destroy:async()=>{}})})};
  try{const coverage={},parts=[];for await(const s of Files.parse(new File(['synthetic'],'pages.pdf'),coverage))parts.push(s);assert.equal(coverage.units,205);assert.equal(coverage.emptyUnits,1);assert.ok(parts.at(-1).text.includes('PAGE_205'));assert.equal(parts.length,204);}finally{globalThis.pdfjsLib=prior;}
});
test('spreadsheet parsing includes all sheets and sparse final cells without iterating a million empty rows',async()=>{
  const previous=globalThis.XLSX;globalThis.XLSX={read:()=>({SheetNames:['Sheet A','Sheet B'],Sheets:{'Sheet A':{'!ref':'A1:XFD1048576',A1:{w:'产品'},B1:{w:'预算'},XFD1048576:{w:'LAST_CELL_73921.50'}},'Sheet B':{'!ref':'A1:B1',A1:{w:'001234567890'},B1:{f:'1+1',v:2,w:'2'}}}}),utils:{decode_cell(address){const m=address.match(/^([A-Z]+)(\d+)$/);let c=0;for(const letter of m[1])c=c*26+letter.charCodeAt(0)-64;return {r:Number(m[2])-1,c:c-1};}}};
  try{const parts=[];for await(const s of Files.parse(new File(['synthetic'],'book.xlsx'),{}))parts.push(s);const text=parts.map(s=>s.text).join('');assert.match(text,/LAST_CELL_73921\.50/);assert.match(text,/001234567890/);assert.ok(parts.some(s=>s.location.includes('1048576')));assert.ok(parts.some(s=>s.location.includes('Sheet B')));}finally{globalThis.XLSX=previous;}
});
test('Word parsing does not truncate the end of a long document and chunks preserve Unicode pairs',async()=>{
  const previous=globalThis.mammoth,text='A'.repeat(2399)+'😺'+'word '.repeat(90000)+'END_OF_WORD_73921';globalThis.mammoth={extractRawText:async()=>({value:text})};
  try{const parts=[];for await(const s of Files.parse(new File(['synthetic'],'doc.docx'),{}))parts.push(s);assert.equal(parts.map(s=>s.text).join(''),text);assert.match(parts.at(-1).text,/END_OF_WORD_73921/);assert.ok(parts.every(s=>!/[\uD800-\uDBFF]$/.test(s.text)));}finally{globalThis.mammoth=previous;}
});
test('the browser upload protocol resumes acknowledged parts and sends no original as JSON base64',async t=>{
  const s=setup(t),p=(await s.api('create',{name:'Resume'})).project,prior=globalThis.indexedDB,records=new Map();
  globalThis.indexedDB={open(){const request={};queueMicrotask(()=>{request.result={close(){},transaction(){const tx={objectStore:()=>({get:key=>op(()=>records.get(key)),put:(value,key)=>op(()=>records.set(key,value)),delete:key=>op(()=>records.delete(key))})};function op(fn){const r={};queueMicrotask(()=>{r.result=fn();r.onsuccess?.();tx.oncomplete?.();});return r;}return tx;}};request.onsuccess();});return request;}};
  try{const file=new File(['BEGIN',' '.repeat(9*1024*1024),'END'],'resume.txt'),parts=[];let interrupted=false;
    const options={file,projectId:p.id,credentials:{username:'tester',password:pass},api:s.api,binary:async(path,opts)=>{parts.push(Number(new URL('https://test'+path).searchParams.get('part')));if(parts.at(-1)===2&&!interrupted){interrupted=true;throw Error('synthetic mobile disconnect');}return s.binary(path,opts);}};
    await assert.rejects(Files.upload(options),/disconnect/);const result=await Files.upload(options);assert.equal(result.status,'ready');assert.deepEqual(parts,[1,2,2]);assert.equal(records.size,0);assert.equal(result.size,file.size);
  }finally{globalThis.indexedDB=prior;}
});
test('full reading and final response both use official routing while usage is recorded once per actual request',async t=>{
  const s=setup(t),p=(await s.api('create',{name:'Routing'})).project;await material(s,p.id,{text:'BATCH_SOURCE_CANARY amount 12345'});
  await s.api('update',{projectId:p.id,readingMode:'full'});const calls=[];
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    assert.equal(new URL(url).hostname,'api.anthropic.com');const body=JSON.parse(options.body);calls.push(body);const reader=String(body.system).startsWith('你负责逐批');
    const events=[{type:'message_start',message:{usage:{input_tokens:7,output_tokens:0}}},{type:'content_block_delta',delta:{type:'text_delta',text:reader?'FILE_NOTES_CANARY amount 12345':'Final answer'}},{type:'message_delta',delta:{stop_reason:'end_turn'},usage:{output_tokens:3}},{type:'message_stop'}];
    return new Response(events.map(e=>'data: '+JSON.stringify(e)+'\n\n').join(''));
  });
  const request=new Request('https://api.pickandcase.com/',{method:'POST',body:JSON.stringify({user:'tester',password:pass,model:'claude-sonnet-5-5',projectId:p.id,effort:'low',maxOutputTokens:100,chat:{scope:p.id,question:'What is the amount?',history:[],incognito:true,readingMode:'full',skills:{mode:'off',ids:[]}}})});
  const output=await(await worker.fetch(request,s.env)).text();assert.ok(output.includes('Final answer'));assert.ok(output.includes('"complete":true'));assert.equal(calls.length,2);assert.equal(calls[0].output_config.effort,'low');assert.ok(JSON.stringify(calls[0]).includes('BATCH_SOURCE_CANARY'));assert.ok(JSON.stringify(calls[1]).includes('FILE_NOTES_CANARY'));assert.ok(!JSON.stringify(calls[1]).includes('BATCH_SOURCE_CANARY'));
  const stats=await usageSummary(s.env,'tester');assert.equal(stats.total.calls,2);assert.equal(stats.total.input,14);
});
test('interrupted provider streams cannot falsely complete a full-reading stage',async()=>{
  await assert.rejects(consumeReadingStream(new Response('data: {"t":"partial"}\n\n')),/连接中断/);
  await assert.rejects(consumeReadingStream(new Response('data: {"error":"provider failed"}\n\ndata: [DONE]\n\n')),/provider failed/);
});
