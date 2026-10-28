(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ArenaStream = api;
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';
  var segmenter = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;

  function split(text, ended) {
    // An incomplete citation is metadata, not something to type into the reply.
    var citationStart = text.lastIndexOf('[['), tail = text.slice(citationStart);
    if (!ended && citationStart !== -1 && ('[[aa-citation:'.indexOf(tail) === 0 || /^\[\[aa-citation:\d*$/.test(tail))) text = text.slice(0, citationStart);
    if (!ended) text = text.replace(/[\uD800-\uDBFF]$/, '');
    var units = [], cursor = 0, token = /\[\[aa-citation:\d+\]\]/g, match;
    function append(value) {
      var parts = segmenter ? Array.from(segmenter.segment(value), function (part) { return part.segment; }) : Array.from(value);
      parts.forEach(function (part) { units.push(part); });
    }
    while ((match = token.exec(text))) {
      append(text.slice(cursor, match.index)); units.push(match[0]); cursor = token.lastIndex;
    }
    append(text.slice(cursor));
    return units;
  }

  function create(options) {
    options = options || {};
    var later = options.setTimeout || setTimeout, cancel = options.clearTimeout || clearTimeout;
    var now = options.now || function () { return performance.now(); };
    var paint = options.onUpdate || function () {};
    var interval = 1000 / (options.rate || 15), streams = new Map(), idle = [], paused = false;
    function notifyIdle() {
      if (streams.size) return;
      var callbacks = idle; idle = []; callbacks.forEach(function (resolve) { resolve(); });
    }
    function schedule(state) {
      if (paused || state.timer !== null || state.index >= state.units.length) return;
      state.timer = later(function () {
        state.timer = null;
        if (streams.get(state.key) !== state || paused) return;
        advance(state);
      }, Math.max(0, state.nextAt - now()));
    }
    function settle(state) {
      if (!state.ended || state.index < state.units.length) return false;
      if (state.timer !== null) cancel(state.timer);
      state.timer = null;
      streams.delete(state.key);
      paint(state.key, state.visible, true);
      state.waiters.forEach(function (resolve) { resolve(true); });
      notifyIdle(); return true;
    }
    function advance(state) {
      if (state.index < state.units.length) {
        state.visible += state.units[state.index++];
        // Never catch up with a whole batch after a long task or background tab.
        state.nextAt = now() + interval;
        paint(state.key, state.visible, false);
      }
      if (!settle(state)) schedule(state);
    }
    function write(key, text, ended) {
      text = String(text || '');
      var state = streams.get(key);
      if (!state) {
        state = { key: key, target: '', units: [], index: 0, visible: '', nextAt: now(), timer: null, ended: false, waiters: [] };
        streams.set(key, state);
      }
      if (state.target !== text || ended) {
        var units = split(text, !!ended), common = 0;
        while (common < state.index && common < units.length && units[common] === state.units[common]) common++;
        state.units = units; state.index = common; state.target = text;
        var visible = units.slice(0, common).join('');
        if (state.visible !== visible) { state.visible = visible; paint(key, visible, false); }
      }
      state.ended = state.ended || !!ended;
      if (!paused && state.timer === null && state.index < state.units.length && now() >= state.nextAt) advance(state);
      else if (!settle(state)) schedule(state);
      return state;
    }
    return {
      seed: function (key, text) {
        // Reattached answers start at the already received prefix; only new text is paced.
        var state = write(key, String(text || ''), false);
        if (state.timer !== null) cancel(state.timer);
        state.timer = null; state.index = state.units.length; state.visible = state.units.join(''); state.nextAt = now() + interval;
      },
      write: function (key, text) { write(key, text, false); },
      finish: function (key, text) {
        var state = write(key, text, true);
        if (!streams.has(key)) return Promise.resolve(true);
        return new Promise(function (resolve) { state.waiters.push(resolve); });
      },
      text: function (key, fallback) { var state = streams.get(key); return state ? state.visible : fallback; },
      has: function (key) { return streams.has(key); },
      whenIdle: function () { return streams.size ? new Promise(function (resolve) { idle.push(resolve); }) : Promise.resolve(); },
      stop: function () {
        var stopped = [];
        streams.forEach(function (state) {
          if (state.timer !== null) cancel(state.timer);
          stopped.push({ key: state.key, text: state.visible });
          state.waiters.forEach(function (resolve) { resolve(false); });
        });
        streams.clear(); notifyIdle(); return stopped;
      },
      pause: function (value) {
        paused = !!value;
        streams.forEach(function (state) {
          if (state.timer !== null) cancel(state.timer);
          state.timer = null; state.nextAt = now() + interval;
          if (!paused) schedule(state);
        });
      }
    };
  }
  return { create: create };
});
