/* ES5 adapter for the existing Kobra WAVs, preferences and operational Web Audio playback. */
/* eslint-disable no-var, prefer-const */
(function () {
  'use strict';
  var context = null, buffers = {}, loading = {}, sources = [], preferences = {}, generation = 0;
  var names = ['notification', 'warning', 'error', 'success'], localClaims = {}, lastSound = 0;
  function read(key) { try { preferences[key] = localStorage.getItem(key); } catch (_error) { /* Persistence is optional. */ } return preferences[key]; }
  function write(key, value) { preferences[key] = value; try { localStorage.setItem(key, value); } catch (_error) { /* Keep the session preference. */ } }
  function muted() { return read('kobra-sound-muted') === '1'; }
  function volume() { var raw = read('kobra-sound-volume'), value = raw == null ? 0.5 : Number(raw); return isFinite(value) && value >= 0 && value <= 1 ? value : 0.5; }
  function silence() {
    generation++;
    for (var i = 0; i < sources.length; i++) {
      try { sources[i].gain.gain.value = 0; sources[i].source.stop(0); } catch (_error) { /* Already ended. */ }
    }
    sources = [];
  }
  function buffer(name, callback) {
    if (buffers[name]) { callback(buffers[name]); return; }
    if (loading[name]) { loading[name].push(callback); return; }
    loading[name] = [callback];
    var xhr = new XMLHttpRequest();
    function finish(value) {
      var callbacks = loading[name] || []; delete loading[name];
      if (value) buffers[name] = value;
      for (var i = 0; i < callbacks.length; i++) callbacks[i](value);
    }
    xhr.open('GET', '/monitor/compat/audio/' + name, true);
    xhr.withCredentials = false; xhr.responseType = 'arraybuffer'; xhr.timeout = 8000;
    xhr.onload = function () {
      if (xhr.status !== 200 || !context) { finish(null); return; }
      try {
        var promise = context.decodeAudioData(xhr.response, function (value) { finish(value); }, function () { finish(null); });
        if (promise && promise.catch) promise.catch(function () { /* Callback handles rejection. */ });
      } catch (_error) { finish(null); }
    };
    xhr.onerror = xhr.ontimeout = function () { finish(null); };
    try { xhr.send(null); } catch (_error) { finish(null); }
  }
  function prepare() {
    try {
      var AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return false;
      if (!context || context.state === 'closed') context = new AudioContextClass();
      if (context.resume) { var resume = context.resume(); if (resume && resume.catch) resume.catch(function () { /* No deferred alarm. */ }); }
      for (var i = 0; i < names.length; i++) buffer(names[i], function () { /* Warm the approved WAV cache. */ });
      return true;
    } catch (_error) { return false; }
  }
  function play(name, velocity, eligible, callback) {
    if (!context || names.indexOf(name) < 0 || muted() || volume() === 0 || !eligible()) { callback(false); return; }
    var epoch = generation, ended = false, deadline = Date.now() + 1500;
    var timeout = setTimeout(function () { finish(false); }, 1500);
    function finish(started) { if (ended) return; ended = true; clearTimeout(timeout); callback(started); }
    function start() {
      buffer(name, function (decoded) {
        if (!decoded || ended || epoch !== generation || Date.now() > deadline || muted() || volume() === 0 || !eligible() || context.state !== 'running') { finish(false); return; }
        try {
          var source = context.createBufferSource(), gain = context.createGain(), voice = { source: source, gain: gain };
          source.buffer = decoded; gain.gain.value = volume() * velocity;
          source.connect(gain); gain.connect(context.destination); sources.push(voice);
          source.onended = function () { var index = sources.indexOf(voice); if (index >= 0) sources.splice(index, 1); source.disconnect(); gain.disconnect(); };
          source.start(0); finish(true);
        } catch (_error) { finish(false); }
      });
    }
    try {
      var resumed = context.resume ? context.resume() : null;
      if (resumed && resumed.then) resumed.then(start, function () { finish(false); });
      else start();
    } catch (_error) { finish(false); }
  }
  function deliver(events, cooldown) {
    var cue = null, ids = [], i;
    for (i = 0; i < events.length; i++) { ids.push(events[i].id); if (!cue && events[i].sound) cue = events[i]; }
    if (!cue) return;
    function run(done) {
      var now = Date.now(), claims = {}, last = lastSound;
      try {
        var stored = JSON.parse(read('pulse-notification-claims:public') || '{}');
        if (stored && stored.ids && typeof stored.ids === 'object' && !Array.isArray(stored.ids)) claims = stored.ids;
        last = Math.max(last, Number(read('pulse-notification-last-sound')) || 0);
      } catch (_error) { /* Use per-document claims. */ }
      var keys = Object.keys(claims);
      for (i = 0; i < keys.length; i++) if (now - claims[keys[i]] > 180000) delete claims[keys[i]];
      keys = Object.keys(localClaims);
      for (i = 0; i < keys.length; i++) if (now - localClaims[keys[i]] > 180000) delete localClaims[keys[i]];
      for (i = 0; i < ids.length; i++) if (claims[ids[i]] || localClaims[ids[i]]) { done(); return; }
      if (now - last < cooldown) { done(); return; }
      play(cue.sound, events[0].severity === 'critical' ? 0.65 : 0.45, function () { return Date.now() - now < 1500; }, function (started) {
        if (started) {
          lastSound = Date.now();
          for (var index = 0; index < ids.length; index++) { claims[ids[index]] = lastSound; localClaims[ids[index]] = lastSound; }
          write('pulse-notification-claims:public', JSON.stringify({ ids: claims })); write('pulse-notification-last-sound', String(lastSound));
        }
        done();
      });
    }
    try {
      if (navigator.locks && window.Promise && window.AbortController) {
        var attempted = false, controller = new AbortController(), lockDeadline = Date.now() + 400;
        var timeout = setTimeout(function () { controller.abort(); }, 400);
        navigator.locks.request('pulse-notification-delivery', { signal: controller.signal }, function () {
          clearTimeout(timeout);
          if (Date.now() > lockDeadline) return;
          attempted = true;
          return new Promise(function (resolve) { run(resolve); });
        }).then(function () { clearTimeout(timeout); }, function (error) { clearTimeout(timeout); if (!attempted && error.name !== 'AbortError' && error.name !== 'TimeoutError') run(function () { /* Per-document fallback. */ }); });
        return;
      }
    } catch (_error) { /* Opaque origins may refuse Web Locks. */ }
    run(function () { /* Playback has no pending replay. */ });
  }
  window.addEventListener('storage', function (event) { if (!event.key || event.key.indexOf('kobra-sound-') === 0) silence(); });
  window.addEventListener('pagehide', silence);
  window.PulseCompatibleAudio = {
    supported: function () { return !!(window.AudioContext || window.webkitAudioContext); },
    prepare: prepare, deliver: deliver, muted: muted, volume: volume,
    setMuted: function (value) { write('kobra-sound-muted', value ? '1' : '0'); silence(); },
    setVolume: function (value) { write('kobra-sound-volume', String(Math.max(0, Math.min(1, value)))); silence(); },
    test: function (callback) { prepare(); play('notification', 0.45, function () { return true; }, callback); },
  };
}());
