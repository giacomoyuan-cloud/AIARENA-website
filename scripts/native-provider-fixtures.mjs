// In-process provider protocol fixtures. No request is sent to a model service.
export function syntheticProviders({events,writeEvidence}) {
 const attempts=new Map();
 const textInput=p=>JSON.stringify(p.input||p.messages||'');
 const usage={input_tokens:12,output_tokens:9,input_tokens_details:{cached_tokens:0,cache_write_tokens:0},output_tokens_details:{reasoning_tokens:0}};
 return async function fixtureFetch(url,options={}) {
  const target=String(url instanceof Request?url.url:url);
  const body=typeof options.body==='string'?JSON.parse(options.body):{};
  const image='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=';
  if(target.startsWith('https://api.x.ai/v1/images/')) {
   events.push({kind:'image-fixture',provider:'xai',synthetic:true,externalModelCalls:0});await writeEvidence();return Response.json({data:[{b64_json:image,mime_type:'image/png'}],usage:{input_tokens:10,output_tokens:15}});
  }
  if(target.startsWith('https://generativelanguage.googleapis.com/')&&target.endsWith(':generateContent')) {
   events.push({kind:'image-fixture',provider:'google',synthetic:true,externalModelCalls:0});await writeEvidence();return Response.json({candidates:[{content:{role:'model',parts:[{inlineData:{mimeType:'image/png',data:image}}]},finishReason:'STOP'}],usageMetadata:{promptTokenCount:10,candidatesTokenCount:15,totalTokenCount:25}});
  }
  if(target.endsWith('/input_tokens')||target.endsWith('/count_tokens'))return Response.json({input_tokens:128});
  if(target==='https://api.anthropic.com/v1/files'&&options.method==='POST')return Response.json({id:'file_native_input_123'});
  if(/^https:\/\/api.anthropic.com\/v1\/files\/file_/.test(target)) {
   if(options.method==='DELETE')return Response.json({deleted:true});
   if(target.endsWith('/content'))return new Response('Synthetic original artifact bytes',{headers:{'Content-Type':'text/plain'}});
   return Response.json({id:'file_native_output_123',filename:'native-result.txt',mime_type:'text/plain',size:33});
  }
  const tool=body.tools?.find(x=>x.name==='select_skills');
  if(tool) {
   events.push({kind:'router-fixture',synthetic:true,requestedModel:body.model,externalModelCalls:0});await writeEvidence();
   return Response.json({content:[{type:'tool_use',id:'selection_native',name:'select_skills',input:{ids:[],output:'text'}}],usage:{input_tokens:12,output_tokens:9}});
  }
  if(target==='https://api.anthropic.com/v1/messages') {
   if(body.container?.skills) {
    events.push({kind:'document-fixture',synthetic:true,requestedModel:body.model,externalModelCalls:0});await writeEvidence();
    return Response.json({container:{id:'container_native_123'},stop_reason:'end_turn',content:[{type:'server_tool_use',id:'code_native',name:'bash_code_execution',input:{command:'synthetic'}},{type:'bash_code_execution_tool_result',tool_use_id:'code_native',content:{type:'bash_code_execution_result',return_code:0,stdout:'',stderr:'',content:JSON.stringify(body.messages).includes('合成文件下载验收')?[{type:'bash_code_execution_output',file_id:'file_native_output_123'}]:[]}},{type:'text',text:'合成附件分析已经完成。'}],usage:{input_tokens:12,output_tokens:9}});
   }
   events.push({kind:'memory-fixture',synthetic:true,requestedModel:body.model,externalModelCalls:0});await writeEvidence();return Response.json({content:[{type:'text',text:'- 合成账号偏好简洁回答'}],usage:{input_tokens:12,output_tokens:9}});
  }
  if(target==='https://api.openai.com/v1/responses') {
   if(body.tools?.some(t=>t.name==='select_skills'))return Response.json({status:'completed',output:[{type:'function_call',name:'select_skills',arguments:'{"ids":[],"output":"text"}'}],usage});
   if(body.model!=='gpt-6.1-sol'||body.reasoning?.effort!=='low')throw Error('Synthetic text executor only permits Sol 6.1 Low');
   const prompt=textInput(body),identity=(prompt.match(/你的独立席位：([^\\\n]+)/)||[])[1]||'chat',stage=prompt.includes('本轮：独立观点')?'independent':prompt.includes('你是中立的总结者')?'summary':'cross';
   const key=prompt+'|'+identity+'|'+stage,attempt=(attempts.get(key)||0)+1;attempts.set(key,attempt);
   const event={kind:'provider',model:body.model,effort:body.reasoning.effort,identity,stage,attempt,synthetic:true,externalModelCalls:0,originalFiles:(body.input||[]).flatMap(x=>x.content||[]).filter(x=>x.type==='input_file').length,originalImages:(body.input||[]).flatMap(x=>x.content||[]).filter(x=>x.type==='input_image').length};events.push(event);await writeEvidence();
   if(identity.startsWith('seat-2')&&stage==='independent'&&attempt===1){event.outcome='injected-failure';await writeEvidence();return Response.json({error:{message:'合成测试：第二席暂时不可用'}},{status:503});}
   const slow=prompt.includes('慢速任务验收');
   const text=prompt.includes('UI 排版验收')?"## 排版验收\n\n美元价格 $20 / $100 保留原样。公式 $a^2+b^2=c^2$ 和 \\(x_1+\\frac{1}{2}\\)。\n\n$$\n\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}\n$$\n\n```js\nconst price = \"$20\";\nconst total = 12345;\n```\n\n| 模型 | 输入 | 输出 | 说明 |\n| --- | ---: | ---: | --- |\n| 示例 A | $4 | $20 | 表格验收 |\n| 示例 B | $2 | $10 | 逐项阅读 |\n\n复制、选区引用与追问保持可用。":slow?'原生停止任务的合成长回复。'.repeat(30):stage==='summary'?'合成总结：已完成讨论并保留全部席位。':identity.startsWith('seat-1')&&stage==='independent'?'这是第一席的合成观点，用于验证刷新和短暂断网后仍然继续读取同一条回答。已经完成的发言会保留，第二席失败后只重试当前席位。':'这是原生完整后端的合成回复。';
   const response={id:'resp_native_'+events.length,status:'completed',model:body.model,output:[{type:'message',role:'assistant',content:[{type:'output_text',text}]}],usage};
   if(!body.stream){event.outcome='completed';await writeEvidence();return Response.json(response);}
   let timer,closed=false,index=0;return new Response(new ReadableStream({start(c){timer=setInterval(()=>{if(closed)return;if(index<text.length){c.enqueue(new TextEncoder().encode('data: '+JSON.stringify({type:'response.output_text.delta',delta:text.slice(index,index+4)})+'\n\n'));index+=4;}else{clearInterval(timer);c.enqueue(new TextEncoder().encode('data: '+JSON.stringify({type:'response.completed',response})+'\n\n'));c.close();closed=true;event.outcome='completed';writeEvidence();}},identity.startsWith('seat-1')||slow?300:70)},cancel(){clearInterval(timer);closed=true;event.outcome='stopped';writeEvidence()}}),{headers:{'Content-Type':'text/event-stream'}});
  }
  throw Error('External provider network is disabled: '+new URL(target).hostname);
 };
}
