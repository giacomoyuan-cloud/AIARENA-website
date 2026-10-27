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
    ArenaImage,
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
  context.activeBrands = { openai: true, mj: true, kling: true };
  context.brandSelection.google = 'gemini31-proxy';
  assert.deepEqual(Array.from(context.getActiveSubmodels()), ['claude-sonnet-5-5']);
  assert.equal(context.brandSelection.google, 'gemini-4-argon');
  context.imageMode = true;
  context.imageComposerModel = 'mj_imagine';
  assert.deepEqual(Array.from(context.getActiveSubmodels()), ['grok-imagine-image-2.0']);
});

test('Gemini 4 menu exposes its three supported thinking levels and medium default', () => {
  const context = browser();
  const elements = new Map();
  context.$ = id => {
    if (!elements.has(id)) elements.set(id, { innerHTML: '' });
    return elements.get(id);
  };
  context.syncArenaLayout = () => {};
  vm.runInContext(browserFunction('renderArenaModelMenu'), context);
  context.renderArenaModelMenu();
  const menu = elements.get('aaChatModelPop').innerHTML;
  assert.match(menu, /Gemini 4 Argon/);
  assert.doesNotMatch(menu, /undefined/);
  assert.match(menu, /id="aaEffortMenuBtn"/);
  assert.deepEqual(Array.from(context.EFFORT_LEVELS['gemini-4-argon']), ['low', 'medium', 'high']);
  assert.equal(context.effortSelection['gemini-4-argon'], 'medium');
  assert.match(elements.get('aaModelsSubmenu').innerHTML, /gemini-4-argon/);
  assert.doesNotMatch(elements.get('aaModelsSubmenu').innerHTML, /gemini-3\.8-flash|gemini-3\.1-pro-preview/);
  context.activeBrands = { anthropic: true };
  context.renderArenaModelMenu();
  assert.match(elements.get('aaChatModelPop').innerHTML, /id="aaEffortMenuBtn"/);
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
