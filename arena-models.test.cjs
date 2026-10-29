const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const ArenaImage = require('./arena-image.js');

const source = readFileSync(require('node:path').join(__dirname, 'index.html'), 'utf8');
function browserFunction(name) {
  const match = source.match(new RegExp('  function ' + name + '\\([^]*?\\n  }'));
  assert.ok(match, 'browser function exists: ' + name);
  return match[0];
}
function browser(saved = {}) {
  const storage = new Map(Object.entries(saved));
  const context = vm.createContext({
    ArenaImage, ArenaModelControl: require('./arena-model-control.js'),
    localStorage: { getItem: key => storage.get(key) ?? null },
    document: { querySelectorAll: () => ['xai', 'anthropic', 'openai', 'google'].map(brand => ({ dataset: { brand } })) },
    imageMode: false, videoMode: false, debate: false, debateMode: 'free',
    imageComposerModel: 'grok-imagine-image-2.0',
    activeBrands: { xai: false, anthropic: false, openai: false, google: true },
    brandSelection: { xai: 'grok-4.7', anthropic: 'claude-sonnet-5-5', google: 'gemini-4-argon' }
  });
  vm.runInContext(source.slice(source.indexOf('  var AVAILABLE_CHAT_MODELS'), source.indexOf('  var SYS_DEBATE')), context);
  for (const name of ['loadState', 'normalizeAvailableModels', 'getActiveSubmodels']) vm.runInContext(browserFunction(name), context);
  return context;
}

test('search summary distinguishes actual image, web and combined search results', () => {
  const context=vm.createContext({esc:value=>String(value),URL,AVAILABLE_CHAT_MODELS:[]});
  vm.runInContext(browserFunction('chatReplyView')+'\n'+browserFunction('syncActivityDisclosure')+'\n'+browserFunction('renderMessageActivity'),context);
  for(const [searchModes,label] of [[{web:false,image:true},'已搜索图片'],[{web:true,image:true},'已搜索网页与图片'],[{web:true,image:false},'已搜索网页'],[undefined,'已搜索网页']]){
    const html=context.renderMessageActivity({activity:[{kind:'search_results',searchModes,label:'Search'}]});
    assert.ok(html.includes('<summary>'+label+'</summary>'));
    assert.ok(context.renderMessageActivity({activity:[{kind:'search_results',searchModes,label:'Search'}],reasoning:'公开摘要'}).includes('<summary>已思考，'+label+'</summary>'));
  }
  assert.equal(context.renderMessageActivity({activity:[]}), '');
});

for (const model of ['gemini-4-argon', 'gemini-3.8-flash', 'gemini-3.1-pro-preview']) {
  test(model + ' restores the requested Gemini 4 model through synchronization and reload', () => {
    const context = browser({
      'aa-brand-selection': JSON.stringify({ google: model }),
      'aa-active-brands': JSON.stringify({ xai: false, anthropic: false, google: true })
    });
    context.loadState();
    assert.ok(context.AVAILABLE_CHAT_MODELS.includes('gemini-4-argon'));
    for (let i = 0; i < 3; i++) assert.deepEqual(Array.from(context.getActiveSubmodels()), ['gemini-4-argon']);
  });
}

test('Gemini image generation and editing never silently switch to Grok', () => {
  const context = browser();
  context.imageMode = true;
  context.imageComposerModel = 'gemini-nano-banana-2.1';
  assert.ok(context.IMAGE_MODELS.some(model => model.value === context.imageComposerModel));
  for (let i = 0; i < 3; i++) assert.deepEqual(Array.from(context.getActiveSubmodels()), ['gemini-nano-banana-2.1']);
});

