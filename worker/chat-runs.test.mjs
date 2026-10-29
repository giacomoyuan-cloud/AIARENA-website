import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { setImmediate } from 'node:timers/promises';
import worker, { ChatRun } from './worker.js';

const pass = 'synthetic-account-hash';
const post = body => new Request('https://api.pickandcase.com/chat-runs', { method: 'POST', body: JSON.stringify(body) });
function storage() {
  const db = new DatabaseSync(':memory:');
  return { db, transactionSync(callback) {
    db.exec('BEGIN');
    try { const value = callback(); db.exec('COMMIT'); return value; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }, sql: { exec(query, ...values) {
    const statement = db.prepare(query);
    const rows = statement.columns().length ? statement.all(...values) : (statement.run(...values), []);
    return { toArray: () => rows };
  } }, setAlarm: async () => {} };
}
function setup(t, model = 'claude-opus-5-5') {
  const data = new Map([['user:tester', JSON.stringify({ hash: pass })], ['user:other', JSON.stringify({ hash: pass })]]);
  const kv = { get: async key => data.get(key) || null, put: async (key,value) => data.set(key,value), delete: async key => data.delete(key) };
  const objects = new Map(), pending = [], upstreams = [];
  const openai = model.startsWith('gpt-');
  const env = { BIZ_KV: kv, MEMORY_KV: kv, ANTHROPIC_API_KEY: 'synthetic-provider-key', OPENAI_API_KEY: 'synthetic-openai-key' };
  env.CHAT_RUNS = { idFromName: name => name, get: name => ({ fetch(request) {
    if (!objects.has(name)) {
      const store = storage(), context = { storage: store, waitUntil: promise => pending.push(promise) };
      objects.set(name, new ChatRun(context, env));
    }
    return objects.get(name).fetch(request);
  } }) };
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(new URL(url).hostname, openai ? 'api.openai.com' : 'api.anthropic.com');
    let control;
    const stream = new ReadableStream({ start(controller) { control = controller; } });
    const event = value => control.enqueue(new TextEncoder().encode('data: '+JSON.stringify(value)+'\n\n'));
    const request = { event, text(text) { event(openai ? {type:'response.output_text.delta',delta:text} : {type:'content_block_delta',delta:{type:'text_delta',text}}); }, end() { try { control.close(); } catch {} }, fail() { control.error(new Error('fixture interrupted')); }, aborted: false };
    options.signal.addEventListener('abort', () => { request.aborted = true; try { control.error(new DOMException('cancelled','AbortError')); } catch {} });
    upstreams.push(request);
    return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'request-id': 'req_offline_test' } });
  });
  const payload = { user:'tester',password:pass,model,projectId:null,chat:{scope:'general',chatId:'chat-test-001',question:'请写一段测试文字。',history:[],historyEndUid:null},recovery:{replyUid:2,userMessage:{uid:1,text:'请写一段测试文字。',name:'Tester'},title:'测试'} };
  const fields = { user:'tester',password:pass,chatId:payload.chat.chatId,runId:'run-test-001',projectId:null };
  async function call(action, extra={}) { return worker.fetch(post({...fields,action,...extra}),env); }
  async function waitFor(check) { for(let i=0;i<200;i++){if(check())return;await setImmediate();}throw new Error('fixture did not progress'); }
  return { env,data,objects,pending,upstreams,payload,fields,call,waitFor };
}

