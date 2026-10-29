import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import Billing from '../arena-billing.js';
import {handleBillingLedger,recordProviderUsage,usageSummary,usageReceipt} from './billing-ledger.js';
import {createChatRunClass} from './chat-runs.js';
import worker from './worker.js';
import {OpenAITransport} from './openai-transport.js';

const at=Date.parse('2026-10-30T12:00:00Z');
function fixture(){
  const db=new DatabaseSync(':memory:'),data=new Map();
  const ctx={storage:{sql:{exec(sql,...args){const statement=db.prepare(sql),rows=/^\s*SELECT/i.test(sql)?statement.all(...args):(statement.run(...args),[]);return {toArray:()=>rows};}},transactionSync(fn){db.exec('BEGIN');try{const value=fn();db.exec('COMMIT');return value;}catch(e){db.exec('ROLLBACK');throw e;}}}};
  const namespace={idFromName:name=>name,get:()=>({fetch:request=>handleBillingLedger(ctx,request)})};
  const kv={get:async key=>data.get(key)||null,put:async(key,value)=>data.set(key,value),list:async({prefix})=>({keys:[...data.keys()].filter(k=>k.startsWith(prefix)).map(name=>({name})),list_complete:true})};
  const env={BIZ_KV:kv,MEMORY_KV:kv,CHAT_RUNS:namespace};
  const transports=new Map();
  namespace.jurisdiction=region=>{
    assert.equal(region,'us');
    return {idFromName:name=>name,get(id){
      if(!transports.has(id)){
        let actor;
        actor=new OpenAITransport({storage:{setAlarm:async()=>{queueMicrotask(()=>actor.alarm());}}},env);
        transports.set(id,actor);
      }
      return {fetch:request=>transports.get(id).fetch(request)};
    }};
  };
  return {db,ctx,data,env,namespace};
}
const raw=()=>({input_tokens:1000,output_tokens:1000,input_tokens_details:{cached_tokens:0,cache_write_tokens:0,cache_write_tokens_details:{ttl_30m_tokens:0,ttl_12h_tokens:0}}});

