import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import worker from './worker.js';

const sha = async text => Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))).toString('hex');
const password = await sha('test-only-access-password');
function setup() {
  const data = new Map();
  const kv = { get: async key => data.get(key) ?? null, put: async (key,value) => data.set(key,value), list: async () => ({keys:[]}) };
  return { data, env: { PASSWORD:'test-only-access-password', ANTHROPIC_API_KEY:'test-only-anthropic', OPENAI_API_KEY:'test-only-openai', GROK_API_KEY:'test-only-xai', GEMINI_API_KEY:'test-only-google', QUICK:'test-only-third-party-must-never-be-used', MEMORY_KV:kv, BIZ_KV:kv } };
}
function stream(events) {
  // Exercise arbitrary UTF-8 chunk boundaries and a final line without a newline.
  const bytes = new TextEncoder().encode(events.map(value=>'data: '+JSON.stringify(value)).join('\n\n'));
  return new Response(new ReadableStream({ start(controller) { for(let offset=0;offset<bytes.length;offset+=7) controller.enqueue(bytes.slice(offset,offset+7)); controller.close(); } }), { headers:{'Content-Type':'text/event-stream'} });
}
const responses = () => stream([
  {type:'response.output_text.delta',delta:'你好'},
  {type:'response.output_text.delta',delta:' world'},
  {type:'response.completed',response:{usage:{input_tokens:11,output_tokens:7},output:[{content:[{text:'你好 world'}]}]}}
]);
function request(model, extra={}) { return new Request('https://api.pickandcase.com/',{method:'POST',body:JSON.stringify({model,prompt:'Test prompt',user:'tester',password,...extra}),headers:{'Content-Type':'application/json'}}); }
function events(text) { return text.split('\n').filter(line=>line.startsWith('data: ')&&line!=='data: [DONE]').map(line=>JSON.parse(line.slice(6))); }
function mockFetch(t, handler) {
  const calls=[];
  t.mock.method(globalThis,'fetch',async (url,options={})=>{ calls.push({url:String(url),options}); assert.ok(['api.anthropic.com','api.openai.com','api.x.ai','generativelanguage.googleapis.com'].includes(new URL(url).hostname),'outbound requests must go to an official host'); assert.equal(options.redirect,'manual','credentials must not follow redirects; this mode is supported by the production runtime'); return handler(String(url),options); });
  return calls;
}

for (const model of ['claude-opus-5-5','claude-sonnet-5-5','grok-4.7']) test(model+' forwards every supported effort to its official API', async t => {
  const {env} = setup();
  const levels = model === 'grok-4.7' ? ['low','medium','high','xhigh'] : ['low','medium','high','xhigh','max'];
  let expected;
  const calls = mockFetch(t, (_url,options) => {
    const body = JSON.parse(options.body);
    if(model.startsWith('claude')) {
      assert.deepEqual(body.output_config,{effort:expected});
      assert.equal(body.thinking,undefined,'retain the model default adaptive thinking');
      assert.equal(body.reasoning,undefined);
      return stream([{type:'content_block_delta',delta:{type:'text_delta',text:'OK'}}]);
    }
    assert.deepEqual(body.reasoning,{effort:expected});
    assert.equal(body.output_config,undefined);
    assert.equal(body.store,false);
    return responses();
  });
  for (expected of levels) {
    const response = await worker.fetch(request(model,{effort:expected,maxOutputTokens:64}),env);
    assert.equal(response.status,200);
    assert.ok(events(await response.text()).some(event=>event.t));
  }
  assert.equal(calls.length,levels.length);
});

test('unsupported effort values fail before a paid upstream request',async t=>{
  const {env}=setup();const calls=mockFetch(t,()=>{throw new Error('unexpected request');});
  for(const [model,effort] of [['grok-4.7','max'],['claude-opus-5-5','ultra'],['claude-sonnet-5-5','disabled'],['claude-sonnet-5-5',null],['claude-sonnet-5-5',{}],['gpt-6-astra','high'],['grok-imagine-image-2.0','high']]) {
    assert.equal((await worker.fetch(request(model,{effort}),env)).status,400);
  }
  assert.equal(calls.length,0);
});

test('omitted effort preserves default provider behavior for cached clients',async t=>{
  const {env}=setup();
  mockFetch(t,(_url,options)=>{
    const body=JSON.parse(options.body);
    assert.equal(body.output_config,undefined);assert.equal(body.reasoning,undefined);
    return responses();
  });
  await (await worker.fetch(request('grok-4.6'),env)).text();
});

