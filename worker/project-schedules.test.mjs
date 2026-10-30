import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {setImmediate} from 'node:timers/promises';
import {createChatRunClass} from './chat-runs.js';
import {createScheduledChatClient} from './scheduled-chat.js';
import {ChatRun as IntegratedChatRun,ProjectScheduler as IntegratedScheduler} from './worker.js';
import {createProjectScheduler,nextOccurrence,validateSchedule} from './project-schedules.js';
test('daily, weekday, weekly, and one-time schedules use the selected time zone',()=>{
  const from=Date.parse('2026-10-30T01:00:00Z');
  assert.equal(new Date(nextOccurrence({frequency:'daily',time:'08:00',timeZone:'Asia/Shanghai'},from)).toISOString(),'2026-10-31T00:00:00.000Z');
  assert.equal(new Date(nextOccurrence({frequency:'weekdays',time:'08:00',timeZone:'Asia/Shanghai'},from)).toISOString(),'2026-11-02T00:00:00.000Z');
  assert.equal(new Date(nextOccurrence({frequency:'weekly',day:5,time:'16:00',timeZone:'Asia/Shanghai'},from)).toISOString(),'2026-10-30T08:00:00.000Z');
  assert.equal(nextOccurrence({frequency:'once',at:'2026-10-29T00:00:00Z'},from),null);
  assert.throws(()=>validateSchedule({frequency:'daily',time:'27:00'}));assert.throws(()=>validateSchedule({frequency:'daily',time:'08:00',timeZone:'invalid-zone'}));
});
test('nonexistent daylight-saving times are skipped',()=>{
  const stamp=nextOccurrence({frequency:'daily',time:'02:30',timeZone:'America/New_York'},Date.parse('2026-03-08T00:00:00Z'));
  assert.equal(new Date(stamp).toISOString(),'2026-03-09T06:30:00.000Z');
});
function setup({execute,project,deferStart=()=>false,integrated=false}={}){
  const saved=new Map(),kvData=new Map(),objects=new Map(),pending=[],databases=[];let alarm=null,calls=0;
  const storage={get:async k=>structuredClone(saved.get(k)),put:async(k,v)=>{if(typeof k==='object'){for(const [key,value] of Object.entries(k))saved.set(key,structuredClone(value));}else saved.set(k,structuredClone(v));},
    list:async({prefix,reverse,limit,end})=>new Map([...saved].filter(([key])=>key.startsWith(prefix)&&(!end||key<end)).sort(([a],[b])=>reverse?b.localeCompare(a):a.localeCompare(b)).slice(0,limit)),
    setAlarm:async t=>{alarm=t;},deleteAlarm:async()=>{alarm=null;}};
  const ctx={storage,blockConcurrencyWhile:fn=>fn()},env={BIZ_KV:{get:async k=>kvData.get(k)||null,put:async(k,v)=>kvData.set(k,v)}};
  const Run=integrated?IntegratedChatRun:createChatRunClass(async(...args)=>{calls++;return execute?execute(...args):new Response('data: {"t":"offline fixture"}\n\ndata: [DONE]\n\n');},null,{deferStart});
  env.CHAT_RUNS={idFromName:name=>name,get(id){if(!objects.has(id)){
    const db=new DatabaseSync(':memory:');databases.push(db);
    const state={storage:{sql:{exec(sql,...values){const q=db.prepare(sql),rows=q.columns().length?q.all(...values):(q.run(...values),[]);return {toArray:()=>rows};}},
      transactionSync(fn){db.exec('BEGIN');try{const r=fn();db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}},setAlarm:async()=>{}},waitUntil:p=>pending.push(p)};
    objects.set(id,new Run(state,env));
  }return {fetch:request=>objects.get(id).fetch(request)};}};
  const runs=createScheduledChatClient({models:{'model-test':{name:'Fixture',provider:'anthropic'}},credentials:async()=>({user:'one',password:'TRANSIENT_SECRET'})});
  const Class=integrated?IntegratedScheduler:createProjectScheduler({models:['model-test'],project:project||(async()=>{}),runs});
  const actor=new Class(ctx,env);
  const call=async body=>{const r=await actor.fetch(new Request('https://internal.invalid/',{method:'POST',body:JSON.stringify({user:'one',...body})}));return {status:r.status,...await r.json()};};
  const task={action:'create',id:'task-123456',name:'日报',prompt:'生成日报',model:'model-test',projectId:'project-123456',schedule:{frequency:'daily',time:'08:00',timeZone:'Asia/Shanghai'}};
  const finish=async(target=actor)=>{await Promise.all(pending);await target.alarm();};
  return {actor,call,task,saved,storage,kvData,ctx,env,Class,runs,objects,pending,finish,databases,get calls(){return calls;},get alarm(){return alarm;}};
}
test('alarms execute without a browser, save a scoped result, and keep credentials out of persisted state',async()=>{
  const f=setup();assert.equal((await f.call(f.task)).status,200);assert.ok(f.alarm>Date.now());
  await f.call({action:'run',id:f.task.id});await f.actor.alarm();await f.finish();
  const task=(await f.call({action:'list'})).tasks[0];assert.equal(task.status,'completed');assert.equal(f.calls,1);assert.equal(task.history.length,1);
  assert.equal(JSON.parse(f.kvData.get('project:one:project-123456:chats:'+task.chatId))[1].text,'offline fixture');
  assert.ok(!JSON.stringify([...f.saved.values()]).includes('TRANSIENT_SECRET'));
  await f.actor.alarm();assert.equal(f.calls,1);
});
test('failure retains partial output and does not immediately retry a paid request',async()=>{
  const f=setup({execute:async()=>new Response('data: {"t":"部分结果"}\n\ndata: {"error":"合成失败"}\n\ndata: [DONE]\n\n')});
  await f.call(f.task);await f.call({action:'run',id:f.task.id});await f.actor.alarm();await f.finish();await f.actor.alarm();
  const t=(await f.call({action:'list'})).tasks[0];assert.equal(t.status,'failed');assert.equal(f.calls,1);assert.equal(t.error,'合成失败');assert.match(JSON.parse(f.kvData.get('project:one:project-123456:chats:'+t.chatId))[1].text,/部分结果/);
});
test('pause, resume, edit and delete persist and creation retries do not duplicate tasks',async()=>{
  const f=setup();await f.call(f.task);await f.call(f.task);assert.equal((await f.call({action:'list'})).tasks.length,1);
  await f.call({action:'toggle',id:f.task.id,enabled:false});assert.equal(f.alarm,null);await f.actor.alarm();assert.equal(f.calls,0);
  await f.call({...f.task,action:'update',name:'新任务'});assert.equal((await f.call({action:'list'})).tasks[0].name,'新任务');
  await f.call({action:'toggle',id:f.task.id,enabled:true});assert.ok(f.alarm);
  await f.call({action:'delete',id:f.task.id});assert.equal(f.alarm,null);assert.equal((await f.call({action:'list'})).tasks.length,0);
});
test('a process restart marks an unfinished execution interrupted without calling the provider',async()=>{
  const f=setup();await f.call(f.task);const data=f.saved.get('tasks');data[0].status='running';data[0].lastRunAt=Date.now();f.saved.set('tasks',data);
  const restarted=new f.Class(f.ctx,f.env);await restarted.ready;
  assert.equal(f.saved.get('tasks')[0].status,'failed');assert.equal(f.calls,0);
});
test('missing ownership prevents execution before any model request',async()=>{
  let archived=false;const f=setup({project:async()=>{if(archived)throw Object.assign(Error('项目已归档'),{status:404});}});
  await f.call(f.task);await f.call({action:'run',id:f.task.id});archived=true;await f.actor.alarm();
  assert.equal(f.calls,0);assert.equal(f.saved.get('tasks')[0].status,'failed');
});

