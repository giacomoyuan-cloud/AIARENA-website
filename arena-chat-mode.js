(function(root,factory){var api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ArenaChatMode=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  var labels={chat:'对话',image:'图像',debate:'辩论',video:'视频'};
  function imageModel(model){
    return /^(gpt-image-|grok-imagine-image|gemini-nano-banana-|mj[_-]imagine)/.test(model||'')||['gemini-3.1-flash-image','nanbanana2-official','nanbanana2-custom'].indexOf(model)!==-1;
  }
  function infer(messages){
    messages=Array.isArray(messages)?messages:[];
    for(var i=messages.length-1;i>=0;i--){
      var message=messages[i];if(!message||typeof message!=='object')continue;
      var model=typeof message.submodel==='string'?message.submodel:null,mode;
      if(message.debateRun||message.debateSessionId||message.debateStage||message.participantId||message._team||message.brand==='judge')mode='debate';
      else if(Object.prototype.hasOwnProperty.call(labels,message.chatMode))mode=message.chatMode;
      else if(message.isUser)continue;
      else if(message.videoUrl||message.brand==='kling')mode='video';
      else if(imageModel(model)||message.imageTurn||message.imageResponse||message.imgData||(message.imgItems&&message.imgItems.length))mode='image';
      else mode='chat';
      if(mode==='image'&&['gemini-3.1-flash-image','nanbanana2-official','nanbanana2-custom'].indexOf(model)!==-1)model='gemini-nano-banana-2.1';
      return {mode:mode,model:model};
    }
    return {mode:'chat',model:null};
  }
  function known(mode){return Object.prototype.hasOwnProperty.call(labels,mode);}
  function badge(chat){
    if(known(chat.mode))return {label:labels[chat.mode],title:'会话类型：'+labels[chat.mode]};
    return chat.modeUnavailable?{label:'待识别',title:'暂时无法读取类型，打开会话后会自动识别'}:{label:'识别中',title:'正在读取会话类型'};
  }
  function matches(chat,query){return (String(chat.title||'')+' '+(known(chat.mode)?labels[chat.mode]:'')).toLocaleLowerCase().indexOf(query)!==-1;}
  function createCache(storage){
    var entries=new Map(),key='aa-history-modes-v1';
    function valid(id,value){return typeof id==='string'&&id.length<=512&&value&&known(value.mode)&&Number.isFinite(value.updatedAt);}
    try{var saved=JSON.parse(storage.getItem(key)||'[]');if(Array.isArray(saved))saved.slice(-600).forEach(function(item){if(Array.isArray(item)&&valid(item[0],item[1]))entries.set(item[0],{mode:item[1].mode,updatedAt:item[1].updatedAt});});}catch(ignore){}
    return {get:function(id){return entries.get(id);},set:function(id,value){
      if(!valid(id,value))return;
      var previous=entries.get(id);if(previous&&previous.mode===value.mode&&previous.updatedAt===value.updatedAt)return;
      entries.delete(id);entries.set(id,{mode:value.mode,updatedAt:value.updatedAt});
      while(entries.size>600)entries.delete(entries.keys().next().value);
      try{storage.setItem(key,JSON.stringify(Array.from(entries)));}catch(ignore){}
    }};
  }
  return {infer:infer,labels:labels,known:known,badge:badge,matches:matches,createCache:createCache};
});
