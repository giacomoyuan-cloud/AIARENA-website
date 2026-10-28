import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import worker from './worker.js';
const require=createRequire(import.meta.url),A=require('../arena-image.js');
const source=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const workerSource=readFileSync(new URL('./worker.js',import.meta.url),'utf8');
const hash=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode('contract-test-password'))).toString('hex');
const image={data:'aGVsbG8=',mime:'image/png'};
function fn(name){return source.match(new RegExp('  function '+name+'\\([^]*?\\n  }'))[0];}
function setup(){const data=new Map();const kv={get:async k=>data.get(k)||null,put:async(k,v)=>data.set(k,v)};return {MEMORY_KV:kv,BIZ_KV:kv,PASSWORD:'contract-test-password',GEMINI_API_KEY:'test-only-google',GROK_API_KEY:'test-only-xai',ANTHROPIC_API_KEY:'test-only-claude'};}
function browser(env){
 const payloads=[],output=[],meta=[];
 const context=vm.createContext({
   ArenaImage:A,AbortController,TextDecoder,Promise,Set,console,window:{},
   WORKER:'https://api.pickandcase.com/',getPass:()=>hash,$:()=>({value:'synthetic-tester'}),
   searchOn:true,activeProjectId:null,activeStreamControllers:new Set(),abortF:false,imageMode:true,
   updateThinkStatus:()=>{},appendThinkSummary:()=>{},effortFor:m=>context.effortSelection?.[m],
   fetchWithRetry:async(url,opts)=>{payloads.push(JSON.parse(opts.body));return worker.fetch(new Request(url,opts),env);}
 });
 vm.runInContext(source.slice(source.indexOf('  function callWorkerStream'),source.indexOf('  var durableDebateView=')),context);
 return {payloads,output,meta,context,send:(model,opts={},prompt='synthetic contract test')=>new Promise((resolve,reject)=>context.callWorkerStream(model,prompt,null,null,t=>output.push(t),resolve,reject,()=>{},()=>{},opts,event=>meta.push(event)))};
}
function imageResponse(){return Response.json({candidates:[{content:{parts:[{text:'result',thoughtSignature:'text-signature'},{inlineData:{data:image.data,mimeType:image.mime},thoughtSignature:'encrypted-signature+/='}]}}],usageMetadata:{promptTokenCount:5,candidatesTokenCount:6,thoughtsTokenCount:7}});}

test('browser → Worker → official Google request covers every exposed image setting',async t=>{
 const env=setup(),b=browser(env);let upstream;
 t.mock.method(globalThis,'fetch',async(url,options)=>{assert.equal(url,'https://generativelanguage.googleapis.com/v1beta/models/gemini-nano-banana-2.1:generateContent');upstream=JSON.parse(options.body);return imageResponse();});
 const c=A.cap(A.GOOGLE_MODEL);
 for(const [key,values] of Object.entries({size:c.sizes,ratio:c.ratios,thinking:c.thinking,grounding:['off','web','image','web-image'],imageOnly:[false,true]})){
  for(const value of values){
   const state={size:'1K',ratio:'1:1',thinking:'medium',grounding:'off',imageOnly:false,[key]:value};
   await b.send(A.GOOGLE_MODEL,A.requestOptions(A.GOOGLE_MODEL,'generation',state,[]));
   const s=A.normalize(A.GOOGLE_MODEL,state);
   assert.equal(b.payloads.at(-1)[{size:'imageSize',ratio:'aspectRatio',thinking:'thinkingLevel',grounding:'grounding',imageOnly:'imageOnly'}[key]],value);
   assert.deepEqual(upstream.generationConfig,{responseModalities:s.imageOnly?['IMAGE']:['TEXT','IMAGE'],imageConfig:{aspectRatio:s.ratio,imageSize:s.size},thinkingConfig:{thinkingLevel:s.thinking.toUpperCase()}});
   const types={};if(s.grounding.includes('web'))types.webSearch={};if(s.grounding.includes('image'))types.imageSearch={};
   assert.deepEqual(upstream.tools,s.grounding==='off'?undefined:[{google_search:{searchTypes:types}}]);
  }
 }
 assert.ok(b.output.some(value=>value.includes('"output":13')),'thought tokens count toward output usage');
 assert.deepEqual(JSON.parse(JSON.stringify(b.meta.find(m=>m.imageContext).imageContext.parts)),[{text:'result',thoughtSignature:'text-signature'},{imageIndex:0,thoughtSignature:'encrypted-signature+/='}]);
});

