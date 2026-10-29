import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchOpenAIFromUS, handleOpenAITransport, OPENAI_TRANSPORT_ORIGIN} from './openai-transport.js';
import {createChatRunClass} from './chat-runs.js';

const key='synthetic-private-provider-key';
const post=()=>new Request(OPENAI_TRANSPORT_ORIGIN+'/v1/responses', {method:'POST',body:'{"model":"gpt-6.1-sol","stream":true}'});

test('OpenAI forwarding selects a new US-jurisdiction object without sending credentials or a location hint',async()=>{
  let forwarded;
  const controller=new AbortController();
  const namespace={
    idFromName(name){assert.equal(name,'openai-upstream:v1');return 'us-transport-id';},
    get(id,options){assert.equal(id,'us-transport-id');assert.equal(options,undefined);return {fetch(request){forwarded=request;return new Response('OK');}};}
  };
  const env={CHAT_RUNS:{jurisdiction(value){assert.equal(value,'us');return namespace;}}};
  const response=await fetchOpenAIFromUS(env,'https://api.openai.com/v1/responses',{method:'POST',body:'{"stream":true}',signal:controller.signal,headers:{Authorization:'Bearer '+key,'X-Forwarded-For':'synthetic-client'}});
  assert.equal(await response.text(),'OK');
  assert.equal(forwarded.url,OPENAI_TRANSPORT_ORIGIN+'/v1/responses');
  assert.equal(forwarded.headers.get('Authorization'),null);
  assert.equal(forwarded.headers.get('X-Forwarded-For'),null);
  assert.equal(await forwarded.text(),'{"stream":true}');
  controller.abort();assert.equal(forwarded.signal.aborted,true);
});

test('the private transport cannot forward arbitrary hosts, paths, methods or query strings',async()=>{
  let bindings=0;
  const env={CHAT_RUNS:{jurisdiction(){bindings++;throw new Error('must not route');}}};
  for(const [url,method] of [['https://other.invalid/v1/responses','POST'],['https://api.openai.com/v1/images/generations','POST'],['https://api.openai.com/v1/responses?target=other','POST'],['https://api.openai.com/v1/responses','DELETE']]){
    await assert.rejects(fetchOpenAIFromUS(env,url,{method}),/传输目标无效/);
  }
  assert.equal(bindings,0);
});

test('a missing jurisdiction API stops before any provider call',async()=>{
  await assert.rejects(fetchOpenAIFromUS({CHAT_RUNS:{}},'https://api.openai.com/v1/responses',{method:'POST'}),/尚未部署/);
});

test('the receiving object rejects incorrect jurisdictions, endpoints and missing secrets before fetch',async t=>{
  let calls=0;t.mock.method(globalThis,'fetch',()=>{calls++;throw new Error('must not fetch');});
  assert.equal((await handleOpenAITransport(post(),{OPENAI_API_KEY:key},undefined)).status,503);
  assert.equal((await handleOpenAITransport(post(),{OPENAI_API_KEY:key},'eu')).status,503);
  assert.equal((await handleOpenAITransport(post(),{},'us')).status,503);
  assert.equal((await handleOpenAITransport(new Request(OPENAI_TRANSPORT_ORIGIN+'/v1/images/generations',{method:'POST'}),{OPENAI_API_KEY:key},'us')).status,400);
  assert.equal((await handleOpenAITransport(new Request('https://other.invalid/v1/responses',{method:'POST'}),{OPENAI_API_KEY:key},'us')).status,400);
  assert.equal(calls,0);
});

test('SSE reaches the caller before completion, retaining usage and the request ID',async t=>{
  let writer, captured;
  const provider=new Response(new ReadableStream({start(controller){writer=controller;}}),{headers:{'Content-Type':'text/event-stream','x-request-id':'synthetic-provider-request'}});
  t.mock.method(globalThis,'fetch',async(url,options)=>{captured=options;assert.equal(url,'https://api.openai.com/v1/responses');assert.equal(options.headers.get('Authorization'),'Bearer '+key);assert.equal(options.redirect,'manual');assert.equal(JSON.parse(await new Response(options.body).text()).model,'gpt-6.1-sol');return provider;});
  const request=post();const response=await handleOpenAITransport(request,{OPENAI_API_KEY:key},'us');
  assert.equal(response.headers.get('x-request-id'),'synthetic-provider-request');
  assert.equal(response.headers.get('Cache-Control'),'no-store');
  assert.equal(captured.signal,request.signal);
  const reader=response.body.getReader(),encoder=new TextEncoder(),decoder=new TextDecoder();
  writer.enqueue(encoder.encode('data: {"delta":"首字"}\n\n'));
  assert.match(decoder.decode((await reader.read()).value),/首字/);
  writer.enqueue(encoder.encode('data: {"usage":{"output_tokens":2}}\n\n'));writer.close();
  assert.match(decoder.decode((await reader.read()).value),/output_tokens/);
  assert.equal((await reader.read()).done,true);
});

test('provider failures are returned once with their real status and no redirect follow',async t=>{
  let calls=0;
  t.mock.method(globalThis,'fetch',(_url,options)=>{calls++;assert.equal(options.redirect,'manual');return Response.json({error:{code:'unsupported_country_region_territory'}},{status:403,headers:{'x-request-id':'synthetic-failed-request'}});});
  const response=await handleOpenAITransport(post(),{OPENAI_API_KEY:key},'us');
  assert.equal(response.status,403);assert.equal(calls,1);
  assert.equal(response.headers.get('x-request-id'),'synthetic-failed-request');
  assert.equal((await response.json()).error.code,'unsupported_country_region_territory');
});

test('a read-only model-list check works without sending an inference body',async t=>{
  t.mock.method(globalThis,'fetch',(url,options)=>{assert.equal(url,'https://api.openai.com/v1/models');assert.equal(options.method,'GET');assert.equal(options.body,undefined);return Response.json({data:[]});});
  const response=await handleOpenAITransport(new Request(OPENAI_TRANSPORT_ORIGIN+'/v1/models'),{OPENAI_API_KEY:key},'us');
  assert.deepEqual(await response.json(),{data:[]});
});

test('transport requests bypass chat mutation and leave existing run state intact',async t=>{
  t.mock.method(globalThis,'fetch',()=>new Response('OK'));
  const Run=createChatRunClass();
  const meta={runId:'existing-run',reply:{text:'Existing answer'},status:'completed'};
  const instance={ctx:{id:{jurisdiction:'us'}},env:{OPENAI_API_KEY:key},meta};
  const response=await Run.prototype.fetch.call(instance,post());
  assert.equal(await response.text(),'OK');assert.equal(instance.meta,meta);
  assert.deepEqual(meta,{runId:'existing-run',reply:{text:'Existing answer'},status:'completed'});
});
