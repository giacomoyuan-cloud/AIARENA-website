(function(root,factory){
  var api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;else root.ArenaProjectFiles=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(root){
  'use strict';
  var libraries={};
  function load(name,url){
    if(name==='ArenaDocumentParser'&&typeof document==='undefined'&&typeof importScripts==='undefined')return import('./web/arena-document-parser.mjs');
    if(root[name])return Promise.resolve(root[name]);if(libraries[name])return libraries[name];
    return libraries[name]=new Promise(function(resolve,reject){
      if(typeof importScripts==='function'){try{importScripts(url);resolve(root[name]);}catch(error){delete libraries[name];reject(error);}return;}
      var script=document.createElement('script');script.src=url;script.onload=function(){resolve(root[name]);};script.onerror=function(){delete libraries[name];reject(Error('文件解析工具加载失败，请重试'));};document.head.appendChild(script);
    });
  }
  function boundary(text,size){return size<text.length&&/[\uD800-\uDBFF]/.test(text[size-1])&&/[\uDC00-\uDFFF]/.test(text[size])?size-1:size;}
  function split(text,location){
    var result=[];for(var i=0;i<text.length;){var end=i+boundary(text.slice(i),Math.min(2400,text.length-i)),value=text.slice(i,end);i=end;if(value.trim())result.push({text:value,location:location||'正文'});}return result;
  }
  function base64(bytes){var value='';for(var i=0;i<bytes.length;i+=8192)value+=String.fromCharCode.apply(null,bytes.subarray(i,i+8192));return btoa(value);}
  async function rasterPage(file,number){
    var pdfjs=await load('pdfjsLib','https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js'),pdf,canvas;
    function create(w,h){var c=typeof OffscreenCanvas!=='undefined'?new OffscreenCanvas(w,h):document.createElement('canvas');c.width=w;c.height=h;return {canvas:c,context:c.getContext('2d')};}
    var factory={create:create,reset:function(v,w,h){v.canvas.width=w;v.canvas.height=h;},destroy:function(v){v.canvas.width=0;v.canvas.height=0;}};
    try{
      pdf=await pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer()),isEvalSupported:false,disableFontFace:true,canvasFactory:factory}).promise;
      var page=await pdf.getPage(number),unit=page.getViewport({scale:1}),viewport=page.getViewport({scale:Math.min(4,3000/Math.max(unit.width,unit.height))}),target=create(Math.ceil(viewport.width),Math.ceil(viewport.height));canvas=target.canvas;
      await page.render({canvasContext:target.context,viewport:viewport,canvasFactory:factory,background:'#ffffff'}).promise;
      var blob=canvas.convertToBlob?await canvas.convertToBlob({type:'image/jpeg',quality:0.9}):await new Promise(function(resolve,reject){canvas.toBlob(function(b){b?resolve(b):reject(Error('页面图片转换失败'));},'image/jpeg',0.9);});
      return {data:base64(new Uint8Array(await blob.arrayBuffer())),mime:'image/jpeg'};
    }finally{if(canvas){canvas.width=0;canvas.height=0;}if(pdf)await pdf.destroy();}
  }
  async function normalizeVisual(task){
    var sample=task.mime==='application/pdf'?'':atob(task.data.slice(0,512)),animated=task.mime==='image/gif'||task.mime==='image/webp'&&sample.includes('ANIM')||task.mime==='image/png'&&sample.includes('acTL');
    if(task.mime==='application/pdf'||!animated&&['image/png','image/jpeg','image/webp'].includes(task.mime)&&task.data.length<=10*1024*1024)return task;
    var data=Uint8Array.from(atob(task.data),function(c){return c.charCodeAt(0);}),blob=new Blob([data],{type:task.mime}),image,url,canvas;
    if(task.mime==='image/svg+xml'){
      var source=new TextDecoder().decode(data);if(/<!DOCTYPE|<!ENTITY|<script|<foreignObject|\bon\w+\s*=|(?:href|url)\s*[=(]\s*["']?\s*(?:https?:|\/\/|file:)/i.test(source))throw Error('SVG 含外部资源或活动内容，请导出为 PNG 后上传');
    }
    try{
      if(typeof createImageBitmap==='function')try{image=await createImageBitmap(blob);}catch(e){}
      if(!image){url=URL.createObjectURL(blob);image=await new Promise(function(resolve,reject){var el=new Image();el.onload=function(){resolve(el);};el.onerror=function(){reject(Error('图片无法解码，请转换为 PNG/JPEG'));};el.src=url;});}
      var width=image.width,height=image.height,scale=Math.min(1,4000/Math.max(width,height));canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(width*scale));canvas.height=Math.max(1,Math.round(height*scale));canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
      var output=await new Promise(function(resolve){canvas.toBlob(resolve,'image/webp',.94);});if(!output)throw Error('图片转换失败');
      return Object.assign({},task,{mime:output.type,notice:animated?'动态图按静态帧读取，未包含全部动画帧':'',data:base64(new Uint8Array(await output.arrayBuffer()))});
    }finally{if(url)URL.revokeObjectURL(url);if(image?.close)image.close();if(canvas){canvas.width=0;canvas.height=0;}}
  }
  async function* parse(file,coverage,options){
    options=options||{};
    coverage=coverage||{};coverage.units=0;coverage.emptyUnits=0;
    var ext=file.name.split('.').pop().toLowerCase();
    if(['docx','xlsx','xls','xlsm','xlsb','ods','pptx','odt','odp','rtf','epub','png','jpg','jpeg','webp','gif','svg'].includes(ext)){
      var parser=await load('ArenaDocumentParser','/arena-document-parser.js?v=20261031-directfiles1');
      for await(var segment of parser.parse(file,coverage,options))yield segment;return;
    }
    var office=['pdf','docx','xlsx','xls','xlsm','xlsb','ods','pptx','odt','odp'];
    if(!office.includes(ext)){
      var sample=new Uint8Array(await file.slice(0,8192).arrayBuffer()),encoding=sample[0]===255&&sample[1]===254?'utf-16le':sample[0]===254&&sample[1]===255?'utf-16be':'utf-8';
      if(encoding==='utf-8')try{new TextDecoder('utf-8',{fatal:true}).decode(sample,{stream:true});}catch{encoding='gb18030';}
      var reader=file.stream().getReader(),decoder=new TextDecoder(encoding,{fatal:true}),buffer='',position=0;
      try{for(;;){var part=await reader.read(),decoded=decoder.decode(part.value||new Uint8Array(),{stream:!part.done});if(/[\u0000-\u0008\u000e-\u001f\u007f]/.test(decoded))throw Error('文件含二进制内容，无法作为文本读取');buffer+=decoded;
        while(buffer.length>=2400){var end=boundary(buffer,2400),text=buffer.slice(0,end);buffer=buffer.slice(end);if(text.trim())yield {text:text,location:'正文 · 字符 '+(position+1)+'–'+(position+text.length)};position+=text.length;}
        if(part.done)break;
      }if(buffer.trim())yield {text:buffer,location:'正文 · 字符 '+(position+1)+'–'+(position+buffer.length)};
      }finally{reader.releaseLock();}coverage.units=1;if(!position&&!buffer.trim())coverage.emptyUnits=1;return;
    }
    if(ext==='pdf'){
      var pdfjs=await load('pdfjsLib','https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js');
      pdfjs.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      if(typeof importScripts==='function'&&!root.pdfjsWorker)importScripts(pdfjs.GlobalWorkerOptions.workerSrc);
      var settings={isEvalSupported:false,disableFontFace:true},pdf,canvas;
      function create(w,h){var c=typeof OffscreenCanvas!=='undefined'?new OffscreenCanvas(w,h):document.createElement('canvas');c.width=w;c.height=h;return {canvas:c,context:c.getContext('2d')};}
      var factory={create:create,reset:function(v,w,h){v.canvas.width=w;v.canvas.height=h;},destroy:function(v){v.canvas.width=0;v.canvas.height=0;}};settings.canvasFactory=factory;
      if(file.size>16*1024*1024&&pdfjs.PDFDataRangeTransport){
        var initial=new Uint8Array(await file.slice(0,65536).arrayBuffer()),transport=new pdfjs.PDFDataRangeTransport(file.size,initial);
        transport.requestDataRange=function(begin,end){file.slice(begin,end).arrayBuffer().then(function(bytes){transport.onDataRange(begin,new Uint8Array(bytes));});};
        settings.range=transport;settings.length=file.size;settings.rangeChunkSize=65536;settings.disableAutoFetch=true;settings.disableStream=true;
      }else settings.data=new Uint8Array(await file.arrayBuffer());
      pdf=await pdfjs.getDocument(settings).promise;coverage.units=pdf.numPages;coverage.preparedVisuals=0;coverage.uncertainUnits=0;coverage.visualComplete=!!options.fullVision;
      try{for(var number=1;number<=pdf.numPages;number++){
        var page=await pdf.getPage(number),content=await page.getTextContent(),text=content.items.map(function(x){return x.str+(x.hasEOL?'\n':' ');}).join('');
        for(var segment of split(text,'第 '+number+' 页'))yield segment;
        if(options.ocr&&(options.fullVision||!text.trim())){
          if(options.progress)options.progress({phase:'准备页面原图（不调用模型）',done:number-1,total:pdf.numPages,page:number});
          var unit=page.getViewport({scale:1}),viewport=page.getViewport({scale:Math.min(4,3000/Math.max(unit.width,unit.height))}),target=create(Math.ceil(viewport.width),Math.ceil(viewport.height));canvas=target.canvas;
          await page.render({canvasContext:target.context,viewport:viewport,canvasFactory:factory,background:'#ffffff'}).promise;
          var blob=canvas.convertToBlob?await canvas.convertToBlob({type:'image/jpeg',quality:.9}):await new Promise(function(resolve,reject){canvas.toBlob(function(v){v?resolve(v):reject(Error('页面准备失败'));},'image/jpeg',.9);});
          var result=await options.ocr({page:number,total:pdf.numPages,location:'第 '+number+' 页',mime:'image/jpeg',data:base64(new Uint8Array(await blob.arrayBuffer()))});
          if(result.media){yield {text:'',location:'第 '+number+' 页',media:result.media};coverage.preparedVisuals++;}
          else for(var part of split(result.text||'','第 '+number+' 页 · 视觉文字'))yield part;
          canvas.width=0;canvas.height=0;canvas=null;
        }else if(!text.trim())coverage.emptyUnits++;
        page.cleanup();if(options.progress)options.progress({phase:'页面准备完成',done:number,total:pdf.numPages,page:number});
      }}finally{if(canvas){canvas.width=0;canvas.height=0;}await pdf.destroy();}
      return;
    }
    var buffer=await file.arrayBuffer();
    if(ext==='docx'){
      var mammoth=await load('mammoth','https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js'),text=(await mammoth.extractRawText({arrayBuffer:buffer})).value;
      coverage.units=1;coverage.emptyUnits=text.trim()?0:1;for(var segment of split(text,'Word 正文'))yield segment;return;
    }
    if(['xlsx','xls','xlsm','xlsb','ods'].includes(ext)){
      var xlsx=await load('XLSX','https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js'),book=xlsx.read(buffer,{type:'array',cellDates:false});coverage.units=book.SheetNames.length;
      for(var name of book.SheetNames){
        var sheet=book.Sheets[name],addresses=Object.keys(sheet).filter(function(address){return /^[A-Z]+[1-9][0-9]*$/.test(address);}).map(function(address){return {address:address,position:xlsx.utils.decode_cell(address)};}).sort(function(a,b){return a.position.r-b.position.r||a.position.c-b.position.c;}),pending='',firstRow=addresses.length?addresses[0].position.r+1:0,lastRow=firstRow;
        for(var entry of addresses){
          var cell=sheet[entry.address],value=String(cell.w!==undefined?cell.w:cell.v!==undefined?cell.v:cell.f?'='+cell.f+'（无缓存结果）':''),line=entry.address+'='+JSON.stringify(value)+'\n';
          if(pending.length&&pending.length+line.length>2200){for(var segment of split(pending,'工作表「'+name+'」第 '+firstRow+'–'+lastRow+' 行'))yield segment;pending='';firstRow=entry.position.r+1;}
          pending+=line;lastRow=entry.position.r+1;
        }for(var segment of split(pending,'工作表「'+name+'」第 '+firstRow+'–'+lastRow+' 行'))yield segment;
      }return;
    }
    if(['pptx','odt','odp'].includes(ext)){
      var JSZip=await load('JSZip','https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'),zip=await JSZip.loadAsync(buffer);
      if(ext!=='pptx'){
        if(!zip.file('content.xml'))throw Error('不是有效的 OpenDocument 文件');
        var xml=await zip.file('content.xml').async('string'),text=xml.replace(/<\/(?:text:p|text:h|table:table-row)>/g,'\n').replace(/<text:tab\s*\/>/g,'\t').replace(/<[^>]+>/g,'').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&');
        coverage.units=1;coverage.emptyUnits=text.trim()?0:1;for(var segment of split(text,'OpenDocument 正文'))yield segment;return;
      }
      var slides=Object.keys(zip.files).filter(function(n){return /^ppt\/slides\/slide\d+\.xml$/.test(n);}).sort(function(a,b){return Number(a.match(/slide(\d+)/)[1])-Number(b.match(/slide(\d+)/)[1]);});coverage.units=slides.length;
      for(var i=0;i<slides.length;i++){
        var xml=await zip.file(slides[i]).async('string'),parts=[];
        for(var match of xml.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g))parts.push(match[1].replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&'));
        var text=parts.join('\n');if(!text.trim())coverage.emptyUnits++;for(var segment of split(text,'幻灯片 '+(i+1)))yield segment;
      }return;
    }
    throw Error('支持 PDF、Word（DOCX）、Excel、PPT 和常见文本；旧 DOC 请转换为 DOCX');
  }
  function parseInWorker(file,onBatch,signal,options){
    options=options||{};
    if(typeof Worker==='undefined')return (async function(){
      var coverage={},batch=[],ordinal=0;
      async function flush(){if(batch.length){await onBatch(batch);batch=[];}}
      var settings={progress:options.progress,fullVision:options.fullVision,ocr:options.ocr?async function(task){await flush();if(signal?.aborted)throw Object.assign(Error('识别已暂停'),{name:'AbortError'});return options.ocr(task);}:null};
      for await(var segment of parse(file,coverage,settings)){batch.push(Object.assign({ordinal:ordinal++},segment));if(batch.length===24)await flush();}
      await flush();return {coverage:coverage,segments:ordinal};
    })();
    return new Promise(function(resolve,reject){
      var worker=new Worker('/arena-project-parser-worker.js?v=20261031-directfiles1'),finished=false;
      function stop(error,result){if(finished)return;finished=true;worker.terminate();if(signal)signal.removeEventListener('abort',abort);error?reject(error):resolve(result);}
      function abort(){stop(Object.assign(Error('上传已暂停，重新选择原文件可继续'),{name:'AbortError'}));}
      if(signal){if(signal.aborted)return abort();signal.addEventListener('abort',abort,{once:true});}
      worker.onerror=function(){stop(Error('文件解析中断，原文件已保存，可重新选择文件重试'));};
      worker.onmessage=async function(event){var data=event.data;try{
        if(data.type==='batch'){await onBatch(data.segments);if(!finished)worker.postMessage({type:'ack'});}
        else if(data.type==='ocr'){try{var result=await options.ocr(data.task);if(!finished)worker.postMessage({type:'ocr_result',result:result});}catch(error){if(!finished)worker.postMessage({type:'ocr_result',error:error.message,aborted:error.name==='AbortError'});}}
        else if(data.type==='progress'){if(options.progress)options.progress(data.progress);}
        else if(data.type==='done')stop(null,data.result);else if(data.type==='error')stop(Object.assign(Error(data.error),{name:data.aborted?'AbortError':'Error'}));
      }catch(error){stop(error);}};
      worker.postMessage({type:'start',file:file,ocr:!!options.ocr,fullVision:!!options.fullVision});
    });
  }
  function sessionStore(){
    if(typeof indexedDB==='undefined')return Promise.resolve(null);
    return new Promise(function(resolve){var request=indexedDB.open('arena-project-upload-sessions',1);request.onupgradeneeded=function(){request.result.createObjectStore('sessions');};request.onsuccess=function(){resolve(request.result);};request.onerror=function(){resolve(null);};});
  }
  async function session(action,key,value){var db=await sessionStore();if(!db)return null;return new Promise(function(resolve){var tx=db.transaction('sessions',action==='get'?'readonly':'readwrite'),store=tx.objectStore('sessions'),r=action==='get'?store.get(key):action==='delete'?store.delete(key):store.put(value,key);r.onsuccess=function(){resolve(r.result);};r.onerror=function(){resolve(null);};tx.oncomplete=function(){db.close();};});}
  async function fingerprint(file){var first=new Uint8Array(await file.slice(0,32768).arrayBuffer()),last=new Uint8Array(await file.slice(Math.max(0,file.size-32768)).arrayBuffer()),bytes=new Uint8Array(first.length+last.length);bytes.set(first);bytes.set(last,first.length);return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');}
  async function expandFiles(sources,options){
    var result={files:[],skipped:[]};for(var source of sources){
      if(/\.zip$/i.test(source.name)){
        var expanded=await root.ArenaFiles.expandFiles([source],Object.assign({},options,{images:true}));result.files.push(...expanded.files);result.skipped.push(...expanded.skipped);
      }else if((root.ArenaFiles.isDocument(source.name)||root.ArenaFiles.isImage(source.name))){
        var path=source.webkitRelativePath||source.name;if(path.split('/').some(p=>p==='__MACOSX'||p==='.DS_Store'||p.startsWith('._')||p==='.git'||p==='node_modules')){result.skipped.push({name:path,reason:'已跳过隐藏或依赖文件'});continue;}
        result.files.push({file:source,path:path,archive:false});
      }else result.skipped.push({name:source.name,reason:'不支持的项目资料格式'});
    }return result;
  }
  async function indexFile(options,id,generation){
    var auth=Object.assign({},options.credentials),indexed=0;
    function api(action,extra){
      if(options.shouldPause?.()||options.signal?.aborted||options.isCurrent&&!options.isCurrent())throw Object.assign(Error('识别已暂停，原文件与已完成页已保留'),{name:'AbortError'});
      return options.api('library_'+action,Object.assign({projectId:options.projectId,fileId:id,generation:generation},extra||{},auth));
    }
    function progress(phase,done,total){if(options.progress)options.progress({phase:phase,done:done,total:total,name:options.file.name});}
    try{
      progress('解析并建立索引',0,0);
      var result=await parseInWorker(options.file,async function(segments){
        await api('segments',{segments:segments});indexed+=segments.length;progress('解析并建立索引',indexed,0);
      },options.signal,{
        fullVision:true,
        ocr:async function(task){task=await normalizeVisual(task);var value=await api('media',Object.assign({retry:!!options.retry,retryUncertain:!!options.retryUncertain},task));if(options.shouldPause?.())throw Object.assign(Error('识别已暂停，已完成内容已保存'),{name:'AbortError'});if(task.notice)value=Object.assign({},value,{uncertain:true,warning:[value.warning,task.notice].filter(Boolean).join('；')});return value;},
        progress:function(p){progress(p.phase+(p.page?' · 第 '+p.page+' 页':''),p.done,p.total);}
      });
      if(!result.segments)throw Error(result.coverage.ocrError||(result.coverage.blankUnits===result.coverage.units?'这份文件没有可查阅内容，原文件已保留':'未识别到可读内容，原文件已保留，可继续识别'));
      result.coverage.sourceVersion='20261031-directfiles1';
      var completed=await api('commit',{segments:result.segments,coverage:result.coverage});
      progress(completed.file.status==='partial'?'已保存可读内容，仍有页面待识别或确认':'已可供 AI 查阅',result.segments,result.segments);return completed.file;
    }catch(error){
      if(options.isCurrent&&!options.isCurrent())throw error;
      var saved=await options.api('library_parse_failed',Object.assign({projectId:options.projectId,fileId:id,generation:generation,error:error.message},auth)).catch(function(){return null;});
      if(!generation&&['ready','partial'].includes(saved?.file?.status))return saved.file;throw error;
    }
  }
  async function repair(options){
    var meta=options.file,auth=Object.assign({},options.credentials);
    if(options.isCurrent&&!options.isCurrent())throw Object.assign(Error('账号已切换'),{name:'AbortError'});
    var response=await options.binary('/project-original',{method:'POST',body:{projectId:options.projectId,fileId:meta.id},credentials:auth,signal:options.signal}),blob=await response.blob();
    if(blob.size!==meta.size)throw Error('原文件下载不完整，请重试；服务器原件未修改');
    var file=new File([blob],meta.name,{type:meta.type||'application/pdf',lastModified:meta.createdAt||0});
    if(options.isCurrent&&!options.isCurrent())throw Object.assign(Error('账号已切换'),{name:'AbortError'});
    var started=await options.api('library_reparse',Object.assign({projectId:options.projectId,fileId:meta.id},auth));
    return indexFile(Object.assign({},options,{file:file,retry:true,retryUncertain:!!options.retryUncertain}),meta.id,started.generation);
  }
  async function upload(options){
    var file=options.file,credentials=options.credentials,stamp=await fingerprint(file),key=JSON.stringify([credentials.username.toLowerCase(),(options.resumeNamespace||options.projectId),options.folder||'',options.relativePath||'',options.replaceFileId||'',file.name,file.size,file.lastModified,stamp]),legacyKey=credentials.username.toLowerCase()+'|'+options.projectId+'|'+file.name+'|'+file.size+'|'+file.lastModified+'|'+stamp,saved=await session('get',key),legacy=false;
    if(!saved&&!options.resumeNamespace){saved=await session('get',legacyKey);legacy=!!saved;}if(!saved)saved={id:crypto.randomUUID(),parts:[]};
    var auth=Object.assign({},credentials),id=saved.id;
    function api(action,extra){if(options.signal?.aborted||options.isCurrent&& !options.isCurrent())throw Object.assign(Error('账号已切换，上传已暂停'),{name:'AbortError'});return options.api('library_'+action,Object.assign({projectId:options.projectId,fileId:id},extra||{},auth));}
    function progress(phase,done,total){if(options.progress)options.progress({phase:phase,done:done,total:total,name:file.name});}
    var descriptor={id:id,name:file.name,size:file.size,type:file.type};if(options.folder){descriptor.folder=options.folder;descriptor.relativePath=options.relativePath;}
    if(!legacy)await session('put',key,saved);
    var started;
    try{started=await api('start',{file:descriptor,replaceFileId:options.replaceFileId});}
    catch(error){if(!legacy||error.status!==409)throw error;legacy=false;saved={id:crypto.randomUUID(),parts:[]};id=saved.id;descriptor.id=id;await session('put',key,saved);started=await api('start',{file:descriptor,replaceFileId:options.replaceFileId});}
    // Only migrate an older browser's state after the server confirms its path.
    // A colliding path keeps the old state available to its original document.
    if(legacy){await session('put',key,saved);await session('delete',legacyKey);}
    if(started.file.status==='ready'||started.file.status==='partial'&&!/\.pdf$/i.test(file.name)){await session('delete',key);return started.file;}
    saved.partSize=started.partSize;await session('put',key,saved);
    if(started.file.status==='uploading'){
      var count=Math.max(1,Math.ceil(file.size/saved.partSize));
      for(var n=1;n<=count;n++){
        if(!saved.parts.some(p=>p.partNumber===n)){
          var offset=(n-1)*saved.partSize,chunk=file.slice(offset,n*saved.partSize);var response=await options.binary('/project-upload?project='+encodeURIComponent(options.projectId)+'&file='+id+'&part='+n,{method:'PUT',body:chunk,credentials:auth,signal:options.signal,onUploadProgress:function(loaded){progress('上传原文件',Math.min(file.size,offset+Math.min(chunk.size,loaded)),file.size);}}),part=(await response.json()).part;
          saved.parts.push(part);saved.parts.sort((a,b)=>a.partNumber-b.partNumber);await session('put',key,saved);
        }progress('上传原文件',Math.min(file.size,n*saved.partSize),file.size);
      }await api('original_complete',{parts:saved.parts});
    }
    progress('上传原文件',file.size,file.size);
    if(options.uploadOnly)return Object.assign({},started.file,{id:id,status:'indexing',clientResumeKey:key});
    var generation;
    if(/\.pdf$/i.test(file.name)&&['partial','unreadable'].includes(started.file.status)){generation=(await api('reparse')).generation;}
    var completed=await indexFile(options,id,generation);
    if(completed.status==='ready')await session('delete',key);return completed;
  }
  async function process(options){var started=await options.api('library_reparse',Object.assign({projectId:options.projectId,fileId:options.meta.id},options.credentials));var result=await indexFile(options,options.meta.id,started.generation);if(options.meta.clientResumeKey&&['ready','partial'].includes(result.status)&&!result.coverage?.emptyUnits)await session('delete',options.meta.clientResumeKey);return result;}
  function warningsOnly(file){return file.status==='partial'&&file.coverage?.emptyUnits===0&&file.coverage?.uncertainUnits>0;}
  function repairLabel(file){return warningsOnly(file)?(/\.pdf$/i.test(file.name)?'重试不清晰页':'重试不清晰内容'):file.status==='ready'?'补全图文':'继续识别';}
  function status(file){
    if(file.status==='uploading')return '原文件待续传';
    if(file.status==='indexing')return '正在解析或识别，可继续处理';
    if(file.coverage?.sourceVersion==='20261031-directfiles1')return file.coverage?.emptyUnits?'部分图文尚未准备完成':'图文已准备，发送后由当前模型读取';
    if(file.status==='unreadable')return '尚不可供 AI 查阅 · '+(file.parseError||'可继续准备图文');
    var recognized=file.ocrPages?'已有文字索引 '+file.ocrPages+' '+(file.coverage?.unitLabel||'页'):'';
    if(warningsOnly(file))return (recognized||'已处理全部页面')+' · '+file.coverage.uncertainUnits+' '+(file.coverage?.unitLabel||'页')+'有不清晰内容，可查阅';
    if(file.status==='partial')return (recognized?recognized+' · ':'')+(file.coverage?.emptyUnits?'还有 '+file.coverage.emptyUnits+' 页待识别':'部分页面待识别')+(file.coverage?.ocrError?' · '+file.coverage.ocrError:'');
    return '已建立检索索引'+(recognized?' · '+recognized:'');
  }
  function canRepair(file){return file.storage==='r2'&&(['unreadable','partial','indexing'].includes(file.status)||/\.(?:pdf|docx|pptx|xlsx|xlsm|xlsb|odt|ods|odp|epub|rtf|png|jpe?g|webp|gif|svg)$/i.test(file.name)&&file.status==='ready'&&file.coverage?.visualComplete!==true);}
  function name(file){return (file.folder?file.folder+'/':'')+(file.relativePath||file.name);}
  return {process:process,normalizeVisual:normalizeVisual,parse:parse,parseInWorker:parseInWorker,upload:upload,repair:repair,canRepair:canRepair,repairLabel:repairLabel,status:status,name:name,split:split,expandFiles:expandFiles};
});