async function until(predicate){for(let i=0;i<200&&!predicate();i++)await setImmediate();assert.ok(predicate(),'fixture did not settle');}
const request=body=>new Request('https://internal.invalid/',{method:'POST',body:JSON.stringify({user:'one',...body})});

test('alarm returns before generation completes, and thinking survives 16 minutes and a scheduler restart',async t=>{
  t.mock.timers.enable({apis:['Date','setTimeout'],now:1800000000000});
  let stream,aborted=false;
  const f=setup({deferStart:()=>true,execute:async req=>{
    const input=await req.json();assert.equal(input.noAutomaticRetry,true);assert.equal(input.model,'model-test');
    req.signal.addEventListener('abort',()=>{aborted=true;});
    return new Response(new ReadableStream({start(controller){stream=controller;}}));
  }});
  await f.call(f.task);await f.call({action:'run',id:f.task.id});await f.actor.alarm();await until(()=>!!stream);
  stream.enqueue(new TextEncoder().encode('data: {"r":"thinking checkpoint"}\n\n'));
  await until(()=>[...f.objects.values()][0].meta.reply.reasoning==='thinking checkpoint');
  t.mock.timers.tick(16*60*1000);
  assert.equal(aborted,false);assert.equal(f.saved.get('tasks')[0].status,'running');assert.equal(f.calls,1);
  const restarted=new f.Class(f.ctx,f.env);await restarted.ready;await restarted.alarm();assert.equal(f.calls,1);
  stream.enqueue(new TextEncoder().encode('data: {"t":"complete original body"}\n\ndata: [DONE]\n\n'));stream.close();
  await f.finish(restarted);
  const task=f.saved.get('tasks')[0];assert.equal(task.status,'completed');assert.equal(f.calls,1);
  assert.equal(JSON.parse(f.kvData.get('project:one:project-123456:chats:'+task.chatId))[1].text,'complete original body');
});

