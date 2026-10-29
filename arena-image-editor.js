(function(root){
  'use strict';
  function point(clientX,clientY,rect){return {x:Math.max(0,Math.min(1,(clientX-rect.left)/rect.width)),y:Math.max(0,Math.min(1,(clientY-rect.top)/rect.height))};}
  function drawPaths(context,paths,w,h){
    paths.forEach(function(path){
      if(path.full){context.fillRect(0,0,w,h);return;}
      context.lineWidth=path.size*w;context.lineCap='round';context.lineJoin='round';
      context.beginPath();var first=path.points[0];context.moveTo(first.x*w,first.y*h);
      path.points.slice(1).forEach(function(p){context.lineTo(p.x*w,p.y*h);});
      if(path.points.length===1)context.lineTo(first.x*w+.01,first.y*h+.01);
      context.stroke();
    });
  }
  function loadImage(url){return new Promise(function(resolve,reject){var image=new Image();image.onload=function(){resolve(image);};image.onerror=function(){reject(new Error('图片无法读取，请重新上传。'));};image.src=url;});}
  async function open(source){
    var image=await loadImage('data:'+(source.mime||'image/png')+';base64,'+source.data);
    if(image.naturalWidth*image.naturalHeight>16777216)throw new Error('局部编辑图片过大，请先将图片缩至 4096 × 4096 像素以内。');
    var dialog=document.createElement('dialog');dialog.className='arena-image-editor';dialog.setAttribute('aria-labelledby','arenaImageEditorTitle');
    dialog.innerHTML='<header><div><h2 id="arenaImageEditorTitle">选择修改区域</h2><p>涂抹要修改的位置，再描述想怎么改。选区是修改指引，模型可能调整边缘。</p></div><button type="button" data-close aria-label="关闭局部编辑">×</button></header>'
      +'<div class="arena-image-editor-toolbar"><label>画笔大小 <input type="range" aria-label="画笔大小" min="6" max="100" step="2" value="36"></label><button type="button" data-undo>撤销</button><button type="button" data-all>全部选中</button><button type="button" data-clear>清空</button><button type="button" data-import>导入选区 PNG</button><input type="file" accept="image/png" hidden></div>'
      +'<div class="arena-image-editor-scroll"><div class="arena-image-editor-stage"><img alt="局部编辑原图"><canvas aria-label="涂抹要修改的区域"></canvas></div></div>'
      +'<p class="arena-image-editor-error" role="alert" hidden></p><footer><span>有颜色的区域会被修改</span><button type="button" data-cancel>取消</button><button type="button" data-apply disabled>使用选区</button></footer>';
    var app=document.getElementById('ai-arena-app');app.appendChild(dialog);
    var img=dialog.querySelector('img'),canvas=dialog.querySelector('canvas'),brush=dialog.querySelector('[type="range"]'),apply=dialog.querySelector('[data-apply]'),error=dialog.querySelector('[role="alert"]');
    img.src=image.src;canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
    var paths=[],active=null,baseMask=null,selection=null,opener=document.activeElement;
    function message(text){error.textContent=text;error.hidden=!text;}
    function render(){
      var ctx=canvas.getContext('2d');ctx.clearRect(0,0,canvas.width,canvas.height);ctx.fillStyle=ctx.strokeStyle='rgba(204,120,92,0.46)';
      if(baseMask){ctx.fillRect(0,0,canvas.width,canvas.height);ctx.globalCompositeOperation='destination-out';ctx.drawImage(baseMask,0,0);ctx.globalCompositeOperation='source-over';}
      drawPaths(ctx,paths,canvas.width,canvas.height);apply.disabled=!paths.length&&!baseMask;
      dialog.querySelector('[data-undo]').disabled=!paths.length&&!baseMask;
    }
    canvas.addEventListener('pointerdown',function(event){
      if(event.button!==0)return;event.preventDefault();canvas.setPointerCapture(event.pointerId);
      var rect=canvas.getBoundingClientRect();active={size:Number(brush.value)/rect.width,points:[point(event.clientX,event.clientY,rect)]};paths.push(active);render();
    });
    canvas.addEventListener('pointermove',function(event){if(!active)return;var rect=canvas.getBoundingClientRect(),events=event.getCoalescedEvents?event.getCoalescedEvents():[];if(!events.length)events=[event];events.forEach(function(e){active.points.push(point(e.clientX,e.clientY,rect));});render();});
    ['pointerup','pointercancel','lostpointercapture'].forEach(function(name){canvas.addEventListener(name,function(){active=null;});});
    dialog.querySelector('[data-undo]').onclick=function(){if(paths.length)paths.pop();else baseMask=null;render();};
    dialog.querySelector('[data-clear]').onclick=function(){paths=[];baseMask=null;render();};
    dialog.querySelector('[data-all]').onclick=function(){paths.push({full:true});render();};
    dialog.querySelector('[data-close]').onclick=dialog.querySelector('[data-cancel]').onclick=function(){dialog.close();};
    var fileInput=dialog.querySelector('[type="file"]');dialog.querySelector('[data-import]').onclick=function(){fileInput.click();};
    fileInput.onchange=async function(){
      var file=fileInput.files[0];if(!file)return;
      try{
        if(file.type!=='image/png'||file.size>10*1024*1024)throw new Error('请导入不超过 10MB 的 PNG 选区。');
        var url=URL.createObjectURL(file),mask;
        try{mask=await loadImage(url);}finally{URL.revokeObjectURL(url);}
        if(mask.naturalWidth!==canvas.width||mask.naturalHeight!==canvas.height)throw new Error('选区 PNG 必须与原图尺寸相同，透明区域表示需要修改的位置。');
        var check=document.createElement('canvas');check.width=canvas.width;check.height=canvas.height;
        var c=check.getContext('2d');c.drawImage(mask,0,0);var pixels=c.getImageData(0,0,check.width,check.height).data,transparent=false;
        for(var i=3;i<pixels.length;i+=4)if(pixels[i]<255){transparent=true;break;}
        if(!transparent)throw new Error('选区没有透明区域。请把需要修改的位置设为透明。');
        baseMask=mask;paths=[];message('');render();
      }catch(e){message(e.message);}finally{fileInput.value='';}
    };
    apply.onclick=function(){
      try{
        var original=document.createElement('canvas');original.width=canvas.width;original.height=canvas.height;original.getContext('2d').drawImage(image,0,0);
        var originalData=source.mime==='image/png'?source.data:original.toDataURL('image/png').split(',')[1];
        if(originalData.length>14*1024*1024)throw new Error('转换后的原图过大，请先缩小图片再选择区域。');
        var mask=document.createElement('canvas');mask.width=canvas.width;mask.height=canvas.height;var ctx=mask.getContext('2d');
        if(baseMask)ctx.drawImage(baseMask,0,0);else{ctx.fillStyle='#fff';ctx.fillRect(0,0,mask.width,mask.height);}
        ctx.globalCompositeOperation='destination-out';ctx.strokeStyle=ctx.fillStyle='#000';drawPaths(ctx,paths,mask.width,mask.height);
        selection={source:{data:originalData,mime:'image/png'},mask:{data:mask.toDataURL('image/png').split(',')[1],mime:'image/png'}};dialog.close();
      }catch(e){message(e.message);}
    };
    render();dialog.showModal();
    return new Promise(function(resolve){dialog.addEventListener('close',function(){dialog.remove();canvas.width=canvas.height=0;if(opener&&opener.isConnected)opener.focus();resolve(selection);},{once:true});});
  }
  var api={open:open,point:point,drawPaths:drawPaths};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.ArenaImageEditor=api;
})(typeof window!=='undefined'?window:this);
