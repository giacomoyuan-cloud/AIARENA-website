(function(root){
  'use strict';
  function escape(value){return String(value||'').replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function install(options){
    var catalog=root.ArenaSkillCatalog||[],files=[],pending=[],epochs={},sequence=0;
    function fileScope(){var a=options.auth();return String(a.username||a.user||'').toLowerCase()+':'+options.scope();}
    function key(){var a=options.auth();return 'aa-skills-v2:'+String(a.username||a.user||'').toLowerCase()+':'+options.scope()+':'+options.mode();}
    function settings(){
      try{var value=JSON.parse(localStorage.getItem(key())||'null');if(value&&['auto','manual','off'].indexOf(value.mode)!==-1)return {mode:value.mode,ids:(value.ids||[]).filter(function(id){return catalog.some(function(s){return s.id===id;});}).slice(0,3)};}catch(e){}
      return {mode:'auto',ids:[]};
    }
    function set(value){localStorage.setItem(key(),JSON.stringify(value));update();if(options.selectionChanged)options.selectionChanged(value);}
    function update(){
      var value=settings(),skill=catalog.find(function(s){return s.id===value.ids[0];});
      document.getElementById('aaSkillsBtn').textContent=value.mode==='manual'&&skill?skill.name:'Skills · '+(value.mode==='off'?'关闭':'自动');
      document.getElementById('aaSkillsBtn').classList.toggle('unlocked',value.mode==='manual');
      document.getElementById('aaSkillPill').hidden=value.mode!=='manual'||!skill;
      document.getElementById('aaSkillPillName').textContent=skill?skill.name:'';
    }
    function render(){
      var value=settings(),drop=document.getElementById('aaSkillsDrop');
      var h='<div class="arena-skills-heading">按任务调用 Skills</div><p class="arena-skills-hint">文档和计算仅支持 Claude，选择后会切换兼容模型；自动识别后会显示实际执行模型。</p>';
      [{mode:'auto',name:'自动识别任务'},{mode:'off',name:'关闭技能，普通对话'}].forEach(function(item){h+='<button type="button" class="aa-drop-item arena-skill-option" data-skill-mode="'+item.mode+'" aria-pressed="'+(value.mode===item.mode)+'">'+(value.mode===item.mode?'✓ ':'')+item.name+'</button>';});
      h+='<div class="arena-skills-heading">手动指定</div>';
      catalog.filter(function(s){return options.mode()!=='debate'||['document','compute'].indexOf(s.kind)===-1;}).forEach(function(skill){
        var selected=value.mode==='manual'&&value.ids.indexOf(skill.id)!==-1;
        h+='<button type="button" class="aa-drop-item arena-skill-option" data-skill-id="'+skill.id+'" aria-pressed="'+selected+'"><span>'+escape(skill.name)+(skill.official?' <small>官方文档 · 仅 Claude</small>':skill.kind==='compute'?' <small>仅 Claude</small>':'')+'</span><small>'+escape(skill.description)+'</small></button>';
      });
      drop.innerHTML=h;
      drop.querySelectorAll('[data-skill-mode]').forEach(function(button){button.onclick=function(){set({mode:button.dataset.skillMode,ids:[]});drop.classList.remove('open');};});
      drop.querySelectorAll('[data-skill-id]').forEach(function(button){button.onclick=function(){set({mode:'manual',ids:[button.dataset.skillId]});drop.classList.remove('open');};});
    }
    function activate(id){if(!catalog.some(function(s){return s.id===id;}))return;set({mode:'manual',ids:[id]});}
    function capture(file){
      if(!/\.(pdf|docx|pptx|xlsx|xls|csv|tsv|txt|md|json)$/i.test(file.name))return;
      var scope=fileScope(),entry={scope:scope,epoch:epochs[scope]||0},order=++sequence;
      var task=file.arrayBuffer().then(function(buffer){
        var scope=entry.scope;
        if((epochs[scope]||0)!==entry.epoch)return;
        if(buffer.byteLength>8*1024*1024)throw Error('官方文档处理单个文件最多 8MB');
        var bytes=new Uint8Array(buffer),binary='';for(var i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode.apply(null,bytes.subarray(i,i+32768));
        if(files.some(function(f){return f.scope===scope&&f.name===file.name&&f.order>order;}))return;
        files=files.filter(function(f){return f.scope!==scope||f.name!==file.name;});files.push({scope:scope,order:order,name:file.name,mime:file.type||'application/octet-stream',size:bytes.length,data:btoa(binary)});
      });entry.task=task;pending.push(entry);task.catch(function(error){options.notice(error.message);});
    }
    async function ready(){var scope=fileScope(),tasks=pending.filter(function(p){return p.scope===scope;});try{await Promise.all(tasks.map(function(p){return p.task;}));}finally{pending=pending.filter(function(p){return tasks.indexOf(p)===-1;});}}
    function filesForTexts(texts){var scope=fileScope();return files.filter(function(file){return file.scope===scope&&texts.some(function(text){return text.indexOf('[文件: '+file.name+']')===0;});}).map(function(file){return {name:file.name,mime:file.mime,size:file.size,data:file.data};});}
    function clear(){var scope=fileScope();epochs[scope]=(epochs[scope]||0)+1;files=files.filter(function(f){return f.scope!==scope;});pending=pending.filter(function(p){return p.scope!==scope;});}
    function migrateAccount(from,to){
      from=String(from||'').trim().toLowerCase();to=String(to||'').trim().toLowerCase();
      if(!from||!to||from===to)return;
      var prefix='aa-skills-v2:'+from+':',keys=[];
      for(var i=0;i<localStorage.length;i++){var name=localStorage.key(i);if(name&&name.indexOf(prefix)===0)keys.push(name);}
      keys.forEach(function(name){localStorage.setItem('aa-skills-v2:'+to+':'+name.slice(prefix.length),localStorage.getItem(name));});
      files.forEach(function(file){if(file.scope.indexOf(from+':')===0)file.scope=to+file.scope.slice(from.length);});
      pending.forEach(function(entry){if(entry.scope.indexOf(from+':')!==0)return;var old=entry.scope,next=to+old.slice(from.length);entry.epoch=entry.epoch===(epochs[old]||0)?(epochs[next]||0):-1;entry.scope=next;});
    }
    function artifacts(message){
      if(!message.artifacts||!message.artifacts.length)return '';
      return '<div class="arena-skill-files" aria-label="生成的文件">'+message.artifacts.map(function(file,index){return '<div class="arena-skill-file"><span>'+escape(file.name)+'</span><small>Claude 官方 Skills'+(file.size?' · '+Math.ceil(file.size/1024)+' KB':'')+'</small><button type="button" data-skill-file="'+index+'" data-skill-message="'+message.uid+'"'+(file.deleted||file.unavailable?' disabled':'')+'>'+(file.deleted?'已删除':file.unavailable?'文件不可用':'下载')+'</button><button type="button" class="arena-skill-delete" data-skill-delete="'+index+'" data-skill-message="'+message.uid+'" aria-label="删除生成文件 '+escape(file.name)+'"'+(file.deleted||file.unavailable?' disabled':'')+'>删除文件</button></div>';}).join('')+'</div>';
    }
    document.getElementById('aaMessages').addEventListener('click',async function(event){
      var button=event.target.closest('[data-skill-file],[data-skill-delete]');if(!button)return;
      var message=options.messages().find(function(m){return String(m.uid)===button.dataset.skillMessage;});
      var deleting=button.dataset.skillDelete!==undefined,index=Number(deleting?button.dataset.skillDelete:button.dataset.skillFile),file=message&&message.artifacts&&message.artifacts[index];if(!file||file.deleted||file.unavailable)return;
      button.disabled=true;
      try{
        var body=Object.assign({},options.auth(),{projectId:options.scope()==='general'?null:options.scope(),action:deleting?'delete':'download',token:file.token});
        var response=await fetch(options.worker()+'/skill-files',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
        if(!response.ok){var error=await response.json().catch(function(){return {};});throw Error(error.error||'文件操作失败');}
        if(deleting){file.deleted=true;options.changed();return;}
        var blob=await response.blob(),url=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=url;anchor.download=file.name;document.body.appendChild(anchor);anchor.click();anchor.remove();setTimeout(function(){URL.revokeObjectURL(url);},60000);
      }catch(error){options.notice(error.message);}finally{if(!file.deleted)button.disabled=false;}
    });
    return {settings:settings,update:update,render:render,activate:activate,automatic:function(){set({mode:'auto',ids:[]});},capture:capture,ready:ready,filesForTexts:filesForTexts,clear:clear,artifacts:artifacts,migrateAccount:migrateAccount};
  }
  root.ArenaSkills={install:install};
})(typeof window!=='undefined'?window:globalThis);
