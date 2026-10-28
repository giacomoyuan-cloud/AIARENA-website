const test=require('node:test');
const assert=require('node:assert/strict');
const {create}=require('./arena-chat-runs.js');
const enc=new TextEncoder();
const payload={user:'synthetic-user',password:'synthetic-hash',projectId:null,chat:{chatId:'chat-fixture'}};
const event=(id,data)=>'id: '+id+'\ndata: '+(typeof data==='string'?data:JSON.stringify(data))+'\n\n';
const stream=frames=>new Response(frames.join(''),{headers:{'Content-Type':'text/event-stream'}});
const until=async check=>{for(let i=0;i<200;i++){if(check())return;await new Promise(r=>setTimeout(r,5));}throw new Error('fixture timed out');};

test('network interruption resumes the same generation and discards replayed event IDs',async()=>{
  const calls=[];let eventCalls=0;
  const client=create({makeId:()=> 'stable-request-id',fetch:async(url,options)=>{
    const body=JSON.parse(options.body);calls.push(body);
    if(body.action==='start')return Response.json({runId:body.runId,status:'running'});
    if(body.action==='events'&&eventCalls++===0){let count=0;return new Response(new ReadableStream({pull(controller){
      if(count++===0)controller.enqueue(enc.encode(event(1,{t:'第一段'})));else controller.error(new TypeError('Load failed'));
    }}));}
    return stream([event(1,{t:'第一段'}),event(2,{t:'第二段'}),event(3,'[DONE]')]);
  }});
  const text=await(await client.open('https://example.test',payload)).text();
  assert.equal((text.match(/第一段/g)||[]).length,1);assert.ok(text.includes('第二段'));assert.ok(text.includes('[DONE]'));
  assert.equal(calls.filter(x=>x.action==='start').length,1);assert.equal(calls.filter(x=>x.action==='events')[1].after,1);
  assert.ok(!calls.some(x=>x.action==='stop'));
});

test('a lost start acknowledgement retries with the same idempotency key',async()=>{
  const starts=[];
  const client=create({makeId:()=> 'stable-ack-id',fetch:async(url,options)=>{
    const body=JSON.parse(options.body);
    if(body.action==='start'){
      starts.push(body);
      if(starts.length===1)return new Response(new ReadableStream({start(controller){controller.error(new TypeError('Load failed'));}}));
      return Response.json({status:'running'});
    }
    return stream([event(1,{t:'只生成一次'}),event(2,'[DONE]')]);
  }});
  assert.ok((await(await client.open('https://example.test',payload)).text()).includes('只生成一次'));
  assert.equal(starts.length,2);assert.deepEqual(starts[0],starts[1]);
});

test('hiding and resuming the page only reconnects its observer',async()=>{
  const doc=new EventTarget();doc.hidden=false;const calls=[];let firstController;
  const client=create({document:doc,makeId:()=> 'background-id',fetch:async(url,options)=>{
    const body=JSON.parse(options.body);calls.push(body);
    if(body.action==='start')return Response.json({status:'running'});
    if(calls.filter(x=>x.action==='events').length===1)return new Response(new ReadableStream({start(controller){firstController=controller;controller.enqueue(enc.encode(event(1,{t:'前半段'})));options.signal.addEventListener('abort',()=>{try{controller.error(new DOMException('hidden','AbortError'));}catch{}});}}));
    return stream([event(2,{t:'后台生成的后半段'}),event(3,'[DONE]')]);
  }});
  const response=await client.open('https://example.test',payload),result=response.text();
  await until(()=>!!firstController);
  doc.hidden=true;doc.dispatchEvent(new Event('visibilitychange'));
  await new Promise(r=>setTimeout(r,20));
  assert.equal(calls.filter(x=>x.action==='events').length,1);
  doc.hidden=false;doc.dispatchEvent(new Event('visibilitychange'));
  const text=await result;assert.ok(text.includes('后台生成的后半段'));
  assert.equal(calls.filter(x=>x.action==='start').length,1);assert.ok(!calls.some(x=>x.action==='stop'));
});

test('an explicit user stop sends cancellation, but cancelling a reader alone does not',async()=>{
  const calls=[];let observer;
  const client=create({makeId:()=> 'stop-id',fetch:async(url,options)=>{
    const body=JSON.parse(options.body);calls.push(body);
    if(body.action!=='events')return Response.json({status:body.action==='start'?'running':'cancelled'});
    return new Response(new ReadableStream({start(controller){observer=controller;options.signal.addEventListener('abort',()=>{try{controller.error(new DOMException('stopped','AbortError'));}catch{}});}}));
  }});
  const controller=new AbortController(),response=await client.open('https://example.test',payload,{signal:controller.signal});
  const result=response.text();await until(()=>!!observer);controller.abort();
  await assert.rejects(result,/已停止/);assert.equal(calls.filter(x=>x.action==='stop').length,1);
  calls.length=0;observer=null;
  const another=await client.open('https://example.test',payload);await until(()=>!!observer);
  await another.body.cancel();assert.ok(!calls.some(x=>x.action==='stop'));
});

test('auth errors are returned without starting recovery loops or provider retries',async()=>{
  let calls=0;
  const client=create({fetch:async()=>{calls++;return Response.json({error:'请先登录账号'},{status:401});}});
  const response=await client.open('https://example.test',payload);
  assert.equal(response.status,401);assert.equal(calls,1);
});

test('a reloaded chat follows saved progress without submitting the original question again',async()=>{
  const calls=[],snapshots=[];
  const client=create({fetch:async(url,options)=>{
    const body=JSON.parse(options.body);calls.push(body);
    return Response.json({status:calls.length===1?'running':'completed',reply:{text:calls.length===1?'已完成一半':'完整回答'}});
  }});
  await client.watch('https://example.test',{user:'synthetic-user',password:'synthetic-hash',runId:'reload-id',chatId:'chat-fixture'},{onSnapshot:s=>snapshots.push(s)});
  assert.deepEqual(snapshots.map(x=>x.reply.text),['已完成一半','完整回答']);
  assert.ok(calls.every(x=>x.action==='status'));assert.ok(calls.every(x=>!x.payload));
});
