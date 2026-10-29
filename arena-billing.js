/* Official API usage and USD rate card. No text-based token estimates. */
(function(root,factory){
  'use strict';
  var api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.ArenaBilling=api;
})(typeof window!=='undefined'?window:this,function(){
  'use strict';
  var VERSION='official-2026-10-30-v1', CHECKED='2026-10-30';
  var SOURCES={
    openai:'https://developers.openai.com/api/docs/pricing',
    anthropic:'https://platform.claude.com/docs/en/about-claude/pricing',
    google:'https://ai.google.dev/gemini-api/docs/pricing',
    xai:'https://docs.x.ai/developers/pricing',
    xaiCost:'https://docs.x.ai/developers/cost-tracking'
  };
  function card(name,provider,input,output,cached,extra){
    return Object.assign({name:name,provider:provider,input:input,output:output,cached:cached,source:SOURCES[provider]},extra||{});
  }
  var MODELS={
    'claude-fable-5-1':card('Claude Fable 5.1','anthropic','10','50','0.25',{writeShort:'12.5',writeLong:'20'}),
    'claude-opus-5-5':card('Claude Opus 5.5','anthropic','4','20','0.2',{writeShort:'5',writeLong:'8'}),
    'claude-sonnet-5-5':card('Claude Sonnet 5.5','anthropic','2','10','0.1',{writeShort:'2.5',writeLong:'4'}),
    'claude-opus-5':card('Claude Opus 5','anthropic','5','25','0.5',{writeShort:'6.25',writeLong:'10',legacy:true}),
    'claude-haiku-4-5-20251001':card('Claude Haiku 4.5（后台整理）','anthropic','1','5','0.1',{writeShort:'1.25',writeLong:'2',internal:true}),
    'gpt-6-astra':card('GPT-6 Astra','openai','10','50','1',{writeShort:'12.5',writeLong:'25',longAbove:272000,long:{input:'20',output:'75',cached:'2',writeShort:'25',writeLong:'50'}}),
    'gpt-6.1-sol':card('GPT-6.1 Sol','openai','2','10','0.1',{writeShort:'2.5',writeLong:'5',longAbove:272000,long:{input:'4',output:'15',cached:'0.2',writeShort:'5',writeLong:'10'}}),
    'gpt-5.6-sol':card('GPT-5.6 Sol','openai','4','20','0.4',{writeShort:'5',writeLong:'10',longAbove:272000,long:{input:'8',output:'30',cached:'0.8',writeShort:'10',writeLong:'20'},legacy:true}),
    'grok-4.7':card('Grok 4.7','xai','2','6','0.5',{longAt:200000,long:{input:'4',output:'12',cached:'1'}}),
    'gemini-4-argon':card('Gemini 4','google','2','10','0.1',{effectiveUntil:'2026-12-01',next:{input:'4',output:'20',cached:'0.2'},tiers:{FLEX:'0.5',PRIORITY:'1.8',CONTRIBUTOR:'0.5'}}),
    'gemini-3.8-flash':card('Gemini 3.8 Flash','google','0.75','3.75','0.075',{legacy:true,effectiveUntil:'2027-01-01',next:{input:'1.5',output:'7.5',cached:'0.15'}}),
    'gemini-3.1-pro-preview':card('Gemini 3.1 Pro','google','2','12','0.2',{longAbove:200000,long:{input:'4',output:'18',cached:'0.4'},legacy:true}),
    'gemini-nano-banana-2.1':card('Nano Banana 2.1','google','1.5','7.5',null,{image:true,imageOutput:'30',imageTokens:{'1K':1120,'2K':1680,'4K':3780}}),
    'gemini-3.1-flash-image':card('Gemini 3.1 Flash Image','google','0.5','3',null,{image:true,imageOutput:'60',legacy:true}),
    'gpt-image-2.5-sunburst':card('GPT Image 2.5 Sunburst','openai','5','30',null,{image:true,imageInput:'8',legacy:true}),
    'grok-imagine-image-2.0':{name:'Grok Image 2.0',provider:'xai',image:true,source:SOURCES.xai,inputImage:'0.01',
      outputImages:{'1k-low':'0.04','2k-low':'0.06','1k-medium':'0.06','2k-medium':'0.08'},providerAmount:true}
  };
  function freeze(value){if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.keys(value).forEach(function(key){freeze(value[key]);});Object.freeze(value);}return value;}
  freeze(MODELS);
  function count(value){return Number.isSafeInteger(value)&&value>=0?value:null;}
  function field(obj,key,zero){return obj&&Object.prototype.hasOwnProperty.call(obj,key)?count(obj[key]):zero?0:null;}
  function sum(values){var n=values.every(function(v){return v!==null;})?values.reduce(function(a,b){return a+b;},0):null;return count(n);}
  function units(value,scale){
    var m=/^(\d+)(?:\.(\d+))?$/.exec(String(value));
    if(!m||((m[2]||'').length>scale))return null;
    return BigInt(m[1])*10n**BigInt(scale)+BigInt(((m[2]||'')+'0'.repeat(scale)).slice(0,scale)||'0');
  }
  function usd(pico){
    var n=BigInt(pico),s=n.toString().padStart(13,'0');
    return s.slice(0,-12)+'.'+s.slice(-12).replace(/0+$/,'').padEnd(2,'0');
  }
  function exactTicks(value){
    if(typeof value==='number'&&!Number.isSafeInteger(value))return null;
    if(!/^\d+$/.test(String(value)))return null;
    return BigInt(String(value))*100n;
  }
  function ownCard(id){return Object.prototype.hasOwnProperty.call(MODELS,id)?MODELS[id]:null;}
  function counterDetails(raw,provider,model,options){
    var d={uncachedInput:null,cachedInput:0,cacheWriteShort:0,cacheWriteLong:0,cacheWriteUnknown:0,
      outputText:null,outputImage:0,outputReasoning:0,toolInput:0,billableInput:null};
    var input=null,output=null,issues=[],cache;
    if(!raw||typeof raw!=='object')return {input:input,output:output,details:d,issues:['usage_missing']};
    if(provider==='anthropic'){
      d.uncachedInput=field(raw,'input_tokens');d.cachedInput=field(raw,'cache_read_input_tokens',true);
      var created=field(raw,'cache_creation_input_tokens',true),split=raw.cache_creation;
      if(split){d.cacheWriteShort=field(split,'ephemeral_5m_input_tokens',true);d.cacheWriteLong=field(split,'ephemeral_1h_input_tokens',true);
        if(created!==sum([d.cacheWriteShort,d.cacheWriteLong]))issues.push('cache_write_total_mismatch');
      }else d.cacheWriteShort=created; // Anthropic's default/server-tool cache lifetime is 5 minutes.
      input=sum([d.uncachedInput,d.cachedInput,d.cacheWriteShort,d.cacheWriteLong]);
      output=field(raw,'output_tokens');d.outputText=output;d.billableInput=input;
    }else if(provider==='google'){
      var prompt=field(raw,'promptTokenCount');d.toolInput=field(raw,'toolUsePromptTokenCount',true);
      d.cachedInput=field(raw,'cachedContentTokenCount',true);
      input=sum([prompt,d.toolInput]);d.billableInput=prompt;
      d.uncachedInput=prompt===null||d.cachedInput===null?null:prompt-d.cachedInput;
      var candidates=field(raw,'candidatesTokenCount',true);d.outputReasoning=field(raw,'thoughtsTokenCount',true);
      output=sum([candidates,d.outputReasoning]);
      if(ownCard(model)&&ownCard(model).image){
        var details=raw.candidatesTokensDetails;
        if(candidates===0){d.outputImage=0;d.outputText=d.outputReasoning;}
        else if(Array.isArray(details)&&details.length){
          var total=0,text=0,image=0,unknown=false;
          details.forEach(function(v){var n=field(v,'tokenCount');if(n===null){unknown=true;return;}total+=n;if(v.modality==='IMAGE')image+=n;else if(v.modality==='TEXT')text+=n;else if(n)unknown=true;});
          if(unknown||total!==candidates){issues.push('image_modality_usage_missing');d.outputText=d.outputImage=null;}
          else{d.outputImage=image;d.outputText=sum([text,d.outputReasoning]);}
        }else{d.outputText=d.outputImage=null;issues.push('image_modality_usage_missing');}
      }else{d.outputText=output;d.billableInput=input;d.uncachedInput=input===null||d.cachedInput===null?null:input-d.cachedInput;}
      if(raw.totalTokenCount!==undefined&&sum([input,output])!==field(raw,'totalTokenCount'))issues.push('reported_total_mismatch');
    }else{
      input=field(raw,'input_tokens');output=field(raw,'output_tokens');
      cache=raw.input_tokens_details;
      d.cachedInput=cache?field(cache,'cached_tokens',true):0;
      var writes=cache?field(cache,'cache_write_tokens',true):0,writeParts=cache&&cache.cache_write_tokens_details;
      if(writeParts){
        d.cacheWriteShort=field(writeParts,'ttl_30m_tokens',true);d.cacheWriteLong=field(writeParts,'ttl_12h_tokens',true);
        if(writes!==sum([d.cacheWriteShort,d.cacheWriteLong]))issues.push('cache_write_total_mismatch');
      }else if(writes){d.cacheWriteUnknown=writes;issues.push('cache_write_lifetime_missing');}
      d.uncachedInput=input===null?null:input-(d.cachedInput||0)-(writes||0);d.billableInput=input;
      d.outputReasoning=raw.output_tokens_details?field(raw.output_tokens_details,'reasoning_tokens',true):0;
      // Responses output_tokens already includes reasoning. Do not add it twice.
      if(ownCard(model)&&ownCard(model).image){
        d.outputImage=output;d.outputText=0;
        d.inputText=cache?field(cache,'text_tokens'):null;d.inputImage=cache?field(cache,'image_tokens'):null;
        if(sum([d.inputText,d.inputImage])!==input)issues.push('image_input_usage_missing');
      }else d.outputText=output;
      if(!cache&&input>0&&!(ownCard(model)&&ownCard(model).image)){d.uncachedInput=null;d.cachedInput=null;issues.push('cache_details_missing');}
      if(cache&&input>0&&!(ownCard(model)&&ownCard(model).image)){
        if(!Object.prototype.hasOwnProperty.call(cache,'cached_tokens')){d.cachedInput=null;d.uncachedInput=null;issues.push('cache_details_missing');}
        if(provider==='openai'&&!Object.prototype.hasOwnProperty.call(cache,'cache_write_tokens')){d.uncachedInput=null;d.cacheWriteShort=d.cacheWriteLong=null;issues.push('cache_write_usage_missing');}
      }
    }
    if(issues.indexOf('cache_write_total_mismatch')!==-1){['uncachedInput','cachedInput','cacheWriteShort','cacheWriteLong'].forEach(function(key){d[key]=null;});if(provider==='anthropic')input=null;}
    Object.keys(d).forEach(function(key){if(d[key]!==null&&count(d[key])===null){d[key]=null;issues.push('invalid_counter:'+key);}});
    if(input===null||output===null)issues.push('token_totals_missing');
    return {input:input,output:output,details:d,issues:issues};
  }
  function receipt(model,raw,options){
    options=options||{};var config=ownCard(model),provider=options.provider||(config&&config.provider)||'unknown';
    var normalized=counterDetails(raw,provider,model,options),d=normalized.details,issues=normalized.issues.slice(),items=[],known=0n;
    var timestamp=options.at===undefined?Date.now():Number(options.at),rates=config&&Object.assign({},config),tier=String(options.serviceTier||(raw&&(raw.serviceTier||raw.service_tier))||'STANDARD').toUpperCase(),long=false;
    if(rates&&rates.effectiveUntil&&new Date(timestamp).toISOString().slice(0,10)>=rates.effectiveUntil)Object.assign(rates,rates.next);
    if(rates&&((rates.longAt!==undefined&&normalized.input>=rates.longAt)||(rates.longAbove!==undefined&&normalized.input>rates.longAbove))){Object.assign(rates,rates.long);long=true;}
    if(rates&&rates.long&&normalized.input===null){['input','output','cached','writeShort','writeLong'].forEach(function(key){rates[key]=null;});issues.push('context_tier_unknown');}
    var multiplier='1';
    if(provider==='openai'&&!rates?.image){multiplier=({STANDARD:'1',DEFAULT:'1',FAST:'2',PRIORITY:'2',FLEX:'0.5',ULTRAFAST:'6'})[tier];}
    else if(provider==='anthropic'&&tier!=='STANDARD'&&tier!=='STANDARD_ONLY')multiplier=null;
    else if(provider==='google'&&tier!=='STANDARD'&&tier!=='SERVICE_TIER_UNSPECIFIED'&&tier!=='DEFAULT')multiplier=rates&&rates.tiers&&rates.tiers[tier];
    if(!multiplier)issues.push('service_tier_unpriced');
    function add(kind,n,rate,scale){
      var unit=rate===null||rate===undefined?null:units(rate,scale===undefined?6:scale),factor=scale===9?1000000n:multiplier?units(multiplier,6):null,amount=null;
      if(n!==null&&unit!==null&&factor!==null){amount=BigInt(n)*unit*factor/1000000n;known+=amount;}
      else if(n!==0)issues.push('unpriced:'+kind);
      items.push({kind:kind,count:n,rate:rate===undefined?null:rate,unit:scale===9?'per_1000_calls':'per_million_tokens',amountUsd:amount===null?null:usd(amount)});
    }
    if(!config)issues.push('model_price_unverified');
    else if(config.providerAmount){items.push({kind:'generatedImages',count:count(options.imagesGenerated),rate:null,unit:'provider_reported',amountUsd:null});}
    else if(provider==='openai'&&config.image){
      add('inputText',d.inputText,rates.input);add('inputImage',d.inputImage,rates.imageInput);add('outputImage',d.outputImage,rates.output);
    }else{
      add('uncachedInput',d.uncachedInput,rates.input);add('cachedInput',d.cachedInput,rates.cached);
      if(provider==='openai'||provider==='anthropic'){add('cacheWriteShort',d.cacheWriteShort,rates.writeShort);add('cacheWriteLong',d.cacheWriteLong,rates.writeLong);}
      add('outputText',d.outputText,rates.output);if(config.image)add('outputImage',d.outputImage,rates.imageOutput);
    }
    var searches=options.searches;
    if(provider==='anthropic'){
      var server=raw&&raw.server_tool_use;
      var n=server&&server.web_search_requests!==undefined?field(server,'web_search_requests'):searches===undefined?0:count(searches);
      if(n!==0)add('webSearch',n,'10',9);
    }else if(provider==='openai'&&searches!==undefined&&searches!==0)add('webSearch',count(searches),'10',9);
    else if(provider==='google'&&(options.groundingUsed||options.groundingRequested)){
      issues.push('google_search_free_allowance_unknown');
      items.push({kind:'googleSearch',count:options.groundingUsed?count(options.searches):null,rate:'14',unit:'per_1000_calls_after_shared_free_allowance',amountUsd:null});
    }else if(provider==='xai'&&searches!==undefined&&searches!==0)add('webSearch',count(searches),'5',9);
    if(options.incompleteUsage)issues.push('final_usage_missing');
    var official=provider==='xai'&&raw&&!options.incompleteUsage?exactTicks(raw.cost_in_usd_ticks):null;
    var complete=official!==null||!!config&&issues.length===0&&normalized.input!==null&&normalized.output!==null&&!config.providerAmount;
    var amount=official!==null?official:complete?known:null,basis=official!==null?'provider':complete?'official_rates':known>0n?'partial':'unavailable';
    var value={schemaVersion:2,id:options.id||null,model:model,provider:provider,purpose:options.purpose||'reply',at:timestamp,input:normalized.input,output:normalized.output,
      usageComplete:!options.incompleteUsage&&normalized.input!==null&&normalized.output!==null,details:d,items:items,notes:Array.from(new Set(issues)),
      cost:amount===null?null:Number(usd(amount)),costUsd:amount===null?null:usd(amount),costPico:amount===null?null:amount.toString(),
      knownCostUsd:usd(official!==null?official:known),knownCostPico:(official!==null?official:known).toString(),costBasis:basis,billingComplete:complete,
      rateCard:{version:VERSION,checkedAt:CHECKED,prices:rates?{input:rates.input,output:rates.output,cached:rates.cached,writeShort:rates.writeShort,writeLong:rates.writeLong,imageOutput:rates.imageOutput}:null,source:official!==null?SOURCES.xaiCost:config&&config.source||null,tier:tier,longContext:long}};
    if(official!==null){value.providerCostTicks=String(raw.cost_in_usd_ticks);value.items=[{kind:'providerAmount',count:1,rate:null,unit:'USD',amountUsd:usd(official)}];}
    return value;
  }
  function combine(primary,extra){
    if(!primary||primary.schemaVersion!==2)return primary;
    var own=Object.assign({},primary),children=[],seen=new Set(),all=(primary.auxiliary||[]).concat(extra||[]);
    delete own.auxiliary;
    all.forEach(function(child){if(!child||child.schemaVersion!==2||child.id&&seen.has(child.id))return;if(child.id)seen.add(child.id);children.push(child);});
    if(!children.length)return own;
    // Keep each provider request separate in the ledger; this is a UI total.
    var records=[own].concat(children),known=records.reduce(function(n,r){return n+BigInt(r.knownCostPico||'0');},0n),complete=records.every(function(r){return r.billingComplete;});
    own.auxiliary=children;own.requestCostUsd=primary.requestCostUsd||primary.costUsd;own.requestCostPico=primary.requestCostPico||primary.costPico;own.requestKnownCostPico=primary.requestKnownCostPico||primary.knownCostPico;
    if(primary.auxiliary){known=BigInt(own.requestKnownCostPico||'0')+children.reduce(function(n,r){return n+BigInt(r.knownCostPico||'0');},0n);complete=primary.requestBillingComplete!==undefined?primary.requestBillingComplete&&children.every(function(r){return r.billingComplete;}):complete;}
    own.requestBillingComplete=primary.requestBillingComplete===undefined?primary.billingComplete:primary.requestBillingComplete;
    own.knownCostPico=known.toString();own.knownCostUsd=usd(known);own.billingComplete=complete;
    own.costPico=complete?known.toString():null;own.costUsd=complete?usd(known):null;own.cost=complete?Number(usd(known)):null;own.costBasis=complete?'official_rates':known>0n?'partial':'unavailable';
    return own;
  }
  function money(value){
    if(value===null||value===undefined)return '待结算';
    var p=units(value,12);if(p===null)return '待结算';
    if(p===0n)return '$0.00';
    return '$'+usd(p);
  }
  function label(value,legacyText){
    if(!value||value.schemaVersion!==2){
      var parts=[];if(value&&count(value.input)!==null)parts.push('输入 '+value.input);if(value&&count(value.output)!==null)parts.push('输出 '+value.output);
      return (parts.length?parts.join(' · ')+' · ':'')+(value||legacyText?'历史费用未核实':'');
    }
    if(!isReceipt(value))return '费用明细需核实';
    var p=[];p.push(value.input===null?'输入未提供':(value.usageComplete?'输入 ':'已返回输入 ')+value.input);p.push(value.output===null?'输出未提供':(value.usageComplete?'输出 ':'已返回输出 ')+value.output);
    if(value.billingComplete)p.push((value.costBasis==='provider'?'官方金额 ':'按官方价 ')+money(value.costUsd));
    else p.push(BigInt(value.knownCostPico||'0')>0n?'已知费用 '+money(value.knownCostUsd)+'，另有待结算费用':'费用待结算');
    return p.join(' · ');
  }
  function publicCard(id,at){
    var value=ownCard(id);if(!value)return null;
    var result=Object.assign({},value),date=new Date(at===undefined?Date.now():at).toISOString().slice(0,10);
    if(value.effectiveUntil&&date>=value.effectiveUntil)Object.assign(result,value.next);
    return result;
  }
  function isReceipt(value){
    return !!value&&value.schemaVersion===2&&typeof value.model==='string'&&[value.input,value.output].every(function(n){return n===null||count(n)!==null;})
      &&typeof value.knownCostPico==='string'&&/^\d{1,48}$/.test(value.knownCostPico)&&typeof value.billingComplete==='boolean'
      &&(value.costPico===null||typeof value.costPico==='string'&&/^\d{1,48}$/.test(value.costPico));
  }
  return Object.freeze({VERSION:VERSION,CHECKED:CHECKED,SOURCES:SOURCES,MODELS:MODELS,publicCard:publicCard,isReceipt:isReceipt,receipt:receipt,combine:combine,usd:usd,money:money,label:label,count:count});
});
