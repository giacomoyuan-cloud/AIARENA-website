(function(root,factory){var api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ArenaDebateRuns=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  function create(options){
    options=options||{};
    var request=options.fetch||function(url,init){return fetch(url,init);},later=options.setTimeout||setTimeout,clear=options.clearTimeout||clearTimeout;
    var makeId=options.makeId||function(){return Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);};
    function aborted(){return new DOMException('已离开当前讨论','AbortError');}
    function sleep(ms,signal){return new Promise(function(resolve,reject){
      if(signal&&signal.aborted){reject(aborted());return;}
      var timer=later(done,ms);function done(){if(signal)signal.removeEventListener('abort',stop);resolve();}
      function stop(){clear(timer);signal.removeEventListener('abort',stop);reject(aborted());}
      if(signal)signal.addEventListener('abort',stop,{once:true});
    });}
    async function call(base,credentials,action,extra,settings){
      settings=settings||{};var failures=0,started=Date.now(),body=JSON.stringify(Object.assign({},credentials,extra||{},{action:action}));
      while(true){
        if(settings.signal&&settings.signal.aborted)throw aborted();
        var controller=new AbortController(),timeout=later(function(){controller.abort();},12000);
        var detach=function(){controller.abort();};if(settings.signal)settings.signal.addEventListener('abort',detach,{once:true});
        try{
          var response=await request(base+'/debate-runs',{method:'POST',headers:{'Content-Type':'application/json'},body:body,signal:controller.signal});
          var data=await response.json();
          if(!response.ok){var error=new Error(data.error||'讨论连接暂时不可用');error.status=response.status;throw error;}
          if(settings.onState)settings.onState('connected');return data;
        }catch(error){
          if(settings.signal&&settings.signal.aborted)throw aborted();
          if(error.status&&error.status<500||Date.now()-started>15*60*1000)throw error;
          if(settings.onState)settings.onState('reconnecting');
        }finally{clear(timeout);if(settings.signal)settings.signal.removeEventListener('abort',detach);}
        await sleep(Math.min(8000,500*Math.pow(1.6,failures++)),settings.signal);
      }
    }
    async function watch(base,credentials,settings){
      settings=settings||{};var revision=0,first=true;
      var snapshot=settings.input?await call(base,credentials,'start',{input:settings.input},settings):null;
      while(true){
        if(!snapshot)snapshot=await call(base,credentials,'status',{after:revision},settings);
        if(first||snapshot.revision>revision){
          if(settings.onSnapshot)settings.onSnapshot(snapshot,{initial:first});
          revision=snapshot.revision;first=false;
        }
        if(snapshot.status!=='running')return snapshot;
        snapshot=null;await sleep(options.interval||650,settings.signal);
      }
    }
    return {watch:watch,status:function(base,credentials,settings){return call(base,credentials,'status',{},settings);},
      control:function(base,credentials,action,extra,settings){return call(base,credentials,action,Object.assign({operationId:makeId()},extra||{}),settings);}};
  }
  var client=create();return {create:create,watch:client.watch,status:client.status,control:client.control};
});
