import test from 'node:test';
import assert from 'node:assert/strict';
import worker from './worker.js';
const sha=async value=>Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))).toString('hex');
const pass=await sha('test-account-password'),globalPass=await sha('legacy-shared-password');
function setup(){
  const data=new Map([['user:tester',JSON.stringify({hash:pass})],['user:another',JSON.stringify({hash:pass})]]),reads=[],writes=[];
  const kv={get:async key=>{reads.push(key);return data.get(key)||null;},put:async(key,value)=>{writes.push(key);data.set(key,value);},delete:async key=>data.delete(key),list:async({prefix})=>({keys:Array.from(data.keys()).filter(k=>k.startsWith(prefix)).map(name=>({name}))})};
  const env={MEMORY_KV:kv,BIZ_KV:kv,PASSWORD:'legacy-shared-password',ANTHROPIC_API_KEY:'test-anthropic',GROK_API_KEY:'test-xai',OPENAI_API_KEY:'test-openai',GEMINI_API_KEY:'test-google'};
  return {env,data,reads,writes};
}
const post=(path,body)=>new Request('https://api.pickandcase.com'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
async function project(env,action,fields={}){const response=await worker.fetch(post('/projects',{username:'tester',password:pass,action,...fields}),env);return {status:response.status,...await response.json()};}
async function create(env,name){return (await project(env,'create',{name})).project;}
const root=(projectId,question,fields={})=>post('/',{user:'tester',password:pass,model:'claude-sonnet-5-5',prompt:'LEGACY_PROMPT_MUST_NOT_BE_USED',projectId,chat:{scope:projectId||'general',chatId:'test-chat-123',question,query:question,history:[],...fields}});
test('expanded ZIP members and new text formats retain original bytes and paths inside their own project',async()=>{
  const {env}=setup(),a=await create(env,'ZIP A'),b=await create(env,'ZIP B');
  for(const [name,text] of [['helper.py','print("source")'],['config.yaml','price: 42'],['notes.jsonl','{"value":42}'],['Dockerfile','FROM scratch']]){
    const saved=await project(env,'upload',{projectId:a.id,file:{name,text,size:Buffer.byteLength(text),type:'text/plain',data:Buffer.from(text).toString('base64'),folder:'资料包.zip',relativePath:'src/'+name}});
    assert.equal(saved.status,200);assert.equal(saved.file.folder,'资料包.zip');assert.equal(saved.file.relativePath,'src/'+name);
    const original=await project(env,'download',{projectId:a.id,fileId:saved.file.id});
    assert.equal(original.status,200);assert.equal(original.file.data,Buffer.from(text).toString('base64'));
  }
  assert.equal((await project(env,'get',{projectId:b.id})).project.files.length,0);
  for(const name of ['raw.zip','program.exe'])assert.equal((await project(env,'upload',{projectId:a.id,file:{name,text:'source',size:6,data:Buffer.from('source').toString('base64')}})).status,400);
});
test('conversation modes are indexed on save and legacy classification returns only owned scoped metadata',async()=>{
  const {env,data,writes}=setup(),a=await create(env,'A');
  const chat=async(action,fields={})=>{const response=await worker.fetch(post('/chats',{username:'tester',password:pass,action,...fields}),env);return {status:response.status,...await response.json()};};
  const image=[{uid:1,isUser:true,text:'合成图片'},{uid:2,submodel:'gpt-image-2.5-flare',imgItems:[{data:'IMAGE_DATA_MUST_NOT_LEAVE_ARCHIVE',mime:'image/png'}]}];
  for(const [chatId,messages,mode] of [['image-chat-123',image,'image'],['debate-chat-123',[{uid:1,isUser:true,debateRun:{id:'run'}}],'debate'],['normal-chat-123',[{uid:1,isUser:true,text:'文本问题'},{uid:2,submodel:'gpt-6.1-sol',text:'文本回答'}],'chat']]){
    assert.equal((await chat('save',{chatId,messages})).status,200);
    assert.equal((await chat('list')).chats.find(item=>item.id===chatId).mode,mode);
  }
  data.set('chats:tester:list',JSON.stringify([{id:'legacy-chat-123',updatedAt:123}]));data.set('chats:tester:legacy-chat-123',JSON.stringify(image));
  data.set('chats:another:foreign-chat-123',JSON.stringify(image));data.set('project:tester:'+a.id+':chats:legacy-chat-123',JSON.stringify([{isUser:true,debateRun:{id:'project-run'}}]));
  data.set('project:tester:'+a.id+':chats:list',JSON.stringify([{id:'legacy-chat-123'}]));
  writes.length=0;const before=data.get('chats:tester:legacy-chat-123');
  const metadata=await chat('modes',{chatIds:['legacy-chat-123','foreign-chat-123','not-listed-123']});
  assert.deepEqual(metadata.modes,[{id:'legacy-chat-123',mode:'image'}]);assert.ok(!JSON.stringify(metadata).includes('IMAGE_DATA'));
  assert.deepEqual((await chat('modes',{projectId:a.id,chatIds:['legacy-chat-123']})).modes,[{id:'legacy-chat-123',mode:'debate'}]);
  assert.equal(data.get('chats:tester:legacy-chat-123'),before);assert.equal(writes.length,0,'classification never rewrites old records');
  assert.equal((await chat('modes',{chatIds:Array(9).fill('legacy-chat-123')})).status,400);
  assert.equal((await chat('modes',{chatIds:['../../private']})).status,400);
  const foreignProject=await worker.fetch(post('/chats',{username:'another',password:pass,projectId:a.id,action:'modes',chatIds:['legacy-chat-123']}),env);assert.equal(foreignProject.status,404);
});
function streamText(text='已回复'){
  return new Response('data: '+JSON.stringify({type:'content_block_delta',delta:{type:'text_delta',text}})+'\n\n',{headers:{'Content-Type':'text/event-stream'}});
}
function upstream(t,calls){
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    assert.ok(['api.anthropic.com','api.x.ai'].includes(new URL(url).hostname));assert.equal(options.redirect,'manual');
    const payload=JSON.parse(options.body);calls.push({url,payload});
    if(payload.model==='claude-haiku-4-5-20251001')return Response.json({content:[{type:'text',text:'旧摘要：保留预算 73921.50 元和既定约定。'}],usage:{input_tokens:20,output_tokens:10}});
    return payload.stream&&new URL(url).hostname==='api.x.ai'?new Response('data: '+JSON.stringify({type:'response.output_text.delta',delta:'Grok 回复'})+'\n\n'):streamText();
  });
}
test('project conversations and memories are isolated from general chat and each other',async()=>{
  const {env,data}=setup(),a=await create(env,'A'),b=await create(env,'B');
  data.set('mem:tester','GENERAL_MEMORY');data.set('project:tester:'+a.id+':memory','A_MEMORY');
  for(const [projectId,text] of [[null,'GENERAL_CHAT'],[a.id,'A_CHAT'],[b.id,'B_CHAT']]){
    const response=await worker.fetch(post('/chats',{username:'tester',password:pass,projectId,action:'save',chatId:'shared-chat-id',title:text,messages:[{uid:1,isUser:true,text}]}),env);assert.equal(response.status,200);
  }
  for(const [projectId,expected] of [[null,'GENERAL_CHAT'],[a.id,'A_CHAT'],[b.id,'B_CHAT']]){
    const response=await worker.fetch(post('/chats',{username:'tester',password:pass,projectId,action:'load',chatId:'shared-chat-id'}),env);assert.equal((await response.json()).messages[0].text,expected);
  }
  const query='?user=tester&pass='+pass;
  assert.equal((await (await worker.fetch(new Request('https://api.pickandcase.com/memory'+query),env)).json()).memory,'GENERAL_MEMORY');
  assert.equal((await (await worker.fetch(new Request('https://api.pickandcase.com/memory'+query+'&projectId='+a.id),env)).json()).memory,'A_MEMORY');
  assert.equal((await (await worker.fetch(new Request('https://api.pickandcase.com/memory'+query+'&projectId='+b.id),env)).json()).memory,'');
});
test('project and conversation pins are account and project scoped and never rewrite saved content',async()=>{
  const {env,data}=setup(),a=await create(env,'A'),b=await create(env,'B');
  const chat=(action,fields={})=>worker.fetch(post('/chats',{username:'tester',password:pass,action,...fields}),env);
  for(const projectId of [null,a.id,b.id]){
    assert.equal((await chat('save',{projectId,chatId:'chat-test-123',title:'记录',messages:[{uid:1,text:'不要修改的内容'}]})).status,200);
  }
  const generalBefore=data.get('chats:tester:chat-test-123'),projectBefore=data.get('project:tester:'+a.id+':chats:chat-test-123');
  assert.equal((await project(env,'pin',{projectId:a.id,pinned:true})).status,200);
  assert.equal((await chat('pin',{projectId:a.id,chatId:'chat-test-123',pinned:true})).status,200);
  assert.equal((await chat('pin',{projectId:a.id,chatId:'missing-123',pinned:true})).status,404);
  assert.equal((await project(env,'pin',{projectId:b.id,pinned:'yes'})).status,400);
  const listed=(await project(env,'list')).projects;
  assert.equal(listed.find(item=>item.id===a.id).pinned,true);assert.equal(!!listed.find(item=>item.id===b.id).pinned,false);
  const entries=async projectId=>(await (await chat('list',{projectId})).json()).chats;
  assert.equal((await entries(a.id))[0].pinned,true);
  assert.equal(!!(await entries(null))[0].pinned,false);assert.equal(!!(await entries(b.id))[0].pinned,false);
  const other=await worker.fetch(post('/projects',{username:'another',password:pass,action:'pin',projectId:a.id,pinned:true}),env);
  assert.equal(other.status,404);
  assert.equal(data.get('chats:tester:chat-test-123'),generalBefore);assert.equal(data.get('project:tester:'+a.id+':chats:chat-test-123'),projectBefore);
  assert.equal((await chat('pin',{projectId:a.id,chatId:'chat-test-123',pinned:false})).status,200);
  assert.equal((await project(env,'pin',{projectId:a.id,pinned:false})).status,200);
  assert.equal(!!(await entries(a.id))[0].pinned,false);assert.equal(!!(await project(env,'list')).projects.find(item=>item.id===a.id).pinned,false);
});
test('project ownership and explicit scope are checked before any provider request',async t=>{
  const {env}=setup(),a=await create(env,'A'),calls=[];upstream(t,calls);
  assert.equal((await project(env,'get',{projectId:a.id,username:'another'})).status,404);
  assert.equal((await worker.fetch(post('/chats',{username:'another',password:pass,projectId:a.id,action:'list'}),env)).status,404);
  assert.equal((await worker.fetch(root(a.id,'test',{scope:'general'}),env)).status,409);
  assert.equal((await worker.fetch(post('/',{user:'tester',password:globalPass,model:'claude-sonnet-5-5',projectId:a.id,chat:{scope:a.id,question:'test',history:[]}}),env)).status,401);
  assert.equal((await project(env,'get',{projectId:'../../memory'})).status,404);assert.equal(calls.length,0);
});
test('ordinary chat never reads a project memory or project file',async t=>{
  const {env,data,reads}=setup(),a=await create(env,'A'),calls=[];upstream(t,calls);
  data.set('mem:tester','GENERAL_CANARY');data.set('project:tester:'+a.id+':memory','PROJECT_CANARY');reads.length=0;
  await (await worker.fetch(root(null,'你好'),env)).text();
  assert.ok(calls[0].payload.system.includes('GENERAL_CANARY'));
  assert.ok(!JSON.stringify(calls[0]).includes('PROJECT_CANARY'));
  assert.ok(!reads.some(k=>k.startsWith('project:')));
});
test('legacy shared-password requests cannot read account archives, memory or summaries',async t=>{
  const {env,data,reads}=setup(),calls=[];upstream(t,calls);
  data.set('chats:tester:test-chat-123',JSON.stringify([{uid:1,isUser:true,text:'PRIVATE_ARCHIVE_CANARY'}]));
  data.set('mem:tester','PRIVATE_MEMORY_CANARY');reads.length=0;
  const req=post('/',{user:'tester',password:globalPass,model:'claude-sonnet-5-5',chat:{scope:'general',chatId:'test-chat-123',question:'你好',history:[]}});
  await(await worker.fetch(req,env)).text();
  assert.ok(!reads.some(k=>k.startsWith('chats:')||k.startsWith('mem:')));
  assert.ok(!JSON.stringify(calls).includes('PRIVATE_'));
});
test('POST memory reads use the requested scope and require the owning account',async()=>{
  const {env,data}=setup(),a=await create(env,'A');
  data.set('mem:tester','GENERAL_ONLY');data.set('project:tester:'+a.id+':memory','PROJECT_ONLY');
  for(const [projectId,expected] of [[null,'GENERAL_ONLY'],[a.id,'PROJECT_ONLY']]){
    const response=await worker.fetch(post('/memory',{user:'tester',password:pass,projectId,action:'get'}),env);
    assert.equal((await response.json()).memory,expected);
  }
  assert.equal((await worker.fetch(post('/memory',{user:'another',password:pass,projectId:a.id,action:'get'}),env)).status,404);
  assert.equal((await worker.fetch(post('/memory',{user:'tester',password:globalPass,action:'get'}),env)).status,401);
});
test('saving a new conversation retains earlier entries beyond the old 50-chat cap',async()=>{
  const {env,data}=setup(),earlier=Array.from({length:55},(_,i)=>({id:'saved-'+i,title:'记录 '+i,updatedAt:i+1}));
  data.set('chats:tester:list',JSON.stringify(earlier));data.set('chats:tester:saved-0','[]');
  const response=await worker.fetch(post('/chats',{username:'tester',password:pass,action:'save',chatId:'new-chat-123',title:'新记录',messages:[{uid:1,isUser:true,text:'你好'}]}),env);
  assert.equal(response.status,200);assert.equal(JSON.parse(data.get('chats:tester:list')).length,56);assert.equal(data.get('chats:tester:saved-0'),'[]');
});
test('editing an earlier question does not reload later messages from the saved branch',async t=>{
  const {env,data}=setup(),calls=[];upstream(t,calls);
  data.set('chats:tester:test-chat-123',JSON.stringify([{uid:1,isUser:true,text:'最初的问题'},{uid:2,text:'FIRST_ANSWER'},{uid:3,isUser:true,text:'LATER_BRANCH_CANARY'},{uid:4,text:'LATER_REPLY_CANARY'}]));
  await(await worker.fetch(root(null,'修改后的问题',{historyLength:2,historyEndUid:'2',history:[{uid:'1',role:'user',text:'最初的问题'},{uid:'2',role:'assistant',text:'FIRST_ANSWER'}]}),env)).text();
  assert.ok(!JSON.stringify(calls).includes('LATER_'));assert.ok(JSON.stringify(calls).includes('FIRST_ANSWER'));
  calls.length=0;
  await(await worker.fetch(root(null,'修改第一问',{historyLength:0,historyEndUid:null}),env)).text();
  assert.equal(calls.at(-1).payload.messages.length,1);assert.equal(calls.at(-1).payload.messages[0].content[0].text,'修改第一问');
});
test('project requests ignore general memory and unrelated client instructions',async t=>{
  const {env,data,reads}=setup(),a=await create(env,'A'),calls=[];upstream(t,calls);
  data.set('mem:tester','GENERAL_CANARY');data.set('project:tester:'+a.id+':memory','PROJECT_CANARY');reads.length=0;
  await (await worker.fetch(root(a.id,'你好',{system:'ACCIDENTAL_GLOBAL_SKILL'}),env)).text();
  const payload=calls[0].payload;assert.ok(payload.system.includes('PROJECT_CANARY'));assert.ok(!payload.system.includes('GENERAL_CANARY'));assert.ok(!payload.system.includes('ACCIDENTAL_GLOBAL_SKILL'));
  assert.ok(!reads.includes('mem:tester'));
  assert.equal((payload.messages.map(m=>typeof m.content==='string'?m.content:JSON.stringify(m.content)).join(' ').match(/你好/g)||[]).length,1);
});
test('project files are retrieved by relevant chunks, and not read on small talk',async t=>{
  const {env,data,reads}=setup(),a=await create(env,'A'),b=await create(env,'B'),calls=[];upstream(t,calls);
  const file={name:'售后规则.txt',size:9,type:'text/plain',text:'退款窗口为 37 天。品牌代号 AURORA-Z9。\n'+('无关背景。\n'.repeat(1000)),data:Buffer.from('test file').toString('base64')};
  const uploaded=await project(env,'upload',{projectId:a.id,file});assert.equal(uploaded.status,200);
  await project(env,'upload',{projectId:b.id,file:{...file,text:'退款窗口为 99 天。OTHER_PROJECT_CANARY'}});
  reads.length=0;await(await worker.fetch(root(a.id,'你好'),env)).text();
  assert.ok(!reads.some(k=>k.includes(':file:')));assert.ok(!JSON.stringify(calls.at(-1)).includes('37 天'));
  reads.length=0;
  const result=await(await worker.fetch(root(a.id,'AURORA-Z9 的退款窗口是多少天？'),env)).text();
  const payload=calls.at(-1).payload,text=JSON.stringify(payload);
  assert.ok(text.includes('37 天'));assert.ok(!text.includes('OTHER_PROJECT_CANARY'));assert.ok(!reads.some(k=>k.includes(b.id)));
  assert.ok(!reads.some(k=>k.endsWith(':original')));assert.ok(reads.filter(k=>k.includes(':chunk:')).length<=3);
  assert.ok(result.includes('"fileFragments":'));assert.ok(text.length<16000);
});
test('files can be previewed, soft removed and restored only in their owning project',async()=>{
  const {env}=setup(),a=await create(env,'A'),b=await create(env,'B');
  const uploaded=await project(env,'upload',{projectId:a.id,file:{name:'背景.docx',size:3,type:'application/octet-stream',text:'项目原文',data:'YWJj'}});
  const fileId=uploaded.file.id;
  assert.equal((await project(env,'preview',{projectId:b.id,fileId})).status,404);
  assert.equal((await project(env,'preview',{projectId:a.id,fileId})).file.text,'项目原文');
  assert.equal((await project(env,'download',{projectId:a.id,fileId})).file.data,'YWJj');
  await project(env,'remove_file',{projectId:a.id,fileId});assert.equal((await project(env,'preview',{projectId:a.id,fileId})).status,404);
  await project(env,'restore_file',{projectId:a.id,fileId});assert.equal((await project(env,'preview',{projectId:a.id,fileId})).file.text,'项目原文');
  await project(env,'archive',{projectId:a.id});assert.equal((await project(env,'get',{projectId:a.id})).status,404);
  await project(env,'archive',{projectId:a.id,archived:false});assert.equal((await project(env,'get',{projectId:a.id})).status,200);
});
test('generic project wording in a memory question does not pull unrelated file chunks',async t=>{
  const {env,reads}=setup(),a=await create(env,'A'),calls=[];upstream(t,calls);
  await project(env,'upload',{projectId:a.id,file:{name:'项目背景.docx',size:3,type:'application/octet-stream',text:'项目代号 AURORA-Z9。退款窗口为 37 天。',data:'YWJj'}});
  reads.length=0;const result=await(await worker.fetch(root(a.id,'本项目记忆中的验收暗号是什么？'),env)).text();
  assert.ok(!reads.some(k=>k.includes(':chunk:')));assert.ok(result.includes('"fileFragments":0'));
  assert.ok(!JSON.stringify(calls).includes('37 天'));
});
test('history that fits the model is sent in full without a paid summarizer or archive changes',async t=>{
  const {env,data}=setup(),calls=[];upstream(t,calls);
  const messages=Array.from({length:40},(_,i)=>({uid:i+1,isUser:i%2===0,text:i===0?'蓝莓项目预算为 73921.50 元，截止日期 2027-03-19。':'一般对话 '+i+' '+('其他资料。'.repeat(80))}));
  data.set('chats:tester:test-chat-123',JSON.stringify(messages));
  const response=await worker.fetch(root(null,'蓝莓项目预算和截止日期是多少？'),env),text=await response.text();
  const main=calls.find(c=>c.payload.model==='claude-sonnet-5-5').payload;
  assert.ok(main.messages[0].content.includes('73921.50'));assert.ok(main.messages[0].content.includes('2027-03-19'));
  assert.equal(main.messages.length,41);assert.ok(text.includes('"olderSummary":false'));assert.ok(text.includes('"historyPolicy":"full"'));
  assert.equal(calls.length,1);assert.equal(main.max_tokens,128000);
  assert.equal(data.has('chats:tester:summary:test-chat-123'),false);
  assert.equal(JSON.parse(data.get('chats:tester:test-chat-123')).length,40);
});
test('incognito requests do not read or write stored memories, conversations or summaries',async t=>{
  const {env,reads,writes}=setup(),calls=[];upstream(t,calls);reads.length=0;writes.length=0;
  await(await worker.fetch(root(null,'你好',{incognito:true,history:[{uid:1,role:'user',text:'临时问题'}]}),env)).text();
  assert.ok(!reads.some(k=>k.startsWith('mem:')||k.startsWith('chats:')));
  assert.ok(!writes.some(k=>k.startsWith('mem:')||k.startsWith('chats:')));
});
test('Grok scoped chat sends complete user text and valid assistant history',async t=>{
  const {env}=setup(),calls=[];upstream(t,calls);
  const req=post('/',{user:'tester',password:pass,model:'grok-4.7',chat:{scope:'general',chatId:'new-chat-123',question:'完整问题不能只剩第一个字',history:[{uid:1,role:'user',text:'旧问题'},{uid:2,role:'assistant',text:'旧回答'}]}});
  await(await worker.fetch(req,env)).text();
  const payload=calls[0].payload;
  assert.equal(payload.input.at(-1).content,'完整问题不能只剩第一个字');
  assert.equal(payload.input[1].role,'assistant');assert.equal(payload.input[1].content,'旧回答');
});
for(const model of ['claude-sonnet-5-5','grok-4.7'])test(model+' delivers the first text event before upstream completion',async t=>{
  const {env}=setup();let controller,release,completed=false;
  const gate=new Promise(resolve=>release=resolve);
  t.mock.method(globalThis,'fetch',async()=>new Response(new ReadableStream({start(c){controller=c;const event=model.startsWith('claude')?{type:'content_block_delta',delta:{type:'text_delta',text:'FIRST'}}:{type:'response.output_text.delta',delta:'FIRST'};c.enqueue(new TextEncoder().encode('data: '+JSON.stringify(event)+'\n\n'));gate.then(()=>{completed=true;c.close();});}})));
  const response=await worker.fetch(post('/',{user:'tester',password:pass,model,prompt:'stream test'}),env),reader=response.body.getReader();let text='';
  try{
    while(!text.includes('FIRST')){const result=await Promise.race([reader.read(),new Promise((_,reject)=>setTimeout(()=>reject(new Error('First token buffered')),1000))]);assert.equal(result.done,false);text+=new TextDecoder().decode(result.value);}
    assert.equal(completed,false);assert.equal(response.headers.get('Content-Encoding'),'identity');
  }finally{release();while(!(await reader.read()).done){}}
});
