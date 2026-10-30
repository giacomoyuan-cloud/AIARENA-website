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
test('naming a new source keeps it in retrieval when legacy scores use a different scale',async t=>{
  const s=setup(t),p=(await s.api('create',{name:'Mixed storage'})).project;
  const text=('预算 budget reference information LEGACY_SOURCE '+'.'.repeat(900)+'\n').repeat(8);
  await s.api('upload',{projectId:p.id,file:{name:'old.txt',text,size:Buffer.byteLength(text),data:Buffer.from(text).toString('base64')}});
  await material(s,p.id,{name:'current-reference.txt',text:'预算为 73921.50。NAMED_SOURCE_CANARY'});
  const calls=[];
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    assert.equal(new URL(url).hostname,'api.anthropic.com');calls.push(JSON.parse(options.body));
    return new Response('data: '+JSON.stringify({type:'content_block_delta',delta:{type:'text_delta',text:'Answer'}})+'\n\ndata: '+JSON.stringify({type:'message_stop'})+'\n\n');
  });
  const request=new Request('https://api.pickandcase.com/',{method:'POST',body:JSON.stringify({user:'tester',password:pass,model:'claude-sonnet-5-5',projectId:p.id,effort:'low',maxOutputTokens:100,chat:{scope:p.id,question:'current-reference.txt 的预算是多少？',history:[],incognito:true,readingMode:'retrieve',skills:{mode:'off',ids:[]}}})});
  const output=await(await worker.fetch(request,s.env)).text();assert.ok(output.includes('Answer'));assert.equal(calls.length,1);assert.ok(JSON.stringify(calls[0]).includes('NAMED_SOURCE_CANARY'));
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

