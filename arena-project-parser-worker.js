importScripts('/arena-project-files.js?v=20261031-directfiles1');
var acknowledge,ocrResult;
self.onmessage=async function(event){
  if(event.data.type==='ack'){if(acknowledge)acknowledge();return;}
  if(event.data.type==='ocr_result'){if(ocrResult)ocrResult(event.data);return;}
  if(event.data.type!=='start')return;
  try{
    var coverage={},batch=[],ordinal=0;
    async function flush(){var waiting=new Promise(function(resolve){acknowledge=resolve;});self.postMessage({type:'batch',segments:batch});batch=[];await waiting;}
    var settings={fullVision:!!event.data.fullVision,progress:function(progress){self.postMessage({type:'progress',progress:progress});},ocr:event.data.ocr?async function(task){
      if(batch.length)await flush();
      return new Promise(function(resolve,reject){ocrResult=function(data){ocrResult=null;data.error?reject(Object.assign(Error(data.error),{name:data.aborted?'AbortError':'Error'})):resolve(data.result);};self.postMessage({type:'ocr',task:task});});
    }:null};
    for await(var segment of ArenaProjectFiles.parse(event.data.file,coverage,settings)){batch.push(Object.assign({ordinal:ordinal++},segment));if(batch.length===24)await flush();}
    if(batch.length)await flush();self.postMessage({type:'done',result:{coverage:coverage,segments:ordinal}});
  }catch(error){self.postMessage({type:'error',error:error.message||'文件解析失败',aborted:error.name==='AbortError'});}
};
