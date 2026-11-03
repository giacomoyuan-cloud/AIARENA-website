import test from 'node:test';
import assert from 'node:assert/strict';
import {completeContextSummary} from './context-summary.js';
import {SUMMARY_SCHEMA} from './conversation-context.js';

const result={goals:[{text:'保留用户决定',sourceUids:['u1'],attribution:'user'}],constraints:[],decisions:[],rejected:[],completed:[],pending:[],uncertainties:[]};
const text=JSON.stringify(result);
const fixtures={
  anthropic:{model:'claude-opus-5-5',env:{ANTHROPIC_API_KEY:'offline'},events:[{type:'message_start',message:{usage:{input_tokens:101,output_tokens:0}}},{type:'content_block_delta',delta:{type:'text_delta',text}},{type:'message_delta',delta:{stop_reason:'end_turn'},usage:{output_tokens:44}},{type:'message_stop'}]},
  google:{model:'gemini-4-argon',env:{GEMINI_API_KEY:'offline'},events:[{candidates:[{content:{parts:[{text:'internal thought',thought:true},{text}]},finishReason:'STOP'}],usageMetadata:{promptTokenCount:101,candidatesTokenCount:44}}]},
  xai:{model:'grok-4.7',env:{GROK_API_KEY:'offline'},events:[{type:'response.output_text.delta',delta:text},{type:'response.completed',response:{status:'completed',usage:{input_tokens:101,output_tokens:44}}}]},
  openai:{model:'gpt-6-astra',env:{OPENAI_API_KEY:'offline'},events:[{type:'response.output_text.delta',delta:text},{type:'response.completed',response:{status:'completed',usage:{input_tokens:101,output_tokens:44}}}]}
};
for(const [provider,f] of Object.entries(fixtures))test(provider+' checkpoints stay with their selected provider and record cumulative usage once',async()=>{
  const receipts=[];let request;
  const value=await completeContextSummary({...f,provider,prompt:'source data',schema:SUMMARY_SCHEMA,fetcher:async(url,init)=>{request={url,payload:JSON.parse(init.body)};return new Response('');},readStream:async(_,handle)=>{for(const e of f.events)await handle(e);},recordUsage:async(...args)=>receipts.push(args)});
  assert.deepEqual(value,result);assert.equal(receipts.length,1);assert.equal(receipts[0][2].provider,provider);assert.equal(receipts[0][2].incompleteUsage,false);
  if(provider==='anthropic'){assert.match(request.url,/api.anthropic.com/);assert.equal(request.payload.model,'claude-haiku-5-5');assert.equal(request.payload.thinking.type,'disabled');assert.deepEqual(request.payload.output_config.format.schema,SUMMARY_SCHEMA);assert.equal(receipts[0][1].input_tokens,101);assert.equal(receipts[0][1].output_tokens,44);}
  if(provider==='google'){assert.match(request.url,/gemini-4-argon:streamGenerateContent/);assert.deepEqual(request.payload.generationConfig.responseJsonSchema,SUMMARY_SCHEMA);assert.equal(request.payload.generationConfig.maxOutputTokens,8192);}
  if(provider==='xai'){assert.match(request.url,/api.x.ai/);assert.equal(request.payload.service_tier,undefined);}
  if(provider==='openai'){assert.match(request.url,/api.openai.com/);assert.equal(request.payload.model,'gpt-6.1-sol');assert.equal(request.payload.reasoning.effort,'low');}
});
test('an incomplete checkpoint never retries and is billed as uncertain without returning partial JSON',async()=>{
  let calls=0;const receipts=[];
  await assert.rejects(completeContextSummary({...fixtures.anthropic,provider:'anthropic',prompt:'source',schema:SUMMARY_SCHEMA,fetcher:async()=>{calls++;return new Response('');},readStream:async(_,handle)=>{await handle(fixtures.anthropic.events[0]);await handle(fixtures.anthropic.events[1]);},recordUsage:async(...args)=>receipts.push(args)}),/未完整/);
  assert.equal(calls,1);assert.equal(receipts.length,1);assert.equal(receipts[0][2].incompleteUsage,true);
});
