const {test}=require('node:test');
const assert=require('node:assert/strict');
const Debate=require('./arena-debate.js');
function plan(extra={}){return Debate.plan({id:'test-run',topic:'是否延长开放时间',mode:'free',rounds:2,models:['model-a','model-b'],members:[{id:'seat-1',model:'model-a',label:'席位一'},{id:'seat-2',model:'model-a',label:'席位二'}],summaryModel:'none',...extra});}
test('one model may power multiple separately identified seats in every mode',()=>{
  assert.equal(plan().turns.length,4);
  assert.equal(plan({mode:'persona',members:[{id:'r1',model:'model-a',label:'r1',role:'工程师'},{id:'r2',model:'model-a',label:'r2',role:'产品经理'}]}).members.length,2);
  const members=['pro','con'].flatMap(team=>[1,2].map(i=>({id:team+i,model:'model-a',team,label:team+i})));
  const p=plan({mode:'2v2',members});assert.equal(p.turns.length,8);
  assert.deepEqual(p.turns.slice(0,4).map(t=>t.member.id),['pro1','con1','pro2','con2']);
  assert.deepEqual(p.turns.slice(4).map(t=>t.member.id),['con1','pro1','con2','pro2']);
});
test('the first round is independent and later seats share only the previous round snapshot',()=>{
  const p=plan({rounds:3}),record=(round,text)=>({ok:true,round,text,stage:'观点',member:p.members[0]});
  assert.doesNotMatch(Debate.prompt(p,p.turns[1],[record(0,'不可泄露的首席观点')]),/不可泄露/);
  const second=Debate.prompt(p,p.turns[3],[record(0,'上一轮可见'),record(1,'本轮不可见')]);
  assert.match(second,/上一轮可见/);assert.doesNotMatch(second,/本轮不可见/);
  assert.doesNotMatch(Debate.prompt(p,p.turns[5],[record(0,'过旧观点'),record(1,'上一轮观点')]),/过旧观点/);
});
test('plans are immutable, bounded and validate missing seats without demanding distinct models',()=>{
  const p=plan();assert.equal(Object.isFrozen(p.turns[0].member),true);
  assert.throws(()=>plan({rounds:4}),/1–3/);assert.throws(()=>plan({members:[{id:'one',model:'model-a'}]}),/2–6/);
  assert.throws(()=>plan({members:[{id:'one',model:'model-a'},{id:'one',model:'model-a'}]}),/标识重复/);
  assert.throws(()=>plan({topic:'长'.repeat(16001)}),/16000/);
});
test('long peer answers are bounded and explicitly marked as excerpts',()=>{
  const p=plan({summaryModel:'model-b'}),records=Array.from({length:18},(_,i)=>({ok:true,text:'观点'.repeat(20000),member:p.members[i%2],round:i%3,stage:'质询'}));
  const prompt=Debate.prompt(p,p.turns.at(-1),records);
  assert.ok(prompt.length<30000);assert.match(prompt,/本段为节选/);assert.match(prompt,/不要把多数意见当事实/);
});
test('execution preserves seat identity and produces one optional summary after all turns',async()=>{
  const p=plan({summaryModel:'model-b'}),seen=[];
  const result=await Debate.run(p,{stopped:()=>false,perform:async(turn,prompt)=>{seen.push({turn,prompt});return {ok:true,text:'观点-'+turn.member.id};}});
  assert.equal(result.status,'completed');assert.equal(seen.length,5);assert.equal(seen.at(-1).turn.summary,true);
  assert.equal(result.records[0].member.id,'seat-1');assert.equal(result.records[1].member.id,'seat-2');
  assert.doesNotMatch(seen[1].prompt,/观点-seat-1/);assert.match(seen[2].prompt,/观点-seat-1/);
});
test('stopping a call prevents all later seats and the summary',async()=>{
  let stopped=false,calls=0;const p=plan({summaryModel:'model-b'});
  const result=await Debate.run(p,{stopped:()=>stopped,perform:async()=>{calls++;stopped=true;return {ok:true,text:'partial'};}});
  assert.equal(result.status,'stopped');assert.equal(calls,1);assert.equal(result.records.length,0);
});
test('two consecutive failures end the run, while an isolated failure is not quoted as evidence',async()=>{
  let calls=0;const p=plan({summaryModel:'model-b'});
  const failed=await Debate.run(p,{stopped:()=>false,perform:async()=>{calls++;throw new Error('503');}});
  assert.equal(calls,2);assert.equal(failed.status,'failed');
  const records=[{ok:false,text:'错误不应当作观点',member:p.members[0],round:0,stage:'独立观点'}];
  assert.doesNotMatch(Debate.prompt(p,p.turns[2],records),/错误不应当作观点/);
});
