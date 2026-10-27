(function(root){
  'use strict';
  var GOOGLE_MODEL = 'gemini-nano-banana-2.1';
  var capabilities = {
    'gemini-nano-banana-2.1': {
      label:'Nano Banana 2.1', provider:'Google', references:14,
      sizes:['1K','2K','4K'], thinking:['minimal','medium','high'],
      ratios:['1:1','16:9','9:16','3:2','2:3','4:3','3:4','4:5','5:4','21:9','4:1','1:4','8:1','1:8']
    },
    'grok-imagine-image-2.0': {
      label:'Grok Imagine 2.0', provider:'xAI', references:5,
      sizes:['1k','2k'], quality:['auto','low','medium'],
      ratios:['1:1','16:9','9:16','4:3','3:4','3:2','2:3','2:1','1:2','21:9','5:2','19.5:9','9:19.5','20:9','9:20','auto']
    }
  };
  function canonical(model){ return model==='gemini-3.1-flash-image'||model==='nanbanana2-official' ? GOOGLE_MODEL : model; }
  function cap(model){ return capabilities[canonical(model)]; }
  function pick(value, values, fallback){ return values.indexOf(value)>=0?value:fallback; }
  function normalize(model, state){
    var c=cap(model), s=Object.assign({},state);
    if(!c)return s;
    s.ratio=pick(s.ratio,c.ratios,'1:1');
    s.size=pick(s.size,c.sizes,c.sizes[0]);
    if(c.thinking){s.thinking=pick(s.thinking,c.thinking,'medium');s.grounding=pick(s.grounding,['off','web','image','web-image'],'off');s.imageOnly=!!s.imageOnly;}
    if(c.quality){s.quality=pick(s.quality,c.quality,'auto');s.count=pick(Number(s.count),[1,2,3,4],1);}
    return s;
  }
  function requestOptions(model,task,state,images,history){
    model=canonical(model);
    var s=normalize(model,state), opts={imageTask:task,aspectRatio:s.ratio,_imgs:images||[]};
    if(model===GOOGLE_MODEL){
      Object.assign(opts,{imageSize:s.size,thinkingLevel:s.thinking,imageOnly:s.imageOnly,grounding:s.grounding,n:1});
      if(task!=='generation'&&history&&history.length)opts.imageHistory=history;
    }else Object.assign(opts,{resolution:s.size,quality:s.quality,n:task==='generation'?s.count:1});
    return opts;
  }
  function escape(value){return String(value).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function select(key,label,options,value){
    return '<label class="arena-image-field"><span>'+escape(label)+'</span><select data-image-setting="'+key+'">'+options.map(function(o){o=Array.isArray(o)?o:[o,o==='auto'?'自动':o];return '<option value="'+escape(o[0])+'"'+(String(value)===String(o[0])?' selected':'')+'>'+escape(o[1])+'</option>';}).join('')+'</select></label>';
  }
  function segments(key,label,options,value){
    return '<fieldset class="arena-image-field arena-image-span"><legend>'+escape(label)+'</legend><div class="arena-image-segments">'+options.map(function(o){o=Array.isArray(o)?o:[o,String(o).toUpperCase()];return '<label><input type="radio" name="image-'+key+'" data-image-setting="'+key+'" value="'+escape(o[0])+'"'+(String(value)===String(o[0])?' checked':'')+'><span>'+escape(o[1])+'</span></label>';}).join('')+'</div></fieldset>';
  }
  function settingsMarkup(model,task,state,styles){
    var c=cap(model), s=normalize(model,state);
    if(!c)return '';
    var h='<div class="arena-image-heading"><div><h2 id="aaImageSettingsTitle">图像设置</h2><p>'+escape(c.label)+' <span>· '+c.provider+'</span></p></div><button type="button" data-image-close aria-label="关闭图像设置">×</button></div>';
    h+='<div class="arena-image-form">';
    h+=select('ratio','画面比例',c.ratios,s.ratio);
    if(c.thinking)h+=select('style','风格预设',(styles||[]).map(function(o){return [o.value,o.label];}),s.style||'none');
    else h+=select('count','生成数量',task==='generation'?[[1,'1 张'],[2,'2 张'],[3,'3 张'],[4,'4 张']]:[[1,'1 张 · 编辑']],task==='generation'?s.count:1);
    h+=segments('size','分辨率',c.sizes,s.size);
    if(c.thinking){
      h+=segments('thinking','思考强度',[['minimal','快速'],['medium','均衡'],['high','深度']],s.thinking);
      h+=select('grounding','Google 搜索',[['off','关闭'],['web','网页搜索'],['image','图片搜索'],['web-image','网页与图片']],s.grounding);
      h+=select('imageOnly','输出内容',[['false','图片与文字'],['true','仅图片']],String(s.imageOnly));
    }else h+=select('quality','生成质量',[['auto','自动'],['low','标准 · low'],['medium','精细 · medium']],s.quality);
    h+='</div><div class="arena-image-settings-foot"><span>支持最多 '+c.references+' 张参考图</span><span>自动保存</span></div>';
    if(c.thinking)h+='<p class="arena-image-note" data-image-grounding-note'+(s.grounding==='off'?' hidden':'')+'>模型按需搜索，来源随结果展示。搜索可能额外计费。</p>';
    if(c.thinking)h+='<p class="arena-image-note" data-image-style-note'+(!s.style||s.style==='none'?' hidden':'')+'>风格预设会加入提示词。</p>';
    return h;
  }
  // Store one compact response per turn. Image bytes already live in imgItems.
  // Rebuild native role/parts history without altering encrypted thought signatures.
  function historyFor(messages,parentUid){
    var chain=[],seen=new Set(),current=parentUid;
    while(current!=null){
      if(seen.has(String(current)))throw new Error('图片编辑上下文无效，请重新选择图片。');
      seen.add(String(current));
      var msg=messages.find(function(m){return String(m.uid)===String(current);});
      if(!msg||!msg.imageTurn||!msg.imageResponse)throw new Error('这张图的编辑上下文已不可用，请重新上传图片。');
      chain.unshift(msg);current=msg.imageTurn.parentUid;
    }
    return chain.flatMap(function(msg){
      var parts=(msg.imageTurn.references||[]).map(function(ref){
        var image=ref;
        if(ref.uid!=null){var source=messages.find(function(m){return String(m.uid)===String(ref.uid);});image=source&&source.imgItems&&source.imgItems[ref.index];}
        if(!image||!image.data)throw new Error('参考图已不可用，请重新上传。');
        return {inlineData:{data:image.data,mimeType:image.mime||'image/png'}};
      });
      parts.push({text:msg.imageTurn.prompt});
      var response=msg.imageResponse.map(function(part){
        var out=Object.assign({},part);
        if(part.imageIndex!==undefined){var image=msg.imgItems&&msg.imgItems[part.imageIndex];if(!image)throw new Error('图片上下文不完整，请重新上传。');delete out.imageIndex;out.inlineData={data:image.data,mimeType:image.mime||'image/png'};}
        return out;
      });
      return [{role:'user',parts:parts},{role:'model',parts:response}];
    });
  }
  var api={GOOGLE_MODEL:GOOGLE_MODEL,capabilities:capabilities,canonical:canonical,cap:cap,normalize:normalize,requestOptions:requestOptions,settingsMarkup:settingsMarkup,historyFor:historyFor};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.ArenaImage=api;
})(typeof window!=='undefined'?window:this);