test('browser → Worker → xAI uses every exposed ratio, resolution, quality and count',async t=>{
 const b=browser(setup());let upstream;
 t.mock.method(globalThis,'fetch',async(url,options)=>{assert.equal(url,'https://api.x.ai/v1/images/generations');upstream=JSON.parse(options.body);return Response.json({data:[{b64_json:image.data}]});});
 const model='grok-imagine-image-2.0',c=A.cap(model);
 for(const [key,values] of Object.entries({size:c.sizes,ratio:c.ratios,quality:c.quality,count:[1,2,3,4]}))for(const value of values){
  const s={size:'1k',ratio:'1:1',quality:'auto',count:1,[key]:value};
  await b.send(model,A.requestOptions(model,'generation',s,[]));
  assert.equal(upstream[{size:'resolution',ratio:'aspect_ratio',quality:'quality',count:'n'}[key]],value);
  assert.equal(upstream.model,model);assert.equal(upstream.response_format,'b64_json');
 }
});

test('Grok single-image and multi-image edits reach the official edit endpoint',async t=>{
 const b=browser(setup());let actual;
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  assert.equal(url,'https://api.x.ai/v1/images/edits');actual=JSON.parse(options.body);
  return Response.json({data:[{b64_json:image.data}]});
 });
 for(const [task,count] of [['edit',1],['multi-edit',2],['multi-edit',5]]){
  await b.send('grok-imagine-image-2.0',A.requestOptions('grok-imagine-image-2.0',task,{size:'2k',ratio:'2:3',quality:'medium',count:4},Array(count).fill(image)));
  const references=task==='edit'?[actual.image]:actual.images;
  assert.equal(references.length,count);assert.ok(references.every(x=>x.url==='data:image/png;base64,'+image.data));
  assert.equal(actual.n,undefined);assert.equal(actual.aspect_ratio,'2:3');assert.equal(actual.quality,'medium');
 }
});

test('reference requests send image bytes only once outside signed history',async t=>{
 const b=browser(setup());
 t.mock.method(globalThis,'fetch',async()=>imageResponse());
 const reference={...image,preview:'data:image/png;base64,'+image.data,autoFollowup:true};
 await b.send(A.GOOGLE_MODEL,A.requestOptions(A.GOOGLE_MODEL,'edit',{},[reference]));
 const payload=b.payloads.at(-1);
 assert.deepEqual(payload.images,[image]);assert.equal(payload.image,null);
 assert.equal(payload._imgs,undefined);assert.equal(JSON.stringify(payload).includes(reference.preview),false);
});

test('browser stream parses a final unterminated event and surfaces malformed events',async()=>{
 const b=browser(setup());
 b.context.fetchWithRetry=async()=>new Response('data: '+JSON.stringify({img:image.data,mime:image.mime}));
 await b.send(A.GOOGLE_MODEL);assert.ok(b.output.some(chunk=>chunk.includes(image.data)));
 b.context.fetchWithRetry=async()=>new Response('data: {broken json}\n\ndata: [DONE]\n\n');
 await assert.rejects(b.send(A.GOOGLE_MODEL),/解析|格式/);
 b.context.fetchWithRetry=async()=>new Response('data: '+JSON.stringify({error:'模拟图片生成失败'})+'\n\ndata: [DONE]\n\n');
 await assert.rejects(b.send(A.GOOGLE_MODEL),/模拟图片生成失败/);
 b.context.fetchWithRetry=async()=>new Response('data: '+JSON.stringify({img:image.data,mime:image.mime})+'\n\ndata: [DONE]\n\n');
 await assert.rejects(new Promise((resolve,reject)=>b.context.callWorkerStream(A.GOOGLE_MODEL,'test',null,null,()=>{throw new Error('render failed');},resolve,reject,()=>{},()=>{},{})),/render failed/);
});

test('selected style reaches Google in the actual prompt and does not leak into Grok',async t=>{
 const b=browser(setup());let actual;
 const style=vm.createContext({sub:A.GOOGLE_MODEL,nbStylePreset:'photo',topic:'A blue ceramic cup',_imgs:[],imageMode:true,topicWithQuote:'A blue ceramic cup'});
 vm.runInContext(source.slice(source.indexOf('  var NB_STYLE_PROMPTS'),source.indexOf('  var NB_STYLE_TEMPLATES')),style);
 const code=['_nbStylePrefix','_topicWithStyle','_topicForPrompt','fullPrompt'].map(name=>source.match(new RegExp('var '+name+' = [^\\n]+'))[0]).join('\n');
 t.mock.method(globalThis,'fetch',async(url,options)=>{actual=JSON.parse(options.body);return imageResponse();});
 vm.runInContext(code,style);
 await b.send(A.GOOGLE_MODEL,A.requestOptions(A.GOOGLE_MODEL,'generation',{},[]),style.fullPrompt);
 assert.equal(actual.contents[0].parts.at(-1).text,style.NB_STYLE_PROMPTS.photo+style.topic);
 style.nbStylePreset='none';vm.runInContext(code,style);assert.equal(style.fullPrompt,style.topic);
 style.nbStylePreset='photo';style.sub='grok-imagine-image-2.0';vm.runInContext(code,style);assert.equal(style.fullPrompt,style.topic);
});

