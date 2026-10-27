import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import worker from './worker.js';
const require=createRequire(import.meta.url),ui=require('../arena-account.js');
const sha=async value=>Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))).toString('hex');
const password=await sha('synthetic-current-password'),newPassword=await sha('synthetic-new-password');
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jF1kAAAAASUVORK5CYII=';
function setup(){
  const data=new Map([['user:tester',JSON.stringify({hash:password,created:1})],['user:another',JSON.stringify({hash:password,created:2})]]),writes=[];
  const kv={get:async key=>data.get(key)||null,put:async(key,value)=>{data.set(key,value);writes.push(key);}};
  return {data,writes,env:{MEMORY_KV:kv,BIZ_KV:kv,PASSWORD:'synthetic-shared-password',ADMIN_KEY:'synthetic-admin-key'}};
}
const post=(path,fields)=>new Request('https://api.pickandcase.com'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(fields)});
async function account(env,fields={}){const r=await worker.fetch(post('/account',{user:'tester',password,...fields}),env);return {status:r.status,headers:r.headers,...await r.json()};}
async function auth(env,username,passwordHash=password){const r=await worker.fetch(post('/auth',{username,passwordHash}),env);return {status:r.status,...await r.json()};}
const update=(env,fields={})=>account(env,{action:'update',displayName:'My Name',loginName:'tester',...fields});
test('profile reads require the signed-in account and never expose hashes',async t=>{
  const {env,writes}=setup();t.mock.method(globalThis,'fetch',()=>{throw new Error('Account settings must not call a model');});
  assert.equal((await account(env,{password:'wrong'})).status,401);
  assert.equal((await account(env,{password:await sha(env.PASSWORD)})).status,401);
  const result=await account(env);assert.equal(result.status,200);assert.deepEqual(result.profile,{accountId:'tester',loginName:'tester',displayName:'tester',avatar:''});
  assert.equal(result.headers.get('cache-control'),'no-store');assert.ok(!JSON.stringify(result.profile).includes('hash'));assert.deepEqual(writes,[]);
});
test('display name and avatar persist and keep credentials and existing data untouched',async()=>{
  const {env,data,writes}=setup(),credential=data.get('user:tester');
  data.set('mem:tester','MEMORY_CANARY');data.set('chats:tester:list','[]');data.set('system-prompt:tester',JSON.stringify({prompt:'PROMPT_CANARY'}));
  const result=await update(env,{displayName:'Custom Display',avatar:png,owner:'another'});assert.equal(result.status,200);
  assert.equal((await account(env)).profile.displayName,'Custom Display');assert.equal((await account(env)).profile.avatar,png);
  assert.equal(data.get('user:tester'),credential);assert.equal(data.get('mem:tester'),'MEMORY_CANARY');assert.equal(JSON.parse(data.get('system-prompt:tester')).prompt,'PROMPT_CANARY');assert.deepEqual(writes,['profile:tester']);
  assert.equal((await auth(env,'tester')).profile.displayName,'Custom Display');
  await update(env,{avatar:''});assert.equal((await account(env)).profile.avatar,'');
});
test('login renames use a stable identity and old login names no longer authenticate',async()=>{
  const {env,data}=setup();data.set('chats:tester:list',JSON.stringify([{id:'history-123',title:'Keep history'}]));data.set('skills:tester','[]');data.set('mem:tester','MEMORY_CANARY');data.set('system-prompt:tester',JSON.stringify({prompt:'PROMPT_CANARY'}));
  const p=await worker.fetch(post('/projects',{user:'tester',password,action:'create',name:'Keep project'}),env),project=(await p.json()).project;
  const renamed=await update(env,{loginName:'My.New.Login'});assert.equal(renamed.status,200);assert.equal(renamed.profile.accountId,'tester');assert.equal(renamed.profile.loginName,'My.New.Login');
  assert.equal((await auth(env,'my.new.login')).status,200);assert.equal((await auth(env,'tester')).status,401);
  const chats=await worker.fetch(post('/chats',{username:'my.new.login',password,action:'list'}),env);assert.equal((await chats.json()).chats[0].id,'history-123');
  const owned=await worker.fetch(post('/projects',{user:'my.new.login',password,action:'get',projectId:project.id}),env);assert.equal(owned.status,200);assert.equal((await owned.json()).project.owner,'tester');
  const prompt=await worker.fetch(post('/system-prompt',{user:'my.new.login',password,action:'get'}),env);assert.equal((await prompt.json()).prompt,'PROMPT_CANARY');
  const memory=await worker.fetch(post('/memory',{user:'my.new.login',password,action:'get'}),env);assert.equal((await memory.json()).memory,'MEMORY_CANARY');
  const skills=await worker.fetch(new Request('https://api.pickandcase.com/skills?user=my.new.login&pass='+password),env);assert.deepEqual((await skills.json()).skills,[]);
  assert.equal(data.has('user:my.new.login'),false);assert.equal(data.get('login:my.new.login'),'tester');
});
test('a new password replaces the old password while keeping the current account and login',async()=>{
  const {env}=setup();assert.equal((await update(env,{loginName:'new.login',newPasswordHash:newPassword})).status,200);
  assert.equal((await auth(env,'new.login',password)).status,401);assert.equal((await auth(env,'new.login',newPassword)).status,200);
  assert.equal((await account(env)).status,401);assert.equal((await account(env,{password:newPassword})).profile.accountId,'tester');
  const old=await worker.fetch(post('/chats',{username:'tester',password,action:'list'}),env);assert.equal(old.status,401);
  const fresh=await worker.fetch(post('/chats',{username:'tester',password:newPassword,action:'list'}),env);assert.equal(fresh.status,200);
});
test('another account cannot claim current, stable or retired login names',async()=>{
  const {env,data}=setup();
  assert.equal((await update(env,{loginName:'another'})).status,409);
  await update(env,{loginName:'first.alias'});await update(env,{loginName:'second.alias'});
  for(const loginName of ['tester','FIRST.ALIAS','second.alias'])assert.equal((await update(env,{user:'another',loginName})).status,409);
  assert.equal(data.get('login:first.alias'),'tester');assert.equal((await auth(env,'first.alias')).status,401);
  assert.equal((await update(env,{loginName:'first.alias'})).status,200);assert.equal((await auth(env,'first.alias')).status,200);
});
test('the previous password cannot fall back to a shared password to access private chats or memory',async t=>{
  const {env,data}=setup();env.PASSWORD='synthetic-current-password';data.set('mem:tester','PRIVATE_MEMORY');data.set('chats:tester:list','[]');
  await update(env,{newPasswordHash:newPassword});
  t.mock.method(globalThis,'fetch',()=>{throw new Error('Rejected private-memory updates must not call a provider');});
  const requests=[post('/chats',{username:'tester',password,action:'list'}),post('/chats',{username:'tester',password,action:'save',chatId:'private-123',messages:[]}),post('/memory',{user:'tester',password,conversation:'REJECTED'}),new Request('https://api.pickandcase.com/memory?user=tester&pass='+password)];
  for(const request of requests)assert.equal((await worker.fetch(request,env)).status,401);
  assert.equal(data.get('mem:tester'),'PRIVATE_MEMORY');assert.equal(data.has('chats:tester:private-123'),false);
});
test('Oakley can rename without moving legacy storage keys or other accounts',async()=>{
  const {env,data}=setup();data.set('user:oakleyyuen',JSON.stringify({hash:password,created:1}));data.set('mem:oakleyyuen','LEGACY_MEMORY');
  assert.equal((await account(env,{user:'Oakley'})).profile.loginName,'Oakley');
  await update(env,{user:'Oakley',loginName:'oakley.new',displayName:'Custom Name'});
  assert.equal((await auth(env,'Oakley')).status,401);assert.equal((await auth(env,'oakleyyuen')).status,401);
  const login=await auth(env,'oakley.new');assert.equal(login.status,200);assert.equal(login.profile.accountId,'oakleyyuen');assert.equal(login.profile.displayName,'Custom Name');
  assert.equal((await update(env,{user:'another',loginName:'Oakley'})).status,409);assert.equal(data.get('mem:oakleyyuen'),'LEGACY_MEMORY');
});
test('display-only updates do not disable existing legacy aliases',async()=>{
  const {env,data}=setup();data.set('user:oakleyyuen',JSON.stringify({hash:password}));
  await update(env,{user:'Oakley',displayName:'Display Only',loginName:'Oakley'});
  assert.equal((await auth(env,'Oakley')).status,200);assert.equal((await auth(env,'oakleyyuen')).status,200);assert.equal(JSON.parse(data.get('user:oakleyyuen')).loginName,undefined);
});
test('invalid names, passwords and avatar payloads never write settings',async()=>{
  const {env,writes}=setup();
  for(const displayName of ['', 'x'.repeat(61),'name\nline'])assert.equal((await update(env,{displayName})).status,400);
  for(const loginName of ['a','../user','name:admin','has spaces','x'.repeat(41)])assert.equal((await update(env,{loginName})).status,400);
  for(const newPasswordHash of ['',null,'password','a'.repeat(63),{}])assert.equal((await update(env,{newPasswordHash})).status,400);
  for(const avatar of ['https://example.com/avatar.png','data:image/svg+xml;base64,PHN2Zz4=','data:image/png;base64,aGVsbG8=',png+'x','x'.repeat(180001)])assert.equal((await update(env,{avatar})).status,400);
  assert.equal((await account(env,{action:'unknown'})).status,400);
  assert.equal((await worker.fetch(new Request('https://api.pickandcase.com/account',{method:'POST',body:'{'}),env)).status,400);
  assert.deepEqual(writes,[]);
});
test('a failed profile write leaves old credentials usable',async()=>{
  const {env}=setup();env.BIZ_KV={get:async()=>null,put:async()=>{throw new Error('Storage unavailable');}};
  assert.equal((await update(env,{newPasswordHash:newPassword})).status,500);assert.equal((await auth({...env,BIZ_KV:{get:async()=>null}},'tester')).status,200);
});
test('admin user creation cannot overwrite an existing account through an alias',async()=>{
  const {env,data}=setup();await update(env,{loginName:'new.alias'});const original=data.get('user:tester');
  const request=post('/admin/create-user',{adminKey:env.ADMIN_KEY,username:'new.alias',password:'different-password'});
  assert.equal((await worker.fetch(request,env)).status,409);assert.equal(data.get('user:tester'),original);
});
test('client validation distinguishes display names, login names and optional password changes',()=>{
  assert.equal(ui.validate('任意显示名字','new.login',''),'');assert.equal(ui.validate('Name','中文名字','long-enough'),'');
  assert.ok(ui.validate('','new.login',''));assert.ok(ui.validate('Name','has spaces',''));assert.ok(ui.validate('Name','new.login','short'));
});
