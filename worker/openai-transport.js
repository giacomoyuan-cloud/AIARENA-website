const ORIGIN='https://openai-dispatch.internal';
const encoder=new TextEncoder();
const MODELS=new Set(['gpt-6-astra','gpt-6.1-sol','gpt-5.6-sol']);
const paused=ms=>new Promise(resolve=>setTimeout(resolve,ms));

// Each prepared request gets a private US object and a closed JSON enqueue
// response. Provider I/O runs in an alarm without chat storage or public chat
// subscriptions; prepared prompts and keys are never written to storage.
export class OpenAITransport {
  constructor(ctx,env){this.ctx=ctx;this.env=env;this.job=null;}
  matches(request){return new URL(request.url).origin===ORIGIN;}
  get active(){return !!this.job;}
  async fetch(request){
    const path=new URL(request.url).pathname;
    if(path==='/start'){
      if(this.job)return Response.json({error:'请求已提交，请勿重复。'},{status:409});
      const input=await request.json();
      if(typeof input.body!=='string'||input.body.length>16*1024*1024)return Response.json({error:'请求内容过大或无效。'},{status:400});
      let payload;try{payload=JSON.parse(input.body)}catch{return Response.json({error:'请求内容无效。'},{status:400})}
      if(!MODELS.has(payload.model))return Response.json({error:'模型不可用。'},{status:400});
      this.job={body:input.body,countOnly:input.countOnly===true,phase:'queued',chunks:[],bytes:0,finished:false,started:false,subscribed:false,abort:new AbortController()};
      await this.ctx.storage.setAlarm(Date.now()+100);
      return Response.json({phase:'queued'},{status:202});
    }
    const job=this.job;
    if(!job)return Response.json({error:'后台连接已中断，请重新发送。'},{status:410});
    if(path==='/stop'){
      job.cancelled=true;job.body=null;job.abort.abort();job.finished=true;
      job.readyWake?.();job.wake?.();job.space?.();return Response.json({phase:'cancelled'});
    }
    if(path==='/wait-ready'&&job.phase!=='ready'&&!job.finished)await new Promise(resolve=>{
      const done=()=>{clearTimeout(timer);job.readyWake=null;resolve()};
      const timer=setTimeout(done,20000);job.readyWake=done;
    });
    if(path==='/status'||path==='/wait-ready')return Response.json({phase:job.phase,status:job.status,transportError:!!job.transportError});
    if(path!=='/stream'||job.phase!=='ready')return Response.json({error:'连接尚未就绪。'},{status:409});
    if(job.subscribed)return Response.json({error:'连接已被读取。'},{status:409});
    job.subscribed=true;
    const stream=new ReadableStream({
      async pull(controller){
        while(!job.chunks.length&&!job.finished)await new Promise(resolve=>{job.wake=resolve});
        job.wake=null;
        if(job.chunks.length){const chunk=job.chunks.shift();job.bytes-=chunk.length;controller.enqueue(chunk);job.space?.();job.space=null;return;}
        if(job.error)controller.error(new Error(job.error));else controller.close();
      },
      cancel(){job.cancelled=true;job.abort.abort();job.finished=true;job.wake?.();job.space?.();}
    });
    return new Response(stream,{status:job.status,headers:job.headers});
  }
  async append(chunk){
    const job=this.job;
    while(job.bytes>512*1024&&!job.cancelled)await new Promise(resolve=>{job.space=resolve});
    if(job.cancelled)return;
    job.chunks.push(chunk);job.bytes+=chunk.length;job.wake?.();
  }
  async alarm(){
    const job=this.job;
    if(!job||job.started||job.cancelled)return;
    job.started=true;job.phase='fetching';
    try{
      const response=await fetch('https://api.openai.com/v1/responses'+(job.countOnly?'/input_tokens':''),{
        method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+this.env.OPENAI_API_KEY},
        body:job.body,signal:job.abort.signal,redirect:'manual'
      });
      job.status=response.status;job.headers={};
      for(const name of ['content-type','x-request-id','cf-ray','retry-after']){const value=response.headers.get(name);if(value)job.headers[name]=value;}
      job.phase='ready';job.readyWake?.();
      const reader=response.body?.getReader();
      if(reader){try{while(!job.cancelled){const part=await reader.read();if(part.done)break;await this.append(part.value)}}finally{await reader.cancel().catch(()=>{})}}
    }catch(error){
      const message=String(error?.message||'后台连接失败').replaceAll(this.env.OPENAI_API_KEY||'NEVER_MATCH_EMPTY','[redacted]').slice(0,300);
      if(job.phase!=='ready'){
        job.transportError=true;
        job.status=502;job.headers={'content-type':'application/json'};job.phase='ready';
        if(!job.cancelled)await this.append(encoder.encode(JSON.stringify({error:{message:'OpenAI 后台连接失败：'+message}})));
      }else if(!job.cancelled)job.error='OpenAI 连接中断，已保留收到的内容。';
    }finally{job.body=null;job.finished=true;job.readyWake?.();job.wake?.();job.space?.();}
  }
}

export async function openAIBackgroundFetch(namespace,body,signal,{countOnly=false}={}){
  const regional=namespace.jurisdiction('us');
  const stub=regional.get(regional.idFromName('openai-dispatch:'+crypto.randomUUID()));
  const request=(path,value)=>new Request(ORIGIN+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value||{})});
  const stop=()=>{stub.fetch(request('/stop')).catch(()=>{})};
  const aborted=()=>{if(signal?.aborted)throw new DOMException('已停止生成','AbortError')};
  signal?.addEventListener('abort',stop,{once:true});
  let reader;
  try{
    aborted();
    const started=await stub.fetch(request('/start',{body,...(countOnly?{countOnly:true}:{})}));
    if(!started.ok)throw new Error((await started.json()).error||'后台连接启动失败。');
    // Consume and close the enqueue response before waiting for provider headers.
    await started.json();
    let state='queued',ready=false;
    for(let count=0;count<16;count++){
      aborted();await paused(250);aborted();
      // Once fetching has started, wait for headers in one request. Avoid
      // exhausting the Worker's subrequest limit during a slow provider start.
      const response=await stub.fetch(request(state==='fetching'?'/wait-ready':'/status'));
      const status=await response.json();
      if(!response.ok)throw new Error(status.error||'后台连接中断。');
      // A lost provider acknowledgement may already have incurred a charge.
      // Throw instead of turning it into a retryable synthetic HTTP 502.
      if(status.transportError)throw new Error('OpenAI 后台连接中断，请重新发送。');
      state=status.phase;
      if(state==='ready'){ready=true;break;}
      if(status.phase==='queued'&&count>=7)break;
    }
    if(!ready)throw new Error('OpenAI 连接等待超时。');
    aborted();const response=await stub.fetch(request('/stream'));
    reader=response.body.getReader();
    const clean=()=>signal?.removeEventListener('abort',stop);
    const stream=new ReadableStream({
      async pull(controller){try{const part=await reader.read();if(part.done){clean();controller.close()}else controller.enqueue(part.value)}catch(error){clean();controller.error(error)}},
      cancel(reason){clean();stop();return reader.cancel(reason)}
    });
    return new Response(stream,{status:response.status,headers:response.headers});
  }catch(error){signal?.removeEventListener('abort',stop);stop();await reader?.cancel().catch(()=>{});throw error;}
}
