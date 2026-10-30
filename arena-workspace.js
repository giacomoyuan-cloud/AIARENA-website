/* Native dialogs keep project management keyboard-accessible without a framework. */
(function(root){
  'use strict';
  var e=function(value){return root.ArenaMarkdown.escape(String(value||''));};
  function readFile(file){return root.ArenaFiles.readFile(file);}
  function mount(app){
    var host=app.host,dialog=document.createElement('dialog'),project=null,archived=false,removed=false;
    dialog.className='arena-workspace-dialog';dialog.setAttribute('aria-label','项目');
    dialog.innerHTML='<div class="arena-dialog-heading"><h2 id="aaWorkspaceTitle">项目</h2><button type="button" class="arena-icon-btn" data-w-close aria-label="关闭项目窗口">×</button></div><div id="aaWorkspaceContent"></div>';
    host.appendChild(dialog);
    var pane=document.createElement('aside');pane.id='aaProjectFilePane';pane.className='arena-project-file-pane';pane.hidden=true;pane.setAttribute('role','dialog');pane.setAttribute('aria-label','项目资料预览');
    pane.innerHTML='<div class="arena-dialog-heading"><strong id="aaFileName"></strong><button class="arena-icon-btn" data-file-close aria-label="关闭资料预览">×</button></div><div class="arena-file-toolbar"><span id="aaFileMeta"></span><button data-file-download>下载原文件</button></div><div id="aaFilePreview" class="arena-file-preview"></div>';
    host.appendChild(pane);
    var input=document.createElement('input');input.type='file';input.multiple=true;input.hidden=true;input.accept=root.ArenaFiles.DOCUMENT_ACCEPT;host.appendChild(input);
    var content=dialog.querySelector('#aaWorkspaceContent'),title=dialog.querySelector('#aaWorkspaceTitle'),navigationEpoch=0;
    var listCache=new Map(),listVersions=new Map(),listRequests=new Map(),pinErrors=new Map(),cacheRevision=0,listView=false;
    var pins=root.ArenaControls.createPinStore({
      write:function(context,pinned){return app.api('pin',Object.assign({projectId:context.id,pinned:pinned},context.auth));},
      onChange:function(key,value,pending,context){
        if(context&&context.account===accountKey()&&dialog.open&&listView&&!archived){var items=listCache.get(cacheKey(context.account,false));if(items)paintList(items,false,context.account);}
      },
      onError:function(error,context){if(context.account===accountKey()){var message=error.message||'置顶保存失败，请重试';pinErrors.set(context.account,message);if(dialog.open&&listView)errorInList(message);else notify(message);}}
    });
    function notify(message){app.notice(message);}
    function errorInList(message){var status=content.querySelector('[data-w-error]');if(status)status.textContent=message;}
    function show(){if(!dialog.open)dialog.showModal();}
    function close(){navigationEpoch++;dialog.close();}
    dialog.addEventListener('close',function(){navigationEpoch++;});
    function error(message){var element=content.querySelector('[data-w-error]');if(element)element.textContent=message;else notify(message);}
    function setContent(label,html){listView=false;title.textContent=label;content.innerHTML=html;}
    function accountKey(){return app.accountKey?app.accountKey():'';}
    function cacheKey(account,viewArchived){return account+'|'+(viewArchived?'archived':'active');}
    function invalidate(){cacheRevision++;listCache.clear();listVersions.clear();listRequests.clear();}
    function fetchList(account,viewArchived){
      var key=cacheKey(account,viewArchived),existing=listRequests.get(key);if(existing)return existing;
      var revision=cacheRevision,pinReadVersion=pins.version();
      var promise=app.api('list',{includeArchived:viewArchived}).then(function(data){
        if(!data||!Array.isArray(data.projects))throw new Error('项目列表格式有误，请重试');
        if(revision===cacheRevision&&account===accountKey()){listCache.set(key,data.projects);listVersions.set(key,pinReadVersion);}
        return data.projects;
      }).finally(function(){if(listRequests.get(key)===promise)listRequests.delete(key);});
      listRequests.set(key,promise);return promise;
    }
    function preload(){var account=accountKey();if(account)fetchList(account,false).catch(function(){});}
    function paintList(items,viewArchived,account){
      var focusedPin=content.contains(document.activeElement)&&document.activeElement.dataset.projectPin;
      var sorted=items.map(function(p){
        var copy=Object.assign({},p),key=account+'|'+p.id;
        copy.pinned=pins.read(key,copy.pinned,listVersions.get(cacheKey(account,viewArchived)));
        return copy;
      }).sort(function(a,b){return Number(!!b.pinned)-Number(!!a.pinned);});
      var cards=sorted.map(function(p){
        var key=account+'|'+p.id;
        var pin='<button type="button" class="arena-project-pin'+(p.pinned?' pinned':'')+'" data-project-pin="'+e(p.id)+'" data-pinned="'+!!p.pinned+'" aria-pressed="'+!!p.pinned+'" aria-busy="'+pins.pending(key)+'" aria-label="'+(p.pinned?'取消置顶项目：':'置顶项目：')+e(p.name)+'" title="'+(p.pinned?'取消置顶':'置顶项目')+'">'+root.ArenaControls.pinIcon+'</button>';
        return '<article class="arena-project-card"><button class="arena-project-open" data-project-open="'+e(p.id)+'"><strong>'+e(p.name)+'</strong><span>'+new Date(p.updatedAt).toLocaleDateString()+'</span></button>'+(viewArchived?'<button data-project-restore="'+e(p.id)+'">恢复项目</button>':pin+'<button class="arena-project-card-more" data-project-settings="'+e(p.id)+'" aria-label="项目设置：'+e(p.name)+'">•••</button>')+'</article>';
      }).join('');
      setContent(viewArchived?'已归档项目':'项目','<div class="arena-workspace-intro"><p>每个项目拥有独立的对话、记忆和资料，与普通聊天隔离。</p><button class="arena-workspace-primary" data-project-new>新建项目</button></div><div class="arena-project-grid">'+(cards||'<div class="arena-workspace-empty">还没有'+(viewArchived?'已归档':'')+'项目</div>')+'</div><div class="arena-workspace-footer"><button data-project-archive-toggle>'+(viewArchived?'返回项目':'查看已归档项目')+'</button><button data-project-general>返回普通聊天</button></div>');
      var status=document.createElement('p');status.setAttribute('data-w-error','');status.setAttribute('role','alert');status.textContent=viewArchived?'':(pinErrors.get(account)||'');content.querySelector('.arena-project-grid').after(status);
      listView=true;
      if(focusedPin){var focused=Array.from(content.querySelectorAll('[data-project-pin]')).find(function(b){return b.dataset.projectPin===focusedPin;});if(focused)focused.focus({preventScroll:true});}
    }
    async function list(){
      if(app.busy()){notify('回答完成后可以切换项目');return;}
      var epoch=++navigationEpoch,account=accountKey(),viewArchived=archived,key=cacheKey(account,viewArchived),cached=listCache.get(key);
      project=null;
      if(cached)paintList(cached,viewArchived,account);else setContent('项目','<p class="arena-workspace-muted" role="status">正在加载项目…</p>');
      show();
      try{
        var items=await fetchList(account,viewArchived);
        if(epoch===navigationEpoch&&dialog.open&&account===accountKey()&&viewArchived===archived)paintList(items,viewArchived,account);
      }catch(err){
        if(epoch!==navigationEpoch||!dialog.open)return;
        if(cached)notify('项目更新失败，已显示上次加载的列表');
        else setContent('项目','<p role="alert">'+e(err.message)+'</p><button type="button" data-project-back>重新加载</button>');
      }
    }
    async function edit(id){
      if(app.busy()){notify('回答完成后可以修改项目设置');return;}
      var epoch=++navigationEpoch,wasOpen=dialog.open;
      try{
        var selectedProject=id?(await app.api('get',{projectId:id})).project:null;
        if(epoch!==navigationEpoch||(wasOpen&&!dialog.open))return;
        project=selectedProject;
        setContent(project?'项目设置':'新建项目','<form id="aaProjectForm"><label>项目名称<input name="name" maxlength="80" required value="'+e(project&&project.name)+'" placeholder="例如：产品设计"></label><label>项目说明<textarea name="instructions" rows="4" maxlength="4000" placeholder="这个项目的目标、背景和回复要求">'+e(project&&project.instructions)+'</textarea></label>'+(project?'<label>项目记忆<textarea name="memory" rows="4" maxlength="2400" placeholder="仅在本项目对话之间共享">'+e(project.memory)+'</textarea></label>':'')+'<p class="arena-workspace-muted">普通聊天及其他项目不会读取这里的记忆。</p><p data-w-error role="alert"></p><div class="arena-workspace-footer">'+(project?'<button type="button" data-project-archive="'+e(project.id)+'">归档项目</button>':'<button type="button" data-project-back>返回</button>')+'<button type="submit" class="arena-workspace-primary">保存'+(project?'':'并进入')+'</button></div></form>');show();content.querySelector('input').focus();
      }catch(err){if(epoch===navigationEpoch)error(err.message);}
    }
    async function enter(id){
      if(app.busy()){notify('回答完成后可以切换项目');return;}
      var epoch=++navigationEpoch;
      var button=Array.from(content.querySelectorAll('[data-project-open]')).find(function(el){return el.dataset.projectOpen===id;});
      if(button){button.disabled=true;button.setAttribute('aria-busy','true');}
      try{var data=await app.api('get',{projectId:id});if(epoch!==navigationEpoch||!dialog.open||app.busy())return;await app.switchScope(data.project);close();}
      catch(err){error(err.message);}
      finally{if(button&&button.isConnected){button.disabled=false;button.removeAttribute('aria-busy');}}
    }
    async function materials(){
      var current=app.currentProject();if(!current)return list();
      var epoch=++navigationEpoch,owner=accountKey();
      try{
        var loadedProject=(await app.api('get',{projectId:current.id})).project;
        var files=removed?(await app.api('removed_files',{projectId:loadedProject.id})).files:loadedProject.files;
        if(epoch!==navigationEpoch||owner!==accountKey()||app.currentProject()?.id!==current.id)return;project=loadedProject;
        if(app.refreshProject)app.refreshProject(loadedProject);
        setContent((removed?'已移除资料 · ':'项目资料 · ')+project.name,'<div class="arena-workspace-intro"><p>可选按需检索或全文阅读；上传完成后建立索引，只有模型实际查阅时才产生阅读用量。</p>'+(!removed?'<button class="arena-workspace-primary" data-file-upload>上传资料</button>':'')+'</div><p class="arena-workspace-muted">PDF、Word（DOCX）、Excel（XLSX/XLS）、PPT 和文本。大文件分片上传，大小受设备和存储服务实际能力影响；扫描件需 OCR。</p><div class="arena-project-file-list">'+(files.map(function(file){return '<div class="arena-project-file-row"><button data-file-preview="'+e(file.id)+'"><strong>'+e(root.ArenaProjectFiles.name(file))+'</strong><span>'+Math.ceil(file.size/1024)+' KB · '+Number(file.characters||0).toLocaleString()+' 字符 · '+e(root.ArenaProjectFiles.status(file))+'</span></button><button '+(removed?'data-file-restore':'data-file-remove')+'="'+e(file.id)+'">'+(removed?'恢复':'移除')+'</button></div>';}).join('')||'<div class="arena-workspace-empty">暂无'+(removed?'已移除':'')+'资料</div>')+'</div><p data-w-error role="alert"></p><div class="arena-workspace-footer"><button data-file-removed-toggle>'+(removed?'返回资料':'查看已移除资料')+'</button><button data-project-settings="'+e(project.id)+'">项目设置</button></div>');show();
      }catch(err){if(epoch===navigationEpoch&&owner===accountKey()&&app.currentProject()?.id===current.id)error(err.message);}
    }
    var viewedFile=null,viewedProject=null,previewEpoch=0,previewFocus=null;
    function closeFile(restoreFocus){
      previewEpoch++;viewedFile=null;viewedProject=null;pane.hidden=true;host.classList.remove('arena-file-open');
      pane.querySelector('#aaFileName').textContent='';pane.querySelector('#aaFileMeta').textContent='';pane.querySelector('#aaFilePreview').textContent='';
      if(restoreFocus&&previewFocus?.isConnected)previewFocus.focus();previewFocus=null;
    }
    async function preview(id,projectId){
      var revision=++previewEpoch,owner=accountKey(),scope=app.currentScope?app.currentScope():app.currentProject()?.id;
      function valid(){return revision===previewEpoch&&owner===accountKey()&&scope===(app.currentScope?app.currentScope():app.currentProject()?.id);}
      try{
        var currentId=projectId||(project&&project.id)||(app.currentProject()||{}).id;
        previewFocus=document.activeElement;
        var data=await app.api('preview',{projectId:currentId,fileId:id});
        if(!valid())return;
        viewedFile=data.file;viewedProject=currentId;
        pane.querySelector('#aaFileName').textContent=root.ArenaProjectFiles.name(data.file);
        pane.querySelector('#aaFileMeta').textContent=data.file.previewTruncated?'预览前 6 万字符，可下载完整原文件':'项目资料 · '+Number(data.file.characters||0).toLocaleString()+' 字符 · '+root.ArenaProjectFiles.status(data.file);
        pane.querySelector('#aaFilePreview').textContent=data.file.text;
        pane.hidden=false;host.classList.add('arena-file-open');close();
        pane.querySelector('[data-file-close]').focus();
      }catch(err){if(valid())error(err.message);}
    }
    dialog.querySelector('[data-w-close]').addEventListener('click',close);
    dialog.addEventListener('click',async function(event){
      var target=event.target.closest('button');if(!target)return;
      try{
        if(target.hasAttribute('data-project-new'))return edit(null);
        if(target.dataset.projectOpen)return enter(target.dataset.projectOpen);
        if(target.dataset.projectPin){
          var id=target.dataset.projectPin,account=accountKey(),key=account+'|'+id;
          pinErrors.delete(account);
          pins.toggle(key,target.dataset.pinned==='true',{id:id,account:account,auth:app.pinContext?app.pinContext():{}});
          if(event.detail===0){var focused=Array.from(content.querySelectorAll('[data-project-pin]')).find(function(b){return b.dataset.projectPin===id;});if(focused)focused.focus();}
          return;
        }
        if(target.dataset.projectSettings)return edit(target.dataset.projectSettings);
        if(target.hasAttribute('data-project-back'))return list();
        if(target.hasAttribute('data-project-archive-toggle')){archived=!archived;return list();}
        if(target.hasAttribute('data-project-general')){await app.switchScope(null);return close();}
        if(target.dataset.projectArchive){
          if(app.busy()){notify('回答完成后可以归档项目');return;}
          await app.api('archive',{projectId:target.dataset.projectArchive});
          invalidate();
          if(app.currentProject()&&app.currentProject().id===target.dataset.projectArchive)await app.switchScope(null);
          return list();
        }
        if(target.dataset.projectRestore){await app.api('archive',{projectId:target.dataset.projectRestore,archived:false});invalidate();return list();}
        if(target.hasAttribute('data-file-upload')){input.click();return;}
        if(target.dataset.filePreview)return preview(target.dataset.filePreview);
        if(target.dataset.fileRemove){await app.api('remove_file',{projectId:project.id,fileId:target.dataset.fileRemove});return materials();}
        if(target.dataset.fileRestore){await app.api('restore_file',{projectId:project.id,fileId:target.dataset.fileRestore});return materials();}
        if(target.hasAttribute('data-file-removed-toggle')){removed=!removed;return materials();}
      }catch(err){error(err.message);}
    });
    content.addEventListener('submit',async function(event){
      if(event.target.id!=='aaProjectForm')return;event.preventDefault();
      var form=event.target,button=form.querySelector('[type=submit]');button.disabled=true;
      try{
        var values={name:form.elements.name.value,instructions:form.elements.instructions.value};
        if(project){values.projectId=project.id;values.memory=form.elements.memory.value;}
        var data=await app.api(project?'update':'create',values);
        invalidate();
        if(project){if(app.currentProject()&&app.currentProject().id===project.id)app.refreshProject(Object.assign({},project,data.project,{memory:values.memory}));close();notify('项目设置已保存');}
        else{await app.switchScope(data.project);close();}
      }catch(err){error(err.message);button.disabled=false;}
    });
    input.addEventListener('change',async function(){
      var files=Array.from(input.files||[]),current=project||app.currentProject();input.value='';
      if(!current||!files.length)return;
      var status=content.querySelector('[data-w-error]'),upload=content.querySelector('[data-file-upload]');if(upload)upload.disabled=true;
      try{
        var expanded=await root.ArenaProjectFiles.expandFiles(files);
        if(!expanded.files.length)throw Error(expanded.skipped.map(function(item){return item.name+'：'+item.reason;}).join('；'));
        files=expanded.files;
        for(var i=0;i<files.length;i++){
          if(status)status.textContent='正在提取并保存 '+files[i].path+'（'+(i+1)+'/'+files.length+'）…';
          var owner=accountKey(),credentials=app.pinContext();await root.ArenaProjectFiles.upload({file:files[i].file,folder:files[i].archive?files[i].path.split('/')[0]:null,relativePath:files[i].archive?files[i].path.split('/').slice(1).join('/'):null,projectId:current.id,credentials:credentials,api:app.api,binary:app.binary,isCurrent:function(){return owner===accountKey();},progress:function(p){if(status&&owner===accountKey())status.textContent=p.phase+' · '+p.name+(p.total?' · '+Math.round(100*p.done/p.total)+'%':p.done?' · '+p.done+' 个片段':'');}});
        }
        if(app.currentProject()&&app.currentProject().id===current.id){var updated=(await app.api('get',{projectId:current.id})).project;app.refreshProject(updated);}
        await materials();notify('资料已保存到本项目'+(expanded.skipped.length?'；'+expanded.skipped.map(function(item){return item.name+'：'+item.reason;}).join('；'):''));
      }catch(err){error(err.message);if(upload)upload.disabled=false;}
    });
    pane.querySelector('[data-file-close]').addEventListener('click',function(){closeFile(true);});
    pane.querySelector('[data-file-download]').addEventListener('click',async function(){
      if(!viewedFile)return;
      try{var file=viewedFile,blob;if(file.storage==='r2'){var response=await app.binary('/project-original',{method:'POST',body:{projectId:viewedProject,fileId:file.id}});blob=await response.blob();}else{var result=await app.api('download',{projectId:viewedProject,fileId:file.id});file=result.file;var bytes=root.ArenaFiles.decodeBase64(file.data);blob=new Blob([bytes],{type:file.type||'application/octet-stream'});}var url=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=url;anchor.download=file.name;anchor.click();setTimeout(function(){URL.revokeObjectURL(url);},30000);}catch(err){notify(err.message);}
    });
    return {list:list,preload:preload,materials:function(){removed=false;return materials();},settings:function(){var current=app.currentProject();return current?edit(current.id):list();},preview:preview,closeFile:closeFile,enter:enter};
  }
  root.ArenaWorkspace={mount:mount,readFile:readFile};
})(window);
