/* Shared bounded context and exact-text retrieval; history stays in storage. */
(function(root){
  'use strict';
  var STOP = new Set(('the and this that with from have what when where which please would could should about hello thanks thank you '+
    '你好 谢谢 请问 一下 什么 怎么 如何 可以 这个 那个 我们 你们 他们 是否 需要 一个 一些 根据 相关 内容 介绍 详细 分析 多少 还有 现在 进行 以及 其中').split(/\s+/));
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
  function plain(message,full){
    if(!message)return '';
    var text=full&&typeof message.original==='string'?message.original:(message.text||message.content||'');
    if(message.isUser && typeof message.topicText==='string')text=message.topicText;
    if(message._quote)text='引用：'+message._quote.text+'\n'+text;
    if(full && message.pastedTexts && message.pastedTexts.length)text+='\n'+message.pastedTexts.join('\n');
    return String(text).replace(/\[\[aa-citation:\d+\]\]/g,'').replace(/ \[img\]/g,' [图片]');
  }
  function normalize(messages){
    return (Array.isArray(messages)?messages:[]).filter(function(m){return m&&!m.isError;}).map(function(m,index){
      return {uid:String(m.uid===undefined?'item-'+index:m.uid),role:m.role==='user'||m.isUser?'user':'assistant',text:plain(m,false),original:plain(m,true),clipped:!!m.clipped};
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
      if(positions.has(m.uid)){var previous=all[positions.get(m.uid)];if(!m.clipped){if(previous.original.length>m.original.length&&previous.text===m.text)m.original=previous.original;all[positions.get(m.uid)]=m;}}else{positions.set(m.uid,all.length);all.push(m);}
    });
    return all.map(function(m){return {uid:m.uid,role:m.role,text:m.text,original:m.original};});
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
  var api=Object.freeze({terms:terms,clip:clip,plain:plain,normalize:normalize,selectRecent:selectRecent,chunks:chunks,excerpts:excerpts,notes:notes,merge:merge,indexDocument:indexDocument,rankIndex:rankIndex});
  root.ArenaContext=api;
  if(typeof module==='object'&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
