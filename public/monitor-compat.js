/* Compatibility entry point: intentionally uses ES5 syntax and native browser APIs. */
/* eslint-disable no-var, prefer-const */
(function () {
  'use strict';
  function byId(id) { return document.getElementById(id); }
  var stateNode = byId('compat-state');
  if (!stateNode || !window.JSON || !window.XMLHttpRequest) return;
  var state = JSON.parse(stateNode.textContent || stateNode.innerText);
  var content = byId('compat-content'), modal = byId('compat-modal'), status = byId('compat-status');
  var pollTimer, rotationTimer, clockTimer, activeRequest = null, pending = null, stopped = false;
  var rotating = state.autoStart && state.screens.length > 1, offset = Date.parse(state.serverTime) - Date.now();
  var restoreFocus = null, oldOverflow = '', queryGeneration = 0, rotationDueAt = 0, failureCount = 0;
  var displayedScreenId = state.screenId;
  var activeScale = 1, supportsZoom = 'zoom' in byId('compat-shell').style;
  var layoutOverride = /(?:^|[?&])layout=/.test(window.location.search);
  if (!/(?:^|[?&])theme=/.test(window.location.search)) {
    try { var theme = localStorage.getItem('softcom-pulse-theme'); if (theme === 'dark' || theme === 'light') state.theme = theme; } catch (_error) { /* Keep the explicit/default theme. */ }
  }
  document.documentElement.className = state.theme;
  function text(element, value) { if (element) element.textContent = value == null ? '' : String(value); }
  function each(nodes, callback) { for (var i = 0; i < nodes.length; i++) callback(nodes[i], i); }
  function syncClock(serverTime) { var parsed = Date.parse(serverTime); if (isFinite(parsed)) offset = parsed - Date.now(); }
  function expireEvidence() {
    var now = Date.now() + offset;
    each(document.querySelectorAll('[data-valid-until]'), function (element) {
      var until = Date.parse(element.getAttribute('data-valid-until'));
      if (!isFinite(until) || now <= until || element.getAttribute('data-expired') === 'true') return;
      element.setAttribute('data-expired', 'true');
      if (element.hasAttribute('data-live-status')) { element.className = 'status-pill tone-unknown'; text(element, 'Desatualizado'); }
      else {
        if (element.className.indexOf('metric-old') < 0) element.className += ' metric-old';
        if (element.title.indexOf('Dado desatualizado') !== 0) element.title = 'Dado desatualizado · ' + (element.title || 'Confira a última leitura.');
        each(element.querySelectorAll('.metric-meter i'), function (bar) { bar.style.width = '0%'; });
      }
    });
  }
  function request(url, callback) {
    var xhr = new XMLHttpRequest(), finished = false;
    function finish(error, result) { if (finished) return; finished = true; callback(error, result, xhr.status); }
    try { xhr.open('GET', url, true); } catch (error) { setTimeout(function () { finish(error); }, 0); return xhr; }
    xhr.timeout = 12000;
    xhr.withCredentials = false;
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;
      if (xhr.status < 200 || xhr.status >= 300) { finish(true); return; }
      try { finish(false, JSON.parse(xhr.responseText)); } catch (error) { finish(error); }
    };
    xhr.onerror = xhr.ontimeout = function () { finish(true); };
    xhr.onabort = function () { finish(true); };
    try { xhr.send(null); } catch (error) { setTimeout(function () { finish(error); }, 0); }
    return xhr;
  }
  function snapshotUrl() {
    return '/monitor/compat?fragment=1&screenId=' + encodeURIComponent(state.screenId) + (layoutOverride ? '&layout=' + state.layout : '') + '&tv=' + (state.tv ? '1' : '0') + '&theme=' + state.theme;
  }
  function validSnapshot(result) {
    var next = result && result.state;
    if (!result || typeof result.html !== 'string' || !next || !Array.isArray(next.screens) || !next.screens.length || next.screens.length > 3) return false;
    if (typeof next.revision !== 'number' || !isFinite(next.revision) || next.revision < 1 || typeof next.tv !== 'boolean') return false;
    if (['overview', 'wall'].indexOf(next.layout) < 0 || ['dark', 'light'].indexOf(next.theme) < 0 || [100, 110, 120, 125].indexOf(next.scale) < 0) return false;
    if (typeof next.intervalMs !== 'number' || !isFinite(next.intervalMs) || next.intervalMs < 5000 || next.intervalMs > 300000) return false;
    if (typeof next.refreshAfterMs !== 'number' || !isFinite(next.refreshAfterMs) || next.refreshAfterMs < 5000 || next.refreshAfterMs > 60000 || !isFinite(Date.parse(next.serverTime))) return false;
    if (!next.messages || typeof next.messages !== 'object' || Array.isArray(next.messages)) return false;
    var selected = false;
    for (var i = 0; i < next.screens.length; i++) {
      if (!next.screens[i] || typeof next.screens[i].id !== 'string' || typeof next.screens[i].name !== 'string') return false;
      if (next.screens[i].id === next.screenId) selected = true;
    }
    return selected;
  }
  function warning(message) { text(status, message); status.hidden = !message; fit(); }
  function markStale() {
    pending = null;
    content.setAttribute('data-connection', 'stale');
    var evidence = content.querySelector('.compat-evidence');
    if (evidence && evidence.className.indexOf('is-stale') < 0) evidence.className += ' is-stale';
    each(content.querySelectorAll('[data-live-status]'), function (element) { element.className = 'status-pill tone-unknown'; text(element, 'Desatualizado'); });
    warning('Falha na atualização. A última leitura foi mantida; confira o horário dos dados.');
  }
  function refresh() {
    if (stopped || activeRequest) return;
    clearTimeout(pollTimer);
    content.setAttribute('data-connection', 'updating');
    var generation = queryGeneration;
    activeRequest = request(snapshotUrl(), function (error, result) {
      if (stopped || generation !== queryGeneration) return;
      activeRequest = null;
      var failed = error || !validSnapshot(result);
      if (failed) {
        failureCount++; rotationDueAt = 0;
        state.screenId = displayedScreenId; byId('compat-screen').value = displayedScreenId; markStale();
      } else {
        failureCount = 0; syncClock(result.state.serverTime);
        result.receivedAt = Date.now(); result.requestGeneration = generation;
        if (!modal.hidden) { pending = result; content.setAttribute('data-connection', 'pending'); }
        else applySnapshot(result);
      }
      armRotation();
      var delay = failed ? Math.min(120000, state.refreshAfterMs * Math.pow(2, Math.min(failureCount, 3))) : state.refreshAfterMs;
      pollTimer = setTimeout(refresh, delay);
    });
  }
  function applySnapshot(result) {
    if (result.requestGeneration !== queryGeneration) return;
    var changed = result.state.revision !== state.revision;
    if (result.state.screenId !== displayedScreenId || result.state.intervalMs !== state.intervalMs) rotationDueAt = 0;
    var focusDetail = document.activeElement && document.activeElement.getAttribute('data-open-detail');
    var scroll = {};
    function regionKey(element) {
      var parent = element;
      while (parent && parent !== content) { if (parent.getAttribute && parent.getAttribute('data-block-id')) return parent.getAttribute('data-block-id') + ':' + element.getAttribute('aria-label'); parent = parent.parentNode; }
      return null;
    }
    each(content.querySelectorAll('.table-scroll, .host-card-grid, .availability-grid'), function (element) {
      var key = regionKey(element);
      if (key && element.offsetHeight) scroll[key] = { top: element.scrollTop, left: element.scrollLeft, focus: document.activeElement === element };
    });
    content.innerHTML = result.html;
    content.setAttribute('data-connection', content.querySelector('.is-stale') ? 'stale' : 'ready');
    if (focusDetail) each(content.querySelectorAll('[data-open-detail]'), function (element) { if (element.getAttribute('data-open-detail') === focusDetail) element.focus(); });
    each(content.querySelectorAll('.table-scroll, .host-card-grid, .availability-grid'), function (element) {
      var previous = scroll[regionKey(element)];
      if (previous && element.offsetHeight) { element.scrollTop = previous.top; element.scrollLeft = previous.left; if (previous.focus) element.focus(); }
    });
    state = result.state;
    displayedScreenId = state.screenId;
    if (state.screens.length < 2) rotating = false;
    warning('');
    if (changed) {
      var select = byId('compat-screen');
      while (select.firstChild) select.removeChild(select.firstChild);
      each(state.screens, function (screen) { var option = document.createElement('option'); option.value = screen.id; text(option, screen.name); select.appendChild(option); });
    }
    byId('compat-screen').value = state.screenId;
    updateControls();
    expireEvidence();
    fit();
  }
  function changeView() {
    queryGeneration++; pending = null;
    if (activeRequest) { activeRequest.abort(); activeRequest = null; }
    updateControls(); fit(); refresh();
  }
  function changeScreen(id) {
    if (id === state.screenId) return;
    queryGeneration++; pending = null;
    if (activeRequest) { activeRequest.abort(); activeRequest = null; }
    state.screenId = id; layoutOverride = false;
    byId('compat-screen').value = id;
    refresh();
  }
  function armRotation() {
    clearTimeout(rotationTimer);
    if (!rotating || state.screens.length < 2 || !modal.hidden || document.hidden || stopped) { rotationDueAt = 0; return; }
    if (activeRequest || state.screenId !== displayedScreenId) return;
    if (!rotationDueAt) rotationDueAt = Date.now() + state.intervalMs;
    rotationTimer = setTimeout(function () {
      if (activeRequest) { armRotation(); return; }
      var index = 0;
      each(state.screens, function (screen, position) { if (screen.id === displayedScreenId) index = position; });
      rotationDueAt = 0;
      changeScreen(state.screens[(index + 1) % state.screens.length].id);
    }, Math.max(0, rotationDueAt - Date.now()));
  }
  function updateControls() {
    document.body.className = state.tv ? 'tv-mode' : '';
    text(byId('compat-tv'), state.tv ? 'Sair do modo TV' : 'Modo TV');
    byId('compat-tv').setAttribute('aria-pressed', state.tv ? 'true' : 'false');
    text(byId('compat-rotate'), rotating ? 'Parar alternância' : 'Alternar telas');
    byId('compat-rotate').disabled = state.screens.length < 2;
    each(document.querySelectorAll('[data-layout]'), function (element) { element.setAttribute('aria-pressed', element.getAttribute('data-layout') === state.layout ? 'true' : 'false'); });
    var fullscreen = document.fullscreenElement || document.webkitFullscreenElement;
    text(byId('compat-fullscreen'), fullscreen ? 'Sair da tela cheia' : 'Tela cheia');
    text(byId('compat-theme'), state.theme === 'light' ? 'Tema claro' : 'Tema escuro');
    byId('compat-theme').setAttribute('aria-pressed', state.theme === 'light' ? 'true' : 'false');
    var scale = state.tv || fullscreen ? state.scale / 100 : 1;
    var shell = byId('compat-shell'); activeScale = scale;
    if (supportsZoom) shell.style.zoom = scale;
    else if ('transform' in shell.style || 'webkitTransform' in shell.style) { shell.style.transform = shell.style.webkitTransform = 'scale(' + scale + ')'; shell.style.transformOrigin = shell.style.webkitTransformOrigin = '0 0'; shell.style.width = (100 / scale) + '%'; }
    else activeScale = 1;
  }
  function fit() {
    var rows = content.querySelectorAll('.compat-row'), flexible = [], reserved = 0, minimum = 0;
    each(rows, function (row) {
      row.style.height = '';
      if (row.className.indexOf('content-sized') >= 0) reserved += row.offsetHeight;
      else { flexible.push(row); minimum += parseInt(row.getAttribute('data-min-height'), 10) || 210; }
    });
    if ((window.innerWidth || document.documentElement.clientWidth) < 760 || !flexible.length) return;
    var zoom = activeScale;
    var height = (window.innerHeight || document.documentElement.clientHeight) / zoom;
    var first = content.getBoundingClientRect().top / zoom;
    var summaries = content.querySelectorAll('.compat-summary');
    each(summaries, function (element) { reserved += element.offsetHeight + 5; });
    var footer = content.querySelector('.dashboard-footer');
    if (footer) reserved += footer.offsetHeight + 12;
    var extra = Math.max(0, Math.floor((height - first - reserved - rows.length * 10 - minimum - 12) / flexible.length));
    each(flexible, function (row) { row.style.height = ((parseInt(row.getAttribute('data-min-height'), 10) || 210) + extra) + 'px'; });
  }
  function openModal(title, html, trigger) {
    restoreFocus = trigger || document.activeElement;
    text(byId('compat-modal-title'), title);
    byId('compat-modal-body').innerHTML = html;
    oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    modal.hidden = false;
    modal.querySelector('button').focus();
    expireEvidence();
    armRotation();
  }
  function closeModal() {
    modal.hidden = true;
    document.body.style.overflow = oldOverflow;
    if (restoreFocus && document.documentElement.contains(restoreFocus)) restoreFocus.focus();
    if (pending) {
      var next = pending; pending = null;
      if (next.requestGeneration === queryGeneration && Date.now() - next.receivedAt <= state.refreshAfterMs + 12000) applySnapshot(next);
      else { markStale(); refresh(); }
    }
    armRotation();
  }
  function findAction(element) {
    while (element && element !== document) {
      if (element.nodeType === 1 && (element.hasAttribute('data-open-detail') || element.hasAttribute('data-close-modal') || element.hasAttribute('data-layout'))) return element;
      element = element.parentNode;
    }
    return null;
  }
  document.addEventListener('click', function (event) {
    var element = findAction(event.target);
    if (!element) return;
    event.preventDefault();
    if (element.hasAttribute('data-close-modal')) closeModal();
    else if (element.hasAttribute('data-layout')) { rotating = false; layoutOverride = true; state.layout = element.getAttribute('data-layout'); changeView(); armRotation(); }
    else {
      var source = byId(element.getAttribute('data-open-detail'));
      if (source) openModal(source.getAttribute('data-detail-title'), source.innerHTML, element);
    }
  });
  byId('compat-screen').addEventListener('change', function () { rotating = false; updateControls(); changeScreen(this.value); armRotation(); });
  byId('compat-refresh').addEventListener('click', function (event) { event.preventDefault(); refresh(); });
  byId('compat-tv').addEventListener('click', function (event) { event.preventDefault(); state.tv = !state.tv; changeView(); });
  byId('compat-theme').addEventListener('click', function () {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.className = state.theme;
    try { localStorage.setItem('softcom-pulse-theme', state.theme); } catch (_error) { /* Keep the document preference. */ }
    changeView();
  });
  byId('compat-rotate').addEventListener('click', function () { rotating = !rotating && state.screens.length > 1; if (rotating) layoutOverride = false; updateControls(); armRotation(); });
  function pauseReading() { if (rotating) { rotating = false; updateControls(); armRotation(); } }
  content.addEventListener('wheel', pauseReading); content.addEventListener('touchstart', pauseReading); content.addEventListener('focusin', pauseReading);
  byId('compat-fullscreen').addEventListener('click', function () {
    try {
      var promise;
      if (document.fullscreenElement || document.webkitFullscreenElement) {
        var exit = document.exitFullscreen || document.webkitExitFullscreen;
        if (exit) promise = exit.call(document);
      } else {
        var enter = document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen;
        if (!enter) { warning('Tela cheia indisponível neste navegador. O modo TV continua disponível.'); return; }
        promise = enter.call(document.documentElement);
      }
      if (promise && promise.catch) promise.catch(function () { warning('O aplicativo não permitiu a tela cheia. O modo TV continua disponível.'); });
    } catch (error) { warning('O aplicativo não permitiu a tela cheia. O modo TV continua disponível.'); }
  });
  function clock() {
    var date = new Date(Date.now() + offset - 3 * 3600000);
    function pad(value) { return value < 10 ? '0' + value : String(value); }
    text(byId('compat-clock'), pad(date.getUTCHours()) + ':' + pad(date.getUTCMinutes()) + ':' + pad(date.getUTCSeconds()));
    expireEvidence();
  }
  document.addEventListener('keydown', function (event) {
    if (!modal.hidden && (event.key === 'Escape' || event.keyCode === 27)) { event.preventDefault(); closeModal(); return; }
    if (!modal.hidden && (event.key === 'Tab' || event.keyCode === 9)) {
      var focusable = modal.querySelectorAll('button, a, input, select, [tabindex="0"]');
      var first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    var tag = event.target && event.target.tagName;
    if (!modal.hidden || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || event.repeat || /^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(tag) || event.target && event.target.isContentEditable) return;
    var key = (event.key || '').toLowerCase(), action = key === 't' ? 'compat-tv' : key === 'f' ? 'compat-fullscreen' : key === 'r' ? 'compat-rotate' : null;
    if (action) { event.preventDefault(); byId(action).click(); }
  });
  window.addEventListener('resize', fit);
  document.addEventListener('fullscreenchange', function () { updateControls(); fit(); });
  document.addEventListener('webkitfullscreenchange', function () { updateControls(); fit(); });
  document.addEventListener('visibilitychange', function () { armRotation(); if (!document.hidden) refresh(); });
  window.addEventListener('online', function () { refresh(); });
  window.addEventListener('pagehide', function () { stopped = true; queryGeneration++; pending = null; notificationGeneration++; notificationBusy = false; clearTimeout(pollTimer); clearTimeout(rotationTimer); clearInterval(clockTimer); if (activeRequest) { activeRequest.abort(); activeRequest = null; } });
  window.addEventListener('pageshow', function (event) { if (event.persisted) { stopped = false; cursor = null; clock(); clockTimer = setInterval(clock, 1000); refresh(); pollNotifications(); armRotation(); } });

  var cursor = null, notificationBusy = false, notificationTimer, deliveryRevision = null, notificationGeneration = 0;
  function notificationsLabel(data) {
    text(byId('compat-count'), data.counts.unreadCount);
    byId('compat-notifications').setAttribute('aria-label', 'Notificações: ' + data.counts.unreadCount + ' não lidas, ' + data.counts.activeCount + ' incidentes atuais');
  }
  function notificationList() {
    openModal('Notificações', '<p class="muted">Carregando notificações…</p>', byId('compat-notifications'));
    request('/api/public/monitoring/notifications?limit=30', function (error, data) {
      var body = byId('compat-modal-body');
      if (modal.hidden || byId('compat-modal-title').textContent !== 'Notificações') return;
      body.innerHTML = '';
      if (error) { text(body, 'Não foi possível carregar as notificações.'); return; }
      notificationsLabel(data);
      var intro = document.createElement('p'); text(intro, 'Últimas 30 notificações. Histórico e leitura são compartilhados. Esta tela pública permite somente consulta.'); body.appendChild(intro);
      each(data.events || [], function (entry) {
        var article = document.createElement('article'), title = document.createElement('strong'), message = document.createElement('p'), meta = document.createElement('small');
        article.className = 'notification-entry';
        text(title, entry.displayName); text(message, state.messages[entry.messageCode] || 'Aviso de monitoramento');
        var date = new Date(Date.parse(entry.createdAt) - 3 * 3600000);
        text(meta, date.getUTCDate() + '/' + (date.getUTCMonth() + 1) + '/' + date.getUTCFullYear() + ' ' + date.getUTCHours() + ':' + ('0' + date.getUTCMinutes()).slice(-2) + (entry.readAt ? ' · Lida' : ' · Não lida'));
        article.appendChild(title); article.appendChild(message); article.appendChild(meta); body.appendChild(article);
      });
      if (!data.events || !data.events.length) { var empty = document.createElement('p'); text(empty, 'Nenhuma notificação.'); body.appendChild(empty); }
    });
  }
  byId('compat-notifications').addEventListener('click', notificationList);
  var seen = {}, seenIds = [], toastTimer, visualTimer, lastVisual = 0, visibleEvents = [], visualGroups = [], visualRuntime = null;
  function hideToast() { byId('compat-toast').hidden = true; visibleEvents = []; clearTimeout(toastTimer); }
  function resetVisuals() { hideToast(); visualGroups = []; clearTimeout(visualTimer); }
  function flushVisuals() {
    clearTimeout(visualTimer);
    if (stopped || document.hidden || !visualRuntime || !visualRuntime.enabled) { resetVisuals(); return; }
    if (!visualGroups.length) return;
    var now = Date.now(), wait = Math.max(lastVisual + visualRuntime.visualGapMs - now, visualGroups[0].at + 2000 - now);
    if (visibleEvents.length || wait > 0) { visualTimer = setTimeout(flushVisuals, Math.max(250, wait)); return; }
    var fresh = visualGroups.shift().events.filter(function (event) { return now + offset - Date.parse(event.createdAt) <= visualRuntime.maxDeliveryAgeMs; });
    if (!fresh.length) { flushVisuals(); return; }
    fresh.sort(function (left, right) { var ranks = { critical: 3, warning: 2, info: 1 }; return ranks[right.severity] - ranks[left.severity]; });
    var toast = byId('compat-toast'), first = fresh[0];
    var message = (fresh.length > 1 ? fresh.length + ' ocorrências · ' : '') + first.displayName + ' · ' + (state.messages[first.messageCode] || 'Aviso de monitoramento');
    text(toast, message); text(byId('compat-announcement'), message);
    toast.className = 'compat-toast ' + (visualRuntime.toastPosition === 'top-end' || visualRuntime.toastPosition === 'header-center' ? visualRuntime.toastPosition : 'bottom-end');
    toast.hidden = false; lastVisual = now + visualRuntime.toastLifetimeMs; visibleEvents = fresh;
    toastTimer = setTimeout(function () { hideToast(); flushVisuals(); }, visualRuntime.toastLifetimeMs);
  }
  function deliver(events, runtime, closed, read) {
    visualRuntime = runtime;
    each(visualGroups, function (group) {
      group.events = group.events.filter(function (event) { return read.indexOf(event.id) < 0 && (event.eventType === 'recovery' || closed.indexOf(event.incidentId) < 0); });
    });
    visualGroups = visualGroups.filter(function (group) { return group.events.length; });
    var fresh = [], now = Date.now() + offset;
    each(events, function (event) {
      var at = Date.parse(event.createdAt), active = event.eventType === 'recovery' || event.incidentStatus === 'active';
      if (!seen[event.id] && event.announce && event.toastEligible && !event.readAt && active && read.indexOf(event.id) < 0 && (event.eventType === 'recovery' || closed.indexOf(event.incidentId) < 0) && now >= at && now - at <= Math.max(runtime.maxDeliveryAgeMs, 180000)) fresh.push(event);
      if (!seen[event.id]) { seen[event.id] = true; seenIds.push(event.id); }
    });
    if (seenIds.length > 5000) { each(seenIds.splice(0, seenIds.length - 2500), function (id) { delete seen[id]; }); }
    if (!runtime.enabled) { resetVisuals(); return; }
    fresh.sort(function (left, right) { var ranks = { critical: 3, warning: 2, info: 1 }; return ranks[right.severity] - ranks[left.severity]; });
    if (window.PulseCompatibleAudio) window.PulseCompatibleAudio.deliver(fresh, runtime.soundCooldownMs);
    fresh = fresh.filter(function (event) { return now - Date.parse(event.createdAt) <= runtime.maxDeliveryAgeMs; });
    if (document.hidden) { resetVisuals(); return; }
    if (fresh.length) {
      var group = visualGroups[visualGroups.length - 1];
      if (!group || Date.now() - group.at > 2000) {
        if (!group || visualGroups.length < 3) { group = { at: Date.now(), events: [] }; visualGroups.push(group); }
      }
      group.events = group.events.concat(fresh).slice(-100);
    }
    flushVisuals();
  }
  function pollNotifications() {
    if (stopped || notificationBusy) return;
    notificationBusy = true;
    var epoch = notificationGeneration;
    function done() { if (epoch !== notificationGeneration) return; notificationBusy = false; if (!stopped) notificationTimer = setTimeout(pollNotifications, 10000); }
    if (!cursor) {
      request('/api/public/monitoring/notifications?limit=1', function (error, data) {
        if (epoch !== notificationGeneration || stopped) return;
        if (!error && !stopped) { cursor = data.syncCursor; deliveryRevision = data.runtime.deliveryRevision; syncClock(data.serverTime); notificationsLabel(data); }
        done();
      });
      return;
    }
    var changes = [], latest = null, counts = null;
    function next() {
      request('/api/public/monitoring/notifications/changes?after=' + encodeURIComponent(cursor) + '&limit=200', function (error, data) {
        if (epoch !== notificationGeneration) return;
        if (error || stopped) { cursor = null; resetVisuals(); done(); return; }
        latest = data; cursor = data.nextCursor;
        if (!counts && data.counts) counts = data.counts;
        changes = changes.concat(data.changes);
        if (changes.length > 5000) { cursor = null; resetVisuals(); done(); return; }
        if (data.hasMore) { next(); return; }
        if (counts) notificationsLabel({ counts: counts });
        syncClock(latest.serverTime);
        var events = [], read = [], closed = [];
        each(changes, function (change) {
          if (change.payload.event) events.push(change.payload.event);
          if (change.kind === 'read') read = read.concat(change.payload.ids || []);
          if (change.payload.incident && change.payload.incident.status !== 'active') closed.push(change.payload.incident.id);
        });
        each(visibleEvents, function (event) { if (read.indexOf(event.id) >= 0 || event.eventType !== 'recovery' && closed.indexOf(event.incidentId) >= 0) hideToast(); });
        if (latest.runtime.deliveryRevision === deliveryRevision) deliver(events, latest.runtime, closed, read);
        else resetVisuals();
        deliveryRevision = latest.runtime.deliveryRevision;
        done();
      });
    }
    next();
  }
  document.addEventListener('visibilitychange', function () { if (document.hidden) resetVisuals(); });
  window.addEventListener('pagehide', function () { clearTimeout(notificationTimer); resetVisuals(); });
  byId('compat-toast').addEventListener('click', function () { hideToast(); flushVisuals(); notificationList(); });
  function installAudioControls() {
    var audio = window.PulseCompatibleAudio;
    if (!audio) return;
    var controls = document.createElement('span'); controls.className = 'audio-controls';
    controls.innerHTML = '<button type="button" class="control" id="compat-mute">Som</button><label for="compat-volume" class="sr-only">Volume</label><input type="range" id="compat-volume" min="0" max="100" step="5" aria-label="Volume"><button type="button" class="control" id="compat-test-sound">Testar som</button>';
    byId('compat-notifications').parentNode.insertBefore(controls, byId('compat-notifications'));
    function sync() {
      var muted = audio.muted() || audio.volume() === 0;
      text(byId('compat-mute'), muted ? 'Som mudo' : 'Som ativo');
      byId('compat-mute').setAttribute('aria-pressed', muted ? 'true' : 'false');
      byId('compat-volume').value = Math.round(audio.volume() * 100);
      byId('compat-test-sound').disabled = muted;
    }
    byId('compat-mute').addEventListener('click', function () { var enabled = audio.muted() || audio.volume() === 0; if (enabled && audio.volume() === 0) audio.setVolume(0.5); audio.setMuted(!enabled); sync(); });
    byId('compat-volume').addEventListener('input', function () { audio.setVolume(Number(this.value) / 100); sync(); });
    byId('compat-test-sound').addEventListener('click', function () { audio.test(function (started) { warning(started ? 'Som de teste iniciado.' : 'O navegador não permitiu iniciar o som.'); }); });
    function prepareAudio(event) { if (event.isTrusted) audio.prepare(); }
    document.addEventListener('click', prepareAudio, true); document.addEventListener('keydown', prepareAudio, true);
    window.addEventListener('storage', sync);
    sync(); fit();
  }
  var audioScript = document.createElement('script'); audioScript.src = '/monitor-compat-audio.js'; audioScript.onload = installAudioControls; document.head.appendChild(audioScript);
  updateControls(); clock(); fit(); armRotation();
  content.setAttribute('data-monitor-controller', 'ready');
  clockTimer = setInterval(clock, 1000);
  pollTimer = setTimeout(refresh, state.refreshAfterMs);
  pollNotifications();
}());
