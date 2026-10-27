/* Native dialogs keep project management keyboard-accessible without a framework. */
(function(root){
  'use strict';
  var e=function(value){return root.ArenaMarkdown.escape(String(value||''));};
  var loaded={};
  function library(name,url){
    if(root[name])return Promise.resolve(root[name]);
    if(loaded[name])return loaded[name];
    loaded[name]=new Promise(function(resolve,reject){var script=document.createElement('script');script.src=url;script.onload=function(){resolve(root[name]);};script.onerror=function(){delete loaded[name];reject(new Error('文件解析工具加载失败，请重试'));};document.head.appendChild(script);});
    return loaded[name];
  }
  function base64(file){
    return new Promise(function(resolve,reject){var reader=new FileReader();reader.onerror=function(){reject(new Error('文件读取失败'));};reader.onload=function(){resolve(String(reader.result).split(',')[1]||'');};reader.readAsDataURL(file);});
  }
  async function readFile(file){
    if(file.size>8*1024*1024)throw new Error('单份资料上限 8 MB');
    var ext=file.name.split('.').pop().toLowerCase(),buffer=await file.arrayBuffer(),text='';
    if(['txt','md','csv','tsv','json','log'].indexOf(ext)>=0)text=new TextDecoder().decode(buffer);
    else if(ext==='docx'){
      var mammoth=await library('mammoth','https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js');
      text=(await mammoth.extractRawText({arrayBuffer:buffer})).value;
    }else if(ext==='pdf'){
      var pdfjs=await library('pdfjsLib','https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js');
      pdfjs.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      var pdf=await pdfjs.getDocument({data:new Uint8Array(buffer)}).promise,parts=[];
      if(pdf.numPages>200)throw new Error('单份 PDF 最多 200 页');
      for(var i=1;i<=pdf.numPages;i++){var page=await pdf.getPage(i),content=await page.getTextContent();parts.push('[第 '+i+' 页]\n'+content.items.map(function(x){return x.str;}).join(' '));}
      text=parts.join('\n\n');await pdf.destroy();
    }else if(ext==='xlsx'||ext==='xls'){
      var xlsx=await library('XLSX','https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'),workbook=xlsx.read(buffer,{type:'array'});
      text=workbook.SheetNames.map(function(name){return '[工作表 '+name+']\n'+xlsx.utils.sheet_to_csv(workbook.Sheets[name]);}).join('\n\n');
    }else if(ext==='pptx'){
      var zipLib=await library('JSZip','https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'),zip=await zipLib.loadAsync(buffer);
      var slides=Object.keys(zip.files).filter(function(name){return /^ppt\/slides\/slide\d+\.xml$/.test(name);}).sort(function(a,b){return Number(a.match(/slide(\d+)/)[1])-Number(b.match(/slide(\d+)/)[1]);}),parts=[];
      if(slides.length>200)throw new Error('单份 PPT 最多 200 页');
      for(var i=0;i<slides.length;i++){
        var xml=await zip.file(slides[i]).async('string'),doc=new DOMParser().parseFromString(xml,'text/xml');
        parts.push('[第 '+(i+1)+' 页]\n'+Array.from(doc.getElementsByTagName('a:t')).map(function(node){return node.textContent;}).join(' '));
      }
      text=parts.join('\n\n');
    }else throw new Error('支持 TXT、Markdown、PDF、Word、Excel、PPT、CSV 和 JSON');
    if(!text.trim())throw new Error('没有提取到文字；扫描版 PDF 请先进行 OCR');
    if(text.length>400000)throw new Error('提取文字超过 40 万字，请拆分资料');
    return {name:file.name,size:file.size,type:file.type,text:text,data:await base64(file)};
  }
  function mount(app){
    var host=app.host,dialog=document.createElement('dialog'),project=null,archived=false,removed=false;
    dialog.className='arena-workspace-dialog';dialog.setAttribute('aria-label','项目');
    dialog.innerHTML='<div class="arena-dialog-heading"><h2 id="aaWorkspaceTitle">项目</h2><button type="button" class="arena-icon-btn" data-w-close aria-label="关闭项目窗口">×</button></div><div id="aaWorkspaceContent"></div>';
    host.appendChild(dialog);
    var pane=document.createElement('aside');pane.id='aaProjectFilePane';pane.className='arena-project-file-pane';pane.hidden=true;pane.setAttribute('role','dialog');pane.setAttribute('aria-label','项目资料预览');
    pane.innerHTML='<div class="arena-dialog-heading"><strong id="aaFileName"></strong><button class="arena-icon-btn" data-file-close aria-label="关闭资料预览">×</button></div><div class="arena-file-toolbar"><span id="aaFileMeta"></span><button data-file-download>下载原文件</button></div><div id="aaFilePreview" class="arena-file-preview"></div>';
    host.appendChild(pane);
    var input=document.createElement('input');input.type='file';input.multiple=true;input.hidden=true;input.accept='.txt,.md,.pdf,.docx,.xlsx,.xls,.pptx,.csv,.tsv,.json,.log';host.appendChild(input);
    var content=dialog.querySelector('#aaWorkspaceContent'),title=dialog.querySelector('#aaWorkspaceTitle'),navigationEpoch=0;
    function notify(message){app.notice(message);}
    function show(){if(!dialog.open)dialog.showModal();}
    function close(){dialog.close();}
    function error(message){var element=content.querySelector('[data-w-error]');if(element)element.textContent=message;else notify(message);}
    function setContent(label,html){title.textContent=label;content.innerHTML=html;}
    async function list(){
      if(app.busy()){notify('回答完成后可以切换项目');return;}
      project=null;setContent('项目','<p class="arena-workspace-muted">加载中…</p>');show();
      try{
        var data=await app.api('list',{includeArchived:archived});
        var cards=data.projects.map(function(p){return '<article class="arena-project-card"><button class="arena-project-open" data-project-open="'+e(p.id)+'"><strong>'+e(p.name)+'</strong><span>'+new Date(p.updatedAt).toLocaleDateString()+'</span></button>'+(archived?'<button data-project-restore="'+e(p.id)+'">恢复项目</button>':'<button class="arena-project-card-more" data-project-settings="'+e(p.id)+'" aria-label="项目设置：'+e(p.name)+'">•••</button>')+'</article>';}).join('');
        setContent(archived?'已归档项目':'项目','<div class="arena-workspace-intro"><p>每个项目拥有独立的对话、记忆和资料，与普通聊天隔离。</p><button class="arena-workspace-primary" data-project-new>新建项目</button></div><div class="arena-project-grid">'+(cards||'<div class="arena-workspace-empty">还没有'+(archived?'已归档':'')+'项目</div>')+'</div><div class="arena-workspace-footer"><button data-project-archive-toggle>'+(archived?'返回项目':'查看已归档项目')+'</button><button data-project-general>返回普通聊天</button></div>');
      }catch(err){setContent('项目','<p role="alert">'+e(err.message)+'</p>');}
    }
    async function edit(id){
      if(app.busy()){notify('回答完成后可以修改项目设置');return;}
      try{
        project=id?(await app.api('get',{projectId:id})).project:null;
        setContent(project?'项目设置':'新建项目','<form id="aaProjectForm"><label>项目名称<input name="name" maxlength="80" required value="'+e(project&&project.name)+'" placeholder="例如：产品设计"></label><label>项目说明<textarea name="instructions" rows="4" maxlength="4000" placeholder="这个项目的目标、背景和回复要求">'+e(project&&project.instructions)+'</textarea></label>'+(project?'<label>项目记忆<textarea name="memory" rows="4" maxlength="2400" placeholder="仅在本项目对话之间共享">'+e(project.memory)+'</textarea></label>':'')+'<p class="arena-workspace-muted">普通聊天及其他项目不会读取这里的记忆。</p><p data-w-error role="alert"></p><div class="arena-workspace-footer">'+(project?'<button type="button" data-project-archive="'+e(project.id)+'">归档项目</button>':'<button type="button" data-project-back>返回</button>')+'<button type="submit" class="arena-workspace-primary">保存'+(project?'':'并进入')+'</button></div></form>');show();content.querySelector('input').focus();
      }catch(err){error(err.message);}
    }
    async function enter(id){
      if(app.busy()){notify('回答完成后可以切换项目');return;}
      var epoch=++navigationEpoch;
      try{var data=await app.api('get',{projectId:id});if(epoch!==navigationEpoch)return;await app.switchScope(data.project);close();}
      catch(err){error(err.message);}
    }
    async function materials(){
      var current=app.currentProject();if(!current)return list();
      try{
        project=(await app.api('get',{projectId:current.id})).project;
        var files=removed?(await app.api('removed_files',{projectId:project.id})).files:project.files;
        setContent((removed?'已移除资料 · ':'项目资料 · ')+project.name,'<div class="arena-workspace-intro"><p>按问题检索相关片段，未命中的资料不会发送给模型。</p>'+(!removed?'<button class="arena-workspace-primary" data-file-upload>上传资料</button>':'')+'</div><p class="arena-workspace-muted">Word、PDF、Excel、PPT、文本等；单份 8 MB，最多 15 份。扫描 PDF 需先提取文字。</p><div class="arena-project-file-list">'+(files.map(function(file){return '<div class="arena-project-file-row"><button data-file-preview="'+e(file.id)+'"><strong>'+e(file.name)+'</strong><span>'+Math.ceil(file.size/1024)+' KB · '+file.characters.toLocaleString()+' 字符</span></button><button '+(removed?'data-file-restore':'data-file-remove')+'="'+e(file.id)+'">'+(removed?'恢复':'移除')+'</button></div>';}).join('')||'<div class="arena-workspace-empty">暂无'+(removed?'已移除':'')+'资料</div>')+'</div><p data-w-error role="alert"></p><div class="arena-workspace-footer"><button data-file-removed-toggle>'+(removed?'返回资料':'查看已移除资料')+'</button><button data-project-settings="'+e(project.id)+'">项目设置</button></div>');show();
      }catch(err){error(err.message);}
    }
    var viewedFile=null,viewedProject=null;
    async function preview(id,projectId){
      try{
        var currentId=projectId||(project&&project.id)||(app.currentProject()||{}).id;
        var data=await app.api('preview',{projectId:currentId,fileId:id});
        viewedFile=data.file;viewedProject=currentId;
        pane.querySelector('#aaFileName').textContent=data.file.name;
        pane.querySelector('#aaFileMeta').textContent=data.file.previewTruncated?'预览前 6 万字符，可下载完整原文件':'项目资料 · '+data.file.characters.toLocaleString()+' 字符';
        pane.querySelector('#aaFilePreview').textContent=data.file.text;
        pane.hidden=false;host.classList.add('arena-file-open');close();
        pane.querySelector('[data-file-close]').focus();
      }catch(err){error(err.message);}
    }
    dialog.querySelector('[data-w-close]').addEventListener('click',close);
    dialog.addEventListener('click',async function(event){
      var target=event.target.closest('button');if(!target)return;
      try{
        if(target.hasAttribute('data-project-new'))return edit(null);
        if(target.dataset.projectOpen)return enter(target.dataset.projectOpen);
        if(target.dataset.projectSettings)return edit(target.dataset.projectSettings);
        if(target.hasAttribute('data-project-back'))return list();
        if(target.hasAttribute('data-project-archive-toggle')){archived=!archived;return list();}
        if(target.hasAttribute('data-project-general')){await app.switchScope(null);return close();}
        if(target.dataset.projectArchive){
          if(app.busy()){notify('回答完成后可以归档项目');return;}
          await app.api('archive',{projectId:target.dataset.projectArchive});
          if(app.currentProject()&&app.currentProject().id===target.dataset.projectArchive)await app.switchScope(null);
          return list();
        }
        if(target.dataset.projectRestore){await app.api('archive',{projectId:target.dataset.projectRestore,archived:false});return list();}
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
        if(project){if(app.currentProject()&&app.currentProject().id===project.id)app.refreshProject(Object.assign({},project,data.project,{memory:values.memory}));close();notify('项目设置已保存');}
        else{await app.switchScope(data.project);close();}
      }catch(err){error(err.message);button.disabled=false;}
    });
    input.addEventListener('change',async function(){
      var files=Array.from(input.files||[]),current=project||app.currentProject();input.value='';
      if(!current||!files.length)return;
      var status=content.querySelector('[data-w-error]'),upload=content.querySelector('[data-file-upload]');if(upload)upload.disabled=true;
      try{
        for(var i=0;i<files.length;i++){
          if(status)status.textContent='正在提取并保存 '+files[i].name+'（'+(i+1)+'/'+files.length+'）…';
          var file=await readFile(files[i]);await app.api('upload',{projectId:current.id,file:file});
        }
        if(app.currentProject()&&app.currentProject().id===current.id){var updated=(await app.api('get',{projectId:current.id})).project;app.refreshProject(updated);}
        await materials();notify('资料已保存到本项目');
      }catch(err){error(err.message);if(upload)upload.disabled=false;}
    });
    pane.querySelector('[data-file-close]').addEventListener('click',function(){pane.hidden=true;host.classList.remove('arena-file-open');});
    pane.querySelector('[data-file-download]').addEventListener('click',async function(){
      if(!viewedFile)return;
      try{var result=await app.api('download',{projectId:viewedProject,fileId:viewedFile.id}),file=result.file,bytes=Uint8Array.from(atob(file.data),function(c){return c.charCodeAt(0);}),url=URL.createObjectURL(new Blob([bytes],{type:'application/octet-stream'})),anchor=document.createElement('a');anchor.href=url;anchor.download=file.name;anchor.click();setTimeout(function(){URL.revokeObjectURL(url);},30000);}catch(err){notify(err.message);}
    });
    return {list:list,materials:function(){removed=false;return materials();},settings:function(){var current=app.currentProject();return current?edit(current.id):list();},preview:preview,closeFile:function(){pane.hidden=true;host.classList.remove('arena-file-open');},enter:enter};
  }
  root.ArenaWorkspace={mount:mount,readFile:readFile};
})(window);
