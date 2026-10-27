(function(root){
  'use strict';
  function paintAvatar(element,name,avatar){
    element.replaceChildren();
    if(typeof avatar==='string'&&/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(avatar)){
      var img=document.createElement('img');img.src=avatar;img.alt='';element.appendChild(img);
    }else element.textContent=(name||'A').slice(0,1).toUpperCase();
  }
  async function prepareAvatar(file){
    if(!file||!['image/png','image/jpeg','image/webp'].includes(file.type))throw new Error('请选择 PNG、JPG 或 WebP 图片');
    if(file.size>5*1024*1024)throw new Error('图片不能超过 5 MB');
    var url=URL.createObjectURL(file);
    try{
      var image=new Image();
      await new Promise(function(resolve,reject){image.onload=resolve;image.onerror=function(){reject(new Error('无法读取这张图片，请换一张'));};image.src=url;});
      var side=Math.min(image.naturalWidth,image.naturalHeight);
      if(!side)throw new Error('图片尺寸无效');
      var canvas=document.createElement('canvas');canvas.width=256;canvas.height=256;
      canvas.getContext('2d').drawImage(image,(image.naturalWidth-side)/2,(image.naturalHeight-side)/2,side,side,0,0,256,256);
      var data=canvas.toDataURL('image/webp',.85);
      if(data.length>180000)throw new Error('图片处理失败，请换一张较小的图片');
      return data;
    }finally{URL.revokeObjectURL(url);}
  }
  function validate(display,login,password){
    if(!display.trim()||display.trim().length>60||/[\u0000-\u001f\u007f]/.test(display))return '显示名需为 1–60 字';
    if(login.trim().length<2||login.trim().length>40||! /^[\p{L}\p{N}][\p{L}\p{N}_.-]*$/u.test(login.trim()))return '登录名需为 2–40 位，支持中文、字母、数字、点、下划线和短横线';
    if(password&&(password.length<8||password.length>128))return '新密码需为 8–128 位';
    return '';
  }
  function mount(config){
    var dialog=null,epoch=0;
    function sameAuth(auth){var now=config.auth();return now.user===auth.user&&now.password===auth.password;}
    async function request(action,auth,fields){
      var response=await fetch(config.worker+'/account',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.assign({action:action,user:auth.user,password:auth.password},fields||{}))});
      var data=await response.json();if(!response.ok||!data.profile)throw new Error(data.error||'账号设置暂不可用');
      return data.profile;
    }
    async function refresh(){
      var auth=config.auth(),run=++epoch;if(!auth.user||!auth.password)return;
      try{var profile=await request('get',auth);if(run===epoch&&sameAuth(auth))config.commit(profile);}catch{}
    }
    async function open(){
      if(config.busy()){config.notice('请等待当前回复结束后修改账号');return;}
      var auth=config.auth();if(!auth.user||!auth.password){config.notice('请先登录账号');return;}
      var run=++epoch;
      if(!dialog){
        dialog=document.createElement('dialog');dialog.className='arena-workspace-dialog arena-account-dialog';dialog.setAttribute('aria-label','账号设置');
        config.host.appendChild(dialog);
      }
      dialog.innerHTML='<div class="arena-dialog-heading"><h2>账号设置</h2><button type="button" aria-label="关闭账号设置">×</button></div><div class="arena-account-content"><div class="arena-profile-photo"><span class="arena-profile-avatar" aria-hidden="true"></span><div><button type="button" data-avatar-upload>上传头像</button><button type="button" data-avatar-remove>移除</button><p>PNG、JPG 或 WebP，最多 5 MB，自动裁为方形。</p><input type="file" data-avatar-file accept="image/png,image/jpeg,image/webp" hidden></div></div><label for="aaProfileDisplayName">显示名</label><input id="aaProfileDisplayName" type="text" autocomplete="nickname" maxlength="60" disabled><p class="arena-account-help">显示在左下角和你之后发送的消息中。</p><label for="aaProfileLoginName">登录名</label><input id="aaProfileLoginName" type="text" autocomplete="username" maxlength="40" autocapitalize="none" spellcheck="false" disabled><p class="arena-account-help">修改后使用新登录名登录，原有聊天和项目保留。</p><label for="aaProfileNewPassword">新密码 <span>选填</span></label><div class="arena-password-field"><input id="aaProfileNewPassword" type="password" autocomplete="new-password" maxlength="128" placeholder="留空不修改密码" disabled><button type="button" data-password-visible aria-label="显示新密码">显示</button></div><p class="arena-account-help">至少 8 位；已登录即可直接保存，无需验证码。</p><div class="arena-account-save"><span data-account-status role="status" aria-live="polite">正在读取账号…</span><button type="button" data-account-save class="arena-workspace-primary" disabled>保存修改</button></div></div>';
      var name=dialog.querySelector('#aaProfileDisplayName'),login=dialog.querySelector('#aaProfileLoginName'),password=dialog.querySelector('#aaProfileNewPassword'),file=dialog.querySelector('[data-avatar-file]'),picture=dialog.querySelector('.arena-profile-avatar'),status=dialog.querySelector('[data-account-status]'),save=dialog.querySelector('[data-account-save]'),upload=dialog.querySelector('[data-avatar-upload]'),remove=dialog.querySelector('[data-avatar-remove]');
      var saved=null,avatar='',busy=false;
      function current(){return run===epoch&&dialog.open;}
      function dirty(){return saved&&(name.value!==saved.displayName||login.value!==saved.loginName||avatar!==saved.avatar||password.value.length>0);}
      function sync(){
        [name,login,password,upload].forEach(function(el){el.disabled=busy||!saved;});
        remove.disabled=busy||!saved||!avatar;
        save.disabled=busy||!dirty();
        paintAvatar(picture,name.value||'A',avatar);
      }
      function message(text,error){status.textContent=text;status.toggleAttribute('data-error',!!error);}
      function apply(profile,text){saved=profile;name.value=profile.displayName;login.value=profile.loginName;avatar=profile.avatar;password.value='';message(text||'');sync();}
      function edited(){message(dirty()?'有未保存的修改':'');sync();}
      [name,login,password].forEach(function(el){el.addEventListener('input',edited);});
      dialog.querySelector('[aria-label="关闭账号设置"]').addEventListener('click',function(){dialog.close();config.focus();});
      dialog.onclose=function(){epoch++;password.value='';file.value='';};
      dialog.querySelector('[data-password-visible]').addEventListener('click',function(){var shown=password.type==='password';password.type=shown?'text':'password';this.textContent=shown?'隐藏':'显示';this.setAttribute('aria-label',shown?'隐藏新密码':'显示新密码');});
      upload.addEventListener('click',function(){file.click();});
      remove.addEventListener('click',function(){avatar='';edited();});
      file.addEventListener('change',async function(){
        if(!file.files[0])return;
        busy=true;message('正在处理头像…');sync();
        try{var value=await prepareAvatar(file.files[0]);if(current()){avatar=value;message('头像已预览，保存后生效');}}
        catch(error){if(current())message(error.message,true);}
        finally{file.value='';busy=false;if(current())sync();}
      });
      save.addEventListener('click',async function(){
        if(busy||!dirty())return;
        if(config.busy()){message('请等待当前回复结束后保存');return;}
        if(!sameAuth(auth)){message('登录状态已变化，请重新打开账号设置',true);return;}
        var error=validate(name.value,login.value,password.value);if(error){message(error,true);return;}
        busy=true;message('正在保存…');sync();
        try{
          var fields={displayName:name.value.trim(),loginName:login.value.trim(),avatar:avatar},newHash;
          if(password.value){newHash=await config.hash(password.value);fields.newPasswordHash=newHash;}
          var profile=await request('update',auth,fields);
          if(!sameAuth(auth))return;
          config.commit(profile,newHash);auth=config.auth();
          if(current())apply(profile,'已保存');
        }catch(error){if(current())message(error.message,true);}
        finally{busy=false;if(current())sync();}
      });
      config.hidePanel();sync();if(!dialog.open)dialog.showModal();
      try{
        var profile=await request('get',auth);
        if(current()&&sameAuth(auth)){config.commit(profile);auth=config.auth();apply(profile);}
      }catch(error){if(current())message(error.message+'，请关闭后重试',true);}
    }
    return {open:open,refresh:refresh};
  }
  var api={mount:mount,paintAvatar:paintAvatar,validate:validate};
  root.ArenaAccount=Object.freeze(api);
  if(typeof module==='object'&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
