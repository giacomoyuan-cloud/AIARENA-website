import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import worker from './worker.js';
import Limits from '../arena-token-limits.js';
import Context from '../arena-context.js';
import {fitTokenBudget,countInputTokens} from './token-budget.js';

const pass='offline-account-hash';
function setup(){
  const data=new Map([['user:tester',JSON.stringify({hash:pass})]]),reads=[];
  const kv={get:async key=>{reads.push(key);return data.get(key)||null;},put:async(k,v)=>data.set(k,v)};
  return {data,reads,env:{MEMORY_KV:kv,BIZ_KV:kv,ANTHROPIC_API_KEY:'offline-claude',GROK_API_KEY:'offline-xai',OPENAI_API_KEY:'offline-openai',GEMINI_API_KEY:'offline-google'}};
}
const req=(model,fields={})=>new Request('https://api.pickandcase.com/',{method:'POST',body:JSON.stringify({user:'tester',password:pass,model,prompt:'offline input',...fields})});
const stream=events=>new Response(events.map(e=>'data: '+JSON.stringify(e)+'\n\n').join(''),{headers:{'Content-Type':'text/event-stream'}});
const bodyText=payload=>JSON.stringify(payload.messages||payload.input||payload.contents||payload);
test('budget compaction protects the current document task and its entire native tool chain',async()=>{
  const tail=[{role:'user',content:'CURRENT_DOCUMENT_TASK'},{role:'assistant',content:[{type:'tool_result',text:'ACTUAL_TOOL_RESULT'}]}];
  const payload={messages:[{role:'user',content:'a'.repeat(1000000)},{role:'assistant',content:'old answer'},...tail]};
  const fitted=await fitTokenBudget({provider:'anthropic',model:'claude-opus-5-5',payload,env:{},outputTokens:128000,protectedTail:2,fetcher:async()=>Response.json({input_tokens:900000})});
  assert.deepEqual(fitted.payload.messages,tail);assert.equal(fitted.dropped,2);
});
test('a large single upstream body delta remains complete after recovery-safe event splitting',async t=>{
  const f=setup(),expected='x'.repeat(8191)+'😀'+('正文'.repeat(70000));
  t.mock.method(globalThis,'fetch',async()=>stream([{type:'content_block_delta',delta:{type:'text_delta',text:expected}}]));
  const wire=await(await worker.fetch(req('claude-opus-5-5'),f.env)).text();
  const events=wire.split('\n').filter(l=>l.startsWith('data: ')&&!l.endsWith('[DONE]')).map(l=>JSON.parse(l.slice(6)));
  assert.equal(events.map(e=>e.t||'').join(''),expected);assert.ok(events.filter(e=>e.t).every(e=>Buffer.byteLength(JSON.stringify(e))<120000));
});
function provider(t,calls,{count=1000}={}){
  t.mock.method(globalThis,'fetch',async(url,options={})=>{
    url=String(url);const payload=options.body?JSON.parse(options.body):null;calls.push({url,payload,options});
    assert.equal(options.redirect,'manual');
    if(url.endsWith('/count_tokens'))return Response.json({input_tokens:typeof count==='function'?count(payload):count});
    if(url.endsWith('/input_tokens'))return Response.json({input_tokens:typeof count==='function'?count(payload):count});
    if(url.endsWith(':countTokens'))return Response.json({totalTokens:typeof count==='function'?count(payload):count});
    if(url.endsWith('/tokenize-text'))return Response.json({token_ids:Array(count).fill(1)});
    if(url.endsWith('/interactions'))return Response.json({id:'v1_offline_interaction',status:'in_progress'});
    if(url.includes('/interactions/'))return stream([{event_type:'step.delta',event_id:'evt_text',delta:{type:'text',text:'完整正文'}},{event_type:'interaction.completed',event_id:'evt_done',interaction:{status:'completed',usage:{total_input_tokens:1000,total_cached_tokens:400,total_output_tokens:4,total_thought_tokens:3}}}]);
    return stream([url.includes('anthropic')?{type:'content_block_delta',delta:{type:'text_delta',text:'完整正文'}}:url.includes('googleapis')?{candidates:[{content:{parts:[{text:'完整正文'}]}}]}:{type:'response.output_text.delta',delta:'完整正文'}]);
  });
}

test('read-only limits endpoint exposes the exact registry used for requests without a provider call',async t=>{
  t.mock.method(globalThis,'fetch',()=>{throw Error('No network permitted');});
  const response=await worker.fetch(new Request('https://api.pickandcase.com/model-limits'),{});
  const data=await response.json();assert.equal(data.historyPolicy,'full-history-first');assert.deepEqual(data.models,Limits.models);
  assert.equal(data.models['claude-opus-5-5'].contextTokens,1000000);assert.equal(data.models['claude-opus-5-5'].maxOutputTokens,128000);
  assert.equal(data.models['gpt-6.1-sol'].maxInputTokens,922000);assert.equal(data.models['grok-4.7'].contextTokens,500000);
});

