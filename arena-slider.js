/* Shared slider markup: reasoning and image settings use the same control. */
(function(root,factory){var api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ArenaSlider=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  function escape(value){return String(value==null?'':value).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function markup(o){
    var p=o.prefix,min=o.min===undefined?0:o.min,max=o.max,step=o.step||1,value=o.value,span=max-min,fraction=span?(value-min)/span:0;
    var stops=Math.round(span/step),ticks=stops<=10?stops:4,attrs='';
    Object.keys(o.attributes||{}).forEach(function(key){attrs+=' '+key+'="'+escape(o.attributes[key])+'"';});
    var h='<div class="arena-effort-scale" id="'+p+'EffortScale" style="--effort-progress:'+(fraction*100)+'%"><div class="arena-effort-track" aria-hidden="true"><div class="arena-effort-fill"></div></div><div class="arena-effort-thumb" aria-hidden="true"><span><i class="arena-effort-halo"></i></span></div><div class="arena-effort-ticks" aria-hidden="true">';
    for(var i=0;i<=ticks;i++){var at=ticks?i/ticks:0;h+='<span'+(at<=fraction?' class="is-filled"':'')+' style="left:'+(at*100)+'%"></span>';}
    h+='</div>'+(o.externalLabel?'':'<label class="arena-sr-only" for="'+p+'EffortSlider">'+escape(o.label)+'</label>')+'<input id="'+p+'EffortSlider" type="range" min="'+min+'" max="'+max+'" step="'+step+'" value="'+value+'" class="arena-effort-input"'+attrs+' aria-valuetext="'+escape(o.valueText)+'" aria-describedby="'+p+'EffortDescription"><p class="arena-sr-only" id="'+p+'EffortDescription">'+escape(o.description)+'</p></div>';
    return h+'<div class="arena-effort-ends" aria-hidden="true"><span>'+escape(o.left)+'</span><span>'+escape(o.right)+'</span></div>';
  }
  return {markup:markup};
});
