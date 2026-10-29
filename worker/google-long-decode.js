const API='https://generativelanguage.googleapis.com/v1beta/interactions';
const safeId=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{6,2048}$/.test(value);
export async function cancelGoogleInteraction(id,env,fetcher=fetch){
  if(!safeId(id))return false;
  const response=await fetcher(API+'/'+encodeURIComponent(id)+'/cancel',{method:'POST',redirect:'manual',headers:{'x-goog-api-key':env.GEMINI_API_KEY}});
  await response.arrayBuffer();return response.ok;
}
const defaultPause=(ms,signal)=>new Promise((resolve,reject)=>{
  if(signal?.aborted)return reject(signal.reason||new DOMException('Stopped','AbortError'));
  const done=()=>{signal?.removeEventListener('abort',abort);resolve();};
  const timer=setTimeout(done,ms);
  const abort=()=>{clearTimeout(timer);reject(signal.reason||new DOMException('Stopped','AbortError'));};
  signal?.addEventListener('abort',abort,{once:true});
});

export function longDecodePayload(model,payload){
  const config=payload.generationConfig||{};
  return {model,background:true,store:true,service_tier:'standard',
    input:payload.contents.map(message=>({type:message.role==='model'?'model_output':'user_input',content:message.parts.map(part=>{
      if(typeof part.text==='string')return {type:'text',text:part.text};
      const image=part.inlineData||part.inline_data;
      if(image)return {type:'image',data:image.data,mime_type:image.mimeType||image.mime_type};
      throw new Error('长解码输入包含不支持的内容。');
    })})),
    ...(payload.systemInstruction?{system_instruction:payload.systemInstruction.parts.map(p=>p.text||'').join('\n')}:{}),
    generation_config:{max_output_tokens:config.maxOutputTokens,thinking_summaries:'auto',...(config.thinkingConfig?.thinkingLevel?{thinking_level:config.thinkingConfig.thinkingLevel.toLowerCase()}:{})},
    ...(payload.tools?.some(t=>t.google_search)?{tools:[{type:'google_search'}]}:{})};
}

