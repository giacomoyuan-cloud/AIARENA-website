const invalid=(message,status=400)=>{throw Object.assign(Error(message),{status});};
export const conversationIdOK=id=>typeof id==='string'&&/^[a-zA-Z0-9_-]{6,80}$/.test(id);
const aliasKey=(owner,projectId,chatId)=>'conversation-library-alias:'+owner+':'+(projectId||'general')+':'+chatId;
async function address(env,owner,chatId,projectId){
  if(!conversationIdOK(chatId))invalid('对话编号无效');
  if(!env.CHAT_RUNS)invalid('文件索引服务未就绪',503);
  const raw=await env.BIZ_KV.get(aliasKey(owner,projectId,chatId));
  const value=raw?JSON.parse(raw):{id:chatId,name:'conversation-library:'+owner+':'+(projectId||'general')+':'+chatId};
  if(!conversationIdOK(value.id)||typeof value.name!=='string'||!value.name.startsWith('conversation-library:'+owner+':')||value.name.length>320)invalid('文件关联暂不可用',503);
  return value;
}
export async function conversationActor(env,owner,chatId,projectId){return env.CHAT_RUNS.get(env.CHAT_RUNS.idFromName((await address(env,owner,chatId,projectId)).name));}
export async function conversationLibrary(env,owner,chatId,projectId,action,extra={}){
  const target=await address(env,owner,chatId,projectId),actor=env.CHAT_RUNS.get(env.CHAT_RUNS.idFromName(target.name));
  const response=await actor.fetch(new Request('https://project-library.internal/__library',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...extra,owner,projectId:target.id,conversation:true,channel:projectId||'general',action})}));
  if(!response.ok){const data=await response.json().catch(()=>({}));invalid(data.error||'对话文件请求失败',response.status);}
  return action==='download'?response:response.json();
}
export async function moveConversationFiles(env,owner,chatId,fromProject,targetId,toProject){
  const target=await address(env,owner,chatId,fromProject);
  await conversationLibrary(env,owner,chatId,fromProject,'move_scope',{targetChannel:toProject||'general'});
  await env.BIZ_KV.put(aliasKey(owner,toProject,targetId),JSON.stringify(target));
}
export async function handleConversationFiles(request,env,{authorize,checkScope,link}){
  try{
    const url=new URL(request.url),upload=url.pathname==='/conversation-upload';let body;
    if(upload){
      const value=request.headers.get('Authorization')?.match(/^Bearer ([A-Za-z0-9+/=]+)$/)?.[1];
      if(!value)invalid('请先登录账号。',401);
      try{body=JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(value),c=>c.charCodeAt(0))));}catch{invalid('登录信息无效',401);}
      Object.assign(body,{chatId:url.searchParams.get('chat'),projectId:url.searchParams.get('project')||null});
    }else body=await request.json();
    const user=await authorize(body);
    if(body.incognito)invalid('无痕附件仅在本次页面内存中处理，不会写入文件库');
    if(!conversationIdOK(body.chatId))invalid('对话编号无效');
    await checkScope(user,body.projectId||null,body.chatId);
    if(upload){
      const targetAddress=await address(env,user,body.chatId,body.projectId),actor=env.CHAT_RUNS.get(env.CHAT_RUNS.idFromName(targetAddress.name));
      const headers={'x-library-owner':user,'x-library-project':targetAddress.id,'x-library-conversation':'true','x-library-channel':body.projectId||'general'};
      if(request.headers.has('Content-Length'))headers['Content-Length']=request.headers.get('Content-Length');
      const target=new URL('https://project-library.internal/__library');target.searchParams.set('file',url.searchParams.get('file')||'');target.searchParams.set('part',url.searchParams.get('part')||'');
      return actor.fetch(new Request(target,{method:'PUT',headers,body:request.body,duplex:'half'}));
    }
    const allowed=new Set(['list','settings','start','original_complete','segments','commit','parse_failed','abort','reparse','ocr_page','preview','download','remove','restore']);
    const action=url.pathname==='/conversation-original'?'download':String(body.action||'').replace(/^library_/,'').replace(/_file$/,'');
    if(!allowed.has(action))invalid('不支持此文件操作');
    const extra={};for(const key of ['fileId','parts','segments','coverage','error','generation','mode','page','total','data','mime','retry','hasNativeText'])if(body[key]!==undefined)extra[key]=body[key];
    if(action==='start'&&body.file){extra.file={};for(const key of ['id','name','size','type','folder','relativePath'])if(body.file[key]!==undefined)extra.file[key]=body.file[key];}
    const result=await conversationLibrary(env,user,body.chatId,body.projectId,action,extra);
    const linked=result.file||result.files?.[0];if(linked&&['start','commit','list'].includes(action)&&link)await link(user,body.projectId||null,body.chatId,linked.name);
    return result instanceof Response?result:Response.json(result,{headers:{'Cache-Control':'no-store','Access-Control-Allow-Origin':'*'}});
  }catch(error){return Response.json({error:error.status?error.message:error instanceof SyntaxError?'文件请求格式无效':'对话文件处理失败，请重试'},{status:error.status||400,headers:{'Cache-Control':'no-store','Access-Control-Allow-Origin':'*'}});}
}
