(function(root){
  'use strict';
  var pending=new Map(),seq=0,config={},checking=false,lastCheck=0;
  function available(){return !!(root.PickandcaseNative && typeof root.PickandcaseNative.postMessage==='function');}
  function request(action,payload){
    if(!available()) return Promise.reject(new Error('当前环境不支持此操作'));
    var id=String(++seq);
    return new Promise(function(resolve,reject){
      var timer=setTimeout(function(){pending.delete(id);reject(new Error('操作超时，请重试'));},60000);
      pending.set(id,{resolve:resolve,reject:reject,timer:timer});
      try{root.PickandcaseNative.postMessage(JSON.stringify(Object.assign({id:id,action:action},payload||{})));}
      catch(error){clearTimeout(timer);pending.delete(id);reject(error);}
    });
  }
  function reply(event){
    var data;try{data=JSON.parse(event.data);}catch(error){return;}
    var task=pending.get(data.id);if(!task)return;
    pending.delete(data.id);clearTimeout(task.timer);
    if(data.ok)task.resolve(data);else task.reject(new Error(data.error||'操作失败，请重试'));
  }
  async function checkUpdate(){
    if(!available()||checking||Date.now()-lastCheck<60000)return;
    checking=true;lastCheck=Date.now();
    try{
      var current=document.querySelector('meta[name="app-version"]');
      var response=await fetch('/app-version.json',{cache:'no-store'});
      if(!response.ok)return;
      var next=await response.json();
      if(!current||typeof next.version!=='string'||next.version===current.content)return;
      if(config.canRefresh&&config.canRefresh()){location.reload();return;}
      if(document.getElementById('arenaAppUpdate'))return;
      var button=document.createElement('button');button.id='arenaAppUpdate';button.type='button';button.textContent='有新版本 · 更新';
      button.onclick=function(){
        // Keep drafts, uploads, active responses, projects and incognito edits intact.
        if(config.canRefresh&&config.canRefresh())location.reload();
        else{button.textContent='请在空白新对话中更新';setTimeout(function(){button.textContent='有新版本 · 更新';},2600);}
      };
      document.getElementById('ai-arena-app').appendChild(button);
    }catch(error){/* An offline resume keeps the current conversation. */}
    finally{checking=false;}
  }
  root.ArenaNative={
    available:available,
    haptic:function(){if(available())request('haptic').catch(function(){});},
    image:function(action,entry){
      if(['saveImage','shareImage'].indexOf(action)===-1 || !entry || !/^image\/(png|jpeg|webp)$/.test(entry.mime))return Promise.reject(new Error('不支持的图片格式'));
      return request(action,{data:entry.data,mime:entry.mime});
    },
    back:function(){return config.back?!!config.back():false;},
    mount:function(options){
      config=options||{};if(!available())return;
      root.PickandcaseNative.onmessage=reply;
      document.documentElement.classList.add('arena-android-app');
      function theme(){request('theme',{dark:!document.getElementById('ai-arena-app').classList.contains('light-mode')}).catch(function(){});}
      new MutationObserver(theme).observe(document.getElementById('ai-arena-app'),{attributes:true,attributeFilter:['class']});theme();
      document.addEventListener('visibilitychange',function(){if(!document.hidden)checkUpdate();});
      root.addEventListener('arena:resume',checkUpdate);checkUpdate();
    }
  };
  // VisualViewport covers mobile keyboards; pinch zoom keeps its native viewport behavior.
  if(root.visualViewport){
    function viewport(){
      if(Math.abs(root.visualViewport.scale-1)>.02)return;
      document.documentElement.style.setProperty('--arena-visible-height',Math.round(root.visualViewport.height)+'px');
    }
    root.visualViewport.addEventListener('resize',viewport,{passive:true});viewport();
  }
})(window);
