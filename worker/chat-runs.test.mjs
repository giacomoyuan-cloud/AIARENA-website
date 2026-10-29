import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import worker, { ChatRun } from './worker.js';

const pass = 'synthetic-account-hash';
const post = body => new Request('https://api.pickandcase.com/chat-runs', { method: 'POST', body: JSON.stringify(body) });
function storage() {
  const db = new DatabaseSync(':memory:');
  return { db, sql: { exec(query, ...values) {
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
    const request = { text(text) { control.enqueue(new TextEncoder().encode('data: '+JSON.stringify(openai ? {type:'response.output_text.delta',delta:text} : {type:'content_block_delta',delta:{type:'text_delta',text}})+'\n\n')); }, end() { try { control.close(); } catch {} }, aborted: false };
    options.signal.addEventListener('abort', () => { request.aborted = true; try { control.error(new DOMException('cancelled','AbortError')); } catch {} });
    upstreams.push(request);
    return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } });
  });
  const payload = { user:'tester',password:pass,model,projectId:null,chat:{scope:'general',chatId:'chat-test-001',question:'请写一段测试文字。',history:[],historyEndUid:null},recovery:{replyUid:2,userMessage:{uid:1,text:'请写一段测试文字。',name:'Tester'},title:'测试'} };
  const fields = { user:'tester',password:pass,chatId:payload.chat.chatId,runId:'run-test-001',projectId:null };
  async function call(action, extra={}) { return worker.fetch(post({...fields,action,...extra}),env); }
  async function waitFor(check) { for(let i=0;i<200;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,2));}throw new Error('fixture did not progress'); }
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
