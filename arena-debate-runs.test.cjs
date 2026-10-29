const test=require('node:test'),assert=require('node:assert/strict');
const Runs=require('./arena-debate-runs.js');
const Stream=require('./arena-stream.js');
const vm=require('node:vm'),fs=require('node:fs');
const credentials={user:'synthetic',password:'synthetic-only',runId:'run-001',chatId:'chat-001'};
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const quickTimer=(fn,ms)=>setTimeout(fn,ms===12000?12000:1);

test('a stale backend is rejected before creating any model run',async()=>{
  const calls=[],client=Runs.create({fetch:async(url,init)=>{calls.push(init.method);return Response.json({debate:'studio-v2'});}});
  await assert.rejects(client.watch('/fixture',credentials,{input:{},requiredVersion:'studio-v3'}),{status:409});assert.deepEqual(calls,['GET']);
});
test('compatible backend preflight precedes the immutable start request',async()=>{
  const calls=[],client=Runs.create({fetch:async(url,init)=>{calls.push(init.method);return Response.json(init.method==='GET'?{debate:'studio-v3'}:{id:'run-001',revision:1,status:'completed',turns:[]});}});
  await client.watch('/fixture',credentials,{input:{},requiredVersion:'studio-v3'});assert.deepEqual(calls,['GET','POST']);
});

test('lost start acknowledgement uses the identical id and payload; polling never starts another generation',async()=>{
  let starts=0,progress=0;const bodies=[],snapshots=[];
  const client=Runs.create({interval:1,setTimeout:quickTimer,fetch:async(url,init)=>{
    const body=JSON.parse(init.body);bodies.push(body);
    if(body.action==='start'){if(++starts===1)throw new TypeError('lost acknowledgement');return Response.json({id:'run-001',status:'running',revision:1,turns:[]});}
    return Response.json({id:'run-001',status:++progress===1?'running':'completed',revision:progress+1,turns:[{index:0,reply:{text:'绝对进度'}}]});
  }});
  const result=await client.watch('/fixture',credentials,{input:{topic:'fixture'},onSnapshot:data=>snapshots.push(data)});
  assert.equal(result.status,'completed');assert.deepEqual(bodies[0],bodies[1]);assert.equal(bodies.filter(b=>b.action==='start').length,2);
  assert.deepEqual(bodies.slice(2).map(b=>b.after),[1,2]);assert.equal(snapshots.length,3);
});

test('detaching a watcher does not send stop or retry and does not revive a paid task',async()=>{
  const controller=new AbortController(),actions=[];
  const client=Runs.create({interval:1,fetch:async(url,init)=>{actions.push(JSON.parse(init.body).action);return Response.json({id:'run-001',status:'running',revision:1,turns:[]});}});
  await assert.rejects(client.watch('/fixture',credentials,{signal:controller.signal,onSnapshot(){controller.abort();}}),{name:'AbortError'});
  assert.deepEqual(actions,['status']);
});

test('retry controls retain an operation id across transport retries and surface stale state errors',async()=>{
  const bodies=[];let count=0;
  const client=Runs.create({setTimeout:quickTimer,makeId:()=> 'operation-one',fetch:async(url,init)=>{const b=JSON.parse(init.body);bodies.push(b);if(++count===1)throw new TypeError('network');return Response.json({id:'run-001',status:'running',revision:2,turns:[]});}});
  await client.control('/fixture',credentials,'retry',{turn:2,attempt:1});assert.equal(bodies.length,2);assert.deepEqual(bodies[0],bodies[1]);
  const denied=Runs.create({fetch:async()=>Response.json({error:'state changed'},{status:409})});
  await assert.rejects(denied.control('/fixture',credentials,'retry',{turn:2,attempt:1}),{status:409});
});

test('restored text seeds the already received prefix and new graphemes retain a bounded reading speed',async()=>{
  let now=0,id=0,timers=new Map();
  const stream=Stream.create({now:()=>now,rate:15,setTimeout:(fn,ms)=>{timers.set(++id,{fn,at:now+ms});return id;},clearTimeout:id=>timers.delete(id)});
  stream.seed(1,'已读前文');assert.equal(stream.text(1),'已读前文');stream.write(1,'已读前文新的内容');assert.equal(stream.text(1),'已读前文');
  now=70;for(const [id,timer]of [...timers])if(timer.at<=now){timers.delete(id);timer.fn();}
  assert.equal(stream.text(1),'已读前文新');stream.stop();
});

test('a rejected start restores the draft and unlocks sending without leaving a running phantom message',async()=>{
  const source=fs.readFileSync(require('node:path').join(__dirname,'index.html'),'utf8');
  const fn=source.match(/  function watchDurableDebate\([^]*?\n  }/)[0];
  const ref={id:'run-001',chatId:'chat-001'},user={uid:1,debateRun:{...ref,status:'running'}};
  const input={config:{topic:'合成辩题'},userMessage:{uid:1,topicText:'原始草稿',pastedTexts:['附加文字']},images:[]};
  const elements={aaTopic:{value:''},aaSendBtn:{}};let forgotten=0;
  const view={ref,snapshot:null};
  const c=vm.createContext({AbortController,ArenaDebateRuns:{watch:async()=>{throw Object.assign(new Error('图片过大'),{status:413});}},WORKER:'/fixture',
    $:id=>elements[id],durableDebateView:view,debateCurrent:v=>v===view,debateCredentials:()=>credentials,
    aaRunning:false,debate:true,abortF:false,activeDebateRunId:null,setSendButtonIcon(){},syncDebateRecovery(){},syncArenaLayout(){},arenaNotice(){},
    msgs:[user],sentImgs:[],sentTexts:[],renderImgPreviews(){},renderTextPreviews(){},forgetDebate(){forgotten++;},
    liveReplies:{has:()=>false,whenIdle:async()=>{}},hideThink(){},render(){},loadChatList(){}});
  vm.runInContext(fn,c);c.watchDurableDebate(view,input);await new Promise(resolve=>setImmediate(resolve));
  assert.equal(c.msgs.length,0);assert.equal(c.aaRunning,false);assert.equal(elements.aaTopic.value,'原始草稿');assert.equal(c.sentTexts[0],'附加文字');assert.equal(view.rejected,true);assert.equal(forgotten,1);
});

test('a stopped checkpoint settles a detached watcher without making a status request',async()=>{
  const client=Runs.create({fetch:async()=>{throw new Error('unexpected network call');}});let received;
  const result=await client.watch('/fixture',credentials,{snapshot:{id:'run-001',status:'stopped',revision:1,turns:[],total:0},onSnapshot:s=>received=s});
  assert.equal(result.status,'stopped');assert.equal(received.total,0);
});
