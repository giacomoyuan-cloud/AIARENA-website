import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import worker from './worker.js';
import {NativeAccountRegistry} from './native-api.js';
const hash=s=>createHash('sha256').update(s).digest('hex');
function fixture(){
 const data=new Map(),actors=new Map(),stores=new Map();
 const kv={get:async k=>data.get(k)||null,put:async(k,v)=>{data.set(k,v)},delete:async k=>{data.delete(k)},list:async({prefix})=>({keys:[...data.keys()].filter(k=>k.startsWith(prefix)).map(name=>({name})),list_complete:true})};
 const env={MEMORY_KV:kv,BIZ_KV:kv,NATIVE_OWNER_ACCOUNT:'oakleyyuen',PASSWORD:'fixture-shared-key'};
 for(const id of ['oakleyyuen','target-account','other-account'])data.set('user:'+id,JSON.stringify({hash:hash(id+'-pass'),created:1}));
 env.NATIVE_ACCOUNTS={idFromName:id=>id,get:name=>({fetch:request=>{
  if(!actors.has(name)){const storage=new Map();stores.set(name,storage);actors.set(name,new NativeAccountRegistry({storage:{get:async k=>storage.get(k),put:async(k,v)=>storage.set(k,structuredClone(v)),setAlarm:async()=>{}}},env));}
  return actors.get(name).fetch(request);
 }})};
 async function call(path,body,token){const response=await worker.fetch(new Request('https://api.pickandcase.com'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})}),env);return {status:response.status,...await response.json()};}
 const auth=(id='oakleyyuen')=>({user:id,password:hash(id+'-pass')});
 const login=id=>call('/native/login',{username:id,password:(id.toLowerCase()==='oakley'?'oakleyyuen':id)+'-pass'});
 return {data,env,kv,actors,stores,call,auth,login};
}

test('website deletion invalidates all native sessions, website credentials and business requests',async()=>{
 const f=fixture(),one=await f.login('target-account'),two=await f.login('target-account'),owner=await f.login('Oakley');
 assert.equal((await f.call('/auth',{username:'Oakley',passwordHash:hash('oakleyyuen-pass')})).canManage,true);
 assert.equal((await f.call('/auth',{username:'other-account',passwordHash:hash('other-account-pass')})).canManage,false);
 assert.equal(one.status,200);assert.equal(two.status,200);
 f.data.set('chats:target-account:preserved','synthetic retained history');
 assert.equal((await f.call('/admin/accounts',{...f.auth(),action:'delete',accountId:'target-account'})).status,200);
 assert.equal((await f.login('target-account')).status,401);
 for(const token of [one.token,two.token])assert.equal((await f.call('/native/catalog',undefined,token)).status,401);
 assert.equal((await f.call('/auth',{username:'target-account',passwordHash:hash('target-account-pass')})).status,401);
 for(const path of ['/account','/chats','/projects','/schedules'])assert.equal((await f.call(path,{...f.auth('target-account'),username:'target-account',action:path==='/account'?'get':'list'})).status,401,path);
 assert.equal((await f.call('/chats',{username:'target-account',password:hash('fixture-shared-key'),action:'list'})).status,401);
 assert.equal((await f.call('/memory?user=target-account&pass='+hash('fixture-shared-key'))).status,401);
 assert.equal((await f.call('/',{...f.auth('target-account'),model:'gpt-6.1-sol',effort:'low',prompt:'must never reach a provider'})).status,401);
 assert.equal((await f.call('/native/catalog',undefined,owner.token)).status,200);
 assert.equal(f.data.get('chats:target-account:preserved'),'synthetic retained history');
});

test('native deletion removes the account from both lists and preserves other users',async()=>{
 const f=fixture(),owner=await f.login('Oakley'),other=await f.login('other-account');
 assert.equal((await f.call('/native/users',{action:'delete',accountId:'target-account'},owner.token)).status,200);
 assert.ok(!(await f.call('/native/users',undefined,owner.token)).users.some(u=>u.accountId==='target-account'));
 assert.ok(!(await f.call('/admin/accounts',{...f.auth(),action:'list'})).users.some(u=>u.accountId==='target-account'));
 assert.equal((await f.call('/native/catalog',undefined,other.token)).status,200);
 assert.equal((await f.call('/auth',{username:'other-account',passwordHash:hash('other-account-pass')})).status,200);
});

test('ordinary users and spoofed Oakley display names cannot create or delete accounts',async()=>{
 const f=fixture(),other=await f.login('other-account');f.data.set('profile:other-account',JSON.stringify({displayName:'Oakley'}));
 assert.equal((await f.call('/account',{...f.auth('other-account'),action:'get'})).canManage,false);
 for(const action of ['list','create','delete']){
  assert.equal((await f.call('/admin/accounts',{...f.auth('other-account'),action,accountId:'target-account',username:'new-account',initialPassword:'def'})).status,403);
  assert.equal((await f.call('/native/users',{action,accountId:'target-account',username:'new-account',password:'def'},other.token)).status,403);
 }
 assert.equal((await f.login('target-account')).status,200);
});

test('the owner cannot be deleted from either client, including case variations',async()=>{
 const f=fixture(),owner=await f.login('Oakley');
 for(const accountId of ['oakleyyuen','OAKLEYYUEN']){
  assert.equal((await f.call('/native/users',{action:'delete',accountId},owner.token)).status,403);
  assert.equal((await f.call('/admin/accounts',{...f.auth(),action:'delete',accountId})).status,403);
 }
 assert.equal((await f.login('Oakley')).status,200);
});

test('durable deletion wins over regional stale password caches and reserved-name reuse',async()=>{
 const f=fixture(),old=f.data.get('user:target-account'),get=f.kv.get;
 f.kv.get=async key=>key==='user:target-account'?old:get(key);
 assert.equal((await f.call('/admin/accounts',{...f.auth(),action:'delete',accountId:'target-account'})).status,200);
 assert.equal((await f.login('target-account')).status,401);
 assert.equal((await f.call('/auth',{username:'target-account',passwordHash:hash('target-account-pass')})).status,401);
 const owner=await f.login('Oakley');
 assert.equal((await f.call('/native/users',{username:'target-account',password:'new-password'},owner.token)).status,409);
 assert.equal((await f.call('/account',{...f.auth('other-account'),action:'update',loginName:'target-account',displayName:'other'})).status,409);
});

test('KV write failure cannot restore a durably deleted account',async()=>{
 const f=fixture(),put=f.kv.put;
 f.kv.put=async(key,value)=>{if(key==='user:target-account')throw Error('synthetic regional write failure');return put(key,value)};
 assert.equal((await f.call('/admin/accounts',{...f.auth(),action:'delete',accountId:'target-account'})).status,200);
 assert.equal((await f.login('target-account')).status,401);
 assert.equal(f.stores.get('account:target-account').get('account').status,'deleted');
 f.kv.put=put;await f.actors.get('account:target-account').alarm();assert.equal(JSON.parse(f.data.get('user:target-account')).disabled,true);
});

test('website owner can create a short-password account and native login can use it',async()=>{
 const f=fixture();
 assert.equal((await f.call('/account',{...f.auth(),action:'get'})).canManage,true);
 assert.equal((await f.call('/admin/accounts',{...f.auth(),action:'create',username:'created-from-web',initialPassword:'def'})).status,200);
 assert.equal((await f.call('/native/login',{username:'created-from-web',password:'def'})).status,200);
});
