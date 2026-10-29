/* Model and reasoning controls share one presentation in chat and debate. */
(function(root,factory){
  var api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;else root.ArenaModelControl=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  var serial=0,active=null;
  var arrow='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>';
  var check='<svg class="arena-model-check" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>';
  function escape(value){return String(value==null?'':value).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function effortHTML(options){
    var prefix=options.prefix||'aa',levels=options.levels||[],index=levels.indexOf(options.value),labels=options.labels||{},descriptions=options.descriptions||{};
    if(index<0)index=0;
    var level=levels[index],name=labels[level]||level||'选择模型';
    var h='<div class="arena-effort-heading"><output id="'+prefix+'EffortValue" for="'+prefix+'EffortSlider" aria-live="polite">'+escape(name)+'</output>'
      +'<button type="button" class="arena-effort-reset" id="'+prefix+'ResetEffortBtn" data-model-effort-reset aria-label="恢复默认思考强度" title="恢复默认思考强度"'+(levels.length?'':' hidden')+'><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 10a9 9 0 1 1 1.7 7M3 4v6h6"/></svg></button></div>'
      +'<button type="button" class="arena-effort-model" id="'+prefix+'ModelPickerBtn" data-model-picker aria-haspopup="dialog"><span>'+escape(options.modelLabel||'选择模型')+'</span>'+arrow+'</button>';
    if(levels.length){
      h+='<div class="arena-effort-scale" id="'+prefix+'EffortScale" style="--effort-progress:'+(levels.length>1?index/(levels.length-1)*100:0)+'%"><div class="arena-effort-track" aria-hidden="true"><div class="arena-effort-fill"></div></div><div class="arena-effort-thumb" aria-hidden="true"><span><i class="arena-effort-halo"></i></span></div><div class="arena-effort-ticks" aria-hidden="true">';
      levels.forEach(function(value,i){h+='<span'+(i<=index?' class="is-filled"':'')+' style="left:'+(levels.length>1?i/(levels.length-1)*100:0)+'%"></span>';});
      h+='</div><label class="arena-sr-only" for="'+prefix+'EffortSlider">'+escape(options.effortLabel||'思考强度')+'</label><input id="'+prefix+'EffortSlider" type="range" min="0" max="'+(levels.length-1)+'" step="1" value="'+index+'" class="arena-effort-input" data-effort-model="'+escape(options.model)+'" aria-valuetext="'+escape(name)+'" aria-describedby="'+prefix+'EffortDescription"><p class="arena-sr-only" id="'+prefix+'EffortDescription">'+escape(descriptions[level]||'')+'</p></div>';
      h+='<div class="arena-effort-ends" aria-hidden="true"><span>'+escape(labels[levels[0]]||levels[0])+'</span><span>'+escape(labels[levels[levels.length-1]]||levels[levels.length-1])+'</span></div>';
    }
    return h;
  }
  function choicesHTML(options){
    return '<div class="arena-model-picker-heading"><span>'+escape(options.label||'选择模型')+'</span>'+(options.back?'<button type="button" data-arena-model-back aria-label="返回思考强度">'+arrow+'</button>':'')+'</div>'
      +(options.items||[]).map(function(item){return '<button type="button" class="arena-model-option" data-arena-model="'+escape(item.value)+'" aria-pressed="'+(item.value===options.value)+'"'+(item.disabled?' disabled':'')+'><span>'+escape(item.label)+'</span>'+check+'</button>';}).join('');
  }
  function mount(options){
    var host=options.host,doc=host.ownerDocument,win=doc.defaultView,prefix='arenaModel'+(++serial);
    var trigger=options.trigger||doc.createElement('button'),popup=doc.createElement('div');
    var state={value:'',options:[],levels:[],disabled:false},opened=false,view='models',structure='',effortControl=null;
    if(!options.trigger){trigger.type='button';trigger.className='arena-select-trigger arena-model-control';options.container.appendChild(trigger);}
    trigger.setAttribute('aria-haspopup','dialog');trigger.setAttribute('aria-expanded','false');trigger.setAttribute('aria-controls',prefix+'Popover');
    popup.id=prefix+'Popover';popup.hidden=true;popup.setAttribute('popover','manual');popup.setAttribute('role','dialog');popup.setAttribute('aria-label',options.label+'与思考深度');host.appendChild(popup);
    function selected(){return state.options.find(function(item){return item.value===state.value;});}
    function renderTrigger(){
      var item=selected(),name=item?item.label:(options.placeholder||'选择模型'),level=state.labels&&state.labels[state.effort]||state.effort;
      trigger.disabled=!!state.disabled;
      trigger.setAttribute('aria-label',options.label+'：'+name+(state.levels.length&&level?'，思考深度：'+level:''));
      if(options.renderLabel)options.renderLabel(state.value,item,state);
      else trigger.innerHTML='<span class="arena-model-control-name">'+escape(name)+'</span>'+(state.levels.length&&level?'<span class="arena-model-control-depth">'+escape(level)+'</span>':'')+'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg>';
      trigger.classList.toggle('is-placeholder',!state.value);
    }
    function position(){
      if(!opened)return;
      if(!trigger.isConnected||!trigger.getClientRects().length){close(false);return;}
      var rect=trigger.getBoundingClientRect(),viewport=win.visualViewport,edge=10,left=viewport?viewport.offsetLeft:0,top=viewport?viewport.offsetTop:0,width=viewport?viewport.width:win.innerWidth,height=viewport?viewport.height:win.innerHeight;
      for(var parent=trigger.parentElement;parent&&parent!==host;parent=parent.parentElement){
        if(/auto|scroll|hidden/.test(win.getComputedStyle(parent).overflowY)){var bounds=parent.getBoundingClientRect();if(rect.bottom<=bounds.top||rect.top>=bounds.bottom){close(false);return;}}
      }
      var popupWidth=Math.min(290,width-edge*2),above=rect.top-top-edge,below=top+height-rect.bottom-edge;
      popup.style.width=popupWidth+'px';popup.style.left=Math.max(left+edge,Math.min(rect.left,left+width-popupWidth-edge))+'px';
      var up=below<Math.min(popup.scrollHeight,310)&&above>below;
      popup.style.maxHeight=Math.max(80,Math.min(400,(up?above:below)-6))+'px';
      popup.style.top=(up?Math.max(top+edge,rect.top-popup.offsetHeight-6):rect.bottom+6)+'px';
    }
    function listen(add){
      var method=add?'addEventListener':'removeEventListener';
      doc[method]('pointerdown',outside,true);doc[method]('focusin',outside);doc[method]('scroll',onScroll,true);win[method]('resize',position);
      if(win.visualViewport){win.visualViewport[method]('resize',position);win.visualViewport[method]('scroll',position);}
    }
    function outside(event){if(!trigger.contains(event.target)&&!popup.contains(event.target))close(false);}
    function onScroll(event){if(!popup.contains(event.target))position();}
    function close(restore){
      if(!opened)return;
      opened=false;listen(false);
      if(effortControl){effortControl.destroy();effortControl=null;}
      if(popup.matches(':popover-open'))popup.hidePopover();popup.hidden=true;trigger.setAttribute('aria-expanded','false');
      if(active===control)active=null;
      if(restore&&trigger.isConnected)trigger.focus({preventScroll:true});
    }
    function syncEffort(){
      var input=popup.querySelector('input[type="range"]');if(!input)return;
      var index=state.levels.indexOf(state.effort);if(index<0)index=0;
      var level=state.levels[index],label=state.labels&&state.labels[level]||level;
      input.value=String(index);input.disabled=!!state.disabled;input.setAttribute('aria-valuetext',label);
      popup.querySelector('output').textContent=label;popup.querySelector('.arena-sr-only[id]').textContent=state.descriptions&&state.descriptions[level]||'';
      popup.querySelector('[data-model-effort-reset]').hidden=level===state.defaultEffort;
      var scale=popup.querySelector('.arena-effort-scale');scale.style.setProperty('--effort-progress',(state.levels.length>1?index/(state.levels.length-1)*100:0)+'%');
      scale.querySelectorAll('.arena-effort-ticks > span').forEach(function(tick,i){tick.classList.toggle('is-filled',i<=index);});
      if(effortControl)effortControl.sync();
    }
    function render(){
      if(effortControl){effortControl.destroy();effortControl=null;}
      popup.className='arena-model-popover arena-model-control-popover '+(view==='effort'?'arena-effort-popover':'arena-model-picker');
      if(view==='effort'){
        popup.innerHTML=effortHTML({prefix:prefix,model:state.value,modelLabel:selected()&&selected().label,levels:state.levels,value:state.effort,labels:state.labels,descriptions:state.descriptions,effortLabel:options.label+'的思考深度'});
        if(win.ArenaEffort)effortControl=win.ArenaEffort.mount(popup.querySelector('.arena-effort-scale'));
        syncEffort();
      }else popup.innerHTML=choicesHTML({label:options.label,value:state.value,items:state.options,back:!!state.levels.length});
      position();
    }
    function show(next,focus){
      if(state.disabled)return;
      if(!opened){
        if(active)active.close(false);
        if(win.ArenaControls)win.ArenaControls.closeSelect();
        if(options.beforeOpen)options.beforeOpen();
        opened=true;active=control;popup.hidden=false;
        if(popup.showPopover)popup.showPopover();
        trigger.setAttribute('aria-expanded','true');listen(true);
      }
      view=next;render();
      if(focus){var target=view==='effort'?popup.querySelector('input[type="range"]'):popup.querySelector('[aria-pressed="true"]')||popup.querySelector('[data-arena-model]:not(:disabled)');if(target)target.focus({preventScroll:true});}
    }
    function open(){show(state.levels.length?'effort':'models',true);}
    function changeEffort(level){
      if(state.disabled||state.levels.indexOf(level)===-1)return;
      state.effort=level;syncEffort();renderTrigger();options.onEffort(level);
    }
    trigger.addEventListener('click',function(event){event.stopPropagation();if(opened)close(true);else open();});
    trigger.addEventListener('keydown',function(event){if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();show('models',true);}});
    popup.addEventListener('input',function(event){if(event.target.type==='range'){var index=Number(event.target.value);if(Number.isInteger(index))changeEffort(state.levels[index]);}});
    popup.addEventListener('click',function(event){
      if(event.target.closest('[data-model-picker]')){show('models',true);return;}
      if(event.target.closest('[data-arena-model-back]')){show('effort',true);return;}
      if(event.target.closest('[data-model-effort-reset]')){changeEffort(state.defaultEffort);var input=popup.querySelector('input');if(input)input.focus({preventScroll:true});return;}
      var button=event.target.closest('[data-arena-model]');if(!button||button.disabled||state.disabled)return;
      var id=button.dataset.arenaModel;options.onChange(id);
      if(state.value===id&&state.levels.length)show('effort',true);else close(true);
    });
    popup.addEventListener('keydown',function(event){
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close(true);return;}
      if(view==='models'&&event.key==='ArrowLeft'&&state.levels.length){event.preventDefault();show('effort',true);return;}
      if(event.target.closest('[data-model-picker]')&&(event.key==='ArrowDown'||event.key==='ArrowRight')){event.preventDefault();show('models',true);return;}
      if(view!=='models')return;
      var buttons=Array.from(popup.querySelectorAll('[data-arena-model]:not(:disabled)')),index=buttons.indexOf(doc.activeElement),next;
      if(event.key==='ArrowDown'||event.key==='ArrowUp')next=(index+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length;
      if(event.key==='Home')next=0;if(event.key==='End')next=buttons.length-1;
      if(next!==undefined&&buttons[next]){event.preventDefault();buttons[next].focus();}
    });
    var control={
      update:function(next){
        state=Object.assign({},state,next);renderTrigger();
        var signature=JSON.stringify([state.value,state.options,state.levels]);
        if(opened){if(state.disabled)close(false);else if(signature!==structure){if(!state.levels.length)view='models';render();}else syncEffort();}
        structure=signature;
      },
      open:open,close:close,trigger:trigger,
      destroy:function(){close(false);popup.remove();if(!options.trigger)trigger.remove();}
    };
    control.update(options);return control;
  }
  return {effortHTML:effortHTML,choicesHTML:choicesHTML,mount:mount,closeAll:function(){if(active)active.close(false);}};
});
