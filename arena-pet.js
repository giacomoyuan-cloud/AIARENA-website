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

  // Task state comes from the app, independently of the idle motion playlist.
  function createController(options) {
    options = options || {};
    var later = options.setTimeout || setTimeout;
    var cancel = options.clearTimeout || clearTimeout;
    var change = options.onChange || function () {};
    var state = 'welcome', label = LABELS.welcome, running = false;
    var hasMessages = false, mode = 'chat', hadError = false, hasReply = false, generation = 0;
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
    }
    function greet() {
      if (running) return;
      clear(); show('welcome'); timer = later(idle, options.welcomeMs || 3200);
    }
    function busy() {
      var values = Array.from(phases.values());
      if (values.indexOf('searching') !== -1) show('searching');
      else if (values.indexOf('thinking') !== -1) show('thinking');
      else show(mode === 'image' || values.length || hasReply ? 'working' : 'thinking');
    }
    function sync(next) {
      var wasRunning = running, hadMessages = hasMessages;
      hasMessages = !!next.hasMessages; mode = next.mode || 'chat';
      running = !!next.running;
      if (running) {
        if (!wasRunning) { clear(); phases.clear(); hadError = false; hasReply = false; generation++; }
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
      // Once a model starts replying, late reasoning/status packets cannot interrupt typing.
      if (phases.get(model) === 'responding') phase = 'responding';
      if (phase === 'responding') hasReply = true;
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
  function pickLoopAction(catalog, state) {
    catalog = catalog || { actions: {}, states: {} };
    var ids = (catalog.states[state] || []).concat(['knead', 'head-tilt']);
    for (var i = 0; i < ids.length; i++) {
      var action = catalog.actions[ids[i]];
      if (action && action.playback === 'loop') return action;
    }
    return null;
  }
  var LOGIN_ACTIONS = ['knead', 'head-tilt', 'work-laptop', 'wand-jump', 'wand-bat', 'wand-kick'];
  function pickLoginAction(catalog, previous, random) {
    catalog = catalog || { actions: {}, states: {} };
    var candidates = LOGIN_ACTIONS.map(function (id) { return catalog.actions[id]; }).filter(function (action) {
      return action && action.playback === 'loop';
    });
    if (!candidates.length) return pickLoopAction(catalog, 'welcome');
    var different = candidates.filter(function (action) { return action.id !== previous; });
    if (different.length) candidates = different;
    var value = (random || Math.random)();
    var index = Number.isFinite(value) ? Math.max(0, Math.min(candidates.length - 1, Math.floor(value * candidates.length))) : 0;
    return candidates[index];
  }
  function createIdlePlaylist(options) {
    var catalog = options.catalog || { actions: {} };
    var later = options.setTimeout || setTimeout, cancel = options.clearTimeout || clearTimeout;
    var notify = options.onChange || function () {};
    var actions = (catalog.idleSequence || []).map(function (id) { return catalog.actions[id]; }).filter(function (action) {
      return action && action.durationSeconds > 0;
    });
    var index = 0, enabled = false, timer = null;
    function clear() { if (timer !== null) cancel(timer); timer = null; }
    function current() { return enabled && actions.length ? actions[index] : null; }
    function advance(id) {
      var action = current();
      if (!action || action.id !== id) return;
      clear(); index = (index + 1) % actions.length; notify(current());
    }
    function ready(id) {
      var action = current();
      if (!action || action.id !== id || timer !== null) return;
      // Start only after media is ready. Loops play twice; one-shots advance on
      // their actual end event, with a bounded fallback for missed events.
      var duration = action.durationSeconds * (action.playback === 'loop' ? 2 : 1) * 1000;
      timer = later(function () { timer = null; advance(id); }, Math.ceil(duration + (action.playback === 'once' ? 250 : 0)));
    }
    function setEnabled(value, reset) {
      value = !!value;
      if (!value) { clear(); if (reset) index = 0; }
      enabled = value;
    }
    return { current: current, ready: ready, advance: advance, setEnabled: setEnabled };
  }
  function liveReplyIds(messages, running, phases, pendingModels, isStreaming) {
    var start = -1, selected = new Set(), latest = new Map(), last = null;
    messages.forEach(function (msg, index) { if (msg.isUser) start = index; });
    messages.slice(start + 1).forEach(function (msg) {
      if (!msg.isUser) { latest.set(msg.submodel, msg); last = msg; }
    });
    if (!last) return selected;
    if (!running) { selected.add(last.uid); return selected; }
    latest.forEach(function (msg, model) {
      if (!pendingModels.has(model) && (phases.has(model) || isStreaming(msg.uid))) selected.add(msg.uid);
    });
    // The final displayed character can finish just before the app settles.
    if (!selected.size && !pendingModels.size) selected.add(last.uid);
    return selected;
  }
  function markup(place, state, model) {
    state = LABELS[state] ? state : 'welcome';
    var action = pickLoopAction(motionCatalog, state);
    return '<span class="aa-kitten aa-kitten--' + escape(place) + '" data-aa-kitten="' + (place === 'portrait' ? 'still' : 'live') + '" data-state="' + state + '"'
      + (model ? ' data-aa-kitten-model="' + escape(model) + '"' : '') + ' aria-hidden="true">'
      + '<span class="aa-kitten-viewport"><img class="aa-kitten-poster" src="' + escape(place === 'portrait' && motionCatalog ? motionCatalog.portrait : (action ? action.poster : '/assets/kitten/motion/poster.png?v=20261028')) + '" alt="" draggable="false" decoding="async">'
      + (place === 'portrait' ? '' : '<video class="aa-kitten-motion" muted playsinline preload="none" hidden></video><canvas class="aa-kitten-previous" aria-hidden="true" hidden></canvas>') + '</span></span>';
  }

  // A media player owns loading/recovery, never the assistant's task state.
  function createPlayer(options) {
    var win = options.window, doc = options.document, el = options.element;
    var video = options.video, image = options.image, previous = options.previous, support = options.formatSupport || {};
    var reduced = options.reducedMotion || { matches: false };
    var later = options.setTimeout || win.setTimeout.bind(win), cancel = options.clearTimeout || win.clearTimeout.bind(win);
    var now = options.now || function () { return Date.now(); };
    var action = null, state = null, token = 0, sequence = 0, destroyed = false;
    var native = false, fallback = false, loading = false, playingPromise = false, finished = false;
    var loadTimer = null, endTimer = null, revealTimer = null, presentationTimer = null;
    var frameRequest = null, frameKind = null, waitingToken = null, presentedToken = null;
    var lastTime = -1, lastProgress = now(), retries = 0;
    var nextCandidate = null;
    function status(value) { if (el.getAttribute('data-motion-status') !== value) el.setAttribute('data-motion-status', value); }
    function active() { return !destroyed && el.isConnected && el.getClientRects().length > 0 && !doc.hidden && !reduced.matches; }
    function clearLoad() { if (loadTimer !== null) cancel(loadTimer); loadTimer = null; }
    function clearEnd() { if (endTimer !== null) cancel(endTimer); endTimer = null; }
    function clearReveal() { if (revealTimer !== null) cancel(revealTimer); revealTimer = null; }
    function clearPresentation() {
      if (presentationTimer !== null) cancel(presentationTimer);
      presentationTimer = null;
      if (frameRequest !== null) {
        if (frameKind === 'video' && video.cancelVideoFrameCallback) video.cancelVideoFrameCallback(frameRequest);
        else if (frameKind === 'animation' && win.cancelAnimationFrame) win.cancelAnimationFrame(frameRequest);
      }
      frameRequest = null; frameKind = null; waitingToken = null;
    }
    function rememberFrame() {
      if (!previous || !action || !active()) return false;
      // A newer task may interrupt a clip that has not decoded yet.
      if (!previous.hidden && (loading || presentedToken !== token)) return true;
      try {
        var source = native && !video.hidden ? video : image;
        var width = source.videoWidth || source.naturalWidth, height = source.videoHeight || source.naturalHeight;
        if (!width || !height) return !previous.hidden;
        var canvas = doc.createElement('canvas'); canvas.width = width; canvas.height = height;
        var context = canvas.getContext('2d'); context.drawImage(source, 0, 0, width, height);
        if (!previous.hidden) {
          var opacity = win.getComputedStyle ? Number(win.getComputedStyle(previous).opacity) : Number(previous.style.opacity);
          if (opacity > 0) { context.globalAlpha = opacity; context.drawImage(previous, 0, 0, width, height); }
        }
        previous.width = width; previous.height = height;
        previous.getContext('2d').drawImage(canvas, 0, 0);
        previous.style.transition = 'none'; previous.style.opacity = '1'; previous.hidden = false;
        void previous.offsetWidth;
        previous.style.transition = '';
        return true;
      } catch (_) { return !previous.hidden; }
    }
    function presented(expected) {
      if (expected !== token || waitingToken !== expected || !active()) return;
      clearPresentation(); presentedToken = expected;
      if (native) image.hidden = true;
      if (previous && !previous.hidden && previous.style.opacity !== '0') {
        clearReveal();
        previous.style.opacity = '0';
        revealTimer = later(function () { revealTimer = null; if (token === expected) previous.hidden = true; }, 260);
      }
      if (options.onReady) options.onReady(action, state);
    }
    function ready() {
      if (!active()) return;
      if (presentedToken === token) { if (options.onReady) options.onReady(action, state); return; }
      if (waitingToken === token) return;
      var expected = token; waitingToken = expected;
      function finish() { presented(expected); }
      if (native && video.requestVideoFrameCallback) {
        frameKind = 'video'; frameRequest = video.requestVideoFrameCallback(finish);
      } else if (win.requestAnimationFrame) {
        frameKind = 'animation';
        frameRequest = win.requestAnimationFrame(function () {
          if (waitingToken !== expected || token !== expected) return;
          frameRequest = win.requestAnimationFrame(finish);
        });
      } else { finish(); return; }
      // A broken frame callback must not leave an old frame on screen forever.
      presentationTimer = later(function () {
        if (token !== expected || waitingToken !== expected) return;
        if (native && (video.paused || !(video.currentTime > 0))) { clearPresentation(); showFallback(); }
        else finish();
      }, 800);
    }
    function showPoster(preserve) { video.hidden = true; image.hidden = false; image.onload = null; image.onerror = null; if (!preserve && action && image.getAttribute('src') !== action.poster) image.src = action.poster; }
    function finish() {
      if (finished || !active()) return;
      finished = true; clearEnd(); status('complete');
      if (options.onEnded) options.onEnded(action, state);
    }
    function fallbackClock(expected) {
      if (token !== expected || !active() || !fallback || endTimer !== null || finished) return;
      // Animated WebP has no ended event. Re-arm only when it actually reloads/resumes.
      if (action.playback === 'once') endTimer = later(function () { endTimer = null; if (token === expected) finish(); }, Math.ceil(action.durationSeconds * 1000));
    }
    function showFallback() {
      if (native && active()) { clearReveal(); rememberFrame(); }
      clearPresentation(); presentedToken = null;
      clearLoad(); native = false; fallback = true; loading = false; playingPromise = false;
      video.pause(); video.hidden = true;
      if (!active()) { showPoster(); status('paused'); return; }
      var expected = token;
      image.hidden = false;
      image.onload = function () { if (token === expected && fallback && active()) { status('fallback'); ready(); fallbackClock(expected); } };
      image.onerror = function () {
        if (token !== expected || !fallback) return;
        image.onload = image.onerror = null; image.src = action.poster; status('unavailable');
        clearEnd(); endTimer = later(function () { endTimer = null; if (token === expected) finish(); }, 1500);
      };
      var changed = image.getAttribute('src') !== action.webp;
      if (changed) image.src = action.webp;
      if (image.complete && image.naturalWidth) { status('fallback'); ready(); fallbackClock(expected); }
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
          if (active() && native && !video.paused) { status('playing'); ready(); }
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
      if (!active()) { clearEnd(); clearReveal(); clearPresentation(); presentedToken = null; if (previous) previous.hidden = true; video.pause(); playingPromise = false; showPoster(); status(reduced.matches ? 'reduced' : 'paused'); return; }
      if (native) play();
      else if (fallback) showFallback();
      else if (!loading) load();
    }
    function set(next, nextState, replay) {
      if (!next || destroyed) return;
      if (action && action.id === next.id && !replay) {
        if (state !== nextState) { clearEnd(); finished = false; playingPromise = false; }
        state = nextState; video.loop = next.playback !== 'once'; refresh(); return;
      }
      clearReveal(); var retained = rememberFrame(), hadAction = !!action; clearPresentation();
      token++; sequence++; presentedToken = null; clearLoad(); clearEnd(); video.pause();
      action = next; state = nextState; finished = false; native = fallback = loading = playingPromise = false;
      retries = 0; lastTime = -1; lastProgress = now();
      video.loop = next.playback !== 'once';
      el.setAttribute('data-motion-id', next.id); showPoster(hadAction && !retained); refresh();
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
    video.onplaying = function () { if (native && active()) { video.hidden = false; status('playing'); ready(); } };
    video.ontimeupdate = function () { if (native && Math.abs(video.currentTime - lastTime) > .005) { lastTime = video.currentTime; lastProgress = now(); } };
    video.onended = function () { playingPromise = false; if (!native || !active() || !video.ended) return; if (video.loop) { video.currentTime = 0; play(); } else finish(); };
    function destroy() {
      destroyed = true; token++; sequence++; clearLoad(); clearEnd(); clearReveal(); clearPresentation();
      image.onload = image.onerror = null;
      video.onloadeddata = video.onerror = video.onplaying = video.onended = video.ontimeupdate = null;
      if (previous) previous.hidden = true;
      video.pause(); video.removeAttribute('src'); video.load();
    }
    return { set: set, refresh: refresh, watchdog: watchdog, destroy: destroy };
  }

  function connect(win) {
    var doc = win.document;
    motionCatalog = win.ArenaPetMotions || { actions: {}, states: {} };
    var records = new Map(), formatSupport = {};
    var watchdogTimer = null, controller = null;
    var reduced = win.matchMedia('(prefers-reduced-motion: reduce)');
    var loginAction = null, loginVisible = false, lastLoginAction = null;
    var loginActionKey = 'aa-login-last-pet-action';
    function loginMotion(el) {
      if (!el.getClientRects().length) {
        loginVisible = false;
        return loginAction || pickLoopAction(motionCatalog, 'welcome');
      }
      if (!loginVisible) {
        var previous = lastLoginAction;
        try { previous = win.localStorage.getItem(loginActionKey) || previous; } catch (_) {}
        loginAction = pickLoginAction(motionCatalog, previous);
        if (loginAction) {
          lastLoginAction = loginAction.id;
          try { win.localStorage.setItem(loginActionKey, loginAction.id); } catch (_) {}
        }
      }
      loginVisible = true;
      return loginAction;
    }
    var playlist = createIdlePlaylist({ catalog: motionCatalog, setTimeout: win.setTimeout.bind(win), clearTimeout: win.clearTimeout.bind(win),
      onChange: function () { if (controller) paint(controller.snapshot()); } });
    function setMotion(el, state, action, replay) {
      if (!action) return;
      var record = records.get(el);
      if (!record) {
        var image = el.querySelector('.aa-kitten-poster'), video = el.querySelector('video'), previous = el.querySelector('.aa-kitten-previous');
        if (!image || !video) return;
        record = createPlayer({ window: win, document: doc, element: el, video: video, image: image, previous: previous, reducedMotion: reduced, formatSupport: formatSupport,
          onReady: function (readyAction) { if (readyAction) playlist.ready(readyAction.id); },
          onEnded: function (ended, endedState) {
            if (!controller) return;
            if (playlist.current() && playlist.current().id === ended.id) { playlist.advance(ended.id); return; }
            controller.motionEnded(endedState);
          }
        });
        records.set(el, record);
        if (resizeObserver) resizeObserver.observe(el);
      }
      record.set(action, state, replay);
    }
    function paint(snapshot) {
      records.forEach(function (record, el) {
        if (!el.isConnected && el.getAttribute('data-aa-kitten-transfer') !== 'pending') {
          record.destroy(); if (resizeObserver) resizeObserver.unobserve(el); records.delete(el);
        }
      });
      var live = Array.from(doc.querySelectorAll('[data-aa-kitten="live"]'));
      var canIdle = !snapshot.running && (snapshot.state === 'idle' || snapshot.state === 'done') && !doc.hidden && !reduced.matches
        && live.some(function (el) { return el.isConnected && el.getClientRects().length > 0; });
      playlist.setEnabled(canIdle, snapshot.running);
      live.forEach(function (el) {
        var phase = snapshot.phases.get(el.getAttribute('data-aa-kitten-model'));
        var state = phase === 'responding' ? 'working' : (phase || (snapshot.running && el.classList.contains('aa-kitten--reply') ? 'working' : snapshot.state));
        if (!el.querySelector('.aa-kitten-viewport')) {
          el.innerHTML = markup('inside', state).replace(/^<span[^>]*>/, '').replace(/<\/span>$/, '');
        }
        el.setAttribute('data-state', state);
        var action = canIdle ? (playlist.current() || pickLoopAction(motionCatalog, state)) : pickLoopAction(motionCatalog, state);
        if (el.classList.contains('aa-kitten--login')) {
          var initial = loginMotion(el);
          if (!snapshot.running && snapshot.state === 'welcome') action = initial;
        }
        setMotion(el, state, action, false);
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
      controller.greet();
    }
    doc.addEventListener('click', function (event) { if (event.target.closest('[data-aa-kitten-greet]')) greetView(); });
    // Pause only for actual page visibility / accessibility, never input focus or draft text.
    function visibility() {
      paint(controller.snapshot());
      if (doc.hidden || reduced.matches) records.forEach(function (record) { record.refresh(); });
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
    var loginOverlay = doc.getElementById('aaLoginOverlay');
    if (win.MutationObserver && loginOverlay) new win.MutationObserver(function () {
      if (loginOverlay.getClientRects().length && !loginVisible && !controller.snapshot().running) controller.greet();
      paint(controller.snapshot());
    }).observe(loginOverlay, { attributes: true, attributeFilter: ['style', 'hidden'] });
    paint(controller.snapshot());
    return {
      sync: sync, progress: controller.progress, complete: controller.complete,
      greet: greetView, markup: markup, liveReplyIds: liveReplyIds, snapshot: controller.snapshot
    };
  }
  return { createController: createController, createPlayer: createPlayer, createIdlePlaylist: createIdlePlaylist, liveReplyIds: liveReplyIds, pickLoopAction: pickLoopAction, pickLoginAction: pickLoginAction, markup: markup, connect: connect };
});
