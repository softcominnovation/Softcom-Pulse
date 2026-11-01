/* Shared by the React monitor and old TV engines; keep ES5 syntax. */
(function (scope) {
  'use strict';
  if (scope.PulseMonitorAutoScroll) return;
  var controllers = [];
  function createMotion(now) {
    var position = 0, direction = 1, lastAt = now, pauseUntil = now + 2000;
    return {
      getPosition: function () { return position; },
      capture: function (value) { position = value; },
      hold: function (value, time) { position = value; lastAt = time; pauseUntil = time + 2000; },
      step: function (time, maximum) {
        var elapsed = Math.max(0, Math.min(100, time - lastAt)) / 1000;
        lastAt = time;
        if (maximum <= 1) { position = 0; direction = 1; pauseUntil = time + 2000; return 0; }
        position = Math.min(position, maximum);
        if (time < pauseUntil) return position;
        position = Math.max(0, Math.min(maximum, position + direction * 24 * elapsed));
        if (position === maximum || position === 0) { direction *= -1; pauseUntil = time + 2000; }
        return position;
      }
    };
  }
  function isAutomatic(target) {
    for (var i = 0; i < controllers.length; i++) if (controllers[i].owns(target)) return true;
    return false;
  }
  function attach(root, options) {
    options = options || {};
    var doc = root.ownerDocument, win = doc.defaultView;
    var entries = [], cache = Object.create(null), order = [], destroyed = false, suspended = false, frame = null;
    var lastScan = 0, paused = !!options.paused, observer;
    var manualEvents = ['wheel', 'touchstart', 'touchmove', 'pointerdown', 'pointermove', 'keydown'];
    function now() { return win.performance && win.performance.now ? win.performance.now() : Date.now(); }
    function command(entry, value, time) {
      entry.expected = value; entry.commandUntil = time + 250;
      entry.element.scrollTop = value;
      // Some WebViews round scrollTop; retain fractions in the motion model, not the DOM.
      entry.expected = entry.element.scrollTop;
    }
    function keyFor(element, block, counts) {
      var identity = element.id || String(element.className || '').replace(/\s+/g, '.');
      var base = block.getAttribute('data-block-id') + ':' + identity;
      counts[base] = (counts[base] || 0) + 1;
      return base + ':' + counts[base];
    }
    function sync(captureDOM) {
      if (destroyed) return;
      var time = now(), next = [], counts = Object.create(null);
      var blocks = root.querySelectorAll('[data-block-id]');
      for (var b = 0; b < blocks.length; b++) {
        var elements = blocks[b].querySelectorAll('*');
        for (var i = 0; i < elements.length; i++) {
          var element = elements[i];
          if (/^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName) || element.isContentEditable) continue;
          var overflow = win.getComputedStyle(element).overflowY;
          if (overflow !== 'auto' && overflow !== 'scroll') continue;
          var key = keyFor(element, blocks[b], counts);
          if (!element.clientHeight || element.scrollHeight - element.clientHeight <= 1) continue;
          var entry = cache[key];
          if (!entry) {
            entry = { key: key, motion: createMotion(time), manualUntil: 0, commandUntil: 0, expected: 0, element: null };
            entry.motion.hold(element.scrollTop, time);
            cache[key] = entry; order.push(key);
          }
          if (captureDOM === true) entry.motion.capture(element.scrollTop);
          if (entry.element !== element) {
            entry.element = element;
            command(entry, Math.min(entry.motion.getPosition(), element.scrollHeight - element.clientHeight), time);
          }
          element.setAttribute('data-monitor-auto-scroll', 'true');
          next.push(entry);
        }
      }
      for (var n = 0; n < entries.length; n++) if (next.indexOf(entries[n]) < 0 && entries[n].element) {
        entries[n].element.removeAttribute('data-monitor-auto-scroll'); entries[n].element = null;
      }
      entries = next;
      for (var c = order.length - 1; order.length > 128 && c >= 0; c--) {
        var candidate = cache[order[c]];
        if (!candidate.element) { delete cache[order[c]]; order.splice(c, 1); }
      }
      lastScan = time;
    }
    function owns(target) {
      var time = now();
      for (var i = 0; i < entries.length; i++) {
        var entry = entries[i];
        if (entry.element === target && time <= entry.commandUntil && Math.abs(target.scrollTop - entry.expected) < 1) return true;
      }
      return false;
    }
    function manual(event) {
      if (event.type === 'pointermove' && !event.buttons) return;
      if (event.type === 'scroll' && owns(event.target)) return;
      var time = now();
      for (var i = 0; i < entries.length; i++) {
        var entry = entries[i];
        if (entry.element === event.target || entry.element.contains(event.target)) {
          entry.commandUntil = 0; entry.manualUntil = time + 5000;
          entry.motion.hold(entry.element.scrollTop, time);
        }
      }
    }
    function dialogOpen() {
      return !!doc.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], dialog[open], .compat-modal:not([hidden])');
    }
    function animate() {
      if (destroyed || suspended) return;
      var time = now();
      if (time - lastScan > 1000) sync();
      var blocked = paused || doc.hidden || dialogOpen();
      for (var i = 0; i < entries.length; i++) {
        var entry = entries[i], element = entry.element;
        if (blocked || time < entry.manualUntil || !element.clientHeight) entry.motion.hold(element.scrollTop, time);
        else command(entry, entry.motion.step(time, element.scrollHeight - element.clientHeight), time);
      }
      frame = win.requestAnimationFrame(animate);
    }
    function suspend() {
      suspended = true; win.cancelAnimationFrame(frame); frame = null;
      for (var i = 0; i < entries.length; i++) entries[i].motion.hold(entries[i].element.scrollTop, now());
    }
    function resume() {
      if (destroyed) return;
      suspended = false; sync();
      if (frame === null) frame = win.requestAnimationFrame(animate);
    }
    function visibility() { if (doc.hidden) suspend(); else resume(); }
    var controller = {
      sync: sync,
      owns: owns,
      capture: function () { sync(true); },
      setPaused: function (value) { paused = !!value; },
      destroy: function () {
        destroyed = true; suspend();
        if (observer) observer.disconnect();
        for (var i = 0; i < manualEvents.length; i++) root.removeEventListener(manualEvents[i], manual, true);
        root.removeEventListener('scroll', manual, true);
        win.removeEventListener('resize', sync); win.removeEventListener('orientationchange', sync);
        win.removeEventListener('pagehide', suspend); win.removeEventListener('pageshow', resume);
        doc.removeEventListener('visibilitychange', visibility);
        for (var j = 0; j < entries.length; j++) entries[j].element.removeAttribute('data-monitor-auto-scroll');
        controllers.splice(controllers.indexOf(controller), 1);
        entries = []; cache = Object.create(null); order = [];
      }
    };
    controllers.push(controller);
    for (var i = 0; i < manualEvents.length; i++) root.addEventListener(manualEvents[i], manual, { capture: true, passive: true });
    root.addEventListener('scroll', manual, { capture: true, passive: true });
    win.addEventListener('resize', sync); win.addEventListener('orientationchange', sync);
    win.addEventListener('pagehide', suspend); win.addEventListener('pageshow', resume);
    doc.addEventListener('visibilitychange', visibility);
    if (win.MutationObserver) {
      observer = new win.MutationObserver(sync);
      observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'hidden'] });
    }
    sync(); frame = win.requestAnimationFrame(animate);
    return controller;
  }
  scope.PulseMonitorAutoScroll = { createMotion: createMotion, attach: attach, isAutomatic: isAutomatic };
}(typeof window !== 'undefined' ? window : globalThis));