test('unavailable legacy routes still normalize to supported models', () => {
  const context = browser();
  context.activeBrands = { mj: true, kling: true };
  context.brandSelection.google = 'gemini31-proxy';
  assert.deepEqual(Array.from(context.getActiveSubmodels()), ['claude-sonnet-5-5']);
  assert.equal(context.brandSelection.google, 'gemini-4-argon');
  context.imageMode = true;
  context.imageComposerModel = 'mj_imagine';
  assert.deepEqual(Array.from(context.getActiveSubmodels()), ['grok-imagine-image-2.0']);
});

for(const model of ['gpt-6-astra','gpt-6.1-sol'])test(model+' stays selected through normalization and reload with supported effort controls',()=>{
  const context=browser({'aa-brand-selection':JSON.stringify({openai:model}),'aa-active-brands':JSON.stringify({openai:true,xai:false,anthropic:false,google:false}),'aa-effort-selection':JSON.stringify({[model]:'max'})});
  context.loadState();
  assert.ok(context.AVAILABLE_CHAT_MODELS.includes(model));
  for(let i=0;i<3;i++)assert.deepEqual(Array.from(context.getActiveSubmodels()),[model]);
  assert.equal(context.brandSelection.openai,model);assert.equal(context.effortFor(model),'max');
  assert.deepEqual(Array.from(context.EFFORT_LEVELS[model]),['low','medium','high','xhigh','max']);
  assert.equal(context.defaultEffortFor(model),'medium');
  const elements=new Map();context.$=id=>{if(!elements.has(id))elements.set(id,{innerHTML:'',setAttribute(){}});return elements.get(id);};context.syncArenaLayout=()=>{};
  vm.runInContext(browserFunction('renderArenaModelMenu'),context);context.renderArenaModelMenu();
  assert.match(elements.get('aaChatModelPop').innerHTML,/max="4" step="1" value="4"/);
  assert.match(elements.get('aaModelsSubmenu').innerHTML,/gpt-6-astra/);assert.match(elements.get('aaModelsSubmenu').innerHTML,/gpt-6\.1-sol/);
});

test('old Sol picker choices migrate without relabeling historical messages; image models remain separate',()=>{
  const context=browser({'aa-brand-selection':JSON.stringify({openai:'gpt-5.6-sol'}),'aa-active-brands':JSON.stringify({openai:true})});
  context.loadState();assert.deepEqual(Array.from(context.getActiveSubmodels()),['gpt-6.1-sol']);assert.equal(context.SUBS['gpt-5.6-sol'].name,'GPT-5.6 Sol');
  assert.deepEqual(Array.from(context.IMAGE_MODELS.filter(item=>item.value.startsWith('gpt-image')),item=>item.value),ArenaImage.OPENAI_MODELS);assert.ok(context.AVAILABLE_CHAT_MODELS.every(item=>!item.startsWith('gpt-image')));
});

test('free debate can send multiple models from one provider without changing the chat model',()=>{
  const context=browser();
  context.debate=true;context.debateMode='free';
  context.debateModels=['claude-sonnet-5-5','claude-opus-5-5','grok-4.7'];
  context.activeBrands={xai:false,anthropic:true,google:false};context.brandSelection.anthropic='claude-fable-5-1';
  assert.deepEqual(Array.from(context.getActiveSubmodels()),['claude-sonnet-5-5','claude-opus-5-5','grok-4.7']);
  assert.equal(context.brandSelection.anthropic,'claude-fable-5-1');
  context.debateModels=['grok-4.7','grok-4.7'];
  assert.deepEqual(Array.from(context.getActiveSubmodels()),['grok-4.7','grok-4.7']);
  context.debate=false;assert.deepEqual(Array.from(context.getActiveSubmodels()),['claude-fable-5-1']);
});