test('100 concurrent requests preserve every token and exact USD amount',async()=>{
  const {env}=fixture();
  await Promise.all(Array.from({length:100},(_,n)=>recordProviderUsage(env,'user-a','gpt-6.1-sol',raw(),{at,id:'receipt-concurrent-'+n})));
  const result=await usageSummary(env,'user-a');assert.equal(result.total.calls,100);assert.equal(result.total.input,100000);assert.equal(result.total.output,100000);assert.equal(result.total.knownCostUsd,'1.20');assert.equal(result.total.unsettled,0);
});
test('observer replay and duplicate receipt submissions cannot count a request twice',async()=>{
  const {env}=fixture(),options={at,id:'same-receipt-0001'};
  await Promise.all(Array.from({length:10},()=>recordProviderUsage(env,'user-a','gpt-6.1-sol',raw(),options)));
  assert.equal((await usageSummary(env,'user-a')).total.calls,1);
});
test('per-account summary and receipt lookups cannot expose another account',async()=>{
  const {env}=fixture();await recordProviderUsage(env,'user-a','gpt-6.1-sol',raw(),{at,id:'private-receipt-01'});
  await recordProviderUsage(env,'user-b','gpt-6-astra',raw(),{at,id:'private-receipt-02'});
  const one=await usageSummary(env,'user-a');assert.equal(one.total.calls,1);assert.equal(one.models['gpt-6-astra'],undefined);
  await assert.rejects(usageReceipt(env,'user-b','private-receipt-01'),/不存在/);
  assert.equal((await usageSummary(env,'admin',{global:true})).total.calls,2);
});
test('tiny provider tick amounts add exactly instead of accumulating floating-point drift',async()=>{
  const {env}=fixture();await Promise.all(Array.from({length:1000},(_,n)=>recordProviderUsage(env,'user-a','grok-4.7',{input_tokens:0,output_tokens:0,cost_in_usd_ticks:1},{at,id:'tiny-receipt-'+n})));
  const result=await usageSummary(env,'user-a');assert.equal(result.total.knownCostPico,'100000');assert.equal(result.total.knownCostUsd,'0.0000001');
});
test('unknown usage and unresolved Google search costs remain explicit in totals',async()=>{
  const {env}=fixture();await recordProviderUsage(env,'user-a','grok-imagine-image-2.0',{input_tokens:null,output_tokens:null,cost_in_usd_ticks:400000000},{at,id:'image-receipt-01'});
  await recordProviderUsage(env,'user-a','gemini-4-argon',{promptTokenCount:100,candidatesTokenCount:100},{at,id:'search-receipt-1',groundingUsed:true,searches:1});
  const result=await usageSummary(env,'user-a');assert.equal(result.total.calls,2);assert.equal(result.total.missingInput,1);assert.equal(result.total.missingOutput,1);assert.equal(result.total.unsettled,1);assert.equal(result.total.knownCostUsd,'0.0412');
});
test('a ledger outage keeps immutable receipts and restores them idempotently',async()=>{
  const {env,namespace,data}=fixture();delete env.CHAT_RUNS;
  const result=await recordProviderUsage(env,'user-a','gpt-6.1-sol',raw(),{at,id:'pending-receipt-1'});assert.equal(result.ledgerStatus,'pending');assert.equal(data.size,1);
  env.CHAT_RUNS=namespace;
  assert.equal((await usageSummary(env,'user-a')).total.calls,1);assert.equal((await usageSummary(env,'user-a')).total.calls,1);assert.equal(data.size,1,'backup receipt is retained');
});
test('receipt insertion and totals update roll back together on a write failure',async()=>{
  const {env,db}=fixture();await usageSummary(env,'user-a');
  db.exec("CREATE TRIGGER fail_total BEFORE INSERT ON billing_totals BEGIN SELECT RAISE(ABORT,'test failure'); END;");
  const result=await recordProviderUsage(env,'user-a','gpt-6.1-sol',raw(),{at,id:'rollback-receipt-1'});
  assert.equal(result.ledgerStatus,'pending');assert.equal(db.prepare('SELECT COUNT(*) AS count FROM billing_receipts').get().count,0);
  db.exec('DROP TRIGGER fail_total');assert.equal((await usageSummary(env,'user-a')).total.calls,1);
});
test('a receipt id collision does not mutate another saved charge',async()=>{
  const {env}=fixture();await recordProviderUsage(env,'user-a','gpt-6.1-sol',raw(),{at,id:'collision-receipt-1'});
  const changed=await recordProviderUsage(env,'user-a','gpt-6-astra',raw(),{at,id:'collision-receipt-1'});assert.equal(changed.ledgerStatus,'pending');
  // The rejected alternate value cannot change the SQL ledger.
  const saved=await usageReceipt(env,'user-a','collision-receipt-1');assert.equal(saved.receipt.model,'gpt-6.1-sol');
});
test('later memory fees reattach to their original reply without double-counting account totals',async()=>{
  const {env}=fixture();await recordProviderUsage(env,'user-a','gpt-6.1-sol',raw(),{at,id:'parent-receipt-001'});
  await recordProviderUsage(env,'user-a','claude-haiku-4-5-20251001',{input_tokens:100,output_tokens:100},{at,id:'child-receipt-001',parentId:'parent-receipt-001',purpose:'memory'});
  const value=await usageReceipt(env,'user-a','parent-receipt-001');assert.equal(value.receipt.costUsd,'0.0126');assert.equal(value.receipt.input,1000);assert.equal(value.receipt.auxiliary.length,1);
  const stats=await usageSummary(env,'user-a');assert.equal(stats.total.calls,2);assert.equal(stats.total.knownCostUsd,'0.0126');
});
test('the existing Durable Object binding handles the private ledger without a model or migration',async()=>{
  const {ctx,env}=fixture();let generations=0;
  const Class=createChatRunClass(()=>{generations++;},null),object=new Class(ctx,env);
  const response=await object.fetch(new Request('https://usage-ledger.internal/__billing',{method:'POST',body:JSON.stringify({action:'summary',owner:'user-a'})}));
  assert.equal(response.status,200);assert.equal(generations,0);
  const forged=await object.fetch(new Request('https://chat-run.internal/__billing',{method:'POST',body:JSON.stringify({action:'summary',owner:'user-a'})}));assert.equal(forged.status,410);
});
test('pricing is read-only and aggregate/receipt endpoints require account authentication',async t=>{
  const {env,data}=fixture(),hash=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode('synthetic-password'))).toString('hex');data.set('user:tester',JSON.stringify({hash}));
  t.mock.method(globalThis,'fetch',()=>{throw new Error('no provider call permitted');});
  const pricing=await worker.fetch(new Request('https://api.pickandcase.com/pricing'),env);assert.equal(pricing.status,200);assert.equal((await pricing.json()).models['claude-fable-5-1'].input,'10');
  const unauthorized=await worker.fetch(new Request('https://api.pickandcase.com/usage',{method:'POST',body:JSON.stringify({user:'tester',password:'wrong'})}),env);assert.equal(unauthorized.status,401);
  await recordProviderUsage(env,'tester','gpt-6.1-sol',raw(),{at,id:'owned-api-receipt-1'});
  const own=await worker.fetch(new Request('https://api.pickandcase.com/usage',{method:'POST',body:JSON.stringify({user:'tester',password:hash,all:true})}),env);const stats=await own.json();assert.equal(stats.scope,'account');assert.equal(stats.total.calls,1);
});
test('usage emitted by a real streaming handler and the persisted receipt use the same counters and charge',async t=>{
  const {env,data}=fixture();env.OPENAI_API_KEY='synthetic-provider-key';env.PASSWORD='synthetic-password';
  const hash=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(env.PASSWORD))).toString('hex');data.set('user:tester',JSON.stringify({hash}));
  let providerCalls=0;
  t.mock.method(globalThis,'fetch',(url,options)=>{
    providerCalls++;assert.equal(url,'https://api.openai.com/v1/responses');assert.equal(JSON.parse(options.body).service_tier,'default');
    return new Response('data: '+JSON.stringify({type:'response.output_text.delta',delta:'synthetic'})+'\n\ndata: '+JSON.stringify({type:'response.completed',response:{usage:raw(),service_tier:'default',output:[]}})+'\n\n');
  });
  const response=await worker.fetch(new Request('https://api.pickandcase.com/',{method:'POST',body:JSON.stringify({user:'tester',password:hash,model:'gpt-6.1-sol',prompt:'synthetic'})}),env);
  const text=await response.text(),events=text.split('\n').filter(l=>l.startsWith('data: {')).map(l=>JSON.parse(l.slice(6))),usage=events.find(e=>e.usage).usage;
  assert.equal(usage.input,1000);assert.equal(usage.output,1000);assert.equal(usage.costUsd,'0.012');assert.equal(usage.ledgerStatus,'recorded');
  assert.equal(providerCalls,1,'the isolated background dispatch forwards one provider request');
  const saved=await usageReceipt(env,'tester',usage.id);assert.equal(saved.receipt.costPico,usage.costPico);assert.equal((await usageSummary(env,'tester')).total.calls,1);
});