test('the attachment search switch toggles actual Google tools, not just its visual state',async t=>{
 const b=browser(setup());b.context.imageMode=false;let click,actual;const attributes={};
 b.context.$=id=>id==='aaPlusSearch'?{addEventListener:(name,handler)=>{click=handler;},setAttribute:(name,value)=>{attributes[name]=value;}}:{value:'synthetic-tester'};
 const start=source.indexOf("  $('aaPlusSearch').addEventListener('click'");
 vm.runInContext(source.slice(start,source.indexOf('\n  });',start)+6),b.context);
 t.mock.method(globalThis,'fetch',async(url,options)=>{actual=JSON.parse(options.body);return new Response('data: '+JSON.stringify({candidates:[{content:{parts:[{text:'ok'}]}}]})+'\n\n');});
 click();assert.equal(attributes['aria-checked'],'false');await b.send('gemini-4-argon');
 assert.equal(b.payloads.at(-1).search,false);assert.equal(actual.tools,undefined);
 click();assert.equal(attributes['aria-checked'],'true');await b.send('gemini-4-argon');
 assert.equal(b.payloads.at(-1).search,true);assert.deepEqual(actual.tools,[{google_search:{}}]);
});

test('all chat effort controls reach their provider; unsupported levels fail before fetch',async t=>{
 const b=browser(setup());b.context.imageMode=false;b.context.effortSelection={};
 vm.runInContext(source.slice(source.indexOf('  var EFFORT_LEVELS'),source.indexOf('  var SUBS')),b.context);
 Object.assign(b.context,{aaRunning:false,saveState:()=>{},syncArenaLayout:()=>{}});
 vm.runInContext(fn('setArenaEffort')+'\n'+fn('updateArenaEffortFromSlider'),b.context);
 let calls=0,actual;
 t.mock.method(globalThis,'fetch',async(url,options)=>{calls++;actual=JSON.parse(options.body);return new Response('data: '+JSON.stringify(url.includes('anthropic')?{type:'content_block_delta',delta:{type:'text_delta',text:'ok'}}:url.includes('googleapis')?{candidates:[{content:{parts:[{text:'ok'}]}}]}:{type:'response.output_text.delta',delta:'ok'})+'\n\n');});
 for(const [model,levels] of Object.entries(b.context.EFFORT_LEVELS))for(const level of levels){
  assert.equal(b.context.updateArenaEffortFromSlider({dataset:{effortModel:model},value:String(levels.indexOf(level))}),true);await b.send(model);
  assert.equal(model.startsWith('claude')?actual.output_config.effort:model.startsWith('gemini')?actual.generationConfig.thinkingConfig.thinkingLevel.toLowerCase():actual.reasoning.effort,level);
  assert.equal(actual.max_tokens||actual.max_output_tokens||actual.generationConfig.maxOutputTokens,model.startsWith('gemini')?65536:128000);
 }
 const count=calls;
 for(const [model,extra] of [[A.GOOGLE_MODEL,{imageSize:'512'}],[A.GOOGLE_MODEL,{thinkingLevel:'low'}],[A.GOOGLE_MODEL,{grounding:'automatic'}],['grok-imagine-image-2.0',{resolution:'4k'}],['grok-imagine-image-2.0',{quality:'high'}],['gemini-4-argon',{effort:'max'}],['grok-4.7',{effort:'max'}]]){
  const response=await worker.fetch(new Request('https://api.pickandcase.com/',{method:'POST',body:JSON.stringify({user:'tester',password:hash,model,prompt:'test',...extra})}),setup());
  assert.equal(response.status,400);
 }
 assert.equal(calls,count);
});

