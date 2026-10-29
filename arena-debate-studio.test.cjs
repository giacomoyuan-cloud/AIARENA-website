const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const Studio=require('./arena-debate-studio.js'),Core=require('./arena-debate.js');
const model='gpt-6.1-sol',choices={[model]:['low','medium','high','xhigh','max']};
const make=extra=>Core.plan({id:'run-studio-1',mode:'free',rounds:2,topic:'是否试行周末开放',models:[model],members:[{id:'seat-1',label:'席位一',model,effort:'low'},{id:'seat-2',label:'席位二',model,effort:'high'}],...extra});

test('same-model seats keep independent depth; bulk choices respect every selected model',()=>{
  const members=make().members,values={'seat-1':'low','seat-2':'high'};
  assert.deepEqual(members.map(m=>Studio.effort(m,values,choices,'medium')),['low','high']);
  assert.equal(Studio.effort(members[1],{'seat-2':'unsupported'},choices,'low'),'low');
  assert.deepEqual(Studio.commonEfforts([...members,{model:'other'}],{...choices,other:['low','high']}),['low','high']);
  assert.deepEqual(Studio.commonEfforts([...members,{model:'no-depth'}],choices),[]);
});
test('six-role drafts retain allowed values and bound stale or oversized fields',()=>{
  const draft=Studio.cleanDraft({mode:'persona',roleCount:6,roles:Array(7).fill({model,role:'甲'.repeat(200),desc:'乙'.repeat(700)}),context:'字'.repeat(7000),efforts:{'role-6':'max','role-7':'low',summary:'low'},summary:model},[model],choices);
  assert.equal(draft.roles.length,6);assert.equal(draft.roleCount,6);assert.equal(draft.roles[0].role.length,120);assert.equal(draft.roles[0].desc.length,500);assert.equal(draft.context.length,6000);
  assert.equal(draft.efforts['role-6'],'max');assert.equal(draft.efforts['role-7'],undefined);
  assert.equal(Studio.cleanDraft({roleCount:2.5,models:['retired',model]},[model],choices).roleCount,2);
});
test('objectives, briefing and expression length actually reach all stage prompts',()=>{
  const p=make({rounds:3,objective:'stress-test',detail:'concise',context:'开放时间目前到18点',constraints:'预算不超过300元',summaryModel:model,summaryEffort:'low'});
  for(const turn of p.turns){const prompt=Core.prompt(p,turn,[]);assert.match(prompt,/方案压力测试/);assert.match(prompt,/开放时间目前到18点/);assert.match(prompt,/预算不超过300元/);assert.match(prompt,/120–220/);}
  assert.match(Core.prompt(p,p.turns[2],[]),/最强、最公平/);assert.match(Core.prompt(p,p.turns[4],[]),/保留或改变/);
  assert.equal(p.turns.at(-1).member.effort,'low');
  assert.throws(()=>make({objective:'invented'}),/讨论目标/);assert.throws(()=>make({context:'x'.repeat(6001)}),/6000/);
});
test('continuation quotes completed evidence, identifies incomplete source and bounds excerpts',()=>{
  const p=make();const turns=[{index:0,status:'completed',reply:{text:'真实已完成的观点'+ '长'.repeat(20000)}},{index:1,status:'failed',reply:{text:'不可靠的失败片段'}}];
  const context=Core.continuation(p,turns);assert.ok(context.length<=12000);assert.match(context,/真实已完成的观点/);assert.match(context,/存在未完成/);assert.doesNotMatch(context,/不可靠的失败片段/);
  assert.throws(()=>Core.continuation(p,turns.slice(1)),/没有可引用/);
  assert.ok(Core.continuation(p,turns,4200).length<=6000,'inline incognito reference fits the existing quote limit');
});
test('export keeps partial text, actual depth, failure, outdated warning and safe source URLs',()=>{
  const p=make({objective:'decision'}),markdown=Core.exportMarkdown({plan:p,status:'partial',turns:[{index:0,status:'completed',reply:{submodel:model,effort:'low',text:'实际原文',citations:[{title:'来源',url:'https://example.com/evidence'},{url:'javascript:alert(1)'},{url:'https://user:pass@example.com/'}]}},{index:1,status:'failed',outdated:true,error:'执行中断',reply:{text:'已收到片段',effort:'high'}}]});
  for(const text of ['辅助决策','实际原文','已收到片段','状态：失败','思考深度：low','较早席位后来补全','https://example.com/evidence'])assert.ok(markdown.includes(text));
  assert.doesNotMatch(markdown,/javascript:|user:pass/);
});
test('draft scope changes clear private notes and incognito never overwrites saved normal settings',()=>{
  const source=fs.readFileSync(require('node:path').join(__dirname,'index.html'),'utf8');
  const names=['debateScopeKey','saveDebateDraft','restoreDebateDraft'];const functions=names.map(name=>source.match(new RegExp('  function '+name+'\\([^]*?\\n  }'))[0]).join('\n');
  const elements={aaUsername:{value:'Tester'}};for(let i=0;i<6;i++){elements['aaPersonaRole'+i]={value:''};elements['aaPersonaDesc'+i]={value:''};}
  const saved=new Map(),c=vm.createContext({window:{ArenaDebateStudio:Studio},ArenaDebateStudio:Studio,$:id=>elements[id],localStorage:{getItem:k=>saved.get(k),setItem:(k,v)=>saved.set(k,v)},
    activeProjectId:null,_incognitoMode:false,debateDraftScope:null,debateRestoringDraft:false,debateSettings:{},debateSeatEfforts:{},debatePriorRunId:null,debateModels:[model,model],personaState:Array(6).fill(null),seatState:{pro:[null,null],con:[null,null]},personaSlotCount:2,judgeModel:'none',debateMode:'persona',rounds:1,AVAILABLE_CHAT_MODELS:[model],EFFORT_LEVELS:choices,SUBS:{[model]:{brand:'openai'}},brandSelection:{},seedDebateMode(){}});
  vm.runInContext(functions,c);c.restoreDebateDraft();c.debateSettings.context='普通设置';elements.aaPersonaRole0.value='项目私密角色';c.saveDebateDraft();
  c.activeProjectId='project-other';c.restoreDebateDraft();assert.equal(c.debateSettings.context,'');assert.equal(elements.aaPersonaRole0.value,'');
  c.activeProjectId=null;c.restoreDebateDraft();assert.equal(c.debateSettings.context,'普通设置');assert.equal(elements.aaPersonaRole0.value,'项目私密角色');
  c._incognitoMode=true;c.restoreDebateDraft();c.debateSettings.context='无痕内容';c.saveDebateDraft();c._incognitoMode=false;c.restoreDebateDraft();assert.equal(c.debateSettings.context,'普通设置');assert.ok(!JSON.stringify([...saved.values()]).includes('无痕内容'));
});