test('a lost ledger acknowledgement retries the same receipt without another charge',async()=>{
  const {env,namespace,data}=fixture(),get=namespace.get;let lost=true;
  namespace.get=(...args)=>{const stub=get(...args);return {fetch:async request=>{
    const response=await stub.fetch(request);if(lost){lost=false;throw Error('synthetic lost acknowledgement');}return response;
  }};};
  const result=await recordProviderUsage(env,'user-a','gpt-6.1-sol',raw(),{at,id:'lost-ack-receipt-1'});
  assert.equal(result.ledgerStatus,'recorded');assert.equal(data.size,0);assert.equal((await usageSummary(env,'user-a')).total.calls,1);
});
async function authenticatedFixture(){
  const f=fixture();f.env.OPENAI_API_KEY='synthetic-provider-key';f.env.PASSWORD='synthetic-password';
  f.hash=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(f.env.PASSWORD))).toString('hex');
  f.data.set('user:tester',JSON.stringify({hash:f.hash}));return f;
}
const completedResponse=()=>new Response('data: '+JSON.stringify({type:'response.completed',response:{usage:raw(),service_tier:'default',output:[]}})+'\n\n');
test('a failed attempt and the successful retry retain separate official usage and fees',async t=>{
  const {env,hash}=await authenticatedFixture();let calls=0;
  t.mock.method(globalThis,'fetch',()=>++calls===1?Response.json({error:{message:'synthetic retry'},usage:raw()},{status:500}):completedResponse());
  const response=await worker.fetch(new Request('https://api.pickandcase.com/',{method:'POST',body:JSON.stringify({user:'tester',password:hash,model:'gpt-6.1-sol',prompt:'synthetic'})}),env);
  const events=(await response.text()).split('\n').filter(l=>l.startsWith('data: {')).map(l=>JSON.parse(l.slice(6))),value=events.find(e=>e.usage).usage;
  assert.equal(calls,2);assert.equal(value.input,1000);assert.equal(value.output,1000);assert.equal(value.costUsd,'0.024');
  assert.equal(value.auxiliary.length,1);assert.equal(value.auxiliary[0].purpose,'retry');
  const stats=await usageSummary(env,'tester');assert.equal(stats.total.calls,2);assert.equal(stats.total.input,2000);assert.equal(stats.total.output,2000);assert.equal(stats.total.knownCostUsd,'0.024');
});
test('a final failed response still records the usage the provider returned',async t=>{
  const {env,hash}=await authenticatedFixture();
  t.mock.method(globalThis,'fetch',()=>Response.json({error:{message:'synthetic final failure'},usage:raw()},{status:502}));
  const response=await worker.fetch(new Request('https://api.pickandcase.com/',{method:'POST',body:JSON.stringify({user:'tester',password:hash,model:'gpt-6.1-sol',prompt:'synthetic',noAutomaticRetry:true})}),env);
  const events=(await response.text()).split('\n').filter(l=>l.startsWith('data: {')).map(l=>JSON.parse(l.slice(6)));
  assert.equal(events.find(e=>e.usage).usage.costUsd,'0.012');assert.ok(events.some(e=>e.error));assert.equal((await usageSummary(env,'tester')).total.calls,1);
});

