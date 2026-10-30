(function(root){
'use strict';
function mount(config){
 var dialog=null,confirmation=null,authEpoch=0;
 function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
 async function request(action,fields){
  var auth=config.auth();
  var response=await fetch(config.worker+'/admin/accounts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.assign({},fields||{},auth,{action:action}))});
  var data=await response.json();if(!response.ok)throw new Error(data.error||'账号管理暂不可用');return data;
 }
 function close(){if(confirmation&&confirmation.open)confirmation.close();if(dialog&&dialog.open)dialog.close();config.focus();}
 async function open(){
  if(config.busy()){config.notice('请等待当前回复结束后管理账号');return;}
  config.hidePanel();var epoch=++authEpoch;
  if(!dialog){dialog=document.createElement('dialog');dialog.className='arena-workspace-dialog arena-admin-dialog';dialog.setAttribute('aria-label','账号管理');config.host.appendChild(dialog);}
  dialog.innerHTML='<div class="arena-dialog-heading"><h2>账号管理</h2><button type="button" data-admin-close aria-label="关闭账号管理">×</button></div><div class="arena-admin-content"><form data-admin-create><h3>创建账号</h3><div class="arena-admin-fields"><label>新账号<input name="username" autocomplete="off" autocapitalize="none" maxlength="40" required></label><label>初始密码<input name="initialPassword" type="password" autocomplete="new-password" maxlength="256" required></label><button class="arena-workspace-primary" type="submit">创建账号</button></div></form><p class="arena-admin-status" role="status" aria-live="polite"></p><div class="arena-admin-list-heading"><h3>已有账号</h3><button type="button" data-admin-refresh>刷新</button></div><div data-admin-users></div><button type="button" data-admin-more hidden>加载更多账号</button></div>';
  var status=dialog.querySelector('.arena-admin-status'),list=dialog.querySelector('[data-admin-users]'),more=dialog.querySelector('[data-admin-more]'),cursor=null,working=false;
  function message(text,error){status.textContent=text;status.toggleAttribute('data-error',!!error);}
  function row(user){return '<div class="arena-admin-user"><div><strong>'+esc(user.username)+'</strong>'+(user.createdAt?'<span>'+esc(new Date(user.createdAt).toLocaleDateString())+'</span>':'')+'</div>'+(user.isOwner?'<span class="arena-admin-owner">管理员</span>':'<button type="button" data-admin-delete="'+esc(user.accountId)+'" data-login="'+esc(user.username)+'">删除</button>')+'</div>';}
  async function load(append){
   if(working)return;working=true;message('正在读取账号…');
   try{var data=await request('list',append&&cursor?{cursor:cursor}:{});if(epoch!==authEpoch||!dialog.open)return;if(!append)list.replaceChildren();list.insertAdjacentHTML('beforeend',data.users.map(row).join(''));cursor=data.cursor;more.hidden=!cursor;message('');}
   catch(error){message(error.message,true);}finally{working=false;}
  }
  function confirmDelete(id,login,trigger){
   if(!confirmation){confirmation=document.createElement('dialog');confirmation.className='arena-workspace-dialog arena-admin-confirm';confirmation.setAttribute('aria-label','确认删除账号');config.host.appendChild(confirmation);}
   confirmation.innerHTML='<div class="arena-dialog-heading"><h2>删除账号 '+esc(login)+'？</h2></div><div class="arena-admin-content"><p>该账号将无法再登录 App 和网页，已有登录也会立即失效。</p><p data-delete-status role="status"></p><div class="arena-admin-confirm-actions"><button type="button" data-delete-cancel>取消</button><button type="button" data-delete-confirm>确认删除</button></div></div>';
   confirmation.querySelector('[data-delete-cancel]').onclick=function(){confirmation.close();trigger.focus();};
   confirmation.querySelector('[data-delete-confirm]').onclick=async function(){
    var button=this;button.disabled=true;confirmation.querySelector('[data-delete-status]').textContent='正在删除…';
    try{await request('delete',{accountId:id});confirmation.close();await load(false);message('账号 '+login+' 已删除，无法再登录。');}
    catch(error){confirmation.querySelector('[data-delete-status]').textContent=error.message;button.disabled=false;}
   };
   confirmation.showModal();confirmation.querySelector('[data-delete-cancel]').focus();
  }
  dialog.querySelector('[data-admin-close]').onclick=close;
  dialog.querySelector('[data-admin-refresh]').onclick=function(){load(false);};more.onclick=function(){load(true);};
  list.onclick=function(event){var b=event.target.closest('[data-admin-delete]');if(b)confirmDelete(b.dataset.adminDelete,b.dataset.login,b);};
  dialog.querySelector('form').onsubmit=async function(event){event.preventDefault();if(working)return;var form=this,button=form.querySelector('button');button.disabled=true;message('正在创建…');
   try{await request('create',{username:form.elements.username.value.trim(),initialPassword:form.elements.initialPassword.value});form.reset();await load(false);message('账号已创建，可以登录 App 和网页。');}
   catch(error){message(error.message,true);}finally{button.disabled=false;}
  };
  dialog.showModal();await load(false);
 }
 return {open:open,close:close};
}
root.ArenaAdmin={mount:mount};
})(typeof window==='undefined'?this:window);
