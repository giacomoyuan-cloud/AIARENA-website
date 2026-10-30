import { MAX_FILE_BASE64_CHARS } from '../web/upload-limits.mjs';

// KV values are limited to 25 MiB. Keep originals in bounded, quartet-aligned
// base64 segments and publish their manifest only after all segments are saved.
export const ORIGINAL_CHUNK_CHARS = 4 * 1024 * 1024;
const unavailable = () => Object.assign(Error('文件原件暂不可用，请稍后重试'), { status: 503 });
function validateManifest(file) {
  if (!Number.isInteger(file.dataChunks) || file.dataChunks < 1 || file.dataChunks > Math.ceil(MAX_FILE_BASE64_CHARS / ORIGINAL_CHUNK_CHARS) || !Number.isInteger(file.dataLength) || file.dataLength > MAX_FILE_BASE64_CHARS || file.dataLength <= 0 || Math.ceil(file.dataLength / ORIGINAL_CHUNK_CHARS) !== file.dataChunks) throw unavailable();
}
async function originalPart(kv,key,file,index) {
  const chunk=await kv.get(key+':data:'+index),expected=Math.min(ORIGINAL_CHUNK_CHARS,file.dataLength-index*ORIGINAL_CHUNK_CHARS);
  if(typeof chunk!=='string'||chunk.length!==expected||!/^[A-Za-z0-9+/]*={0,2}$/.test(chunk))throw unavailable();
  return chunk;
}
export async function storeProjectOriginal(kv, key, file, put = (name, value) => kv.put(name, value)) {
  if (file.data.length <= ORIGINAL_CHUNK_CHARS) return put(key, JSON.stringify(file));
  const { data, ...metadata } = file;
  const dataChunks = Math.ceil(data.length / ORIGINAL_CHUNK_CHARS), written = [];
  try {
    for (let i = 0; i < dataChunks; i++) {
      const partKey = key + ':data:' + i;
      written.push(partKey);
      await put(partKey, data.slice(i * ORIGINAL_CHUNK_CHARS, (i + 1) * ORIGINAL_CHUNK_CHARS));
    }
    await put(key, JSON.stringify({ ...metadata, dataChunks, dataLength: data.length }));
  } catch (error) {
    await Promise.allSettled([...written,key].map(name => kv.delete(name)));
    throw error;
  }
}
export async function readProjectOriginal(kv, key, { withData = false } = {}) {
  const raw = await kv.get(key);
  if (!raw) throw unavailable();
  const file = JSON.parse(raw);
  if (!withData) { const { data, ...metadata } = file; return metadata; }
  if (file.dataChunks !== undefined) {
    validateManifest(file);
    const chunks = [];
    for (let i = 0; i < file.dataChunks; i++) {
      chunks.push(await originalPart(kv,key,file,i));
    }
    file.data = chunks.join('');
    delete file.dataChunks; delete file.dataLength;
  }
  if (typeof file.data !== 'string') throw unavailable();
  return file;
}
export async function downloadProjectOriginal(kv,key) {
  const raw=await kv.get(key);if(!raw)throw unavailable();
  const file=JSON.parse(raw),headers={'Content-Type':'application/json; charset=utf-8','Access-Control-Allow-Origin':'*','Cache-Control':'no-store'};
  if(file.dataChunks===undefined){if(typeof file.data!=='string')throw unavailable();return Response.json({file},{headers});}
  validateManifest(file);
  // Verify completeness before sending headers. The second pass streams parts
  // from KV without joining and JSON-encoding a complete large original again.
  for(let i=0;i<file.dataChunks;i++)await originalPart(kv,key,file,i);
  const {dataChunks,dataLength,...metadata}=file,encoder=new TextEncoder();let index=-1;
  const body=new ReadableStream({async pull(controller){
    if(index===-1){index=0;controller.enqueue(encoder.encode('{"file":'+JSON.stringify(metadata).slice(0,-1)+',"data":"'));return;}
    if(index<dataChunks){controller.enqueue(encoder.encode(await originalPart(kv,key,file,index++)));return;}
    controller.enqueue(encoder.encode('"}}'));controller.close();
  }});
  return new Response(body,{headers});
}