for (const model of ['gpt-6-astra','gpt-6.1-sol']) {
  test(model+' starts only in an alarm and resumes its stream without a second request',async t=>{
    const f=setup(t,model);
    assert.equal((await f.call('start',{payload:f.payload})).status,202);
    const actor=Array.from(f.objects.values())[0];
    assert.equal(f.upstreams.length,0);
    assert.ok(actor.pendingRun);
    assert.ok(!actor.sql.exec('SELECT value FROM run_meta').toArray()[0].value.includes(pass));
    assert.equal((await f.call('start',{payload:f.payload})).status,200);
    const executing=actor.alarm();await f.waitFor(()=>f.upstreams.length===1);
    await actor.alarm();assert.equal(f.upstreams.length,1);
    f.upstreams[0].text('第一段');await f.waitFor(()=>actor.meta.reply.text==='第一段');
    const first=await(await f.call('status')).json();
    const response=await f.call('events',{after:0}),reader=response.body.getReader();
    await reader.read();await reader.cancel();
    f.upstreams[0].text('第二段');f.upstreams[0].end();await executing;
    const resumed=await(await f.call('events',{after:first.sequence})).text();
    assert.ok(!resumed.includes('第一段'));assert.ok(resumed.includes('第二段'));
    assert.equal(actor.meta.status,'completed');
    await actor.alarm();assert.equal(f.upstreams.length,1);assert.equal(actor.meta.status,'completed');
    const saved=JSON.parse(f.data.get('chats:tester:chat-test-001'));
    assert.equal(saved[1].text,'第一段第二段');
    assert.ok(!JSON.stringify(saved).includes(pass));
  });
}

test('stopping OpenAI before its alarm finalizes the answer without a provider charge',async t=>{
  const f=setup(t,'gpt-6.1-sol');
  await f.call('start',{payload:f.payload});
  const actor=Array.from(f.objects.values())[0];
  const stopped=await(await f.call('stop')).json();assert.equal(stopped.status,'cancelled');
  await Promise.all(f.pending);await actor.alarm();
  assert.equal(f.upstreams.length,0);assert.equal(actor.pendingRun,null);
  assert.equal(JSON.parse(f.data.get('chats:tester:chat-test-001'))[1].run.status,'cancelled');
});

test('chat recovery preserves uploaded image previews using validated request bytes',async t=>{
  const f=setup(t),image={mime:'image/png',data:'aGVsbG8='};
  f.payload.images=[image];f.payload.recovery.userMessage.text+=' [img]';
  f.payload.recovery.userMessage.imgSrcs=['UNTRUSTED_RECOVERY_METADATA'];
  assert.equal((await f.call('start',{payload:f.payload})).status,202);
  await f.waitFor(()=>f.upstreams.length===1);f.upstreams[0].text('image answer');f.upstreams[0].end();await Promise.all(f.pending);
  const saved=JSON.parse(f.data.get('chats:tester:chat-test-001'));
  assert.deepEqual(saved[0].imgSrcs,['data:image/png;base64,'+image.data]);
  assert.ok(!JSON.stringify(saved).includes('UNTRUSTED_RECOVERY_METADATA'));
});

test('invalid chat image attachments are rejected before creating a run or calling a provider',async t=>{
  const f=setup(t);
  for(const images of [{data:'invalid'},[{data:'aGVsbG8=',mime:'image/svg+xml'}],Array.from({length:11},()=>({data:'aGVsbG8=',mime:'image/png'}))]){
    f.payload.images=images;assert.equal((await f.call('start',{payload:f.payload})).status,413);
  }
  assert.equal(f.objects.size,0);assert.equal(f.upstreams.length,0);
});

test('stopping an active OpenAI alarm cancels its upstream and retains the received text',async t=>{
  const f=setup(t,'gpt-6-astra');await f.call('start',{payload:f.payload});
  const actor=Array.from(f.objects.values())[0],executing=actor.alarm();
  await f.waitFor(()=>f.upstreams.length===1);f.upstreams[0].text('保留');
  await f.waitFor(()=>actor.meta.reply.text==='保留');await f.call('stop');await executing;
  assert.equal(f.upstreams[0].aborted,true);assert.equal(actor.meta.status,'cancelled');
  assert.equal(JSON.parse(f.data.get('chats:tester:chat-test-001'))[1].text,'保留');
});

test('a process restart before the OpenAI alarm preserves an interruption without replaying the paid request',async t=>{
  const f=setup(t,'gpt-6.1-sol');await f.call('start',{payload:f.payload});
  const actor=Array.from(f.objects.values())[0],restarted=new ChatRun(actor.ctx,f.env);
  await restarted.alarm();
  assert.equal(restarted.meta.status,'interrupted');assert.equal(f.upstreams.length,0);
  assert.equal(restarted.pendingRun,null);
});

