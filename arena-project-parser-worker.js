importScripts('/arena-project-files.js?v=20261030-materials1');
var acknowledge;
self.onmessage=async function(event){
  if(event.data.type==='ack'){if(acknowledge)acknowledge();return;}
  if(event.data.type!=='start')return;
  try{
    var coverage={},batch=[],ordinal=0;
    async function flush(){var waiting=new Promise(function(resolve){acknowledge=resolve;});self.postMessage({type:'batch',segments:batch});batch=[];await waiting;}
    for await(var segment of ArenaProjectFiles.parse(event.data.file,coverage)){batch.push(Object.assign({ordinal:ordinal++},segment));if(batch.length===24)await flush();}
    if(batch.length)await flush();self.postMessage({type:'done',result:{coverage:coverage,segments:ordinal}});
  }catch(error){self.postMessage({type:'error',error:error.message||'文件解析失败'});}
};
