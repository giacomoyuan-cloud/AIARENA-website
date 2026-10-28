(function(root){
  'use strict';
  var encoder=new TextEncoder();
  function abortError(){var error=new Error('已停止生成');error.name='AbortError';return error;}
  function delay(ms,signal){return new Promise(function(resolve,reject){
    if(signal&&signal.aborted)return reject(abortError());
    var timer=setTimeout(done,ms);
    function done(){if(signal)signal.removeEventListener('abort',stop);resolve();}
    function stop(){clearTimeout(timer);reject(abortError());}
    if(signal)signal.addEventListener('abort',stop,{once:true});
  });}
  function waitVisible(doc,signal){return new Promise(function(resolve,reject){
    if(signal&&signal.aborted)return reject(abortError());
    if(!doc||!doc.hidden)return resolve();
    function clean(){doc.removeEventListener('visibilitychange',check);if(signal)signal.removeEventListener('abort',stop);}
    function check(){if(!doc.hidden){clean();resolve();}}
    function stop(){clean();reject(abortError());}
    doc.addEventListener('visibilitychange',check);
    if(signal)signal.addEventListener('abort',stop,{once:true});
  });}
  function create(options){
    options=options||{};
    var fetcher=options.fetch||root.fetch.bind(root),doc=options.document||root.document,events=options.events||root;
    var makeId=options.makeId||function(){return root.crypto&&root.crypto.randomUUID?root.crypto.randomUUID():'run_'+Date.now()+'_'+Math.random().toString(36).slice(2);};
    function post(url,body,signal,keepalive){return fetcher(url+'/chat-runs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:signal,keepalive:!!keepalive});}
    function identity(payload,runId){return {user:payload.user||payload.username,password:payload.password||payload.passwordHash,projectId:payload.projectId||null,chatId:payload.chat.chatId,runId:runId};}
    async function retryPost(url,body,signal,onState){
      var started=Date.now(),attempt=0;
      while(true){
        if(signal&&signal.aborted)throw abortError();
        try{return await post(url,body,signal);}
        catch(error){
          if(signal&&signal.aborted)throw abortError();
          if(Date.now()-started>15*60*1000)throw new Error('暂时无法连接服务器。已生成的内容会保留在原对话中，请恢复网络后重新打开。');
          if(onState)onState('reconnecting');
          await waitVisible(doc,signal);
          await delay(Math.min(6000,500*Math.pow(2,Math.min(attempt++,4))),signal);
        }
      }
    }
    async function retryJSON(url,body,signal,onState){
      var started=Date.now();
      while(true){
        var attempt=new AbortController(),timer=setTimeout(function(){attempt.abort();},25000);
        function cancel(){attempt.abort();}
        if(signal){if(signal.aborted)throw abortError();signal.addEventListener('abort',cancel,{once:true});}
        try{
          var response=await post(url,body,attempt.signal),data=await response.json();
          return {response:response,data:data};
        }catch(error){
          if(signal&&signal.aborted)throw abortError();
          if(error instanceof SyntaxError)throw new Error('恢复服务返回了无效数据，请重新打开聊天记录。');
          if(Date.now()-started>15*60*1000)throw new Error('暂时无法连接服务器。已生成的内容会保留在原对话中，请恢复网络后重新打开。');
          if(onState)onState('reconnecting');
          await waitVisible(doc,signal);await delay(700,signal);
        }finally{clearTimeout(timer);if(signal)signal.removeEventListener('abort',cancel);}
      }
    }
    async function open(url,payload,settings){
      settings=settings||{};
      var signal=settings.signal,runId=makeId(),credentials=identity(payload,runId),finished=false,closed=false,connection=null,reader=null;
      function state(value){if(settings.onState)settings.onState(value);}
      function finish(status){if(finished)return;finished=true;if(settings.onFinish)settings.onFinish({id:runId,status:status});}
      function stop(){
        if(connection)connection.abort();
        if(!finished){post(url,Object.assign({action:'stop'},credentials),null,true).catch(function(){});finish('cancelled');}
      }
      if(signal)signal.addEventListener('abort',stop,{once:true});
      var created;
      try{created=await retryJSON(url,Object.assign({action:'start',payload:payload},credentials),signal,state);}
      catch(error){if(signal)signal.removeEventListener('abort',stop);throw error;}
      if(!created.response.ok){if(signal)signal.removeEventListener('abort',stop);return Response.json(created.data,{status:created.response.status});}
      if(signal&&signal.aborted)throw abortError();
      var run=created.data;
      if(settings.onRun)settings.onRun({id:runId,status:run.status,chatId:credentials.chatId,projectId:credentials.projectId});
      var cursor=0;
      var stream=new ReadableStream({
        async start(controller){
          function reconnect(){if(connection)connection.abort();}
          function visibility(){reconnect();}
          if(doc)doc.addEventListener('visibilitychange',visibility);
          if(events&&events.addEventListener){events.addEventListener('online',reconnect);events.addEventListener('pageshow',reconnect);}
          try{
            while(!closed&&!finished){
              await waitVisible(doc,signal);
              if(signal&&signal.aborted)throw abortError();
              connection=new AbortController();
              var timer;
              function arm(){clearTimeout(timer);timer=setTimeout(reconnect,35000);}
              try{
                arm();
                var response=await post(url,Object.assign({action:'events',after:cursor},credentials),connection.signal);
                if(!response.ok){
                  var problem=await response.json().catch(function(){return {};});
                  if(response.status>=400&&response.status<500)throw Object.assign(new Error(problem.error||'无法恢复这条回答，请重新打开聊天记录。'),{terminal:true});
                  throw new Error('连接暂时不可用');
                }
                state('connected');reader=response.body.getReader();
                var decoder=new TextDecoder(),buffer='';
                while(!closed&&!finished){
                  var part=await reader.read();arm();
                  buffer+=decoder.decode(part.value||new Uint8Array(),{stream:!part.done}).replace(/\r\n/g,'\n');
                  var frames=buffer.split('\n\n');buffer=frames.pop();
                  for(var f=0;f<frames.length;f++){
                    var lines=frames[f].split('\n'),id=0,data=[];
                    lines.forEach(function(line){if(line.indexOf('id:')===0)id=Number(line.slice(3).trim());else if(line.indexOf('data:')===0)data.push(line.slice(5).trimStart());});
                    if(!data.length||!id||id<=cursor)continue;
                    var value=data.join('\n');
                    // Advance only after enqueue; replayed event IDs never duplicate text or citations.
                    controller.enqueue(encoder.encode('data: '+value+'\n\n'));cursor=id;
                    if(value==='[DONE]')finish('completed');
                    else{try{if(JSON.parse(value).error)finish('failed');}catch(ignore){}}
                  }
                  if(part.done)break;
                }
                if(!finished&&!closed)state('reconnecting');
              }catch(error){
                if(signal&&signal.aborted)throw abortError();
                if(error.terminal)throw error;
                if(!closed&&!finished)state('reconnecting');
              }finally{
                clearTimeout(timer);
                if(reader){reader.cancel().catch(function(){});reader=null;}
                connection=null;
              }
              if(!finished&&!closed){await waitVisible(doc,signal);await delay(500,signal);}
            }
            if(!closed)controller.close();
          }catch(error){if(!closed)controller.error(error);}
          finally{
            if(signal)signal.removeEventListener('abort',stop);
            if(doc)doc.removeEventListener('visibilitychange',visibility);
            if(events&&events.removeEventListener){events.removeEventListener('online',reconnect);events.removeEventListener('pageshow',reconnect);}
          }
        },
        cancel(){closed=true;if(connection)connection.abort();}
      });
      return new Response(stream,{headers:{'Content-Type':'text/event-stream'}});
    }
    async function watch(url,credentials,settings){
      settings=settings||{};
      var signal=settings.signal,done=false;
      function stop(){if(!done)post(url,Object.assign({action:'stop'},credentials),null,true).catch(function(){});}
      if(signal)signal.addEventListener('abort',stop,{once:true});
      try{
        while(true){
          await waitVisible(doc,signal);
          var result=await retryJSON(url,Object.assign({action:'status'},credentials),signal,settings.onState),data=result.data;
          if(!result.response.ok)throw new Error(data.error||'恢复回答失败，请重新打开聊天记录。');
          if(settings.onSnapshot)settings.onSnapshot(data);
          if(data.status!=='running'){done=true;return data;}
          await delay(1000,signal);
        }
      }finally{if(signal)signal.removeEventListener('abort',stop);}
    }
    return {open:open,watch:watch};
  }
  var client=create();root.ArenaChatRuns={open:client.open,watch:client.watch,create:create};
  if(typeof module==='object'&&module.exports)module.exports=root.ArenaChatRuns;
})(typeof globalThis!=='undefined'?globalThis:this);
