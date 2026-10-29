import test from 'node:test';
import assert from 'node:assert/strict';
import worker from './worker.js';
function setup(){
  const data=new Map([['user:one',JSON.stringify({hash:'one-hash'})],['user:two',JSON.stringify({hash:'two-hash'})]]);
  const kv={get:async k=>data.get(k)||null,put:async(k,v)=>data.set(k,v),delete:async k=>data.delete(k),list:async({prefix})=>({keys:[...data.keys()].filter(k=>k.startsWith(prefix)).map(name=>({name})),list_complete:true})};
  const env={BIZ_KV:kv,MEMORY_KV:kv,PASSWORD:'shared'};
  const call=async(path,body,user='one')=>{const r=await worker.fetch(new Request('https://api.pickandcase.com'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:user,password:user+'-hash',...body})}),env);return {status:r.status,...await r.json()};};
  const project=async name=>(await call('/projects',{action:'create',name,instructions:'KEEP_INSTRUCTIONS'})).project;
  const save=(projectId=null,chatId='chat-123456')=>call('/chats',{action:'save',projectId,chatId,title:'Original',messages:[{uid:1,isUser:true,text:'原始正文'},{uid:2,text:'答复',context:{scope:projectId||'general'}}]});
  return {data,env,call,project,save};
}
test('moving a chat preserves its messages, isolates memories, and rejects a late save in its old scope',async()=>{
  const {data,call,project,save}=setup(),p=await project('Project');await save();
  data.set('mem:one','GENERAL_MEMORY');data.set('project:one:'+p.id+':memory','PROJECT_MEMORY');
  const result=await call('/chats',{action:'move',chatId:'chat-123456',targetProjectId:p.id});assert.equal(result.status,200);
  assert.equal((await call('/chats',{action:'list'})).chats.length,0);
  assert.equal((await call('/chats',{action:'load',projectId:p.id,chatId:result.chatId})).messages[0].text,'原始正文');
  assert.equal((await save()).status,409);assert.equal(data.get('mem:one'),'GENERAL_MEMORY');assert.equal(data.get('project:one:'+p.id+':memory'),'PROJECT_MEMORY');
  assert.equal((await call('/chats',{action:'move',chatId:'chat-123456',targetProjectId:p.id})).chatId,result.chatId);
});
test('moving between projects never overwrites a same-ID destination and cannot access another owner',async()=>{
  const {call,project,save}=setup(),a=await project('A'),b=await project('B');await save(a.id);await save(b.id);
  const moved=await call('/chats',{action:'move',projectId:a.id,chatId:'chat-123456',targetProjectId:b.id});assert.equal(moved.status,200);assert.notEqual(moved.chatId,'chat-123456');
  assert.equal((await call('/chats',{action:'list',projectId:b.id})).chats.length,2);
  assert.equal((await call('/chats',{action:'move',projectId:b.id,chatId:moved.chatId,targetProjectId:a.id},'two')).status,404);
});
test('a round-trip move chooses a fresh ID rather than reusing a tombstoned source',async()=>{
  const {call,project,save}=setup(),p=await project('A');await save();
  const first=await call('/chats',{action:'move',chatId:'chat-123456',targetProjectId:p.id});
  const back=await call('/chats',{action:'move',projectId:p.id,chatId:first.chatId,targetProjectId:null});assert.equal(back.status,200);assert.notEqual(back.chatId,'chat-123456');
  assert.equal((await call('/chats',{action:'save',chatId:back.chatId,title:'继续',messages:[{uid:1,isUser:true,text:'可以继续保存'}]})).status,200);
});
test('failed destination storage and active executions retain the original chat',async()=>{
  const {env,data,call,project,save}=setup(),p=await project('A');await save();
  const put=env.BIZ_KV.put;env.BIZ_KV.put=async(k,v)=>{if(k.startsWith('project:'))throw Error('storage unavailable');return put(k,v);};
  assert.equal((await call('/chats',{action:'move',chatId:'chat-123456',targetProjectId:p.id})).status,500);
  assert.ok(data.has('chats:one:chat-123456'));assert.equal((await call('/chats',{action:'list'})).chats.length,1);
  env.BIZ_KV.put=put;data.set('chats:one:chat-123456',JSON.stringify([{uid:1,run:{status:'running'}}]));
  assert.equal((await call('/chats',{action:'move',chatId:'chat-123456',targetProjectId:p.id})).status,409);
});
test('custom titles survive subsequent saves and groups remain within their owning scope',async()=>{
  const {call,project,save}=setup(),p=await project('A');await save();
  assert.equal((await call('/chats',{action:'rename',chatId:'chat-123456',title:'我的标题'})).status,200);await save();
  assert.equal((await call('/chats',{action:'list'})).chats[0].title,'我的标题');
  const group=(await call('/chats',{action:'create_group',name:'开发'})).group;
  await call('/chats',{action:'group',chatId:'chat-123456',groupId:group.id});assert.equal((await call('/chats',{action:'list'})).chats[0].groupId,group.id);
  await save(p.id);assert.equal((await call('/chats',{action:'group',projectId:p.id,chatId:'chat-123456',groupId:group.id})).status,404);
  assert.equal((await call('/chats',{action:'groups'},'two')).groups.length,0);
});
test('editing project memory or name preserves instructions and other fields',async()=>{
  const {call,project}=setup(),p=await project('A');
  await call('/projects',{action:'update',projectId:p.id,memory:'独立记忆'});
  await call('/projects',{action:'update',projectId:p.id,name:'新名称'});
  const loaded=(await call('/projects',{action:'get',projectId:p.id})).project;
  assert.equal(loaded.instructions,'KEEP_INSTRUCTIONS');assert.equal(loaded.memory,'独立记忆');assert.equal(loaded.name,'新名称');
});
test('folder imports retain paths and replace one active document without deleting the recoverable original',async()=>{
  const {call,project}=setup(),p=await project('A'),file={name:'brief.md',size:3,type:'text/plain',text:'旧资料',data:'YWJj',folder:'资料',relativePath:'产品/brief.md'};
  const first=await call('/projects',{action:'upload',projectId:p.id,file});assert.equal(first.status,200);
  const second=await call('/projects',{action:'upload',projectId:p.id,replaceFileId:first.file.id,file:{...file,text:'新资料'}});assert.equal(second.status,200);assert.equal(second.files.length,1);assert.equal(second.files[0].relativePath,'产品/brief.md');
  assert.equal((await call('/projects',{action:'removed_files',projectId:p.id})).files[0].id,first.file.id);
  assert.equal((await call('/projects',{action:'upload',projectId:p.id,file:{...file,relativePath:'../brief.md'}})).status,400);
});
test('the scheduler endpoint checks account ownership and never forwards credentials into task storage',async()=>{
  const {call,env,project}=setup(),p=await project('A');let body;
  env.PROJECT_SCHEDULES={idFromName:id=>id,get:id=>({fetch:async r=>{body=await r.json();return Response.json({id});}})};
  const reply=await call('/schedules',{action:'create',projectId:p.id});assert.equal(reply.status,200);assert.equal(reply.id,'schedules:one');assert.equal(body.user,'one');assert.ok(!body.password&&!body.passwordHash);
  assert.equal((await call('/schedules',{action:'list',projectId:p.id},'two')).status,404);
  assert.equal((await call('/schedules',{action:'list',password:'wrong'})).status,401);
});
test('deleted projects leave active lists and pins, reject ordinary access, and restore their own data intact',async()=>{
  const {data,call,project,save}=setup(),a=await project('Recoverable'),b=await project('Unchanged');await save(a.id);await save();
  await call('/projects',{action:'pin',projectId:a.id,pinned:true});
  await call('/projects',{action:'update',projectId:a.id,memory:'PRIVATE_PROJECT_MEMORY'});
  await call('/projects',{action:'upload',projectId:a.id,file:{name:'brief.md',text:'PRIVATE_PROJECT_MATERIAL',size:3,type:'text/plain',data:'YWJj'}});
  data.set('mem:one','GENERAL_MEMORY');
  const before=new Map([...data].filter(([key])=>key.startsWith('project:one:'+a.id+':')&&!key.endsWith(':meta')));
  const deleted=await call('/projects',{action:'delete',projectId:a.id});assert.equal(deleted.status,200);assert.ok(deleted.project.deletedAt);
  assert.deepEqual((await call('/projects',{action:'list'})).projects.map(p=>p.id),[b.id]);
  assert.equal((await call('/projects',{action:'list',includeArchived:true})).projects.length,0);
  assert.deepEqual((await call('/projects',{action:'list',includeDeleted:true})).projects.map(p=>p.id),[a.id]);
  assert.ok(!data.has('projects:one:pin:'+a.id));
  for(const action of ['get','update','pin','archive','upload','files','removed_files'])assert.equal((await call('/projects',{action,projectId:a.id,pinned:true})).status,404,action);
  for(const path of ['/chats','/system-prompt','/schedules'])assert.equal((await call(path,{action:'list',projectId:a.id})).status,404,path);
  assert.equal((await call('/memory',{action:'get',user:'one',projectId:a.id})).status,404);
  assert.equal((await call('/projects',{action:'delete',projectId:a.id})).status,200);
  assert.equal((await call('/projects',{action:'restore',projectId:a.id})).status,200);
  const restored=(await call('/projects',{action:'get',projectId:a.id})).project;
  assert.equal(restored.deletedAt,null);assert.equal(restored.instructions,'KEEP_INSTRUCTIONS');assert.equal(restored.memory,'PRIVATE_PROJECT_MEMORY');assert.equal(restored.files.length,1);
  for(const [key,value]of before)assert.equal(data.get(key),value,key);
  assert.equal(data.get('mem:one'),'GENERAL_MEMORY');assert.equal((await call('/chats',{action:'list'})).chats.length,1);
  assert.equal((await call('/chats',{action:'load',projectId:a.id,chatId:'chat-123456'})).messages[0].text,'原始正文');
});
test('delete, trash and restore enforce account ownership, including archived projects',async()=>{
  const {call,project}=setup(),p=await project('Archived');
  for(const action of ['delete','restore'])assert.equal((await call('/projects',{action,projectId:p.id},'two')).status,404);
  await call('/projects',{action:'archive',projectId:p.id});assert.equal((await call('/projects',{action:'delete',projectId:p.id})).status,200);
  assert.equal((await call('/projects',{action:'list',includeDeleted:true},'two')).projects.length,0);
  assert.equal((await call('/projects',{action:'restore',projectId:p.id},'two')).status,404);
  const result=await call('/projects',{action:'restore',projectId:p.id});assert.equal(result.status,200);assert.equal(result.project.archivedAt,null);
  assert.equal((await call('/projects',{action:'get',projectId:p.id})).status,200);
});
test('deleted projects release active capacity and restoring cannot exceed the project limit',async()=>{
  const {call,project}=setup(),p=await project('Restore me');
  for(let i=0;i<29;i++)await project('Other '+i);
  await call('/projects',{action:'delete',projectId:p.id});const next=await project('New slot');assert.ok(next.id);
  assert.equal((await call('/projects',{action:'restore',projectId:p.id})).status,400);
  await call('/projects',{action:'delete',projectId:next.id});assert.equal((await call('/projects',{action:'restore',projectId:p.id})).status,200);
});
