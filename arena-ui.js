/* Shared page-level interaction policy. Native form values remain authoritative. */
(function(root){
  'use strict';
  function taskState(task){
    if(task.queued)return '已排队';
    if(task.status==='running')return '正在执行';
    if(!task.enabled)return '已暂停';
    return {completed:'已完成',failed:'上次执行失败',cancelled:'已停止'}[task.status]||'已排定';
  }
  function mount(app){
    var doc=app.ownerDocument,bindings=new Map(),queued=false;
    function scan(){
      queued=false;
      bindings.forEach(function(binding,select){if(!select.isConnected){binding.destroy();bindings.delete(select);}else binding.sync();});
      app.querySelectorAll('[data-project-sort],[data-task-filter],[data-task-sort],.arena-project-form-body select,.arena-workspace-dialog select,.arena-public-page select').forEach(function(select){
        if(bindings.has(select)||select.multiple||select.hidden||select.style.display==='none')return;
        var nativeLabel=select.labels&&select.labels[0];
        var label=select.getAttribute('aria-label')||(nativeLabel&&Array.from(nativeLabel.childNodes).filter(function(node){return node.nodeType===3;}).map(function(node){return node.textContent;}).join('').trim())||'选择选项';
        var wrap=doc.createElement('span');wrap.className='arena-select-field';select.after(wrap);
        var binding=root.ArenaControls.mountSelect({host:app,container:wrap,label:label,onChange:function(value){select.value=value;select.dispatchEvent(new Event('input',{bubbles:true}));select.dispatchEvent(new Event('change',{bubbles:true}));}});
        function sync(){binding.update({value:select.value,disabled:select.disabled,options:Array.from(select.options,function(option){return {value:option.value,label:option.label,disabled:option.disabled||option.parentElement.disabled};})});wrap.hidden=select.hidden;}
        function invalid(event){event.preventDefault();binding.trigger.setAttribute('aria-invalid','true');binding.trigger.focus();}
        function change(){binding.trigger.removeAttribute('aria-invalid');sync();}
        var oldAriaHidden=select.getAttribute('aria-hidden'),oldTabIndex=select.getAttribute('tabindex');
        select.classList.add('arena-select-source');select.tabIndex=-1;select.setAttribute('aria-hidden','true');
        select.addEventListener('change',change);select.addEventListener('invalid',invalid);
        var destroy=binding.destroy;
        binding.sync=sync;binding.destroy=function(){select.removeEventListener('change',change);select.removeEventListener('invalid',invalid);destroy();wrap.remove();select.classList.remove('arena-select-source');if(oldTabIndex===null)select.removeAttribute('tabindex');else select.setAttribute('tabindex',oldTabIndex);if(oldAriaHidden===null)select.removeAttribute('aria-hidden');else select.setAttribute('aria-hidden',oldAriaHidden);};
        bindings.set(select,binding);sync();
      });
      // A dialog owns its focus trap. The shared listbox uses the top layer but
      // is portaled back inside the owning dialog, so keyboard focus stays legal.
      app.querySelectorAll('dialog').forEach(function(dialog){
        var title=dialog.querySelector('h1,h2');
        if(title&&!dialog.hasAttribute('aria-label')){if(!title.id)title.id='arenaDialogTitle'+(++mount.serial);dialog.setAttribute('aria-labelledby',title.id);}
      });
    }
    var observer=new MutationObserver(function(records){
      if(records.every(function(r){return r.target.closest&&r.target.closest('.arena-select-popover,.arena-select-field');}))return;
      if(!queued){queued=true;queueMicrotask(scan);}
    });
    observer.observe(app,{childList:true,subtree:true,attributes:true,attributeFilter:['disabled','selected','hidden']});
    scan();
    return function(){observer.disconnect();bindings.forEach(function(b){b.destroy();});bindings.clear();};
  }
  mount.serial=0;
  var api={mount:mount,taskState:taskState};
  if(typeof module==='object'&&module.exports)module.exports=api;
  else {root.ArenaUi=api;var start=function(){var app=document.getElementById('ai-arena-app')||document.querySelector('body.arena-public-page');if(app)mount(app);};if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();}
})(typeof window==='undefined'?globalThis:window);
