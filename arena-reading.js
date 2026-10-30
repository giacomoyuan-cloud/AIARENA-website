(function(root,factory){var api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ArenaReading=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  function normalize(mode){return mode==='full'?'full':'retrieve';}
  function intent(question){
    var text=String(question||'').replace(/(?:按|使用|启用|开启|切换到)[“「]全文阅读[”」]/g,'使用全文阅读').replace(/```[\s\S]*?```/g,'').replace(/^\s*>.*$/gm,'').replace(/`[^`]*`|“[^”]*”|「[^」]*」|『[^』]*』/g,'');
    if(/(?:不要|不用|无需|不需要|别)\s*(?:再|进行|做|使用|启用|开启|按|采用)?\s*(?:全文阅读|阅读全文|通读|完整阅读)|(?:只|仅)(?:需|要)?\s*(?:检索|查找|查阅相关)|\b(?:do not|don't)\s+(?:read|review)\s+(?:the\s+)?(?:whole|entire|full)\b/i.test(text))return 'retrieve';
    if(/(?:全文阅读|阅读全文|通读|完整阅读).{0,12}(?:是什么|什么意思|的区别|怎么用)|(?:什么是|什么叫).{0,12}(?:全文阅读|通读)/.test(text))return null;
    if(/全文(?:阅读|审阅|核对)|阅读(?:这份|这个|该|整份|文件的)?全文|通读|(?:完整|全部|整份|逐页|从头到尾).{0,12}(?:阅读|审阅|读完|检查|核对)|\b(?:read|review|check)\s+(?:through\s+)?(?:the\s+)?(?:entire|whole|full)\b|\bfrom\s+(?:start|beginning)\s+to\s+(?:finish|end)\b/i.test(text))return 'full';
    if(/(?:按需检索|只看相关|只读相关|仅检索相关)|\bonly\s+(?:retrieve|search)\b/i.test(text))return 'retrieve';
    return null;
  }
  function resolve(question,preferred){var explicit=intent(question);return {mode:explicit||normalize(preferred),explicit:!!explicit};}
  function originalTask(question,settings){return settings&&settings.mode==='manual'||/(?:生成|制作|导出|创建|修改|编辑|填写|保留.{0,6}格式|create|generate|export|edit|fill)/i.test(question||'')&&/(?:word|excel|pptx?|docx?|xlsx?|pdf|文档|表格|幻灯片|文件|模板|格式)/i.test(question||'');}
  var markerPrefix='[文件: ';
  function marker(file){return markerPrefix+file.name+']\n[对话文件 '+file.id+'；正文按阅读方式查阅]';}
  function fileId(text){var m=String(text||'').match(/^\[文件: [^\n]+\]\n\[对话文件 ([a-zA-Z0-9_-]{6,80})；正文按阅读方式查阅\]$/);return m?m[1]:null;}
  function fileName(text){return fileId(text)?String(text).split('\n')[0].slice(5,-1):'';}
  function describe(text){return fileId(text)?'[附件：'+fileName(text)+']':text;}
  return {normalize:normalize,intent:intent,resolve:resolve,originalTask:originalTask,marker:marker,fileId:fileId,fileName:fileName,describe:describe};
});
