const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');

const source = readFileSync(require('node:path').join(__dirname, 'index.html'), 'utf8');
function browserFunction(name) {
  const match = source.match(new RegExp('  function ' + name + '\\([^]*?\\n  }'));
  assert.ok(match, 'browser function exists: ' + name);
  return match[0];
}
function browser(saved = {}) {
  const storage = new Map(Object.entries(saved));
  const context = vm.createContext({
    localStorage: { getItem: key => storage.get(key) ?? null },
    document: { querySelectorAll: () => ['xai', 'anthropic', 'openai', 'google'].map(brand => ({ dataset: { brand } })) },
    imageMode: false, videoMode: false, debate: false, debateMode: 'free',
    imageComposerModel: 'grok-imagine-image-2.0',
    activeBrands: { xai: false, anthropic: false, openai: false, google: true },
    brandSelection: { xai: 'grok-4.7', anthropic: 'claude-sonnet-5-5', google: 'gemini-3.8-flash' }
  });
  vm.runInContext(source.slice(source.indexOf('  var AVAILABLE_CHAT_MODELS'), source.indexOf('  var SYS_DEBATE')), context);
  for (const name of ['loadState', 'normalizeAvailableModels', 'getActiveSubmodels']) vm.runInContext(browserFunction(name), context);
  return context;
}

for (const model of ['gemini-3.8-flash', 'gemini-3.1-pro-preview']) {
  test(model + ' remains selected through repeated UI synchronization and reload', () => {
    const context = browser({
      'aa-brand-selection': JSON.stringify({ google: model }),
      'aa-active-brands': JSON.stringify({ xai: false, anthropic: false, google: true })
    });
    context.loadState();
    assert.ok(context.AVAILABLE_CHAT_MODELS.includes(model));
    for (let i = 0; i < 3; i++) assert.deepEqual(Array.from(context.getActiveSubmodels()), [model]);
  });
}

test('Gemini image generation and editing never silently switch to Grok', () => {
  const context = browser();
  context.imageMode = true;
  context.imageComposerModel = 'gemini-3.1-flash-image';
  assert.ok(context.IMAGE_MODELS.some(model => model.value === context.imageComposerModel));
  for (let i = 0; i < 3; i++) assert.deepEqual(Array.from(context.getActiveSubmodels()), ['gemini-3.1-flash-image']);
});

test('unavailable legacy routes still normalize to supported models', () => {
  const context = browser();
  context.activeBrands = { openai: true, mj: true, kling: true };
  context.brandSelection.google = 'gemini31-proxy';
  assert.deepEqual(Array.from(context.getActiveSubmodels()), ['claude-sonnet-5-5']);
  assert.equal(context.brandSelection.google, 'gemini-3.8-flash');
  context.imageMode = true;
  context.imageComposerModel = 'mj_imagine';
  assert.deepEqual(Array.from(context.getActiveSubmodels()), ['grok-imagine-image-2.0']);
});

test('Gemini menu has no unused effort controls or undefined labels', () => {
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
  assert.match(menu, /Gemini 3\.8 Flash/);
  assert.doesNotMatch(menu, /undefined|id="aaEffortMenuBtn"/);
  assert.match(elements.get('aaModelsSubmenu').innerHTML, /gemini-3\.1-pro-preview/);
  context.activeBrands = { anthropic: true };
  context.renderArenaModelMenu();
  assert.match(elements.get('aaChatModelPop').innerHTML, /id="aaEffortMenuBtn"/);
});

test('Gemini image settings reach the request, including 512px, thinking and image-only', () => {
  const context = browser();
  const start = source.indexOf('var _nbExtraOpts =');
  const end = source.indexOf('var _skillSys =', start);
  Object.assign(context, {
    sub: 'gemini-3.1-flash-image', imageComposerTask: 'multi-edit', nbImageSize: '512',
    nbAspectRatio: '3:4', nbThinkingLevel: 'high', nbImageOnly: true,
    _imgs: [{ data: 'first', mime: 'image/png' }, { data: 'second', mime: 'image/png' }]
  });
  vm.runInContext(source.slice(start, end), context);
  assert.deepEqual(JSON.parse(JSON.stringify(context._nbExtraOpts)), {
    imageTask: 'multi-edit', imageSize: '512', resolution: '512', aspectRatio: '3:4',
    thinkingLevel: 'high', imageOnly: true, quality: 'auto', n: 1, _imgs: context._imgs
  });
  assert.match(source, /value:'512',label:'512px'/);
});