test('manual retry retains the old event journal, partial reasoning, result and receipt separately',async()=>{
  let attempt=0;
  const f=setup({execute:async()=>new Response(++attempt===1?'data: {"r":"old reasoning"}\n\ndata: {"t":"old partial body"}\n\ndata: {"error":"fixture interruption"}\n\ndata: [DONE]\n\n':'data: {"t":"new complete body"}\n\ndata: [DONE]\n\n')});
  await f.call(f.task);await f.call({action:'run',id:f.task.id,operationId:'operation-first'});await f.actor.alarm();await f.finish();
  const first=structuredClone(f.saved.get('tasks')[0].history[0]),key='project:one:project-123456:chats:'+first.chatId,before=f.kvData.get(key);
  const read=()=>f.actor.fetch(request({action:'events',id:f.task.id,runId:first.runId}));
  const originalReceipt=structuredClone(f.saved.get('run:'+f.task.id+':'+first.runId));
  const oldLog=await(await read()).text();assert.match(oldLog,/old reasoning/);assert.match(oldLog,/fixture interruption/);
  await f.call({action:'run',id:f.task.id,operationId:'operation-retry'});await f.actor.alarm();await f.finish();
  const current=f.saved.get('tasks')[0];assert.equal(current.status,'completed');assert.notEqual(current.chatId,first.chatId);assert.notEqual(current.history[0].runId,first.runId);
  assert.equal(f.kvData.get(key),before);assert.equal(await(await read()).text(),oldLog);
  await f.call({...f.task,action:'update',projectId:'project-newscope'});assert.equal(await(await read()).text(),oldLog);
  assert.deepEqual(f.saved.get('run:'+f.task.id+':'+first.runId),originalReceipt);assert.equal(f.calls,2);
  assert.ok(!JSON.stringify([...f.saved.values()]).includes('TRANSIENT_SECRET'));
  for(const db of f.databases)assert.ok(!JSON.stringify(db.prepare('SELECT value FROM run_meta').all()).includes('TRANSIENT_SECRET'));
});

