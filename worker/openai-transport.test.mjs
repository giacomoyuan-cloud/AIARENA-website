import test from 'node:test';
import assert from 'node:assert/strict';
import {OpenAITransport,openAIBackgroundFetch} from './openai-transport.js';
const origin='https://openai-dispatch.internal';
const body=JSON.stringify({model:'gpt-6.1-sol',stream:true,input:'synthetic hello'});
test('input counting is dispatched to the free counting endpoint rather than Responses generation',async t=>{
  const f=fixture();let calls=0;
  t.mock.method(globalThis,'fetch',async(url)=>{calls++;assert.equal(url,'https://api.openai.com/v1/responses/input_tokens');return Response.json({input_tokens:123});});
  await f.actor.fetch(req('/start',{body,countOnly:true}));await f.actor.alarm();await f.actor.alarm();
  assert.equal((await(await f.actor.fetch(req('/stream'))).json()).input_tokens,123);assert.equal(calls,1);
});
const req=(path,value)=>new Request(origin+path,{method:'POST',body:JSON.stringify(value||{})});
function fixture(){
  const env={OPENAI_API_KEY:'synthetic-provider-key'},times=[];
  const actor=new OpenAITransport({storage:{setAlarm:async value=>times.push(value)}},env);
  return {actor,env,times};
}

test('enqueue makes no provider call; the alarm forwards exact bytes once without stored credentials',async t=>{
  const f=fixture();let calls=0;
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    calls++;assert.equal(url,'https://api.openai.com/v1/responses');assert.equal(options.body,body);
    assert.equal(options.headers.Authorization,'Bearer '+f.env.OPENAI_API_KEY);
    return new Response('data: {"delta":"hello"}\n\n',{headers:{'content-type':'text/event-stream','x-request-id':'synthetic-request-id','set-cookie':'not-forwarded'}});
  });
  assert.equal((await f.actor.fetch(req('/start',{body}))).status,202);assert.equal(calls,0);
  assert.equal(f.times.length,1);await f.actor.alarm();await f.actor.alarm();assert.equal(calls,1);
  const response=await f.actor.fetch(req('/stream'));assert.equal(response.headers.get('x-request-id'),'synthetic-request-id');
  assert.equal(response.headers.get('set-cookie'),null);assert.equal(await response.text(),'data: {"delta":"hello"}\n\n');
  assert.equal(f.actor.job.body,null);
  assert.ok(!JSON.stringify(await(await f.actor.fetch(req('/status'))).json()).includes(f.env.OPENAI_API_KEY));
});
test('provider region failures preserve their HTTP status and are never automatically retried',async t=>{
  const f=fixture();let calls=0;
  t.mock.method(globalThis,'fetch',async()=>{calls++;return Response.json({error:{code:'unsupported_country_region_territory'}},{status:403})});
  await f.actor.fetch(req('/start',{body}));await f.actor.alarm();await f.actor.alarm();
  const response=await f.actor.fetch(req('/stream'));assert.equal(response.status,403);
  assert.equal((await response.json()).error.code,'unsupported_country_region_territory');assert.equal(calls,1);
});
test('stop before alarm prevents any provider call and releases the prepared prompt',async t=>{
  const f=fixture();t.mock.method(globalThis,'fetch',async()=>{throw Error('unexpected paid call')});
  await f.actor.fetch(req('/start',{body}));await f.actor.fetch(req('/stop'));await f.actor.alarm();
  assert.equal(f.actor.job.started,false);assert.equal(f.actor.job.body,null);
});

