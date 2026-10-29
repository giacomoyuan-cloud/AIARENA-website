import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import worker, { ChatRun } from './worker.js';

const pass = 'synthetic-debate-account';
const tick = () => new Promise(resolve => setTimeout(resolve, 1));
function storage() {
  const db = new DatabaseSync(':memory:');
  return { db, sql: { exec(query, ...values) { const s = db.prepare(query), rows = s.columns().length ? s.all(...values) : (s.run(...values), []); return {toArray: () => rows}; } }, setAlarm: async function(time) { this.alarm = time; } };
}
function fixture(t) {
  const data = new Map([['user:tester', JSON.stringify({hash:pass})],['user:other',JSON.stringify({hash:pass})]]);
  const kv = {get: async k => data.get(k) || null, put: async (k,v) => data.set(k,v)};
  const env = {MEMORY_KV:kv,BIZ_KV:kv,ANTHROPIC_API_KEY:'synthetic-key'};
  const objects = new Map(), stores = new Map(), calls = []; let failNext = false;
  env.CHAT_RUNS = { idFromName: name => name, get: name => ({ fetch: req => {
    if (!objects.has(name)) { const store = storage(); stores.set(name,store); objects.set(name,new ChatRun({storage:store,waitUntil(){}},env)); }
    return objects.get(name).fetch(req);
  } }) };
  t.mock.method(globalThis,'fetch',async (url,options) => {
    assert.equal(new URL(url).hostname,'api.anthropic.com');
    const payload = JSON.parse(options.body), call = {payload}; calls.push(call);
    if(failNext) { failNext=false; call.failed=true; return Response.json({error:{message:'synthetic provider failure'}},{status:503}); }
    let controller;
    const stream = new ReadableStream({start(c){controller=c;},cancel(){call.cancelled=true;}});
    call.text = text => controller.enqueue(new TextEncoder().encode('data: '+JSON.stringify({type:'content_block_delta',delta:{type:'text_delta',text}})+'\n\n'));
    call.end = () => {try{controller.close();}catch{}};
    options.signal.addEventListener('abort',()=>{call.aborted=true;try{controller.error(new DOMException('stopped','AbortError'));}catch{}});
    return new Response(stream,{headers:{'Content-Type':'text/event-stream'}});
  });
  const fields = {user:'tester',password:pass,chatId:'debate-chat-001',runId:'debate-run-001'};
  const input = {config:{mode:'free',rounds:2,members:[{id:'seat-1',model:'claude-opus-5-5',label:'席位一'},{id:'seat-2',model:'claude-opus-5-5',label:'席位二'}],topic:'合成辩题，测试恢复机制',summaryModel:'claude-opus-5-5'},
    userMessage:{uid:1,name:'测试',text:'合成辩题',topicText:'合成辩题'},replyUids:[2,3,4,5,6],images:[],efforts:{'claude-opus-5-5':'low'},historyEndUid:null};
  const call = (action,extra={}) => worker.fetch(new Request('https://api.pickandcase.com/debate-runs',{method:'POST',body:JSON.stringify({...fields,action,...extra})}),env);
  const actor = () => [...objects.values()][0];
  const status = async () => (await call('status')).json();
  async function wait(check) {for(let n=0;n<500;n++){if(check())return;await tick();}throw new Error('fixture stalled');}
  async function turn(text='完成的合成观点') {const before=calls.length,promise=actor().alarm();await wait(()=>calls.length>before);if(!calls.at(-1).failed){calls.at(-1).text(text);calls.at(-1).end();}await promise;return calls.at(-1);}
  let op=0;
  const control=(action,turn=0,attempt=1,operationId='operation-'+(++op))=>call(action,{turn,attempt,operationId});
  t.after(()=>{for(const store of stores.values())store.db.close();});
  return {data,env,fields,input,call,status,actor,stores,calls,wait,turn,control,fail(){failNext=true;}};
}

