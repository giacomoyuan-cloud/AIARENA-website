(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ArenaKitten = api.connect(root);
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';
  var LABELS = {
    welcome: '嗨，我在这里', thinking: '正在认真想', searching: '正在查找资料',
    working: '正在忙，马上就好', idle: '陪你待一会儿', done: '完成啦',
    rest: '眯一会儿，随时叫我', error: '这次没完成，再试试'
  };

  // Task state comes exclusively from the app. Only idle behavior uses timers.
  function createController(options) {
    options = options || {};
    var later = options.setTimeout || setTimeout;
    var cancel = options.clearTimeout || clearTimeout;
    var change = options.onChange || function () {};
    var state = 'welcome', label = LABELS.welcome, running = false;
    var hasMessages = false, mode = 'chat', hadError = false, generation = 0;
    var phases = new Map(), timer = null;
    function clear() { if (timer !== null) cancel(timer); timer = null; }
    function snapshot() { return { state: state, label: label, running: running, generation: generation, phases: new Map(phases) }; }
    function show(next, text) {
      var changed = state !== next || label !== (text || LABELS[next]);
      state = next; label = text || LABELS[next];
      if (changed) change(snapshot());
    }
    function idle() {
      clear(); show('idle');
      timer = later(function () { timer = null; if (!running) show('rest'); }, 45000);
    }
    function greet() {
      if (running) return;
      clear(); show('welcome'); timer = later(idle, options.welcomeMs || 3200);
    }
    function busy() {
      var values = Array.from(phases.values());
      if (values.indexOf('searching') !== -1) show('searching');
      else if (values.indexOf('thinking') !== -1) show('thinking');
      else show(mode === 'image' || values.length ? 'working' : 'thinking');
    }
    function sync(next) {
      var wasRunning = running, hadMessages = hasMessages;
      hasMessages = !!next.hasMessages; mode = next.mode || 'chat';
      running = !!next.running;
      if (running) {
        if (!wasRunning) { clear(); phases.clear(); hadError = false; generation++; }
        busy();
      } else if (wasRunning) {
        clear(); phases.clear();
        if (next.stopped) { idle(); show('idle', '已停止，陪你歇会儿'); }
        else { show(hadError ? 'error' : 'done'); timer = later(idle, hadError ? 5000 : (options.doneMs || 2600)); }
      } else if (hasMessages !== hadMessages) {
        if (hasMessages) idle(); else greet();
      }
      return snapshot();
    }
    function progress(model, phase, token) {
      if (!running || (token !== undefined && token !== generation) || ['thinking', 'searching', 'responding', 'working'].indexOf(phase) === -1) return;
      if (phases.get(model) === phase) return;
      var before = state; phases.set(model, phase); busy();
      if (before === state) change(snapshot());
    }
    function complete(model, outcome, token) {
      if (!running || (token !== undefined && token !== generation)) return;
      phases.delete(model); if (outcome === 'error') hadError = true;
      busy(); change(snapshot());
    }
    function destroy() { clear(); phases.clear(); }
    function motionEnded(expected) {
      if (!running && state === expected && ['welcome', 'done', 'error'].indexOf(state) !== -1) idle();
    }
    greet();
    return { sync: sync, progress: progress, complete: complete, greet: greet, motionEnded: motionEnded, snapshot: snapshot, destroy: destroy };
  }

  function escape(value) { return String(value).replace(/[&<>"']/g, function (c) { return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]; }); }
  var motionCatalog = null;
  function markup(place, state, model) {
    state = LABELS[state] ? state : 'welcome';
    return '<span class="aa-kitten aa-kitten--' + escape(place) + '" data-aa-kitten="' + (place === 'portrait' ? 'still' : 'live') + '" data-state="' + state + '"'
      + (model ? ' data-aa-kitten-model="' + escape(model) + '"' : '') + ' aria-hidden="true">'
      + '<span class="aa-kitten-viewport"><img class="aa-kitten-poster" src="' + escape(place === 'portrait' && motionCatalog ? motionCatalog.portrait : '/assets/kitten/motion/poster.png?v=20261028') + '" alt="" draggable="false" decoding="async">'
      + (place === 'portrait' ? '' : '<video class="aa-kitten-motion" muted playsinline preload="none" hidden></video>') + '</span></span>';
  }

  // A media player owns loading/recovery, never the assistant's task state.
  function createPlayer(options) {
    var win = options.window, doc = options.document, el = options.element;
    var video = options.video, image = options.image, support = options.formatSupport || {};
    var reduced = options.reducedMotion || { matches: false };
    var later = options.setTimeout || win.setTimeout.bind(win), cancel = options.clearTimeout || win.clearTimeout.bind(win);
    var now = options.now || function () { return Date.now(); };
    var action = null, state = null, token = 0, sequence = 0, destroyed = false;
    var native = false, fallback = false, loading = false, playingPromise = false, finished = false;
    var loadTimer = null, endTimer = null, lastTime = -1, lastProgress = now(), retries = 0;
    var nextCandidate = null;
    function status(value) { if (el.getAttribute('data-motion-status') !== value) el.setAttribute('data-motion-status', value); }
    function active() { return !destroyed && el.isConnected && el.getClientRects().length > 0 && !doc.hidden && !reduced.matches; }
    function clearLoad() { if (loadTimer !== null) cancel(loadTimer); loadTimer = null; }
    function clearEnd() { if (endTimer !== null) cancel(endTimer); endTimer = null; }
    function showPoster() { video.hidden = true; image.hidden = false; image.onload = null; image.onerror = null; if (action && image.getAttribute('src') !== action.poster) image.src = action.poster; }
    function finish() {
      if (finished || !active()) return;
      finished = true; clearEnd(); status('complete');
      if (options.onEnded) options.onEnded(action, state);
    }
    function fallbackClock(expected) {
      if (token !== expected || !active() || !fallback || endTimer !== null || finished) return;
      // Animated WebP has no ended event. Re-arm only when it actually reloads/resumes.
      if (state === 'idle' || action.playback === 'once') endTimer = later(function () { endTimer = null; if (token === expected) finish(); }, Math.ceil(action.durationSeconds * 1000));
    }
    function showFallback() {
      clearLoad(); native = false; fallback = true; loading = false; playingPromise = false;
      video.pause(); video.hidden = true;
      if (!active()) { showPoster(); status('paused'); return; }
      var expected = token;
      image.hidden = false;
      image.onload = function () { if (token === expected && fallback && active()) { status('fallback'); fallbackClock(expected); } };
      image.onerror = function () {
        if (token !== expected || !fallback) return;
        image.onload = image.onerror = null; image.src = action.poster; status('unavailable');
        clearEnd(); endTimer = later(function () { endTimer = null; if (token === expected) finish(); }, 1500);
      };
      var changed = image.getAttribute('src') !== action.webp;
      if (changed) image.src = action.webp;
      if (image.complete && image.naturalWidth) { status('fallback'); fallbackClock(expected); }
    }
    function play() {
      if (!active() || !native || finished) return;
      if (video.ended) {
        if (!video.loop) { finish(); return; }
        video.currentTime = 0;
      }
      video.hidden = false;
      if (!video.paused || playingPromise) return;
      var expected = token;
      playingPromise = true;
      try {
        var result = video.play();
        Promise.resolve(result).then(function () {
          if (token !== expected) return;
          playingPromise = false;
          if (active() && native && !video.paused) { image.hidden = true; status('playing'); }
        }, function (error) {
          if (token !== expected) return;
          playingPromise = false;
          if (error && error.name === 'AbortError') return;
          if (active()) showFallback();
        });
      } catch (_) { playingPromise = false; showFallback(); }
    }
    function alphaSupported(format) {
      if (support[format] !== undefined) return support[format];
      try {
        var canvas = doc.createElement('canvas'); canvas.width = canvas.height = 2;
        var ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(video, 0, 0, 2, 2, 0, 0, 2, 2);
        support[format] = ctx.getImageData(0, 0, 1, 1).data[3] === 0;
      } catch (_) { support[format] = false; }
      return support[format];
    }
    function load() {
      if (!action || !active()) return;
      var expected = token, candidates = [];
      if (action.hevc && video.canPlayType('video/mp4; codecs="hvc1"') && support.hevc !== false) candidates.push({ key: 'hevc', url: action.hevc });
      if (action.webm && support.webm !== false) candidates.push({ key: 'webm', url: action.webm });
      // Reuse the alpha format proven by the first pet; do not re-probe on every action.
      candidates.sort(function (a, b) { return Number(support[b.key] === true) - Number(support[a.key] === true); });
      loading = true; status('loading'); video.preload = 'auto';
      nextCandidate = function () {
        if (token !== expected || destroyed) return;
        clearLoad(); native = false; playingPromise = false;
        var candidate = candidates.shift(), currentSequence = ++sequence;
        if (!candidate) { showFallback(); return; }
        function current() { return token === expected && sequence === currentSequence && !destroyed; }
        video.onerror = function () { if (current()) nextCandidate(); };
        video.onloadeddata = function () {
          if (!current()) return;
          if (!alphaSupported(candidate.key)) { nextCandidate(); return; }
          clearLoad(); loading = false; native = true; lastTime = -1; lastProgress = now(); refresh();
        };
        video.src = candidate.url; video.load();
        loadTimer = later(function () { if (current()) nextCandidate(); }, options.loadTimeoutMs || 5000);
      };
      nextCandidate();
    }
    function refresh() {
      if (!action || destroyed) return;
      if (!active()) { clearEnd(); video.pause(); playingPromise = false; showPoster(); status(reduced.matches ? 'reduced' : 'paused'); return; }
      if (native) play();
      else if (fallback) showFallback();
      else if (!loading) load();
    }
    function set(next, nextState, replay) {
      if (!next || destroyed) return;
      if (action && action.id === next.id && !replay) {
        if (state !== nextState) { clearEnd(); finished = false; playingPromise = false; }
        state = nextState; video.loop = next.playback !== 'once' && state !== 'idle'; refresh(); return;
      }
      token++; sequence++; clearLoad(); clearEnd(); video.pause();
      action = next; state = nextState; finished = false; native = fallback = loading = playingPromise = false;
      retries = 0; lastTime = -1; lastProgress = now();
      video.loop = next.playback !== 'once' && state !== 'idle';
      el.setAttribute('data-motion-id', next.id); showPoster(); refresh();
    }
    function watchdog() {
      if (!action || !active()) return;
      if (native) {
        if (video.ended && !video.loop) { finish(); return; }
        if (Math.abs(video.currentTime - lastTime) > .01) { lastTime = video.currentTime; lastProgress = now(); }
        else if (!finished && now() - lastProgress > 6000) { showFallback(); return; }
        play();
      } else if (!loading && !fallback) refresh();
      else if (fallback && el.getAttribute('data-motion-status') === 'unavailable' && retries < 2) { retries++; clearEnd(); fallback = false; load(); }
    }
    video.muted = true; video.defaultMuted = true; video.playsInline = true;
    video.onplaying = function () { if (native && active()) { image.hidden = true; video.hidden = false; status('playing'); } };
    video.ontimeupdate = function () { if (native && Math.abs(video.currentTime - lastTime) > .005) { lastTime = video.currentTime; lastProgress = now(); } };
    video.onended = function () { playingPromise = false; if (!native || !active() || !video.ended) return; if (video.loop) { video.currentTime = 0; play(); } else finish(); };
    function destroy() {
      destroyed = true; token++; sequence++; clearLoad(); clearEnd();
      image.onload = image.onerror = null;
      video.onloadeddata = video.onerror = video.onplaying = video.onended = video.ontimeupdate = null;
      video.pause(); video.removeAttribute('src'); video.load();
    }
    return { set: set, refresh: refresh, watchdog: watchdog, destroy: destroy };
  }

  function connect(win) {
    var doc = win.document;
    motionCatalog = win.ArenaPetMotions || { actions: {}, states: {} };
    var records = new Map(), formatSupport = {}, idleAction = null, idleTimer = null, previousState = null;
    var watchdogTimer = null, controller = null, queuedIdleAction = null, prefetched = new Set();
    var reduced = win.matchMedia('(prefers-reduced-motion: reduce)');
    function clearIdleTimer() { if (idleTimer !== null) win.clearTimeout(idleTimer); idleTimer = null; }
    function pick(state, avoid) {
      var ids = (motionCatalog.states[state] || []).filter(function (id) { return motionCatalog.actions[id]; });
      if (ids.length > 1) ids = ids.filter(function (id) { return id !== avoid; });
      return motionCatalog.actions[ids[Math.floor(Math.random() * ids.length)]] || motionCatalog.actions['head-tilt'] || null;
    }
    function warm(action) {
      if (!action || (win.navigator.connection && win.navigator.connection.saveData)) return;
      var media = formatSupport.hevc === true ? action.hevc : (formatSupport.webm !== false ? action.webm : action.webp);
      [media, action.poster].forEach(function (url) {
        if (!url || prefetched.has(url)) return;
        prefetched.add(url); var link = doc.createElement('link'); link.rel = 'prefetch'; link.href = url; doc.head.appendChild(link);
      });
    }
    function nextIdle(id, delay) {
      if (idleTimer !== null || doc.hidden || reduced.matches) return;
      idleTimer = win.setTimeout(function () {
        idleTimer = null;
        var now = controller.snapshot();
        if (now.state !== 'idle' || now.running || !idleAction || idleAction.id !== id) return;
        idleAction = queuedIdleAction || pick('idle', id);
        queuedIdleAction = pick('idle', idleAction.id); warm(queuedIdleAction); paint(now);
      }, delay);
    }
    function setMotion(el, state, action, replay) {
      if (!action) return;
      var record = records.get(el);
      if (!record) {
        var image = el.querySelector('.aa-kitten-poster'), video = el.querySelector('video');
        if (!image || !video) return;
        record = createPlayer({ window: win, document: doc, element: el, video: video, image: image, reducedMotion: reduced, formatSupport: formatSupport,
          onEnded: function (ended, endedState) {
            if (!controller) return;
            var snapshot = controller.snapshot();
            if (endedState === 'idle' && snapshot.state === 'idle' && idleAction && idleAction.id === ended.id) nextIdle(ended.id, 180);
            else controller.motionEnded(endedState);
          }
        });
        records.set(el, record);
        if (resizeObserver) resizeObserver.observe(el);
      }
      record.set(action, state, replay);
    }
    function paint(snapshot) {
      if (snapshot.state !== 'idle') clearIdleTimer();
      else if (previousState !== 'idle' || !idleAction) { idleAction = pick('idle'); queuedIdleAction = pick('idle', idleAction.id); warm(queuedIdleAction); }
      previousState = snapshot.state;
      records.forEach(function (record, el) { if (!el.isConnected) { record.destroy(); if (resizeObserver) resizeObserver.unobserve(el); records.delete(el); } });
      doc.querySelectorAll('[data-aa-kitten="live"]').forEach(function (el) {
        var phase = snapshot.phases.get(el.getAttribute('data-aa-kitten-model'));
        var state = phase === 'responding' ? 'working' : (phase || snapshot.state);
        if (!el.querySelector('.aa-kitten-viewport')) {
          el.innerHTML = markup('inside', state).replace(/^<span[^>]*>/, '').replace(/<\/span>$/, '');
        }
        el.setAttribute('data-state', state);
        setMotion(el, state, state === 'idle' ? idleAction : pick(state), false);
      });
      doc.querySelectorAll('[data-aa-kitten-label]').forEach(function (el) {
        if (el.textContent !== snapshot.label) el.textContent = snapshot.label;
      });
      doc.querySelectorAll('[data-aa-kitten-greet]').forEach(function (el) {
        el.setAttribute('aria-label', (motionCatalog.pet || '小猫') + '：' + snapshot.label + '。点击打招呼');
      });
    }
    var resizeObserver = win.ResizeObserver ? new win.ResizeObserver(function () { records.forEach(function (record) { record.refresh(); }); }) : null;
    controller = createController({ onChange: paint, welcomeMs: 5600, doneMs: 5600 });
    function sync(next) { var snapshot = controller.sync(next); paint(snapshot); }
    function greetView() {
      var alreadyGreeting = controller.snapshot().state === 'welcome';
      controller.greet();
      if (alreadyGreeting && controller.snapshot().state === 'welcome') doc.querySelectorAll('[data-aa-kitten="live"]').forEach(function (el) { setMotion(el, 'welcome', pick('welcome'), true); });
    }
    doc.addEventListener('click', function (event) { if (event.target.closest('[data-aa-kitten-greet]')) greetView(); });
    // Pause only for actual page visibility / accessibility, never input focus or draft text.
    function visibility() {
      if (doc.hidden || reduced.matches) { clearIdleTimer(); records.forEach(function (record) { record.refresh(); }); }
      else paint(controller.snapshot());
      if (watchdogTimer !== null) win.clearInterval(watchdogTimer);
      watchdogTimer = !doc.hidden && !reduced.matches ? win.setInterval(function () { records.forEach(function (record) { record.watchdog(); }); }, 2000) : null;
    }
    doc.addEventListener('visibilitychange', visibility); visibility();
    if (reduced.addEventListener) reduced.addEventListener('change', visibility);
    else if (reduced.addListener) reduced.addListener(visibility);
    win.addEventListener('resize', function () { paint(controller.snapshot()); });
    win.addEventListener('pageshow', visibility);
    win.addEventListener('focus', visibility);
    function gesture() { records.forEach(function (record) { record.refresh(); }); }
    doc.addEventListener('pointerdown', gesture, { passive: true });
    doc.addEventListener('keydown', gesture, { passive: true });
    if (win.MutationObserver) new win.MutationObserver(function (mutations) {
      var changed = mutations.some(function (mutation) { return Array.from(mutation.addedNodes).concat(Array.from(mutation.removedNodes)).some(function (node) { return node.nodeType === 1 && (node.matches('[data-aa-kitten="live"]') || node.querySelector('[data-aa-kitten="live"]')); }); });
      if (changed) paint(controller.snapshot());
    }).observe(doc.getElementById('ai-arena-app') || doc.body, { childList: true, subtree: true });
    paint(controller.snapshot());
    return {
      sync: sync, progress: controller.progress, complete: controller.complete,
      greet: greetView, markup: markup, snapshot: controller.snapshot
    };
  }
  return { createController: createController, createPlayer: createPlayer, markup: markup, connect: connect };
});