for(const incognito of [false,true])test('follow-up '+(incognito?'quotes only completed page content without a server record':'retains the owned server run reference'),async()=>{
  const source=fs.readFileSync(require('node:path').join(__dirname,'index.html'),'utf8'),fn=source.match(/  async function controlDurableDebate\([^]*?\n  }/)[0],p=make({rounds:1});
  const view={ref:{id:'source-run-001'},snapshot:{plan:p,status:'partial',incognito,turns:[{index:0,status:'completed',reply:{text:'真实已完成的发言',effort:'low'}},{index:1,status:'failed',reply:{text:'不能引用的失败片段',effort:'high'}}]}};
  let quote=null;const topic={value:'',style:{},focus(){}};
  const c=vm.createContext({durableDebateView:view,debateCurrent:v=>v===view,ArenaDebate:Core,ArenaDebateRuns:{control(){throw new Error('follow-up setup must not execute a paid request');}},
    applyDebatePlan(){},debateSeatEfforts:{},debatePriorRunId:null,rounds:2,debate:false,imageMode:false,videoMode:false,$:()=>topic,
    clearDebateView(){c.durableDebateView=null;},clearQuote(){quote=null;},setQuote(author,text){quote={author,text};},syncBrandUI(){},sync2v2UI(){},syncArenaLayout(){},saveState(){},arenaNotice(){}});
  vm.runInContext(fn,c);await c.controlDurableDebate('followup');assert.equal(c.rounds,1);assert.equal(c.debateSeatEfforts['seat-1'],'low');
  if(incognito){assert.equal(c.debatePriorRunId,null);assert.match(quote.text,/真实已完成的发言/);assert.doesNotMatch(quote.text,/不能引用/);assert.ok(quote.text.length<6000);}
  else{assert.equal(c.debatePriorRunId,'source-run-001');assert.equal(quote,null);}
});