test('Anthropic progress follows real thinking and search blocks, with no invented summary',async t=>{
  const {env}=setup();
  mockFetch(t,()=>stream([
    {type:'content_block_start',content_block:{type:'thinking'}},
    {type:'content_block_delta',delta:{type:'thinking_delta',thinking:'公开摘要'}},
    {type:'content_block_start',content_block:{type:'server_tool_use',name:'web_search'}},
    {type:'content_block_start',content_block:{type:'web_search_tool_result'}},
    {type:'content_block_delta',delta:{type:'text_delta',text:'结果'}}
  ]));
  const output=events(await (await worker.fetch(request('claude-sonnet-5-5'),env)).text());
  assert.deepEqual(output.filter(event=>event.status).map(event=>event.status),['thinking','searching','thinking','responding']);
  assert.deepEqual(output.filter(event=>event.r).map(event=>event.r),['公开摘要']);
});

test('Grok progress follows Responses reasoning and search events',async t=>{
  const {env}=setup();
  mockFetch(t,()=>stream([
    {type:'response.output_item.added',item:{type:'reasoning'}},
    {type:'response.reasoning_summary_text.delta',delta:'摘要'},
    {type:'response.web_search_call.in_progress'},
    {type:'response.web_search_call.searching'},
    {type:'response.web_search_call.completed'},
    {type:'response.output_text.delta',delta:'结果'}
  ]));
  const output=events(await (await worker.fetch(request('grok-4.7'),env)).text());
  assert.deepEqual(output.filter(event=>event.status).map(event=>event.status),['thinking','searching','thinking','responding']);
});

for(const [model,host,binding] of [
['grok-4.7','api.x.ai','GROK_API_KEY'],['gpt-6-astra','api.openai.com','OPENAI_API_KEY'],['gpt-5.6-sol','api.openai.com','OPENAI_API_KEY']
]) test(model+' uses the matching official Responses API and key',async t=>{
  const {env,data}=setup();
  const calls=mockFetch(t,(url,options)=>{ assert.equal(new URL(url).hostname,host); assert.equal(options.headers.Authorization,'Bearer '+env[binding]); const body=JSON.parse(options.body); assert.equal(body.model,model); assert.equal(body.store,false); assert.deepEqual(body.tools,[{type:'web_search'}]); return responses(); });
  const response=await worker.fetch(request(model,{search:true}),env);
  const output=events(await response.text());
  assert.equal(output.filter(value=>value.t).map(value=>value.t).join(''),'你好 world');
  assert.deepEqual(output.find(value=>value.usage).usage,{input:11,output:7});
  assert.equal(JSON.parse(data.get('usage:user:tester:official~'+model)).calls,1);
  assert.equal(calls.length,1);
});

for(const model of ['claude-fable-5-1','claude-opus-5','claude-opus-5-5','claude-sonnet-5-5']) test(model+' uses Anthropic and merges stream token usage',async t=>{
  const {env}=setup();
  mockFetch(t,(url,options)=>{ assert.equal(url,'https://api.anthropic.com/v1/messages'); assert.equal(options.headers.Authorization,'Bearer '+env.ANTHROPIC_API_KEY); assert.equal(JSON.parse(options.body).model,model); return stream([{type:'message_start',message:{usage:{input_tokens:23,output_tokens:1}}},{type:'content_block_delta',delta:{type:'text_delta',text:'Claude 官方'}},{type:'message_delta',usage:{output_tokens:9}}]); });
  const output=events(await (await worker.fetch(request(model),env)).text());
  assert.equal(output.filter(value=>value.t).map(value=>value.t).join(''),'Claude 官方');
  assert.deepEqual(output.find(value=>value.usage).usage,{input:23,output:9});
});

for(const model of ['gemini-3.8-flash','gemini-3.1-pro-preview']) test(model+' uses Google without putting its key in the URL',async t=>{
  const {env}=setup();
  mockFetch(t,(url,options)=>{ assert.equal(new URL(url).hostname,'generativelanguage.googleapis.com'); assert.ok(url.includes('/'+model+':streamGenerateContent')); assert.equal(new URL(url).searchParams.has('key'),false); assert.equal(options.headers['x-goog-api-key'],env.GEMINI_API_KEY); return stream([{candidates:[{content:{parts:[{text:'Gemini 官方'}]}}],usageMetadata:{promptTokenCount:13,candidatesTokenCount:6}}]); });
  const output=events(await (await worker.fetch(request(model),env)).text());
  assert.equal(output.find(value=>value.t).t,'Gemini 官方');
  assert.deepEqual(output.find(value=>value.usage).usage,{input:13,output:6});
});