test('incognito OpenAI alarms never persist prompts, credentials, or received text',async t=>{
  const f=setup(t,'gpt-6.1-sol');f.payload.chat.incognito=true;
  await f.call('start',{payload:f.payload});
  const actor=Array.from(f.objects.values())[0],executing=actor.alarm();
  await f.waitFor(()=>f.upstreams.length===1);f.upstreams[0].text('无痕内容');f.upstreams[0].end();await executing;
  assert.equal(actor.meta.reply.text,'无痕内容');
  assert.equal(actor.sql.exec('SELECT value FROM run_meta').toArray().length,0);
  assert.equal(actor.sql.exec('SELECT value FROM run_events').toArray().length,0);
  assert.equal(f.data.has('chats:tester:chat-test-001'),false);
});

test('an alarm scheduling failure releases the pending run without charging OpenAI',async t=>{
  const f=setup(t,'gpt-6-astra');await f.call('status');
  const actor=Array.from(f.objects.values())[0];
  actor.ctx.storage.setAlarm=async()=>{throw Error('scheduler unavailable')};
  assert.equal((await f.call('start',{payload:f.payload})).status,503);
  assert.equal(actor.pendingRun,null);assert.equal(actor.meta.status,'failed');
  assert.equal(f.upstreams.length,0);
});

test('disconnecting the phone subscriber does not cancel generation; events resume without a second provider call', async t => {
  const f=setup(t);
  assert.equal((await f.call('start',{payload:f.payload})).status,202);
  await f.waitFor(()=>f.upstreams.length===1);
  const response=await f.call('events',{after:0}),reader=response.body.getReader();
  await reader.read();await reader.cancel();
  f.upstreams[0].text('第一段');
  await f.waitFor(()=>Array.from(f.objects.values())[0].meta.reply.text==='第一段');
  const first=await(await f.call('status')).json();
  assert.equal(first.status,'running');assert.equal(f.upstreams[0].aborted,false);
  // A lost start acknowledgement is retried with the same identity.
  assert.equal((await f.call('start',{payload:f.payload})).status,200);
  assert.equal(f.upstreams.length,1);
  f.upstreams[0].text('第二段');f.upstreams[0].end();await Promise.all(f.pending);
  const resumed=await(await f.call('events',{after:first.sequence})).text();
  assert.ok(!resumed.includes('第一段'));assert.ok(resumed.includes('第二段'));assert.ok(resumed.includes('[DONE]'));
  const messages=JSON.parse(f.data.get('chats:tester:chat-test-001'));
  assert.equal(messages.length,2);assert.equal(messages[1].text,'第一段第二段');assert.equal(messages[1].run.status,'completed');
  assert.equal(JSON.parse(f.data.get('chats:tester:list'))[0].id,'chat-test-001');
});

test('only explicit stop cancels the provider, retaining partial output', async t => {
  const f=setup(t);await f.call('start',{payload:f.payload});await f.waitFor(()=>f.upstreams.length===1);
  f.upstreams[0].text('保留这部分');await f.waitFor(()=>Array.from(f.objects.values())[0].meta.reply.text.length>0);
  await f.call('stop');await Promise.all(f.pending);
  assert.equal(f.upstreams[0].aborted,true);
  const saved=JSON.parse(f.data.get('chats:tester:chat-test-001'));
  assert.equal(saved[1].text,'保留这部分');assert.equal(saved[1].run.status,'cancelled');
});

test('idempotency rejects changed input and simultaneous new generation in the same chat', async t => {
  const f=setup(t);await f.call('start',{payload:f.payload});await f.waitFor(()=>f.upstreams.length===1);
  assert.equal((await f.call('start',{payload:{...f.payload,search:true}})).status,409);
  assert.equal((await f.call('start',{payload:f.payload,runId:'different-run'})).status,409);
  assert.equal(f.upstreams.length,1);f.upstreams[0].end();await Promise.all(f.pending);
});

