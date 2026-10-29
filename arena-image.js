(function(root){
  'use strict';
  var Slider=typeof module==='object'&&module.exports?require('./arena-slider.js'):root.ArenaSlider;
  var GOOGLE_MODEL = 'gemini-nano-banana-2.1';
  var OPENAI_MODELS = ['gpt-image-2.5-sunburst','gpt-image-2.5-flare'];
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
  OPENAI_MODELS.forEach(function(model){capabilities[model]={
    label:model.endsWith('sunburst')?'GPT Image 2.5 Sunburst':'GPT Image 2.5 Flare',provider:'OpenAI',openai:true,references:16,
    ratios:['auto'],sizes:['auto','1024x1024','1536x1024','1024x1536','2048x2048','2048x1152','1152x2048','3840x2160','2160x3840','custom'],
    quality:['auto','low','medium','high','xhigh','max']
  };});
  function isOpenAI(model){return OPENAI_MODELS.indexOf(model)!==-1;}
  function validSize(size){
    if(size==='auto')return true;
    var match=/^(\d{3,4})x(\d{3,4})$/.exec(String(size));if(!match)return false;
    var w=Number(match[1]),h=Number(match[2]);
    return w%16===0&&h%16===0&&Math.max(w,h)<=3840&&Math.max(w,h)/Math.min(w,h)<=3&&w*h>=655360&&w*h<=8294400;
  }
  function outputSize(state){return state.size==='custom'?state.customWidth+'x'+state.customHeight:state.size;}
  function sizeInfo(value,state,large){
    state=state||{};var actual=value==='custom'?state.customWidth+'x'+state.customHeight:value,parts=String(actual).split('x').map(Number),w=parts[0],h=parts[1];
    if(value==='auto')return {width:large?126:34,height:large?84:26,ratio:'随内容',orientation:'自动画幅',resolution:'自动'};
    if(!Number.isFinite(w)||!Number.isFinite(h)||w<=0||h<=0)return {width:large?90:32,height:large?90:32,ratio:'—',orientation:'填写宽高',resolution:'输入宽度和高度',empty:true};
    var scale=Math.min(156/w,108/h),frame=ratioInfo(w+':'+h),a=w,b=h;
    if(Number.isInteger(a)&&Number.isInteger(b)){while(b){var next=a%b;a=b;b=next;}}
    else a=1;
    return {width:large?Math.round(w*scale*100)/100:frame.width,height:large?Math.round(h*scale*100)/100:frame.height,ratio:(w/a)+':'+(h/a),orientation:w===h?'方形':w>h?'横幅':'竖幅',resolution:w+' × '+h};
  }
  function sizePreview(value,state,large){
    var info=sizeInfo(value,state,large);
    return framePreview(info,value==='auto'||info.empty,large,' data-size-preview');
  }
  function sizeChoice(value,current,state){
    var info=sizeInfo(value,state),label=value==='auto'?'自动':value==='custom'?'自定义':info.ratio;
    var caption=value==='auto'?'随内容':value==='custom'?info.ratio+' '+info.orientation:info.resolution.replace(/\s+/g,'');
    return frameChoice('size',value,label,current,sizePreview(value,state),caption,value==='custom');
  }
  function sizeSummary(state){
    var info=sizeInfo(state.size,state),label=info.resolution.replace(/\s+/g,'');
    if(state.size==='custom')label='自定义 '+label;
    return sizePreview(state.size,state)+'<span>'+escape(label)+' <small>'+escape(state.size==='auto'?'随内容':info.ratio+' '+info.orientation)+'</small></span>';
  }
  function customSizePreview(state){
    var info=sizeInfo('custom',state,true),valid=validSize(outputSize(Object.assign({},state,{size:'custom'})));
    return sizePreview('custom',state,true)+'<span><strong>'+escape(info.resolution)+'</strong><span>'+escape(info.ratio+' '+info.orientation)+'</span>'+(valid?'':'<small>尺寸须满足下方范围要求</small>')+'</span>';
  }
  function canonical(model){ return model==='gemini-3.1-flash-image'||model==='nanbanana2-official' ? GOOGLE_MODEL : model; }
  function cap(model){ return capabilities[canonical(model)]; }
  function pick(value, values, fallback){ return values.indexOf(value)>=0?value:fallback; }
  function normalize(model, state){
    var c=cap(model), s=Object.assign({},state);
    if(!c)return s;
    s.ratio=pick(s.ratio,c.ratios,'1:1');
    s.size=pick(s.size,c.sizes,c.sizes[0]);
    if(c.thinking){s.thinking=pick(s.thinking,c.thinking,'medium');s.grounding=pick(s.grounding,['off','web','image','web-image'],'off');s.imageOnly=!!s.imageOnly;}
    if(c.quality){s.quality=pick(s.quality,c.quality,'auto');s.count=pick(Number(s.count),c.openai?[1,2,3,4,5,6,7,8,9,10]:[1,2,3,4],1);}
    if(c.openai){
      s.format=pick(s.format,['png','jpeg','webp'],'png');s.background=pick(s.background,['auto','opaque','transparent'],'auto');
      if(s.background==='transparent'&&s.format==='jpeg')s.format='png';
      s.compression=Number.isInteger(Number(s.compression))&&Number(s.compression)>=0&&Number(s.compression)<=100?Number(s.compression):100;
      s.partial=pick(Number(s.partial),[0,1,2,3],2);s.moderation=pick(s.moderation,['auto','low'],'auto');
      s.customWidth=s.customWidth===undefined?1536:Number(s.customWidth);s.customHeight=s.customHeight===undefined?864:Number(s.customHeight);
    }
    return s;
  }
  function requestOptions(model,task,state,images,history){
    model=canonical(model);
    var s=normalize(model,state), opts={imageTask:task,aspectRatio:s.ratio,_imgs:images||[]};
    if(model===GOOGLE_MODEL){
      Object.assign(opts,{imageSize:s.size,thinkingLevel:s.thinking,imageOnly:s.imageOnly,grounding:s.grounding,n:1});
      if(task!=='generation'&&history&&history.length)opts.imageHistory=history;
    }else if(isOpenAI(model)){
      delete opts.aspectRatio;
      Object.assign(opts,{size:outputSize(s),quality:s.quality,outputFormat:s.format,background:s.background,moderation:s.moderation,partialImages:s.partial,n:s.count});
      if(s.format!=='png')opts.outputCompression=s.compression;
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
  function framePreview(info,automatic,large,attributes){
    return '<span class="arena-ratio-preview'+(automatic?' automatic':'')+(large?' large':'')+'"'+(attributes||'')+' aria-hidden="true" style="--ratio-w:'+info.width+'px;--ratio-h:'+info.height+'px"><i></i></span>';
  }
  function ratioPreview(value){
    return framePreview(ratioInfo(value),value==='auto');
  }
  function radio(key,value,label,current,extra,custom){
    return '<label class="arena-image-radio"'+(custom?' data-custom-size-card':'')+'><input type="radio" name="image-'+key+'" data-image-setting="'+key+'" value="'+escape(value)+'"'+(String(current)===String(value)?' checked':'')+'><span class="arena-image-radio-face">'+(extra||'')+'<span>'+escape(label)+'</span></span></label>';
  }
  function frameChoice(key,value,label,current,preview,caption,custom){
    return radio(key,value,label,current,preview+'<small class="arena-ratio-direction"'+(key==='size'?' data-size-ratio':'')+'>'+escape(caption)+'</small>',custom);
  }
  function frameSection(key,label,legend,summary,choices,extra){
    return '<details class="arena-image-disclosure arena-image-span" data-image-section="'+key+'"><summary><span>'+escape(label)+'</span><span class="arena-image-selection" data-image-'+key+'-summary>'+summary+'</span>'+icon('chevron')+'</summary><fieldset class="arena-image-field"><legend class="arena-sr-only">'+escape(legend)+'</legend><div class="arena-ratio-grid">'+choices+'</div>'+(extra||'')+'</fieldset></details>';
  }
  function ratioMarkup(values,current){
    var r=ratioInfo(current);
    return frameSection('ratio','画面比例','选择画面比例',ratioPreview(current)+'<span>'+escape(r.label)+' <small>'+r.orientation+'</small></span>',values.map(function(value){var info=ratioInfo(value);return frameChoice('ratio',value,info.label,current,ratioPreview(value),info.orientation);}).join(''));
  }
  function cards(key,label,options,current,hint){
    return '<fieldset class="arena-image-field arena-image-span"><legend>'+escape(label)+'</legend><div class="arena-image-cards">'+options.map(function(o){return radio(key,o[0],o[1],current,icon(o[2]));}).join('')+'</div>'+(hint?'<p class="arena-image-field-help">'+escape(hint)+'</p>':'')+'</fieldset>';
  }
  function segments(key,label,options,value){
    return '<fieldset class="arena-image-field arena-image-span"><legend>'+escape(label)+'</legend><div class="arena-image-segments">'+options.map(function(o){o=Array.isArray(o)?o:[o,String(o).toUpperCase()];return '<label><input type="radio" name="image-'+key+'" data-image-setting="'+key+'" value="'+escape(o[0])+'"'+(String(value)===String(o[0])?' checked':'')+'><span>'+escape(o[1])+'</span></label>';}).join('')+'</div></fieldset>';
  }
  function slider(key,label,values,value,options){
    options=options||{};
    var automatic=!!options.auto&&value==='auto',labels=values&&values.map(function(v){return v[1];}),items=values&&values.map(function(v){return v[0];});
    var min=values?0:options.min,max=values?values.length-1:options.max,index=values?Math.max(0,items.indexOf(value)):Number(value);
    if(automatic)index=Math.min(1,max);
    var text=automatic?'自动':values?labels[index]:String(value)+(options.unit||''),prefix='aaImage'+key[0].toUpperCase()+key.slice(1);
    return '<div class="arena-image-field arena-image-slider-field'+(options.wide?' arena-image-span':'')+'" data-image-slider-field="'+key+'"'+(options.hidden?' hidden':'')+'><div class="arena-image-slider-heading"><label for="'+prefix+'EffortSlider">'+escape(label)+'</label><div><output data-image-slider-output'+(automatic?' hidden':'')+' for="'+prefix+'EffortSlider" aria-live="polite">'+escape(text)+'</output>'+(options.auto?'<button type="button" class="arena-image-slider-auto arena-effort-reset" data-image-auto="'+key+'" data-image-setting="'+key+'" value="auto" aria-pressed="'+automatic+'">自动</button>':'')+'</div></div>'
      +Slider.markup({externalLabel:true,prefix:prefix,min:min,max:max,value:index,label:label,valueText:text,left:options.left||(labels&&labels[0])||(min+(options.unit||'')),right:options.right||(labels&&labels[labels.length-1])||(max+(options.unit||'')),attributes:{'data-image-setting':key,'data-image-slider':items?items.join('|'):'','data-image-labels':labels?labels.join('|'):'','data-image-unit':options.unit||''}})+'</div>';
  }
  function sliderValue(control){
    var values=control.dataset.imageSlider?control.dataset.imageSlider.split('|'):null;
    return values?values[Number(control.value)]:control.value;
  }
  function syncSliders(host,state){
    host.querySelectorAll('[data-image-slider]').forEach(function(input){
      var field=input.closest('[data-image-slider-field]'),value=state[input.dataset.imageSetting],values=input.dataset.imageSlider?input.dataset.imageSlider.split('|'):null,labels=(input.dataset.imageLabels||'').split('|');
      var auto=value==='auto',index=values?values.indexOf(value):Number(value);
      if(!auto&&index>=Number(input.min)&&index<=Number(input.max))input.value=String(index);
      var text=auto?'自动':values?labels[index]:String(value)+(input.dataset.imageUnit||'');
      var output=field.querySelector('[data-image-slider-output]');output.textContent=text;output.hidden=auto;input.setAttribute('aria-valuetext',text);
      var scale=field.querySelector('.arena-effort-scale'),fraction=(Number(input.value)-Number(input.min))/(Number(input.max)-Number(input.min));
      scale.dataset.sliderAuto=String(auto);scale.classList.toggle('is-auto',auto);scale.style.setProperty('--effort-progress',(fraction*100)+'%');
      scale.querySelectorAll('.arena-effort-ticks > span').forEach(function(tick){tick.classList.toggle('is-filled',!auto&&parseFloat(tick.style.left)/100<=fraction);});
      var button=field.querySelector('[data-image-auto]');if(button)button.setAttribute('aria-pressed',String(auto));
    });
  }
  function settingsMarkup(model,task,state,styles){
    var c=cap(model), s=normalize(model,state);
    if(!c)return '';
    var h='<div class="arena-image-heading"><div><h2 id="aaImageSettingsTitle">图像设置</h2><p>'+escape(c.label)+' <span>· '+c.provider+'</span></p></div><button type="button" data-image-close aria-label="关闭图像设置">'+icon('close')+'</button></div>';
    h+='<div class="arena-image-form'+(c.openai?' arena-image-openai':'')+'">';
    if(c.openai){
      var custom='<div class="arena-image-custom-wrap"'+(s.size==='custom'?'':' hidden')+'><div class="arena-image-custom"><label>宽度（像素）<input type="number" data-image-setting="customWidth" aria-label="自定义图片宽度" min="256" max="3840" step="16" value="'+escape(s.customWidth)+'"></label><span>×</span><label>高度（像素）<input type="number" data-image-setting="customHeight" aria-label="自定义图片高度" min="256" max="3840" step="16" value="'+escape(s.customHeight)+'"></label></div><div class="arena-image-custom-preview" data-custom-size-preview aria-live="polite">'+customSizePreview(s)+'</div></div>';
      custom+='<p class="arena-image-field-help">尺寸须为 16 的倍数，长宽比不超过 3:1，总像素 655,360–8,294,400。超过 2560 × 1440 为实验性分辨率。</p>';
      h+=frameSection('size','画面比例','选择图片尺寸',sizeSummary(s),c.sizes.map(function(v){return sizeChoice(v,s.size,s);}).join(''),custom);
      h+=slider('quality','画质',[['low','草稿'],['medium','标准'],['high','精细'],['xhigh','超精细'],['max','最高']],s.quality,{auto:true,wide:true});
      if(model.endsWith('flare'))h+='<p class="arena-image-field-help arena-image-span">Flare 注重速度；对照片质感要求高，可选择画质优先的 Sunburst。</p>';
      h+=segments('format','文件格式',[['png','PNG'],['jpeg','JPEG'],['webp','WebP']],s.format);
      h+=segments('background','背景',[['auto','自动'],['opaque','不透明'],['transparent','透明']],s.background);
      h+='<p class="arena-image-field-help arena-image-span">透明背景使用 PNG 或 WebP；选择透明时会自动改用 PNG 保存。</p>';
      h+=slider('count',task==='generation'?'生成数量':'编辑版本数',null,s.count,{min:1,max:10,unit:' 张',wide:true});
      h+=slider('compression','保存质量',null,s.compression,{min:0,max:100,unit:'%',left:'更小文件',right:'更高保真',wide:true,hidden:s.format==='png'});
      h+='<p class="arena-image-field-help arena-image-span">每张独立生成，逐张显示并计费。画质越高、尺寸越大，通常等待越久、费用越高。</p>';
      h+='<details class="arena-image-disclosure arena-image-span"><summary><span>高级选项</span>'+icon('chevron')+'</summary>'+slider('partial','生成过程预览',null,s.partial,{min:0,max:3,unit:' 次',left:'关闭',right:'3 次',wide:true})+segments('moderation','内容过滤',[['auto','标准'],['low','较宽松']],s.moderation)+'<p class="arena-image-field-help">预览次数是上限，可能提前成图；每次预览额外计入 100 个图像输出 token。较宽松仍须符合 OpenAI 内容政策。</p></details>';
      return h+'</div><div class="arena-image-settings-foot"><span>最多 16 张参考图 · 单图 10MB · 按 token 计费</span><a href="https://developers.openai.com/api/docs/guides/image-generation" target="_blank" rel="noopener noreferrer">OpenAI 官方说明</a></div>';
    }
    h+=ratioMarkup(c.ratios,s.ratio);
    if(!c.thinking&&task==='generation')h+=slider('count','生成数量',null,s.count,{min:1,max:4,unit:' 张',wide:true});
    h+=slider('size','分辨率',c.sizes.map(function(v){return [v,String(v).toUpperCase()];}),s.size,{wide:true});
    if(c.thinking){
      h+=slider('thinking','思考强度',[['minimal','快速'],['medium','均衡'],['high','深度']],s.thinking,{wide:true});
      var style=(styles||[]).find(function(o){return o.value===s.style;});
      h+='<details class="arena-image-disclosure arena-image-span" data-image-section="style"><summary><span>风格预设</span><span class="arena-image-selection" data-image-style-summary>'+escape(style?style.label:'无预设')+'</span>'+icon('chevron')+'</summary><fieldset class="arena-image-field"><legend class="arena-sr-only">选择风格预设</legend><div class="arena-style-grid">'+(styles||[]).map(function(o){return radio('style',o.value,o.label,s.style||'none');}).join('')+'</div></fieldset><p class="arena-image-field-help">把风格要求加入描述，引导画风；不会切换模型。</p></details>';
      h+=cards('grounding','联网参考',[['off','不搜索','off'],['web','网页资料','web'],['image','图片参考','image'],['web-image','网页 + 图片','search']],s.grounding,'按需查资料或找图片参考，不会强制搜索。开启后可能产生搜索费用。');
      h+=cards('imageOnly','回复形式',[['true','仅图片','image'],['false','图片 + 说明','text']],String(s.imageOnly),'控制图片外是否附说明，画面内的文字仍由你的描述决定。');
    }else h+=slider('quality','生成质量',[['low','标准'],['medium','精细']],s.quality,{auto:true,wide:true});
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
  var api={GOOGLE_MODEL:GOOGLE_MODEL,OPENAI_MODELS:OPENAI_MODELS,isOpenAI:isOpenAI,validSize:validSize,outputSize:outputSize,sizeInfo:sizeInfo,sizePreview:sizePreview,sizeChoice:sizeChoice,sizeSummary:sizeSummary,customSizePreview:customSizePreview,capabilities:capabilities,canonical:canonical,cap:cap,normalize:normalize,requestOptions:requestOptions,settingsMarkup:settingsMarkup,sliderValue:sliderValue,syncSliders:syncSliders,historyFor:historyFor,icon:icon,ratioInfo:ratioInfo,ratioPreview:ratioPreview};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.ArenaImage=api;
})(typeof window!=='undefined'?window:this);
