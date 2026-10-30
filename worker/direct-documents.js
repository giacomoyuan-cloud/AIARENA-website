import {bytesBase64,mediaImages,NATIVE_PDF_BYTES,DIRECT_IMAGE_BYTES} from './document-media.js';
import {materialName} from '../web/file-types.mjs';
const hash=async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),b=>b.toString(16).padStart(2,'0')).join('');
const encoder=new TextEncoder();

// The final model receives original PDFs or complete extracted text and images.
// Returning null asks the same selected model to process every batch, not a
// different model and not an silently shortened copy of the source.
export async function directDocuments(sources,{provider,budgetBytes,forceBatches=false}){
  if(forceBatches)return null;
  const actual=sources.filter(s=>s.files.length),files=actual.flatMap(s=>s.files.map(f=>({...f,source:s.kind||'project'})));
  if(!files.length)return null;
  const originals=[],images=[],text=[];let bytes=0,pdfBytes=0,visualBytes=0,fragments=0;
  for(const source of actual){
    const native=source.files.filter(f=>provider!=='xai'&&/\.pdf$/i.test(f.name)&&f.storage==='r2'&&(!f.type||['application/pdf','application/octet-stream'].includes(f.type))&&f.size<=NATIVE_PDF_BYTES&&Number(f.coverage?.units||0)<=80&&source.original);
    for(const file of native){pdfBytes+=file.size;if(pdfBytes>NATIVE_PDF_BYTES)return null;}
    const plain=source.files.filter(f=>!native.includes(f));
    if(plain.some(f=>f.storage==='r2'&&(!['ready','partial'].includes(f.status)||f.status==='partial'&&Number(f.coverage?.emptyUnits||0)>0)))throw Error('文件图文尚未准备完整，请继续文件准备后再发送');
    if(plain.length){
      const scope=await hash(JSON.stringify(plain.map(f=>[f.id,f.indexedAt,f.segments,f.chunks])));
      await source.library('scope',{scope,ids:plain.filter(f=>f.storage==='r2').map(f=>f.id)});
      let offset=0;
      for(;;){const batch=await source.library('batch',{scope,offset});if(batch.done)break;if(!batch.segments.length||batch.next<=offset)throw Error('文件阅读位置未推进，未提交模型请求');
        for(const segment of batch.segments){
          const part='资料：'+segment.name+'，'+segment.location+'\n'+segment.text;
          bytes+=encoder.encode(part).length;if(bytes>budgetBytes)return null;
          text.push(part);fragments++;
          if(segment.media){visualBytes+=segment.media.size;if(images.length>=3||visualBytes>DIRECT_IMAGE_BYTES)return null;images.push(...await mediaImages(source,[segment]));}
        }offset=batch.next;
      }
      for(const file of plain.filter(f=>f.storage!=='r2'))for await(const batch of source.batchLegacy(file))for(const segment of batch){const part='资料：'+materialName(file)+'，'+(segment.location||'正文')+'\n'+segment.text;bytes+=encoder.encode(part).length;if(bytes>budgetBytes)return null;text.push(part);fragments++;}
    }
    for(const file of native){const response=await source.original(file),data=new Uint8Array(await response.arrayBuffer());if(new TextDecoder().decode(data.subarray(0,5))!=='%PDF-')throw Error('PDF 原件格式校验失败，尚未提交模型');if(data.length!==file.size)throw Error('文件原件大小校验失败，未提交模型请求');originals.push({name:materialName(file),mime:'application/pdf',data:bytesBase64(data)});fragments+=Number(file.segments||file.chunks||file.coverage?.units||1);}
  }
  const total=files.reduce((n,f)=>n+Number(f.segments||f.chunks||f.coverage?.units||1),0);
  return {text:text.join('\n\n'),originals,images,files:files.map(f=>({id:f.id,name:materialName(f),source:f.source})),fragments:fragments||total,mode:'full',delivery:originals.length?'native':'complete',coverage:{done:total,total,complete:true,...(files.some(f=>f.coverage?.uncertainUnits)?{recognitionWarnings:files.filter(f=>f.coverage?.uncertainUnits).map(f=>({file:materialName(f),pages:f.coverage.uncertainUnits}))}:{})},usage:[]};
}
