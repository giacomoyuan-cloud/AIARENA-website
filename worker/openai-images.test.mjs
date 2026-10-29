import test from 'node:test';
import assert from 'node:assert/strict';
import worker from './worker.js';
import {buildImagePayload,readImageStream} from './openai-images.js';

const models=['gpt-image-2.5-sunburst','gpt-image-2.5-flare'];
const image={data:'aGVsbG8=',mime:'image/png'};
const password=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode('synthetic-image-password'))).toString('hex');
function env(){const data=new Map(),kv={get:async key=>data.get(key)||null,put:async(key,value)=>data.set(key,value)};return {PASSWORD:'synthetic-image-password',OPENAI_API_KEY:'test-only-openai-key',BIZ_KV:kv,MEMORY_KV:kv};}
function request(model,extra={}){return new Request('https://api.pickandcase.com/',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password,model,prompt:'Draw a blue circle',...extra})});}
function stream(items){const bytes=new TextEncoder().encode(items.map(e=>'data: '+JSON.stringify(e)).join('\n\n'));return new Response(new ReadableStream({start(c){for(let i=0;i<bytes.length;i+=13)c.enqueue(bytes.slice(i,i+13));c.close();}}),{headers:{'Content-Type':'text/event-stream'}});}
function generated(){const item={id:'ig_test',type:'image_generation_call',result:'aGVsbG8=',output_format:'webp',revised_prompt:'A simple blue circle',size:'1536x864',quality:'xhigh',background:'transparent'};return stream([
  {type:'response.image_generation_call.partial_image',partial_image_index:0,partial_image_b64:'cHJldmlldw==',output_format:'webp'},
  {type:'response.output_item.done',item},
  {type:'response.completed',response:{status:'completed',output:[item],usage:{input_tokens:12,output_tokens:8}}}
]);}
function events(body){return body.split('\n').filter(s=>s.startsWith('data: ')&&!s.includes('[DONE]')).map(s=>JSON.parse(s.slice(6)));}

for(const model of models)test(model+' supports generation, previews, transparency, details and saved edit context',async t=>{
  const calls=[];t.mock.method(globalThis,'fetch',async(url,opts)=>{calls.push({url,opts});return generated();});
  const output=events(await (await worker.fetch(request(model,{size:'1536x864',quality:'xhigh',outputFormat:'webp',background:'transparent',outputCompression:72,moderation:'low',partialImages:3}),env())).text());
  assert.equal(output.find(e=>e.error)?.error,undefined);
  assert.equal(calls.length,1);assert.equal(calls[0].url,'https://api.openai.com/v1/responses');assert.equal(calls[0].opts.redirect,'manual');
  const p=JSON.parse(calls[0].opts.body);assert.equal(p.model,'gpt-6.1-sol');assert.equal(p.store,false);
  assert.deepEqual(p.tools,[{type:'image_generation',model,action:'generate',size:'1536x864',quality:'xhigh',output_format:'webp',background:'transparent',moderation:'low',partial_images:3,output_compression:72}]);
  assert.deepEqual(p.tool_choice,{type:'image_generation'});assert.equal(p.max_tool_calls,1);
  assert.equal(output.filter(e=>e.img).length,1,'completed event never duplicates the image');
  assert.equal(output.find(e=>e.imagePreview).imagePreview.data,'cHJldmlldw==');
  assert.equal(output.find(e=>e.img).mime,'image/webp');
  assert.equal(output.find(e=>e.imageDetails).imageDetails.revisedPrompt,'A simple blue circle');
  assert.deepEqual(output.find(e=>e.imageContext).imageContext.parts,[{imageIndex:0}]);
  assert.equal(output.filter(e=>e.imageUsage).at(-1).imageUsage.mainline.input,12);assert.equal(output.filter(e=>e.imageUsage).at(-1).imageUsage.imageCostAvailable,false);
  assert.equal(output.at(-1).usage.schemaVersion,2);assert.equal(output.at(-1).usage.model,model);assert.equal(output.at(-1).usage.input,null);assert.equal(output.at(-1).usage.costUsd,null);
});