test('role and team debates use the chosen individual model IDs and allow the same model in separate team seats',()=>{
  const context=browser();context.debate=true;
  context.debateMode='persona';context.personaState=[{brand:'anthropic',sub:'claude-opus-5-5'},{brand:'anthropic',sub:'claude-sonnet-5-5'}];
  assert.deepEqual(Array.from(context.getActiveSubmodels()),['claude-opus-5-5','claude-sonnet-5-5']);
  vm.runInContext(browserFunction('get2v2Teams')+'\n'+browserFunction('is2v2Ready'),context);
  context.debateMode='2v2';context.seatState={pro:['claude-opus-5-5','claude-sonnet-5-5'],con:['grok-4.7','claude-fable-5-1']};
  assert.equal(context.is2v2Ready(),true);
  assert.deepEqual(Array.from(context.getActiveSubmodels()),['claude-opus-5-5','claude-sonnet-5-5','grok-4.7','claude-fable-5-1']);
  assert.deepEqual(JSON.parse(JSON.stringify(context.get2v2Teams().pro)),[{brand:'anthropic',sub:'claude-opus-5-5'},{brand:'anthropic',sub:'claude-sonnet-5-5'}]);
  context.seatState.con[1]='grok-4.7';assert.equal(context.is2v2Ready(),true);
  context.seatState.con[1]=null;assert.equal(context.is2v2Ready(),false);
});

test('the model card has a discrete effort slider and a flat model picker', () => {
  const context = browser();
  const elements = new Map();
  context.$ = id => {
    if (!elements.has(id)) elements.set(id, { innerHTML: '', setAttribute(){} });
    return elements.get(id);
  };
  context.syncArenaLayout = () => {};
  vm.runInContext(browserFunction('renderArenaModelMenu'), context);
  context.renderArenaModelMenu();
  const menu = elements.get('aaChatModelPop').innerHTML;
  assert.match(menu, /Gemini 4/);
  assert.doesNotMatch(menu, /Argon|更多模型/);
  assert.doesNotMatch(menu, /undefined/);
  assert.match(menu, /id="aaEffortSlider" type="range" min="0" max="2" step="1" value="1"/);
  assert.match(menu, /aria-valuetext="Medium"/);
  assert.deepEqual(Array.from(context.EFFORT_LEVELS['gemini-4-argon']), ['low', 'medium', 'high']);
  assert.equal(context.effortSelection['gemini-4-argon'], 'medium');
  assert.match(elements.get('aaModelsSubmenu').innerHTML, /gemini-4-argon/);
  assert.doesNotMatch(elements.get('aaModelsSubmenu').innerHTML, /gemini-3\.8-flash|gemini-3\.1-pro-preview/);
  context.activeBrands = { anthropic: true };
  context.brandSelection.anthropic='claude-fable-5-1';
  context.renderArenaModelMenu();
  assert.match(elements.get('aaChatModelPop').innerHTML, /max="4" step="1" value="2"/);
  assert.match(elements.get('aaModelsSubmenu').innerHTML,/返回思考强度/);
  context.activeBrands={xai:true};
  context.renderArenaModelMenu();
  assert.match(elements.get('aaChatModelPop').innerHTML,/max="3" step="1" value="2"/);
});

test('effort slider updates only valid levels, keeps per-model choices and supports default reset',()=>{
  const context=browser();let saves=0;
  Object.assign(context,{aaRunning:false,saveState:()=>saves++,syncArenaLayout:()=>{}});
  vm.runInContext(browserFunction('setArenaEffort')+'\n'+browserFunction('updateArenaEffortFromSlider'),context);
  const slide=(model,value)=>context.updateArenaEffortFromSlider({dataset:{effortModel:model},value:String(value)});
  assert.equal(slide('gemini-4-argon',2),true);assert.equal(context.effortFor('gemini-4-argon'),'high');
  assert.equal(slide('grok-4.7',3),true);assert.equal(context.effortFor('grok-4.7'),'xhigh');
  assert.equal(slide('claude-fable-5-1',4),true);assert.equal(context.effortFor('claude-fable-5-1'),'max');
  assert.equal(context.effortFor('gemini-4-argon'),'high');assert.equal(saves,3);
  assert.equal(slide('gemini-4-argon',2),true);assert.equal(saves,3,'same stop is not saved repeatedly');
  for(const value of [-1,3,1.5,'invalid'])assert.equal(slide('gemini-4-argon',value),false);
  assert.equal(context.setArenaEffort('gemini-4-argon','max'),false);
  context.aaRunning=true;assert.equal(slide('gemini-4-argon',0),false);assert.equal(saves,3);
  context.aaRunning=false;assert.equal(context.setArenaEffort('gemini-4-argon',context.defaultEffortFor('gemini-4-argon')),true);
  assert.equal(context.effortFor('gemini-4-argon'),'medium');assert.equal(context.effortFor('claude-fable-5-1'),'max');
  assert.equal(context.defaultEffortFor('claude-opus-5-5'),'medium');assert.equal(context.defaultEffortFor('grok-4.7'),'high');
});

