(function(root,factory){
  var api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;else root.ArenaProjectFiles=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(root){
  'use strict';
  var libraries={};
  function load(name,url){
    if(root[name])return Promise.resolve(root[name]);if(libraries[name])return libraries[name];
    return libraries[name]=new Promise(function(resolve,reject){
      if(typeof importScripts==='function'){try{importScripts(url);resolve(root[name]);}catch(error){reject(error);}return;}
      var script=document.createElement('script');script.src=url;script.onload=function(){resolve(root[name]);};script.onerror=function(){delete libraries[name];reject(Error('文件解析工具加载失败，请重试'));};document.head.appendChild(script);
    });
  }
  function boundary(text,size){return size<text.length&&/[\uD800-\uDBFF]/.test(text[size-1])&&/[\uDC00-\uDFFF]/.test(text[size])?size-1:size;}
  function split(text,location){
    var result=[];for(var i=0;i<text.length;){var end=i+boundary(text.slice(i),Math.min(2400,text.length-i)),value=text.slice(i,end);i=end;if(value.trim())result.push({text:value,location:location||'正文'});}return result;
  }
  async function* parse(file,coverage){
    coverage=coverage||{};coverage.units=0;coverage.emptyUnits=0;
    var ext=file.name.split('.').pop().toLowerCase();
    if(['txt','md','csv','tsv','json','log'].includes(ext)){
      var reader=file.stream().getReader(),decoder=new TextDecoder(),buffer='',position=0;
      try{for(;;){var part=await reader.read();buffer+=decoder.decode(part.value||new Uint8Array(),{stream:!part.done});
        while(buffer.length>=2400){var end=boundary(buffer,2400),text=buffer.slice(0,end);buffer=buffer.slice(end);if(text.trim())yield {text:text,location:'正文 · 字符 '+(position+1)+'–'+(position+text.length)};position+=text.length;}
        if(part.done)break;
      }if(buffer.trim())yield {text:buffer,location:'正文 · 字符 '+(position+1)+'–'+(position+buffer.length)};
      }finally{reader.releaseLock();}coverage.units=1;if(!position&&!buffer.trim())coverage.emptyUnits=1;return;
    }
    var buffer=await file.arrayBuffer();
    if(ext==='pdf'){
      var pdfjs=await load('pdfjsLib','https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js');
      pdfjs.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      var pdf=await pdfjs.getDocument({data:new Uint8Array(buffer),isEvalSupported:false}).promise;
      try{coverage.units=pdf.numPages;for(var pageNumber=1;pageNumber<=pdf.numPages;pageNumber++){
        var page=await pdf.getPage(pageNumber),content=await page.getTextContent(),text=content.items.map(function(x){return x.str+(x.hasEOL?'\n':' ');}).join('');
        if(!text.trim())coverage.emptyUnits++;for(var segment of split(text,'第 '+pageNumber+' 页'))yield segment;page.cleanup();
      }}finally{await pdf.destroy();}return;
    }
    if(ext==='docx'){
      var mammoth=await load('mammoth','https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js'),text=(await mammoth.extractRawText({arrayBuffer:buffer})).value;
      coverage.units=1;coverage.emptyUnits=text.trim()?0:1;for(var segment of split(text,'Word 正文'))yield segment;return;
    }
    if(ext==='xlsx'||ext==='xls'){
      var xlsx=await load('XLSX','https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'),book=xlsx.read(buffer,{type:'array',cellDates:false});coverage.units=book.SheetNames.length;
      for(var name of book.SheetNames){
        var sheet=book.Sheets[name],addresses=Object.keys(sheet).filter(function(address){return /^[A-Z]+[1-9][0-9]*$/.test(address);}).map(function(address){return {address:address,position:xlsx.utils.decode_cell(address)};}).sort(function(a,b){return a.position.r-b.position.r||a.position.c-b.position.c;}),pending='',firstRow=addresses.length?addresses[0].position.r+1:0,lastRow=firstRow;
        for(var entry of addresses){
          var cell=sheet[entry.address],value=String(cell.w!==undefined?cell.w:cell.v!==undefined?cell.v:cell.f?'='+cell.f+'（无缓存结果）':''),line=entry.address+'='+JSON.stringify(value)+'\n';
          if(pending.length&&pending.length+line.length>2200){for(var segment of split(pending,'工作表「'+name+'」第 '+firstRow+'–'+lastRow+' 行'))yield segment;pending='';firstRow=entry.position.r+1;}
          pending+=line;lastRow=entry.position.r+1;
        }for(var segment of split(pending,'工作表「'+name+'」第 '+firstRow+'–'+lastRow+' 行'))yield segment;
      }return;
    }
    if(ext==='pptx'){
      var JSZip=await load('JSZip','https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'),zip=await JSZip.loadAsync(buffer),slides=Object.keys(zip.files).filter(function(n){return /^ppt\/slides\/slide\d+\.xml$/.test(n);}).sort(function(a,b){return Number(a.match(/slide(\d+)/)[1])-Number(b.match(/slide(\d+)/)[1]);});coverage.units=slides.length;
      for(var i=0;i<slides.length;i++){
        var xml=await zip.file(slides[i]).async('string'),parts=[];
        for(var match of xml.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g))parts.push(match[1].replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&'));
        var text=parts.join('\n');if(!text.trim())coverage.emptyUnits++;for(var segment of split(text,'幻灯片 '+(i+1)))yield segment;
      }return;
    }
    throw Error('支持 PDF、Word（DOCX）、Excel、PPT 和常见文本；旧 DOC 请转换为 DOCX');
  }
  function parseInWorker(file,onBatch,signal){
    if(typeof Worker==='undefined')return (async function(){var coverage={},batch=[],ordinal=0;for await(var segment of parse(file,coverage)){batch.push(Object.assign({ordinal:ordinal++},segment));if(batch.length===24){await onBatch(batch);batch=[];}}if(batch.length)await onBatch(batch);return {coverage:coverage,segments:ordinal};})();
    return new Promise(function(resolve,reject){
      var worker=new Worker('/arena-project-parser-worker.js?v=20261030-materials1'),finished=false;
      function stop(error,result){if(finished)return;finished=true;worker.terminate();if(signal)signal.removeEventListener('abort',abort);error?reject(error):resolve(result);}
      function abort(){stop(Object.assign(Error('上传已暂停，重新选择原文件可继续'),{name:'AbortError'}));}
      if(signal){if(signal.aborted)return abort();signal.addEventListener('abort',abort,{once:true});}
      worker.onerror=function(){stop(Error('文件解析中断，原文件已保存，可重新选择文件重试'));};
      worker.onmessage=async function(event){var data=event.data;try{if(data.type==='batch'){await onBatch(data.segments);worker.postMessage({type:'ack'});}else if(data.type==='done')stop(null,data.result);else if(data.type==='error')stop(Error(data.error));}catch(error){stop(error);}};
      worker.postMessage({type:'start',file:file});
    });
  }
  function sessionStore(){
    if(typeof indexedDB==='undefined')return Promise.resolve(null);
    return new Promise(function(resolve){var request=indexedDB.open('arena-project-upload-sessions',1);request.onupgradeneeded=function(){request.result.createObjectStore('sessions');};request.onsuccess=function(){resolve(request.result);};request.onerror=function(){resolve(null);};});
  }
  async function session(action,key,value){var db=await sessionStore();if(!db)return null;return new Promise(function(resolve){var tx=db.transaction('sessions',action==='get'?'readonly':'readwrite'),store=tx.objectStore('sessions'),r=action==='get'?store.get(key):action==='delete'?store.delete(key):store.put(value,key);r.onsuccess=function(){resolve(r.result);};r.onerror=function(){resolve(null);};tx.oncomplete=function(){db.close();};});}
  async function fingerprint(file){var first=new Uint8Array(await file.slice(0,32768).arrayBuffer()),last=new Uint8Array(await file.slice(Math.max(0,file.size-32768)).arrayBuffer()),bytes=new Uint8Array(first.length+last.length);bytes.set(first);bytes.set(last,first.length);return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');}
  async function upload(options){
    var file=options.file,credentials=options.credentials,key=credentials.username.toLowerCase()+'|'+options.projectId+'|'+file.name+'|'+file.size+'|'+file.lastModified+'|'+await fingerprint(file),saved=await session('get',key)||{id:crypto.randomUUID(),parts:[]};
    var auth=Object.assign({},credentials),id=saved.id;
    function api(action,extra){if(options.signal?.aborted||options.isCurrent&& !options.isCurrent())throw Object.assign(Error('账号已切换，上传已暂停'),{name:'AbortError'});return options.api('library_'+action,Object.assign({projectId:options.projectId,fileId:id},extra||{},auth));}
    function progress(phase,done,total){if(options.progress)options.progress({phase:phase,done:done,total:total,name:file.name});}
    var descriptor={id:id,name:file.name,size:file.size,type:file.type};if(options.folder){descriptor.folder=options.folder;descriptor.relativePath=options.relativePath;}
    var started=await api('start',{file:descriptor,replaceFileId:options.replaceFileId});
    if(started.file.status==='ready'||started.file.status==='partial'){await session('delete',key);return started.file;}
    saved.partSize=started.partSize;await session('put',key,saved);
    if(started.file.status==='uploading'){
      var count=Math.max(1,Math.ceil(file.size/saved.partSize));
      for(var n=1;n<=count;n++){
        if(!saved.parts.some(p=>p.partNumber===n)){
          var response=await options.binary('/project-upload?project='+encodeURIComponent(options.projectId)+'&file='+id+'&part='+n,{method:'PUT',body:file.slice((n-1)*saved.partSize,n*saved.partSize),credentials:auth,signal:options.signal}),part=(await response.json()).part;
          saved.parts.push(part);saved.parts.sort((a,b)=>a.partNumber-b.partNumber);await session('put',key,saved);
        }progress('上传原文件',Math.min(file.size,n*saved.partSize),file.size);
      }await api('original_complete',{parts:saved.parts});
    }
    try{
      var indexed=0;progress('解析并建立索引',0,0);
      var result=await parseInWorker(file,async function(segments){await api('segments',{segments:segments});indexed+=segments.length;progress('解析并建立索引',indexed,0);},options.signal);
      if(!result.segments)throw Error('没有可读文字；扫描 PDF 或图片页需要先进行 OCR，原文件已保留');
      var completed=await api('commit',{segments:result.segments,coverage:result.coverage});await session('delete',key);progress('已可供 AI 查阅',result.segments,result.segments);return completed.file;
    }catch(error){var result=await options.api('library_parse_failed',Object.assign({projectId:options.projectId,fileId:id,error:error.message},auth)).catch(()=>null);if(result?.file?.status==='ready')return result.file;throw error;}
  }
  function status(file){return file.status==='uploading'?'原文件待续传':file.status==='indexing'?'正在建立索引':file.status==='unreadable'?'尚不可供 AI 查阅 · '+(file.parseError||'需重新解析'):file.status==='partial'?'部分页面无文字，需 OCR':'已建立检索索引';}
  return {parse:parse,parseInWorker:parseInWorker,upload:upload,status:status,split:split};
});
