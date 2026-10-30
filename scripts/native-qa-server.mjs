import {createProjectScheduler} from '../worker/project-schedules.js';
import {NativeAccountRegistry} from '../worker/native-api.js';
// Local acceptance fixture: real request validation/storage, synthetic providers only.
import http from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import path from 'node:path';
import worker from '../worker/worker.js';
import { createChatRunClass } from '../worker/chat-runs.js';
import { createDebateRunClass } from '../worker/debate-runs.js';
import core from '../arena-debate.js';
const root=path.resolve(process.env.AI_DEBATE_QA_ROOT || path.resolve(import.meta.dirname,'../dist-site')),hash=text=>createHash('sha256').update(text).digest('hex');
const data=new Map([['user:qa-reader',JSON.stringify({hash:hash('offline-fixture')})],['user:qa-regular',JSON.stringify({hash:hash('offline-fixture')})]]);
const kv={get:async k=>data.get(k)||null,put:async(k,v)=>data.set(k,v),delete:async k=>data.delete(k),list:async({prefix})=>({keys:[...data.keys()].filter(k=>k.startsWith(prefix)).map(name=>({name})),list_complete:true})};
const events=[],actors=new Map(),attempts=new Map();let offlineUntil=0;
let evidenceWrites=Promise.resolve();
const evidence=()=>{const report=JSON.stringify({synthetic:true,externalModelCalls:0,events},null,2);evidenceWrites=evidenceWrites.catch(()=>{}).then(()=>writeFile(process.env.AI_DEBATE_QA_REPORT || '/private/tmp/aiarena-debate-events.json',report));return evidenceWrites;};
async function execute(request){
  const payload=await request.json();payload.prompt=payload.prompt||payload.chat?.question||'';if(payload.model!=='gpt-6.1-sol'||payload.effort!=='low')throw new Error('Native acceptance only permits Sol 6.1 Low');const identity=payload.prompt.match(/你的独立席位：([^\n]+)/)?.[1]||'chat',stage=payload.prompt.includes('本轮：独立观点')?'independent':payload.prompt.includes('你是中立的总结者')?'summary':'cross';
  const key=payload.chat?.chatId+'|'+identity+'|'+stage,attempt=(attempts.get(key)||0)+1;attempts.set(key,attempt);
  const event={kind:'provider',model:payload.model,effort:payload.effort,identity,stage,attempt,at:Date.now(),scope:payload.chat?.scope,historyEndUid:payload.chat?.historyEndUid,hasPrevious:payload.prompt.includes('上一轮发言（仅供分析）')};events.push(event);await evidence();
  if(identity.startsWith('seat-2')&&stage==='independent'&&attempt===1){event.outcome='injected-failure';await evidence();return Response.json({error:'合成测试：第二席暂时不可用，已保留第一席发言。'},{status:503});}
  let timer,closed=false;
  const body=new ReadableStream({start(controller){
    const text=stage==='summary'?'合成总结：已保留完整讨论，并验证恢复流程。':identity.startsWith('seat-1')&&stage==='independent'?'这是第一席的合成观点，用于验证刷新和短暂断网后仍然可以继续读取同一条回答。已经完成的发言会保留，第二席失败时也可以单独重试，不会重新请求第一席。':'这是'+identity.split(' · ')[1]+'的合成观点，重试只执行当前席位。';
    controller.enqueue(new TextEncoder().encode('data: {"status":"thinking"}\n\n'));let index=0;
    const delay=identity.startsWith('seat-1')&&stage==='independent'?450:120;
    timer=setInterval(()=>{if(closed)return;
      if(index<text.length){controller.enqueue(new TextEncoder().encode('data: '+JSON.stringify({t:text.slice(index,index+3)})+'\n\n'));index+=3;}
      else{clearInterval(timer);controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));controller.close();closed=true;event.outcome='completed';evidence();}
    },delay);
    request.signal.addEventListener('abort',()=>{clearInterval(timer);if(!closed){closed=true;controller.error(new DOMException('stopped','AbortError'));}event.outcome='stopped';evidence();},{once:true});
  },cancel(){clearInterval(timer);closed=true;}});
  return new Response(body,{headers:{'Content-Type':'text/event-stream'}});
}
const Debate=createDebateRunClass(execute,async(job)=>{
  const record=JSON.parse(data.get('user:'+job.user)||'null');if(!record||hash(record.hash)!==job.authVersion)throw new Error('synthetic auth changed');
  return {user:job.user,password:record.hash};
},core);
const blobs=new Map(),uploads=new Map();
  const bucket={async createMultipartUpload(key){const uploadId=crypto.randomUUID();uploads.set(uploadId,{key,parts:new Map()});return {uploadId};},resumeMultipartUpload(key,id){return {
    async uploadPart(n,body){const bytes=new Uint8Array(await new Response(body).arrayBuffer());uploads.get(id).parts.set(n,bytes);return {partNumber:n,etag:'part-'+n+'-'+bytes.length};},
    async complete(parts){const value=uploads.get(id),size=parts.reduce((n,p)=>n+value.parts.get(p.partNumber).length,0),bytes=new Uint8Array(size);let offset=0;for(const p of parts){const b=value.parts.get(p.partNumber);bytes.set(b,offset);offset+=b.length;}blobs.set(key,bytes);uploads.delete(id);return {size};},async abort(){uploads.delete(id);}
  };},async head(key){return blobs.has(key)?{size:blobs.get(key).length}:null;},async get(key){return blobs.has(key)?{body:blobs.get(key),size:blobs.get(key).length}:null;},async delete(key){blobs.delete(key);}};
