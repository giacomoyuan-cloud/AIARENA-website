/* Shared interaction primitives. No server state or credentials are persisted here. */
(function(root,factory){
  var api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.ArenaControls=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  var serial=0,activeSelect=null;
  var pinIcon='<svg class="arena-pin-icon" viewBox="0 0 24 24" aria-hidden="true"><g transform="rotate(45 12 12)"><path d="M8 4h8a1 1 0 0 1 .7 1.7l-.7.7v3.8l2.3 2.3a1 1 0 0 1-.7 1.7H6.4a1 1 0 0 1-.7-1.7L8 10.2V6.4l-.7-.7A1 1 0 0 1 8 4Z"/><path d="M12 14.2v6"/></g></svg>';
  function createPinStore(options){
    var entries=new Map(),version=0;
    function notify(key,entry,context){if(options.onChange)options.onChange(key,entry.value,entry.pending,context);}
    async function drain(key,entry){
      entry.pending=true;
      while(true){
        var value=entry.value,revision=entry.revision,context=entry.context;
        try{
          await options.write(context,value);
          entry.confirmed=value;
        }catch(error){
          // An obsolete failure cannot undo a more recent click. Send the latest
          // absolute value even if a timed-out request might have reached the server.
          if(revision!==entry.revision)continue;
          entry.value=entry.confirmed;entry.pending=false;entry.settledVersion=++version;
          notify(key,entry,context);
          if(options.onError)options.onError(error,context);
          entry.context=null;return;
        }
        if(entry.value===entry.confirmed){
          entry.pending=false;entry.settledVersion=++version;notify(key,entry,context);entry.context=null;return;
        }
      }
    }
    return {
      version:function(){return version;},
      read:function(key,remote,readVersion){
        var entry=entries.get(key);if(!entry)return !!remote;
        // An in-flight list response may predate the write. Keep the local intent
        // until a later list has observed the completed write.
        if(!entry.pending&&readVersion>=entry.settledVersion&&!!remote===entry.value){entries.delete(key);return !!remote;}
        return entry.value;
      },
      pending:function(key){return !!(entries.get(key)||{}).pending;},
      toggle:function(key,remote,context){
        var entry=entries.get(key);
        if(!entry){entry={confirmed:!!remote,value:!!remote,pending:false,revision:0,context:null};entries.set(key,entry);}
        entry.value=!entry.value;entry.revision++;entry.context=context;version++;
        var running=entry.pending;entry.pending=true;notify(key,entry,context);
        if(!running)drain(key,entry);
        return entry.value;
      }
    };
  }
  function mountSelect(options){
    var host=options.host,doc=host.ownerDocument,win=doc.defaultView;
    var trigger=options.trigger||doc.createElement('button');
    if(!options.trigger){trigger.type='button';trigger.className='arena-select-trigger';options.container.appendChild(trigger);}
    var popup=doc.createElement('div'),list=doc.createElement('div'),heading=doc.createElement('div');
    var id='arenaSelect'+(++serial),state={value:'',options:[],disabled:false},opened=false,active=-1,typeBuffer='',typedAt=0;
    popup.className='arena-select-popover';popup.hidden=true;popup.setAttribute('popover','manual');
    heading.className='arena-select-heading';heading.textContent=options.label;
    list.id=id;list.setAttribute('role','listbox');list.setAttribute('aria-label',options.label);
    popup.appendChild(heading);popup.appendChild(list);host.appendChild(popup);
    trigger.type='button';trigger.setAttribute('role','combobox');trigger.setAttribute('aria-label',options.label);
    trigger.setAttribute('aria-haspopup','listbox');trigger.setAttribute('aria-controls',id);trigger.setAttribute('aria-expanded','false');
    function enabled(){return state.options.map(function(item,i){return item.disabled?-1:i;}).filter(function(i){return i>=0;});}
    function mark(index,scroll){
      active=index;var nodes=list.children;
      for(var i=0;i<nodes.length;i++)nodes[i].classList.toggle('is-active',i===active);
      if(active>=0&&nodes[active]){
        var row=nodes[active];trigger.setAttribute('aria-activedescendant',row.id);
        if(scroll){var top=row.offsetTop,bottom=top+row.offsetHeight;if(top<popup.scrollTop)popup.scrollTop=top;else if(bottom>popup.scrollTop+popup.clientHeight)popup.scrollTop=bottom-popup.clientHeight;}
      }
      else trigger.removeAttribute('aria-activedescendant');
    }
    function position(){
      if(!opened)return;
      if(!trigger.isConnected||!trigger.getClientRects().length){close(false);return;}
      var rect=trigger.getBoundingClientRect(),viewport=win.visualViewport;
      for(var parent=trigger.parentElement;parent&&parent!==host;parent=parent.parentElement){
        if(/auto|scroll|hidden/.test(win.getComputedStyle(parent).overflowY)){var bounds=parent.getBoundingClientRect();if(rect.bottom<=bounds.top||rect.top>=bounds.bottom){close(false);return;}}
      }
      var edge=10,leftEdge=viewport?viewport.offsetLeft:0,topEdge=viewport?viewport.offsetTop:0,width=viewport?viewport.width:win.innerWidth,height=viewport?viewport.height:win.innerHeight;
      var popupWidth=Math.min(Math.max(rect.width,276),width-edge*2);
      popup.style.width=popupWidth+'px';popup.style.left=Math.max(leftEdge+edge,Math.min(rect.left,leftEdge+width-popupWidth-edge))+'px';
      var above=rect.top-topEdge-edge,below=topEdge+height-rect.bottom-edge;
      var up=below<Math.min(popup.scrollHeight,310)&&above>below;
      popup.dataset.side=up?'top':'bottom';
      popup.style.maxHeight=Math.max(80,Math.min(400,(up?above:below)-6))+'px';
      popup.style.top=(up?Math.max(topEdge+edge,rect.top-popup.offsetHeight-6):rect.bottom+6)+'px';
    }
    function listen(add){
      var method=add?'addEventListener':'removeEventListener';
      doc[method]('pointerdown',outside,true);doc[method]('focusin',focusOutside);doc[method]('scroll',position,true);win[method]('resize',position);
      if(win.visualViewport){win.visualViewport[method]('resize',position);win.visualViewport[method]('scroll',position);}
    }
    function close(restore){
      if(!opened)return;opened=false;listen(false);
      if(popup.matches(':popover-open'))popup.hidePopover();popup.hidden=true;
      trigger.setAttribute('aria-expanded','false');trigger.removeAttribute('aria-activedescendant');
      if(activeSelect===control)activeSelect=null;
      if(restore&&trigger.isConnected)trigger.focus({preventScroll:true});
    }
    function outside(event){if(!trigger.contains(event.target)&&!popup.contains(event.target))close(false);}
    function focusOutside(event){if(!trigger.contains(event.target)&&!popup.contains(event.target))close(false);}
    function open(){
      if(state.disabled||opened)return;
      if(activeSelect)activeSelect.close(false);
      if(options.beforeOpen)options.beforeOpen();
      opened=true;activeSelect=control;popup.hidden=false;
      if(popup.showPopover)popup.showPopover();
      trigger.setAttribute('aria-expanded','true');
      var selected=state.options.findIndex(function(item){return item.value===state.value&&!item.disabled;});
      mark(selected>=0?selected:enabled()[0],false);position();mark(active,true);listen(true);
    }
    function choose(){
      var item=state.options[active];if(!item||item.disabled)return;
      close(true);if(item.value!==state.value)options.onChange(item.value);
    }
    function render(){
      var selected=state.options.find(function(item){return item.value===state.value;});
      trigger.disabled=state.disabled;
      if(options.renderLabel)options.renderLabel(state.value,selected);
      else{
        trigger.replaceChildren();var text=doc.createElement('span');text.className='arena-select-value';text.textContent=selected?selected.label:(options.placeholder||'选择模型');
        trigger.classList.toggle('is-placeholder',!selected||!state.value);trigger.appendChild(text);
        var arrow=doc.createElementNS('http://www.w3.org/2000/svg','svg');arrow.setAttribute('viewBox','0 0 24 24');arrow.setAttribute('aria-hidden','true');arrow.innerHTML='<path d="m8 10 4 4 4-4"/>';trigger.appendChild(arrow);
      }
      list.replaceChildren();
      state.options.forEach(function(item,i){
        var row=doc.createElement('div');row.id=id+'Option'+i;row.className='arena-select-option';row.dataset.index=i;row.setAttribute('role','option');row.setAttribute('aria-selected',String(item.value===state.value));
        if(item.disabled)row.setAttribute('aria-disabled','true');
        var copy=doc.createElement('span'),label=doc.createElement('span');copy.className='arena-select-copy';label.className='arena-select-option-label';label.textContent=item.label;copy.appendChild(label);
        if(item.detail){var detail=doc.createElement('small');detail.textContent=item.detail;copy.appendChild(detail);}
        row.appendChild(copy);
        var check=doc.createElementNS('http://www.w3.org/2000/svg','svg');check.setAttribute('viewBox','0 0 24 24');check.setAttribute('aria-hidden','true');check.innerHTML='<path d="m5 12 4 4L19 6"/>';row.appendChild(check);list.appendChild(row);
      });
      if(opened){if(state.disabled)close(false);else{mark(Math.max(0,state.options.findIndex(function(item){return item.value===state.value;})),false);position();}}
    }
    trigger.addEventListener('click',function(event){event.stopPropagation();if(opened)close(true);else open();});
    trigger.addEventListener('keydown',function(event){
      if(state.disabled||event.isComposing)return;
      var key=event.key,keys=['ArrowDown','ArrowUp','Home','End','Enter',' ','Escape','Tab'];
      if(opened&&key==='ArrowUp'&&event.altKey){event.preventDefault();choose();return;}
      if(keys.indexOf(key)>=0){
        if(key==='Escape'){if(opened){event.preventDefault();event.stopPropagation();close(true);}return;}
        if(key==='Tab'){if(opened)choose();return;}
        event.preventDefault();event.stopPropagation();
        if(key==='Enter'||key===' '){if(opened)choose();else open();return;}
        var wasOpen=opened;open();var indices=enabled(),at=indices.indexOf(active);
        if(key==='Home')mark(indices[0],true);
        else if(key==='End')mark(indices[indices.length-1],true);
        else if(wasOpen)mark(indices[Math.max(0,Math.min(indices.length-1,at+(key==='ArrowDown'?1:-1)))],true);
      }else if(key.length===1&&!event.ctrlKey&&!event.metaKey&&!event.altKey){
        event.preventDefault();var now=Date.now();typeBuffer=now-typedAt>700?'':typeBuffer;typeBuffer+=key.toLocaleLowerCase();typedAt=now;open();
        var repeated=typeBuffer.split('').every(function(c){return c===key.toLocaleLowerCase();}),term=repeated?key.toLocaleLowerCase():typeBuffer;
        for(var n=1;n<=state.options.length;n++){var i=(active+n)%state.options.length,item=state.options[i];if(!item.disabled&&item.label.toLocaleLowerCase().startsWith(term)){mark(i,true);break;}}
      }
    });
    popup.addEventListener('pointerdown',function(event){if(event.target.closest('[role="option"]'))event.preventDefault();});
    popup.addEventListener('click',function(event){var row=event.target.closest('[role="option"]');if(!row)return;event.stopPropagation();if(state.options[Number(row.dataset.index)].disabled)return;mark(Number(row.dataset.index),false);choose();});
    var fingerprint='';
    var control={
      update:function(next){state=Object.assign({},state,next);var signature=JSON.stringify([state.value,state.disabled,state.options]);if(signature!==fingerprint){fingerprint=signature;render();}},
      close:close,trigger:trigger,
      destroy:function(){close(false);popup.remove();if(!options.trigger)trigger.remove();}
    };
    control.update(options);return control;
  }
  return {pinIcon:pinIcon,createPinStore:createPinStore,mountSelect:mountSelect,closeSelect:function(){if(activeSelect)activeSelect.close(false);}};
});
