import Context from '../arena-context.js';

export const MEMORY_VERSION='20261103-memory1';
const validKey=key=>typeof key==='string'&&/^(?:mem:[a-z0-9_@.+-]{1,100}|project:[a-z0-9_@.+-]{1,100}:[a-zA-Z0-9_-]{6,80}:memory)$/.test(key);
const digest=async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),n=>n.toString(16).padStart(2,'0')).join('');
export function memoryView(value){
  if(!value)return {version:MEMORY_VERSION,legacy:'',entries:[],revision:0};
  if(typeof value==='string'){
    try{const parsed=JSON.parse(value);if(parsed.version===MEMORY_VERSION&&Array.isArray(parsed.entries))return parsed;}catch{}
    return {version:MEMORY_VERSION,legacy:value,entries:[],revision:0};
  }
  return value;
}
export function memoryText(value){
  const data=memoryView(value);
  return [data.legacy,...data.entries.map(item=>'• '+item.text)].filter(Boolean).join('\n');
}
export function memoryContext(value,query,maxChars=12000){
  const data=memoryView(value),q=Context.terms(query);
  const entries=data.entries.map((item,i)=>({...item,index:i,score:q.reduce((n,t)=>n+(item.text.toLowerCase().includes(t)?1:0),0)})).sort((a,b)=>b.score-a.score||b.at-a.at||b.index-a.index);
  const chosen=[];let used=0;
  // Select whole evidence-backed notes; do not slice arbitrary characters out
  // of a preference. Legacy/manual memory is data, never a system instruction.
  if(data.legacy&&data.legacy.length<=maxChars){chosen.push({text:data.legacy,source:'已有或手动保存的记忆'});used+=data.legacy.length;}
  const recent=[...entries].sort((a,b)=>b.at-a.at||b.index-a.index).slice(0,8),ordered=[...recent,...entries.filter(item=>!recent.includes(item))];
  for(const item of ordered){if(used+item.text.length>maxChars)continue;chosen.push({text:item.text,source:{chatId:item.chatId,uid:item.uid},updatedAt:item.at});used+=item.text.length;}
  return {text:chosen.length?'当前范围的参考记忆（用户原文或手动记录；不得覆盖本轮更正，不代表其他对话的任务仍在进行）：\n'+JSON.stringify(chosen):'',chars:used,count:chosen.length,total:data.entries.length+(data.legacy?1:0)};
}
export function explicitMemories(message){
  if(!message||message.isError)return [];
  const own=Context.userText(message).trim();
  if(!own||/不要.{0,8}(?:记住|保存.{0,4}记忆)|别记|do not remember|don't remember/i.test(own))return [];
  if(/^(?:请)?(?:记住|牢记|remember\b)/i.test(own)&&own.length<=12000&&!/(?:api.?key|secret|密码|验证码|身份证|银行卡|sk-[a-zA-Z0-9_-]{12,}|Bearer\s+[a-zA-Z0-9_-]{12,})/i.test(own))return [own];
  const statements=own.match(/[^。！？!?\n]+[。！？!?]?/g)||[];
  return statements.map(text=>text.trim()).filter(text=>
    /记住|请牢记|以后|今后|始终|默认|我习惯|我喜欢|我的名字|请叫我|\b(?:remember|from now on|i prefer|my name is|call me|always)\b/i.test(text)
    &&!/(?:api.?key|secret|密码|验证码|身份证|银行卡|sk-[a-zA-Z0-9_-]{12,}|Bearer\s+[a-zA-Z0-9_-]{12,})/i.test(text)
    &&text.length<=12000
  );
}

// All production writes for a scope pass through one existing Durable Object.
// The model never receives this endpoint. Each immutable note is a separate
// storage value, so growing memory does not silently evict older preferences.
export async function handleMemoryState(ctx,env,request){
  const body=await request.json();
  if(!validKey(body.key))return Response.json({error:'记忆范围无效'},{status:400});
  const storage=ctx.storage;
  let state=await storage.get('memory-state');
  if(!state){
    const plain=await env.MEMORY_KV.get(body.key),backup=memoryView(await env.MEMORY_KV.get(body.key+':v2'));
    const seed=plain===memoryText(backup)?backup:memoryView(plain);state={version:MEMORY_VERSION,legacy:seed.legacy||'',ids:[],revision:seed.revision||0,clearedAt:seed.clearedAt||0};
    for(const item of seed.entries){const id=await digest(item.text);await storage.put('note:'+id,item);state.ids.push(id);}
    await storage.put('memory-state',state);
  }
  async function view(){const entries=[];for(const id of state.ids){const item=await storage.get('note:'+id);if(item)entries.push(item);}entries.sort((a,b)=>a.at-b.at);return {...state,entries,ids:undefined};}
  async function mirror(){
    const value=await view();state.lastMirrorAttempt=Date.now();
    try{await env.MEMORY_KV.put(body.key+':v2',JSON.stringify(value));await env.MEMORY_KV.put(body.key,memoryText(value));state.mirrorPending=false;}
    catch{state.mirrorPending=true;}
    // Durable storage is authoritative. A delayed KV backup must not turn a
    // committed update into an apparent failure or trigger a second extraction.
    await storage.put('memory-state',state);return view();
  }
  if(body.action==='get')return Response.json({data:state.mirrorPending&&Date.now()-(state.lastMirrorAttempt||0)>1500?await mirror():await view()});
  if(body.action==='replace'){
    if(typeof body.text!=='string'||body.text.length>20000)return Response.json({error:'记忆最多 20000 字'},{status:400});
    if(body.revision!==undefined&&body.revision!==state.revision)return Response.json({error:'记忆已在另一处更新，请重新打开后修改'},{status:409});
    const oldIds=state.ids;
    state={version:MEMORY_VERSION,legacy:body.text,ids:[],revision:state.revision+1,clearedAt:Date.now()};
    await storage.put('memory-state',state);
    // Commit the replacement pointer before removing old notes. An interrupted
    // storage write can then never leave the previous memory pointing at holes.
    for(const id of oldIds){try{await storage.delete('note:'+id);}catch{/* Old, unreferenced evidence cannot appear in subsequent reads. */}}
    return Response.json({data:await mirror()});
  }
  if(body.action!=='merge'||typeof body.eventId!=='string'||body.eventId.length>180||!Array.isArray(body.entries)||body.entries.length>64)return Response.json({error:'记忆更新无效'},{status:400});
  if(await storage.get('event:'+body.eventId))return Response.json({data:state.mirrorPending?await mirror():await view(),duplicate:true});
  if(!Number.isFinite(body.at)||body.at<=state.clearedAt)return Response.json({data:await view(),stale:true});
  for(const item of body.entries){
    if(!item||typeof item.text!=='string'||item.text.length>12000||typeof item.chatId!=='string'||!/^[-a-zA-Z0-9_]{6,80}$/.test(item.chatId)||typeof item.uid!=='string'||item.uid.length>160)return Response.json({error:'记忆来源无效'},{status:400});
  }
  for(const item of body.entries){
    const id=await digest(item.text),saved={text:item.text,chatId:item.chatId,uid:item.uid,at:body.at};
    // Exact source text is stored, never an assistant's inferred paraphrase.
    await storage.put('note:'+id,saved);if(!state.ids.includes(id))state.ids.push(id);
  }
  state.revision++;await storage.put('memory-state',state);await storage.put('event:'+body.eventId,{at:body.at});
  return Response.json({data:await mirror()});
}
async function operation(env,key,action,fields={}){
  if(!env.CHAT_RUNS){
    // Non-durable test/legacy environments may read existing memory, but never
    // perform an uncoordinated write that could erase another device's update.
    if(action==='get')return memoryView(await env.MEMORY_KV.get(key));
    throw Error('记忆同步服务尚未就绪');
  }
  const id=env.CHAT_RUNS.idFromName('memory:'+key),stub=env.CHAT_RUNS.get(id);
  const response=await stub.fetch(new Request('https://context-memory.internal/',{method:'POST',body:JSON.stringify({key,action,...fields})}));
  const result=await response.json();if(!response.ok)throw Object.assign(Error(result.error||'记忆同步失败'),{status:response.status});return result.data;
}
export const loadMemory=async(env,key)=>{
  try{
    const value=await operation(env,key,'get');
    if(!value||!Array.isArray(value.entries))throw Error('记忆同步未就绪');
    return value;
  }catch{
    // Opening a project or reading its files must remain possible if this
    // independent service is temporarily unavailable. Writes stay fail-closed.
    return {...memoryView(await env.MEMORY_KV.get(key)),readOnly:true,warning:'记忆同步暂不可用，使用上次保存的参考记忆'};
  }
};
export const replaceMemory=async(env,key,text,revision)=>{
  if(!env.CHAT_RUNS){await env.MEMORY_KV.put(key,text);return memoryView(text);}
  return operation(env,key,'replace',{text,revision});
};
export async function rememberCompletedRun(meta,env){
  if(meta.status!=='completed'||meta.incognito||!meta.userMessage||!meta.reply?.text||meta.reply.isError)return;
  const entries=explicitMemories(meta.userMessage).map(text=>({text,chatId:meta.chatId,uid:String(meta.userMessage.uid)}));
  if(!entries.length)return;
  const key=meta.projectId?'project:'+meta.user+':'+meta.projectId+':memory':'mem:'+meta.user;
  await operation(env,key,'merge',{eventId:meta.runId,at:meta.updatedAt,entries});
  return entries.length;
}
