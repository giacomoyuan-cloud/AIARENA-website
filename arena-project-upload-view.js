(function(root){
'use strict';
function markup(){return '<div class="arena-file-drop" data-upload-drop><strong>拖入文件，或 <button type="button" data-pick-files>批量选择</button></strong><small>文档、表格、演示、图片、代码、ZIP</small></div><div class="arena-file-queue-head"><span data-upload-count></span><span><button type="button" data-upload-formats>支持格式</button><button type="button" data-clear-uploads>清除完成</button></span></div><div class="arena-file-queue" data-upload-queue></div>';}
function size(n){return n>=1048576?(n/1048576).toFixed(1)+' MB':Math.max(1,Math.round(n/1024))+' KB';}
function paint(page,items,icon,status){
 var target=page.querySelector('[data-upload-queue]');if(!target)return;
 var prior=new Map(Array.from(target.querySelectorAll('[data-upload-job]')).map(function(el){return[el.dataset.uploadJob,el];})),done=items.filter(function(i){return ['done','warning'].includes(i.state);}).length;
 page.querySelector('[data-upload-count]').textContent=items.length?items.length+' 个文件 · '+done+' 个可查阅':'选择多个文件，每份资料单独显示进度';
 page.querySelector('[data-clear-uploads]').hidden=!items.some(function(i){return ['done','warning','cancelled'].includes(i.state);});
 items.forEach(function(i){
  var row=prior.get(i.id);prior.delete(i.id);
  if(!row){row=document.createElement('article');row.className='arena-file-job';row.dataset.uploadJob=i.id;
   row.innerHTML='<div class="arena-file-job-top">'+icon('file')+'<button type="button" data-job-preview></button><button type="button" data-job-action></button><button type="button" data-job-cancel aria-label="停止处理，保留原件">×</button></div><div class="arena-file-transfer"><label>上传 <span data-job-up-percent></span></label><div class="arena-file-track" role="progressbar" aria-label="上传进度" aria-valuemin="0" aria-valuemax="100"><i></i></div></div><div class="arena-file-recognition"><label>识别 <span data-job-rec-percent></span></label><div class="arena-file-track" role="progressbar" aria-label="识别进度" aria-valuemin="0" aria-valuemax="100"><i></i></div></div><p data-job-status></p>';target.appendChild(row);
  }
  row.dataset.state=i.state;var title=row.querySelector('[data-job-preview]');title.textContent=i.name;title.title=i.path;title.disabled=!i.meta;
  var bars=row.querySelectorAll('[role=progressbar]');[i.uploadPercent,i.recognitionPercent].forEach(function(v,n){v=Math.max(0,Math.min(100,v||0));bars[n].setAttribute('aria-valuenow',v);bars[n].setAttribute('aria-label',i.name+' '+(n?'识别':'上传')+'进度');bars[n].querySelector('i').style.transform='scaleX('+v/100+')';});
  row.querySelector('[data-job-up-percent]').textContent=i.uploadPercent+'%';row.querySelector('[data-job-rec-percent]').textContent=i.recognitionPercent+'%';
  var label=i.state==='done'?'可供 AI 查阅':i.state==='warning'?status(i.meta):i.state==='failed'?i.error:i.state==='paused'?'已暂停，进度和原件会保留':i.state==='cancelled'?'已停止本次处理，原件保留':i.state==='queued'?'等待上传':i.state==='waiting'?'上传完成 · 等待识别':i.state==='uploading'?'正在上传 · '+size(i.uploaded)+' / '+size(i.file.size):i.label+(i.total?' · '+i.done+'/'+i.total:'');
  row.querySelector('[data-job-status]').textContent=label;
  var action=row.querySelector('[data-job-action]'),retry=['failed','warning'].includes(i.state),resume=['paused','cancelled'].includes(i.state);
  action.hidden=i.state==='done';action.textContent=retry?'重试':resume?'继续':i.softPause?'暂停中':'暂停';action.dataset.jobAction=retry?'retry':resume?'resume':'pause';action.disabled=!!i.softPause&&i.state==='recognizing';
  row.querySelector('[data-job-cancel]').hidden=['done','warning','cancelled'].includes(i.state);
 });prior.forEach(function(el){el.remove();});
}
root.ArenaProjectUploadView={markup:markup,paint:paint};
})(typeof globalThis!=='undefined'?globalThis:this);
