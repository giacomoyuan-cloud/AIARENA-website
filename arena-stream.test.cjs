const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const ArenaStream = require('./arena-stream.js');

function clock() {
  let time = 0, counter = 0;
  const timers = new Map();
  return {
    now: () => time,
    setTimeout(fn, delay) { const id = ++counter; timers.set(id, { fn, at: time + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    tick(ms) {
      const end = time + ms;
      for (;;) {
        const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > end) break;
        time = next[1].at; timers.delete(next[0]); next[1].fn();
      }
      time = end;
    },
    stall(ms) { time += ms; const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0]; if (next) { timers.delete(next[0]); next[1].fn(); } }
  };
}
function fixture() {
  const timer = clock(), paints = [];
  const queue = ArenaStream.create({ ...timer, onUpdate: (key, text, done) => paints.push({ key, text, done, time: timer.now() }) });
  return { timer, paints, queue };
}

test('a large network batch starts with one character and reveals about 15 per second after EOF', async () => {
  const { timer, paints, queue } = fixture(), text = '袁啾啾陪你慢慢读。'.repeat(20);
  queue.write(1, text);
  assert.equal(paints[0].text, '袁');
  let finished = false;
  const done = queue.finish(1, text).then(() => { finished = true; });
  timer.tick(1000); await Promise.resolve();
  assert.ok(queue.text(1, '').length >= 15 && queue.text(1, '').length <= 16);
  assert.equal(finished, false, 'provider EOF must not finish the visual reply');
  assert.equal(queue.has(1), true);
  timer.tick(20000); await done;
  assert.equal(paints.at(-1).text, text); assert.equal(paints.at(-1).done, true);
  for (let i = 1; i < paints.length; i++) assert.ok(paints[i].text.length - paints[i - 1].text.length <= 1, 'no batch dump at EOF');
});

test('new batches respect the same clock while an exhausted buffer waits for the network', async () => {
  const { timer, queue } = fixture();
  queue.write(1, '一'); timer.tick(10); queue.write(1, '一二三');
  assert.equal(queue.text(1, ''), '一');
  timer.tick(60); assert.equal(queue.text(1, ''), '一二');
  timer.tick(2000); assert.equal(queue.text(1, ''), '一二三');
  queue.write(1, '一二三四五六'); assert.equal(queue.text(1, ''), '一二三四');
  timer.tick(10); queue.write(1, '一二三四五六七'); assert.equal(queue.text(1, ''), '一二三四');
  const done = queue.finish(1, '一二三四五六七'); timer.tick(1000); await done;
});

test('a stalled main thread and hidden tab cannot cause a catch-up burst', async () => {
  const { timer, queue } = fixture(), text = '慢慢显示这段文字'.repeat(10);
  queue.write(1, text); timer.stall(10000);
  assert.equal(queue.text(1, '').length, 2);
  queue.pause(true); const paused = queue.text(1, ''); timer.tick(30000);
  assert.equal(queue.text(1, ''), paused);
  queue.pause(false); timer.tick(60); assert.equal(queue.text(1, ''), paused);
  timer.tick(10); assert.equal(queue.text(1, '').length, paused.length + 1);
  const done = queue.finish(1, text); timer.tick(10000); await done;
});

test('Chinese, combined accents and emoji are revealed as whole graphemes', async () => {
  const { timer, paints, queue } = fixture(), text = '猫👨‍👩‍👧‍👦e\u0301🐾好';
  queue.write(1, text); const done = queue.finish(1, text); timer.tick(1000); await done;
  assert.deepEqual(paints.filter(p => !p.done).map(p => p.text), ['猫', '猫👨‍👩‍👧‍👦', '猫👨‍👩‍👧‍👦e\u0301', '猫👨‍👩‍👧‍👦e\u0301🐾', text]);
  queue.write(2, '\uD83D'); assert.equal(queue.text(2, ''), '');
  queue.write(2, '🐱好'); assert.equal(queue.text(2, ''), '🐱');
  const second = queue.finish(2, '🐱好'); timer.tick(1000); await second;
});

test('citation markers never appear a letter at a time', async () => {
  const { timer, paints, queue } = fixture();
  queue.write(1, '猫[[aa-ci'); timer.tick(1000); assert.equal(queue.text(1, ''), '猫');
  queue.write(1, '猫[[aa-citation:1]]来了');
  const done = queue.finish(1, '猫[[aa-citation:1]]来了'); timer.tick(1000); await done;
  for (const p of paints) assert.doesNotMatch(p.text.replace(/\[\[aa-citation:\d+\]\]/g, ''), /\[\[/);
});

test('stop cancels queued text and finish callbacks without leaking into a new reply', async () => {
  const { timer, queue, paints } = fixture();
  queue.write(1, '旧回复'.repeat(20));
  const done = queue.finish(1, '旧回复'.repeat(20));
  timer.tick(200); const visible = queue.text(1, '');
  assert.deepEqual(queue.stop(), [{ key: 1, text: visible }]);
  assert.equal(await done, false);
  const count = paints.length; timer.tick(10000); assert.equal(paints.length, count);
  queue.write(1, '新内容'); assert.equal(queue.text(1, ''), '新');
  const next = queue.finish(1, '新内容'); timer.tick(1000); assert.equal(await next, true);
  assert.equal(paints.at(-1).text, '新内容');
});

test('completion waits for every parallel model and preserves final text corrections', async () => {
  const { timer, queue, paints } = fixture();
  queue.write(1, '甲乙'); queue.write(2, '一二三四五六');
  queue.finish(1, '甲乙'); queue.finish(2, '一二三四五六七');
  let idle = false; const done = queue.whenIdle().then(() => { idle = true; });
  timer.tick(100); await Promise.resolve(); assert.equal(idle, false);
  timer.tick(1000); await done;
  assert.equal(paints.filter(p => p.key === 2).at(-1).text, '一二三四五六七');
  queue.write(3, '**正文**'); timer.tick(100);
  const correction = queue.finish(3, '正文'); timer.tick(1000); await correction;
  assert.equal(paints.at(-1).text, '正文');
});

function appFixture() {
  const timer = clock(), body = { innerHTML: '', dataset: {}, classList: { contains: () => false, add() {} } };
  const element = { querySelector: selector => selector === '.aa-msg-body' ? body : null };
  const messages = { querySelector: () => element, scrollTop: 0, scrollHeight: 100 };
  const message = { uid: 1, submodel: 'gemini-4-argon', text: '', citations: [] };
  const context = vm.createContext({
    ArenaStream: { create: options => ArenaStream.create({ ...options, ...timer }) },
    ArenaImage: require('./arena-image.js'), Map, Promise,
    document: { hidden: false, addEventListener() {} }, msgs: [message], userScrolledUp: false,
    $: () => messages, renderMd: text => text, esc: text => text, currentChatId: null,
    highlightCodeBlocks() {}, requestAnimationFrame: fn => timer.setTimeout(fn, 16), cancelAnimationFrame: timer.clearTimeout,
    render() { body.innerHTML = context.liveReplies.text(1, message.text); }
  });
  const source = readFileSync(require('node:path').join(__dirname, 'index.html'), 'utf8');
  vm.runInContext(source.slice(source.indexOf('  var liveFrames='), source.indexOf('  function cleanThinkTags')), context);
  return { timer, body, message, context };
}

test('real app finalization and full renders keep the visible prefix while canonical history keeps all text', async () => {
  const { timer, body, message, context } = appFixture();
  message.text = '这是完整保存的回复。'.repeat(10);
  context.liveUpdate(1, message.text);
  assert.equal(body.innerHTML, '这<span class="arena-stream-caret" aria-hidden="true">▍</span>');
  const done = context.finalizeMsg(1, message.text, false);
  context.render(); assert.equal(body.innerHTML, '这');
  assert.equal(message.text.length, 100, 'display pacing never truncates stored text');
  timer.tick(1000); context.render(); assert.ok(body.innerHTML.length <= 16);
  timer.tick(10000); await done;
  assert.equal(body.innerHTML, message.text); assert.equal(body.dataset.streaming, 'false');
});

test('real app stop retains exactly the already visible text with no delayed final dump', async () => {
  const { timer, body, message, context } = appFixture();
  message.text = '这是要停止的回复。'.repeat(10); context.liveUpdate(1, message.text);
  const done = context.finalizeMsg(1, message.text, false);
  timer.tick(200); const visible = context.liveReplies.text(1, '');
  context.stopLiveReplies(); assert.equal(message.text, visible); assert.equal(body.innerHTML, visible);
  timer.tick(10000); assert.equal(await done, false); assert.equal(body.innerHTML, visible);
});

test('cancelled network events cannot append text or finish a later generation', async () => {
  const source = readFileSync(require('node:path').join(__dirname, 'index.html'), 'utf8');
  for (const beforeHeaders of [false, true]) {
    let wire, headers, done = 0, errors = 0;
    const output = [], response = new Response(new ReadableStream({ start(controller) { wire = controller; } }));
    const context = vm.createContext({
      window: {}, ArenaContext: {}, AbortController, TextDecoder, Promise, Set,
      activeStreamControllers: new Set(), abortF: false, getPass: () => 'synthetic', $: () => ({ value: 'synthetic' }),
      effortFor: () => null, activeProjectId: null, searchOn: false, WORKER: '/local-fixture',
      updateThinkStatus() {}, appendThinkSummary() {},
      fetchWithRetry: () => beforeHeaders ? new Promise(resolve => { headers = resolve; }) : Promise.resolve(response)
    });
    vm.runInContext(source.slice(source.indexOf('  function callWorkerStream'), source.indexOf('  function renderGoogleGrounding')), context);
    context.callWorkerStream('gemini-4-argon', 'local fixture', null, null, text => output.push(text), () => done++, () => errors++);
    if (!beforeHeaders) await new Promise(resolve => setImmediate(resolve));
    for (const controller of context.activeStreamControllers) controller.abort();
    context.abortF = false; // The user can already have started another request.
    if (beforeHeaders) headers(response);
    wire.enqueue(new TextEncoder().encode('data: {"t":"过期文字"}\n\ndata: [DONE]\n\n')); wire.close();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(output, []); assert.equal(done, 0); assert.equal(errors, 0);
  }
});

test('send and pet task state stay busy until visible text drains, and stopping a coach also settles once', async () => {
  const source = readFileSync(require('node:path').join(__dirname, 'index.html'), 'utf8');
  for (const stopped of [false, true]) {
    const { timer, message, context } = appFixture();
    let saves = 0;
    Object.assign(context, {
      aaRunning: true, finishingDisplay: false, finished: true, abortF: false, activeStreamControllers: new Set(),
      imageMode: false, debate: true, _bizMode: true, sentImgs: [], sentTexts: [], nbRefImages: [],
      setImageError() {}, renderImgPreviews() {}, renderTextPreviews() {}, renderNbRefList() {}, syncArenaLayout() {},
      setSendButtonIcon() {}, hideThink() {}, saveCurrentChat() { saves++; }
    });
    const lookup = context.$;
    context.$ = id => id === 'aaMessages' ? lookup(id) : ({ value: '', disabled: false });
    const start = source.indexOf('    function doFinish(){'), end = source.indexOf('\n  }\n// === 图像模式', start);
    vm.runInContext(source.slice(start, end), context);
    message.text = '等待这段文字全部显示。'; context.liveUpdate(1, message.text);
    if (stopped) {
      vm.runInContext(source.match(/    stopActiveGeneration = function\(\)\{ abortF = true;activeStreamControllers[^\n]+/)[0], context);
      context.stopActiveGeneration();
    } else {
      context.finalizeMsg(1, message.text, false); context.doFinish();
      await Promise.resolve(); assert.equal(context.aaRunning, true); assert.equal(saves, 0);
      timer.tick(2000);
    }
    await Promise.resolve(); await Promise.resolve();
    assert.equal(context.aaRunning, false); assert.equal(saves, 1);
    context.doFinish(); await Promise.resolve(); assert.equal(saves, 1);
  }
});
