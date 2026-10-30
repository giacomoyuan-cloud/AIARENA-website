import test from 'node:test';
import assert from 'node:assert/strict';
import worker from './worker.js';
import { OpenAITransport } from './openai-transport.js';
const password='synthetic-failover-password';
const hash=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(password))).toString('hex');
function fixture(name){
  const data=new Map(),kv={get:async key=>data.get(key)||null,put:async(key,value)=>data.set(key,value),list:async()=>({keys:[]})};
  return {data,env:{PASSWORD:password,OPENAI_API_KEY:'primary-'+name,OPENAI_API_KEY_BACKUP:'backup-'+name,MEMORY_KV:kv,BIZ_KV:kv}};
}
const quota=()=>Response.json({error:{code:'credit_balance_exhausted',type:'insufficient_quota'}},{status:429});
const stream=events=>new Response(events.map(e=>'data: '+JSON.stringify(e)+'\n\n').join(''),{headers:{'Content-Type':'text/event-stream'}});
const success=()=>stream([{type:'response.output_text.delta',delta:'synthetic success'},{type:'response.completed',response:{usage:{input_tokens:10,output_tokens:2},output:[]}}]);
const req=(model,extra={})=>new Request('https://api.pickandcase.com/',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:hash,model,prompt:'Synthetic failover only',...extra})});
const authorization=options=>new Headers(options.headers).get('authorization');

for(const gateway of [false,true])test('text quota failover and cooldown through '+(gateway?'native Gateway':'direct official transport'),async t=>{
  const {env,data}=fixture(gateway?'gateway':'direct'),calls=[];
  const provider=async(url,options)=>{
    calls.push({url,options});
    assert.equal(options.redirect,'manual');
    return authorization(options)==='Bearer '+env.OPENAI_API_KEY?quota():success();
  };
  if(gateway){env.OPENAI_GATEWAY_ID='test-private-gateway';env.AI={fetch:provider};}
  t.mock.method(globalThis,'fetch',gateway?async()=>{throw Error('Gateway must not call direct fetch')}:provider);
  for(let index=0;index<2;index++){
    const text=await(await worker.fetch(req('gpt-6.1-sol'),env)).text();
    assert.ok(text.includes('synthetic success'));assert.ok(!text.includes('"error"'));
  }
  assert.deepEqual(calls.map(c=>authorization(c.options)),['Bearer '+env.OPENAI_API_KEY,'Bearer '+env.OPENAI_API_KEY_BACKUP,'Bearer '+env.OPENAI_API_KEY_BACKUP]);
  assert.equal(calls[0].options.body,calls[1].options.body);
  assert.ok([...data.keys()].some(key=>/^openai-key-health:v1:[a-f0-9]{64}$/.test(key)));
});
test('OpenAI 429 rate limits and 5xx do not trigger the outer generic provider retry loop',async t=>{
  for(const status of [429,500]){
    const {env}=fixture('nonquota-'+status);let calls=0;
    t.mock.method(globalThis,'fetch',async()=>{calls++;return Response.json({error:{code:'rate_limit_exceeded',message:'synthetic rejection'}},{status});});
    const text=await(await worker.fetch(req('gpt-6.1-sol'),env)).text();
    assert.match(text,/synthetic rejection/);assert.equal(calls,1);
  }
});
test('image quota rejection switches once; completed image is emitted once with unchanged tool settings',async t=>{
  const {env}=fixture('images'),calls=[],item={id:'synthetic_image',type:'image_generation_call',result:'aGVsbG8=',output_format:'png',size:'1024x1024',quality:'medium'};
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    calls.push(options);
    return authorization(options)==='Bearer '+env.OPENAI_API_KEY?quota():stream([
      {type:'response.output_item.done',item},
      {type:'response.completed',response:{status:'completed',output:[item],usage:{input_tokens:8,output_tokens:3}}}
    ]);
  });
  const text=await(await worker.fetch(req('gpt-image-2.5-flare',{size:'1024x1024',quality:'medium'}),env)).text();
  assert.equal(calls.length,2);assert.equal(calls[0].body,calls[1].body);
  assert.equal(text.split('"img":').length-1,1);assert.ok(!text.includes('"error"'));
});
for(const countOnly of [false,true])test('US background actor switches quota credentials for '+(countOnly?'token counting':'generation'),async t=>{
  const {env}=fixture('us-'+countOnly),actor=new OpenAITransport({storage:{setAlarm:async()=>{}}},env),calls=[];
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    calls.push({url,options});
    return authorization(options)==='Bearer '+env.OPENAI_API_KEY?quota():countOnly?Response.json({input_tokens:20}):success();
  });
  const request=(path,value)=>new Request('https://openai-dispatch.internal'+path,{method:'POST',body:JSON.stringify(value||{})});
  const body=JSON.stringify({model:'gpt-6.1-sol',input:'Synthetic body',stream:!countOnly});
  await actor.fetch(request('/start',{body,countOnly}));await actor.alarm();
  const response=await actor.fetch(request('/stream'));
  assert.equal(response.status,200);assert.equal(calls.length,2);
  assert.equal(calls[0].options.body,calls[1].options.body);
  assert.equal(calls[1].url,'https://api.openai.com/v1/responses'+(countOnly?'/input_tokens':''));
  await response.text();
});
test('backup-only configurations work and backup provider error messages are redacted',async t=>{
  const {env}=fixture('backup-only');delete env.OPENAI_API_KEY;
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    assert.equal(authorization(options),'Bearer '+env.OPENAI_API_KEY_BACKUP);
    return Response.json({error:{message:'rejected '+env.OPENAI_API_KEY_BACKUP}},{status:401});
  });
  const text=await(await worker.fetch(req('gpt-6.1-sol'),env)).text();
  assert.ok(!text.includes(env.OPENAI_API_KEY_BACKUP));assert.match(text,/redacted/);
});