test('refresh and lost start acknowledgement reconnect to one immutable job, without duplicate calls',async t=>{
  const f=fixture(t);
  assert.equal((await f.call('start',{input:f.input})).status,202);
  assert.equal((await f.call('start',{input:f.input})).status,200);
  assert.equal(f.calls.length,0);
  const alarm=f.actor().alarm();await f.wait(()=>f.calls.length===1);
  f.calls[0].text('第一个字');await f.wait(()=>f.actor().debate.jobs.get(f.fields.runId).turns[0].reply.text.length>0);
  const first=await f.status();
  assert.equal(first.turns[0].reply.text,'第一个字');
  const controller=new AbortController();controller.abort();
  // Status subscribers and a browser disconnect are entirely separate from execution.
  for(let i=0;i<3;i++)assert.equal((await f.status()).status,'running');
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].aborted,undefined);
  f.calls[0].text('，继续');f.calls[0].end();await alarm;
  for(let i=0;i<4;i++)await f.turn();await f.actor().alarm();
  const final=await f.status();assert.equal(final.status,'completed');assert.equal(f.calls.length,5);
  const saved=JSON.parse(f.data.get('chats:tester:'+f.fields.chatId));
  assert.equal(new Set(saved.map(m=>m.uid)).size,6);assert.equal(saved[1].text,'第一个字，继续');assert.equal(saved[1].debateRun.status,'completed');
});

test('failure pauses; retry executes only failed seat and duplicate operation cannot charge twice',async t=>{
  const f=fixture(t);await f.call('start',{input:f.input});await f.turn('一席原文');f.fail();await f.turn();
  let data=await f.status();assert.equal(data.status,'paused');assert.equal(data.turns[1].status,'failed');assert.equal(f.calls.length,2);
  await f.actor().alarm();assert.equal(f.calls.length,2);
  const op='retry-seat-0001';assert.equal((await f.control('retry',1,1,op)).status,200);
  assert.equal((await f.control('retry',1,1,op)).status,200);
  await f.turn('二席补全');
  assert.equal(f.calls.length,3);data=await f.status();assert.equal(data.turns[0].attempt,1);assert.equal(data.turns[0].reply.text,'一席原文');assert.equal(data.turns[1].attempt,2);
  assert.equal((await f.control('retry',1,1,'stale-retry-001')).status,409);
  for(let i=0;i<2;i++)await f.turn();await f.turn('总结');await f.actor().alarm();assert.equal((await f.status()).status,'completed');assert.equal(f.calls.length,6);
});

test('skip continues pending seats; repairing an old seat preserves later paid answers',async t=>{
  const f=fixture(t);await f.call('start',{input:f.input});await f.turn('第一席');f.fail();await f.turn();
  await f.control('skip',1,1);for(let i=0;i<3;i++)await f.turn('后续原文');await f.actor().alarm();
  assert.equal((await f.status()).status,'partial');const before=f.calls.length;
  await f.control('retry',1,1);await f.turn('补回第二席');await f.actor().alarm();
  const data=await f.status();assert.equal(data.status,'completed');assert.equal(f.calls.length,before+1);assert.equal(data.turns[2].reply.text,'后续原文');assert.equal(data.turns[2].outdated,true);assert.equal(data.turns[4].outdated,true);
});

test('explicit stop keeps partial text, prevents alarm continuation, and can skip stopped seat',async t=>{
  const f=fixture(t);await f.call('start',{input:f.input});const alarm=f.actor().alarm();await f.wait(()=>f.calls.length===1);
  f.calls[0].text('部分发言');await f.wait(()=>f.actor().debate.jobs.get(f.fields.runId).turns[0].reply.text);
  await f.control('stop');await alarm;assert.equal(f.calls[0].aborted,true);assert.equal((await f.status()).status,'stopped');
  await f.actor().alarm();assert.equal(f.calls.length,1);assert.equal((await f.control('resume')).status,409);
  await f.control('skip',0,1);await f.turn();assert.equal(f.calls.length,2);assert.equal((await f.status()).turns[0].reply.text,'部分发言');
});