const Run=createChatRunClass(execute,Debate),env={MEMORY_KV:kv,BIZ_KV:kv,PASSWORD:'synthetic-only',NATIVE_OWNER_ACCOUNT:'qa-reader',PROJECT_DOCUMENTS:bucket,OPENAI_API_KEY:'synthetic-only'};
const Scheduler=createProjectScheduler({models:['gpt-6.1-sol'],efforts:{'gpt-6.1-sol':['low','medium','high','xhigh','max']},credentials:async(_env,user)=>({user,password:JSON.parse(data.get('user:'+user)).hash}),project:async()=>{},execute});
const schedulers=new Map();env.PROJECT_SCHEDULES={idFromName:id=>id,get:id=>({fetch:request=>{if(!schedulers.has(id)){const values=new Map();let alarm;const storage={get:async k=>structuredClone(values.get(k)),put:async(k,v)=>values.set(k,structuredClone(v)),setAlarm:async at=>{clearTimeout(alarm);alarm=setTimeout(()=>schedulers.get(id).alarm().catch(console.error),Math.max(1,at-Date.now()));alarm.unref()},deleteAlarm:async()=>{clearTimeout(alarm)}};schedulers.set(id,new Scheduler({storage,blockConcurrencyWhile:fn=>fn(),waitUntil:promise=>promise.catch(()=>{})},env))}return schedulers.get(id).fetch(request)}})};
const registries=new Map();env.NATIVE_ACCOUNTS={idFromName:name=>name,get:name=>({fetch:request=>{if(!registries.has(name)){const entries=new Map();registries.set(name,new NativeAccountRegistry({storage:{get:async key=>entries.get(key),put:async(key,value)=>entries.set(key,structuredClone(value)),setAlarm:async()=>{}}},env))}return registries.get(name).fetch(request)}})};
env.CHAT_RUNS={idFromName:name=>name,get:name=>({fetch:request=>{
  if(!actors.has(name)){
    const db=new DatabaseSync(':memory:');let alarm;
    const storage={transactionSync(callback){db.exec('BEGIN');try{const value=callback();db.exec('COMMIT');return value}catch(error){db.exec('ROLLBACK');throw error}},sql:{exec(query,...values){const s=db.prepare(query),rows=s.columns().length?s.all(...values):(s.run(...values),[]);return {toArray:()=>rows};}},async setAlarm(time){clearTimeout(alarm);alarm=setTimeout(()=>actors.get(name).alarm().catch(error=>console.error(error)),Math.max(1,time-Date.now()));alarm.unref();}};
    actors.set(name,new Run({storage,waitUntil:promise=>promise.catch(console.error)},env));
  }
  return actors.get(name).fetch(request);
}})};

// A loopback-only fixture. External provider traffic is forbidden.
globalThis.fetch=async(url,options={})=>{
 const target=String(url instanceof Request?url.url:url);
 if(target.startsWith('https://api.openai.com/')){
  const payload=JSON.parse(typeof options.body==='string'?options.body:await url.text());
  if(payload.tools?.some(tool=>tool.type==='image_generation')){
   const item={id:'ig_native_'+events.length,type:'image_generation_call',result:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=',output_format:'png',size:'1024x1024',quality:'high',background:'opaque'};
   events.push({kind:'image-fixture',synthetic:true,externalModelCalls:0});await evidence();
   const frames=[{type:'response.image_generation_call.partial_image',partial_image_index:0,partial_image_b64:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=',output_format:'png'},{type:'response.output_item.done',item},{type:'response.completed',response:{status:'completed',output:[item],usage:{input_tokens:10,output_tokens:15}}}];
   return new Response(frames.map(frame=>'data: '+JSON.stringify(frame)+'\n\n').join(''),{headers:{'Content-Type':'text/event-stream'}});
  }
 }
 throw new Error('External network is disabled in native acceptance');
};
http.createServer(async(req,res)=>{
 try{
  const chunks=[];for await(const part of req)chunks.push(part);
  const route=new URL(req.url,'http://localhost');
  if(route.pathname==='/__evidence'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({synthetic:true,externalModelCalls:0,events}));return;}
  if(route.pathname==='/__offline'){offlineUntil=Date.now()+Number(route.searchParams.get('ms')||1500);res.writeHead(200);res.end('{}');return;}
  if(Date.now()<offlineUntil&&route.pathname!='/native/login'){res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Synthetic offline'}));return;}
  const init={method:req.method,headers:req.headers};if(req.method!=='GET')init.body=Buffer.concat(chunks);
  const response=await worker.fetch(new Request('https://api.pickandcase.com'+req.url,init),env);
  if(response.status>=400)console.error('Fixture response',req.url,response.status,(await response.clone().text()).slice(0,240));
  res.writeHead(response.status,Object.fromEntries(response.headers));if(response.body)for await(const part of response.body){if(res.destroyed)break;res.write(part);}res.end();
 }catch(error){res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:error.message}));}
}).listen(Number(process.env.PORT||4197),'127.0.0.1',()=>console.log('Native synthetic acceptance fixture on loopback port '+Number(process.env.PORT||4197)));