for(const model of Object.keys(Limits.models))test(model+' defaults to its documented output ceiling and correct native protocol',async t=>{
  const f=setup(),calls=[];provider(t,calls);
  const text=await(await worker.fetch(req(model),f.env)).text();assert.match(text,/完整正文/);
  const long=Limits.get(model).longDecode;
  const actual=calls.find(c=>long?c.url.endsWith('/interactions'):!/(count_tokens|input_tokens|countTokens|tokenize-text)$/.test(c.url)).payload;
  const max=actual.max_tokens||actual.max_output_tokens||actual.generationConfig?.maxOutputTokens||actual.generation_config?.max_output_tokens;
  assert.equal(max,long?1048576-1000-1024:Limits.get(model).maxOutputTokens);
  if(long){assert.equal(actual.background,true);assert.equal(actual.generation_config.thinking_summaries,'auto');assert.equal(calls.filter(c=>c.url.endsWith('/interactions')).length,1);}
  assert.equal(actual.output_config?.effort||actual.reasoning?.effort||actual.generationConfig?.thinkingConfig?.thinkingLevel||actual.generation_config?.thinking_level,undefined,'token capacity must not change reasoning effort');
});

test('saved originals, long answers and pasted attachments all survive full-history selection',async t=>{
  const f=setup(),calls=[];provider(t,calls);
  const pasted='PASTED_START '+('x'.repeat(50000))+' PASTED_END';
  const history=Array.from({length:40},(_,i)=>({uid:i+1,isUser:i%2===0,text:i===0?'FIRST_USER_FULL':i===1?'LONG_ANSWER_START '+('a'.repeat(20000))+' LONG_ANSWER_END':'record '+i}));
  history[0].pastedTexts=[pasted];f.data.set('chats:tester:history-123',JSON.stringify(history));
  const before=f.data.get('chats:tester:history-123');
  const response=await worker.fetch(req('claude-opus-5-5',{chat:{scope:'general',chatId:'history-123',question:'current question',history:[],historyLength:40,historyEndUid:'40'}}),f.env);
  const output=await response.text(),actual=calls[0].payload;
  assert.equal(calls.length,1);assert.equal(actual.messages.length,41);
  assert.ok(actual.messages[0].content.endsWith('PASTED_END'));assert.ok(actual.messages[0].content.includes(pasted));
  assert.ok(actual.messages[1].content.endsWith('LONG_ANSWER_END'));assert.match(output,/"historyPolicy":"full"/);
  assert.equal(f.data.get('chats:tester:history-123'),before);
});
test('recoverable user messages preserve long quotes and every accepted pasted attachment',async t=>{
  const f=setup();let submitted;
  t.mock.method(globalThis,'fetch',()=>{throw Error('No provider call permitted');});
  f.env.CHAT_RUNS={idFromName:value=>value,get:()=>({fetch:async request=>{submitted=await request.json();return Response.json({status:'running'},{status:202});}})};
  const quote='QUOTE_START '+('q'.repeat(15000))+' QUOTE_END',pasted=Array.from({length:15},(_,i)=>'完整附件 '+i);
  const payload={model:'claude-opus-5-5',chat:{scope:'general',chatId:'quote-history-123',question:'current '+quote+' '+pasted.join(' '),history:[]},recovery:{replyUid:2,userMessage:{uid:1,text:'current',topicText:'current',_quote:{author:'Original author',text:quote},pastedTexts:pasted}}};
  const response=await worker.fetch(new Request('https://api.pickandcase.com/chat-runs',{method:'POST',body:JSON.stringify({user:'tester',password:pass,action:'start',runId:'quote-run-123',chatId:'quote-history-123',payload})}),f.env);
  assert.equal(response.status,202);assert.equal(submitted.recovery.userMessage._quote.text,quote);assert.deepEqual(submitted.recovery.userMessage.pastedTexts,pasted);
  const full=Context.fullHistory([submitted.recovery.userMessage]).messages[0].text;assert.ok(full.includes(quote));assert.ok(full.includes('Original author'));assert.ok(full.endsWith('完整附件 14'));
});

test('browser carries all original text in incognito instead of only eight clipped messages',()=>{
  const source=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const code=source.match(/  function scopedChatInput\([^]*?\n  }/)[0];
  const messages=Array.from({length:30},(_,i)=>({uid:i+1,isUser:i%2===0,text:'record '+i+' '+('x'.repeat(5000))}));messages.push({uid:31,isUser:true,text:'current'});
  const sandbox={ArenaContext:Context,msgs:messages,skillsRuntime:{settings:()=>({mode:'off',ids:[]})},activeProjectId:null,currentChatId:'private-123',_incognitoMode:true,chatSystemMode:()=>'',getActiveSubmodels:()=>['claude-opus-5-5']};
  vm.runInNewContext(code+';result=scopedChatInput("current","","");',sandbox);
  assert.equal(sandbox.result.history.length,30);assert.ok(sandbox.result.history[0].text.endsWith('x'.repeat(5000)));assert.equal(sandbox.result.notes,'');
});

