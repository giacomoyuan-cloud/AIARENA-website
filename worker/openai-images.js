import ImageControls from '../arena-image.js';

const FORMATS={png:'image/png',jpeg:'image/jpeg',webp:'image/webp'};
const LEGACY_SIZES={'1:1':'1024x1024','3:2':'1536x1024','2:3':'1024x1536','16:9':'1536x864','9:16':'864x1536','4:3':'1152x864','3:4':'864x1152',auto:'auto'};
export const IMAGE_ORCHESTRATOR='gpt-6.1-sol';
export const isOpenAIImage=ImageControls.isOpenAI;

function pngInfo(image){
  try{
    if(image?.mime!=='image/png')return null;
    const b=Uint8Array.from(atob(image.data.slice(0,48)),c=>c.charCodeAt(0));
    if(b.length<26||b[0]!==137||String.fromCharCode(...b.slice(1,4))!=='PNG')return null;
    const d=new DataView(b.buffer);return {width:d.getUint32(16),height:d.getUint32(20),alpha:[4,6].includes(b[25])};
  }catch{return null;}
}
export function validateOpenAIImage(body,images){
  const check=(key,values)=>{if(body[key]!==undefined&&!values.includes(body[key]))throw new Error('不支持的 OpenAI 图像设置：'+key);};
  check('quality',['auto','low','medium','high','xhigh','max']);check('outputFormat',['png','jpeg','webp']);
  check('background',['auto','opaque','transparent']);check('moderation',['auto','low']);
  if(body.size!==undefined&&!ImageControls.validSize(body.size))throw new Error('图片尺寸须为 16 的倍数，长宽比不超过 3:1，总像素 655,360–8,294,400，最长边不超过 3840。');
  if(body.size===undefined&&body.aspectRatio!==undefined&&!Object.hasOwn(LEGACY_SIZES,body.aspectRatio))throw new Error('请选择具体图片尺寸。');
  if(body.outputCompression!==undefined&&(!Number.isInteger(body.outputCompression)||body.outputCompression<0||body.outputCompression>100))throw new Error('输出压缩须为 0–100 的整数。');
  if(body.outputCompression!==undefined&&(body.outputFormat||'png')==='png')throw new Error('PNG 不支持输出压缩设置，请选择 JPEG 或 WebP。');
  if(body.background==='transparent'&&body.outputFormat==='jpeg')throw new Error('透明背景请使用 PNG 或 WebP。');
  if(body.partialImages!==undefined&&(!Number.isInteger(body.partialImages)||body.partialImages<0||body.partialImages>3))throw new Error('生成过程预览须为 0–3 次。');
  if(body.grounding&&body.grounding!=='off'||body.thinkingLevel!==undefined||body.imageOnly!==undefined||body.resolution!==undefined)throw new Error('OpenAI 图片不支持此 Google 或 Grok 专用设置。');
  if(body.imageMask!==undefined){
    const mask=body.imageMask,first=pngInfo(images[0]),info=pngInfo(mask);
    if(body.imageTask==='generation'||!mask||typeof mask.data!=='string'||mask.data.length>14*1024*1024||!/^[A-Za-z0-9+/]+={0,2}$/.test(mask.data)||!info?.alpha||!first||first.width!==info.width||first.height!==info.height)throw new Error('选区与第一张参考图须为同尺寸 PNG，选区须有透明通道，请重新涂抹选区。');
  }
}