test('server restart never silently reissues an uncertain provider request; pending alarms resume safely',async t=>{
  const f=fixture(t);await f.call('start',{input:f.input});
  const store=[...f.stores.values()][0],base=f.actor();
  // Simulate a committed in-flight turn at process loss, without a live paid request.
  const job=base.debate.jobs.get(f.fields.runId),turn=job.turns[0];turn.status='running';turn.attempt=1;turn.reply.text='已经收到';base.debate.touch(job,turn);
  const restarted=new ChatRun({storage:store,waitUntil(){}},f.env);
  await restarted.alarm();assert.equal(f.calls.length,0);
  const status=await(await restarted.fetch(new Request('https://internal/',{method:'POST',body:JSON.stringify({kind:'debate',action:'status',runId:f.fields.runId})}))).json();
  assert.equal(status.status,'paused');assert.equal(status.turns[0].status,'interrupted');assert.equal(status.turns[0].reply.text,'已经收到');
  assert.equal(JSON.parse(f.data.get('chats:tester:'+f.fields.chatId))[1].debateStatus,'interrupted');
  assert.ok(!JSON.stringify(store.sql.exec('SELECT value FROM debate_jobs').toArray()).includes(pass));
});

test('account, project, request identity and model validation precede any provider execution',async t=>{
  const f=fixture(t);
  assert.equal((await f.call('start',{input:f.input,password:'wrong'})).status,401);
  assert.equal((await f.call('start',{input:f.input,projectId:'foreign-project'})).status,404);
  const invalid=structuredClone(f.input);invalid.config.members[0].model='invented-model';assert.equal((await f.call('start',{input:invalid})).status,400);
  const sameUid=structuredClone(f.input);sameUid.replyUids[1]=2;assert.equal((await f.call('start',{input:sameUid})).status,400);
  await f.call('start',{input:f.input});const changed=structuredClone(f.input);changed.config.topic='changed';assert.equal((await f.call('start',{input:changed})).status,409);
  assert.equal((await f.call('status',{user:'other'})).status,410);
  f.data.set('user:tester',JSON.stringify({hash:'rotated'}));await f.actor().alarm();assert.equal(f.calls.length,0);
  const job=f.actor().debate.jobs.get(f.fields.runId);assert.equal(job.status,'paused');assert.match(job.turns[0].error,/登录状态已变化/);
});

test('rounds use immutable previous-round views and distinct seat identities even for the same model',async t=>{
  const f=fixture(t);await f.call('start',{input:f.input});await f.turn('第一轮一席');await f.turn('第一轮二席');await f.turn('第二轮二席');await f.turn('第二轮一席');
  const prompts=f.calls.map(call=>JSON.stringify(call.payload));
  assert.ok(!prompts[1].includes('第一轮一席'));assert.ok(prompts[2].includes('第一轮一席'));assert.ok(prompts[2].includes('第一轮二席'));
  assert.ok(!prompts[3].includes('第二轮二席'));assert.ok(prompts[0].includes('seat-1'));assert.ok(prompts[1].includes('seat-2'));
});

test('incognito stores no content or credential in SQLite or chat history; expiry leaves history untouched',async t=>{
  const f=fixture(t);const input={...f.input,incognito:true};await f.call('start',{input});await f.turn('无痕私密观点');
  const store=[...f.stores.values()][0];assert.equal(store.sql.exec('SELECT * FROM debate_jobs').toArray().length,0);assert.equal(store.sql.exec('SELECT * FROM debate_inputs').toArray().length,0);assert.equal(store.sql.exec('SELECT * FROM debate_turns').toArray().length,0);assert.equal(f.data.has('chats:tester:'+f.fields.chatId),false);
  await f.control('stop');const job=f.actor().debate.jobs.get(f.fields.runId);job.updatedAt=Date.now()-8*86400000;await f.actor().alarm();assert.equal((await f.status()).error.includes('已过期'),true);
});

test('finish marks remaining seats skipped and schedules no provider calls',async t=>{
  const f=fixture(t);await f.call('start',{input:f.input});await f.turn();await f.control('stop');await f.control('finish');await f.actor().alarm();
  const status=await f.status();assert.equal(status.status,'partial');assert.equal(status.turns.filter(t=>t.status==='skipped').length,4);assert.equal(f.calls.length,1);
});