test('native conversational edits retain exact signed parts after serialization, with 14/5 reference limits',async t=>{
 const env=setup(),b=browser(env);let upstream;
 t.mock.method(globalThis,'fetch',async(url,options)=>{upstream=JSON.parse(options.body);return imageResponse();});
 const first={uid:1,submodel:A.GOOGLE_MODEL,imgItems:[image],imageTurn:{prompt:'blue cube',parentUid:null,references:[]},imageResponse:[{text:'result',thoughtSignature:'sig-A'},{imageIndex:0,thoughtSignature:'sig-B'}]};
 const second={uid:2,submodel:A.GOOGLE_MODEL,imgItems:[image],imageTurn:{prompt:'make it green',parentUid:1,references:[{uid:1,index:0}]},imageResponse:[{imageIndex:0,thoughtSignature:'sig-C'}]};
 const messages=JSON.parse(JSON.stringify([first,second]));
 const history=A.historyFor(messages,2);
 await b.send(A.GOOGLE_MODEL,A.requestOptions(A.GOOGLE_MODEL,'edit',{size:'2K'},[image],history));
 assert.equal(upstream.contents.length,5);assert.equal(upstream.contents[1].parts[1].thoughtSignature,'sig-B');assert.equal(upstream.contents[3].parts[0].thoughtSignature,'sig-C');assert.deepEqual(upstream.contents[3].parts[0].inlineData,{data:image.data,mimeType:image.mime});
 await b.send(A.GOOGLE_MODEL,A.requestOptions(A.GOOGLE_MODEL,'multi-edit',{},Array(14).fill(image)));
 assert.equal(upstream.contents[0].parts.length,15);
 for(const [model,count] of [[A.GOOGLE_MODEL,15],['grok-imagine-image-2.0',6]]){
  const response=await worker.fetch(new Request('https://api.pickandcase.com/',{method:'POST',body:JSON.stringify({password:hash,model,prompt:'test',imageTask:'multi-edit',images:Array(count).fill(image)})}),env);assert.equal(response.status,400);
 }
});

test('Google grounding exposes containing-page attribution, search suggestions and real search activity',async t=>{
 const b=browser(setup());
 t.mock.method(globalThis,'fetch',async()=>{
  const data=await imageResponse().json();
  data.candidates[0].groundingMetadata={groundingChunks:[
   {web:{uri:'https://example.com/facts',title:'Facts'}},
   {image:{sourceUri:'https://example.com/photo-page',imageUri:'https://example.com/raw.jpg',title:'Photo source'}},
   {image:{source_uri:'https://example.com/second-page',image_uri:'https://example.com/second.jpg',domain:'example.com'}},
   {image:{uri:'https://example.com/legacy-page',image_uri:'https://example.com/legacy.jpg'}},
   {image:{imageUri:'https://example.com/raw-without-attribution.jpg'}},
   {image:{sourceUri:'javascript:alert(1)',imageUri:'https://example.com/unsafe.jpg'}},
   {web:{uri:'javascript:alert(1)'}}
  ],imageSearchQueries:['blue cube'],searchEntryPoint:{renderedContent:'<div>Google</div>'}};
  return Response.json(data);
 });
 await b.send(A.GOOGLE_MODEL,A.requestOptions(A.GOOGLE_MODEL,'generation',{grounding:'web-image'},[]));
 assert.deepEqual(b.meta.filter(m=>m.citation).map(m=>m.citation.url),['https://example.com/facts','https://example.com/photo-page','https://example.com/second-page','https://example.com/legacy-page']);
 assert.equal(b.meta.find(m=>m.grounding).grounding.html,'<div>Google</div>');
 assert.equal(b.meta.find(m=>m.activity?.kind==='search_results').activity.query,'blue cube');
 assert.deepEqual(JSON.parse(JSON.stringify(b.meta.find(m=>m.activity?.kind==='search_results').activity.searchModes)),{web:true,image:true});
 assert.equal(b.meta.find(m=>m.activity?.kind==='search_results').activity.label,'Google 网页与图片搜索');
});

test('UI presets change the real prompt and image generations are not automatically retried',()=>{
 assert.match(source,/_nbStylePrefix \+ topic/);
 assert.match(source,/msgObj.imageTurn=\{prompt:fullPrompt/);
 assert.match(source,/meta.imageContext\)msgObj.imageResponse=meta.imageContext.parts/);
 assert.match(source,/imageTurn:m.imageTurn, imageResponse:m.imageResponse/);
 assert.match(fn('fetchWithRetry'),/maxRetries === undefined \? 0/);
 assert.match(workerSource,/Image generation is never retried automatically/);
 assert.match(workerSource,/const response = await fetchOfficial\(endpoint, \{ method: "POST", headers, body: requestBody \}\)/);
});