test('pointer dragging updates the real effort immediately and persists once at release',()=>{
  const context=browser();let saves=0,partialSyncs=0,fullSyncs=0;
  Object.assign(context,{aaRunning:false,saveState:()=>saves++,syncArenaLayout:()=>fullSyncs++,syncArenaEffort:()=>partialSyncs++});
  for(const name of ['setArenaEffort','updateArenaEffortFromSlider','commitArenaEffort'])vm.runInContext(browserFunction(name),context);
  const input={id:'aaEffortSlider',dataset:{effortModel:'gemini-4-argon',effortDragging:'true'},value:'2'};
  for(const [value,expected] of [[2,'high'],[0,'low'],[1,'medium'],[2,'high']]){
    input.value=String(value);assert.equal(context.updateArenaEffortFromSlider(input),true);
    assert.equal(context.effortFor('gemini-4-argon'),expected,'request state already matches the shown level');
  }
  assert.equal(saves,0);assert.equal(fullSyncs,0);assert.equal(partialSyncs,4);
  delete input.dataset.effortDragging;
  assert.equal(context.commitArenaEffort(input),true);assert.equal(saves,1);
  assert.equal(context.commitArenaEffort(input),false);assert.equal(saves,1);
  context.aaRunning=true;input.dataset.effortDragging='true';input.value='0';
  assert.equal(context.updateArenaEffortFromSlider(input),false);
  assert.equal(context.effortFor('gemini-4-argon'),'high');assert.equal(input.dataset.effortDirty,undefined);
});

test('Nano Banana controls build the actual outgoing request and remove unsupported 512px', () => {
  const context = browser();
  const start = source.indexOf('var _nbExtraOpts =');
  const end = source.indexOf('var _skillSys =', start);
  Object.assign(context, {
    sub: ArenaImage.GOOGLE_MODEL, imageMode:true, imageComposerTask:'multi-edit', imageEditParentUid:null,
    imageSettingsState:()=>({size:'4K',ratio:'3:4',thinking:'medium',imageOnly:true,grounding:'web-image'}),
    _imgs:[{data:'aGVsbG8=',mime:'image/png'},{data:'aGVsbG8=',mime:'image/jpeg'}]
  });
  vm.runInContext(source.slice(start, end), context);
  assert.deepEqual(JSON.parse(JSON.stringify(context._nbExtraOpts)), {
    imageTask:'multi-edit',imageSize:'4K',aspectRatio:'3:4',thinkingLevel:'medium',
    imageOnly:true,grounding:'web-image',n:1,_imgs:context._imgs
  });
  assert.doesNotMatch(ArenaImage.settingsMarkup(ArenaImage.GOOGLE_MODEL,'generation',{}),/512/);
  assert.equal(ArenaImage.canonical('gemini-3.1-flash-image'),ArenaImage.GOOGLE_MODEL);
});

