(function(root,factory){var api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;else root.ArenaConversationFiles=api;})(typeof globalThis!=='undefined'?globalThis:this,function(root){
  'use strict';
  function create(app){
    var states=new Map(),activeKey='',dialog=null,modePending=false;
    var controls=document.getElementById('aaDocumentControls'),retrieve=document.getElementById('aaDocumentRetrieve'),full=document.getElementById('aaDocumentFull'),note=document.getElementById('aaDocumentModeNote'),manage=document.getElementById('aaConversationFilesBtn');
    function key(c){return c.owner+'|'+(c.projectId||'general')+'|'+c.chatId+'|'+c.incognito+'|'+c.epoch;}
    function state(){
      var c=app.context(),k=key(c);
      if(activeKey&&activeKey!==k){close();var prior=states.get(activeKey);if(prior&&prior.ctx.incognito){if(prior.controller)prior.controller.abort();states.delete(activeKey);}}
      activeKey=k;if(!states.has(k))states.set(k,{key:k,ctx:c,files:[],privateFiles:new Map(),mode:'retrieve',loaded:false,loading:null,error:null});
      return states.get(k);
    }
    function current(s){return key(app.context())===s.key;}
    async function api(s,action,extra){
      if(!current(s))throw Error('对话已切换，请在原对话继续');
      var body=Object.assign({},extra||{},app.credentials(),{action:action,chatId:s.ctx.chatId,projectId:s.ctx.projectId||null});
      var response=await app.fetch('/conversation-files',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),data=await response.json();
      if(!response.ok)throw Error(data.error||'文件请求失败');return data;
    }
    function known(){return app.hasSavedFiles()||app.texts().some(root.ArenaReading.fileId)||app.messages().some(m=>(m.pastedTexts||[]).some(root.ArenaReading.fileId));}
    async function refresh(force){
      var s=state();if(s.ctx.incognito){s.loaded=true;return s;}
      if(s.loading)return s.loading;if(!force&&s.loaded&&(s.files.length||!known()||s.checkedKnown))return s;
      if(!force&&!known()&&!s.files.length){s.loaded=true;return s;}
      s.loading=api(s,'list').then(function(data){s.files=data.files;s.mode=data.readingMode||'retrieve';s.loaded=true;s.checkedKnown=true;s.error=null;return s;}).catch(function(error){s.error=error;throw error;}).finally(function(){s.loading=null;if(current(s))render();});return s.loading;
    }
    function preferred(s){return app.projectMode()||s.mode;}
    function render(){
      if(!controls)return;var s=state(),count=s.files.length,visible=!app.imageOrDebate()&&(count||known()||app.hasProject()&&!app.projectHome());
      controls.hidden=!visible;if(!visible)return;
      var policy=root.ArenaReading.resolve(app.question(),preferred(s));
      retrieve.setAttribute('aria-pressed',String(policy.mode==='retrieve'));full.setAttribute('aria-pressed',String(policy.mode==='full'));
      retrieve.disabled=full.disabled=app.busy()||modePending;
      manage.hidden=!count&&!known();manage.textContent='本对话文件'+(count?' · '+count:'');
      note.textContent=s.error?'文件暂未加载，请点文件列表重试':policy.mode==='full'?(policy.explicit?'本轮指令：全文阅读，显示进度并增加用量':'分批阅读全部可读文字，会增加模型用量'):'仅发送相关片段，附文件名和位置';
    }
    async function choose(mode){
      if(app.busy()||modePending)return;var s=state();modePending=true;render();
      try{if(app.hasProject())await app.setProjectMode(mode);else if(s.ctx.incognito)s.mode=mode;else{await api(s,'settings',{mode:mode});if(current(s))s.mode=mode;}}
      catch(error){if(current(s))app.notice(error.message);}finally{modePending=false;if(current(s))render();}
    }
    retrieve.addEventListener('click',function(){choose('retrieve');});full.addEventListener('click',function(){choose('full');});
    manage.addEventListener('click',function(){openList().catch(e=>app.notice(e.message));});
    async function attach(file,progress,extra){
      var s=state(),meta;
      if(s.ctx.incognito){
        var segments=[],coverage;
        s.controller=new AbortController();
        var result=await root.ArenaProjectFiles.parseInWorker(file,async function(batch){
          if(!current(s))throw Error('对话已切换，文件读取已停止');
          segments.push(...batch);if(progress)progress({name:file.name,phase:'在本机解析无痕文件',done:segments.length,total:0});
        },s.controller.signal);coverage=result.coverage;
        if(!result.segments)throw Error('没有可读文字；扫描 PDF 需要 OCR');
        meta={id:crypto.randomUUID(),name:file.name,size:file.size,type:file.type,characters:segments.reduce((n,x)=>n+x.text.length,0),segments:segments.length,status:coverage.emptyUnits?'partial':'ready',coverage:coverage,indexedAt:Date.now(),storage:'memory'};
        s.privateFiles.set(meta.id,{file:file,meta:meta,segments:segments});s.files.push(meta);
      }else{
        meta=await root.ArenaProjectFiles.upload({file:file,projectId:s.ctx.chatId,resumeNamespace:'conversation:'+(s.ctx.projectId||'general')+':'+s.ctx.chatId,credentials:app.credentials(),progress:progress,isCurrent:function(){return current(s);},folder:extra&&extra.folder,relativePath:extra&&extra.relativePath,
          api:function(action,data){var rest=Object.assign({},data);delete rest.projectId;return api(s,action,rest);},
          binary:function(path,options){var u=new URL(path,'https://files.invalid');u.pathname='/conversation-upload';u.searchParams.set('chat',s.ctx.chatId);if(s.ctx.projectId)u.searchParams.set('project',s.ctx.projectId);else u.searchParams.delete('project');return app.binary(u.pathname+u.search,options);}
        });
        await refresh(true);
        if(current(s))await app.reloadChats();
      }
      if(!current(s))throw Error('对话已切换，已上传文件保留在原对话');render();return root.ArenaReading.marker(meta);
    }
    function file(text){var s=state(),id=root.ArenaReading.fileId(text);return s.files.find(f=>f.id===id)||null;}
    async function remove(text){var s=state(),id=root.ArenaReading.fileId(text);if(!id)return;
      if(s.ctx.incognito){s.privateFiles.delete(id);s.files=s.files.filter(f=>f.id!==id);}
      else{await api(s,'remove_file',{fileId:id});await refresh(true);}render();
    }
    function payload(question,texts){
      var s=state(),mode=root.ArenaReading.resolve(question,preferred(s)).mode,ids=(texts||[]).map(root.ArenaReading.fileId).filter(Boolean),out={enabled:!!(s.files.length||known()),currentFileIds:ids};
      if(s.error&&out.enabled)throw s.error;
      if(s.ctx.incognito&&out.enabled){
        var files=[];for(var item of s.privateFiles.values()){
          var segments=item.segments;
          if(mode==='full'&&segments.length>192)throw Error('这份文件需要分批保存全文阅读进度。请使用普通模式；当前无痕内容尚未发送。');
          if(mode==='retrieve'){
            var terms=root.ArenaContext.terms(question),scored=segments.map(function(segment){var words=new Set(root.ArenaContext.terms(segment.text));return {segment:segment,score:terms.filter(t=>words.has(t)).length};});
            segments=scored.filter(x=>x.score>0).sort((a,b)=>b.score-a.score).slice(0,3).map(x=>x.segment);
          }
          files.push({id:item.meta.id,name:item.meta.name,status:item.meta.status,indexedAt:item.meta.indexedAt,segments:segments.map(x=>({text:x.text,location:x.location||'正文'}))});
        }out.inline={files:files};
      }return {mode:mode,documents:out};
    }
    async function originals(){var s=state();if(!s.ctx.incognito)return;var all=[...s.privateFiles.values()];if(all.length>5||all.reduce((n,x)=>n+x.file.size,0)>root.ArenaFiles.LIMITS.roundBytes)throw Error('文档生成工具单次原件合计最多 20MB、5 个文件；文字分析可使用阅读模式。');for(var x of all)await app.capturePrivateOriginal(x.file);}
    function close(){if(dialog){dialog.close();dialog.remove();dialog=null;}}
    function panel(title){close();dialog=document.createElement('dialog');dialog.className='arena-document-panel';dialog.setAttribute('aria-label',title);
      var header=document.createElement('header'),heading=document.createElement('h2'),dismiss=document.createElement('button'),body=document.createElement('div');heading.textContent=title;dismiss.textContent='×';dismiss.setAttribute('aria-label','关闭文件面板');dismiss.onclick=close;header.append(heading,dismiss);body.className='arena-document-panel-body';dialog.append(header,body);dialog.addEventListener('click',function(e){if(e.target===dialog)close();});(document.getElementById('ai-arena-app')||document.body).append(dialog);dialog.showModal();return body;
    }
    async function preview(text){
      var s=await refresh(),id=root.ArenaReading.fileId(text),f=s.files.find(f=>f.id===id);if(!f)throw Error('文件已移除或尚未加载，请重新上传');
      var data=s.ctx.incognito?{file:{...f,text:s.privateFiles.get(id).segments.map(x=>(x.location?'['+x.location+']\n':'')+x.text).join('\n\n').slice(0,60000),previewTruncated:f.characters>60000}}:await api(s,'preview',{fileId:id});
      if(!current(s))return;
      var body=panel(f.name),status=document.createElement('p'),download=document.createElement('button'),content=document.createElement('pre');status.className='arena-document-help';status.textContent=root.ArenaProjectFiles.status(f)+(data.file.previewTruncated?' · 预览只显示前 6 万字符，全文阅读使用完整索引':'');download.textContent='下载原文件';content.textContent=data.file.text;body.append(status,download,content);
      download.onclick=async function(){try{var blob=s.ctx.incognito?s.privateFiles.get(id).file:await(await app.binary('/conversation-original',{method:'POST',body:{chatId:s.ctx.chatId,projectId:s.ctx.projectId,fileId:id}})).blob(),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=f.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}catch(e){app.notice(e.message);}};
    }
    async function openList(){
      var s=await refresh(true);if(!current(s))return;var body=panel('本对话文件'),hint=document.createElement('p');hint.className='arena-document-help';hint.textContent='仅供当前对话查阅。移除后，后续回答不会再检索此文件。';body.append(hint);
      for(var f of s.files)(function(f){var row=document.createElement('div'),button=document.createElement('button'),removeButton=document.createElement('button');row.className='arena-document-row';button.textContent=f.name+' · '+root.ArenaProjectFiles.status(f);button.onclick=()=>preview(root.ArenaReading.marker(f)).catch(e=>app.notice(e.message));removeButton.textContent='移除';removeButton.setAttribute('aria-label','移除文件：'+f.name);removeButton.onclick=async()=>{try{await remove(root.ArenaReading.marker(f));await openList();}catch(e){app.notice(e.message);}};row.append(button,removeButton);body.append(row);})(f);
      if(!s.files.length){var empty=document.createElement('p');empty.textContent='当前对话没有文件。';body.append(empty);}
    }
    return {attach:attach,file:file,remove:remove,preview:preview,payload:payload,render:render,ready:refresh,originals:originals,close:close,hasFiles:function(){return state().files.length>0;},sync:function(){render();refresh().catch(function(){});}};
  }
  return {create:create};
});
