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
      label:'Grok Image 2.0', provider:'xAI', references:5,
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
  function icon(name){
    var paths={image:'<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 5-5 4 4 3-3 6 6"/>',edit:'<path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 14v6Z"/>',layers:'<rect x="3" y="7" width="14" height="14" rx="2"/><path d="M7 7V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-2"/>',chevron:'<path d="m7 10 5 5 5-5"/>',check:'<path d="m5 12 4 4L19 6"/>',close:'<path d="m6 6 12 12M6 18 18 6"/>',search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',web:'<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18Z"/>',off:'<path d="m5 5 14 14"/><circle cx="12" cy="12" r="9"/>',text:'<path d="M4 5h16M4 10h16M4 15h10M4 20h7"/>',file:'<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6Zm0 0v6h6M8 13h8M8 17h5"/>',sliders:'<path d="M4 6h7m5 0h4M4 18h3m5 0h8M4 12h12m5 0h-1"/><circle cx="13" cy="6" r="2"/><circle cx="9" cy="18" r="2"/><circle cx="18" cy="12" r="2"/>',plus:'<path d="M12 5v14M5 12h14"/>',enter:'<path d="M20 5v7a3 3 0 0 1-3 3H4m5-5-5 5 5 5"/>',send:'<path d="M12 19V5M5 12l7-7 7 7"/>',stop:'<rect x="6" y="6" width="12" height="12" rx="1.5"/>'};
    return '<svg viewBox="0 0 24 24" aria-hidden="true">'+(paths[name]||paths.image)+'</svg>';
  }
  function ratioInfo(value){
    if(value==='auto')return {label:'自动',orientation:'随内容',width:34,height:26};
    var parts=String(value).split(':').map(Number),r=parts[0]/parts[1];if(!Number.isFinite(r)||r<=0)r=1;
    return {label:value,orientation:r===1?'方形':r>1?'横幅':'竖幅',width:Math.round(Math.min(40,32*r)*100)/100,height:Math.round(Math.min(32,40/r)*100)/100};
  }
  function ratioPreview(value){
    var r=ratioInfo(value);
    return '<span class="arena-ratio-preview'+(value==='auto'?' automatic':'')+'" aria-hidden="true" style="--ratio-w:'+r.width+'px;--ratio-h:'+r.height+'px"><i></i></span>';
  }
  function radio(key,value,label,current,extra){
    return '<label class="arena-image-radio"><input type="radio" name="image-'+key+'" data-image-setting="'+key+'" value="'+escape(value)+'"'+(String(current)===String(value)?' checked':'')+'><span class="arena-image-radio-face">'+(extra||'')+'<span>'+escape(label)+'</span>'+icon('check')+'</span></label>';
  }
  function ratioMarkup(values,current){
    var r=ratioInfo(current);
    return '<details class="arena-image-disclosure arena-image-span" data-image-section="ratio"><summary><span>画面比例</span><span class="arena-image-selection" data-image-ratio-summary>'+ratioPreview(current)+'<span>'+escape(r.label)+' <small>'+r.orientation+'</small></span></span>'+icon('chevron')+'</summary><fieldset class="arena-image-field"><legend class="arena-sr-only">选择画面比例</legend><div class="arena-ratio-grid">'+values.map(function(value){var info=ratioInfo(value);return radio('ratio',value,info.label,current,ratioPreview(value)+'<small class="arena-ratio-direction">'+info.orientation+'</small>');}).join('')+'</div></fieldset></details>';
  }
  function cards(key,label,options,current,hint){
    return '<fieldset class="arena-image-field arena-image-span"><legend>'+escape(label)+'</legend><div class="arena-image-cards">'+options.map(function(o){return radio(key,o[0],o[1],current,icon(o[2]));}).join('')+'</div>'+(hint?'<p class="arena-image-field-help">'+escape(hint)+'</p>':'')+'</fieldset>';
  }
  function segments(key,label,options,value){
    return '<fieldset class="arena-image-field arena-image-span"><legend>'+escape(label)+'</legend><div class="arena-image-segments">'+options.map(function(o){o=Array.isArray(o)?o:[o,String(o).toUpperCase()];return '<label><input type="radio" name="image-'+key+'" data-image-setting="'+key+'" value="'+escape(o[0])+'"'+(String(value)===String(o[0])?' checked':'')+'><span>'+escape(o[1])+'</span></label>';}).join('')+'</div></fieldset>';
  }
  function settingsMarkup(model,task,state,styles){
    var c=cap(model), s=normalize(model,state);
    if(!c)return '';
    var h='<div class="arena-image-heading"><div><h2 id="aaImageSettingsTitle">图像设置</h2><p>'+escape(c.label)+' <span>· '+c.provider+'</span></p></div><button type="button" data-image-close aria-label="关闭图像设置">'+icon('close')+'</button></div>';
    h+='<div class="arena-image-form">';
    h+=ratioMarkup(c.ratios,s.ratio);
    if(!c.thinking&&task==='generation')h+=segments('count','生成数量',[[1,'1 张'],[2,'2 张'],[3,'3 张'],[4,'4 张']],s.count);
    h+=segments('size','分辨率',c.sizes,s.size);
    if(c.thinking){
      h+=segments('thinking','思考强度',[['minimal','快速'],['medium','均衡'],['high','深度']],s.thinking);
      var style=(styles||[]).find(function(o){return o.value===s.style;});
      h+='<details class="arena-image-disclosure arena-image-span" data-image-section="style"><summary><span>风格预设</span><span class="arena-image-selection" data-image-style-summary>'+escape(style?style.label:'无预设')+'</span>'+icon('chevron')+'</summary><fieldset class="arena-image-field"><legend class="arena-sr-only">选择风格预设</legend><div class="arena-style-grid">'+(styles||[]).map(function(o){return radio('style',o.value,o.label,s.style||'none');}).join('')+'</div></fieldset><p class="arena-image-field-help">把风格要求加入描述，引导画风；不会切换模型。</p></details>';
      h+=cards('grounding','联网参考',[['off','不搜索','off'],['web','网页资料','web'],['image','图片参考','image'],['web-image','网页 + 图片','search']],s.grounding,'按需查资料或找图片参考，不会强制搜索。开启后可能产生搜索费用。');
      h+=cards('imageOnly','回复形式',[['true','仅图片','image'],['false','图片 + 说明','text']],String(s.imageOnly),'控制图片外是否附说明，画面内的文字仍由你的描述决定。');
    }else h+=segments('quality','生成质量',[['auto','自动'],['low','标准'],['medium','精细']],s.quality);
    var referenceHint=task==='edit'?'单图编辑 · 1 张参考图':task==='multi-edit'?'2–'+c.references+' 张参考图 · 返回 1 张':'多图编辑最多 '+c.references+' 张参考图';
    h+='</div><div class="arena-image-settings-foot"><span>'+referenceHint+'</span><span>自动保存</span></div>';
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
  var api={GOOGLE_MODEL:GOOGLE_MODEL,capabilities:capabilities,canonical:canonical,cap:cap,normalize:normalize,requestOptions:requestOptions,settingsMarkup:settingsMarkup,historyFor:historyFor,icon:icon,ratioInfo:ratioInfo,ratioPreview:ratioPreview};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.ArenaImage=api;
})(typeof window!=='undefined'?window:this);