test('one click starts generation and a later click stops it without installing a second click listener',()=>{
  const element=new EventTarget();let starts=0,stops=0;
  const context=vm.createContext({$:()=>element,aaRunning:false,stopActiveGeneration:null});
  context.aaStart=()=>{starts++;context.aaRunning=true;context.stopActiveGeneration=()=>{stops++;context.aaRunning=false;};};
  const start=source.indexOf("  $('aaSendBtn').addEventListener('click'");
  vm.runInContext(source.slice(start,source.indexOf('\n  });',start)+6),context);
  element.dispatchEvent(new Event('click'));assert.equal(starts,1);assert.equal(stops,0);
  element.dispatchEvent(new Event('click'));assert.equal(starts,1);assert.equal(stops,1);
  assert.doesNotMatch(source,/btn\.onclick\s*=/,'send and stop must share the same click handler');
});

test('saved image turns keep one copy of generated image bytes and retain signed edit metadata',()=>{
  const context=browser(),image={data:'aGVsbG8=',mime:'image/png'};
  context.msgs=[{uid:1,submodel:ArenaImage.GOOGLE_MODEL,imgData:image.data,imgMime:image.mime,imgItems:[image],imageTurn:{prompt:'blue cube',parentUid:null,references:[]},imageResponse:[{imageIndex:0,thoughtSignature:'unaltered-signature'}]}];
  vm.runInContext(browserFunction('serializeMsgs'),context);
  const saved=JSON.parse(JSON.stringify(context.serializeMsgs()));
  assert.equal(saved[0].imgData,undefined);assert.equal(saved[0].imgItems[0].data,image.data);
  assert.equal(ArenaImage.historyFor(saved,1)[1].parts[0].thoughtSignature,'unaltered-signature');
});

test('switching chats never carries an automatic image reference into another conversation',async()=>{
  const image={data:'bmV3LWltYWdl',mime:'image/png'};
  const next=[{uid:2,isUser:true,text:'new prompt'},{uid:3,submodel:ArenaImage.GOOGLE_MODEL,imgItems:[image],imageTurn:{prompt:'new prompt',parentUid:null,references:[]},imageResponse:[{imageIndex:0,thoughtSignature:'new-signature'}]}];
  async function open(sentImgs,draft=''){
    const c=vm.createContext({
      ArenaImage, ArenaModelControl: require('./arena-model-control.js'),aaRunning:false,scopeSwitchPending:false,activeProjectId:null,scopeEpoch:1,chatLoadEpoch:0,_saveTimer:null,currentChatId:'old-chat',
      imageEditParentUid:1,imageMode:true,imageComposerTask:'edit',imageComposerModel:ArenaImage.GOOGLE_MODEL,
      sentImgs,sentTexts:[],msgs:[],_uidCounter:0,_skipNextChatSave:false,$:()=>({value:draft}),
      chatApiCall:async()=>({messages:next}),getLastAssistantReplyAt:()=>0,rememberChatReplyTime:()=>{},
      render:()=>{},renderImgPreviews:()=>{},syncImageComposer:()=>{},setImageError:()=>{},closeHistory:()=>{},arenaNotice:()=>{}
    });
    vm.runInContext(browserFunction('setGeneratedImageReference')+'\n'+browserFunction('loadChat'),c);
    assert.equal(await c.loadChat('new-chat'),true);return c;
  }
  const oldAuto={data:'b2xkLWltYWdl',mime:'image/png',generatedReference:true,autoFollowup:true,generatedUid:1};
  const fresh=await open([oldAuto]);assert.equal(fresh.sentImgs.length,1);assert.equal(fresh.sentImgs[0].data,image.data);assert.equal(fresh.imageEditParentUid,3);
  const draft=await open([oldAuto],'unsent draft');assert.equal(draft.sentImgs.length,0);assert.equal(draft.imageEditParentUid,null);assert.equal(draft.imageComposerTask,'generation');
  const manual={data:'bWFudWFs',mime:'image/png'};const kept=await open([manual]);assert.equal(kept.sentImgs[0],manual);assert.equal(kept.imageEditParentUid,null);
});
