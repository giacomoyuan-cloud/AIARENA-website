/* Project pages use the same composer, providers and scoped storage as conversations. */
(function(root){
  'use strict';
  var mountLegacy=root.ArenaWorkspace.mount,e=root.ArenaMarkdown.escape;
  var icons={folder:'<path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10H3Z"/>',chat:'<path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-1 1v-9.5A8.5 8.5 0 0 1 11.5 3h1A8.5 8.5 0 0 1 21 11.5Z"/>',clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',plus:'<path d="M12 5v14M5 12h14"/>',more:'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',file:'<path d="M14 3H6v18h12V7Zm0 0v5h4M8 12h6M8 16h6"/>',search:'<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>',lock:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',close:'<path d="m6 6 12 12M18 6 6 18"/>'};
  function icon(name){return '<svg viewBox="0 0 24 24" aria-hidden="true">'+icons[name]+'</svg>';}
  function date(value,zone){return value?new Intl.DateTimeFormat('zh-CN',{timeZone:zone||'Asia/Shanghai',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(value):'暂无';}
  function button(label,attrs,kind){return '<button type="button" '+(attrs||'')+' class="'+(kind||'')+'">'+label+'</button>';}
  root.ArenaWorkspace.mount=function(app){
    var host=app.host,main=host.querySelector('.aa-main'),page=document.createElement('section'),dialog=document.createElement('dialog');
    var composer=host.querySelector('.aa-input-area'),marker=document.createComment('shared conversation composer');composer.before(marker);
    page.id='aaProjectPage';page.className='arena-project-page';page.hidden=true;page.setAttribute('aria-label','项目工作区');main.appendChild(page);
    dialog.className='arena-workspace-dialog arena-project-editor';host.appendChild(dialog);
    var shortcuts=document.createElement('div');shortcuts.className='arena-project-shortcuts';shortcuts.hidden=true;host.querySelector('.arena-history-label').before(shortcuts);
    var upload=document.createElement('input');upload.type='file';upload.multiple=true;upload.hidden=true;upload.accept=root.ArenaFiles.DOCUMENT_ACCEPT;host.appendChild(upload);
    var folder=document.createElement('input');folder.type='file';folder.multiple=true;folder.hidden=true;folder.setAttribute('webkitdirectory','');host.appendChild(folder);
    var epoch=0,account='',kind='',current=null,chats=[],tasks=[],catalog=[],archiveCatalog=[],deletedCatalog=[],archived=false,deleted=false,taskTab='mine',taskScope,taskSearch='',taskFilter='all',taskSort='next',projectSearch='',sort='updated',uploading=false,formSave=null,creationTarget=null;
    var projectState=root.ArenaProjectState.create({api:app.api,accountKey:key,credentials:auth,onError:function(err){notice(err.message);},onChange:function(){
      syncCatalogs();paintPins();if(kind==='home')renderHome();else if(kind==='list')paintList(projectsForView());
    }});
    var menu=document.createElement('div');menu.className='arena-project-menu';menu.setAttribute('popover','auto');menu.setAttribute('role','menu');host.appendChild(menu);
    var menuAction=null,menuAnchor=null;
    var legacy=mountLegacy(Object.assign({},app,{switchScope:async function(p){if(await app.switchScope(p)===false)return false;if(p)await home(p.id,true);else hide();return true;},refreshProject:function(p){app.refreshProject(p);if(current&&current.id===p.id){current=Object.assign({},current,p);if(kind==='home')renderHome();}loadPins();}}));
    function auth(){return app.pinContext?app.pinContext():{};}
    function key(){return app.accountKey?app.accountKey():'';}
    function valid(n){return n===epoch&&account===key();}
    function notice(text){app.notice(text);}
    function error(text){var el=dialog.open?dialog.querySelector('[data-error]'):page.querySelector('[data-error]');if(el)el.textContent=text;else notice(text);}
    function restoreComposer(){if(composer.parentNode!==marker.parentNode)marker.after(composer);}
    function hide(){epoch++;restoreComposer();page.hidden=true;host.classList.remove('arena-workspace-visible');delete host.dataset.workspaceView;host.querySelector('#aaSchedulesBtn').classList.remove('active');kind='';closeMenu();if(app.syncLayout)app.syncLayout();}
    function show(view,html){restoreComposer();kind=view;page.innerHTML=html;page.hidden=false;host.classList.add('arena-workspace-visible');host.dataset.workspaceView=view;host.querySelector('#aaProjectsBtn').classList.toggle('active',view!=='tasks');host.querySelector('#aaSchedulesBtn').classList.toggle('active',view==='tasks');host.querySelector('#aaConversationTitle').textContent=view==='tasks'?'定时任务':view==='home'&&current?current.name:'项目';app.closeSidebar();closeMenu();}
    function heading(name,actions){return '<header class="arena-project-page-heading"><h1>'+e(name)+'</h1><div>'+actions+'</div></header>';}
    function status(){return '<p data-error class="arena-project-error" role="alert"></p>';}
    function openForm(name,html,save,options){
      options=options||{};formSave=save;dialog.setAttribute('aria-label',name);dialog.innerHTML='<div class="arena-dialog-heading"><h2>'+e(name)+'</h2>'+button(icon('close'),'data-editor-close aria-label="关闭窗口"','arena-icon-btn')+'</div><form><div class="arena-project-form-body">'+html+status()+'</div><footer class="arena-project-form-footer">'+button('取消','data-editor-close')+'<button type="submit" class="arena-workspace-primary'+(options.danger?' danger':'')+'">'+e(options.submit||'保存')+'</button></footer></form>';
      if(!dialog.open)dialog.showModal();var field=dialog.querySelector('input:not([type=checkbox]),textarea,select');if(field)field.focus();
    }
    dialog.addEventListener('click',function(ev){if(ev.target.closest('[data-editor-close]'))dialog.close();});
    dialog.addEventListener('submit',async function(ev){
      ev.preventDefault();if(!formSave)return;var submit=dialog.querySelector('[type=submit]'),save=formSave,form=ev.target;submit.disabled=true;
      try{await save(form);if(form===dialog.querySelector('form'))dialog.close();}catch(err){error(err.message);}finally{submit.disabled=false;}
    });
    function closeMenu(){if(menu.matches(':popover-open'))menu.hidePopover();if(menuAnchor)menuAnchor.setAttribute('aria-expanded','false');}
    function openMenu(anchor,items,action){
      closeMenu();menuAnchor=anchor;menuAction=action;menu.innerHTML=items.map(function(item){return button(item.label,'role="menuitem" data-menu="'+item.id+'"',item.danger?'danger':'');}).join('');
      menu.showPopover();anchor.setAttribute('aria-expanded','true');var rect=anchor.getBoundingClientRect();
      menu.style.left=Math.max(8,Math.min(rect.right-menu.offsetWidth,innerWidth-menu.offsetWidth-8))+'px';menu.style.top=Math.max(8,Math.min(rect.bottom+6,innerHeight-menu.offsetHeight-8))+'px';
      menu.querySelector('button').focus();
    }
    menu.addEventListener('click',function(ev){var b=ev.target.closest('[data-menu]');if(!b)return;var action=menuAction;closeMenu();Promise.resolve(action(b.dataset.menu)).catch(function(err){notice(err.message);});});
    menu.addEventListener('keydown',function(ev){var buttons=Array.from(menu.querySelectorAll('button')),index=buttons.indexOf(document.activeElement);if(ev.key==='ArrowDown'||ev.key==='ArrowUp'){ev.preventDefault();buttons[(index+(ev.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length].focus();}if(ev.key==='Escape'){closeMenu();if(menuAnchor)menuAnchor.focus();}});
    function listView(){return deleted?'deleted':archived?'archived':'active';}
    function syncCatalogs(){catalog=projectState.projects('active');archiveCatalog=projectState.projects('archived');deletedCatalog=projectState.projects('deleted');}
    function projectsForView(){return deleted?deletedCatalog:archived?archiveCatalog:catalog;}
    async function loadPins(){
      var a=key(),credentials=auth();if(!a){catalog=[];shortcuts.hidden=true;shortcuts.innerHTML='';return;}
      if(account!==a){shortcuts.innerHTML='';shortcuts.hidden=true;}account=a;
      try{await projectState.load('active');if(a!==key())return;syncCatalogs();paintPins();if(kind==='home')renderHome();}catch(err){}
    }
    function syncScope(){
      var id=app.currentScope?app.currentScope():app.currentProject()?.id;
      shortcuts.querySelectorAll('[data-shortcut]').forEach(function(b){if(id&&b.dataset.shortcut===id)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
    }
    function paintPins(){
      var pinned=catalog.filter(function(p){return p.pinned;});shortcuts.hidden=!pinned.length;
      shortcuts.innerHTML='<div class="arena-project-shortcuts-label">已置顶</div>'+pinned.map(function(p){return '<div class="arena-project-shortcut">'+button(icon('folder')+'<span>'+e(p.name)+'</span>','data-shortcut="'+e(p.id)+'"')+button(icon('more'),'data-shortcut-menu="'+e(p.id)+'" aria-label="项目菜单：'+e(p.name)+'" aria-haspopup="menu"')+'</div>';}).join('');syncScope();
    }
    shortcuts.addEventListener('click',function(ev){var b=ev.target.closest('button');if(!b)return;if(b.dataset.shortcut)enter(b.dataset.shortcut);if(b.dataset.shortcutMenu)projectMenu(catalog.find(function(p){return p.id===b.dataset.shortcutMenu;}),b);});
    async function list(){
      if(app.busy()){notice('回答完成后可以切换项目');return;}
      var n=++epoch;account=key();show('list',heading('项目',button('新建项目','data-new-project','arena-workspace-primary'))+'<p role="status">正在加载项目…</p>');
      try{await projectState.load(listView());if(!valid(n))return;syncCatalogs();paintList(projectsForView());paintPins();}catch(err){if(valid(n))page.innerHTML=heading('项目',button('新建项目','data-new-project','arena-workspace-primary'))+'<p role="alert">'+e(err.message)+'</p>'+button('重新加载','data-list');}
    }
    function paintList(items){
      var inactive=archived||deleted;
      var sorted=items.filter(function(p){return !projectSearch||p.name.toLocaleLowerCase().includes(projectSearch.toLocaleLowerCase());}).sort(function(a,b){return Number(!!b.pinned)-Number(!!a.pinned)||(sort==='name'?a.name.localeCompare(b.name,'zh-CN'):b.updatedAt-a.updatedAt);});
      var actions=button('普通聊天','data-general')+(inactive?button('返回项目','data-list'):'')+(!archived?button('已归档','data-archive-toggle'):'')+(!deleted?button('回收站','data-trash-toggle'):'')+button('新建项目','data-new-project','arena-workspace-primary');
      var cards=sorted.map(function(p){
        var content=icon('folder')+'<strong>'+e(p.name)+'</strong><span>'+date(deleted?p.deletedAt:p.updatedAt)+'</span>';
        var open=inactive?'<div class="arena-project-open">'+content+'</div>':button(content,'data-open-project="'+e(p.id)+'"','arena-project-open');
        var pin=button(root.ArenaControls.pinIcon,'data-pin-project="'+e(p.id)+'" aria-label="'+(p.pinned?'取消置顶':'置顶')+'项目：'+e(p.name)+'" aria-pressed="'+!!p.pinned+'" aria-busy="'+!!p.pinPending+'"','arena-project-pin'+(p.pinned?' pinned':''));
        var restore=button('恢复','data-restore="'+e(p.id)+'"','arena-project-card-restore');
        var more=button(icon('more'),'data-project-menu="'+e(p.id)+'" aria-label="项目菜单：'+e(p.name)+'" aria-haspopup="menu"','arena-project-card-more');
        return '<article class="arena-project-card">'+open+'<div class="arena-project-card-actions">'+(inactive?restore:pin)+(!deleted?more:'')+'</div></article>';
      }).join('');
      var empty='<div class="arena-project-empty">'+icon('folder')+'<h2>'+(projectSearch?'没有找到项目':deleted?'回收站为空':archived?'暂无已归档项目':'创建你的第一个项目')+'</h2><p>'+(deleted?'删除的项目可以在这里恢复。':'将相关对话、指令和参考资料放在一起。')+'</p>'+(!projectSearch&&!inactive?button('新建项目','data-new-project','arena-workspace-primary'):'')+'</div>';
      show('list',heading(deleted?'回收站':archived?'已归档项目':'项目',actions)+
        '<div class="arena-project-tools"><label class="arena-project-search">'+icon('search')+'<input type="search" data-project-search aria-label="搜索项目" placeholder="搜索项目" value="'+e(projectSearch)+'"></label><select data-project-sort aria-label="项目排序"><option value="updated"'+(sort==='updated'?' selected':'')+'>最近更新</option><option value="name"'+(sort==='name'?' selected':'')+'>名称</option></select></div><div class="arena-project-grid">'+(cards||empty)+'</div>'+status());
    }
    function createProject(after){
      var credentials=auth();
      openForm('新建项目','<label>项目名称<input name="name" required maxlength="80" placeholder="例如：产品开发"></label><label>指令<textarea name="instructions" maxlength="4000" rows="5" placeholder="项目目标、背景和回复要求"></textarea></label>',async function(form){var data=await app.api('create',Object.assign({name:form.elements.name.value,instructions:form.elements.instructions.value},credentials));await loadPins();if(after)await after(data.project);else await enter(data.project.id);});
    }
    async function enter(id){
      if(app.busy()){notice('回答完成后可以切换项目');return;}
      closeMenu();if(dialog.open)dialog.close();await home(id,true);
    }
    async function home(id,start){
      if(app.busy()){notice('回答完成后可以打开项目主页');return;}
      var n=++epoch;account=key();var credentials=auth();
      show('home',heading('项目',button('所有项目','data-list'))+'<p role="status">正在加载项目…</p>');
      try{
        var data=await app.api('get',Object.assign({projectId:id},credentials));if(!valid(n))return;current=data.project;
        if(!app.currentProject()||app.currentProject().id!==id){if(await app.switchScope(current)===false)throw Error('项目切换未完成，请保留当前对话后重试');if(!valid(n))return;}else app.refreshProject(current);
        if(start){await app.flushChat();if(!valid(n))return;if(await app.newChat({preserveDraft:true})===false)return;if(!valid(n))return;}
        var results=await Promise.allSettled([app.chatApi('list',Object.assign({projectId:id},credentials)),app.scheduleApi('list',Object.assign({projectId:id},credentials))]);
        if(!valid(n))return;
        var chatData=results[0];if(chatData.status!=='fulfilled'||!chatData.value||!Array.isArray(chatData.value.chats))throw Error('项目对话加载失败，请重试');
        chats=chatData.value.chats;tasks=results[1].status==='fulfilled'?results[1].value.tasks:[];current.scheduleError=results[1].status==='rejected'?results[1].reason.message:null;
        renderHome();paintPins();
      }catch(err){if(valid(n)){page.innerHTML=heading('项目',button('所有项目','data-list'))+'<p role="alert">'+e(err.message)+'</p>'+button('重新加载','data-home="'+e(id)+'"');}}
    }
    function fileRows(files){return files.map(function(f){return '<div class="arena-project-resource">'+button(icon('file')+'<span>'+e(f.relativePath||f.name)+'</span>','data-preview="'+e(f.id)+'"')+button('×','data-remove-file="'+e(f.id)+'" aria-label="移除资料：'+e(f.name)+'"')+'</div>';}).join('');}
    function renderHome(){
      if(!current||kind!=='home')return;var p=current,pin=catalog.find(function(x){return x.id===p.id;})||{},files=p.files||[],folders=Array.from(new Set(files.map(function(f){return f.folder;}).filter(Boolean))),selectedFocus=composer.contains(document.activeElement)?document.activeElement:null;
      show('home','<div class="arena-project-breadcrumb">'+button('项目','data-list')+'<span>/</span><span>'+e(p.name)+'</span></div>'+heading(p.name,button(root.ArenaControls.pinIcon,'data-pin-project="'+e(p.id)+'" aria-label="'+(pin.pinned?'取消置顶':'置顶')+'项目" aria-pressed="'+!!pin.pinned+'" aria-busy="'+!!pin.pinPending+'"','arena-project-heading-pin'+(pin.pinned?' pinned':''))+button(icon('more'),'data-project-menu="'+e(p.id)+'" aria-label="项目菜单" aria-haspopup="menu"'))+
        '<div class="arena-project-home-grid"><div class="arena-project-home-main"><div data-composer-slot></div><div class="arena-project-conversations"><div class="arena-project-section-heading"><h2>项目对话</h2>'+button(icon('plus')+'新建对话','data-new-chat')+'</div><label class="arena-project-search">'+icon('search')+'<input type="search" data-chat-search aria-label="搜索项目对话" placeholder="搜索对话"></label><div data-project-chats>'+chatRows(chats)+'</div></div></div><aside class="arena-project-context" aria-label="项目设置和资料">'+
        '<section><div class="arena-project-section-heading"><h2>指令</h2>'+button(icon('plus'),'data-edit-field="instructions" aria-label="编辑项目指令"')+'</div><p class="arena-project-instructions">'+e(p.instructions||'添加指令，定制这个项目中的回复。')+'</p></section>'+
        '<section><div class="arena-project-section-heading"><h2>记忆</h2><span class="arena-project-private">'+icon('lock')+'仅限本人</span>'+button('查看记忆','data-edit-field="memory"')+'</div><p class="arena-project-memory">'+e(p.memory||'在此项目中积累的记忆会显示在这里。')+'</p></section>'+
        '<section><div class="arena-project-section-heading"><h2>上下文</h2>'+button(icon('plus'),'data-context-menu aria-label="添加项目资料" aria-haspopup="menu"')+'</div>'+(files.length?fileRows(files.filter(function(f){return !f.folder;})):'<div class="arena-project-context-empty">'+icon('file')+'<p>添加 PDF、文档或文本，作为本项目的参考资料。</p>'+button('添加资料','data-context-menu')+'</div>')+(files.length?button('管理资料 · '+files.length+'/15','data-materials','arena-project-link'):'')+'</section>'+
        '<section><div class="arena-project-section-heading"><h2>文件夹</h2><span class="arena-project-private">'+icon('lock')+'仅限本人</span>'+button(icon('plus'),'data-folder aria-label="导入文件夹"')+'</div><p>选择此电脑上的文件夹，将其中的文档导入项目。</p>'+folders.map(function(name){return '<details class="arena-project-folder"><summary>'+icon('folder')+e(name)+'<span>'+files.filter(function(f){return f.folder===name;}).length+'</span></summary>'+fileRows(files.filter(function(f){return f.folder===name;}))+'</details>';}).join('')+(folders.length?button('重新导入以更新','data-folder','arena-project-link'):'')+'</section>'+
        '<section><div class="arena-project-section-heading"><h2>已排定</h2>'+button(icon('plus'),'data-new-task aria-label="为项目创建定时任务"')+'</div>'+(p.scheduleError?'<p role="alert">'+e(p.scheduleError)+'</p>'+button('重试','data-home="'+e(p.id)+'"'):tasks.length?tasks.map(function(t){return button('<span>'+icon('clock')+e(t.name)+'</span><small>'+(t.enabled?date(t.nextRunAt,t.schedule.timeZone):'已暂停')+'</small>','data-task="'+e(t.id)+'"','arena-project-task-link');}).join(''):'<p>为此项目设置定时任务。</p>')+button('查看全部任务','data-schedules','arena-project-link')+'</section></aside></div>'+status());
      page.querySelector('[data-composer-slot]').appendChild(composer);if(selectedFocus)selectedFocus.focus({preventScroll:true});
    }
    function chatRows(items){return items.length?items.map(function(c){return '<article class="arena-project-chat-row">'+button(icon('chat')+'<span><strong>'+e(c.title)+'</strong><small>'+date(c.lastReplyAt||c.updatedAt)+'</small></span>','data-open-chat="'+e(c.id)+'"')+button(icon('more'),'data-chat-menu="'+e(c.id)+'" aria-label="对话菜单：'+e(c.title)+'" aria-haspopup="menu"')+'</article>';}).join(''):'<div class="arena-project-empty arena-project-empty-small">'+icon('chat')+'<p>在这个项目中发起对话，共用相同的指令和资料。</p></div>';}
    async function refreshHome(){if(current&&kind==='home')await home(current.id,false);}
    function togglePin(id){projectState.togglePin(id);}
    async function restoreProject(p){
      var a=key();await projectState.change(p.deletedAt?'restore':'restoreArchive',p);if(a!==key())return;
      archived=false;deleted=false;projectSearch='';await loadPins();await list();notice('项目已恢复');
    }
    function projectMenu(p,anchor){
      if(!p)return;var a=key(),credentials=auth();
      var items=p.deletedAt?[{id:'restore',label:'恢复项目'}]:p.archivedAt?[{id:'restore',label:'恢复项目'},{id:'delete',label:'删除项目',danger:true}]:[
        {id:'pin',label:p.pinned?'取消置顶':'置顶'},{id:'rename',label:'重命名'},{id:'settings',label:'项目设置'},{id:'general',label:'返回普通聊天'},{id:'archive',label:'归档项目'},{id:'delete',label:'删除项目',danger:true}
      ];
      openMenu(anchor,items,async function(action){
        if(a!==key())return;
        if(action==='pin')return togglePin(p.id);if(action==='restore')return restoreProject(p);
        if(action==='general'){hide();await app.switchScope(null);return;}
        if(action==='settings'){if(!app.currentProject()||app.currentProject().id!==p.id)await enter(p.id);return legacy.settings();}
        if(action==='rename')return openForm('重命名项目','<label>项目名称<input name="name" required maxlength="80" value="'+e(p.name)+'"></label>',async function(f){
          if(a!==key())throw Error('账号已切换，请重新打开项目菜单');
          await app.api('update',Object.assign({projectId:p.id,name:f.elements.name.value},credentials));if(a!==key())return;
          await loadPins();if(kind==='home')await refreshHome();else await list();
        });
        if(app.busy()){notice('回答完成后可以操作项目');return;}
        var deleting=action==='delete';
        openForm(deleting?'删除项目':'归档项目','<p>'+(deleting?'删除':'归档')+'“'+e(p.name)+'”？</p><p>'+(deleting?'项目将移入回收站，可恢复。对话、记忆和资料会保留在该项目内，不会进入普通聊天。项目删除期间不会启动新的定时生成。':'对话和资料会保留，可在已归档项目中恢复。')+'</p>',async function(){
          if(a!==key())throw Error('账号已切换，请重新打开项目菜单');
          if(app.busy())throw Error('回答完成后可以操作项目');
          await projectState.change(action,p);if(a!==key())return;
          if(app.currentProject()?.id===p.id){hide();if(await app.switchScope(null)===false)return;}
          await loadPins();await list();notice(deleting?'项目已移入回收站':'项目已归档');
        },{submit:deleting?'删除项目':'归档项目',danger:deleting});
      });
    }
    function editField(field){var p=current,credentials=auth(),limit=field==='memory'?2400:4000,label=field==='memory'?'项目记忆':'项目指令';openForm(label,'<p>'+(field==='memory'?'仅在本项目的对话之间共享。可以修改或清空。':'保存后用于本项目的下一条消息。')+'</p><label>'+label+'<textarea name="value" rows="9" maxlength="'+limit+'">'+e(p[field]||'')+'</textarea></label>',async function(f){var values={projectId:p.id};values[field]=f.elements.value.value;var data=await app.api('update',Object.assign(values,credentials));current=Object.assign({},p,data.project);current[field]=values[field];app.refreshProject(current);renderHome();notice(label+'已保存');});}
    function addText(){var p=current,credentials=auth();openForm('添加文本资料','<label>标题<input name="name" required maxlength="160" placeholder="例如：项目背景"></label><label>内容<textarea name="text" required rows="10" maxlength="400000"></textarea></label>',async function(f){var name=f.elements.name.value.trim().replace(/\.txt$/i,'')+'.txt',file=new File([f.elements.text.value],name,{type:'text/plain'});await app.api('upload',Object.assign({projectId:p.id,file:await root.ArenaWorkspace.readFile(file)},credentials));await refreshHome();notice('文本资料已保存');});}
    async function uploadFiles(files,isFolder){
      if(uploading)return;var p=app.currentProject(),credentials=auth(),a=key();if(!p||!files.length)return;
      uploading=true;var success=0,errors=[],currentFiles=[];
      try{
        currentFiles=(await app.api('get',Object.assign({projectId:p.id},credentials))).project.files;
        var expanded=await root.ArenaFiles.expandFiles(files,{progress:notice});
        errors=expanded.skipped.map(function(item){return item.name+'：'+item.reason;});
        files=expanded.files;
        for(var i=0;i<files.length;i++){
          if(a!==key()||p.id!==(app.currentProject()||{}).id)break;
          var entry=files[i],source=entry.file,path=entry.path;
          try{
            var folderName=isFolder||entry.archive?path.split('/')[0]:null,relativePath=folderName?path.split('/').slice(1).join('/'):null;
            var replace=folderName?currentFiles.find(function(f){return f.folder===folderName&&f.relativePath===relativePath;}):null;
            if(!replace&&currentFiles.length>=15)throw Error('每个项目最多保存 15 份资料');
            if(currentFiles.reduce(function(n,f){return n+(replace&&replace.id===f.id?0:f.size);},0)+source.size>40*1024*1024)throw Error('项目资料总量超过 40MB');
            var data=await root.ArenaWorkspace.readFile(source);
            if(a!==key()||p.id!==(app.currentProject()||{}).id)break;
            if(folderName){data.folder=folderName;data.relativePath=relativePath;}
            notice('正在保存 '+source.name+'（'+(i+1)+'/'+files.length+'）');
            var result=await app.api('upload',Object.assign({projectId:p.id,file:data,replaceFileId:replace?replace.id:undefined},credentials));currentFiles=result.files;success++;
          }catch(err){errors.push(source.name+'：'+err.message);}
        }
        if(a===key()){
          await refreshHome();var summary='已导入 '+success+' 份资料'+(errors.length?'，'+errors.length+' 项未导入':'');
          if(errors.length||!success)openForm('导入结果','<p>'+e(summary)+'</p>'+errors.map(function(message){return '<p>'+e(message)+'</p>';}).join(''),async function(){});else notice(summary);
        }
      }catch(err){if(a===key())error(err.message);}finally{uploading=false;}
    }
    upload.addEventListener('change',function(){var files=Array.from(upload.files||[]);upload.value='';uploadFiles(files,false).catch(function(err){error(err.message);});});
    folder.addEventListener('change',function(){var files=Array.from(folder.files||[]);folder.value='';uploadFiles(files,true).catch(function(err){error(err.message);});});
    function contextMenu(anchor){openMenu(anchor,[{id:'upload',label:'上传文件'},{id:'text',label:'添加文本'},{id:'folder',label:'导入文件夹'}],function(action){if(action==='upload')upload.click();if(action==='folder')folder.click();if(action==='text')addText();});}
    async function chooseProject(chat,scope){
      if(app.busy()){notice('回答完成后可以移动对话');return;}var credentials=auth(),a=key();creationTarget={chat:chat,scope:scope};
      openForm('添加到项目','<p role="status">正在加载项目…</p>',null);dialog.querySelector('footer').hidden=true;
      try{var data=await app.api('list',credentials);if(a!==key())return;var items=data.projects.filter(function(p){return p.id!==scope;});
        openForm('添加到项目','<label>搜索项目<input type="search" data-picker-search placeholder="搜索项目"></label><div class="arena-project-picker">'+items.map(function(p){return button(icon('folder')+'<span>'+e(p.name)+'</span>','data-pick-project="'+e(p.id)+'" data-name="'+e(p.name.toLocaleLowerCase())+'"');}).join('')+'</div><p data-picker-empty'+(items.length?' hidden':'')+'>暂无可选项目</p>'+(!scope?'':button('移出项目，放回普通聊天','data-pick-general','arena-project-link'))+button(icon('plus')+'新建项目','data-picker-create','arena-project-picker-create'),null);dialog.querySelector('footer').hidden=true;
      }catch(err){error(err.message);}
    }
    dialog.addEventListener('input',function(ev){if(!ev.target.hasAttribute('data-picker-search'))return;var q=ev.target.value.toLocaleLowerCase(),visible=0;dialog.querySelectorAll('[data-pick-project]').forEach(function(b){b.hidden=!b.dataset.name.includes(q);if(!b.hidden)visible++;});dialog.querySelector('[data-picker-empty]').hidden=!!visible;});
    dialog.addEventListener('click',async function(ev){var b=ev.target.closest('button');if(!b)return;
      if(b.hasAttribute('data-picker-create')){var target=creationTarget;return createProject(function(p){return moveChat(target.chat,target.scope,p.id);});}
      if(b.hasAttribute('data-pick-project')||b.hasAttribute('data-pick-general')){b.disabled=true;try{await moveChat(creationTarget.chat,creationTarget.scope,b.dataset.pickProject||null);dialog.close();}catch(err){error(err.message);b.disabled=false;}}
    });
    async function moveChat(chat,scope,target){
      var credentials=auth();await app.flushChat();var data=await app.chatApi('move',Object.assign({projectId:scope,chatId:chat.id,targetProjectId:target},credentials));
      if(!data?.ok)throw Error(data?.error||'移动失败，请重试');app.afterMove(scope,chat.id,target);hide();await app.openChat(data.projectId,data.chatId);notice(target?'已加入项目':'已移回普通聊天');
    }
    function chatMenu(chat,scope,anchor){openMenu(anchor,[{id:'window',label:'在新窗口中打开'},{id:'pin',label:chat.pinned?'取消置顶':'置顶'},{id:'rename',label:'重命名'},{id:'project',label:'添加到项目'},{id:'group',label:'移至分组'},{id:'delete',label:'删除',danger:true}],async function(action){
      var credentials=auth();
      if(action==='window'){var url=new URL(location.href);url.searchParams.set('project',scope||'general');url.searchParams.set('chat',chat.id);root.open(url.href,'_blank','noopener');return;}
      if(action==='project')return chooseProject(chat,scope);
      if(action==='pin'){var data=await app.chatApi('pin',Object.assign({projectId:scope,chatId:chat.id,pinned:!chat.pinned},credentials));if(!data?.ok)throw Error(data?.error||'置顶保存失败');app.reloadChats();return refreshHome();}
      if(action==='rename')return openForm('重命名对话','<label>对话名称<input name="title" value="'+e(chat.title)+'" required maxlength="80"></label>',async function(f){var data=await app.chatApi('rename',Object.assign({projectId:scope,chatId:chat.id,title:f.elements.title.value},credentials));if(!data?.ok)throw Error(data?.error||'重命名失败');app.reloadChats();await refreshHome();});
      if(action==='group'){
        var data=await app.chatApi('groups',Object.assign({projectId:scope},credentials));if(!data?.groups)throw Error(data?.error||'分组加载失败');
        return openForm('移至分组','<label>分组<select name="group"><option value="">未分组</option>'+data.groups.map(function(g){return '<option value="'+e(g.id)+'"'+(chat.groupId===g.id?' selected':'')+'>'+e(g.name)+'</option>';}).join('')+'</select></label><label>或新建分组<input name="newGroup" maxlength="40" placeholder="分组名称"></label>',async function(f){var groupId=f.elements.group.value;if(f.elements.newGroup.value.trim()){var result=await app.chatApi('create_group',Object.assign({projectId:scope,name:f.elements.newGroup.value},credentials));if(!result?.group)throw Error(result?.error||'分组创建失败');groupId=result.group.id;}var saved=await app.chatApi('group',Object.assign({projectId:scope,chatId:chat.id,groupId:groupId||null},credentials));if(!saved?.ok)throw Error(saved?.error||'移动失败');app.reloadChats();notice('已移动分组');});
      }
      if(action==='delete')openForm('删除对话','<p>删除“'+e(chat.title)+'”？此操作无法撤销。</p>',async function(){var data=await app.chatApi('delete',Object.assign({projectId:scope,chatId:chat.id},credentials));if(!data?.ok)throw Error(data?.error||'删除失败');app.afterDelete(scope,chat.id);app.reloadChats();await refreshHome();});
    });}
    var templates=[{name:'每日简报',prompt:'根据本项目的指令与资料，整理今天需要关注的进展、待办和风险。',frequency:'weekdays',time:'08:00'},{name:'每周回顾',prompt:'根据本项目资料整理本周进展、未解决问题和下周建议。信息不足时明确列出缺失信息。',frequency:'weekly',time:'16:00',day:5},{name:'资料检查',prompt:'检查本项目的参考资料，整理相互矛盾、缺失或需要更新的事项，并引用相关资料名称。',frequency:'weekly',time:'09:00',day:1},{name:'每日研究',prompt:'搜索与本项目目标相关的最新进展，提供来源链接和对本项目的影响。',frequency:'daily',time:'09:00',search:true}];
    function scheduleLabel(s){return (s.frequency==='once'?'仅一次 · '+date(Date.parse(s.at),s.timeZone):({daily:'每天',weekdays:'工作日',weekly:'每周'+['日','一','二','三','四','五','六'][s.day]}[s.frequency])+' '+s.time)+' · '+s.timeZone;}
    async function schedules(scope){
      if(app.busy()){notice('回答完成后可以打开定时任务');return;}var n=++epoch;account=key();taskScope=scope;show('tasks',heading('定时任务',button('新建任务','data-new-task','arena-workspace-primary'))+'<p role="status">正在加载任务…</p>');
      try{var data=await app.scheduleApi('list',Object.assign(scope?{projectId:scope}:{},auth()));if(!valid(n))return;tasks=data.tasks;renderTasks();}catch(err){if(valid(n))page.innerHTML=heading('定时任务',button('新建任务','data-new-task','arena-workspace-primary'))+'<p role="alert">'+e(err.message)+'</p>'+button('重试','data-schedules');}
    }
    function renderTasks(){
      var items=tasks.filter(function(t){return (!taskSearch||t.name.toLocaleLowerCase().includes(taskSearch.toLocaleLowerCase()))&&(taskFilter==='all'||taskFilter==='enabled'&&t.enabled||taskFilter==='paused'&&!t.enabled||taskFilter==='failed'&&t.status==='failed');}).sort(function(a,b){return taskSort==='name'?a.name.localeCompare(b.name,'zh-CN'):taskSort==='created'?b.createdAt-a.createdAt:(a.enabled&&a.nextRunAt||Infinity)-(b.enabled&&b.nextRunAt||Infinity);});
      show('tasks',heading('定时任务',button('新建任务','data-new-task','arena-workspace-primary'))+'<div class="arena-project-tools"><div class="arena-project-tabs" role="tablist" aria-label="任务视图">'+button('我的','data-task-tab="mine" role="tab" aria-selected="'+(taskTab==='mine')+'"')+button('模板','data-task-tab="templates" role="tab" aria-selected="'+(taskTab==='templates')+'"')+'</div><label class="arena-project-search">'+icon('search')+'<input type="search" data-task-search aria-label="搜索定时任务" value="'+e(taskSearch)+'" placeholder="搜索任务"></label></div>'+taskTools()+(taskScope?button('返回项目','data-home="'+e(taskScope)+'"','arena-project-link'):'')+(taskTab==='templates'?templateCards():items.length?'<div class="arena-task-list">'+items.map(function(t){return '<article class="arena-task-card">'+icon('clock')+'<div><h2>'+e(t.name)+'</h2><small>'+e(t.projectId?(catalog.find(function(p){return p.id===t.projectId;})?.name||'项目任务'):'普通聊天')+'</small><p>'+e(scheduleLabel(t.schedule))+'</p><small>'+(t.status==='running'?'正在执行':t.status==='failed'?'上次执行失败':!t.enabled?'已暂停':'下次执行 '+date(t.nextRunAt,t.schedule.timeZone))+'</small></div>'+button('查看','data-task="'+e(t.id)+'"')+'</article>';}).join('')+'</div>':'<div class="arena-project-empty arena-task-empty">'+icon('clock')+'<h2>'+(taskSearch||taskFilter!=='all'?'没有找到相关任务':'暂无定时任务')+'</h2>'+button('手动设置','data-new-task','arena-workspace-primary')+'</div>'+(!taskSearch?templateCards():''))+status());
    }
    function taskTools(){return taskTab==='templates'?'':'<div class="arena-project-tools arena-task-filters"><select data-task-filter aria-label="筛选任务状态">'+[['all','全部任务'],['enabled','已启用'],['paused','已暂停'],['failed','上次失败']].map(function(x){return '<option value="'+x[0]+'"'+(taskFilter===x[0]?' selected':'')+'>'+x[1]+'</option>';}).join('')+'</select><select data-task-sort aria-label="定时任务排序">'+[['next','下次执行'],['created','最近创建'],['name','名称']].map(function(x){return '<option value="'+x[0]+'"'+(taskSort===x[0]?' selected':'')+'>'+x[1]+'</option>';}).join('')+'</select></div>';}
    function templateCards(){return '<div class="arena-task-templates">'+templates.map(function(t,i){if(taskSearch&&!t.name.toLocaleLowerCase().includes(taskSearch.toLocaleLowerCase()))return '';return button(icon('clock')+'<span><strong>'+e(t.name)+'</strong><p>'+e(t.prompt)+'</p><small>'+e(scheduleLabel(Object.assign({timeZone:'Asia/Shanghai'},t)))+'</small></span>','data-template="'+i+'"');}).join('')+'</div>';}
    async function taskEditor(task,template){
      var credentials=auth(),a=key(),data=await app.api('list',credentials);if(a!==key())return;var p=task||template||{},s=p.schedule||p,zone=s.timeZone||'Asia/Shanghai',id=task?task.id:crypto.randomUUID();
      var selectedModel=p.model||(app.currentModel?app.currentModel():null);
      var options=(app.models?app.models():[]).map(function(m){return '<option value="'+e(m.id)+'"'+(selectedModel===m.id?' selected':'')+'>'+e(m.name)+'</option>';}).join('');
      openForm(task?'编辑定时任务':'新建定时任务','<label>任务名称<input name="name" required maxlength="80" value="'+e(p.name||'')+'"></label><label>任务指令<textarea name="prompt" required maxlength="8000" rows="5" placeholder="每次执行时需要 AI 完成什么？">'+e(p.prompt||'')+'</textarea></label><div class="arena-project-form-grid"><label>所属项目<select name="project"><option value="">普通聊天</option>'+data.projects.map(function(x){var selected=task?task.projectId===x.id:(taskScope||current&&kind==='home'&&current.id)===x.id;return '<option value="'+e(x.id)+'"'+(selected?' selected':'')+'>'+e(x.name)+'</option>';}).join('')+'</select></label><label>模型<select name="model">'+options+'</select></label><label>频率<select name="frequency">'+[['daily','每天'],['weekdays','工作日'],['weekly','每周'],['once','仅一次']].map(function(x){return '<option value="'+x[0]+'"'+(s.frequency===x[0]?' selected':'')+'>'+x[1]+'</option>';}).join('')+'</select></label><label data-recurring>执行时间<input type="time" name="time" value="'+e(s.time||'08:00')+'"></label><label data-weekly>星期<select name="day">'+['日','一','二','三','四','五','六'].map(function(x,i){return '<option value="'+i+'"'+(s.day===i?' selected':'')+'>星期'+x+'</option>';}).join('')+'</select></label><label data-once>执行日期和时间<input type="datetime-local" name="at" value="'+(s.at?e(localDateTime(s.at)):'')+'"></label><label data-recurring>时区<input name="zone" required value="'+e(zone)+'" placeholder="Asia/Shanghai"></label></div><p data-once class="arena-workspace-muted">单次执行时间使用此设备的本地时区：'+e(Intl.DateTimeFormat().resolvedOptions().timeZone)+'</p><label class="arena-project-checkbox"><input type="checkbox" name="search"'+(p.search?' checked':'')+'> 开启联网搜索</label><p class="arena-workspace-muted">按所选模型执行并产生正常用量。结果保存在所属项目的对话中。</p>',async function(f){var frequency=f.elements.frequency.value,schedule={frequency:frequency,time:f.elements.time.value,day:Number(f.elements.day.value),timeZone:f.elements.zone.value.trim()};if(frequency==='once'){var stamp=new Date(f.elements.at.value);if(!Number.isFinite(stamp.getTime()))throw Error('请选择有效日期');schedule.at=stamp.toISOString();}
        await app.scheduleApi(task?'update':'create',Object.assign({id:id,name:f.elements.name.value,prompt:f.elements.prompt.value,projectId:f.elements.project.value||null,model:f.elements.model.value,search:f.elements.search.checked,schedule:schedule,enabled:task?task.enabled:true},credentials));if(kind==='home')await refreshHome();else await schedules(taskScope);notice('定时任务已保存');});
      taskFields();
    }
    function localDateTime(at){var d=new Date(at);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')+'T'+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');}
    function taskFields(){var f=dialog.querySelector('form'),frequency=f.elements.frequency;if(!frequency)return;dialog.querySelectorAll('[data-recurring]').forEach(function(x){x.hidden=frequency.value==='once';x.querySelectorAll('input').forEach(function(i){i.required=frequency.value!=='once';});});dialog.querySelector('[data-weekly]').hidden=frequency.value!=='weekly';dialog.querySelectorAll('[data-once]').forEach(function(x){x.hidden=frequency.value!=='once';});f.elements.at.required=frequency.value==='once';}
    dialog.addEventListener('change',function(ev){if(ev.target.name==='frequency')taskFields();});
    function taskDetails(t){
      openForm(t.name,'<p>'+e(scheduleLabel(t.schedule))+'</p><p>'+e(t.prompt)+'</p><p>状态：'+(t.status==='running'?'正在执行':!t.enabled?'已暂停':t.status==='failed'?'上次执行失败':'已排定')+'</p>'+(t.error?'<p role="alert">'+e(t.error)+'</p>':'')+'<div class="arena-task-actions">'+button('编辑','data-task-edit="'+e(t.id)+'"')+button(t.enabled?'暂停':'启用','data-task-toggle="'+e(t.id)+'"')+button('立即执行','data-task-run="'+e(t.id)+'"')+button('删除','data-task-delete="'+e(t.id)+'"','danger')+'</div><h3>执行记录</h3>'+(t.history.length?t.history.map(function(h){return '<div class="arena-task-history"><span>'+date(h.at,t.schedule.timeZone)+' · '+(h.status==='completed'?'完成':'失败')+'</span>'+(h.error?'<p>'+e(h.error)+'</p>':'')+(h.chatId?button('查看结果','data-task-result="'+e(h.chatId)+'" data-scope="'+e(t.projectId||'')+'"'):'')+'</div>';}).join(''):'<p>暂无执行记录</p>'),null);dialog.querySelector('footer').hidden=true;
    }
    dialog.addEventListener('click',async function(ev){var b=ev.target.closest('button');if(!b)return;try{
      if(b.dataset.taskResult){dialog.close();hide();await app.openChat(b.dataset.scope||null,b.dataset.taskResult);return;}
      var id=b.dataset.taskEdit||b.dataset.taskToggle||b.dataset.taskRun||b.dataset.taskDelete;if(!id)return;var task=tasks.find(function(t){return t.id===id;});if(!task)return;
      if(b.dataset.taskEdit)return taskEditor(task);
      if(b.dataset.taskDelete){return openForm('删除定时任务','<p>删除任务后不再执行，已生成的对话会保留。</p>',async function(){await app.scheduleApi('delete',Object.assign({id:id},auth()));if(kind==='home')await refreshHome();else await schedules(taskScope);});}
      b.disabled=true;await app.scheduleApi(b.dataset.taskRun?'run':'toggle',Object.assign({id:id,enabled:!task.enabled},auth()));dialog.close();if(kind==='home')await refreshHome();else await schedules(taskScope);notice(b.dataset.taskRun?'任务已排入执行':'任务状态已保存');
    }catch(err){error(err.message);b.disabled=false;}});
    page.addEventListener('keydown',function(ev){if(ev.target.hasAttribute('data-task-tab')&&['ArrowLeft','ArrowRight','Home','End'].includes(ev.key)){ev.preventDefault();taskTab=ev.key==='Home'?'mine':ev.key==='End'?'templates':taskTab==='mine'?'templates':'mine';renderTasks();page.querySelector('[data-task-tab="'+taskTab+'"]').focus();}});
    page.addEventListener('input',function(ev){var t=ev.target;if(t.hasAttribute('data-chat-search')){var q=t.value.toLocaleLowerCase();page.querySelector('[data-project-chats]').innerHTML=chatRows(chats.filter(function(c){return c.title.toLocaleLowerCase().includes(q);}));}
      if(t.hasAttribute('data-project-search')){projectSearch=t.value;var position=t.selectionStart;paintList(projectsForView());var search=page.querySelector('[data-project-search]');search.focus();if(search.type!=='search')search.setSelectionRange(position,position);}
      if(t.hasAttribute('data-task-search')){taskSearch=t.value;renderTasks();page.querySelector('[data-task-search]').focus();}
    });
    page.addEventListener('change',function(ev){if(ev.target.hasAttribute('data-task-filter')){taskFilter=ev.target.value;renderTasks();return;}if(ev.target.hasAttribute('data-task-sort')){taskSort=ev.target.value;renderTasks();return;}if(ev.target.hasAttribute('data-project-sort')){sort=ev.target.value;list();}});
    page.addEventListener('click',async function(ev){var b=ev.target.closest('button');if(!b)return;try{
      if(b.hasAttribute('data-list')){archived=false;deleted=false;projectSearch='';return list();}if(b.hasAttribute('data-general')){hide();return app.switchScope(null);}
      if(b.hasAttribute('data-archive-toggle')){archived=!archived;deleted=false;projectSearch='';return list();}
      if(b.hasAttribute('data-trash-toggle')){deleted=!deleted;archived=false;projectSearch='';return list();}
      if(b.hasAttribute('data-new-project'))return createProject();
      if(b.dataset.openProject)return enter(b.dataset.openProject);
      if(b.dataset.home)return home(b.dataset.home,false);
      if(b.dataset.restore){var p=projectsForView().find(function(p){return p.id===b.dataset.restore;});if(!p)return;b.disabled=true;try{return await restoreProject(p);}finally{b.disabled=false;}}
      if(b.dataset.pinProject)return togglePin(b.dataset.pinProject);
      if(b.hasAttribute('data-project-menu'))return projectMenu(projectsForView().find(function(p){return p.id===(b.dataset.projectMenu||current?.id);})||current,b);
      if(b.dataset.editField)return editField(b.dataset.editField);
      if(b.hasAttribute('data-context-menu'))return contextMenu(b);
      if(b.hasAttribute('data-folder')){folder.click();return;}
      if(b.hasAttribute('data-materials'))return legacy.materials();
      if(b.dataset.preview)return legacy.preview(b.dataset.preview,current.id);
      if(b.dataset.removeFile){var id=b.dataset.removeFile,p=current;return openForm('移除项目资料','<p>移除后，本项目的后续消息不再使用这份资料。可以在“管理资料”中恢复。</p>',async function(){await app.api('remove_file',Object.assign({projectId:p.id,fileId:id},auth()));await refreshHome();});}
      if(b.dataset.openChat){hide();return app.openChat(current.id,b.dataset.openChat);}
      if(b.dataset.chatMenu)return chatMenu(chats.find(function(c){return c.id===b.dataset.chatMenu;}),current.id,b);
      if(b.hasAttribute('data-new-chat')){hide();await app.newChat();return;}
      if(b.hasAttribute('data-schedules'))return schedules(current?.id);
      if(b.hasAttribute('data-new-task'))return taskEditor();
      if(b.dataset.task)return taskDetails(tasks.find(function(t){return t.id===b.dataset.task;}));
      if(b.hasAttribute('data-template'))return taskEditor(null,templates[Number(b.dataset.template)]);
      if(b.dataset.taskTab){taskTab=b.dataset.taskTab;return renderTasks();}
    }catch(err){error(err.message);}});
    // Sidebar destinations are global. Project-home actions keep their own scope.
    var replayingNavigation=false;
    ['aaNewBtn','aaBarChatBtn','aaBarDebateBtn','aaBarImageBtn','aaProjectExit'].forEach(function(id){
      var destination=host.querySelector('#'+id);
      destination.addEventListener('click',function(ev){
        if(replayingNavigation)return;
        ev.preventDefault();ev.stopImmediatePropagation();
        if(app.busy()){notice('回答完成后可以切换对话');return;}
        hide();var n=epoch,owner=key();
        Promise.resolve(app.switchScope(null)).then(function(switched){
          if(switched===false||n!==epoch||owner!==key()||app.busy()||(app.currentScope&&app.currentScope()))return;
          if(id==='aaProjectExit')return;
          replayingNavigation=true;
          try{destination.click();}finally{replayingNavigation=false;}
        }).catch(function(err){notice(err.message||'切换失败，请重试');});
      },true);
    });
    return Object.assign({},legacy,{list:function(){archived=false;deleted=false;projectSearch='';return list();},enter:enter,home:function(){var p=app.currentProject();return p?home(p.id,true):list();},hide:hide,preload:loadPins,syncScope:syncScope,schedules:function(){return schedules();},chatMenu:chatMenu,chooseProject:chooseProject,refresh:refreshHome,visible:function(){return !page.hidden;}});
  };
})(window);
