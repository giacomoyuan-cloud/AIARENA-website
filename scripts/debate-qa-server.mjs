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
const data=new Map([['user:qa-reader',JSON.stringify({hash:hash('offline-fixture')})]]);
const kv={get:async k=>data.get(k)||null,put:async(k,v)=>data.set(k,v),delete:async k=>data.delete(k),list:async({prefix})=>({keys:[...data.keys()].filter(k=>k.startsWith(prefix)).map(name=>({name})),list_complete:true})};
const events=[],actors=new Map(),attempts=new Map();let offlineUntil=0;
let evidenceWrites=Promise.resolve();
const evidence=()=>{const report=JSON.stringify({synthetic:true,externalModelCalls:0,events},null,2);evidenceWrites=evidenceWrites.catch(()=>{}).then(()=>writeFile(process.env.AI_DEBATE_QA_REPORT || '/private/tmp/aiarena-debate-events.json',report));return evidenceWrites;};
async function execute(request){
  const payload=await request.json(),identity=payload.prompt.match(/你的独立席位：([^\n]+)/)?.[1]||'chat',stage=payload.prompt.includes('本轮：独立观点')?'independent':payload.prompt.includes('你是中立的总结者')?'summary':'cross';
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
const Run=createChatRunClass(execute,Debate),env={MEMORY_KV:kv,BIZ_KV:kv,PASSWORD:'synthetic-only'};
env.CHAT_RUNS={idFromName:name=>name,get:name=>({fetch:request=>{
  if(!actors.has(name)){
    const db=new DatabaseSync(':memory:');let alarm;
    const storage={sql:{exec(query,...values){const s=db.prepare(query),rows=s.columns().length?s.all(...values):(s.run(...values),[]);return {toArray:()=>rows};}},async setAlarm(time){clearTimeout(alarm);alarm=setTimeout(()=>actors.get(name).alarm().catch(error=>console.error(error)),Math.max(1,time-Date.now()));alarm.unref();}};
    actors.set(name,new Run({storage,waitUntil:promise=>promise.catch(console.error)},env));
  }
  return actors.get(name).fetch(request);
}})};
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.png':'image/png','.webp':'image/webp','.webm':'video/webm','.mov':'video/quicktime'};
http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1');
  try{
    if(url.pathname==='/__fixture'){
      if(req.method==='POST'){offlineUntil=Date.now()+15000;res.writeHead(303,{Location:'/__fixture'});res.end();return;}
      res.writeHead(200,{'Content-Type':types['.html'],'Cache-Control':'no-store'});res.end('<!doctype html><meta charset="utf-8"><title>本地辩论恢复测试</title><h1>本地合成验收</h1><p>只使用虚构内容，不调用外部模型。</p><form method="post"><button>模拟读取断网 15 秒</button></form><p><a href="/__evidence">查看调用证据</a></p><p><a href="/">AI 助手</a></p>');return;
    }
    if(url.pathname==='/__evidence'){res.writeHead(200,{'Content-Type':types['.json'],'Cache-Control':'no-store'});res.end(JSON.stringify({synthetic:true,externalModelCalls:0,events},null,2));return;}
    if(url.pathname==='/__mobile'){res.writeHead(200,{'Content-Type':types['.html']});res.end('<!doctype html><meta charset="utf-8"><title>手机宽度测试</title><style>body{margin:0;background:#eee;display:flex;justify-content:center}iframe{width:390px;height:844px;border:0;background:white}</style><iframe title="手机宽度测试" src="/"></iframe>');return;}
    if(url.pathname.startsWith('/__test-api')){
      let raw='';for await(const part of req)raw+=part;const body=JSON.parse(raw||'{}'),route=url.pathname.slice('/__test-api'.length)||'/';
      events.push({kind:'request',action:body.action,route,runId:body.runId,after:body.after,at:Date.now()});await evidence();
      if(route==='/debate-runs'&&body.action==='status'&&Date.now()<offlineUntil){res.writeHead(503,{'Content-Type':types['.json']});res.end('{"error":"模拟断网"}');return;}
      if(route==='/memory'){res.writeHead(200,{'Content-Type':types['.json']});res.end('{"memory":""}');return;}
      if(['/auth','/chats','/chat-runs','/debate-runs','/projects','/account','/system-prompt'].includes(route)){
        const result=await worker.fetch(new Request('https://api.pickandcase.com'+route,{method:'POST',headers:{'Content-Type':'application/json'},body:raw}),env);
        res.writeHead(result.status,Object.fromEntries(result.headers));if(result.body){for await(const chunk of result.body){if(res.destroyed)break;res.write(chunk);}}res.end();return;
      }
      res.writeHead(200,{'Content-Type':types['.json']});res.end('{"ok":true,"quick":true,"anthropic":true,"xai":true,"google":true}');return;
    }
    const file=path.resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));if(!file.startsWith(root+path.sep))throw new Error('outside fixture');
    let bytes=await readFile(file);if(file.endsWith('/index.html'))bytes=Buffer.from(bytes.toString().replace("var WORKER = 'https://api.pickandcase.com';","var WORKER = '/__test-api';"));
    const headers={'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store','Accept-Ranges':'bytes'};
    if(req.headers.range){const match=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range);if(!match)throw new Error('invalid range');const start=Number(match[1]),end=match[2]?Math.min(Number(match[2]),bytes.length-1):bytes.length-1;res.writeHead(206,{...headers,'Content-Range':`bytes ${start}-${end}/${bytes.length}`,'Content-Length':end-start+1});res.end(bytes.subarray(start,end+1));return;}
    res.writeHead(200,{...headers,'Content-Length':bytes.length});res.end(bytes);
  }catch(error){res.writeHead(500,{'Content-Type':types['.json']});res.end(JSON.stringify({error:error.message}));}
}).listen(Number(process.env.PORT || 4192),'127.0.0.1',()=>console.log('Debate recovery fixture: http://127.0.0.1:'+Number(process.env.PORT || 4192)+'/ (qa-reader / offline-fixture)'));