// OCR fixtures stay offline; no paid provider is contacted by these tests.
const ocrPDF = Buffer.from('%PDF-1.7\nsynthetic page').toString('base64');
function ocrReply(result = {kind:'text',text:'DM6 清水箱 25 L，污水箱 28 L，电池 24 V。',warning:''}, extra = {}) {
  return Response.json({status:'completed',service_tier:'default',usage:{input_tokens:71,output_tokens:32},output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(result)}]}],...extra});
}
async function ocrSource(s) {
  const p=(await s.api('create',{name:'OCR source'})).project;
  const f=await material(s,p.id,{name:'scan.pdf',text:'native footer',coverage:{units:2,emptyUnits:1}});
  const repair=await s.api('library_reparse',{projectId:p.id,fileId:f.id});
  return {projectId:p.id,fileId:f.id,generation:repair.generation,page:2,total:2,data:ocrPDF,mime:'application/pdf'};
}
test('Sol OCR uses the official PDF input and records usage once; completed pages are cached and private',async t=>{
  const s=setup(t),input=await ocrSource(s);s.env.OPENAI_API_KEY='synthetic-openai-key';let calls=0;
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    assert.equal(url,'https://api.openai.com/v1/responses');const body=JSON.parse(options.body);
    assert.equal(body.model,'gpt-6.1-sol');assert.equal(body.store,false);assert.equal(body.reasoning.effort,'low');assert.equal(body.text.format.type,'json_schema');
    const pdf=body.input[1].content[1];assert.equal(pdf.type,'input_file');assert.equal(pdf.detail,'high');assert.ok(pdf.file_data.startsWith('data:application/pdf;base64,'));calls++;return ocrReply();
  });
  const first=await s.api('library_ocr_page',input),second=await s.api('library_ocr_page',input);
  assert.equal(first.model,'gpt-6.1-sol');assert.match(first.text,/25 L/);assert.equal(second.cached,true);assert.equal(calls,1);
  const usage=await usageSummary(s.env,'tester');assert.equal(usage.total.calls,1);assert.equal(usage.total.input,71);assert.equal(usage.total.output,32);
  const other=(await s.api('create',{name:'Other scope'})).project;
  await assert.rejects(s.api('library_ocr_page',{...input,projectId:other.id}),e=>e.status===404);
  await assert.rejects(s.api('library_ocr_page',{...input,username:'another'}),e=>e.status===404);assert.equal(calls,1);
});
test('concurrent requests for the same OCR page share one paid operation',async t=>{
  const s=setup(t),input=await ocrSource(s);s.env.OPENAI_API_KEY='synthetic-openai-key';let release,entered,calls=0;
  const started=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
  t.mock.method(globalThis,'fetch',async()=>{calls++;entered();await gate;return ocrReply();});
  const first=s.api('library_ocr_page',input);await started;const second=s.api('library_ocr_page',input);release();
  const result=await Promise.all([first,second]);assert.equal(calls,1);assert.equal(result[0].text,result[1].text);
});
test('an incomplete OCR response is never accepted as complete and can be retried without repeating other pages',async t=>{
  const s=setup(t),input=await ocrSource(s);s.env.OPENAI_API_KEY='synthetic-openai-key';let calls=0;
  t.mock.method(globalThis,'fetch',async()=>++calls===1?ocrReply(undefined,{status:'incomplete',incomplete_details:{reason:'max_output_tokens'}}):ocrReply());
  await assert.rejects(s.api('library_ocr_page',input),e=>e.status===422);
  await s.api('library_ocr_page',{...input,retry:true});await s.api('library_ocr_page',input);assert.equal(calls,2);
});
test('repair replaces the index atomically, preserves old text on failure, and rejects stale generations',async t=>{
  const s=setup(t),input=await ocrSource(s),base={projectId:input.projectId,fileId:input.fileId};
  await s.api('library_segments',{...base,generation:input.generation,segments:[{ordinal:0,text:'new text FIRST_NEW',location:'第 1 页'}]});
  assert.match((await s.api('preview',base)).file.text,/native footer/);
  await s.api('library_parse_failed',{...base,generation:input.generation,error:'synthetic interrupt'});
  assert.equal((await s.api('preview',base)).file.status,'partial');assert.match((await s.api('preview',base)).file.text,/native footer/);
  const a=await s.api('library_reparse',base),b=await s.api('library_reparse',base);
  await assert.rejects(s.api('library_segments',{...base,generation:a.generation,segments:[{ordinal:0,text:'stale'}]}),e=>e.status===409);
  await assert.rejects(s.api('library_commit',{...base,generation:a.generation,segments:1}),e=>e.status===409);
  await s.api('library_segments',{...base,generation:b.generation,segments:[{ordinal:0,text:'final recognized FRESH_CANARY',location:'第 2 页 · Sol 视觉识别'}]});
  const result=await s.api('library_commit',{...base,generation:b.generation,segments:1,coverage:{units:2,emptyUnits:0}});assert.equal(result.file.status,'ready');
  const preview=(await s.api('preview',base)).file.text;assert.match(preview,/FRESH_CANARY/);assert.doesNotMatch(preview,/native footer|FIRST_NEW/);
  assert.equal((await projectLibrary(s.env,'tester',base.projectId,'search',{query:'FRESH_CANARY'})).hits.length,1);
  assert.equal((await projectLibrary(s.env,'tester',base.projectId,'search',{query:'footer'})).hits.length,0);
  await assert.rejects(s.api('library_commit',{...base,generation:a.generation,segments:1}),e=>e.status===409);
});
test('invalid OCR pages and missing OpenAI configuration fail before provider access',async t=>{
  const s=setup(t),input=await ocrSource(s);let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;throw Error('must not reach provider');});
  await assert.rejects(s.api('library_ocr_page',{...input,page:3}),e=>e.status===400);
  await assert.rejects(s.api('library_ocr_page',{...input,data:'not-base64'}),e=>e.status===400);
  await assert.rejects(s.api('library_ocr_page',input),e=>e.status===503);assert.equal(calls,0);
});
test('hybrid PDF extraction keeps native text, recognizes scans and image-heavy pages, and verifies blank pages',async()=>{
  const priorPDF=globalThis.pdfjsLib,priorLib=globalThis.PDFLib;
  globalThis.pdfjsLib={GlobalWorkerOptions:{},OPS:{paintImageXObject:8},getDocument:()=>({promise:Promise.resolve({numPages:4,getPage:async n=>({getTextContent:async()=>({items:n===1?[{str:'Native selectable body '.repeat(10)}]:n===3?[{str:'Footer'}]:[]}),getOperatorList:async()=>({fnArray:[8]}),cleanup(){}}),destroy:async()=>{}})})};
  globalThis.PDFLib={PDFDocument:{load:async()=>({getPageCount:()=>4}),create:async()=>({copyPages:async(_,pages)=>pages,addPage(){},save:async()=>new TextEncoder().encode('%PDF-1.7 synthetic one-page PDF')})}};
  try{
    const calls=[],segments=[];
    const result=await Files.parseInWorker(new File(['%PDF-original'],'hybrid.pdf'),async batch=>segments.push(...batch),null,{ocr:async task=>{calls.push(task.page);return task.page===4?{kind:'blank',text:'',warning:''}:{kind:'text',text:'Recognized page '+task.page+' DM6 25L',warning:''};}});
    assert.deepEqual(calls,[2,3,4]);assert.equal(result.coverage.emptyUnits,0);assert.equal(result.coverage.ocrPages,3);assert.equal(result.coverage.blankUnits,1);
    assert.ok(segments.some(s=>s.location==='第 1 页'));assert.ok(segments.some(s=>s.location==='第 2 页 · Sol 视觉识别'));assert.ok(segments.some(s=>s.location==='第 3 页 · Sol 视觉识别'));
    assert.deepEqual(segments.map(s=>s.ordinal),segments.map((_,i)=>i));
  }finally{globalThis.pdfjsLib=priorPDF;globalThis.PDFLib=priorLib;}
});
test('OCR stops at an interrupted page and retains its successfully indexed prefix for safe continuation',async()=>{
  const priorPDF=globalThis.pdfjsLib,priorLib=globalThis.PDFLib;
  globalThis.pdfjsLib={GlobalWorkerOptions:{},getDocument:()=>({promise:Promise.resolve({numPages:3,getPage:async()=>({getTextContent:async()=>({items:[]}),cleanup(){}}),destroy:async()=>{}})})};
  globalThis.PDFLib={PDFDocument:{load:async()=>({getPageCount:()=>3}),create:async()=>({copyPages:async(_,pages)=>pages,addPage(){},save:async()=>new TextEncoder().encode('%PDF-1.7 synthetic page')})}};
  try{
    const calls=[],batches=[];const result=await Files.parseInWorker(new File(['%PDF-original'],'scan.pdf'),async b=>batches.push(...b),null,{ocr:async task=>{calls.push(task.page);if(task.page===2)throw Error('synthetic disconnect');return {kind:'text',text:'Page one OCR',warning:''};}});
    assert.deepEqual(calls,[1,2]);assert.equal(result.coverage.emptyUnits,2);assert.match(result.coverage.ocrError,/disconnect/);assert.equal(batches.length,1);assert.equal(batches[0].ordinal,0);
  }finally{globalThis.pdfjsLib=priorPDF;globalThis.PDFLib=priorLib;}
});
test('uncertain OCR results remain partial; an explicit retry can improve only the uncertain cached page',async t=>{
  const s=setup(t),input=await ocrSource(s);s.env.OPENAI_API_KEY='synthetic-openai-key';let calls=0;
  t.mock.method(globalThis,'fetch',async()=>++calls===1?ocrReply({kind:'text',text:'Tank [无法辨认]',warning:'表格第二列不清晰'}):ocrReply());
  const uncertain=await s.api('library_ocr_page',input);assert.equal(uncertain.uncertain,true);await s.api('library_ocr_page',input);assert.equal(calls,1);
  await s.api('library_segments',{...input,segments:[{ordinal:0,text:uncertain.text,location:'第 2 页'}]});
  const partial=await s.api('library_commit',{...input,segments:1,coverage:{units:2,emptyUnits:0,uncertainUnits:1}});assert.equal(partial.file.status,'partial');
  const repair=await s.api('library_reparse',input),fresh=await s.api('library_ocr_page',{...input,generation:repair.generation,retry:true});assert.equal(fresh.uncertain,false);assert.equal(calls,2);
  await s.api('library_segments',{...input,generation:repair.generation,segments:[{ordinal:0,text:fresh.text,location:'第 2 页'}]});
  const ready=await s.api('library_commit',{...input,generation:repair.generation,segments:1,coverage:{units:2,emptyUnits:0,uncertainUnits:0}});assert.equal(ready.file.status,'ready');assert.equal(ready.file.ocrModel,'gpt-6.1-sol');
});
test('malformed, refused and contradictory blank OCR outputs never become completed pages',async t=>{
  const s=setup(t),input=await ocrSource(s);s.env.OPENAI_API_KEY='synthetic-openai-key';let calls=0;
  t.mock.method(globalThis,'fetch',async()=>{
    calls++;if(calls===1)return ocrReply({kind:'blank',text:'actual source words',warning:''});
    if(calls===2)return ocrReply(undefined,{output:[{content:[{type:'refusal',refusal:'synthetic refusal'}]}]});
    return ocrReply(undefined,{output:[{content:[{type:'output_text',text:'{"kind":'}]}]});
  });
  for(let n=0;n<3;n++)await assert.rejects(s.api('library_ocr_page',{...input,retry:true}),e=>e.status===422);
  const preview=await s.api('preview',input);assert.equal(preview.file.status,'indexing');assert.equal(calls,3);
});
