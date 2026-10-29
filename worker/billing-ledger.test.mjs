import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import Billing from '../arena-billing.js';
import {handleBillingLedger,recordProviderUsage,usageSummary,usageReceipt} from './billing-ledger.js';
import {createChatRunClass} from './chat-runs.js';
import worker from './worker.js';

const at=Date.parse('2026-10-30T12:00:00Z');
function fixture(){
  const db=new DatabaseSync(':memory:'),data=new Map();
  const ctx={storage:{sql:{exec(sql,...args){const statement=db.prepare(sql),rows=/^\s*SELECT/i.test(sql)?statement.all(...args):(statement.run(...args),[]);return {toArray:()=>rows};}},transactionSync(fn){db.exec('BEGIN');try{const value=fn();db.exec('COMMIT');return value;}catch(e){db.exec('ROLLBACK');throw e;}}}};
  const namespace={idFromName:name=>name,get:()=>({fetch:request=>handleBillingLedger(ctx,request)})};
  const kv={get:async key=>data.get(key)||null,put:async(key,value)=>data.set(key,value),list:async({prefix})=>({keys:[...data.keys()].filter(k=>k.startsWith(prefix)).map(name=>({name})),list_complete:true})};
  const env={BIZ_KV:kv,MEMORY_KV:kv,CHAT_RUNS:namespace};
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
  t.mock.method(globalThis,'fetch',()=>new Response('data: '+JSON.stringify({type:'response.output_text.delta',delta:'synthetic'})+'\n\ndata: '+JSON.stringify({type:'response.completed',response:{usage:raw(),service_tier:'default',output:[]}})+'\n\n'));
  const response=await worker.fetch(new Request('https://api.pickandcase.com/',{method:'POST',body:JSON.stringify({user:'tester',password:hash,model:'gpt-6.1-sol',prompt:'synthetic'})}),env);
  const text=await response.text(),events=text.split('\n').filter(l=>l.startsWith('data: {')).map(l=>JSON.parse(l.slice(6))),usage=events.find(e=>e.usage).usage;
  assert.equal(usage.input,1000);assert.equal(usage.output,1000);assert.equal(usage.costUsd,'0.012');assert.equal(usage.ledgerStatus,'recorded');
  const saved=await usageReceipt(env,'tester',usage.id);assert.equal(saved.receipt.costPico,usage.costPico);assert.equal((await usageSummary(env,'tester')).total.calls,1);
});
