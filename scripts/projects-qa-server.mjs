// Local-only acceptance: real auth, project/chat APIs and scheduler; synthetic providers.
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import worker,{ChatRun,ProjectScheduler} from '../worker/worker.js';
const root=path.resolve(import.meta.dirname,'../dist-site'),hash=s=>createHash('sha256').update(s).digest('hex');
const data=new Map([['user:qa-reader',JSON.stringify({hash:hash('offline-fixture')})]]),events=[];
const kv={get:async k=>data.get(k)||null,put:async(k,v)=>data.set(k,v),delete:async k=>data.delete(k),list:async({prefix})=>({keys:[...data.keys()].filter(k=>k.startsWith(prefix)).map(name=>({name})),list_complete:true})};
const env={MEMORY_KV:kv,BIZ_KV:kv,PASSWORD:'synthetic-only',GROK_API_KEY:'synthetic-key',ANTHROPIC_API_KEY:'synthetic-key',OPENAI_API_KEY:'synthetic-key',GEMINI_API_KEY:'synthetic-key'};
function binding(Class){const actors=new Map();return {idFromName:id=>id,get:id=>({fetch:async request=>{
  if(!actors.has(id)){
    const db=new DatabaseSync(':memory:'),values=new Map();let alarm;
    const storage={get:async k=>structuredClone(values.get(k)),put:async(k,v)=>values.set(k,structuredClone(v)),deleteAlarm:async()=>clearTimeout(alarm),setAlarm:async time=>{clearTimeout(alarm);alarm=setTimeout(()=>actors.get(id).alarm().catch(console.error),Math.max(10,time-Date.now()));alarm.unref();},sql:{exec(query,...args){const s=db.prepare(query),rows=s.columns().length?s.all(...args):(s.run(...args),[]);return {toArray:()=>rows};}}};
    actors.set(id,new Class({storage,blockConcurrencyWhile:fn=>fn(),waitUntil:p=>p.catch(console.error)},env));
  }
  return actors.get(id).fetch(request);
}})};}
env.CHAT_RUNS=binding(ChatRun);env.PROJECT_SCHEDULES=binding(ProjectScheduler);
globalThis.fetch=async(url,options)=>{
  const hostname=new URL(typeof url==='string'?url:url.url).hostname,payload=JSON.parse(options.body);
  if(!['api.x.ai','api.anthropic.com','api.openai.com','generativelanguage.googleapis.com'].includes(hostname))throw Error('External requests disabled by local fixture');
  events.push({kind:'synthetic-provider',model:payload.model,at:Date.now()});
  const text='这是本地合成验收结果。项目指令、记忆和资料按当前项目读取。任务结果已保存。';
  if(hostname==='api.anthropic.com')return new Response('data: '+JSON.stringify({type:'content_block_delta',delta:{type:'text_delta',text}})+'\n\n');
  return new Response('data: '+JSON.stringify({type:'response.output_text.delta',delta:text})+'\n\ndata: '+JSON.stringify({type:'response.completed',response:{usage:{input_tokens:10,output_tokens:10}}})+'\n\n');
};
async function api(route,body){const response=await worker.fetch(new Request('https://api.pickandcase.com'+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'qa-reader',password:hash('offline-fixture'),...body})}),env);return response.json();}
const a=(await api('/projects',{action:'create',name:'产品开发',instructions:'用中文回答。优先引用项目资料，并列出明确的下一步。'})).project;
await api('/projects',{action:'pin',projectId:a.id,pinned:true});
await api('/projects',{action:'update',projectId:a.id,memory:'本项目目标是完成秋季产品开发，预算 12000 元。'});
await api('/projects',{action:'upload',projectId:a.id,file:{name:'项目简报.md',size:6,type:'text/markdown',text:'验收暗号：蓝莓73921。项目预算 12000 元。',data:'YWJjZGVm'}});
await api('/projects',{action:'create',name:'市场研究',instructions:'提供清晰的证据和来源。'});
await api('/chats',{action:'save',chatId:'general-chat-001',title:'待加入项目的对话',messages:[{uid:1,isUser:true,text:'整理产品设计要求'},{uid:2,name:'AI',text:'这是普通聊天中的合成内容。'}]});
await api('/chats',{action:'save',chatId:'general-chat-002',title:'周末安排',messages:[{uid:1,isUser:true,text:'规划周末'}]});
await api('/chats',{action:'save',projectId:a.id,chatId:'project-chat-001',title:'第一版产品方案',messages:[{uid:1,isUser:true,text:'产品开发的第一版方案'},{uid:2,name:'AI',text:'这是已保存的项目对话。'}]});
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.png':'image/png','.webp':'image/webp','.webm':'video/webm','.mov':'video/quicktime'};
http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1');
  try{
    if(url.pathname==='/__evidence'){res.writeHead(200,{'Content-Type':types['.json']});res.end(JSON.stringify({synthetic:true,externalModelCalls:0,events,tasks:await api('/schedules',{action:'list'})}));return;}
    if(url.pathname==='/__mobile'){res.writeHead(200,{'Content-Type':types['.html']});res.end('<!doctype html><meta charset="utf-8"><title>手机宽度验收</title><style>body{margin:0;background:#ddd;display:flex;justify-content:center}iframe{width:390px;height:844px;border:0;background:white}</style><iframe title="手机宽度" src="/"></iframe>');return;}
    if(url.pathname.startsWith('/__test-api')){
      let raw='';for await(const part of req)raw+=part;const route=url.pathname.slice('/__test-api'.length)||'/';
      const body=JSON.parse(raw||'{}');events.push({kind:'request',route,action:body.action,at:Date.now()});
      if(['/auth','/projects','/chats','/schedules','/memory','/chat-runs','/debate-runs','/system-prompt','/account','/'].includes(route)){
        const response=await worker.fetch(new Request('https://api.pickandcase.com'+route,{method:'POST',headers:{'Content-Type':'application/json'},body:raw}),env);
        res.writeHead(response.status,Object.fromEntries(response.headers));if(response.body)for await(const chunk of response.body){if(res.destroyed)break;res.write(chunk);}res.end();return;
      }
      res.writeHead(200,{'Content-Type':types['.json']});res.end('{"ok":true,"quick":true,"anthropic":true,"xai":true,"google":true,"skills":[]}');return;
    }
    const file=path.resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));if(!file.startsWith(root+path.sep))throw Error('outside fixture');
    let bytes=await readFile(file);if(file.endsWith('/index.html'))bytes=Buffer.from(bytes.toString().replace("var WORKER = 'https://api.pickandcase.com';","var WORKER = '/__test-api';"));
    const headers={'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store','Accept-Ranges':'bytes'};
    if(req.headers.range){const m=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range);if(!m)throw Error('invalid range');const start=+m[1],end=m[2]?Math.min(+m[2],bytes.length-1):bytes.length-1;res.writeHead(206,{...headers,'Content-Range':`bytes ${start}-${end}/${bytes.length}`,'Content-Length':end-start+1});res.end(bytes.subarray(start,end+1));return;}
    res.writeHead(200,{...headers,'Content-Length':bytes.length});res.end(bytes);
  }catch(error){res.writeHead(500,{'Content-Type':types['.json']});res.end(JSON.stringify({error:error.message}));}
}).listen(4193,'127.0.0.1',()=>console.log('Project acceptance: http://127.0.0.1:4193/ (qa-reader / offline-fixture; synthetic providers only)'));
