const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const policy=require('./arena-skill-models.js');
const source=fs.readFileSync(__dirname+'/index.html','utf8');
const catalog=JSON.parse(fs.readFileSync(__dirname+'/skills/catalog.json','utf8'));
const models=['claude-fable-5-1','claude-opus-5-5','claude-sonnet-5-5','grok-4.7','gemini-4-argon','gpt-6-astra','gpt-6.1-sol'];
const names={...policy.names,'grok-4.7':'Grok 4.7','gemini-4-argon':'Gemini 4 Argon','gpt-6-astra':'GPT 6 Astra','gpt-6.1-sol':'GPT 6.1 Sol'};
function fn(name){const match=source.match(new RegExp('  function '+name+'\\([^]*?\\n  }'));assert.ok(match,name);return match[0];}
function fixture(){
  const elements=new Map(),storage=new Map(),events=new Map();let scope='general',saved=0;
  function node(id){if(!elements.has(id))elements.set(id,{innerHTML:'',textContent:'',hidden:false,setAttribute(){},classList:{toggle(){},remove(){}},addEventListener(type,handler){events.set(id+':'+type,handler);}});return elements.get(id);}
  const cards=['anthropic','xai','openai','google'].map(brand=>({dataset:{brand}}));
  const context=vm.createContext({console,document:{getElementById:node,querySelectorAll:()=>cards},localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},
    $:node,ArenaModelControl:require('./arena-model-control.js'),ArenaSkillModels:policy,ArenaSkillCatalog:catalog,AVAILABLE_CHAT_MODELS:models,SUBS:Object.fromEntries(models.map(id=>[id,{name:names[id],brand:id.startsWith('claude')?'anthropic':id.startsWith('gpt')?'openai':id.startsWith('grok')?'xai':'google'}])),BRANDS:{anthropic:{color:'#f59e0b'}},
    activeBrands:{xai:true},brandSelection:{xai:'grok-4.7',anthropic:policy.defaultModel},debate:false,imageMode:false,videoMode:false,aaRunning:false,
    normalizeAvailableModels(){},saveState(){saved++;},syncBrandUI(){},closeArenaModelMenu(){},syncArenaLayout(){},EFFORT_LEVELS:{},EFFORT_LABELS:{},EFFORT_DESCRIPTIONS:{},effortFor(){},
    showArenaEffortCard(){},positionArenaPopover(){},arenaNotice(text){context.notice=text;}});
  context.window=context;
  vm.runInContext(fs.readFileSync(__dirname+'/arena-skills.js','utf8'),context);
  vm.runInContext(['skillModelRestricted','eligibleChatModels','enforceSkillModel','adoptSkillExecutionModel','getActiveSubmodels','renderArenaModelMenu'].map(fn).join('\n'),context);
  context.skillsRuntime=context.ArenaSkills.install({auth:()=>({username:'tester'}),scope:()=>scope,mode:()=>context.debate?'debate':'chat',selectionChanged:()=>context.enforceSkillModel()});
  const listener=source.slice(source.indexOf("  $('aaModelsSubmenu').addEventListener('click'," )).match(/^[^]*?\n  \}\);/)[0];
  vm.runInContext(listener,context);
  return {c:context,node,storage,scope(value){scope=value;},get saved(){return saved;},click(model){events.get('aaModelsSubmenu:click')({target:{closest(selector){return selector==='[data-arena-model]'?{dataset:{arenaModel:model}}:null;}},stopPropagation(){}});}};
}
for(const id of ['pptx','xlsx','docx','pdf'])test(id+' switches to Claude, renders only compatible models and rejects a stale non-Claude button',()=>{
  const f=fixture();f.c.skillsRuntime.activate(id);
  assert.deepEqual(Array.from(f.c.getActiveSubmodels()),[policy.defaultModel]);
  f.c.renderArenaModelMenu();
  const offered=[...f.node('aaModelsSubmenu').innerHTML.matchAll(/data-arena-model="([^"]+)"/g)].map(match=>match[1]);
  assert.deepEqual(offered,models.slice(0,3));
  assert.match(f.node('aaModelsSubmenu').innerHTML,/仅支持 Claude/);
  f.click('gpt-6-astra');assert.deepEqual(Array.from(f.c.getActiveSubmodels()),[policy.defaultModel]);assert.match(f.c.notice,/仅支持 Claude/);
  f.click('claude-opus-5-5');assert.deepEqual(Array.from(f.c.getActiveSubmodels()),['claude-opus-5-5']);
  assert(f.saved>0);
});
test('automatic, disabled and ordinary text Skills restore all model choices',()=>{
  const f=fixture();f.c.skillsRuntime.activate('pptx');f.c.skillsRuntime.automatic();
  assert.deepEqual(Array.from(f.c.eligibleChatModels()),models);
  f.c.skillsRuntime.activate('translate');assert.deepEqual(Array.from(f.c.eligibleChatModels()),models);
  assert.deepEqual(policy.available(models,{mode:'off',ids:['pptx']},catalog),models);
});
test('restored project settings enforce Claude before sending and do not restrict another project or debate',()=>{
  const f=fixture();f.c.skillsRuntime.activate('xlsx');f.scope('project-b');
  assert.deepEqual(Array.from(f.c.eligibleChatModels()),models);
  f.c.activeBrands={openai:true};f.c.brandSelection.openai='gpt-6-astra';f.scope('general');
  assert.deepEqual(Array.from(f.c.getActiveSubmodels()),[policy.defaultModel]);
  f.c.debate=true;assert.deepEqual(Array.from(f.c.eligibleChatModels()),models);
});
test('automatic execution metadata updates the visible choice and persisted message identity while running',()=>{
  const f=fixture(),message={submodel:'grok-4.7',brand:'xai'};f.c.aaRunning=true;
  f.c.adoptSkillExecutionModel('claude-opus-5-5',message);
  assert.equal(message.executionModel,'claude-opus-5-5');assert.equal(message.submodel,'claude-opus-5-5');assert.equal(message.brand,'anthropic');
  assert.match(message.name,/Claude Opus 5.5/);assert.deepEqual(Array.from(f.c.getActiveSubmodels()),['claude-opus-5-5']);assert(f.saved>0);
});
