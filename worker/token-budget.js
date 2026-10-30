import Limits from '../arena-token-limits.js';

const encoder=new TextEncoder();
const countError=()=>new Error('无法核对模型的上下文容量，已保留原文，本轮未提交生成请求。');
const jsonHeaders={'Content-Type':'application/json'};

// These endpoints tokenize input only; they never start a model generation.
export async function countInputTokens({provider,model,payload,env,signal,fetcher=fetch}){
  let url,headers,body,visionAllowance=0;
  if(provider==='anthropic'){
    url='https://api.anthropic.com/v1/messages/count_tokens';
    headers={...jsonHeaders,Authorization:'Bearer '+env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01'};
    body={model,messages:payload.messages,...(payload.system?{system:payload.system}:{}),...(payload.tools?{tools:payload.tools}:{}),...(payload.tool_choice?{tool_choice:payload.tool_choice}:{})};
  }else if(provider==='openai'){
    url='https://api.openai.com/v1/responses/input_tokens';
    headers={...jsonHeaders,Authorization:'Bearer '+env.OPENAI_API_KEY};
    body={model,input:payload.input,...(payload.instructions?{instructions:payload.instructions}:{}),...(payload.tools?{tools:payload.tools}:{})};
  }else if(provider==='google'){
    url='https://generativelanguage.googleapis.com/v1beta/models/'+model+':countTokens';
    headers={...jsonHeaders,'x-goog-api-key':env.GEMINI_API_KEY};
    body={generateContentRequest:{model:'models/'+model,contents:payload.contents,...(payload.systemInstruction?{systemInstruction:payload.systemInstruction}:{}),...(payload.tools?{tools:payload.tools}:{})}};
  }else if(provider==='xai'){
    url='https://api.x.ai/v1/tokenize-text';
    headers={...jsonHeaders,Authorization:'Bearer '+env.GROK_API_KEY};
    // Serialize roles, tools and instructions too, rather than counting text alone.
    body={model,text:JSON.stringify({instructions:payload.instructions,input:payload.input,tools:payload.tools},(key,value)=>{
      if(value?.type==='input_image'){visionAllowance+=65536;return {type:'input_text',text:'[完整图片输入，另计视觉容量]'};}
      return value;
    })};
  }else throw countError();
  let data;
  try{
    const response=await fetcher(url,{method:'POST',redirect:'manual',headers,body:JSON.stringify(body),signal});
    if(!response.ok)throw countError();
    data=await response.json();
  }catch(error){if(signal?.aborted)throw error;throw countError();}
  const tokens=provider==='google'?data.totalTokens:provider==='xai'&&Array.isArray(data.token_ids)?data.token_ids.length+1024+visionAllowance:data.input_tokens;
  if(!Number.isSafeInteger(tokens)||tokens<0)throw countError();
  return tokens;
}

function shape(provider,payload){
  if(provider==='anthropic')return {key:'messages',items:payload.messages,system:payload.system||'',write:(p,s)=>{p.system=s;}};
  if(provider==='google')return {key:'contents',items:payload.contents,system:(payload.systemInstruction?.parts||[]).map(p=>p.text||'').join('\n'),write:(p,s)=>{p.systemInstruction={parts:[{text:s}]};}};
  return {key:'input',items:payload.input,system:payload.instructions||'',write:(p,s)=>{p.instructions=s;}};
}

export async function fitTokenBudget({provider,model,payload,env,signal,outputTokens,compact=()=>({text:''}),protectedTail=1,exactMedia=false,fetcher=fetch}){
  const limits=Limits.get(model),budget=Limits.inputBudget(model,outputTokens);
  const form=shape(provider,payload),items=Array.isArray(form.items)?form.items:null;
  const history=items?items.slice(0,-protectedTail):[],current=items?.slice(-protectedTail)||[];
  const cache=new Map();
  async function candidate(start){
    while(start<history.length&&['assistant','model'].includes(history[start].role))start++;
    if(cache.has(start))return cache.get(start);
    const note=start?compact(start):{text:''},next={...payload};
    if(items){next[form.key]=history.slice(start).concat(current);if(start&&note.text)form.write(next,form.system+'\n'+note.text);}
    // A byte upper bound avoids a token-count round trip for safely small text
    // requests. Large inputs and Argon's shared long-decode budget use native counts.
    const upper=encoder.encode(JSON.stringify(next)).length+8192;
    const exact=exactMedia||(limits.longDecode&&outputTokens>65536)||upper>budget;
    const tokens=exact?await countInputTokens({provider,model,payload:next,env,signal,fetcher}):upper;
    const value={payload:next,inputTokens:tokens,countMethod:exact?'provider':'byte-upper-bound',dropped:start,note};
    cache.set(start,value);return value;
  }
  let result=await candidate(0);
  if(result.inputTokens>budget){
    if(!history.length)throw new Error('当前问题及资料超过该模型可用的输入容量；原文已保留，本轮未提交生成请求。');
    let low=0,high=history.length;
    result=await candidate(high);
    if(result.inputTokens>budget)throw new Error('当前问题及资料超过该模型可用的输入容量；原文已保留，本轮未提交生成请求。');
    // Keep the largest suffix of complete messages that fits. Never cut the
    // middle out of a user message or silently clip an individual answer.
    while(low<high){
      const mid=Math.floor((low+high)/2),trial=await candidate(mid);
      if(trial.inputTokens<=budget){high=mid;result=trial;}else low=mid+1;
    }
    result=await candidate(high);
  }
  result.outputTokens=limits.longDecode?Math.min(outputTokens,limits.contextTokens-result.inputTokens-1024):outputTokens;
  if(result.outputTokens<32)throw new Error('上下文未留出回答空间，本轮未提交生成请求。');
  if(provider==='anthropic')result.payload.max_tokens=result.outputTokens;
  else if(provider==='google')result.payload.generationConfig={...result.payload.generationConfig,maxOutputTokens:result.outputTokens};
  else result.payload.max_output_tokens=result.outputTokens;
  return {...result,contextTokens:limits.contextTokens,inputBudget:budget,historyCount:history.length-result.dropped};
}