test('Grok image generation uses the official endpoint and counts cost once',async t=>{
  const {env,data}=setup();
  mockFetch(t,(url,options)=>{ assert.equal(url,'https://api.x.ai/v1/images/generations'); assert.equal(options.headers.Authorization,'Bearer '+env.GROK_API_KEY); const body=JSON.parse(options.body); assert.equal(body.response_format,'b64_json'); assert.equal(body.n,2); return Response.json({data:[{b64_json:'aGVsbG8='}],usage:{input_tokens:null,output_tokens:null,cost_in_usd_ticks:400000000}}); });
  const output=events(await (await worker.fetch(request('grok-imagine-image-2.0',{n:2,resolution:'2k'}),env)).text());
  assert.equal(output.find(value=>value.img).img,'aGVsbG8=');
  const usage=JSON.parse(data.get('usage:user:tester:official~grok-imagine-image-2.0'));
  assert.equal(usage.calls,1); assert.equal(usage.cost,0.04);
});

test('OpenAI image generation sends official JSON without unsupported response_format',async t=>{
  const {env}=setup();
  mockFetch(t,(url,options)=>{ assert.equal(url,'https://api.openai.com/v1/images/generations'); assert.equal(options.headers.Authorization,'Bearer '+env.OPENAI_API_KEY); const body=JSON.parse(options.body); assert.equal(body.size,'1536x1024'); assert.equal(body.response_format,undefined); assert.equal(typeof body.safety_identifier,'string'); return Response.json({data:[{b64_json:'aGVsbG8='}]}); });
  const output=events(await (await worker.fetch(request('gpt-image-2.5-sunburst',{aspectRatio:'3:2'}),env)).text());
  assert.equal(output.find(value=>value.img).mime,'image/png');
});

test('OpenAI image editing uploads reference files as multipart data',async t=>{
  const {env}=setup();
  mockFetch(t,(url,options)=>{ assert.equal(url,'https://api.openai.com/v1/images/edits'); assert.equal(options.headers['Content-Type'],undefined); assert.ok(options.body instanceof FormData); assert.equal(options.body.getAll('image[]').length,2); assert.equal(options.body.get('model'),'gpt-image-2.5-sunburst'); return Response.json({data:[{b64_json:'aGVsbG8='}]}); });
  const output=events(await (await worker.fetch(request('gpt-image-2.5-sunburst',{imageTask:'multi-edit',images:[{data:'aGVsbG8=',mime:'image/png'},{data:'aGVsbG8=',mime:'image/jpeg'}]}),env)).text());
  assert.ok(output.some(value=>value.img));
});

test('Google image generation preserves its native response schema',async t=>{
  const {env}=setup();
  mockFetch(t,(url,options)=>{ assert.equal(url,'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image:generateContent'); assert.equal(options.headers['x-goog-api-key'],env.GEMINI_API_KEY); return Response.json({candidates:[{content:{parts:[{text:'描述'},{inlineData:{data:'aGVsbG8=',mimeType:'image/png'}}]}}]}); });
  const output=events(await (await worker.fetch(request('gemini-3.1-flash-image'),env)).text());
  assert.equal(output.find(value=>value.img).img,'aGVsbG8=');
  assert.equal(output.find(value=>value.t).t,'描述');
});

test('third-party and unsupported models never trigger outbound requests',async t=>{
  const {env}=setup(); const calls=mockFetch(t,()=>{throw new Error('unexpected upstream call');});
  for(const model of ['mj_imagine','mj-imagine','mj-action','swap-face','kling25-i2v','sonnet-thinking','opus46-proxy','constructor','__proto__']) {
    const response=await worker.fetch(request(model),env); assert.equal(response.status,400,model);
  }
  assert.equal(calls.length,0);
});

test('missing official keys never fall back to the configured third-party key',async t=>{
  const {env}=setup(); delete env.ANTHROPIC_API_KEY;
  const calls=mockFetch(t,()=>{throw new Error('unexpected upstream call');});
  const response=await worker.fetch(request('claude-fable-5-1'),env);
  assert.equal(response.status,503); assert.match((await response.json()).error,/ANTHROPIC_API_KEY/); assert.equal(calls.length,0);
});

