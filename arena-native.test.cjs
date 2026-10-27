const test=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const vm=require('node:vm');
const code=readFileSync(__dirname+'/arena-native.js','utf8');
function fixture({native=true,safe=false,version='v1',scale=1}={}){
  const messages=[],buttons=[],styles=[];let reloads=0,requests=0;
  const bridge={postMessage:raw=>messages.push(JSON.parse(raw))};
  const app={classList:{contains:()=>true},appendChild:button=>buttons.push(button)};
  const window={addEventListener(){},visualViewport:{scale,height:420,addEventListener(){}}};
  if(native)window.PickandcaseNative=bridge;
  const document={hidden:false,addEventListener(){},documentElement:{classList:{add(){}},style:{setProperty:(...args)=>styles.push(args)}},querySelector:()=>({content:'v1'}),getElementById:id=>id==='arenaAppUpdate'?buttons[0]:app,createElement:()=>({})};
  const context=vm.createContext({window,document,MutationObserver:class{observe(){}},Map,Promise,Error,JSON,Date,setTimeout,clearTimeout,location:{reload(){reloads++;}},fetch:async()=>{requests++;return {ok:true,json:async()=>({version})};}});
  vm.runInContext(code,context);
  window.ArenaNative.mount({canRefresh:()=>safe,back:()=>true});
  // Acknowledge the theme handshake so no real timers remain pending.
  for(const message of messages.splice(0))bridge.onmessage?.({data:JSON.stringify({id:message.id,ok:true})});
  return {api:window.ArenaNative,bridge,messages,buttons,styles,setSafe(value){safe=value;},get reloads(){return reloads;},get requests(){return requests;}};
}
test('native image saves use the real bridge and matching success or error replies',async()=>{
  const f=fixture();
  const save=f.api.image('saveImage',{mime:'image/png',data:'fixture-bytes'});
  assert.equal(f.messages[0].action,'saveImage');assert.equal(f.messages[0].data,'fixture-bytes');
  f.bridge.onmessage({data:JSON.stringify({id:f.messages[0].id,ok:true})});await save;
  const share=f.api.image('shareImage',{mime:'image/png',data:'fixture-bytes'});
  f.bridge.onmessage({data:JSON.stringify({id:f.messages[1].id,ok:false,error:'已取消'})});
  await assert.rejects(share,/已取消/);
  await assert.rejects(f.api.image('saveImage',{mime:'text/html',data:'x'}),/不支持/);
});
test('ordinary browsers keep their existing download path and make no native update requests',async()=>{
  const f=fixture({native:false});assert.equal(f.api.available(),false);assert.equal(f.requests,0);
  await assert.rejects(f.api.image('saveImage',{mime:'image/png',data:'x'}),/不支持/);
});
test('website updates preserve in-progress work until an empty safe view is available',async()=>{
  const f=fixture({safe:false,version:'v2'});await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.reloads,0);assert.equal(f.buttons.length,1);
  f.buttons[0].onclick();assert.equal(f.reloads,0);
  f.setSafe(true);f.buttons[0].onclick();assert.equal(f.reloads,1);
});
test('an empty safe view refreshes to a changed website version automatically',async()=>{
  const f=fixture({safe:true,version:'v2'});await new Promise(resolve=>setImmediate(resolve));assert.equal(f.reloads,1);
});
test('keyboard viewport follows visible height without constraining pinch zoom',()=>{
  assert.deepEqual(fixture().styles,[['--arena-visible-height','420px']]);
  assert.deepEqual(fixture({scale:2}).styles,[]);
});
