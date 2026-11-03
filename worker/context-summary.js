import {AUXILIARY_MODEL,AUXILIARY_SETTINGS} from './auxiliary-model.js';
import {hasOpenAIKey} from './openai-keys.js';

// Keep conversation checkpoints with the selected provider. They must not
// introduce another provider dependency or replay an uncertain paid request.
export async function completeContextSummary({provider,model,env,prompt,schema,fetcher,readStream,recordUsage}){
  const summaryModel=provider==='anthropic'?AUXILIARY_MODEL:provider==='openai'?'gpt-6.1-sol':model;
  let url,headers={'Content-Type':'application/json'},payload;
  if(provider==='anthropic'){
    if(!env.ANTHROPIC_API_KEY)throw Error('任务摘要服务暂不可用');
    url='https://api.anthropic.com/v1/messages';
    headers={...headers,Authorization:'Bearer '+env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01'};
    payload={...AUXILIARY_SETTINGS,max_tokens:8192,stream:true,output_config:{...AUXILIARY_SETTINGS.output_config,format:{type:'json_schema',schema}},messages:[{role:'user',content:prompt}]};
  }else if(provider==='google'){
    if(!env.GEMINI_API_KEY)throw Error('任务摘要服务暂不可用');
    url='https://generativelanguage.googleapis.com/v1beta/models/'+encodeURIComponent(summaryModel)+':streamGenerateContent?alt=sse';
    headers['x-goog-api-key']=env.GEMINI_API_KEY;
    payload={contents:[{role:'user',parts:[{text:prompt}]}],generationConfig:{maxOutputTokens:8192,thinkingConfig:{thinkingLevel:'low'},responseMimeType:'application/json',responseJsonSchema:schema}};
  }else if(provider==='openai'||provider==='xai'){
    if(provider==='openai'?!hasOpenAIKey(env):!env.GROK_API_KEY)throw Error('任务摘要服务暂不可用');
    url=provider==='openai'?'https://api.openai.com/v1/responses':'https://api.x.ai/v1/responses';
    headers.Authorization='Bearer '+(provider==='openai'?env.OPENAI_API_KEY:env.GROK_API_KEY);
    payload={model:summaryModel,input:[{role:'user',content:prompt}],store:false,stream:true,reasoning:{effort:'low'},...(provider==='openai'?{service_tier:'default'}:{}),max_output_tokens:8192,text:{format:{type:'json_schema',name:'conversation_state',strict:true,schema}}};
  }else throw Error('当前模型暂不支持任务摘要');
  let usage,finished=false,stopReason,text='',valid=false;
  try{
    const response=await fetcher(url,{method:'POST',headers,body:JSON.stringify(payload)});
    if(!response.ok){
      const error=await response.json().catch(()=>null);
      usage=error?.usage||error?.usageMetadata||error?.error?.usage;
      throw Error('任务摘要接口未完成，保留原文');
    }
    await readStream(response,event=>{
      if(provider==='anthropic'){
        if(event.type==='message_start'&&event.message?.usage)usage={...event.message.usage};
        if(event.type==='message_delta'){
          if(event.usage)usage={...usage,...event.usage};
          if(event.delta?.stop_reason)stopReason=event.delta.stop_reason;
        }
        if(event.type==='content_block_delta'&&event.delta?.type==='text_delta')text+=event.delta.text||'';
        if(event.type==='message_stop')finished=stopReason==='end_turn';
      }else if(provider==='google'){
        if(event.usageMetadata)usage={...usage,...event.usageMetadata};
        for(const part of event.candidates?.[0]?.content?.parts||[])if(!part.thought&&part.text)text+=part.text;
        if(event.candidates?.[0]?.finishReason)finished=event.candidates[0].finishReason==='STOP';
        if(event.promptFeedback?.blockReason)throw Error('任务摘要未完整返回');
      }else{
        if(event.type==='response.output_text.delta')text+=event.delta||'';
        if(event.response?.usage)usage=event.response.usage;
        if(event.type==='response.completed'){
          finished=event.response?.status==='completed';
          if(!text)text=(event.response?.output||[]).flatMap(x=>x.content||[]).filter(x=>x.type==='output_text').map(x=>x.text||'').join('');
        }
        if(['response.incomplete','response.failed','response.refusal.done'].includes(event.type))throw Error('任务摘要未完整返回');
      }
    });
    if(!finished||!text.trim())throw Error('任务摘要未完整返回');
    const value=JSON.parse(text);valid=true;return value;
  }finally{
    await recordUsage(summaryModel,usage,{provider,purpose:'context-summary',incompleteUsage:!valid||!usage});
  }
}