test('replayed manual operation IDs cannot enqueue extra paid attempts, even after another retry',async()=>{
  const f=setup();await f.call(f.task);
  const run=id=>f.call({action:'run',id:f.task.id,operationId:id});
  await run('operation-first');await run('operation-first');await f.actor.alarm();await f.finish();
  await run('operation-first');await f.actor.alarm();assert.equal(f.calls,1);
  await run('operation-second');await f.actor.alarm();await f.finish();
  await run('operation-first');await f.actor.alarm();assert.equal(f.calls,2);
});

test('lost enqueue acknowledgement reconnects to the original run after restart without resubmitting',async()=>{
  const f=setup(),start=f.runs.start;let submissions=0;
  f.runs.start=async(...args)=>{submissions++;await start(...args);throw Object.assign(Error('lost acknowledgement'),{status:503});};
  await f.call(f.task);await f.call({action:'run',id:f.task.id});await f.actor.alarm();await Promise.all(f.pending);
  const restarted=new f.Class(f.ctx,f.env);await restarted.ready;await restarted.alarm();
  assert.equal(f.saved.get('tasks')[0].status,'completed');assert.equal(f.calls,1);assert.equal(submissions,1);
});

test('a history write failure stops dispatch before any provider request and preserves the prior attempt',async()=>{
  const f=setup();await f.call(f.task);await f.call({action:'run',id:f.task.id});
  const put=f.storage.put;f.storage.put=async(k,v)=>{if(typeof k==='object'&&Object.keys(k).some(key=>key.startsWith('run:')))throw Error('fixture disk failure');return put(k,v);};
  await assert.rejects(f.actor.alarm(),/fixture disk failure/);assert.equal(f.calls,0);assert.equal(f.saved.get('tasks')[0].queued,true);
  f.storage.put=put;await f.actor.alarm();await f.finish();assert.equal(f.calls,1);
});

test('transient polling and terminal history save failures do not start another model',async()=>{
  const f=setup();await f.call(f.task);await f.call({action:'run',id:f.task.id});await f.actor.alarm();await Promise.all(f.pending);
  const status=f.runs.status;f.runs.status=async()=>{throw Object.assign(Error('temporary read outage'),{status:503});};
  await f.actor.alarm();assert.equal(f.saved.get('tasks')[0].status,'running');assert.equal(f.calls,1);f.runs.status=status;
  const put=f.storage.put;f.storage.put=async(k,v)=>{if(typeof k==='object')throw Error('fixture disk failure');return put(k,v);};
  await assert.rejects(f.actor.alarm(),/fixture disk failure/);assert.equal(f.actor.tasks[0].status,'running');assert.equal(f.calls,1);
  f.storage.put=put;await f.actor.alarm();assert.equal(f.saved.get('tasks')[0].status,'completed');assert.equal(f.calls,1);
});

test('history keeps attempts beyond the 20-item display cache, paginates them, and preserves original instructions after edits',async()=>{
  const f=setup();await f.call(f.task);
  for(let i=0;i<25;i++){await f.call({action:'run',id:f.task.id,operationId:'operation-'+String(i).padStart(6,'0')});await f.actor.alarm();await f.finish();}
  const first=await f.call({action:'history',id:f.task.id});assert.equal(first.runs.length,20);assert.ok(first.next);
  const second=await f.call({action:'history',id:f.task.id,after:first.next});assert.equal(second.runs.length,5);assert.equal(second.next,null);
  const all=first.runs.concat(second.runs);assert.equal(new Set(all.map(r=>r.runId)).size,25);assert.equal(f.saved.get('tasks')[0].history.length,20);
  await f.call({...f.task,action:'update',prompt:'new instructions'});
  assert.ok((await f.call({action:'history',id:f.task.id})).runs.every(run=>run.prompt==='生成日报'));assert.equal(f.calls,25);
  assert.equal((await f.call({action:'history',id:f.task.id,user:'another'})).status,404);
  assert.equal((await f.call({action:'history',id:f.task.id,after:'attempt:other-task:'})).status,400);
});