export function buildImagePayload(model,prompt,body,images,history,safetyIdentifier){
  const tool={type:'image_generation',model,action:body.imageTask==='generation'||!body.imageTask?'generate':'edit',
    size:body.size||LEGACY_SIZES[body.aspectRatio||'1:1'],quality:body.quality||'auto',
    output_format:body.outputFormat||'png',background:body.background||'auto',moderation:body.moderation||'auto',partial_images:body.partialImages??2};
  if(body.outputCompression!==undefined)tool.output_compression=body.outputCompression;
  if(body.imageMask)tool.input_image_mask={image_url:'data:image/png;base64,'+body.imageMask.data};
  // Put the actual edit target first, including when older turns contain images.
  // Re-send image bytes explicitly: store:false does not rely on provider retention.
  const content=[],seen=new Set();
  const addImage=(image,explicit=false)=>{if(!explicit&&seen.has(image.data))return;seen.add(image.data);content.push({type:'input_image',image_url:'data:'+(image.mime||'image/jpeg')+';base64,'+image.data});};
  if(images.length){content.push({type:'input_text',text:'当前参考图：第一张是本次编辑目标，其余是参考素材。'});images.forEach(image=>addImage(image,true));}
  if(history.length){
    content.push({type:'input_text',text:'以下是同一图片的较早创作记录，仅作上下文。请按最后的本次要求继续修改当前目标图。'});
    for(const turn of history){
      for(const part of turn.parts){
        if(part.text)content.push({type:'input_text',text:(turn.role==='user'?'先前要求：':'先前结果说明：')+part.text});
        if(part.inlineData&&!seen.has(part.inlineData.data)){
          content.push({type:'input_text',text:turn.role==='model'?'先前生成结果：':'先前参考素材：'});
          addImage({data:part.inlineData.data,mime:part.inlineData.mimeType});
        }
      }
    }
  }
  content.push({type:'input_text',text:(history.length?'本次要求：\n':'')+prompt});
  const payload={model:IMAGE_ORCHESTRATOR,input:[{role:'user',content}],tools:[tool],tool_choice:{type:'image_generation'},
    parallel_tool_calls:false,max_tool_calls:1,reasoning:{effort:'low'},stream:true,store:false,safety_identifier:safetyIdentifier};
  if(JSON.stringify(payload).length>16*1024*1024)throw new Error('参考图和编辑上下文合计过大，请减少参考图或重新选择成图开始编辑。');
  return payload;
}

// A preview is deliberately a distinct event, never an img result or a saved turn.
export async function readImageStream(response,options){
  const reader=response.body?.getReader();if(!reader)throw new Error('OpenAI 未返回图像响应流。');
  const decoder=new TextDecoder(),seen=new Set();let pending='',complete=false,images=0,mainUsage=null;
  const result=async item=>{
    if(item?.type!=='image_generation_call'||!item.result||seen.has(item.id||item.result))return;
    seen.add(item.id||item.result);images++;
    const format=item.output_format||options.format||'png';
    await options.image(item.result,FORMATS[format]||FORMATS.png);
    await options.details({model:options.model,revisedPrompt:item.revised_prompt||'',size:item.size||options.size,quality:item.quality||options.quality,
      format,background:item.background||options.background,usage:item.usage||null});
  };
  const line=async line=>{
    if(!line.startsWith('data:'))return;
    const raw=line.slice(5).trim();if(!raw||raw==='[DONE]')return;
    let event;try{event=JSON.parse(raw);}catch{throw new Error('OpenAI 图片响应格式不完整，请检查已收到的图片后再重试。');}
    if(event.type==='error'||event.error)throw new Error((event.error?.message||event.message||'OpenAI 图片生成失败。')+(event.error?.code||event.code?' ('+(event.error?.code||event.code)+')':''));
    if(event.type==='response.failed'||event.type==='response.incomplete')throw new Error((event.response?.error?.message||'OpenAI 图片生成未完成，请检查额度或调整描述。')+(event.response?.error?.code?' ('+event.response.error.code+')':''));
    if(event.type==='response.image_generation_call.partial_image'&&event.partial_image_b64){
      await options.preview({data:event.partial_image_b64,mime:FORMATS[event.output_format||options.format]||FORMATS.png,index:event.partial_image_index});
    }
    if(event.type==='response.output_item.done')await result(event.item);
    if(event.type==='response.completed'){
      for(const item of event.response?.output||[])await result(item);
      if(event.response?.status&&event.response.status!=='completed')throw new Error('OpenAI 图片处理未完整结束。');
      mainUsage=event.response?.usage||null;complete=true;
    }
  };
  try{
    while(true){
      const part=await reader.read();if(part.done)break;
      pending+=decoder.decode(part.value,{stream:true});
      if(pending.length>40*1024*1024)throw new Error('图片结果过大，请降低尺寸或选择 WebP。');
      let end;while((end=pending.indexOf('\n'))!==-1){const value=pending.slice(0,end);pending=pending.slice(end+1);await line(value);}
    }
    pending+=decoder.decode();if(pending.trim())await line(pending);
    if(!complete)throw new Error('OpenAI 图片连接中断，已收到的成图会保留，请勿重复提交。');
    if(!images)throw new Error('OpenAI 没有返回图片，请调整描述后重试。');
    return {mainUsage,images};
  }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