test('invalid image settings, incompatible transparency and malformed masks never call the paid API',async t=>{
  let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;throw new Error('must not call');});
  for(const extra of [{size:'3840x3840'},{size:'1025x1024'},{size:'512x512'},{size:'3840x1024'},{quality:'ultra'},{outputFormat:'gif'},{background:'transparent',outputFormat:'jpeg'},{outputCompression:50},{outputFormat:'webp',outputCompression:101},{partialImages:4},{moderation:'off'},{n:0},{n:11},{thinkingLevel:'high'},{imageMask:{data:'aGVsbG8=',mime:'image/png'}},{imageTask:'multi-edit',images:Array(17).fill(image)}]){
    assert.equal((await worker.fetch(request(models[0],extra),env())).status,400,JSON.stringify(extra).slice(0,100));
  }
  assert.equal(calls,0);
});

test('successive edits keep the selected image first, retain prior requirements, and avoid duplicate history bytes',()=>{
  const body={imageTask:'edit',size:'auto'},history=[{role:'user',parts:[{text:'Keep the logo exact'},{inlineData:{data:'b2xk',mimeType:'image/png'}}]},{role:'model',parts:[{inlineData:{data:image.data,mimeType:image.mime}}]}];
  const p=buildImagePayload(models[0],'Change only the background',body,[image],history,'anonymous-hash');
  const c=p.input[0].content;
  assert.equal(c.find(p=>p.type==='input_image').image_url,'data:image/png;base64,'+image.data);
  assert.equal(c.filter(p=>p.type==='input_image').length,2);assert.ok(c.some(p=>p.text?.includes('Keep the logo exact')));
  assert.ok(c.at(-1).text.includes('Change only the background'));assert.equal(p.tools[0].action,'edit');assert.equal(p.previous_response_id,undefined);
});

test('multi-image edits accept 16 explicit references and batches retain each completed image without retries',async t=>{
  const calls=[];t.mock.method(globalThis,'fetch',async(_url,opts)=>{calls.push(JSON.parse(opts.body));return generated();});
  const output=events(await (await worker.fetch(request(models[1],{imageTask:'multi-edit',images:Array(16).fill(image),n:3}),env())).text());
  assert.equal(output.find(e=>e.error)?.error,undefined);
  assert.equal(calls.length,3);assert.equal(calls[0].input[0].content.filter(p=>p.type==='input_image').length,16);
  assert.equal(output.filter(e=>e.img).length,3);assert.deepEqual(output.filter(e=>e.imageDetails).map(e=>e.imageDetails.index),[0,1,2]);
  assert.deepEqual(output.filter(e=>e.imageContext).at(-1).imageContext.parts,[{imageIndex:0},{imageIndex:1},{imageIndex:2}]);
});

test('a failed second variant preserves the first result and never starts a third or repeats a billed call',async t=>{
  let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return calls===1?generated():Response.json({error:{message:'insufficient_quota'}},{status:429});});
  const output=events(await (await worker.fetch(request(models[0],{n:3}),env())).text());
  assert.equal(calls,2);assert.equal(output.filter(e=>e.img).length,1);assert.match(output.find(e=>e.error).error,/429|insufficient_quota/);
  assert.equal(output.filter(e=>e.imageUsage).at(-1).imageUsage.mainline.input,null,'missing failed-attempt usage is not reported as zero or omitted');
});

test('stream interruption preserves final images but never promotes previews to final results',async()=>{
  const finals=[],previews=[];
  const options={image:d=>finals.push(d),preview:p=>previews.push(p),details:()=>{}};
  await assert.rejects(readImageStream(stream([{type:'response.image_generation_call.partial_image',partial_image_b64:'cHJldmlldw==',partial_image_index:0}]),options),/中断/);
  assert.equal(finals.length,0);assert.equal(previews.length,1);
  await assert.rejects(readImageStream(stream([{type:'response.output_item.done',item:{type:'image_generation_call',result:image.data}}]),options),/中断/);
  assert.deepEqual(finals,[image.data]);
});

test('moderation failures keep the stable provider code and never silently report image success',async()=>{
  await assert.rejects(readImageStream(stream([{type:'response.failed',response:{error:{code:'moderation_blocked',message:'Blocked'}}}]),{image:()=>{},preview:()=>{},details:()=>{}}),/moderation_blocked/);
});

test('the mask stays on the first current image when history includes a different source',()=>{
  const p=buildImagePayload(models[0],'Replace the selected area',{imageTask:'edit',imageMask:{data:'bWFzaw=='}},[image],[{role:'user',parts:[{inlineData:{data:'b2xk',mimeType:'image/png'}}]}],'hash');
  assert.deepEqual(p.tools[0].input_image_mask,{image_url:'data:image/png;base64,bWFzaw=='});
  assert.equal(p.input[0].content.find(p=>p.type==='input_image').image_url,'data:image/png;base64,'+image.data);
});
