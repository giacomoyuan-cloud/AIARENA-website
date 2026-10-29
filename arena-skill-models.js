/* Shared model contract for Anthropic hosted document and computation Skills. */
(function(root,factory){var api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ArenaSkillModels=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  var names=Object.freeze({'claude-fable-5-1':'Claude Fable 5.1','claude-opus-5-5':'Claude Opus 5.5','claude-sonnet-5-5':'Claude Sonnet 5.5'});
  var defaultModel='claude-sonnet-5-5';
  function supported(model){return Object.prototype.hasOwnProperty.call(names,model);}
  function native(skill){return !!skill&&(!!skill.official||skill.kind==='compute');}
  function restricted(settings,catalog){return !!settings&&settings.mode==='manual'&&(settings.ids||[]).some(function(id){return catalog.some(function(skill){return skill.id===id&&native(skill);});});}
  function available(models,settings,catalog){return models.filter(function(model){return !restricted(settings,catalog)||supported(model);});}
  function choose(requested,fallback){return supported(requested)?requested:supported(fallback)?fallback:defaultModel;}
  function validate(model,settings,catalog){if(restricted(settings,catalog)&&!supported(model))throw Object.assign(new Error('此 Skill 仅支持 Claude，请选择兼容的 Claude 模型'),{status:400});}
  return Object.freeze({names:names,defaultModel:defaultModel,supported:supported,native:native,restricted:restricted,available:available,choose:choose,validate:validate});
});