test('native counting near capacity preserves the largest fitting complete history without an auxiliary generation',async t=>{
  const f=setup(),calls=[];provider(t,calls,{count:p=>Math.ceil(bodyText(p).length/4)+100});
  const history=Array.from({length:20},(_,i)=>({uid:i+1,isUser:i%2===0,text:'RECORD_'+i+' '+('a'.repeat(180000))}));
  const saved=JSON.stringify(history);f.data.set('chats:tester:history-123',saved);
  const output=await(await worker.fetch(req('claude-opus-5-5',{chat:{scope:'general',chatId:'history-123',question:'current',history:[]}}),f.env)).text();
  const generated=calls.filter(c=>c.url==='https://api.anthropic.com/v1/messages');assert.equal(generated.length,1);
  assert.ok(calls.some(c=>c.url.endsWith('/count_tokens')));assert.equal(generated[0].payload.messages.length,19);
  assert.ok(generated[0].payload.messages[0].content.startsWith('RECORD_2 '));assert.match(output,/"historyPolicy":"compacted"/);
  assert.match(output,/"tokenCountMethod":"provider"/);assert.equal(f.data.get('chats:tester:history-123'),saved);
});

test('a current question that cannot fit fails before any generation and never silently clips it',async t=>{
  const f=setup(),calls=[];provider(t,calls,{count:1000000});
  const output=await(await worker.fetch(req('claude-opus-5-5',{chat:{scope:'general',question:'a'.repeat(1000000),history:[]}}),f.env)).text();
  assert.match(output,/未提交生成请求/);assert.equal(calls.length,1);assert.ok(calls[0].url.endsWith('/count_tokens'));
});

test('counter errors and malformed responses fail closed without any generation',async()=>{
  const payload={model:'claude-opus-5-5',messages:[{role:'user',content:'a'.repeat(1000000)}]};
  for(const reply of [Response.json({error:'unavailable'},{status:503}),Response.json({input_tokens:'not a count'})]){
    let calls=0;await assert.rejects(fitTokenBudget({provider:'anthropic',model:payload.model,payload,outputTokens:128000,env:{},fetcher:async()=>{calls++;return reply;}}),/未提交生成请求/);assert.equal(calls,1);
  }
});

test('all four native counting endpoints use the matching schema, headers and no generation path',async()=>{
  for(const provider of ['anthropic','openai','google','xai']){
    let captured;const total=await countInputTokens({provider,model:'model-id',payload:{messages:[],input:[],contents:[],system:'rules',instructions:'rules',systemInstruction:{parts:[{text:'rules'}]}},env:{},fetcher:async(url,options)=>{captured={url,body:JSON.parse(options.body)};return Response.json({input_tokens:99,totalTokens:99,token_ids:Array(99).fill(1)});}});
    assert.equal(total,provider==='xai'?1123:99);assert.match(captured.url,/count_tokens|input_tokens|countTokens|tokenize-text/);
    if(provider==='google')assert.equal(captured.body.generateContentRequest.model,'models/model-id');
  }
});

test('incognito Argon stays on the non-stored synchronous transport while retaining full text history',async t=>{
  const f=setup(),calls=[];provider(t,calls);
  const output=await(await worker.fetch(req('gemini-4-argon',{chat:{scope:'general',incognito:true,question:'current',history:Array.from({length:20},(_,i)=>({role:i%2?'assistant':'user',text:'record '+i}))}}),f.env)).text();
  assert.equal(calls.length,1);assert.ok(calls[0].url.includes(':streamGenerateContent'));assert.equal(calls[0].payload.generationConfig.maxOutputTokens,65536);assert.equal(calls[0].payload.contents.length,21);assert.match(output,/"historyPolicy":"full"/);
});
test('long decode retains cached-input and thinking counters in exactly one rich billing receipt',async t=>{
  const f=setup(),calls=[];provider(t,calls);
  const wire=await(await worker.fetch(req('gemini-4-argon'),f.env)).text();
  const usages=wire.split('\n').filter(l=>l.startsWith('data: ')&&!l.endsWith('[DONE]')).map(l=>JSON.parse(l.slice(6))).filter(e=>e.usage).map(e=>e.usage);
  assert.equal(usages.length,1);assert.equal(usages[0].schemaVersion,2);assert.equal(usages[0].input,1000);assert.equal(usages[0].output,7);assert.equal(usages[0].details.cachedInput,400);
});
