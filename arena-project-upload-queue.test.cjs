const test=require('node:test'),assert=require('node:assert/strict'),{create}=require('./arena-project-upload-queue.js');
const flush=()=>new Promise(setImmediate),context={owner:'synthetic',projectId:'project-001',credentials:{username:'synthetic',password:'synthetic'}};
const entries=()=>Array.from({length:5},(_,i)=>({file:new File(['native source'],'file-'+i+'.txt'),path:'file-'+i+'.txt'}));
test('slow recognition does not serialize all file transfers and each file retains its own progress',async()=>{
 let release;const pending=new Promise(r=>release=r),started=[],processed=[];
 const q=create({isCurrent:()=>true,onChange(){},onComplete:async()=>{},upload:async o=>{started.push(o.file.name);o.progress({phase:'上传原文件',done:5,total:13});return {id:o.file.name,status:'indexing'};},recognize:async o=>{processed.push(o.file.name);await pending;return {id:o.file.name,status:'ready'};}});
 const batch=q.add(entries(),context);assert.equal(batch.length,5);await flush();await flush();assert.equal(started.length,5);assert.equal(processed.length,1);assert.ok(batch.every(i=>i.uploadPercent===100));assert.equal(batch.filter(i=>i.state==='waiting').length,4);
 release();for(let i=0;i<8;i++)await flush();assert.ok(batch.every(i=>i.state==='done'&&i.recognitionPercent===100));
});
test('one failed file does not block others; retry does not reupload its saved original',async()=>{
 let uploads=0,attempts=0;const q=create({isCurrent:()=>true,onChange(){},onComplete:async()=>{},upload:async()=>{uploads++;return {id:'source-'+uploads,status:'indexing'};},recognize:async o=>{if(o.file.name==='file-0.txt'&&!attempts++)throw Error('synthetic interrupted');return {status:'ready'};}});
 const items=q.add(entries(),context);for(let i=0;i<12;i++)await flush();assert.equal(items[0].state,'failed');assert.ok(items.slice(1).every(i=>i.state==='done'));q.act(items[0].id,'retry');for(let i=0;i<4;i++)await flush();assert.equal(items[0].state,'done');assert.equal(uploads,5);
});
test('changing accounts cannot start another recognition or publish completion to the new owner',async()=>{
 let current=true,release,calls=0,completed=0;const pending=new Promise(r=>release=r);
 const q=create({isCurrent:()=>current,onChange(){},onComplete:async()=>completed++,upload:async()=>{await pending;return {id:'original',status:'indexing'};},recognize:async()=>{calls++;return {status:'ready'};}});
 const items=q.add(entries(),context);current=false;release();for(let i=0;i<5;i++)await flush();assert.equal(calls,0);assert.equal(completed,0);assert.ok(items.every(i=>i.state==='paused'));
});

test('recognition pause waits for the current operation and resumes without another original transfer',async()=>{
 let release;const pending=new Promise(r=>release=r);let transfers=0,reads=0;
 const q=create({isCurrent:()=>true,onChange(){},onComplete:async()=>{},upload:async()=>{transfers++;return {id:'saved',status:'indexing'};},recognize:async o=>{reads++;if(reads===1){await pending;if(o.shouldPause())throw Object.assign(Error('paused'),{name:'AbortError'});}return {status:'ready'};}});
 const item=q.add(entries().slice(0,1),context)[0];await flush();q.act(item.id,'pause');assert.equal(item.state,'recognizing');release();await flush();assert.equal(item.state,'paused');q.act(item.id,'resume');await flush();assert.equal(item.state,'done');assert.equal(transfers,1);
});
test('a list refresh failure cannot turn a successfully indexed file into a failed recognition',async()=>{
 const q=create({isCurrent:()=>true,onChange(){},onComplete:async()=>{throw Error('refresh temporarily unavailable');},upload:async()=>({id:'saved',status:'indexing'}),recognize:async()=>({status:'ready'})});
 const item=q.add(entries().slice(0,1),context)[0];await flush();await flush();assert.equal(item.state,'done');assert.equal(item.recognitionPercent,100);
});

test('an unreadable model result retains upload completion and offers recognition retry',async()=>{
 const q=create({isCurrent:()=>true,onChange(){},onComplete:async()=>{},upload:async()=>({id:'saved',status:'indexing'}),recognize:async()=>({status:'unreadable',coverage:{emptyUnits:1,ocrError:'upstream unavailable'}})});
 const item=q.add(entries().slice(0,1),context)[0];await flush();await flush();assert.equal(item.state,'failed');assert.equal(item.uploadPercent,100);assert.equal(item.recognitionPercent<100,true);assert.match(item.error,/upstream/);
});