test('a thinking-only response is recorded as failure and is never silently retried',async()=>{
  const f=setup({execute:async()=>new Response('data: {"r":"only received reasoning"}\n\ndata: [DONE]\n\n')});
  await f.call(f.task);await f.call({action:'run',id:f.task.id});await f.actor.alarm();await f.finish();
  const task=f.saved.get('tasks')[0];assert.equal(task.status,'failed');assert.match(task.error,/未返回正文/);assert.equal(f.calls,1);
  assert.equal(JSON.parse(f.kvData.get('project:one:project-123456:chats:'+task.chatId))[1].reasoning,'only received reasoning');
});

test('legacy history is retained on first new run and is not lost to the recent-record cache',async()=>{
  const f=setup();await f.call(f.task);
  const task=f.actor.tasks[0];task.history=Array.from({length:20},(_,i)=>({at:Date.now()-100000-i,status:'failed',chatId:'scheduled-legacy-'+i,error:'legacy failure '+i}));await f.actor.persist();
  await f.call({action:'run',id:f.task.id});await f.actor.alarm();await f.finish();
  const page=await f.call({action:'history',id:f.task.id}),next=await f.call({action:'history',id:f.task.id,after:page.next});
  assert.equal(page.runs.length+next.runs.length,21);assert.ok(page.runs.concat(next.runs).some(row=>row.error==='legacy failure 19'));
  assert.equal(f.calls,1);
});

test('Stop retains received output and does not enqueue a replacement',async()=>{
  let stream;
  const f=setup({execute:async req=>new Response(new ReadableStream({start(controller){stream=controller;req.signal.addEventListener('abort',()=>controller.error(new DOMException('stopped','AbortError')));}}))});
  await f.call(f.task);await f.call({action:'run',id:f.task.id});await f.actor.alarm();await until(()=>!!stream);
  stream.enqueue(new TextEncoder().encode('data: {"t":"received before Stop"}\n\n'));await until(()=>[...f.objects.values()][0].meta.reply.text.length>0);
  assert.equal((await f.call({action:'stop',id:f.task.id})).status,200);await f.finish();
  const task=f.saved.get('tasks')[0];assert.equal(task.status,'cancelled');assert.equal(f.calls,1);assert.equal((await f.call({action:'stop',id:f.task.id})).status,200);
  assert.match(JSON.parse(f.kvData.get('project:one:project-123456:chats:'+task.chatId))[1].text,/received before Stop/);
});

test('exported Worker scheduler is wired to the real ChatRun journal and one mocked Opus request',async t=>{
  const f=setup({integrated:true}),requests=[];
  f.env.ANTHROPIC_API_KEY='OFFLINE_FIXTURE_ONLY';
  f.env.MEMORY_KV={get:async key=>key==='user:one'?JSON.stringify({hash:'FIXTURE_ACCOUNT_HASH'}):null,put:async()=>{}};
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    const payload=JSON.parse(options.body);requests.push({url:String(url),payload});
    assert.equal(String(url),'https://api.anthropic.com/v1/messages');assert.equal(payload.model,'claude-opus-5-5');
    return new Response('data: {"type":"message_start","message":{"usage":{"input_tokens":11,"output_tokens":0}}}\n\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"wired body"}}\n\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":3}}\n\ndata: {"type":"message_stop"}\n\n',{headers:{'request-id':'req_offline_wiring'}});
  });
  await f.call({...f.task,projectId:null,model:'claude-opus-5-5',prompt:'你好'});
  await f.call({action:'run',id:f.task.id,operationId:'integrated-run'});await f.actor.alarm();await f.finish();
  const task=f.saved.get('tasks')[0];assert.equal(task.status,'completed');assert.equal(requests.length,1);
  const messages=JSON.parse(f.kvData.get('chats:one:'+task.chatId));assert.equal(messages[1].text,'wired body');assert.equal(messages[1].usage.output,3);
  assert.equal(task.history[0].runId,messages[1].run.id);
  const logs=await(await f.actor.fetch(request({action:'events',id:task.id,runId:task.history[0].runId}))).text();assert.match(logs,/req_offline_wiring/);assert.match(logs,/wired body/);
});
