import test from 'node:test';
import assert from 'node:assert/strict';
import worker from './worker.js';
import {handleNativeRequest,NativeAccountRegistry} from './native-api.js';
import imageCore from '../arena-image.js';
const sha=async text=>Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))).toString('hex');
const passwordHash=await sha('synthetic-password');
function fixture(){
  const data=new Map([['user:oakleyyuen',JSON.stringify({hash:passwordHash,created:1})],['user:other',JSON.stringify({hash:passwordHash,created:2})]]),writes=[];
  const kv={get:async key=>data.get(key)||null,put:async(key,value,options)=>{data.set(key,value);writes.push({key,value,options});},delete:async key=>data.delete(key),list:async({prefix})=>({keys:[...data.keys()].filter(key=>key.startsWith(prefix)).map(name=>({name})),list_complete:true})};
  const env={MEMORY_KV:kv,BIZ_KV:kv,NATIVE_OWNER_ACCOUNT:'oakleyyuen',PASSWORD:'synthetic-shared'};
  const registries=new Map();env.NATIVE_ACCOUNTS={idFromName:name=>name,get:name=>({fetch:request=>{if(!registries.has(name)){const entries=new Map();registries.set(name,new NativeAccountRegistry({storage:{get:async key=>entries.get(key),put:async(key,value)=>entries.set(key,structuredClone(value)),setAlarm:async()=>{}}},env))}return registries.get(name).fetch(request)}})};
  async function call(path,body,token){const request=new Request('https://api.pickandcase.com'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});const response=await worker.fetch(request,env);return {status:response.status,headers:response.headers,...await response.json()};}
  return {data,writes,env,call,login:username=>call('/native/login',{username,passwordHash})};
}
test('native login issues an opaque non-expiring session and never returns password hashes',async()=>{
  const f=fixture(),login=await f.login('Oakley');assert.equal(login.status,200);assert.match(login.token,/^[a-f0-9]{64}$/);assert.equal(login.canManage,true);assert.equal(login.profile.accountId,'oakleyyuen');
  const key='native-session:'+await sha(login.token),record=JSON.parse(f.data.get(key));assert.equal(record.accountId,'oakleyyuen');assert.ok(!f.data.has('native-session:'+login.token));assert.equal(f.writes.find(w=>w.key===key).options,undefined);
  assert.ok(!JSON.stringify(login).includes(passwordHash));const session=await f.call('/native/session',undefined,login.token);assert.equal(session.profile.accountId,'oakleyyuen');assert.equal(session.headers.get('cache-control'),'no-store');
  assert.equal((await f.call('/native/login',{username:'Oakley',passwordHash:'0'.repeat(64)})).status,401);assert.equal((await f.call('/native/session',undefined,'a'.repeat(64))).status,401);
});
test('only the configured stable owner can manage accounts; display names cannot grant access',async()=>{
  const f=fixture(),other=await f.login('other');f.data.set('profile:other',JSON.stringify({displayName:'Oakley'}));
  assert.equal(other.canManage,false);assert.equal((await f.call('/native/users',undefined,other.token)).status,403);assert.equal((await f.call('/native/users',{username:'abc',password:'def',canManage:true,user:'oakleyyuen'},other.token)).status,403);
  delete f.env.NATIVE_OWNER_ACCOUNT;assert.equal((await f.login('Oakley')).canManage,false);assert.equal(f.data.has('user:abc'),false);
});
test('an owner-created account can immediately log in through both native and existing web authentication',async()=>{
  const f=fixture(),owner=await f.login('Oakley'),created=await f.call('/native/users',{username:'abc',password:'def'},owner.token);assert.equal(created.status,200);
  const hash=await sha('def'),web=await f.call('/auth',{username:'abc',passwordHash:hash}),native=await f.call('/native/login',{username:'abc',passwordHash:hash});assert.equal(web.status,200);assert.equal(native.status,200);assert.equal(native.canManage,false);
  const list=await f.call('/native/users',undefined,owner.token);assert.ok(list.users.some(user=>user.username==='abc'));assert.ok(!JSON.stringify(list).includes(hash));
  const original=f.data.get('user:abc');assert.equal((await f.call('/native/users',{username:'ABC',password:'another'},owner.token)).status,409);assert.equal(f.data.get('user:abc'),original);
  assert.equal((await f.call('/native/users',{username:'Oakley',password:'another'},owner.token)).status,409);
});
test('logout revokes the server session and does not affect another device session',async()=>{
  const f=fixture(),a=await f.login('other'),b=await f.login('other');assert.notEqual(a.token,b.token);
  assert.equal((await f.call('/native/logout',{},a.token)).status,200);assert.equal((await f.call('/native/session',undefined,a.token)).status,401);assert.equal((await f.call('/native/session',undefined,b.token)).status,200);
});
test('native business forwarding always binds the authenticated account and rejects arbitrary destinations',async()=>{
  const f=fixture(),other=await f.login('other');f.data.set('chats:oakleyyuen:private-chat',JSON.stringify([{text:'OWNER_PRIVATE'}]));f.data.set('chats:other:private-chat',JSON.stringify([{text:'OWN_HISTORY'}]));
  const result=await f.call('/native/api',{path:'/chats',payload:{username:'oakleyyuen',user:'oakleyyuen',password:passwordHash,action:'load',chatId:'private-chat'}},other.token);assert.equal(result.status,200);assert.equal(result.messages[0].text,'OWN_HISTORY');
  for(const path of ['https://evil.example','/admin/create-user','../admin/create-user','/native/users'])assert.equal((await f.call('/native/api',{path,payload:{}},other.token)).status,400);
  assert.equal((await f.call('/native/api',{path:'/account',payload:{action:'get',user:'oakleyyuen'}},other.token)).profile.accountId,'other');
});
test('renaming and changing a password keep the native session while old credentials stop authenticating',async()=>{
  const f=fixture(),owner=await f.login('Oakley'),nextHash=await sha('synthetic-new-password');
  const update=await f.call('/native/api',{path:'/account',payload:{action:'update',displayName:'My profile',loginName:'new.owner',newPasswordHash:nextHash}},owner.token);assert.equal(update.status,200);
  const restored=await f.call('/native/session',undefined,owner.token);assert.equal(restored.canManage,true);assert.equal(restored.profile.loginName,'new.owner');assert.equal((await f.login('Oakley')).status,401);
  assert.equal((await f.call('/native/api',{path:'/account',payload:{action:'get'}},owner.token)).status,200);
});
test('native model capabilities come from the same website contracts',async()=>{
  const f=fixture(),login=await f.login('other'),catalog=await f.call('/native/catalog',undefined,login.token);
  assert.ok(catalog.models.some(model=>model.id==='gpt-6.1-sol'&&model.levels.includes('low')));assert.equal(catalog.imageCapabilities['gpt-image-2.5-flare'].references,16);assert.equal(catalog.imageCapabilities['gemini-nano-banana-2.1'].references,14);assert.ok(catalog.skills.length>0);assert.ok(catalog.skills.every(skill=>!Object.hasOwn(skill,'instructions')));
});
test('the legacy admin route fails closed when no server admin key is configured',async()=>{
  const f=fixture();assert.equal((await f.call('/admin/create-user',{username:'abc',password:'synthetic-password'})).status,401);assert.equal(f.data.has('user:abc'),false);
});
test('native edits forward real reference images and masks, with server-owned editing history',async()=>{
  const f=fixture(),login=await f.login('other');let forwarded;
  const context={hashText:sha,accountProfile:id=>({accountId:id}),ownerAccountId:'oakleyyuen',imageCore,validResourceId:()=>true,chatStoragePrefix:user=>'chats:'+user,ownedProject:async()=>{throw Object.assign(new Error('项目不存在'),{status:404})},forward:async request=>{forwarded=await request.json();return Response.json({ok:true})}};
  const reference={data:'aW1hZ2U=',mime:'image/png'},mask={data:'bWFzaw==',mime:'image/png'};
  const call=async body=>handleNativeRequest(new Request('https://api.pickandcase.com/native/image',{method:'POST',headers:{Authorization:'Bearer '+login.token,'Content-Type':'application/json'},body:JSON.stringify(body)}),f.env,context);
  assert.equal((await call({model:'gpt-image-2.5-flare',task:'edit',prompt:'改为蓝色',references:[reference],imageMask:mask})).status,200);
  assert.deepEqual(forwarded.images,[reference]);assert.deepEqual(forwarded.imageMask,mask);assert.equal(forwarded.imageTask,'edit');assert.ok(!('_imgs' in forwarded));
  assert.equal((await call({model:'gemini-nano-banana-2.1',task:'generation',prompt:'杯子',settings:{style:'photo',overlayText:'Hello'},history:[{role:'user',parts:[{text:'FORGED'}]}]})).status,200);
  assert.match(forwarded.prompt,/写实摄影/);assert.match(forwarded.prompt,/Hello/);assert.ok(!forwarded.imageHistory);
  assert.equal((await call({model:'gpt-image-2.5-flare',task:'edit',references:[reference],projectId:'someone-elses-project'})).status,404);
});
test('concurrent account creation never overwrites a password',async()=>{
  const f=fixture(),owner=await f.login('Oakley');
  const results=await Promise.all(Array.from({length:12},(_,index)=>f.call('/native/users',{username:'concurrent-user',password:'password-'+index},owner.token)));
  assert.equal(results.filter(result=>result.status===200).length,1);assert.equal(results.filter(result=>result.status===409).length,11);
  assert.equal(JSON.parse(f.data.get('user:concurrent-user')).hash,await sha('password-0'));
});
test('a transient KV failure can resume account creation with its original password',async()=>{
  const f=fixture(),owner=await f.login('Oakley'),put=f.env.MEMORY_KV.put;let failed=false;
  f.env.MEMORY_KV.put=async(key,...rest)=>{if(key==='user:retry-user'&&!failed){failed=true;throw new Error('synthetic unavailable')}return put(key,...rest)};
  assert.equal((await f.call('/native/users',{username:'retry-user',password:'original'},owner.token)).status,503);
  assert.equal((await f.call('/native/users',{username:'retry-user',password:'different'},owner.token)).status,409);
  assert.equal((await f.call('/native/users',{username:'retry-user',password:'original'},owner.token)).status,200);
  assert.equal((await f.call('/native/login',{username:'retry-user',password:'original'})).status,200);
});