test('authentication and project ownership precede task access', async t => {
  const f=setup(t);
  assert.equal((await f.call('start',{password:'wrong',payload:f.payload})).status,401);
  assert.equal((await f.call('status',{projectId:'foreign-project'})).status,404);
  assert.equal(f.objects.size,0);assert.equal(f.upstreams.length,0);
  await f.call('start',{payload:f.payload});await f.waitFor(()=>f.upstreams.length===1);
  assert.equal((await f.call('status',{user:'other'})).status,410);
  f.upstreams[0].end();await Promise.all(f.pending);
});

test('incognito output and authentication secrets are absent from persistent task storage', async t => {
  const f=setup(t);f.payload.chat.incognito=true;await f.call('start',{payload:f.payload});await f.waitFor(()=>f.upstreams.length===1);
  f.upstreams[0].text('PRIVATE_INCOGNITO_CANARY');f.upstreams[0].end();await Promise.all(f.pending);
  const object=Array.from(f.objects.values())[0];
  assert.equal(object.sql.exec('SELECT value FROM run_meta').toArray().length,0);
  assert.equal(object.sql.exec('SELECT value FROM run_events').toArray().length,0);
  assert.ok(!Array.from(f.data.keys()).some(key=>key.startsWith('chats:')));
  assert.ok((await(await f.call('events')).text()).includes('PRIVATE_INCOGNITO_CANARY'));
});

test('ordinary task storage contains no reusable account hash or provider key', async t => {
  const f=setup(t);await f.call('start',{payload:f.payload});await f.waitFor(()=>f.upstreams.length===1);f.upstreams[0].end();await Promise.all(f.pending);
  const object=Array.from(f.objects.values())[0];
  const saved=JSON.stringify(object.sql.exec('SELECT value FROM run_meta').toArray())+JSON.stringify(object.sql.exec('SELECT value FROM run_events').toArray());
  assert.ok(!saved.includes(pass));assert.ok(!saved.includes(f.env.ANTHROPIC_API_KEY));
});