// Create exactly one paid interaction. Reconnection only retrieves that same
// interaction; it never starts a new request or client-side continuation hop.
export async function runGoogleLongDecode({model,payload,env,signal,send,recordUsage=async()=>{},sendFinalUsage=true,fetcher=fetch,pause=defaultPause}){
  const headers={'Content-Type':'application/json','x-goog-api-key':env.GEMINI_API_KEY};
  let id=null,lastEventId=null,usage=null,nativeUsage=null,groundingUsed=false,terminal=false,cancelPromise=null,streamFinished=false,completed=false,lastStatus=null;
  const seen=new Set(),sources=new Set();
  async function checkpoint(value){
    if(!value)return;
    const input=value.total_input_tokens,output=(value.total_output_tokens||0)+(value.total_thought_tokens||0);
    if(!Number.isSafeInteger(input)||input<0||!Number.isSafeInteger(output)||output<0)return;
    usage={input,output};
    nativeUsage={...value};
    await send({diagnostics:{googleNativeUsage:Object.fromEntries(['total_input_tokens','total_cached_tokens','total_output_tokens','total_thought_tokens','total_tool_use_tokens','total_tokens'].filter(k=>Number.isSafeInteger(value[k])&&value[k]>=0).map(k=>[k,value[k]]))}});
    await send({usageCheckpoint:{...usage,partial:true}});
  }
  async function cancelRemote(){
    if(!id||terminal)return;
    if(cancelPromise)return cancelPromise;
    cancelPromise=(async()=>{
      try{
        const response=await fetcher(API+'/'+encodeURIComponent(id)+'/cancel',{method:'POST',redirect:'manual',headers});
        const data=await response.json().catch(()=>null);
        if(response.ok){terminal=true;await checkpoint(data?.usage);}
        await send({diagnostics:{providerCancelConfirmed:response.ok}}).catch(()=>{});
      }catch{await send({diagnostics:{providerCancelConfirmed:false}}).catch(()=>{});}
    })();return cancelPromise;
  }
  const abort=()=>{cancelRemote().catch(()=>{});};
  signal?.addEventListener('abort',abort,{once:true});
  async function text(value,reasoning=false){
    for(let offset=0;offset<value.length;){
      let end=Math.min(value.length,offset+8192);
      if(end<value.length&&/[\uD800-\uDBFF]/.test(value[end-1]))end--;
      await send({[reasoning?'r':'t']:value.slice(offset,end)});offset=end;
    }
  }
  async function citations(node){
    if(!node||typeof node!=='object')return;
    if(Array.isArray(node)){for(const item of node)await citations(item);return;}
    const value=node.url||node.uri;
    if(typeof value==='string'){
      try{const url=new URL(value);if(/^https?:$/.test(url.protocol)&&!url.username&&!url.password&&!sources.has(url.href)){
        sources.add(url.href);await send({citation:{url:url.href,title:typeof node.title==='string'?node.title:url.hostname},citationInline:false});
      }}catch{}
    }
    for(const value of Object.values(node))if(value&&typeof value==='object')await citations(value);
  }
  async function event(item){
    if(item.event_id&&seen.has(item.event_id))return;
    const type=item.event_type;
    if(type==='error')throw Object.assign(new Error('Gemini 长解码返回错误，已保留收到的内容。'),{terminal:true});
    if(type==='step.delta'){
      if(item.delta?.type==='text')await text(item.delta.text||'');
      if(item.delta?.type==='thought_summary'&&item.delta.content?.type==='text')await text(item.delta.content.text||'',true);
      if(item.delta?.type==='google_search_call'){groundingUsed=true;await send({activity:{kind:'search',label:'搜索网页',query:(item.delta.arguments?.queries||[]).join(' · ').slice(0,512)}});}
      if(item.delta?.annotations)await citations(item.delta.annotations);
    }
    if(type==='step.start'&&item.step?.type==='google_search_call'){groundingUsed=true;await send({status:'searching'});}
    if(item.step?.type==='google_search_result')await citations(item.step);
    await checkpoint(item.usage||item.interaction?.usage);
    if(type==='interaction.status_update'){lastStatus=item.status;await send({diagnostics:{providerStatus:item.status}});}
    if(type==='interaction.completed'){
      terminal=true;streamFinished=true;
      const status=item.interaction?.status;
      completed=status==='completed';
      await send({diagnostics:{providerStatus:status,providerCompleted:status==='completed'}});
      if(status!=='completed')throw new Error(status==='incomplete'?'模型已用完本轮思考和输出预算，已保留收到的内容。':status==='cancelled'?'服务商已停止本轮生成。':'Gemini 长解码未完成，已保留收到的内容。');
    }
    if(safeId(item.event_id)){
      lastEventId=item.event_id;seen.add(lastEventId);
      if(seen.size>4096)seen.delete(seen.values().next().value);
      await send({diagnostics:{googleLastEventId:lastEventId}});
    }
  }
  async function readEvents(response){
    const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',data=[];
    const line=async value=>{
      if(!value){if(data.length){const raw=data.join('\n');data=[];if(raw!=='[DONE]'){
        let item;try{item=JSON.parse(raw);}catch{throw Object.assign(new Error('Gemini 返回的数据格式不完整，已保留收到的内容。'),{terminal:true});}
        await event(item);
      }}return;}
      if(value.startsWith('data:'))data.push(value.slice(5).trimStart());
    };
    try{
      while(true){
        const part=await reader.read();buffer+=decoder.decode(part.value||new Uint8Array(),{stream:!part.done});
        const lines=buffer.split(/\r?\n/);buffer=lines.pop();
        for(const value of lines)await line(value);
        if(buffer.length>2*1024*1024)throw new Error('Gemini 返回的数据格式过长，已保留收到的内容。');
        if(part.done){if(buffer)await line(buffer);await line('');break;}
      }
    }finally{await reader.cancel().catch(()=>{});}
  }
  try{
    signal?.throwIfAborted();
    // Do not retry even if the creation acknowledgement is lost: the provider
    // may already have started billing that interaction.
    const response=await fetcher(API,{method:'POST',redirect:'manual',headers,body:JSON.stringify(longDecodePayload(model,payload)),signal});
    const requestId=response.headers.get('x-request-id')||response.headers.get('request-id');
    await send({diagnostics:{upstreamStatus:response.status,...(requestId&&/^[a-zA-Z0-9_-]{1,200}$/.test(requestId)?{providerRequestId:requestId}:{})}});
    if(!response.ok)throw new Error('Gemini 长解码提交失败（HTTP '+response.status+'），未自动重试。');
    const initial=await response.json();
    if(!safeId(initial.id))throw new Error('Gemini 未返回有效的任务编号，未自动重试。');
    id=initial.id;
    await send({diagnostics:{provider:'google',model,googleInteractionId:id,maxOutputTokens:payload.generationConfig.maxOutputTokens,upstreamStatus:response.status}});
    await checkpoint(initial.usage);
    if(signal?.aborted)throw signal.reason||new DOMException('Stopped','AbortError');
    for(let attempt=0;attempt<128&&!streamFinished;attempt++){
      signal?.throwIfAborted();
      const url=new URL(API+'/'+encodeURIComponent(id));url.searchParams.set('stream','true');
      if(lastEventId)url.searchParams.set('last_event_id',lastEventId);
      try{
        const replay=await fetcher(url.href,{redirect:'manual',headers:{...headers,Accept:'text/event-stream'},signal});
        if(!replay.ok){
          if(replay.status!==429&&replay.status<500)throw Object.assign(new Error('Gemini 结果读取失败（HTTP '+replay.status+'）。'),{terminal:true});
        }else{
          await readEvents(replay);
          // Status can become terminal before replayed text. Drain the stream
          // first, then handle providers that omit a separate completed event.
          if(!streamFinished&&['completed','incomplete','failed','cancelled','requires_action'].includes(lastStatus)){
            terminal=true;streamFinished=true;completed=lastStatus==='completed';
            await send({diagnostics:{providerStatus:lastStatus,providerCompleted:completed}});
            if(!completed)throw new Error('Gemini 长解码未完成（'+lastStatus+'），已保留收到的内容。');
          }
        }
      }catch(error){if(signal?.aborted||terminal||error.terminal)throw error;}
      if(!streamFinished)await pause(Math.min(30000,1000*(attempt+1)),signal);
    }
    if(!streamFinished)throw new Error('Gemini 结果连接反复中断，已保留收到的内容，未重新生成。');
  }finally{
    signal?.removeEventListener('abort',abort);
    if(!terminal)await cancelRemote();
    if(usage){
      const rawUsage={promptTokenCount:usage.input,cachedContentTokenCount:nativeUsage.total_cached_tokens||0,candidatesTokenCount:nativeUsage.total_output_tokens,thoughtsTokenCount:nativeUsage.total_thought_tokens,...(Number.isSafeInteger(nativeUsage.total_tokens)?{totalTokenCount:nativeUsage.total_tokens}:{})};
      await recordUsage(model,usage.input,usage.output,{rawUsage,groundingUsed,searches:groundingUsed?null:0,serviceTier:'standard',incompleteUsage:!completed||!!nativeUsage.total_tool_use_tokens});
      if(sendFinalUsage)await send({usage:{...usage,...(!completed?{partial:true}:{})}}).catch(()=>{});
    }
  }
}
