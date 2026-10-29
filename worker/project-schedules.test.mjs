import test from 'node:test';
import assert from 'node:assert/strict';
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
function setup({execute,project}={}){
  const saved=new Map(),kvData=new Map();let alarm=null,calls=0;
  const storage={get:async k=>structuredClone(saved.get(k)),put:async(k,v)=>saved.set(k,structuredClone(v)),setAlarm:async t=>{alarm=t;},deleteAlarm:async()=>{alarm=null;}};
  const ctx={storage,blockConcurrencyWhile:fn=>fn()},env={BIZ_KV:{get:async k=>kvData.get(k)||null,put:async(k,v)=>kvData.set(k,v)}};
  const Class=createProjectScheduler({models:['model-test'],credentials:async()=>({user:'one',password:'TRANSIENT_SECRET'}),project:project||(async()=>{}),execute:async(...args)=>{calls++;return execute?execute(...args):new Response('data: {"t":"合成结果"}\n\ndata: [DONE]\n\n');}});
  const actor=new Class(ctx,env);
  const call=async body=>{const r=await actor.fetch(new Request('https://internal.invalid/',{method:'POST',body:JSON.stringify({user:'one',...body})}));return {status:r.status,...await r.json()};};
  const task={action:'create',id:'task-123456',name:'日报',prompt:'生成日报',model:'model-test',projectId:'project-123456',schedule:{frequency:'daily',time:'08:00',timeZone:'Asia/Shanghai'}};
  return {actor,call,task,saved,storage,kvData,ctx,env,Class,get calls(){return calls;},get alarm(){return alarm;}};
}
test('alarms execute without a browser, save a scoped result, and keep credentials out of persisted state',async()=>{
  const f=setup();assert.equal((await f.call(f.task)).status,200);assert.ok(f.alarm>Date.now());
  await f.call({action:'run',id:f.task.id});await f.actor.alarm();
  const task=(await f.call({action:'list'})).tasks[0];assert.equal(task.status,'completed');assert.equal(f.calls,1);assert.equal(task.history.length,1);
  assert.equal(JSON.parse(f.kvData.get('project:one:project-123456:chats:'+task.chatId))[1].text,'合成结果');
  assert.ok(!JSON.stringify([...f.saved.values()]).includes('TRANSIENT_SECRET'));
  await f.actor.alarm();assert.equal(f.calls,1);
});
test('failure retains partial output and does not immediately retry a paid request',async()=>{
  const f=setup({execute:async()=>new Response('data: {"t":"部分结果"}\n\ndata: {"error":"合成失败"}\n\ndata: [DONE]\n\n')});
  await f.call(f.task);await f.call({action:'run',id:f.task.id});await f.actor.alarm();await f.actor.alarm();
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
