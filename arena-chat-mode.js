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
  return {infer:infer,labels:labels};
});