test('delta snapshots are absolute checkpoints and omit unchanged turns',async t=>{
  const f=fixture(t);await f.call('start',{input:f.input});const before=await f.status();await f.turn('第一席原文');
  const delta=await(await f.call('status',{after:before.revision})).json();assert.equal(delta.turns.length,1);assert.equal(delta.turns[0].reply.text,'第一席原文');assert.equal(delta.userMessage,undefined);
  assert.equal(before.userMessage.debateRun.maxUid,6,'pending turn IDs stay reserved across page refreshes');
});

test('stopping an older paused run cannot abort a newer discussion in the same chat',async t=>{
  const f=fixture(t);await f.call('start',{input:f.input});await f.turn();f.fail();await f.turn();
  const input={...f.input,userMessage:{...f.input.userMessage,uid:50},replyUids:[51,52,53,54,55],historyEndUid:3};
  await f.call('start',{runId:'debate-run-002',input});const before=f.calls.length,alarm=f.actor().alarm();await f.wait(()=>f.calls.length>before);
  const current=f.calls.at(-1);await f.control('stop');assert.equal(current.aborted,undefined);current.text('新讨论继续');current.end();await alarm;
  const newer=await(await f.call('status',{runId:'debate-run-002'})).json();assert.equal(newer.turns[0].status,'completed');
});

test('stop before a lost start acknowledgement leaves a tombstone and never starts the provider',async t=>{
  const f=fixture(t);assert.equal((await f.control('stop')).status,200);
  const start=await(await f.call('start',{input:f.input})).json();assert.equal(start.status,'stopped');assert.equal(start.total,0);
  assert.equal((await f.status()).status,'stopped');await f.actor().alarm();assert.equal(f.calls.length,0);
});

test('same-model seats and summary keep independent effort through a failed-seat retry',async t=>{
  const f=fixture(t),input=structuredClone(f.input);input.config.rounds=1;input.replyUids=[2,3,4];
  input.config.members[0].effort='low';input.config.members[1].effort='high';input.config.summaryEffort='max';
  assert.equal((await f.call('start',{input})).status,202);await f.turn();f.fail();await f.turn();
  await f.control('retry',1,1);await f.turn();await f.turn();await f.actor().alarm();
  assert.deepEqual(f.calls.map(c=>c.payload.output_config.effort),['low','high','high','max']);
  const final=await f.status();assert.equal(final.status,'completed');assert.deepEqual(final.turns.map(t=>t.reply.effort),['low','high','max']);
  const invalid=structuredClone(input);invalid.config.members[1].effort='invented';assert.equal((await f.call('start',{runId:'invalid-depth-001',input:invalid})).status,400);assert.equal(f.calls.length,4);
});

test('follow-up derives evidence from owned checkpoints, rejects cross-scope sources and never replays old seats',async t=>{
  const f=fixture(t);await f.call('start',{input:f.input});await f.turn('服务端保存的真实观点');await f.control('stop');await f.control('finish');
  const input=structuredClone(f.input);Object.assign(input.config,{rounds:1,summaryModel:'none',priorRunId:f.fields.runId,priorContext:'客户端伪造的结论'});
  input.userMessage.uid=20;input.replyUids=[21,22];input.historyEndUid=6;
  for(const scope of [{user:'other'},{chatId:'other-chat-001'},{projectId:'owned-project-001'}]){
    f.data.set('project:tester:owned-project-001:meta',JSON.stringify({id:'owned-project-001',owner:'tester'}));
    const denied=await f.call('start',{...scope,runId:'followup-run-001',input});assert.equal(denied.status,410);
  }
  const started=await(await f.call('start',{runId:'followup-run-001',input})).json();
  assert.match(started.plan.priorContext,/服务端保存的真实观点/);assert.doesNotMatch(started.plan.priorContext,/客户端伪造/);assert.equal(f.calls.length,1);
  await f.turn('继续追问的一席');await f.turn('继续追问的二席');await f.actor().alarm();
  assert.equal(f.calls.length,3);assert.match(JSON.stringify(f.calls[1].payload),/服务端保存的真实观点/);
  const original=await f.status();assert.equal(original.turns[0].reply.text,'服务端保存的真实观点');assert.equal(original.turns[0].attempt,1);
});
