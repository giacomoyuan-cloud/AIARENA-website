/* Provider limits checked against official model documentation on 2026-10-30. */
(function(root){
  'use strict';
  var models={};
  function add(ids,limits){ids.forEach(function(id){models[id]=Object.freeze(Object.assign({},limits));});}
  add(['claude-opus-5-5','claude-sonnet-5-5','claude-fable-5-1','claude-opus-5'],{contextTokens:1000000,maxInputTokens:1000000,maxOutputTokens:128000,sharedWindow:true});
  add(['gpt-6-astra','gpt-6.1-sol','gpt-5.6-sol'],{contextTokens:1050000,maxInputTokens:922000,maxOutputTokens:128000,sharedWindow:true});
  add(['grok-4.7'],{contextTokens:500000,maxInputTokens:500000,maxOutputTokens:128000,sharedWindow:true});
  add(['gemini-3.8-flash','gemini-3.1-pro-preview'],{contextTokens:1048576,maxInputTokens:1048576,maxOutputTokens:65536,sharedWindow:false});
  add(['gemini-4-argon'],{contextTokens:1048576,maxInputTokens:1048576,maxOutputTokens:1048576,privateMaxOutputTokens:65536,outputReservation:65536,sharedWindow:true,longDecode:true});
  function get(model){return models[model==='grok-4.6'?'grok-4.7':model]||null;}
  function inputBudget(model,output){
    var limits=get(model);if(!limits)throw Error('Unknown text model');
    output=output===undefined?limits.maxOutputTokens:output;
    if(!Number.isInteger(output)||output<32||output>limits.maxOutputTokens)throw Error('Invalid output token budget');
    var reserve=limits.outputReservation?Math.min(output,limits.outputReservation):output;
    return Math.min(limits.maxInputTokens,limits.sharedWindow?limits.contextTokens-reserve:limits.maxInputTokens)-1024;
  }
  var api=Object.freeze({models:Object.freeze(models),get:get,inputBudget:inputBudget,maxTextChars:8*1024*1024,maxRequestBytes:24*1024*1024});
  root.ArenaTokenLimits=api;
  if(typeof module==='object'&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