test('stop during an active private response aborts the provider and preserves the already-read prefix',async t=>{
  const f=fixture();let aborted=false;
  t.mock.method(globalThis,'fetch',async(url,options)=>new Response(new ReadableStream({start(controller){
    controller.enqueue(new TextEncoder().encode('first-part'));
    options.signal.addEventListener('abort',()=>{aborted=true;controller.error(new DOMException('stopped','AbortError'))},{once:true});
  }})));
  await f.actor.fetch(req('/start',{body}));const execution=f.actor.alarm();
  await Promise.resolve();
  const response=await f.actor.fetch(req('/stream')),reader=response.body.getReader();
  assert.equal(new TextDecoder().decode((await reader.read()).value),'first-part');
  await f.actor.fetch(req('/stop'));await execution;assert.equal(aborted,true);
  assert.equal(f.actor.job.finished,true);await reader.cancel();
});
test('only supported prepared OpenAI requests are accepted',async()=>{
  const f=fixture();assert.equal((await f.actor.fetch(req('/start',{body:JSON.stringify({model:'not-allowed'})}))).status,400);
  assert.equal((await f.actor.fetch(req('/start',{body:'invalid json'}))).status,400);
  assert.equal(f.times.length,0);
});
test('a lost volatile task fails explicitly instead of replaying a provider call',async()=>{
  const f=fixture();assert.equal((await f.actor.fetch(req('/status'))).status,410);
});
test('the caller uses a fresh US object, closes enqueue before polling, and receives a byte-exact stream',async t=>{
  const f=fixture(),calls=[],alarms=[];
  t.mock.method(globalThis,'fetch',async()=>new Response('data: {"type":"response.output_text.delta","delta":"verified"}\n\n',{headers:{'content-type':'text/event-stream'}}));
  const namespace={jurisdiction(region){assert.equal(region,'us');return {
    idFromName(name){assert.match(name,/^openai-dispatch:/);return name},
    get(){return {async fetch(request){const path=new URL(request.url).pathname;calls.push(path);const response=await f.actor.fetch(request);if(path==='/start')alarms.push(f.actor.alarm());return response}}}
  }}};
  const response=await openAIBackgroundFetch(namespace,body,new AbortController().signal);
  assert.equal(await response.text(),'data: {"type":"response.output_text.delta","delta":"verified"}\n\n');
  await Promise.all(alarms);assert.deepEqual(calls,['/start','/status','/stream']);
});
test('provider transport exceptions are masked without repeating a generation',async t=>{
  const f=fixture();t.mock.method(globalThis,'fetch',async()=>{throw Error(f.env.OPENAI_API_KEY)});
  await f.actor.fetch(req('/start',{body}));await f.actor.alarm();
  const response=await f.actor.fetch(req('/stream'));assert.equal(response.status,502);
  assert.ok(!(await response.text()).includes(f.env.OPENAI_API_KEY));
});

test('slow provider headers use a bounded wait instead of repeated status subrequests',async t=>{
  const f=fixture(),calls=[],alarms=[];let release;
  t.mock.method(globalThis,'fetch',()=>new Promise(resolve=>{release=()=>resolve(new Response('data: verified\n\n'))}));
  const namespace={jurisdiction(){return {idFromName:name=>name,get:()=>({async fetch(request){
    const path=new URL(request.url).pathname;calls.push(path);
    if(path==='/wait-ready')setTimeout(()=>release(),5);
    const response=await f.actor.fetch(request);if(path==='/start')alarms.push(f.actor.alarm());return response;
  }})}}};
  const response=await openAIBackgroundFetch(namespace,body,new AbortController().signal);
  assert.equal(await response.text(),'data: verified\n\n');await Promise.all(alarms);
  assert.deepEqual(calls,['/start','/status','/wait-ready','/stream']);
});

test('an ambiguous transport failure throws rather than becoming an automatically retryable HTTP error',async t=>{
  const f=fixture(),alarms=[];let calls=0;
  t.mock.method(globalThis,'fetch',async()=>{calls++;throw Error('connection lost')});
  const namespace={jurisdiction(){return {idFromName:name=>name,get:()=>({async fetch(request){
    const response=await f.actor.fetch(request);if(new URL(request.url).pathname==='/start')alarms.push(f.actor.alarm());return response;
  }})}}};
  await assert.rejects(openAIBackgroundFetch(namespace,body,new AbortController().signal),/后台连接中断/);
  await Promise.all(alarms);assert.equal(calls,1);
});
