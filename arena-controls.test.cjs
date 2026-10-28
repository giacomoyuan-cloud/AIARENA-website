const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createPinStore}=require('./arena-controls.js');
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(){
  const requests=[],changes=[],errors=[];
  const store=createPinStore({
    write(context,value){return new Promise((resolve,reject)=>requests.push({context,value,resolve,reject}));},
    onChange(key,value,pending,context){changes.push({key,value,pending,context});},
    onError(error,context){errors.push({message:error.message,context});}
  });
  return {store,requests,changes,errors};
}
test('pin state updates synchronously and ignores stale reads throughout the write',async()=>{
  const f=fixture();f.store.toggle('account|chat',false,{id:'chat'});
  assert.equal(f.changes[0].value,true);assert.equal(f.store.pending('account|chat'),true);
  for(let i=0;i<4;i++)assert.equal(f.store.read('account|chat',false),true);
  f.requests[0].resolve();await settle();
  assert.equal(f.store.pending('account|chat'),false);assert.equal(f.store.read('account|chat',false),true);
  assert.equal(f.store.read('account|chat',true,f.store.version()),true);
  // Once a later read confirms the write, another device's update can be seen.
  assert.equal(f.store.read('account|chat',false),false);
});
test('rapid opposite clicks are immediate and writes are serialized to the latest intent',async()=>{
  const f=fixture();for(let i=0;i<4;i++)f.store.toggle('a',false,{id:'latest-'+i});
  assert.deepEqual(f.changes.map(x=>x.value),[true,false,true,false]);
  assert.equal(f.requests.length,1);assert.equal(f.store.read('a',true),false);
  f.requests[0].resolve();await settle();assert.equal(f.requests.length,2);
  assert.equal(f.requests[1].value,false);assert.equal(f.requests[1].context.id,'latest-3');
  f.requests[1].resolve();await settle();assert.equal(f.store.pending('a'),false);assert.equal(f.errors.length,0);
});
test('an obsolete error cannot undo a newer click, including an ambiguous timeout',async()=>{
  const f=fixture();f.store.toggle('a',false,{id:1});f.store.toggle('a',false,{id:2});
  f.requests[0].reject(new Error('network timeout'));await settle();
  assert.equal(f.store.read('a',true),false);assert.equal(f.errors.length,0);
  assert.equal(f.requests[1].value,false);f.requests[1].resolve();await settle();assert.equal(f.store.pending('a'),false);
});
test('the latest failed write restores the last confirmed state despite a stale list',async()=>{
  const f=fixture();f.store.toggle('a',false,{});f.store.toggle('a',false,{});
  f.requests[0].resolve();await settle();f.requests[1].reject(new Error('save failed'));await settle();
  assert.equal(f.changes.at(-1).value,true);assert.equal(f.store.read('a',false),true);
  assert.equal(f.store.pending('a'),false);assert.equal(f.errors.length,1);
  f.store.toggle('a',false,{});assert.equal(f.requests[2].value,false);
  f.requests[2].resolve();await settle();assert.equal(f.store.read('a',false),false);
});
test('projects, general chats and project chats are isolated by account and scope',async()=>{
  const f=fixture();f.store.toggle('one|project|x',false,{});f.store.toggle('one|general|x',false,{});
  assert.equal(f.store.read('two|general|x',false),false);assert.equal(f.store.read('one|other-project|x',false),false);
  assert.equal(f.store.read('one|project|x',false),true);assert.equal(f.store.read('one|general|x',false),true);
  f.requests[0].reject(new Error('failed'));f.requests[1].resolve();await settle();
  assert.equal(f.store.read('one|project|x',false),false);assert.equal(f.store.read('one|general|x',false),true);
});
test('cached matching values cannot clear the guard before a post-save list observes the final write',async()=>{
  const f=fixture(),cachedVersion=f.store.version();
  f.store.toggle('a',false,{});f.store.toggle('a',false,{});
  const inFlightVersion=f.store.version();
  f.requests[0].resolve();await settle();f.requests[1].resolve();await settle();
  // The final desired value equals the old cached value. That is not an acknowledgement.
  assert.equal(f.store.read('a',false,cachedVersion),false);
  assert.equal(f.store.read('a',true,inFlightVersion),false);
  assert.equal(f.store.read('a',false,f.store.version()),false);
  assert.equal(f.store.read('a',true,f.store.version()),true);
});
