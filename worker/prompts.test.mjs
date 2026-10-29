import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import worker from './worker.js';
const sha=async value=>Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))).toString('hex');
const pass=await sha('synthetic-account-password'),shared=await sha('synthetic-shared-password');
function setup(){
  const data=new Map([['user:tester',JSON.stringify({hash:pass})],['user:other',JSON.stringify({hash:pass})]]),reads=[],writes=[];
  const kv={get:async key=>{reads.push(key);return data.get(key)||null;},put:async(key,value)=>{writes.push(key);data.set(key,value);}};
  return {data,reads,writes,env:{MEMORY_KV:kv,BIZ_KV:kv,PASSWORD:'synthetic-shared-password',ANTHROPIC_API_KEY:'test-only',GROK_API_KEY:'test-only',OPENAI_API_KEY:'test-only',GEMINI_API_KEY:'test-only'}};
}
const post=(path,body)=>new Request('https://api.pickandcase.com'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({user:'tester',password:pass,...body})});
async function setting(env,action,fields={}){const r=await worker.fetch(post('/system-prompt',{action,...fields}),env);return {status:r.status,headers:r.headers,...await r.json()};}
async function project(env,name){const r=await worker.fetch(post('/projects',{action:'create',name}),env);assert.equal(r.status,200);return (await r.json()).project;}
async function chat(env,fields={}){
  const {projectId=null,model='claude-sonnet-5-5',user='tester',password=pass,...input}=fields;
  const r=await worker.fetch(post('/',{user,password,projectId,model,chat:{scope:projectId||'general',question:'hello',history:[],system:'CLIENT_DEFAULT',systemMode:'default',...input}}),env);
  assert.equal(r.status,200);return r.text();
}
function providers(t){
  const calls=[];t.mock.method(globalThis,'fetch',async(url,options)=>{
    const host=new URL(url).hostname;
    assert.ok(['api.anthropic.com','api.x.ai','api.openai.com','generativelanguage.googleapis.com'].includes(host));
    const payload=JSON.parse(options.body);calls.push({host,payload,system:payload.system||payload.instructions||payload.systemInstruction?.parts?.[0]?.text});
    const value=host==='api.anthropic.com'?{type:'content_block_delta',delta:{type:'text_delta',text:'OK'}}:host==='generativelanguage.googleapis.com'?{candidates:[{content:{parts:[{text:'OK'}]}}]}:{type:'response.output_text.delta',delta:'OK'};
    return new Response('data: '+JSON.stringify(value)+'\n\n',{headers:{'Content-Type':'text/event-stream'}});
  });return calls;
}
test('default prompt matches the actual frontend defaults and reads do not mutate settings or memories',async()=>{
  const {env,writes}=setup(),result=await setting(env,'get');
  assert.equal(result.status,200);assert.equal(result.custom,false);assert.equal(result.scope,'general');
  const source=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const defaultChat=source.match(/var SYS_CHAT = '([^']+)'/)[1];
  assert.equal(result.prompt,"You are a helpful AI assistant. Answer in the user's language.\n用户主动选择的工作方式：\n"+defaultChat);
  assert.equal(result.headers.get('cache-control'),'no-store');assert.deepEqual(writes,[]);
});
test('saved account prompts survive new requests, reset restores defaults and memories are untouched',async t=>{
  const {env,data,writes}=setup(),calls=providers(t);data.set('mem:tester','SCOPED_MEMORY');
  const saved=await setting(env,'save',{prompt:'CUSTOM_ACCOUNT_CANARY'});assert.equal(saved.custom,true);
  assert.equal((await setting(env,'get')).prompt,'CUSTOM_ACCOUNT_CANARY');
  await chat(env);assert.match(calls.at(-1).system,/CUSTOM_ACCOUNT_CANARY/);assert.doesNotMatch(calls.at(-1).system,/CLIENT_DEFAULT/);assert.match(calls.at(-1).system,/SCOPED_MEMORY/);
  const reset=await setting(env,'reset');assert.equal(reset.custom,false);assert.equal(reset.prompt,reset.defaultPrompt);
  await chat(env);assert.doesNotMatch(calls.at(-1).system,/CUSTOM_ACCOUNT_CANARY/);assert.match(calls.at(-1).system,/CLIENT_DEFAULT/);
  assert.equal(data.get('mem:tester'),'SCOPED_MEMORY');assert.ok(writes.every(k=>k==='system-prompt:tester'||k.startsWith('billing:pending:tester:')));
});
test('account prompt settings require account authentication and cannot select another owner',async t=>{
  const {env,reads,writes}=setup(),calls=providers(t);
  for(const action of ['get','save','reset']){
    assert.equal((await setting(env,action,{password:shared,prompt:'BLOCKED'})).status,401);
    assert.equal((await setting(env,action,{password:'wrong',prompt:'BLOCKED'})).status,401);
  }
  await setting(env,'save',{prompt:'OWNER_ONLY',owner:'other',username:'tester'});
  assert.equal((await setting(env,'get',{user:'other'})).custom,false);
  reads.length=0;await chat(env,{password:shared});assert.ok(!reads.some(k=>k.startsWith('system-prompt:')));assert.doesNotMatch(calls.at(-1).system,/OWNER_ONLY/);
  assert.deepEqual(writes.filter(k=>!k.startsWith('billing:pending:shared-access:')),['system-prompt:tester']);
});
test('Oakley uses the existing account key without changing its credentials',async()=>{
  const {env,data}=setup();data.set('user:oakleyyuen',JSON.stringify({hash:pass}));
  assert.equal((await setting(env,'save',{user:'Oakley',prompt:'ALIAS_CANARY'})).status,200);
  assert.equal((await setting(env,'get',{user:'oakleyyuen'})).prompt,'ALIAS_CANARY');
  assert.equal(JSON.parse(data.get('user:oakleyyuen')).hash,pass);assert.equal(data.has('system-prompt:oakley'),false);
});
test('project prompts, instructions and general prompts remain isolated, including after reset',async t=>{
  const {env,data}=setup(),calls=providers(t),a=await project(env,'A'),b=await project(env,'B');
  await worker.fetch(post('/projects',{action:'update',projectId:a.id,name:'A',instructions:'PROJECT_INSTRUCTIONS'}),env);
  await setting(env,'save',{prompt:'GENERAL_CANARY'});await setting(env,'save',{projectId:a.id,prompt:'PROJECT_A_CANARY'});await setting(env,'save',{projectId:b.id,prompt:'PROJECT_B_CANARY'});
  for(const [projectId,canary] of [[null,'GENERAL_CANARY'],[a.id,'PROJECT_A_CANARY'],[b.id,'PROJECT_B_CANARY']]){
    const result=await setting(env,'get',{projectId});assert.equal(result.prompt,canary);
    await chat(env,{projectId,system:'CLIENT_GLOBAL_SKILL',systemMode:'skill'});const system=calls.at(-1).system;
    assert.match(system,new RegExp(canary));
    for(const other of ['GENERAL_CANARY','PROJECT_A_CANARY','PROJECT_B_CANARY'].filter(x=>x!==canary))assert.ok(!system.includes(other));
    if(projectId){assert.match(system,/项目之外的私有聊天、记忆和资料均不可用/);assert.doesNotMatch(system,/CLIENT_GLOBAL_SKILL/);}
    if(projectId===a.id)assert.match(system,/PROJECT_INSTRUCTIONS/);
  }
  assert.equal((await setting(env,'get',{projectId:a.id,user:'other'})).status,404);
  assert.equal((await setting(env,'save',{projectId:a.id,user:'other',prompt:'DENIED'})).status,404);
  assert.equal((await setting(env,'reset',{projectId:a.id,user:'other'})).status,404);
  await setting(env,'reset',{projectId:a.id});assert.equal((await setting(env,'get')).prompt,'GENERAL_CANARY');assert.equal((await setting(env,'get',{projectId:b.id})).prompt,'PROJECT_B_CANARY');
  assert.equal(JSON.parse(data.get('project:tester:'+a.id+':meta')).instructions,'PROJECT_INSTRUCTIONS');
});
test('archived or invalid projects cannot read or change prompts',async()=>{
  const {env}=setup(),a=await project(env,'A');
  await worker.fetch(post('/projects',{action:'archive',projectId:a.id}),env);
  for(const projectId of [a.id,'../../general'])for(const action of ['get','save','reset'])assert.equal((await setting(env,action,{projectId,prompt:'DENIED'})).status,404);
});
test('prompt validation rejects invalid writes and preserves the last saved value',async()=>{
  const {env}=setup();await setting(env,'save',{prompt:'KEEP_ME'});
  for(const prompt of ['', '   ', null, {},'x'.repeat(12001)])assert.equal((await setting(env,'save',{prompt})).status,400);
  assert.equal((await setting(env,'unknown')).status,400);assert.equal((await setting(env,'get')).prompt,'KEEP_ME');
  assert.equal((await worker.fetch(new Request('https://api.pickandcase.com/system-prompt',{method:'POST',body:'{'}),env)).status,400);
  assert.equal((await setting(env,'save',{prompt:'x'.repeat(12000)})).status,200);
});
test('incognito still uses the saved prompt but never reads stored memory',async t=>{
  const {env,data,reads}=setup(),calls=providers(t);data.set('mem:tester','PRIVATE_MEMORY');
  await setting(env,'save',{prompt:'INCOGNITO_PROMPT'});reads.length=0;
  await chat(env,{incognito:true});assert.match(calls.at(-1).system,/INCOGNITO_PROMPT/);assert.doesNotMatch(calls.at(-1).system,/PRIVATE_MEMORY/);assert.ok(!reads.some(k=>k.startsWith('mem:')));
});
test('selected Skills supplement a custom prompt while the normal client default does not',async t=>{
  const {env}=setup(),calls=providers(t);await setting(env,'save',{prompt:'ACCOUNT_BASE'});
  await chat(env,{system:'EXPLICIT_SKILL',systemMode:'skill'});assert.match(calls.at(-1).system,/ACCOUNT_BASE/);assert.match(calls.at(-1).system,/EXPLICIT_SKILL/);
  await chat(env,{system:'EXPLICIT_CODING',systemMode:'coding'});assert.match(calls.at(-1).system,/EXPLICIT_CODING/);
  await chat(env);assert.doesNotMatch(calls.at(-1).system,/CLIENT_DEFAULT/);
});
test('all four provider payload formats receive the persisted system prompt',async t=>{
  const {env}=setup(),calls=providers(t);await setting(env,'save',{prompt:'PROVIDER_PROMPT_CANARY'});
  for(const model of ['claude-sonnet-5-5','grok-4.7','gpt-6-astra','gemini-4-argon']){
    await chat(env,{model});assert.match(calls.at(-1).system,/PROVIDER_PROMPT_CANARY/);
  }
  assert.equal(calls.length,4);
});
