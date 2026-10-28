const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createController, markup } = require('./arena-pet.js');

function setup() {
  let now = 0, id = 0;
  const queue = new Map(), seen = [];
  const cat = createController({
    setTimeout(fn, delay) { queue.set(++id, { fn, at: now + delay }); return id; },
    clearTimeout(token) { queue.delete(token); },
    onChange(value) { seen.push(value.state); }
  });
  function advance(ms) {
    const end = now + ms;
    while (true) {
      const entry = [...queue].filter(([, item]) => item.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!entry) break;
      now = entry[1].at; queue.delete(entry[0]); entry[1].fn();
    }
    now = end;
  }
  return { cat, seen, advance };
}

test('welcome becomes playful idle, then rests without changing task state', () => {
  const { cat, advance } = setup();
  assert.equal(cat.snapshot().state, 'welcome');
  advance(3200); assert.equal(cat.snapshot().state, 'idle');
  cat.sync({ running: false, hasMessages: false });
  advance(45000); assert.equal(cat.snapshot().state, 'rest');
  cat.greet(); assert.equal(cat.snapshot().state, 'welcome');
});

test('idle timers cannot interrupt real thinking or streaming, even after a long wait', () => {
  const { cat, advance, seen } = setup();
  cat.sync({ running: true, hasMessages: true });
  cat.progress('a', 'thinking'); advance(120000);
  assert.equal(cat.snapshot().state, 'thinking');
  cat.progress('a', 'responding'); assert.equal(cat.snapshot().state, 'working');
  cat.greet(); assert.equal(cat.snapshot().state, 'working');
  cat.complete('a', 'done');
  assert.equal(cat.snapshot().running, true);
  assert.equal(seen.includes('done'), false);
  cat.sync({ running: false, hasMessages: true });
  assert.equal(cat.snapshot().state, 'done');
  advance(2600); assert.equal(cat.snapshot().state, 'idle');
});

test('parallel models retain the unfinished model phase after another model completes', () => {
  const { cat } = setup();
  cat.sync({ running: true, hasMessages: true });
  cat.progress('a', 'responding'); cat.progress('b', 'thinking');
  assert.equal(cat.snapshot().state, 'thinking');
  cat.progress('a', 'searching'); assert.equal(cat.snapshot().state, 'searching');
  cat.complete('a', 'done'); assert.equal(cat.snapshot().state, 'thinking');
  cat.progress('b', 'responding'); assert.equal(cat.snapshot().state, 'working');
});

test('cancel never celebrates, and late events from the canceled request cannot affect the next request', () => {
  const { cat, advance } = setup();
  const old = cat.sync({ running: true, hasMessages: true }).generation;
  cat.progress('a', 'responding', old);
  cat.sync({ running: false, hasMessages: true, stopped: true });
  assert.equal(cat.snapshot().state, 'idle');
  const current = cat.sync({ running: true, hasMessages: true }).generation;
  cat.progress('b', 'responding', current);
  cat.progress('a', 'thinking', old); cat.complete('a', 'error', old);
  advance(45000); assert.equal(cat.snapshot().state, 'working');
  cat.complete('b', 'done', current);
  cat.sync({ running: false, hasMessages: true });
  assert.equal(cat.snapshot().state, 'done');
});

test('failures stay failures until settled, and a subsequent successful task may celebrate', () => {
  const { cat, advance } = setup();
  cat.sync({ running: true, hasMessages: true }); cat.complete('a', 'error');
  cat.sync({ running: false, hasMessages: true });
  assert.equal(cat.snapshot().state, 'error');
  advance(5000); assert.equal(cat.snapshot().state, 'idle');
  cat.sync({ running: true, hasMessages: true }); cat.complete('a', 'done');
  cat.sync({ running: false, hasMessages: true });
  assert.equal(cat.snapshot().state, 'done');
});

test('image generation starts with the laptop action, and a new conversation greets again', () => {
  const { cat } = setup();
  cat.sync({ running: true, hasMessages: true, mode: 'image' });
  assert.equal(cat.snapshot().state, 'working');
  cat.sync({ running: false, hasMessages: true });
  cat.sync({ running: false, hasMessages: false });
  assert.equal(cat.snapshot().state, 'welcome');
});

test('historical portraits are still and model identifiers cannot inject HTML', () => {
  assert.match(markup('portrait', 'welcome'), /data-aa-kitten="still"/);
  assert.doesNotMatch(markup('progress', 'thinking', '"><script>'), /<script>/);
});
