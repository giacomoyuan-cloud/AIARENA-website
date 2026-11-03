/* Shared bounded context and exact-text retrieval; history stays in storage. */
(function(root){
  'use strict';
  var STOP = new Set(('the and this that with from have what when where which please would could should about hello thanks thank you project projects file files document documents '+
    '你好 谢谢 请问 一下 什么 怎么 如何 可以 这个 那个 我们 你们 他们 是否 需要 一个 一些 根据 相关 内容 介绍 详细 分析 多少 还有 现在 进行 以及 其中 项目 资料 文件 文档 本项 本轮 本次').split(/\s+/));
  function terms(value){
    var text=String(value||'').normalize('NFKC').toLowerCase(), seen=new Set();
    (text.match(/[a-z0-9][a-z0-9_-]{1,48}/g)||[]).forEach(function(t){if(!STOP.has(t))seen.add(t);});
    (text.match(/[\u3400-\u9fff]+/g)||[]).forEach(function(run){
      for(var i=0;i<run.length-1;i++){var t=run.slice(i,i+2);if(!STOP.has(t))seen.add(t);}
    });
    return Array.from(seen).slice(0,1600);
  }
  function clip(value,max){
    value=String(value||'');
    if(value.length<=max)return value;
    var head=Math.max(0,Math.floor((max-18)*.7)),tail=Math.max(0,max-head-18);
    return value.slice(0,head)+'\n[中间内容省略]\n'+value.slice(-tail);
  }
  var PARTIAL='[以下是已收到但尚未完成的回复；可在此基础上接续，不代表任务已完成]';
  function partial(message){return !!(message&&(message.contextPartial||message.partial||(message.isError||message.run&&['failed','interrupted','cancelled'].includes(message.run.status))&&message.diagnostics&&message.diagnostics.firstTextAt||message.isError&&message.generationError&&message.text&&message.text!==message.generationError));}
  function plain(message,full){
    if(!message)return '';
    var text=full&&typeof message.original==='string'?message.original:(message.text||message.content||'');
    if(message.isUser && typeof message.topicText==='string')text=message.topicText;
    if(message._quote)text='引用'+(full&&message._quote.author?'（'+message._quote.author+'）':'')+'：'+message._quote.text+'\n'+text;
    if(full && message.pastedTexts && message.pastedTexts.length)text+='\n'+message.pastedTexts.join('\n');
    if(full && Array.isArray(message.citations)){
      var sources=message.citations.map(function(source){
        try{var url=new URL(source.url);if(/^https?:$/.test(url.protocol)&&!url.username&&!url.password)return String(source.title||'参考来源')+' '+url.href;}catch(ignore){}
        return '';
      }).filter(Boolean);
      if(sources.length)text+='\n参考来源：\n'+sources.join('\n');
    }
    text=String(text).replace(/\[\[aa-citation:\d+\]\]/g,'').replace(/ \[img\]/g,' [图片]');
    if(message.isError&&message.generationError){var suffix='\n\n['+message.generationError+']';if(text.endsWith(suffix))text=text.slice(0,-suffix.length);}
    if(!(message.isUser||message.role==='user')&&partial(message)&&!text.startsWith(PARTIAL))text=PARTIAL+'\n'+text;
    return text;
  }
  // Keep the user's own request separate from quoted/reference material. A PDF
  // saying "remember" must never become a user preference or a task decision.
  function userText(message){
    if(!message)return '';
    if(typeof message.userText==='string')return message.userText;
    if(typeof message.topicText==='string')return message.topicText;
    return String(message.text||message.content||'');
  }
  function fileRefs(message){
    var files=message.files||message.context&&message.context.files;
    return (Array.isArray(files)?files:[]).filter(function(f){return f&&typeof f.id==='string'&&/^[a-zA-Z0-9_-]{6,80}$/.test(f.id);}).slice(0,12).map(function(f){
      return {id:f.id,name:String(f.name||'').slice(0,200),source:f.source==='conversation'?'conversation':'project',location:String(f.location||'').slice(0,400)};
    });
  }
  function normalize(messages){
    return (Array.isArray(messages)?messages:[]).filter(function(m){return m&&(!m.isError||partial(m));}).map(function(m,index){
      var role=m.role==='user'||m.isUser?'user':'assistant';
      return {uid:String(m.uid===undefined?'item-'+index:m.uid),role:role,text:plain(m,false),original:plain(m,true),clipped:!!m.clipped,partial:partial(m),...(role==='user'?{userText:userText(m)}:{files:fileRefs(m)})};
    }).filter(function(m){return m.text.trim()||m.original.trim();});
  }
  function selectRecent(messages,options){
    options=options||{};
    var maxChars=options.maxChars||7000,maxMessages=options.maxMessages||8;
    var all=normalize(messages),result=[],used=0,start=all.length;
    for(var i=all.length-1;i>=0 && result.length<maxMessages;i--){
      var available=Math.min(3500,maxChars-used);
      if(available<120)break;
      var m=all[i],text=clip(m.text,available);
      result.unshift({uid:m.uid,role:m.role,text:text,clipped:text!==m.text||m.original!==m.text});used+=text.length;start=i;
    }
    var complete=new Set(result.filter(function(m){return !m.clipped;}).map(function(m){return m.uid;}));
    return {messages:result,chars:used,earlier:all.filter(function(m){return !complete.has(m.uid);}),truncated:start>0||result.some(function(m){return m.clipped;})};
  }
  function fullHistory(messages){
    var result=normalize(messages).map(function(m){return {uid:m.uid,role:m.role,text:m.original||m.text,clipped:false,...(m.partial?{partial:true}:{}),...(m.role==='user'?{userText:m.userText}:{files:m.files})};});
    return {messages:result,chars:result.reduce(function(n,m){return n+m.text.length;},0),earlier:[],truncated:false};
  }
  function chunks(text,size,overlap){
    size=size||1600;overlap=overlap===undefined?180:overlap;
    var result=[],start=0; text=String(text||'').replace(/\r\n?/g,'\n');
    while(start<text.length){
      var end=Math.min(text.length,start+size);
      if(end<text.length){var boundary=text.lastIndexOf('\n',end);if(boundary>start+size*.6)end=boundary+1;}
      result.push({text:text.slice(start,end),start:start,end:end});
      if(end===text.length)break;start=Math.max(start+1,end-overlap);
    }
    return result;
  }
  function excerpts(messages,query,options){
    options=options||{};var q=terms(query),ranked=[],maxChars=options.maxChars||2200;
    if(!q.length)return [];
    normalize(messages).forEach(function(m){
      chunks(m.original||m.text,1400,120).forEach(function(c){
        var lower=c.text.normalize('NFKC').toLowerCase(),matched=q.filter(function(t){return lower.indexOf(t)!==-1;});
        if(!matched.length)return;
        var score=matched.reduce(function(n,t){return n+(/\d/.test(t)?2:1);},0);
        ranked.push({uid:m.uid,role:m.role,text:c.text,score:score,start:c.start});
      });
    });
    ranked.sort(function(a,b){return b.score-a.score;});
    var chosen=[],used=0;
    ranked.forEach(function(item){
      if(chosen.length>=(options.maxItems||3)||used>=maxChars)return;
      if(chosen.some(function(x){return x.uid===item.uid&&Math.abs(x.start-item.start)<900;}))return;
      var text=item.text.slice(0,Math.min(1000,maxChars-used));used+=text.length;chosen.push(Object.assign({},item,{text:text}));
    });
    return chosen;
  }
  function notes(messages,maxChars){
    maxChars=maxChars||1400;var all=normalize(messages),lines=[];
    all.forEach(function(m){
      var text=m.text.replace(/\s+/g,' ').trim();
      var sentences=text.match(/[^。！？!?\n]+[。！？!?]?/g)||[text];
      var candidates=sentences.filter(function(s){return /\d|记住|必须|不要|要求|决定|约定|预算|截止|目标|remember|must|decision|budget|deadline/i.test(s);});
      if(!candidates.length)candidates=sentences.slice(0,1);
      candidates.slice(0,2).forEach(function(s){lines.push((m.role==='user'?'用户：':'回复：')+clip(s,230));});
    });
    return lines.slice(-16).join('\n').slice(0,maxChars);
  }
  function merge(stored,recent){
    var all=normalize(stored),positions=new Map(all.map(function(m,i){return [m.uid,i];}));
    normalize(recent).forEach(function(m){
      if(positions.has(m.uid)){var previous=all[positions.get(m.uid)];if(!m.clipped){if(previous.original.length>m.original.length&&previous.text===m.text)m.original=previous.original;if(m.original===previous.original&&previous.userText!==undefined)m.userText=previous.userText;if(!m.files?.length&&previous.files?.length)m.files=previous.files;all[positions.get(m.uid)]=m;}}else{positions.set(m.uid,all.length);all.push(m);}
    });
    return all.map(function(m){return {uid:m.uid,role:m.role,text:m.text,original:m.original,...(m.partial?{partial:true}:{}),...(m.role==='user'?{userText:m.userText}:{files:m.files})};});
  }
  function followup(question){
    var text=String(question||'').trim();
    return /继续|接着|刚才|之前|前面|上面|上述|这个|那个|这些|那些|它的|那.{0,15}呢|再改|再做|再看|按原|按你说|第二|第三|最后一个|\b(?:continue|that|those|earlier|previous|same|again|it|them)\b/i.test(text);
  }
  function retrievalQuery(messages,question){
    question=String(question||'');
    if(!followup(question))return question.slice(0,8000);
    var all=normalize(messages),users=all.filter(function(m){return m.role==='user';}).slice(-3);
    var refs=[];all.slice(-8).forEach(function(m){(m.files||[]).forEach(function(f){if(f.name&&!refs.includes(f.name))refs.push(f.name);});});
    return [question,'追问所指的近期用户问题：',...users.map(function(m){return clip(m.userText||m.original,1800);}),...refs].join('\n').slice(0,10000);
  }
  function referenceImages(messages,question){
    if(!followup(question)&&!/图片|照片|图中|这张图|图表|截图|\b(?:image|photo|picture|screenshot|diagram)\b/i.test(question||''))return [];
    var source=(Array.isArray(messages)?messages:[]).filter(function(m){return m&&(m.isUser||m.role==='user');}).reverse().find(function(m){return (m.imgSrcs||[]).length||m.imgSrc;});
    if(!source)return [];
    var values=source.imgSrcs&&source.imgSrcs.length?source.imgSrcs:[source.imgSrc],used=0;
    return values.map(function(value){var match=typeof value==='string'&&value.match(/^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/);return match?{mime:match[1],data:match[2]}:null;}).filter(function(item){if(!item||item.data.length>14*1024*1024||used+item.data.length>14*1024*1024)return false;used+=item.data.length;return true;}).slice(0,4);
  }
  function commitments(messages,maxChars){
    maxChars=maxChars||14000;
    var all=normalize(messages).filter(function(m){return m.role==='user'&&m.userText.trim();}),selected=[];
    if(all.length)selected.push({uid:all[0].uid,text:clip(all[0].userText,2400)});
    // Recency wins for corrections; quote the source rather than inventing a
    // semantic fact or treating an assistant proposal as approved.
    all.slice(1).forEach(function(m){
      var sentences=m.userText.match(/[^。！？!?\n]+[。！？!?]?/g)||[m.userText];
      sentences.filter(function(s){return /不要|不用|不能|必须|一定|改成|改为|更正|纠正|不是|已经|完成|决定|同意|选择|就用|保留|取消|预算|截止|只要|记住|以后|\b(?:must|don't|do not|instead|correction|decided|approved|completed|keep|cancel|budget|deadline|remember)\b/i.test(s);}).forEach(function(s){selected.push({uid:m.uid,text:clip(s.trim(),1800)});});
    });
    var out=[],used=0;
    for(var i=selected.length-1;i>=0;i--){var item=selected[i];if(out.some(function(x){return x.text===item.text;}))continue;if(used+item.text.length>maxChars)continue;out.unshift(item);used+=item.text.length;}
    return out;
  }
  function indexDocument(text){
    var parts=chunks(text),postings=Object.create(null);
    parts.forEach(function(part,index){terms(part.text).forEach(function(term){if(!postings[term])postings[term]=[];postings[term].push(index);});});
    return {postings:postings,count:parts.length,parts:parts};
  }
  function rankIndex(index,query,name){
    var q=terms(query),scores=new Map(),count=index.count||1;
    q.forEach(function(term){
      var ids=index.postings&&index.postings[term]||[];
      var weight=1+Math.log(1+count/(1+ids.length));
      ids.forEach(function(id){scores.set(id,(scores.get(id)||0)+weight);});
    });
    var fileNamed=!!name && String(query).toLowerCase().indexOf(String(name).toLowerCase())!==-1;
    if(fileNamed && !scores.size)scores.set(0,3);
    return Array.from(scores,function(pair){return {index:pair[0],score:pair[1]+(fileNamed?5:0)};}).sort(function(a,b){return b.score-a.score;});
  }
  var api=Object.freeze({terms:terms,clip:clip,plain:plain,partial:partial,userText:userText,fileRefs:fileRefs,normalize:normalize,selectRecent:selectRecent,fullHistory:fullHistory,chunks:chunks,excerpts:excerpts,notes:notes,merge:merge,followup:followup,retrievalQuery:retrievalQuery,referenceImages:referenceImages,commitments:commitments,indexDocument:indexDocument,rankIndex:rankIndex});
  root.ArenaContext=api;
  if(typeof module==='object'&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
