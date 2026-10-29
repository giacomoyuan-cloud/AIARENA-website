const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const B=require('./arena-billing.js'),UI=require('./arena-billing-ui.js');
const at=Date.parse('2026-10-30T12:00:00Z');
const responses=(input=1000,output=1000)=>({input_tokens:input,output_tokens:output,input_tokens_details:{cached_tokens:0,cache_write_tokens:0,cache_write_tokens_details:{ttl_30m_tokens:0,ttl_12h_tokens:0}},output_tokens_details:{reasoning_tokens:300}});
const options={at,id:'test-receipt-001'};

test('every official enabled model and the internal summary model has a sourced rate card',()=>{
  const source=fs.readFileSync('worker/worker.js','utf8');
  const block=source.slice(source.indexOf('const OFFICIAL_MODELS'),source.indexOf('const MODEL_EFFORT_LEVELS'));
  const ids=[...block.matchAll(/"([^"]+)": \{ provider:/g)].map(m=>m[1]).concat('claude-haiku-4-5-20251001');
  for(const id of ids){assert.ok(B.MODELS[id],id);assert.ok(['developers.openai.com','platform.claude.com','ai.google.dev','docs.x.ai'].includes(new URL(B.MODELS[id].source).hostname),id);}
});
test('all seven selectable text models use their separately verified Standard rates',()=>{
  const cases=[
    ['claude-fable-5-1',{input_tokens:1000,output_tokens:1000},'0.06'],
    ['claude-opus-5-5',{input_tokens:1000,output_tokens:1000},'0.024'],
    ['claude-sonnet-5-5',{input_tokens:1000,output_tokens:1000},'0.012'],
    ['gpt-6-astra',responses(),'0.06'],['gpt-6.1-sol',responses(),'0.012'],
    ['grok-4.7',responses(),'0.008'],
    ['gemini-4-argon',{promptTokenCount:1000,candidatesTokenCount:700,thoughtsTokenCount:300},'0.012']
  ];
  for(const [model,raw,cost]of cases){const r=B.receipt(model,raw,options);assert.equal(r.costUsd,cost,model);assert.equal(r.input,1000);assert.equal(r.output,1000);assert.equal(r.billingComplete,true);}
});
test('Anthropic input includes reads and both cache-write lifetimes, not only uncached input',()=>{
  const r=B.receipt('claude-fable-5-1',{input_tokens:1000,output_tokens:2000,cache_read_input_tokens:4000,cache_creation_input_tokens:5000,cache_creation:{ephemeral_5m_input_tokens:3000,ephemeral_1h_input_tokens:2000}},options);
  assert.equal(r.input,10000);assert.equal(r.output,2000);assert.equal(r.costUsd,'0.1885');
});
test('OpenAI mixed 30m and 12h writes are removed from ordinary input and charged once',()=>{
  const r=B.receipt('gpt-6.1-sol',{input_tokens:12000,output_tokens:2000,input_tokens_details:{cached_tokens:4000,cache_write_tokens:7000,cache_write_tokens_details:{ttl_30m_tokens:3000,ttl_12h_tokens:4000}},output_tokens_details:{reasoning_tokens:500}},options);
  assert.equal(r.details.uncachedInput,1000);assert.equal(r.output,2000);assert.equal(r.costUsd,'0.0499');
});
test('OpenAI output already includes reasoning, and tool fees are not multiplied by Fast token pricing',()=>{
  const r=B.receipt('gpt-6.1-sol',responses(),{...options,serviceTier:'fast',searches:2});
  assert.equal(r.output,1000);assert.equal(r.costUsd,'0.044');
});
test('long context boundaries charge the whole request at the correct input and output rates',()=>{
  const short=B.receipt('gpt-6.1-sol',responses(272000,1000),options),long=B.receipt('gpt-6.1-sol',responses(272001,1000),options);
  assert.equal(short.costUsd,'0.554');assert.equal(long.costUsd,'1.103004');
  assert.equal(B.receipt('grok-4.7',responses(199999,1000),options).costUsd,'0.405998');
  assert.equal(B.receipt('grok-4.7',responses(200000,1000),options).costUsd,'0.812');
});
test('Gemini 4 advertised promotional rates stop applying after their published end date',()=>{
  const raw={promptTokenCount:100000,cachedContentTokenCount:20000,candidatesTokenCount:2500,thoughtsTokenCount:500};
  assert.equal(B.receipt('gemini-4-argon',raw,{at:Date.parse('2026-11-30T12:00:00Z')}).costUsd,'0.192');
  assert.equal(B.receipt('gemini-4-argon',raw,{at:Date.parse('2026-12-01T12:00:00Z')}).costUsd,'0.384');
});
test('Nano Banana prices image output separately from text and thinking',()=>{
  const r=B.receipt('gemini-nano-banana-2.1',{promptTokenCount:100,candidatesTokenCount:1140,thoughtsTokenCount:50,candidatesTokensDetails:[{modality:'IMAGE',tokenCount:1120},{modality:'TEXT',tokenCount:20}],totalTokenCount:1290},options);
  assert.equal(r.input,100);assert.equal(r.output,1190);assert.equal(r.costUsd,'0.034275');
});
test('missing image modality counters never turn into a guessed per-image charge',()=>{
  const r=B.receipt('gemini-nano-banana-2.1',{promptTokenCount:100,candidatesTokenCount:1140,thoughtsTokenCount:50},{...options,imagesGenerated:1,imageSize:'1K'});
  assert.equal(r.costUsd,null);assert.equal(r.knownCostUsd,'0.00015');assert.equal(r.billingComplete,false);
});
test('a zero-image blocked response can still report real billable input',()=>{
  const r=B.receipt('gemini-nano-banana-2.1',{promptTokenCount:100,candidatesTokenCount:0,thoughtsTokenCount:0},options);
  assert.equal(r.costUsd,'0.00015');
});
test('Gemini tool input is counted and shared free search allowance is never guessed',()=>{
  const r=B.receipt('gemini-4-argon',{promptTokenCount:100,candidatesTokenCount:20,thoughtsTokenCount:10,toolUsePromptTokenCount:50,totalTokenCount:180},{...options,searches:2,groundingUsed:true});
  assert.equal(r.input,150);assert.equal(r.output,30);assert.equal(r.costUsd,null);assert.equal(r.knownCostUsd,'0.0006');assert.ok(r.notes.includes('google_search_free_allowance_unknown'));
});
test('xAI official ticks override all computed token/tool prices without adding fees twice',()=>{
  const r=B.receipt('grok-4.7',{input_tokens:199,output_tokens:1,cost_in_usd_ticks:'37756000'},{...options,searches:3});
  assert.equal(r.costUsd,'0.0037756');assert.equal(r.costPico,'3775600000');assert.equal(r.costBasis,'provider');
  assert.equal(r.items.length,1);assert.equal(r.items[0].kind,'providerAmount');
});
test('an official image charge does not invent input/output token counts',()=>{
  const r=B.receipt('grok-imagine-image-2.0',{input_tokens:null,output_tokens:null,cost_in_usd_ticks:400000000},{...options,imagesGenerated:1});
  assert.equal(r.costUsd,'0.04');assert.equal(r.input,null);assert.equal(r.output,null);assert.equal(r.billingComplete,true);
});
test('reported zero is distinct from unavailable usage or unavailable cost',()=>{
  assert.equal(B.receipt('grok-4.7',{input_tokens:0,output_tokens:0,cost_in_usd_ticks:0},options).costUsd,'0.00');
  const r=B.receipt('grok-4.7',null,options);assert.equal(r.costUsd,null);assert.equal(r.input,null);assert.equal(r.output,null);assert.match(B.label(r),/待结算/);
});
test('unreported cache allocation and interrupted usage never become a full bill',()=>{
  const r=B.receipt('gpt-6.1-sol',{input_tokens:5000,output_tokens:1000},options);
  assert.equal(r.costUsd,null);assert.equal(r.knownCostUsd,'0.01');
  const partial=B.receipt('grok-4.7',{input_tokens:1,output_tokens:1,cost_in_usd_ticks:1000},{...options,incompleteUsage:true});
  assert.equal(partial.costUsd,null);assert.equal(partial.usageComplete,false);
});
test('invalid and inconsistent counters cannot double-charge input',()=>{
  const r=B.receipt('gpt-6.1-sol',{input_tokens:12000,output_tokens:1000,input_tokens_details:{cached_tokens:4000,cache_write_tokens:7000,cache_write_tokens_details:{ttl_30m_tokens:3000,ttl_12h_tokens:3000}}},options);
  assert.equal(r.billingComplete,false);assert.equal(r.knownCostUsd,'0.01');
  const invalid=B.receipt('gemini-4-argon',{promptTokenCount:-5,candidatesTokenCount:'20'},options);
  assert.equal(invalid.costUsd,null);assert.equal(invalid.input,null);
});
test('unknown models are unpriced rather than assigned zero or another model price',()=>{
  const r=B.receipt('unknown-future-model',responses(),{...options,provider:'openai'});
  assert.equal(r.costUsd,null);assert.ok(r.notes.includes('model_price_unverified'));
});
test('auxiliary model fees survive serialization and repeated receipt enrichment exactly once',()=>{
  const main=B.receipt('gpt-6.1-sol',responses(),options),aux=B.receipt('claude-haiku-4-5-20251001',{input_tokens:100,output_tokens:100},{...options,id:'aux-receipt-001',purpose:'memory'});
  const first=B.combine(main,[aux]);assert.equal(first.costUsd,'0.0126');assert.equal(first.input,1000);
  const restored=JSON.parse(JSON.stringify(first)),second=B.combine(restored,[aux]);assert.equal(second.costUsd,'0.0126');assert.equal(second.auxiliary.length,1);
  assert.equal(B.combine(restored,[]).costUsd,'0.0126');
});
test('the app consumes the server receipt without consulting manual browser prices',()=>{
  const source=fs.readFileSync('index.html','utf8'),start=source.indexOf('  function applyMessageUsage('),end=source.indexOf('  function refreshMessageUsage(',start);
  const ctx=vm.createContext({ArenaBilling:B,refreshMessageUsage(){},localStorage:{getItem(){throw new Error('manual prices must not be read');}}});
  vm.runInContext(source.slice(start,end),ctx);
  const m={};ctx.applyMessageUsage(m,B.receipt('gpt-6.1-sol',responses(),options));assert.equal(m.usageCost,0.012);
  const old={usage:{input:12,output:5}};ctx.applyMessageUsage(old,{cost:0.01});assert.equal(old.usage.input,12);assert.equal(old.usage.output,5);assert.match(old.usageStr,/历史费用未核实/);
  assert.doesNotMatch(source,/aa-model-prices|DEFAULT_TOKEN_PRICES/);
});
test('the receipt UI preserves exact USD decimals, handles legacy records, and escapes untrusted strings',()=>{
  const r=B.receipt('grok-4.7',{input_tokens:199,output_tokens:1,cost_in_usd_ticks:37756000},options),html=UI.render(JSON.parse(JSON.stringify(r)));
  assert.match(html,/0\.0037756/);assert.match(html,/输入 199/);assert.match(html,/已含工具费用/);
  const old=UI.render({input:12,output:6},'<img src=x onerror=alert(1)>');assert.match(old,/历史/);assert.doesNotMatch(old,/<img/);assert.match(old,/&lt;img/);
  assert.match(B.label({...r,knownCostPico:'bad'}),/需核实/);
});