const scoped=(question,skills)=>({scope:'general',chatId:'billing-scoped-test',question,query:question,history:[],historyEndUid:null,skills});
test('automatic skill routing records the complete Haiku receipt alongside the selected model',async t=>{
  const {env,hash}=await authenticatedFixture();env.ANTHROPIC_API_KEY='synthetic-anthropic-key';
  t.mock.method(globalThis,'fetch',(url,options)=>{
    const body=JSON.parse(options.body);
    if(url.includes('anthropic.com')){assert.equal(body.service_tier,'standard_only');return Response.json({content:[{type:'tool_use',name:'select_skills',input:{ids:[],output:'text'}}],usage:{input_tokens:10,output_tokens:5,service_tier:'standard'}});}
    return completedResponse();
  });
  const response=await worker.fetch(new Request('https://api.pickandcase.com/',{method:'POST',body:JSON.stringify({user:'tester',password:hash,model:'gpt-6.1-sol',chat:scoped('请解释一个概念',{mode:'auto'})})}),env);
  const events=(await response.text()).split('\n').filter(l=>l.startsWith('data: {')).map(l=>JSON.parse(l.slice(6))),value=events.find(e=>e.usage).usage;
  assert.equal(value.costUsd,'0.012035');assert.equal(value.input,1000);assert.equal(value.auxiliary[0].purpose,'skill-router');
  const stats=await usageSummary(env,'tester');assert.equal(stats.total.calls,2);assert.equal(stats.models['claude-haiku-4-5-20251001'].input,10);
});
test('all native document continuations emit one canonical group and preserve every raw usage snapshot',async t=>{
  const {env,hash}=await authenticatedFixture();env.ANTHROPIC_API_KEY='synthetic-anthropic-key';let calls=0;
  t.mock.method(globalThis,'fetch',(url,options)=>{
    assert.equal(url,'https://api.anthropic.com/v1/messages');assert.equal(JSON.parse(options.body).service_tier,'standard_only');calls++;
    const usage=calls===1?{input_tokens:100,cache_read_input_tokens:20,cache_creation_input_tokens:30,cache_creation:{ephemeral_5m_input_tokens:30,ephemeral_1h_input_tokens:0},output_tokens:10}:{input_tokens:50,cache_read_input_tokens:100,output_tokens:20};
    return Response.json({id:'synthetic-document-'+calls,container:{id:'container_test_123'},stop_reason:calls===1?'pause_turn':'end_turn',usage,content:[{type:'bash_code_execution_tool_result',content:{type:'bash_code_execution_result',return_code:0,content:[]}},{type:'text',text:'synthetic completed analysis'}]});
  });
  const response=await worker.fetch(new Request('https://api.pickandcase.com/',{method:'POST',body:JSON.stringify({user:'tester',password:hash,model:'gpt-6.1-sol',chat:scoped('分析 1 和 2，不需文件',{mode:'manual',ids:['xlsx']})})}),env);
  const events=(await response.text()).split('\n').filter(l=>l.startsWith('data: {')).map(l=>JSON.parse(l.slice(6))),values=events.filter(e=>e.usage).map(e=>e.usage);
  assert.equal(calls,2);assert.equal(values.length,1);const value=values[0];
  assert.equal(value.schemaVersion,2);assert.equal(value.model,'claude-sonnet-5-5');assert.equal(value.execution.input,300);assert.equal(value.execution.output,30);assert.equal(value.knownCostUsd,'0.000687');assert.equal(value.costUsd,null);
  const stats=await usageSummary(env,'tester');assert.equal(stats.total.calls,2);assert.equal(stats.total.input,300);assert.equal(stats.total.output,30);assert.equal(stats.total.knownCostUsd,'0.000687');
  const restored=await usageReceipt(env,'tester',value.id);assert.equal(restored.receipt.execution.input,300);assert.equal(restored.receipt.knownCostUsd,value.knownCostUsd);
});

