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
  async function* parse(file,coverage,options){
    options=options||{};
    coverage=coverage||{};coverage.units=0;coverage.emptyUnits=0;
    var ext=file.name.split('.').pop().toLowerCase();
    var office=['pdf','docx','xlsx','xls','xlsm','xlsb','ods','pptx','odt','odp'];
    if(!office.includes(ext)){
      var sample=new Uint8Array(await file.slice(0,8192).arrayBuffer()),encoding=sample[0]===255&&sample[1]===254?'utf-16le':sample[0]===254&&sample[1]===255?'utf-16be':'utf-8';
      if(encoding==='utf-8')try{new TextDecoder('utf-8',{fatal:true}).decode(sample,{stream:true});}catch{encoding='gb18030';}
      var reader=file.stream().getReader(),decoder=new TextDecoder(encoding,{fatal:true}),buffer='',position=0;
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
      // pdf.js cannot inject a script element from inside our parsing worker.
      // Preload its handler so its local worker path needs no document/window.
      if(typeof importScripts==='function'&&!root.pdfjsWorker)importScripts(pdfjs.GlobalWorkerOptions.workerSrc);
      var pdf=await pdfjs.getDocument({data:new Uint8Array(buffer),isEvalSupported:false}).promise,candidates=[];
      try{coverage.units=pdf.numPages;for(var pageNumber=1;pageNumber<=pdf.numPages;pageNumber++){
        var page=await pdf.getPage(pageNumber),content=await page.getTextContent(),text=content.items.map(function(x){return x.str+(x.hasEOL?'\n':' ');}).join('');
        var needsOCR=!text.trim();
        // Scans can contain a selectable footer while the actual page is an image.
        if(options.ocr&&!needsOCR&&text.replace(/\s/g,'').length<80&&page.getOperatorList&&pdfjs.OPS){
          var ops=await page.getOperatorList(),imageOps=[pdfjs.OPS.paintImageXObject,pdfjs.OPS.paintInlineImageXObject,pdfjs.OPS.paintImageMaskXObject].filter(function(x){return x!==undefined;});
          needsOCR=ops.fnArray.some(function(code){return imageOps.includes(code);});
        }
        if(needsOCR){coverage.emptyUnits++;candidates.push({page:pageNumber,nativeText:text});}for(var segment of split(text,'第 '+pageNumber+' 页'))yield segment;page.cleanup();
      }}finally{await pdf.destroy();}
      if(!options.ocr||!candidates.length)return;
      coverage.nativeEmptyUnits=coverage.emptyUnits;coverage.ocrPages=0;coverage.blankUnits=0;coverage.uncertainUnits=0;
      var PDFLib=await load('PDFLib','https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js'),source=await PDFLib.PDFDocument.load(await file.arrayBuffer(),{updateMetadata:false});
      if(source.getPageCount()!==coverage.units)throw Error('PDF 页数校验失败，原文件已保留');
      for(var candidate of candidates){var number=candidate.page;
        try{
          if(options.progress)options.progress({phase:'Sol 识别扫描页',done:coverage.ocrPages,total:candidates.length,page:number});
          var single=await PDFLib.PDFDocument.create({updateMetadata:false}),copied=await single.copyPages(source,[number-1]);single.addPage(copied[0]);
          var bytes=await single.save({useObjectStreams:true}),input=bytes.length>8*1024*1024?await rasterPage(file,number):{data:base64(bytes),mime:'application/pdf'};
          var result=await options.ocr(Object.assign({page:number,total:coverage.units},input));
          if(!result||!['text','blank'].includes(result.kind)||typeof result.text!=='string'||result.kind==='text'&&!result.text.trim())throw Error('本页未能识别，请继续识别未完成页');
          if(result.kind==='blank'&&candidate.nativeText.trim())throw Error('本页包含文字，但识别结果为空白；请继续识别确认');
          for(var segment of split(result.text,'第 '+number+' 页 · Sol 视觉识别'))yield segment;
          coverage.emptyUnits--;coverage.ocrPages++;if(result.kind==='blank')coverage.blankUnits++;
          if(result.uncertain)coverage.uncertainUnits++;
          if(result.warning){coverage.warnings=coverage.warnings||[];if(coverage.warnings.length<20)coverage.warnings.push({page:number,text:String(result.warning).slice(0,500)});}
        }catch(error){if(error.name==='AbortError')throw error;coverage.ocrError=String(error.message||'识别中断').slice(0,250);break;}
      }
      return;
    }
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
      var settings={progress:options.progress,ocr:options.ocr?async function(task){await flush();if(signal?.aborted)throw Object.assign(Error('识别已暂停'),{name:'AbortError'});return options.ocr(task);}:null};
      for await(var segment of parse(file,coverage,settings)){batch.push(Object.assign({ordinal:ordinal++},segment));if(batch.length===24)await flush();}
      await flush();return {coverage:coverage,segments:ordinal};
    })();
    return new Promise(function(resolve,reject){
      var worker=new Worker('/arena-project-parser-worker.js?v=20261030-pdfocr1'),finished=false;
      function stop(error,result){if(finished)return;finished=true;worker.terminate();if(signal)signal.removeEventListener('abort',abort);error?reject(error):resolve(result);}
      function abort(){stop(Object.assign(Error('上传已暂停，重新选择原文件可继续'),{name:'AbortError'}));}
      if(signal){if(signal.aborted)return abort();signal.addEventListener('abort',abort,{once:true});}
      worker.onerror=function(){stop(Error('文件解析中断，原文件已保存，可重新选择文件重试'));};
      worker.onmessage=async function(event){var data=event.data;try{
        if(data.type==='batch'){await onBatch(data.segments);if(!finished)worker.postMessage({type:'ack'});}
        else if(data.type==='ocr'){try{var result=await options.ocr(data.task);if(!finished)worker.postMessage({type:'ocr_result',result:result});}catch(error){if(!finished)worker.postMessage({type:'ocr_result',error:error.message});}}
        else if(data.type==='progress'){if(options.progress)options.progress(data.progress);}
        else if(data.type==='done')stop(null,data.result);else if(data.type==='error')stop(Error(data.error));
      }catch(error){stop(error);}};
      worker.postMessage({type:'start',file:file,ocr:!!options.ocr});
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
        var expanded=await root.ArenaFiles.expandFiles([source],options);result.files.push(...expanded.files);result.skipped.push(...expanded.skipped);
      }else if(root.ArenaFiles.isDocument(source.name)){
        var path=source.webkitRelativePath||source.name;if(path.split('/').some(p=>p==='__MACOSX'||p==='.DS_Store'||p.startsWith('._')||p==='.git'||p==='node_modules')){result.skipped.push({name:path,reason:'已跳过隐藏或依赖文件'});continue;}
        result.files.push({file:source,path:path,archive:false});
      }else result.skipped.push({name:source.name,reason:'不支持的项目资料格式'});
    }return result;
  }
  async function indexFile(options,id,generation){
    var auth=Object.assign({},options.credentials),indexed=0;
    function api(action,extra){
      if(options.signal?.aborted||options.isCurrent&&!options.isCurrent())throw Object.assign(Error('识别已暂停，原文件与已完成页已保留'),{name:'AbortError'});
      return options.api('library_'+action,Object.assign({projectId:options.projectId,fileId:id,generation:generation},extra||{},auth));
    }
    function progress(phase,done,total){if(options.progress)options.progress({phase:phase,done:done,total:total,name:options.file.name});}
    try{
      progress('解析并建立索引',0,0);
      var result=await parseInWorker(options.file,async function(segments){
        await api('segments',{segments:segments});indexed+=segments.length;progress('解析并建立索引',indexed,0);
      },options.signal,{
        ocr:/\.pdf$/i.test(options.file.name)?function(task){return api('ocr_page',Object.assign({retry:!!options.retry},task));}:null,
        progress:function(p){progress(p.phase+' · 第 '+p.page+' 页',p.done,p.total);}
      });
      if(!result.segments)throw Error(result.coverage.ocrError||(result.coverage.blankUnits===result.coverage.units?'这份 PDF 全为空白页，没有可查阅内容，原文件已保留':'未识别到可读内容，原文件已保留，可继续识别'));
      var completed=await api('commit',{segments:result.segments,coverage:result.coverage});
      progress(completed.file.status==='partial'?'已保存可读内容，仍有页面待识别或确认':'已可供 AI 查阅',result.segments,result.segments);return completed.file;
    }catch(error){
      if(options.isCurrent&&!options.isCurrent())throw error;
      var saved=await options.api('library_parse_failed',Object.assign({projectId:options.projectId,fileId:id,generation:generation,error:error.message},auth)).catch(function(){return null;});
      if(!generation&&saved?.file?.status==='ready')return saved.file;throw error;
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
    return indexFile(Object.assign({},options,{file:file,retry:true}),meta.id,started.generation);
  }
  async function upload(options){
    var file=options.file,credentials=options.credentials,key=credentials.username.toLowerCase()+'|'+options.projectId+'|'+file.name+'|'+file.size+'|'+file.lastModified+'|'+await fingerprint(file),saved=await session('get',key)||{id:crypto.randomUUID(),parts:[]};
    var auth=Object.assign({},credentials),id=saved.id;
    function api(action,extra){if(options.signal?.aborted||options.isCurrent&& !options.isCurrent())throw Object.assign(Error('账号已切换，上传已暂停'),{name:'AbortError'});return options.api('library_'+action,Object.assign({projectId:options.projectId,fileId:id},extra||{},auth));}
    function progress(phase,done,total){if(options.progress)options.progress({phase:phase,done:done,total:total,name:file.name});}
    var descriptor={id:id,name:file.name,size:file.size,type:file.type};if(options.folder){descriptor.folder=options.folder;descriptor.relativePath=options.relativePath;}
    var started=await api('start',{file:descriptor,replaceFileId:options.replaceFileId});
    if(started.file.status==='ready'){await session('delete',key);return started.file;}
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
    var generation;
    if(['partial','unreadable'].includes(started.file.status)){generation=(await api('reparse')).generation;}
    var completed=await indexFile(options,id,generation);
    if(completed.status==='ready')await session('delete',key);return completed;
  }
  function status(file){return file.status==='uploading'?'原文件待续传':file.status==='indexing'?'正在解析或识别，可继续处理':file.status==='unreadable'?'尚不可供 AI 查阅 · '+(file.parseError||'可用 Sol 继续识别'):file.status==='partial'?'部分页面待识别或确认 · 可继续识别':'已建立检索索引'+(file.ocrPages?' · Sol 已识别 '+file.ocrPages+' 页':'');}
  function canRepair(file){return file.storage==='r2'&&/\.pdf$/i.test(file.name)&&['unreadable','partial','indexing'].includes(file.status);}
  return {parse:parse,parseInWorker:parseInWorker,upload:upload,repair:repair,canRepair:canRepair,status:status,split:split,expandFiles:expandFiles};
});
