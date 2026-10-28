const test=require('node:test'),assert=require('node:assert/strict');
const Runs=require('./arena-debate-runs.js');
const Stream=require('./arena-stream.js');
const credentials={user:'synthetic',password:'synthetic-only',runId:'run-001',chatId:'chat-001'};
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const quickTimer=(fn,ms)=>setTimeout(fn,ms===12000?12000:1);

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
