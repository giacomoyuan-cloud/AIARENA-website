const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
function fn(name) {
  const start = html.search(new RegExp('  (?:async )?function ' + name + '\\(')); assert(start >= 0, name);
  const endings = /\n  }/g; endings.lastIndex = start;
  for (let match; (match = endings.exec(html));) {
    const source = html.slice(start, match.index + match[0].length);
    try { new vm.Script('(' + source + ')'); return source; } catch {}
  }
  throw Error('Unclosed function: ' + name);
}
function fixture(prepare) {
  const elements = new Map(), captured = [], originals = []; let scope = 'general';
  const get = id => { if (!elements.has(id)) elements.set(id, { value: '', disabled: false, setAttribute() {}, removeAttribute() {} }); return elements.get(id); };
  const context = vm.createContext({ fileImporting: false, aaRunning: false, sentTexts: [], sentImgs: [], ArenaFiles: { LIMITS: { chatCharacters: 40000 }, isImage: () => false, prepareChatFile: prepare }, $: get, fileImportContext: () => scope, showFileImport() {}, arenaNotice() {}, renderTextPreviews() {}, handleImageFile: async () => true, skillsRuntime: { ready: async () => {}, filesForTexts: () => originals, capture: file => { captured.push(file); originals.push({ name: file.name, size: file.size }); } } });
  vm.runInContext(fn('importComposerFiles'), context);
  return { context, captured, originals, switchScope: () => { scope = 'project-b'; } };
}
test('a late parse cannot attach files or original bytes to another conversation', async () => {
  let finish; const pending = new Promise(resolve => { finish = resolve; });
  const f = fixture(() => pending), file = { name: 'a.zip', size: 10 };
  const task = f.context.importComposerFiles([file]); await new Promise(resolve => setImmediate(resolve));
  f.switchScope(); finish({ text: '[文件: a.zip]\ncontent', images: [], skipped: [] }); await task;
  assert.equal(f.context.sentTexts.length, 0); assert.equal(f.captured.length, 0); assert.equal(f.context.fileImporting, false);
});
test('expanded ZIP text and its original are attached once after a successful parse', async () => {
  const f = fixture(async file => ({ source: file, text: '[文件: a.zip]\ncontent', images: [], skipped: [] }));
  await f.context.importComposerFiles([{ name: 'a.zip', size: 10 }]);
  assert.equal(f.context.sentTexts.length, 1); assert.equal(f.captured.length, 1); assert.equal(f.context.fileImporting, false);
});
test('limits prevent an extra original from making the later native document request fail', async () => {
  let parses = 0; const f = fixture(async () => { parses++; });
  f.originals.push(...Array.from({ length: 5 }, (_, index) => ({ name: index + '.txt', size: 1 })));
  await f.context.importComposerFiles([{ name: 'sixth.md', size: 10 }]);
  assert.equal(parses, 0); assert.equal(f.captured.length, 0);
});
test('sending while parsing stops before any chat or model request', async () => {
  let notice = '';
  const context = vm.createContext({ fileImporting: true, arenaNotice: value => { notice = value; } });
  vm.runInContext(fn('aaStart'), context); await context.aaStart(); assert.match(notice, /解析/);
});
