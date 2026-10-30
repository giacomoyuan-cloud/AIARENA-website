(function(root,factory){var api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ArenaProjectUploadQueue=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
function create(config){
 var items=[],uploading=0,recognizing=0,notifyPending=false;
 function changed(){if(notifyPending)return;notifyPending=true;queueMicrotask(function(){notifyPending=false;config.onChange(items);});}
 function valid(item){return config.isCurrent(item.owner);}
 function progress(item,p){if(!valid(item))return;
  if(p.phase==='上传原文件'){item.uploadPercent=p.total?Math.min(99,Math.floor(100*p.done/p.total)):0;item.uploaded=p.done;}
  else{item.label=p.phase;if(p.total){item.recognitionPercent=Math.floor(100*p.done/p.total);item.done=p.done;item.total=p.total;}}
  changed();
 }
 function options(item){return {file:item.file,meta:item.meta,projectId:item.projectId,credentials:item.credentials,folder:item.folder,relativePath:item.relativePath,replaceFileId:item.replaceFileId,signal:item.controller.signal,retry:item.retry,retryUncertain:item.retryUncertain,isCurrent:function(){return valid(item);},shouldPause:function(){return item.softPause||item.cancelled;},progress:function(p){progress(item,p);}};}
 async function transfer(item){
  uploading++;item.state='uploading';item.controller=new AbortController();changed();
  try{item.meta=await config.upload(Object.assign(options(item),{uploadOnly:true}));item.uploadPercent=100;item.state=item.meta.status==='ready'?'done':'waiting';if(item.state==='done')item.recognitionPercent=100;}
  catch(e){item.error=e.message;item.state=item.cancelled?'cancelled':e.name==='AbortError'?'paused':'failed';}
  finally{uploading--;changed();pump();}
 }
 async function recognize(item){
  recognizing++;item.state='recognizing';item.label='准备读取文件';item.controller=new AbortController();changed();
  try{
   item.meta=await config.recognize(options(item));item.state=['unreadable','indexing'].includes(item.meta.status)||item.meta.coverage?.emptyUnits>0?'failed':item.meta.status==='partial'?'warning':'done';
   if(['done','warning'].includes(item.state))item.recognitionPercent=100;
   else item.error=item.meta.coverage?.ocrError||'部分内容尚未识别，可继续未完成项';
   if(valid(item))try{await config.onComplete(item);}catch(e){item.notice='识别已完成，资料列表可刷新后查看';}
  }catch(e){item.error=e.message;item.state=item.cancelled?'cancelled':e.name==='AbortError'?'paused':'failed';}
  finally{recognizing--;if(item.cancelled)item.state='cancelled';changed();pump();}
 }
 function pump(){
  for(const item of items)if(!valid(item)&&['queued','waiting','uploading','recognizing'].includes(item.state)){item.softPause=true;if(item.state==='uploading')item.controller?.abort();else if(item.state!=='recognizing')item.state='paused';}
  for(const item of items){if(uploading>=2)break;if(item.state==='queued'&&valid(item))void transfer(item);}
  if(!recognizing){var next=items.find(function(i){return i.state==='waiting'&&valid(i);});if(next)void recognize(next);}
 }
 function add(entries,context){var added=[];entries.forEach(function(entry){
  var f=entry.file,key=[context.owner,context.projectId,entry.path,f.size,f.lastModified].join('|');
  if(items.some(function(i){return i.key===key&&!['cancelled'].includes(i.state);}))return;
  var folder=context.isFolder||entry.archive?entry.path.split('/')[0]:null,relative=folder?entry.path.split('/').slice(1).join('/'):null,prior=folder?(context.files||[]).find(function(x){return x.folder===folder&&x.relativePath===relative;}):null;
  var item={id:crypto.randomUUID(),key:key,owner:context.owner,projectId:context.projectId,credentials:context.credentials,file:f,name:f.name,path:entry.path,folder:folder,relativePath:relative,replaceFileId:prior?.id,state:'queued',uploadPercent:0,recognitionPercent:0,uploaded:0,label:'等待上传',done:0,total:0};items.push(item);added.push(item);
 });changed();pump();return added;}
 function act(id,action){var i=items.find(function(x){return x.id===id;});if(!i||!valid(i))return;
  if(action==='pause'){if(i.state==='recognizing'){i.softPause=true;i.label='当前内容完成后暂停';}else{if(i.state==='uploading')i.controller.abort();else i.state='paused';}}
  if(action==='resume'||action==='retry'){i.softPause=false;i.cancelled=false;i.retry=true;i.retryUncertain=i.state==='warning';i.error='';i.state=i.uploadPercent===100&&i.meta?'waiting':'queued';}
  if(action==='cancel'){i.cancelled=true;if(i.state==='recognizing'){i.softPause=true;i.label='当前内容完成后停止，原件保留';}else{if(i.state==='uploading')i.controller.abort();i.state='cancelled';}}
  if(action==='dismiss'&&['done','warning','cancelled'].includes(i.state))items=items.filter(function(x){return x!==i;});
  changed();pump();
 }
 function addRepair(meta,context){var old=items.find(function(i){return i.owner===context.owner&&i.projectId===context.projectId&&i.meta?.id===meta.id&&!['done','warning','cancelled','failed'].includes(i.state);});if(old)return old;var item={id:crypto.randomUUID(),owner:context.owner,projectId:context.projectId,credentials:context.credentials,meta:meta,name:meta.name,path:meta.relativePath||meta.name,state:'waiting',uploadPercent:100,recognitionPercent:0,uploaded:meta.size,label:'准备识别',done:0,total:0,retry:true,retryUncertain:meta.coverage?.emptyUnits===0&&meta.coverage?.uncertainUnits>0};items.push(item);changed();pump();return item;}
 return {addRepair:addRepair,add:add,act:act,items:function(owner,project){return items.filter(function(i){return i.owner===owner&&i.projectId===project;});},clearDone:function(owner,project){items=items.filter(function(i){return !(i.owner===owner&&i.projectId===project&&['done','warning','cancelled'].includes(i.state));});changed();},sync:pump};
}
return {create:create};
});