test('official authentication errors are not retried or routed through a proxy',async t=>{
  const {env}=setup(); const calls=mockFetch(t,()=>Response.json({error:{message:'Rejected '+env.OPENAI_API_KEY}},{status:403}));
  const text=await (await worker.fetch(request('gpt-6-astra'),env)).text();
  assert.equal(calls.length,1); assert.match(text,/HTTP 403/); assert.match(text,/\[redacted\]/); assert.ok(!text.includes(env.OPENAI_API_KEY));
});

test('stream errors reach the page instead of being swallowed',async t=>{
  const {env}=setup(); mockFetch(t,()=>stream([{type:'error',error:{message:'upstream stream failure'}}]));
  const text=await (await worker.fetch(request('claude-opus-5'),env)).text(); assert.match(text,/upstream stream failure/);
});

test('provider redirects fail once without forwarding credentials to another host',async t=>{
  const {env}=setup();
  const calls=mockFetch(t,()=>new Response(null,{status:307,headers:{Location:'https://example.invalid/redirect'}}));
  const text=await (await worker.fetch(request('claude-opus-5'),env)).text();
  assert.equal(calls.length,1);
  assert.match(text,/HTTP 307/);
  assert.ok(!text.includes(env.ANTHROPIC_API_KEY));
});

test('worker contains no third-party credential or API references',async()=>{
  const source=await readFile(new URL('./worker.js',import.meta.url),'utf8');
  assert.doesNotMatch(source,/env\.(QUICK|JIEKOU_API_KEY|HAJIMI_API_KEY|MJ_API_KEY)\b/);
  assert.doesNotMatch(source,/https:\/\/(api\.quickrouter\.ai|api\.jiekou\.ai|vip\.aipro\.love|proxy\.pickandcase\.com)/);
});

test('new official usage does not overwrite the previous aggregate',async t=>{
  const {env,data}=setup();
  const original={input:1000,output:200,calls:4};
  data.set('usage:user:tester:gpt-6-astra',JSON.stringify(original));
  mockFetch(t,()=>responses());
  await (await worker.fetch(request('gpt-6-astra'),env)).text();
  assert.deepEqual(JSON.parse(data.get('usage:user:tester:gpt-6-astra')),original);
  assert.equal(JSON.parse(data.get('usage:user:tester:official~gpt-6-astra')).calls,1);
});

test('memory extraction retains the official Anthropic route and stores text only',async t=>{
  const {env,data}=setup();
  mockFetch(t,(url,options)=>{ assert.equal(url,'https://api.anthropic.com/v1/messages'); assert.equal(options.headers.Authorization,'Bearer '+env.ANTHROPIC_API_KEY); return Response.json({content:[{type:'thinking',thinking:'not memory'},{type:'text',text:'User prefers concise answers.'}]}); });
  const response=await worker.fetch(new Request('https://api.pickandcase.com/memory',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({user:'tester',password,conversation:'A test-only conversation'})}),env);
  assert.equal(response.status,200);
  assert.equal(data.get('mem:tester'),'User prefers concise answers.');
});

test('failed official memory requests leave the existing saved memory unchanged',async t=>{
  const {env,data}=setup(); data.set('mem:tester','Existing memory');
  mockFetch(t,()=>Response.json({error:{message:'Request not allowed'}},{status:403}));
  const response=await worker.fetch(new Request('https://api.pickandcase.com/memory',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({user:'tester',password,conversation:'A test-only conversation'})}),env);
  assert.equal(response.status,500); assert.equal(data.get('mem:tester'),'Existing memory');
});

test('optional Cloudflare native gateway keeps OpenAI credentials, streaming and privacy controls',async t=>{
  const {env}=setup(); env.OPENAI_GATEWAY_ID='aiarena-official';
  const directCalls=mockFetch(t,()=>{throw new Error('unexpected direct or proxy fallback');});
  const gatewayCalls=[];
  env.AI={async fetch(url,options){
    assert.equal(this,env.AI);
    gatewayCalls.push({url,options});
    assert.equal(url,'https://workers-binding.ai/ai-gateway/gateways/aiarena-official/openai/v1/responses');
    assert.equal(options.headers.get('authorization'),'Bearer '+env.OPENAI_API_KEY);
    assert.equal(options.headers.get('cf-aig-collect-log'),'false');
    assert.equal(options.headers.get('cf-aig-collect-log-payload'),'false');
    assert.equal(options.headers.get('cf-aig-no-wholesale'),'true');
    assert.equal(options.headers.get('cf-aig-max-attempts'),'1');
    assert.equal(options.redirect,'manual');
    assert.equal(JSON.parse(options.body).model,'gpt-6-astra');
    return responses();
  }};
  const output=events(await (await worker.fetch(request('gpt-6-astra'),env)).text());
  assert.equal(output.filter(value=>value.t).map(value=>value.t).join(''),'你好 world');
  assert.equal(gatewayCalls.length,1); assert.equal(directCalls.length,0);
});

