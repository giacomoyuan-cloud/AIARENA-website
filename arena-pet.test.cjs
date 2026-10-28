const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createController, createIdlePlaylist, liveReplyIds, pickLoopAction, markup } = require('./arena-pet.js');
const catalog = require('./assets/kitten/motion/manifest.json');

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

test('task state remains idle while presentation may rotate between activities', () => {
  const { cat, advance } = setup();
  assert.equal(cat.snapshot().state, 'welcome');
  advance(3200); assert.equal(cat.snapshot().state, 'idle');
  cat.sync({ running: false, hasMessages: false });
  advance(600000); assert.equal(cat.snapshot().state, 'idle');
  cat.greet(); assert.equal(cat.snapshot().state, 'welcome');
});

test('every runtime state selects a real loop, with stable background motion through welcome and completion labels', () => {
  for (const state of Object.keys(catalog.states)) assert.equal(pickLoopAction(catalog,state).playback,'loop');
  for (const state of ['welcome','idle','rest','done','error']) assert.equal(pickLoopAction(catalog,state).id,'knead');
  assert.equal(pickLoopAction(catalog,'working').id,'work-laptop');
  assert.equal(pickLoopAction(catalog,'thinking').id,'head-tilt');
  assert.equal(pickLoopAction(catalog,'searching').id,'head-tilt');
});

test('thinking precedes typing, and the first reply keeps typing until the request actually ends', () => {
  const {cat}=setup();
  const action=()=>pickLoopAction(catalog,cat.snapshot().state).id;
  cat.sync({running:true,hasMessages:true});assert.equal(action(),'head-tilt');
  cat.progress('model','searching');assert.equal(action(),'head-tilt');
  cat.progress('model','responding');assert.equal(action(),'work-laptop');
  for(const phase of ['thinking','searching','responding']){cat.progress('model',phase);assert.equal(action(),'work-laptop');}
  cat.complete('model','done');assert.equal(action(),'work-laptop','completion callback cannot idle a still-running request');
  cat.sync({running:false,hasMessages:true});assert.equal(action(),'knead');
  cat.sync({running:true,hasMessages:true});assert.equal(action(),'head-tilt','a new request starts by thinking again');cat.destroy();
});

test('base state action selection stays stable and skips unclosed single-shots', () => {
  const mixed={actions:catalog.actions,states:{idle:['yawn','wand-bat','wand-kick']}};
  for(let i=0;i<100;i++) assert.equal(pickLoopAction(mixed,'idle').id,'wand-bat');
  assert.equal(pickLoopAction({actions:catalog.actions,states:{idle:['yawn']}},'idle').id,'knead');
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
  cat.progress('b', 'searching'); assert.equal(cat.snapshot().state, 'searching');
  cat.complete('a', 'done'); assert.equal(cat.snapshot().state, 'searching');
  cat.progress('b', 'thinking'); assert.equal(cat.snapshot().state, 'thinking');
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
  assert.match(markup('reply', 'working', 'model'), /data-aa-kitten="live"/);
  assert.doesNotMatch(markup('progress', 'thinking', '"><script>'), /<script>/);
});

test('only the current replies animate, including while buffered text drains', () => {
  const messages = [
    {uid: 1, isUser:true}, {uid: 2, submodel:'a'},
    {uid: 3, isUser:true}, {uid: 4, submodel:'a'}, {uid: 5, submodel:'b'}
  ];
  const ids = (running, phases, pending, streaming) => [...liveReplyIds(messages,running,new Map(phases),new Set(pending),id=>streaming.includes(id))];
  assert.deepEqual(ids(false,[],[],[]),[5]);
  assert.deepEqual(ids(true,[['a','responding'],['b','thinking']],['b'],[]),[4]);
  assert.deepEqual(ids(true,[],[],[4,5]),[4,5]);
  assert.deepEqual(ids(true,[],[],[]),[5]);
  assert.deepEqual(ids(true,[],['a','b'],[]),[]);
  assert.deepEqual([...liveReplyIds([...messages,{uid:6,isUser:true}],true,new Map(),new Set(['a']),()=>false)],[]);
});

test('idle activities advance after ready, loop in order and stop cleanly when interrupted', () => {
  let now=0,serial=0; const timers=new Map(), seen=[];
  const playlist=createIdlePlaylist({catalog,setTimeout(fn,delay){timers.set(++serial,{fn,at:now+delay});return serial;},clearTimeout(id){timers.delete(id);},onChange(action){seen.push(action.id);}});
  function tick(ms){const end=now+ms;for(;;){const item=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];if(!item||item[1].at>end)break;timers.delete(item[0]);now=item[1].at;item[1].fn();}now=end;}
  playlist.setEnabled(true); assert.equal(playlist.current().id,'wand-watch');
  tick(20000); assert.equal(playlist.current().id,'wand-watch','loading time must not count as playback');
  playlist.ready('wand-watch'); playlist.advance('wand-watch'); assert.equal(playlist.current().id,'wand-bat');
  playlist.advance('wand-watch'); assert.equal(playlist.current().id,'wand-bat','late ended events cannot skip an activity');
  playlist.ready('wand-bat'); tick(10000); assert.equal(playlist.current().id,'wand-bat');
  tick(200); assert.equal(playlist.current().id,'wand-jump');
  playlist.ready('wand-jump'); playlist.setEnabled(false,true); tick(30000); assert.equal(playlist.current(),null);
  playlist.setEnabled(true); assert.equal(playlist.current().id,'wand-watch');
  for(const id of catalog.idleSequence) { assert.equal(playlist.current().id,id); playlist.advance(id); }
  assert.equal(playlist.current().id,'wand-watch');
  assert.ok(seen.includes('wand-bat') && seen.includes('knead') && seen.includes('wand-kick'));
});
