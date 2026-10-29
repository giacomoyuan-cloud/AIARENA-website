import test from 'node:test';
import assert from 'node:assert/strict';
import {longDecodePayload,runGoogleLongDecode,cancelGoogleInteraction} from './google-long-decode.js';
const base={contents:[{role:'user',parts:[{inline_data:{data:'aGVsbG8=',mime_type:'image/png'}},{text:'question'}]},{role:'model',parts:[{text:'previous answer'}]}],systemInstruction:{parts:[{text:'system rules'}]},generationConfig:{maxOutputTokens:1000000,thinkingConfig:{thinkingLevel:'HIGH'}},tools:[{google_search:{}}]};
const sse=items=>new Response(items.map(item=>'data: '+JSON.stringify(item)+'\n\n').join(''),{headers:{'Content-Type':'text/event-stream'}});
const finished=(status='completed')=>({event_type:'interaction.completed',event_id:'evt_final',interaction:{status,usage:{total_input_tokens:100,total_output_tokens:20,total_thought_tokens:30}}});
const run=extra=>runGoogleLongDecode({model:'gemini-4-argon',payload:base,env:{GEMINI_API_KEY:'offline-only-key'},send:async()=>{},pause:async()=>{},...extra});
test('a terminal status never skips body events that follow it in the replay stream',async()=>{
  const events=[];let calls=0;
  await run({send:async e=>events.push(e),fetcher:async(url,options)=>{calls++;return options.method==='POST'?Response.json({id:'v1_offline_interaction'}):sse([{event_type:'interaction.status_update',event_id:'evt_status',status:'completed',usage:{total_input_tokens:1,total_output_tokens:2,total_thought_tokens:3}},{event_type:'step.delta',event_id:'evt_body',delta:{type:'text',text:'完整正文在状态之后'}}]);}});
  assert.equal(calls,2);assert.equal(events.map(e=>e.t||'').join(''),'完整正文在状态之后');assert.equal(events.findLast(e=>e.diagnostics?.providerCompleted).diagnostics.providerCompleted,true);
});
test('long decode translates the documented step, image, effort and search schema without losing history',()=>{
  const payload=longDecodePayload('gemini-4-argon',base);
  assert.equal(payload.background,true);assert.equal(payload.store,true);assert.equal(payload.system_instruction,'system rules');
  assert.deepEqual(payload.input,[{type:'user_input',content:[{type:'image',data:'aGVsbG8=',mime_type:'image/png'},{type:'text',text:'question'}]},{type:'model_output',content:[{type:'text',text:'previous answer'}]}]);
  assert.deepEqual(payload.generation_config,{max_output_tokens:1000000,thinking_summaries:'auto',thinking_level:'high'});assert.deepEqual(payload.tools,[{type:'google_search'}]);
});
test('stream reconnect resumes the same interaction after status-event IDs, retaining every thought summary and body chunk once',async()=>{
  const calls=[],events=[],usage=[];let reads=0;
  await run({send:async value=>events.push(value),recordUsage:async(...value)=>usage.push(value),fetcher:async(url,options)=>{
    calls.push({url:String(url),options});
    if(options.method==='POST'){assert.ok(String(url).endsWith('/interactions'));return Response.json({id:'v1_offline_interaction'});}
    reads++;
    return reads===1?sse([{event_type:'step.delta',event_id:'evt_thought',delta:{type:'thought_summary',content:{type:'text',text:'摘要'}}},{event_type:'step.delta',event_id:'evt_first',delta:{type:'text',text:'第一段'}},{event_type:'interaction.status_update',event_id:'evt_status',status:'in_progress'}]):sse([{event_type:'step.delta',event_id:'evt_first',delta:{type:'text',text:'第一段'}},{event_type:'step.delta',event_id:'evt_second',delta:{type:'text',text:'第二段'}},finished()]);
  }});
  assert.equal(calls.filter(c=>c.options.method==='POST').length,1);assert.equal(reads,2);
  assert.equal(new URL(calls[2].url).searchParams.get('last_event_id'),'evt_status');
  assert.equal(events.map(e=>e.t||'').join(''),'第一段第二段');assert.equal(events.map(e=>e.r||'').join(''),'摘要');
  assert.deepEqual(usage.map(v=>v.slice(0,3)),[['gemini-4-argon',100,50]]);assert.deepEqual(usage[0][3].rawUsage,{promptTokenCount:100,cachedContentTokenCount:0,candidatesTokenCount:20,thoughtsTokenCount:30});assert.deepEqual(events.findLast(e=>e.usage).usage,{input:100,output:50});
});
test('creation rejection and lost acknowledgements never issue a second paid POST',async()=>{
  for(const failure of ['http','network']){
    let calls=0;await assert.rejects(run({fetcher:async()=>{calls++;if(failure==='network')throw Error('connection lost');return Response.json({error:'unavailable'},{status:503});}}));assert.equal(calls,1);
  }
});
test('a fatal provider event cancels that interaction without repeated polling or a new generation',async()=>{
  const calls=[];
  await assert.rejects(run({fetcher:async(url,options)=>{calls.push({url:String(url),options});if(String(url).endsWith('/cancel'))return Response.json({status:'cancelled'});return options.method==='POST'?Response.json({id:'v1_offline_interaction'}):sse([{event_type:'error',error:{code:'internal_error'}}]);}}),/返回错误/);
  assert.equal(calls.length,3);assert.equal(calls.filter(c=>c.url.endsWith('/interactions')).length,1);assert.equal(calls.filter(c=>c.url.endsWith('/cancel')).length,1);
});
test('Stop cancels the existing provider interaction and retains partial usage without starting another generation',async()=>{
  const controller=new AbortController(),calls=[],events=[],usage=[];
  await assert.rejects(run({signal:controller.signal,send:async value=>{events.push(value);if(value.t)controller.abort(new DOMException('Stopped','AbortError'));},recordUsage:async(...v)=>usage.push(v),fetcher:async(url,options)=>{
    calls.push({url:String(url),options});
    if(String(url).endsWith('/cancel'))return Response.json({status:'cancelled',usage:{total_input_tokens:4,total_output_tokens:2,total_thought_tokens:3}});
    if(options.method==='POST')return Response.json({id:'v1_offline_interaction'});
    return new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('data: '+JSON.stringify({event_type:'step.delta',event_id:'evt_first',delta:{type:'text',text:'已收到正文'}})+'\n\n'));options.signal.addEventListener('abort',()=>c.error(options.signal.reason),{once:true});}}));
  }}),/Stopped/);
  assert.equal(calls.filter(c=>c.url.endsWith('/interactions')).length,1);assert.equal(calls.filter(c=>c.url.endsWith('/cancel')).length,1);
  assert.equal(events.map(e=>e.t||'').join(''),'已收到正文');assert.deepEqual(usage.map(v=>v.slice(0,3)),[['gemini-4-argon',4,5]]);assert.equal(usage[0][3].incompleteUsage,true);assert.equal(events.findLast(e=>e.usage).usage.partial,true);
});
test('an exhausted budget surfaces incomplete with the retained original body and partial usage, without a paid continuation',async()=>{
  const events=[],calls=[];
  await assert.rejects(run({send:async e=>events.push(e),fetcher:async(url,options)=>{calls.push({url:String(url),options});return options.method==='POST'?Response.json({id:'v1_offline_interaction'}):sse([{event_type:'step.delta',delta:{type:'text',text:'保留原文'}},finished('incomplete')]);}}),/用完本轮/);
  assert.equal(calls.length,2);assert.equal(events.map(e=>e.t||'').join(''),'保留原文');assert.equal(events.findLast(e=>e.usage).usage.partial,true);
});
test('large native chunks are split below the recovery-log event bound without breaking Unicode',async()=>{
  const expected='x'.repeat(8191)+'😀'+('长正文'.repeat(50000)),events=[];
  await run({send:async e=>events.push(e),fetcher:async(url,options)=>options.method==='POST'?Response.json({id:'v1_offline_interaction'}):sse([{event_type:'step.delta',delta:{type:'text',text:expected}},finished()])});
  assert.equal(events.map(e=>e.t||'').join(''),expected);assert.ok(events.filter(e=>e.t).every(e=>new TextEncoder().encode(JSON.stringify(e)).length<120000));
});
test('interrupt cleanup only targets a validated existing interaction ID',async()=>{
  let calls=0;const fetcher=async(url,options)=>{calls++;assert.match(url,/\/v1_existing_run\/cancel$/);assert.equal(options.method,'POST');return Response.json({status:'cancelled'});};
  assert.equal(await cancelGoogleInteraction('../../escape',{},fetcher),false);assert.equal(calls,0);
  assert.equal(await cancelGoogleInteraction('v1_existing_run',{},fetcher),true);assert.equal(calls,1);
});