test('optional gateway uploads OpenAI edit files without converting multipart to JSON',async t=>{
  const {env}=setup(); env.OPENAI_GATEWAY_ID='aiarena-official';
  const directCalls=mockFetch(t,()=>{throw new Error('unexpected fallback');});
  let calls=0;
  env.AI={async fetch(url,options){
    calls++;
    assert.ok(url.endsWith('/openai/v1/images/edits'));
    assert.ok(options.body instanceof FormData);
    assert.equal(options.body.getAll('image[]').length,2);
    assert.equal(options.headers.has('Content-Type'),false);
    assert.equal(options.headers.get('authorization'),'Bearer '+env.OPENAI_API_KEY);
    return Response.json({data:[{b64_json:'aGVsbG8='}]});
  }};
  const output=events(await (await worker.fetch(request('gpt-image-2.5-sunburst',{imageTask:'multi-edit',images:[{data:'aGVsbG8=',mime:'image/png'},{data:'aGVsbG8=',mime:'image/jpeg'}]}),env)).text());
  assert.ok(output.some(value=>value.img)); assert.equal(calls,1); assert.equal(directCalls.length,0);
});

test('missing gateway binding or rejected gateway authentication never falls back',async t=>{
  const {env}=setup(); env.OPENAI_GATEWAY_ID='aiarena-official';
  const directCalls=mockFetch(t,()=>{throw new Error('unexpected fallback');});
  const missing=await (await worker.fetch(request('gpt-6-astra'),env)).text();
  assert.match(missing,/绑定尚未配置/);
  let calls=0;
  env.AI={async fetch(){calls++;return Response.json({error:{message:'Rejected '+env.OPENAI_API_KEY}},{status:403});}};
  const rejected=await (await worker.fetch(request('gpt-6-astra'),env)).text();
  assert.match(rejected,/HTTP 403/); assert.match(rejected,/\[redacted\]/);
  assert.ok(!rejected.includes(env.OPENAI_API_KEY));
  assert.equal(calls,1); assert.equal(directCalls.length,0);
});


test('short output limits bound real model verification requests without changing the default ceiling',async t=>{
  const {env}=setup();
  const calls=mockFetch(t,(url,options)=>{
    const payload=JSON.parse(options.body);
    assert.equal(payload.model,'claude-opus-5-5');
    assert.equal(payload.max_tokens,1024);
    assert.notEqual(payload.thinking?.type,'disabled');
    return stream([{type:'content_block_delta',delta:{type:'thinking_delta',thinking:'brief reasoning'}},{type:'content_block_delta',delta:{type:'text_delta',text:'OK'}}]);
  });
  const result=events(await(await worker.fetch(request('claude-opus-5-5',{maxOutputTokens:1024}),env)).text());
  assert.equal(result.filter(x=>x.t).map(x=>x.t).join(''),'OK');
  assert.equal(calls.length,1);
});

test('invalid output limits fail before any paid provider call',async t=>{
  const {env}=setup();const calls=mockFetch(t,()=>{throw new Error('unexpected paid call');});
  for(const maxOutputTokens of [0,31,-1,1024.5,128001,'1024',null]){
    const response=await worker.fetch(request('claude-sonnet-5-5',{maxOutputTokens}),env);
    assert.equal(response.status,400);
  }
  assert.equal(calls.length,0);
});


test('cached Grok 4.6 clients upgrade to 4.7 with the actual model name and usage key',async t=>{
  const {env,data}=setup();
  mockFetch(t,(url,options)=>{assert.equal(JSON.parse(options.body).model,'grok-4.7');return responses();});
  const output=events(await(await worker.fetch(request('grok-4.6'),env)).text());
  assert.equal(output.find(row=>row.modelName).modelName,'Grok 4.7');
  assert.equal(JSON.parse(data.get('usage:user:tester:official~grok-4.7')).calls,1);
  assert.equal(data.has('usage:user:tester:official~grok-4.6'),false);
});
