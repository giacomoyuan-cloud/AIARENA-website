// File preparation stores original visual data; it never calls a model.
export const DOCUMENT_DELIVERY_VERSION='20261031-directfiles1';
export const NATIVE_PDF_BYTES=8*1024*1024;
export const DIRECT_IMAGE_BYTES=3*1024*1024;
export function mediaInput(input){
  if(!Number.isSafeInteger(input.page)||input.page<1||!Number.isSafeInteger(input.total)||input.page>input.total)throw Error('页面编号无效');
  if(!['image/jpeg','image/png','image/webp'].includes(input.mime)||typeof input.data!=='string'||!input.data.length||input.data.length>8*1024*1024||input.data.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(input.data))throw Error('页面图片无效或过大');
  if(input.mime==='image/jpeg'&&!input.data.startsWith('/9j/')||input.mime==='image/png'&&!input.data.startsWith('iVBOR')||input.mime==='image/webp'&&!input.data.startsWith('UklG'))throw Error('页面图片类型不一致');
  return Uint8Array.from(atob(input.data),c=>c.charCodeAt(0));
}
export function bytesBase64(bytes){let text='';for(let i=0;i<bytes.length;i+=8192)text+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(text);}
export async function mediaImages(source,segments){
  const images=[];
  for(const segment of segments){if(!segment.media)continue;
    const response=await source.library('media_download',{fileId:segment.fileId,mediaId:segment.media.id});
    if(!response.ok)throw Error('文件页面暂不可读取，请重试');
    const bytes=new Uint8Array(await response.arrayBuffer());
    if(bytes.length!==segment.media.size)throw Error('文件页面长度不一致，尚未提交给模型');
    images.push({data:bytesBase64(bytes),mime:segment.media.mime,location:segment.location,name:segment.name});
  }return images;
}
export function appendDocumentParts(provider,payload,documents=[],images=[]){
  if(!documents.length&&!images.length)return;
  if(provider==='anthropic'){
    const last=payload.messages.at(-1);if(typeof last.content==='string')last.content=[{type:'text',text:last.content}];
    last.content.push(...documents.map(f=>({type:'document',title:f.name,source:{type:'base64',media_type:'application/pdf',data:f.data}})),...images.flatMap(f=>[{type:'text',text:'原图：'+f.name+'，'+f.location},{type:'image',source:{type:'base64',media_type:f.mime,data:f.data}}]));
  }else if(provider==='google'){
    payload.contents.at(-1).parts.push(...documents.flatMap(f=>[{text:'完整 PDF 原件：'+f.name},{inline_data:{mime_type:'application/pdf',data:f.data}}]),...images.flatMap(f=>[{text:'原图：'+f.name+'，'+f.location},{inline_data:{mime_type:f.mime,data:f.data}}]));
  }else{
    const last=payload.input.at(-1);if(typeof last.content==='string')last.content=[{type:'input_text',text:last.content}];
    if(provider==='xai'&&documents.length)throw Error('Grok 全文模式使用完整文字或页面图片，不能用附件检索代替全文');
    last.content.push(...documents.map(f=>({type:'input_file',filename:f.name,file_data:'data:application/pdf;base64,'+f.data})),...images.flatMap(f=>[{type:'input_text',text:'原图：'+f.name+'，'+f.location},{type:'input_image',image_url:'data:'+f.mime+';base64,'+f.data}]));
  }
}