test('OpenAI image batches keep image and orchestrator meters separate and never double-count repeated result events',async t=>{
  const {env,hash}=await authenticatedFixture();let calls=0;
  t.mock.method(globalThis,'fetch',(url,options)=>{
    calls++;const payload=JSON.parse(options.body);assert.equal(payload.model,'gpt-6.1-sol');assert.equal(payload.service_tier,'default');
    const item={id:'synthetic-image-'+calls,type:'image_generation_call',result:'aGVsbG8=',usage:{input_tokens:100,output_tokens:1000,input_tokens_details:{text_tokens:40,image_tokens:60}}};
    return new Response([{type:'response.output_item.done',item},{type:'response.completed',response:{status:'completed',service_tier:'default',usage:raw(),output:[item]}}].map(e=>'data: '+JSON.stringify(e)).join('\n\n'));
  });
  const response=await worker.fetch(new Request('https://api.pickandcase.com/',{method:'POST',body:JSON.stringify({user:'tester',password:hash,model:'gpt-image-2.5-flare',prompt:'synthetic image',n:2})}),env);
  const events=(await response.text()).split('\n').filter(l=>l.startsWith('data: {')).map(l=>JSON.parse(l.slice(6)));
  assert.ok(!events.some(e=>e.error));assert.equal(calls,2);const values=events.filter(e=>e.usage);assert.equal(values.length,1);
  const value=values[0].usage;assert.equal(value.execution.input,200);assert.equal(value.execution.output,2000);assert.equal(value.execution.calls,2);
  assert.equal(value.knownCostUsd,'0.084');assert.equal(value.costUsd,null);assert.equal(value.auxiliary.filter(v=>v.purpose==='image-orchestrator').length,2);
  const stats=await usageSummary(env,'tester');assert.equal(stats.total.calls,4);assert.equal(stats.models['gpt-image-2.5-flare'].calls,2);assert.equal(stats.models['gpt-6.1-sol'].calls,2);assert.equal(stats.total.knownCostUsd,'0.084');
  const saved=await usageReceipt(env,'tester',value.id);assert.equal(saved.receipt.execution.input,200);assert.equal(saved.receipt.knownCostUsd,value.knownCostUsd);
});