test('a process restart reports interruption and preserves progress instead of issuing another paid call', async()=>{
  const store=storage();store.sql.exec('CREATE TABLE run_meta (id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
  store.sql.exec('CREATE TABLE run_events (seq INTEGER PRIMARY KEY, value TEXT NOT NULL)');
  store.sql.exec('INSERT INTO run_meta VALUES (1, ?)',JSON.stringify({runId:'restart-run',status:'running',sequence:1,reply:{text:'已保存的部分',activity:[],citations:[]}}));
  store.sql.exec('INSERT INTO run_events VALUES (1, ?)',JSON.stringify({t:'已保存的部分'}));
  const instance=new ChatRun({storage:store,waitUntil(){throw new Error('must not restart provider');}},{});
  const result=await instance.fetch(new Request('https://internal/',{method:'POST',body:JSON.stringify({action:'events',runId:'restart-run',after:1})}));
  const text=await result.text();assert.ok(text.includes('服务器连接已中断'));assert.ok(text.includes('[DONE]'));assert.equal(instance.meta.reply.text,'已保存的部分');
});

test('a long backlog replays immediately across pagination instead of waiting for another heartbeat', {timeout:3000}, async()=>{
  const store=storage(),instance=new ChatRun({storage:store,waitUntil(){}},{});
  instance.meta={runId:'backlog-run',status:'completed',sequence:0,reply:{text:'',activity:[],citations:[]}};
  for(let i=0;i<600;i++)await instance.append(JSON.stringify({t:'片段'+i}));
  await instance.append('[DONE]');
  const response=await instance.fetch(new Request('https://internal/',{method:'POST',body:JSON.stringify({action:'events',runId:'backlog-run',after:0})}));
  const text=await response.text();assert.ok(text.includes('片段599'));assert.equal((text.match(/^id: /gm)||[]).length,601);
});

test('late mobile saves and a stopped display queue cannot truncate completed server output',async t=>{
  const f=setup(t);await f.call('start',{payload:f.payload});await f.waitFor(()=>f.upstreams.length===1);
  f.upstreams[0].text('服务器已经生成并完整保存的回答。');f.upstreams[0].end();await Promise.all(f.pending);
  const saved=JSON.parse(f.data.get('chats:tester:chat-test-001'));
  const clipped=saved.map(item=>item.isUser?item:{...item,text:'服务器已'});
  const response=await worker.fetch(new Request('https://api.pickandcase.com/chats',{method:'POST',body:JSON.stringify({username:'tester',password:pass,action:'save',chatId:'chat-test-001',messages:clipped})}),f.env);
  assert.equal(response.status,200);assert.equal(JSON.parse(f.data.get('chats:tester:chat-test-001'))[1].text,'服务器已经生成并完整保存的回答。');
});

test('thinking can cross 14 minutes and finish, retaining timestamps, usage and provider identifiers', async t => {
  t.mock.timers.enable({ apis:['Date','setTimeout'], now:1800000000000 });
  const f=setup(t);await f.call('start',{payload:f.payload});await f.waitFor(()=>f.upstreams.length===1);
  const actor=Array.from(f.objects.values())[0],upstream=f.upstreams[0];
  upstream.event({type:'message_start',message:{usage:{input_tokens:17,output_tokens:2}}});
  upstream.event({type:'content_block_delta',delta:{type:'thinking_delta',thinking:'先分析'}});
  await f.waitFor(()=>actor.meta.reply.reasoning==='先分析');
  const first=actor.meta.reply.diagnostics.firstReasoningAt;
  t.mock.timers.tick(16*60*1000);
  assert.equal(upstream.aborted,false);assert.equal(actor.meta.status,'running');
  upstream.event({type:'content_block_delta',delta:{type:'thinking_delta',thinking:'再核对'}});
  upstream.text('完整正文');
  upstream.event({type:'message_delta',delta:{stop_reason:'end_turn'},usage:{output_tokens:88}});
  upstream.event({type:'message_stop'});upstream.end();await Promise.all(f.pending);
  assert.equal(actor.meta.status,'completed');assert.equal(actor.meta.reply.text,'完整正文');
  assert.equal(f.upstreams.length,1);
  assert.equal(actor.meta.reply.diagnostics.providerRequestId,'req_offline_test');
  assert.equal(actor.meta.reply.diagnostics.stopReason,'end_turn');
  assert.equal(actor.meta.reply.diagnostics.providerCompleted,true);
  assert.equal(actor.meta.reply.diagnostics.firstTextAt-first,16*60*1000);
  assert.deepEqual(actor.meta.reply.usage,{input:17,output:88});
  assert.ok(actor.sql.exec('SELECT received_at FROM run_events').toArray().every(row=>Number.isSafeInteger(row.received_at)));
});

test('retry preserves the failed run; old status, replay, stop and duplicate start cannot affect or repeat the new run', async t => {
  const f=setup(t);await f.call('start',{payload:f.payload});await f.waitFor(()=>f.upstreams.length===1);
  const actor=Array.from(f.objects.values())[0];
  f.upstreams[0].event({type:'message_start',message:{usage:{input_tokens:19,output_tokens:1}}});
  f.upstreams[0].event({type:'content_block_delta',delta:{type:'thinking_delta',thinking:'已收到的摘要'}});
  await f.waitFor(()=>actor.meta.reply.reasoning==='已收到的摘要');
  f.upstreams[0].fail();await Promise.all(f.pending);
  const failed=await(await f.call('status')).json();
  assert.equal(failed.status,'failed');assert.deepEqual(failed.reply.usage,{input:19,output:1,partial:true});
  const payload={...f.payload,chat:{...f.payload.chat,historyEndUid:2},recovery:{...f.payload.recovery,replyUid:4,userMessage:{...f.payload.recovery.userMessage,uid:3}}};
  await f.call('start',{runId:'run-retry-002',payload});await f.waitFor(()=>f.upstreams.length===2);
  assert.deepEqual(await(await f.call('status')).json(),failed);
  assert.equal((await f.call('status',{user:'other'})).status,410);
  assert.equal((await f.call('status',{password:'wrong'})).status,401);
  const replay=await(await f.call('events')).text();
  assert.ok(replay.includes('已收到的摘要'));assert.ok(replay.includes('fixture interrupted'));assert.ok(replay.includes('[DONE]'));
  assert.equal((await f.call('start',{payload:f.payload})).status,200);
  assert.equal((await f.call('start',{payload:{...f.payload,search:true}})).status,409);
  assert.equal((await(await f.call('stop')).json()).runId,'run-test-001');
  assert.equal(f.upstreams.length,2);assert.equal(f.upstreams[1].aborted,false);
  f.upstreams[1].text('第二次的正文');f.upstreams[1].end();await Promise.all(f.pending);
  assert.ok(!(await(await f.call('events')).text()).includes('第二次的正文'));
  const stored=JSON.parse(f.data.get('chats:tester:chat-test-001'));
  assert.equal(stored.length,4);assert.equal(stored[1].run.status,'failed');assert.equal(stored[3].text,'第二次的正文');
  const restarted=new ChatRun(actor.ctx,f.env);
  assert.equal(restarted.archived('run-test-001').reply.reasoning,'已收到的摘要');
  assert.equal(f.upstreams.length,2);
});

test('an old subscriber finishing after a retry never receives the retry output', async t => {
  const f=setup(t);await f.call('start',{payload:f.payload});await f.waitFor(()=>f.upstreams.length===1);
  const old=await f.call('events');
  f.upstreams[0].text('原来这一轮');f.upstreams[0].end();await Promise.all(f.pending);
  await f.call('start',{runId:'run-next-002',payload:{...f.payload,recovery:{...f.payload.recovery,replyUid:4,userMessage:{...f.payload.recovery.userMessage,uid:3}}}});
  await f.waitFor(()=>f.upstreams.length===2);
  f.upstreams[1].text('下一轮不能混入');f.upstreams[1].end();await Promise.all(f.pending);
  const text=await old.text();assert.ok(text.includes('原来这一轮'));assert.ok(!text.includes('下一轮不能混入'));
});

test('each run expires 24 hours after its own completion; a later retry neither resets nor purges another run early', async t => {
  t.mock.timers.enable({apis:['Date'],now:1800000000000});
  const f=setup(t);await f.call('start',{payload:f.payload});await f.waitFor(()=>f.upstreams.length===1);
  f.upstreams[0].text('第一轮');f.upstreams[0].end();await Promise.all(f.pending);
  const actor=Array.from(f.objects.values())[0];
  t.mock.timers.tick(60*60*1000);
  await f.call('start',{runId:'run-later-002',payload:f.payload});await f.waitFor(()=>f.upstreams.length===2);
  f.upstreams[1].end();await Promise.all(f.pending);
  t.mock.timers.tick(22*60*60*1000);await actor.alarm();
  assert.equal((await f.call('status')).status,200);
  t.mock.timers.tick(60*60*1000+1);await actor.alarm();
  assert.equal((await f.call('status')).status,410);
  assert.equal((await f.call('status',{runId:'run-later-002'})).status,200);
  assert.equal(actor.sql.exec('SELECT * FROM run_event_history').toArray().length,0);
  t.mock.timers.tick(60*60*1000);await actor.alarm();
  assert.equal(actor.meta,null);
});

test('normal retries archive neither account credentials nor incognito output', async t => {
  const f=setup(t);f.payload.chat.incognito=true;
  await f.call('start',{payload:f.payload});await f.waitFor(()=>f.upstreams.length===1);
  f.upstreams[0].text('PRIVATE_RETRY_CANARY');f.upstreams[0].end();await Promise.all(f.pending);
  f.payload.chat.incognito=false;
  await f.call('start',{runId:'run-public-002',payload:f.payload});await f.waitFor(()=>f.upstreams.length===2);
  f.upstreams[1].text('public');f.upstreams[1].end();await Promise.all(f.pending);
  const actor=Array.from(f.objects.values())[0];
  const persisted=['run_meta','run_events','run_history','run_event_history'].map(table=>actor.sql.exec('SELECT * FROM '+table).toArray());
  const text=JSON.stringify(persisted);
  assert.ok(!text.includes('PRIVATE_RETRY_CANARY'));assert.ok(!text.includes(pass));assert.ok(!text.includes(f.env.ANTHROPIC_API_KEY));
  assert.equal(actor.archived('run-test-001'),null);
});

test('an archive transaction failure preserves the previous run and makes no new provider request', async t => {
  const f=setup(t);await f.call('start',{payload:f.payload});await f.waitFor(()=>f.upstreams.length===1);
  f.upstreams[0].text('不能丢失');f.upstreams[0].end();await Promise.all(f.pending);
  const actor=Array.from(f.objects.values())[0],before=await(await f.call('status')).json();
  const execute=actor.sql.exec;
  t.mock.method(actor.sql,'exec',(query,...values)=>{
    if(query.startsWith('INSERT OR REPLACE INTO run_history'))throw Error('archive write failed');
    return execute(query,...values);
  });
  assert.equal((await f.call('start',{runId:'run-failed-save',payload:f.payload})).status,503);
  assert.equal(f.upstreams.length,1);assert.deepEqual(await(await f.call('status')).json(),before);
  assert.equal(actor.sql.exec('SELECT * FROM run_event_history').toArray().length,0);
  assert.ok((await(await f.call('events')).text()).includes('不能丢失'));
});

test('a run makes no automatic second provider attempt on a retryable upstream HTTP failure', async t => {
  const f=setup(t);let calls=0;
  t.mock.method(globalThis,'fetch',async()=>{calls++;return Response.json({error:{message:'unavailable'}},{status:503})});
  await f.call('start',{payload:f.payload});await Promise.all(f.pending);
  assert.equal(calls,1);assert.equal((await(await f.call('status')).json()).status,'failed');
});

test('cleanup scheduling failure before an ordinary run cannot leave a stuck running placeholder or charge a provider', async t => {
  const f=setup(t);await f.call('status');const actor=Array.from(f.objects.values())[0];
  actor.ctx.storage.setAlarm=async()=>{throw Error('storage unavailable')};
  assert.equal((await f.call('start',{payload:f.payload})).status,503);
  assert.equal(actor.meta.status,'failed');assert.equal(f.upstreams.length,0);assert.equal(actor.execution,null);
});

test('legacy single-run tables migrate in place and their original events survive the first retry', async t => {
  const f=setup(t),store=storage();
  store.db.exec('CREATE TABLE run_meta (id INTEGER PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE run_events (seq INTEGER PRIMARY KEY, value TEXT NOT NULL)');
  const userMessage={uid:1,isUser:true,text:'旧问题'};
  const reply={uid:2,text:'',reasoning:'旧摘要',activity:[],citations:[]};
  const meta={runId:'legacy-run-001',status:'failed',sequence:2,createdAt:Date.now()-900000,updatedAt:Date.now(),reply,userMessage,user:'tester',chatId:f.fields.chatId,projectId:null};
  store.sql.exec('INSERT INTO run_meta VALUES (1, ?)',JSON.stringify(meta));
  store.sql.exec('INSERT INTO run_events VALUES (1, ?)',JSON.stringify({r:'旧摘要'}));
  store.sql.exec('INSERT INTO run_events VALUES (2, ?)', '[DONE]');
  f.data.set('chats:tester:'+f.fields.chatId,JSON.stringify([userMessage,reply]));
  const actor=new ChatRun({storage:store,waitUntil:promise=>f.pending.push(promise)},f.env);
  f.objects.set('tester:general:'+f.fields.chatId,actor);
  const payload={...f.payload,chat:{...f.payload.chat,historyEndUid:2},recovery:{...f.payload.recovery,replyUid:4,userMessage:{...f.payload.recovery.userMessage,uid:3}}};
  await f.call('start',{payload});await f.waitFor(()=>f.upstreams.length===1);
  assert.equal((await(await f.call('status',{runId:meta.runId})).json()).reply.reasoning,'旧摘要');
  assert.ok((await(await f.call('events',{runId:meta.runId})).text()).includes('旧摘要'));
  assert.ok(store.sql.exec('SELECT received_at FROM run_event_history').toArray().every(row=>row.received_at===null),'do not invent receipt times for legacy events');
  f.upstreams[0].text('新正文');f.upstreams[0].end();await Promise.all(f.pending);
  assert.equal(JSON.parse(f.data.get('chats:tester:'+f.fields.chatId)).length,4);
});
