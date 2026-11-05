/* Compatibility entry point: intentionally uses ES5 syntax and native browser APIs. */
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
  var autoScroll = null;
  var layoutOverride = /(?:^|[?&])layout=/.test(window.location.search);
  if (!/(?:^|[?&])theme=/.test(window.location.search)) {
    try { var theme = localStorage.getItem('softcom-pulse-theme'); if (theme === 'dark' || theme === 'light') state.theme = theme; } catch (_error) { void _error; /* Keep the explicit/default theme. */ }
  }
  document.documentElement.className = state.theme;
  function text(element, value) { if (element) element.textContent = value == null ? '' : String(value); }
  function controlLabel(id, value) { var element = byId(id); if (element) text(element.querySelector('[data-control-label]') || element, value); }
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
        if (element.hasAttribute('data-current-only')) text(element.querySelector('strong'), '—');
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
    if (next.autoScrollOnLoad !== undefined && typeof next.autoScrollOnLoad !== 'boolean') return false;
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
  function warning(message) { text(status, message); status.hidden = !message; applyDensity(); }
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
    if (autoScroll) autoScroll.capture();
    var changed = result.state.revision !== state.revision;
    if (result.state.screenId !== displayedScreenId || result.state.intervalMs !== state.intervalMs) rotationDueAt = 0;
    var focusDetail = document.activeElement && document.activeElement.getAttribute('data-open-detail');
    var scroll = {};
    function regionKey(element) {
      if (element.className === 'dashboard-blocks') return 'composition:' + displayedScreenId;
      var parent = element;
      while (parent && parent !== content) { if (parent.getAttribute && parent.getAttribute('data-block-id')) return parent.getAttribute('data-block-id') + ':' + element.getAttribute('aria-label'); parent = parent.parentNode; }
      return null;
    }
    each(content.querySelectorAll('.dashboard-blocks, .panel-content, .table-scroll, .host-card-grid, .availability-grid'), function (element) {
      var key = regionKey(element);
      if (key && element.offsetHeight) scroll[key] = { top: element.scrollTop, left: element.scrollLeft, focus: document.activeElement === element };
    });
    content.innerHTML = result.html;
    content.setAttribute('data-connection', content.querySelector('.is-stale') ? 'stale' : 'ready');
    if (focusDetail) each(content.querySelectorAll('[data-open-detail]'), function (element) { if (element.getAttribute('data-open-detail') === focusDetail) element.focus(); });
    var previousZoom = state.zoomPercent;
    state = result.state;
    if (state.zoomPercent !== previousZoom) document.documentElement.style.zoom = state.zoomPercent + '%';
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
    applyDensity();
    each(content.querySelectorAll('.dashboard-blocks, .panel-content, .table-scroll, .host-card-grid, .availability-grid'), function (element) {
      var previous = scroll[regionKey(element)];
      if (previous && element.offsetHeight) { element.scrollTop = previous.top; element.scrollLeft = previous.left; if (previous.focus) element.focus(); }
    });
    if (autoScroll) autoScroll.sync();
  }
  function changeView() {
    queryGeneration++; pending = null;
    if (activeRequest) { activeRequest.abort(); activeRequest = null; }
    updateControls(); applyDensity(); refresh();
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
    controlLabel('compat-tv', state.tv ? 'Sair do modo TV' : 'Modo TV');
    byId('compat-tv').setAttribute('aria-pressed', state.tv ? 'true' : 'false');
    controlLabel('compat-rotate', rotating ? 'Parar alternância' : 'Alternar telas');
    byId('compat-rotate').disabled = state.screens.length < 2;
    each(document.querySelectorAll('[data-layout]'), function (element) { element.setAttribute('aria-pressed', element.getAttribute('data-layout') === state.layout ? 'true' : 'false'); });
    var fullscreen = document.fullscreenElement || document.webkitFullscreenElement;
    controlLabel('compat-fullscreen', fullscreen ? 'Sair da tela cheia' : 'Tela cheia');
    controlLabel('compat-theme', state.theme === 'light' ? 'Tema claro' : 'Tema escuro');
    byId('compat-theme').setAttribute('aria-pressed', state.theme === 'light' ? 'true' : 'false');
  }
  // WebView 83 includes native density in computed root zoom. Only an explicit CSS declaration is user zoom.
  var viewportKey = '';
  function syncViewport() {
    var root = document.documentElement, viewport = byId('compat-viewport');
    var initialStyle = byId('compat-initial-zoom');
    if (initialStyle && initialStyle.textContent) initialStyle.textContent = '';
    var declared = root.style.zoom || (state.zoomPercent + '%'), zoom = parseFloat(declared);
    if (declared.indexOf('%') !== -1) zoom /= 100;
    if (!isFinite(zoom) || zoom <= 0) zoom = 1;
    var width = window.innerWidth || root.clientWidth, height = window.innerHeight || root.clientHeight;
    var key = width + ':' + height + ':' + zoom;
    if (viewportKey === key) return;
    viewportKey = key;
    if (width >= 761 && height >= 480 && zoom !== 1) {
      root.setAttribute('data-monitor-zoom', 'true');
      viewport.style.width = width / zoom + 'px';
      viewport.style.height = height / zoom + 'px';
      var nativeZoom = window.CSS && window.CSS.supports ? window.CSS.supports('zoom', '1') : 'zoom' in root.style;
      viewport.style.transform = nativeZoom ? '' : 'scale(' + zoom + ')';
      viewport.style.transformOrigin = nativeZoom ? '' : 'top left';
    } else {
      root.removeAttribute('data-monitor-zoom');
      viewport.style.width = ''; viewport.style.height = '';
      viewport.style.transform = ''; viewport.style.transformOrigin = '';
    }
  }
  function applyDensity() {
    syncViewport();
    each(content.querySelectorAll('.availability-grid[data-card-size="expanded"]'), function (grid) {
      var gap = Number(grid.getAttribute('data-card-gap')), minimum = Number(grid.getAttribute('data-card-width'));
      var columns = Math.max(1, Math.floor(grid.clientWidth / (minimum + gap)));
      if (grid.getAttribute('data-card-divided') === 'true') columns = Math.min(3, columns);
      each(grid.querySelectorAll('.card-wrap'), function (card) { card.style.width = 100 / columns + '%'; });
      grid.setAttribute('data-card-columns', String(columns));
    });
    each(content.querySelectorAll('.compat-row[data-measured-row]'), function (row) {
      var minimum = row.parentNode.children.length > 1 ? 0 : 210;
      var rowStyle = window.getComputedStyle(row);
      each(row.querySelectorAll('.availability-panel > .availability-grid'), function (grid) {
        var panel = grid.parentNode, border = window.getComputedStyle(panel);
        var height = parseFloat(rowStyle.paddingTop || 0) + parseFloat(rowStyle.paddingBottom || 0) + parseFloat(border.borderTopWidth || 0) + parseFloat(border.borderBottomWidth || 0);
        each(panel.children, function (child) {
          var spacing = window.getComputedStyle(child);
          height += Math.max(child.offsetHeight, parseFloat(spacing.height) || 0) + parseFloat(spacing.marginTop || 0) + parseFloat(spacing.marginBottom || 0);
        });
        minimum = Math.max(minimum, Math.ceil(height));
      });
      if ((' ' + row.className + ' ').indexOf(' content-sized ') === -1) {
        row.style.minHeight = minimum + 'px';
        if (row.parentNode.children.length > 1) row.style.height = minimum + 'px';
      }
    });
    each(content.querySelectorAll('.compat-row[data-custom-slot-row]'), function (row) {
      var minimum = 0, rowStyle = window.getComputedStyle(row);
      each(row.children, function (group) {
        var height = 0;
        each(group.children, function (wrapper) {
          var panel = wrapper.querySelector('.availability-panel'), panelHeight = 210;
          if (panel) {
            var border = window.getComputedStyle(panel);
            panelHeight = parseFloat(border.borderTopWidth || 0) + parseFloat(border.borderBottomWidth || 0);
            each(panel.children, function (child) {
              var spacing = window.getComputedStyle(child);
              panelHeight += Math.max(child.offsetHeight, parseFloat(spacing.height) || 0) + parseFloat(spacing.marginTop || 0) + parseFloat(spacing.marginBottom || 0);
            });
          }
          height += panelHeight;
        });
        minimum = Math.max(minimum, height + Math.max(0, group.children.length - 1) * 12);
      });
      minimum = Math.ceil(minimum + parseFloat(rowStyle.paddingTop || 0) + parseFloat(rowStyle.paddingBottom || 0));
      row.style.minHeight = minimum + 'px';
      if ((' ' + row.className + ' ').indexOf(' compat-slot-row-measured ') !== -1) row.style.height = minimum + 'px';
    });
  }
  function openModal(title, html, trigger, kind) {
    if (modal.hidden) {
      restoreFocus = trigger || document.activeElement;
      oldOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    text(byId('compat-modal-title'), title);
    modal.setAttribute('data-modal-kind', kind || 'details');
    byId('compat-modal-body').innerHTML = html;
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
    try { localStorage.setItem('softcom-pulse-theme', state.theme); } catch (_error) { void _error; /* Keep the document preference. */ }
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
    } catch (_error) { void _error; warning('O aplicativo não permitiu a tela cheia. O modo TV continua disponível.'); }
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
  document.addEventListener('fullscreenchange', function () { updateControls(); applyDensity(); });
  document.addEventListener('webkitfullscreenchange', function () { updateControls(); applyDensity(); });
  document.addEventListener('visibilitychange', function () { armRotation(); if (!document.hidden) { applyDensity(); refresh(); } });
  window.addEventListener('online', function () { refresh(); });
  window.addEventListener('pagehide', function () { stopped = true; queryGeneration++; pending = null; notificationGeneration++; notificationBusy = false; clearTimeout(pollTimer); clearTimeout(rotationTimer); clearInterval(clockTimer); if (activeRequest) { activeRequest.abort(); activeRequest = null; } });
  window.addEventListener('pageshow', function (event) { if (event.persisted) { stopped = false; cursor = null; clock(); applyDensity(); clockTimer = setInterval(clock, 1000); refresh(); pollNotifications(); armRotation(); } });

  var cursor = null, notificationBusy = false, notificationTimer, deliveryRevision = null, notificationGeneration = 0;
  var currentCounts = { unreadCount: 0, activeCount: 0 };
  function paintTabIcon() {
    var icon = byId('compat-tab-icon');
    if (icon && state.tabIcons) icon.href = document.hidden && currentCounts.activeCount > 0 && currentCounts.unreadCount > 0 ? state.tabIcons.alert : state.tabIcons.normal;
  }
  function notificationsLabel(data) {
    currentCounts = data.counts; paintTabIcon();
    var unread = Number(data.counts.unreadCount), count = byId('compat-count');
    unread = isFinite(unread) && unread > 0 ? Math.floor(unread) : 0;
    text(count, unread > 99 ? '99+' : unread); count.hidden = unread === 0;
    byId('compat-notifications').setAttribute('aria-label', 'Notificações: ' + data.counts.unreadCount + ' não lidas, ' + data.counts.activeCount + ' incidentes atuais');
    applyDensity();
  }
  var notificationView = 'unread', notificationSeverity = '', notificationFrom = '', notificationTo = '', listGeneration = 0;
  function notificationToday() {
    var date = new Date(Date.now() + offset - 3 * 3600000);
    function pad(value) { return value < 10 ? '0' + value : String(value); }
    return date.getUTCFullYear() + '-' + pad(date.getUTCMonth() + 1) + '-' + pad(date.getUTCDate());
  }
  function notificationDate(value) {
    var date = new Date(Date.parse(value) - 3 * 3600000);
    if (!isFinite(date.getTime())) return 'Sem horário disponível';
    return date.getUTCDate() + '/' + (date.getUTCMonth() + 1) + '/' + date.getUTCFullYear() + ' ' + date.getUTCHours() + ':' + ('0' + date.getUTCMinutes()).slice(-2);
  }
  function notificationList() {
    if (!notificationFrom) notificationFrom = notificationToday();
    openModal('Notificações', '<div class="notification-tabs" role="group" aria-label="Lista de notificações"></div><form class="notification-filters"><label>Severidade<select id="compat-severity"><option value="">Todas</option><option value="critical">Crítica</option><option value="warning">Atenção</option><option value="info">Informação</option></select></label><label id="compat-from-label">De<input id="compat-history-from" type="date" required></label><label id="compat-to-label">Até (opcional)<input id="compat-history-to" type="date"></label><button type="submit">Aplicar filtros</button></form><p id="compat-notification-error" class="notification-error" role="alert"></p><div id="compat-notification-list" aria-live="polite"></div><p class="muted">Histórico e leitura são compartilhados. Esta tela pública permite somente consulta.</p>', byId('compat-notifications'));
    var body = byId('compat-modal-body'), tabs = body.querySelector('.notification-tabs');
    each([['unread', 'Não lidas'], ['active', 'Incidentes atuais'], ['history', 'Histórico']], function (tab) {
      var button = document.createElement('button'); button.type = 'button'; text(button, tab[1]);
      button.setAttribute('aria-pressed', notificationView === tab[0] ? 'true' : 'false');
      button.addEventListener('click', function () { notificationView = tab[0]; notificationList(); }); tabs.appendChild(button);
    });
    byId('compat-severity').value = notificationSeverity;
    byId('compat-history-from').value = notificationFrom; byId('compat-history-to').value = notificationTo;
    byId('compat-history-from').max = notificationToday(); byId('compat-history-to').max = notificationToday();
    byId('compat-from-label').hidden = notificationView !== 'history'; byId('compat-to-label').hidden = notificationView !== 'history';
    byId('compat-history-from').required = notificationView === 'history';
    body.querySelector('form').addEventListener('submit', function (event) {
      event.preventDefault(); notificationSeverity = byId('compat-severity').value;
      notificationFrom = byId('compat-history-from').value; notificationTo = byId('compat-history-to').value;
      if (notificationView === 'history' && (!notificationFrom || notificationFrom > notificationToday() || notificationTo && (notificationTo > notificationToday() || notificationTo < notificationFrom))) {
        text(byId('compat-notification-error'), 'Confira o intervalo: data inicial obrigatória, sem datas futuras e final igual ou posterior à inicial.'); return;
      }
      loadNotificationPage(null, false);
    });
    loadNotificationPage(null, false);
  }
  function loadNotificationPage(cursor, append) {
    var generation = ++listGeneration, list = byId('compat-notification-list'), errorText = byId('compat-notification-error');
    if (!list) return;
    if (!append) text(list, 'Carregando notificações…');
    text(errorText, '');
    var path = '/monitor/compat/notifications' + (notificationView === 'active' ? '/incidents' : notificationView === 'history' ? '/history' : '');
    var query = '?limit=30' + (notificationView === 'unread' ? '&read=unread' : '');
    if (notificationView === 'history') query += '&from=' + encodeURIComponent(notificationFrom) + (notificationTo ? '&to=' + encodeURIComponent(notificationTo) : '');
    if (notificationSeverity) query += '&severity=' + notificationSeverity;
    if (cursor) query += '&cursor=' + encodeURIComponent(cursor);
    request(path + query, function (error, data) {
      if (generation !== listGeneration || modal.hidden || byId('compat-modal-title').textContent !== 'Notificações') return;
      if (error) { if (!append) text(list, ''); text(errorText, 'Não foi possível carregar as notificações. Confira os filtros e tente novamente.'); return; }
      notificationsLabel(data);
      if (!append) text(list, '');
      var entries = notificationView === 'active' ? data.incidents : data.events;
      each(entries || [], function (entry) {
        var article = document.createElement('article'), title = document.createElement('strong'), message = document.createElement('p'), meta = document.createElement('small');
        article.className = 'notification-entry'; text(title, entry.displayName);
        text(message, entry.message || state.messages[entry.messageCode] || 'Aviso de monitoramento');
        text(meta, notificationDate(entry.createdAt || entry.openedAt) + (entry.readAt ? ' · Lida' : notificationView === 'active' ? ' · Incidente atual' : ' · Não lida'));
        article.appendChild(title); article.appendChild(message); article.appendChild(meta); list.appendChild(article);
        var incidentId = notificationView === 'active' ? entry.id : entry.incidentId;
        if (incidentId) {
          var detail = document.createElement('button'); detail.type = 'button'; text(detail, 'Ver incidente');
          detail.addEventListener('click', function () { notificationIncident(incidentId); }); article.appendChild(detail);
        }
      });
      if (!append && (!entries || !entries.length)) { var empty = document.createElement('p'); text(empty, 'Nenhuma notificação neste filtro.'); list.appendChild(empty); }
      if (data.nextPageCursor) {
        var more = document.createElement('button'); more.type = 'button'; text(more, 'Carregar mais notificações');
        more.addEventListener('click', function () { more.parentNode.removeChild(more); loadNotificationPage(data.nextPageCursor, true); }); list.appendChild(more);
      }
    });
  }
  function notificationIncident(id) {
    var generation = ++listGeneration;
    text(byId('compat-modal-title'), 'Incidente');
    var body = byId('compat-modal-body'); text(body, 'Carregando incidente…');
    function load(cursor, append) {
      request('/monitor/compat/notifications/incidents/' + encodeURIComponent(id) + '?limit=30' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''), function (error, data) {
        if (generation !== listGeneration || modal.hidden) return;
        if (error) { text(body, 'Não foi possível carregar o incidente.'); return; }
        if (!append) {
          text(body, '');
          var title = document.createElement('h3'), message = document.createElement('p'), stateText = document.createElement('p');
          text(title, data.incident.displayName); text(message, data.incident.message);
          text(stateText, data.incident.status === 'active' ? 'Incidente atual' : data.incident.status === 'resolved' ? 'Resolvido' : 'Acompanhamento encerrado');
          body.appendChild(title); body.appendChild(message); body.appendChild(stateText);
          if (data.incident.metricContext) {
            var context = document.createElement('p'); text(context, 'Valor histórico · ' + data.incident.metricContext.coverage); body.appendChild(context);
          }
        }
        each(data.events || [], function (entry) { var event = document.createElement('p'); text(event, notificationDate(entry.createdAt) + ' · ' + entry.message + (entry.readAt ? ' · Lida' : ' · Não lida')); body.appendChild(event); });
        if (data.nextPageCursor) {
          var more = document.createElement('button'); more.type = 'button'; text(more, 'Mais eventos do incidente');
          more.addEventListener('click', function () { more.parentNode.removeChild(more); load(data.nextPageCursor, true); }); body.appendChild(more);
        }
      });
    }
    load(null, false);
  }
  byId('compat-notifications').addEventListener('click', notificationList);
  var seen = {}, seenIds = [], toastTimer, toastLeft = 0, toastSince = 0, visualTimer, lastVisual = 0, visibleEvents = [], visualGroups = [], visualRuntime = null;
  function hideToast() { if (visibleEvents.length) lastVisual = Date.now(); byId('compat-toast').hidden = true; visibleEvents = []; toastLeft = 0; clearTimeout(toastTimer); }
  function armToast() {
    clearTimeout(toastTimer);
    if (!visibleEvents.length || byId('compat-toast').contains(document.activeElement)) return;
    toastSince = Date.now();
    toastTimer = setTimeout(function () { hideToast(); flushVisuals(); }, toastLeft);
  }
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
    var targets = {}, count = 0;
    each(fresh, function (event) { if (!targets[event.targetRef]) { targets[event.targetRef] = true; count++; } });
    var message = fresh.length > 1 ? fresh.length + ' ocorrências em ' + count + (count === 1 ? ' serviço' : ' serviços') + ' · ' + first.displayName : first.displayName + ' · ' + (first.message || state.messages[first.messageCode] || 'Aviso de monitoramento');
    var tone = first.eventType === 'recovery' ? 'success' : first.severity === 'critical' ? 'error' : first.severity === 'warning' ? 'warning' : 'info';
    var split = message.indexOf(' · ');
    text(byId('compat-toast-title'), split < 0 ? message : message.slice(0, split));
    text(byId('compat-toast-detail'), split < 0 ? '' : message.slice(split + 3));
    byId('compat-toast-detail').hidden = split < 0;
    each(toast.querySelectorAll('[data-toast-glyph]'), function (glyph) { glyph.hidden = glyph.getAttribute('data-toast-glyph') !== tone; });
    toast.setAttribute('data-tone', tone);
    text(byId('compat-announcement'), message);
    toast.className = 'compat-toast toast-pill toast-operational ' + (visualRuntime.toastPosition === 'top-end' || visualRuntime.toastPosition === 'header-center' ? visualRuntime.toastPosition : 'bottom-end');
    toast.hidden = false; visibleEvents = fresh;
    toastLeft = visualRuntime.toastLifetimeMs; armToast();
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
      if (!seen[event.id] && event.announce && event.toastEligible && !event.readAt && active && read.indexOf(event.id) < 0 && now >= at && now - at <= Math.max(runtime.maxDeliveryAgeMs, 180000)) fresh.push(event);
      if (!seen[event.id]) { seen[event.id] = true; seenIds.push(event.id); }
    });
    if (seenIds.length > 5000) { each(seenIds.splice(0, seenIds.length - 2500), function (id) { delete seen[id]; }); }
    if (!runtime.enabled) { resetVisuals(); return; }
    fresh.sort(function (left, right) { var ranks = { critical: 3, warning: 2, info: 1 }; return ranks[right.severity] - ranks[left.severity]; });
    if (window.PulseCompatibleAudio) window.PulseCompatibleAudio.deliver(fresh, runtime.soundCooldownMs);
    fresh = fresh.filter(function (event) { return now - Date.parse(event.createdAt) <= runtime.maxDeliveryAgeMs && (event.eventType === 'recovery' || closed.indexOf(event.incidentId) < 0); });
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
      request('/monitor/compat/notifications?limit=1', function (error, data) {
        if (epoch !== notificationGeneration || stopped) return;
        if (!error && !stopped) { cursor = data.syncCursor; deliveryRevision = data.runtime.deliveryRevision; syncClock(data.serverTime); notificationsLabel(data); }
        done();
      });
      return;
    }
    var changes = [], latest = null, counts = null;
    function next() {
      request('/monitor/compat/notifications/changes?after=' + encodeURIComponent(cursor) + '&limit=200', function (error, data) {
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
  document.addEventListener('visibilitychange', function () { paintTabIcon(); if (document.hidden) resetVisuals(); });
  window.addEventListener('pagehide', function () { clearTimeout(notificationTimer); resetVisuals(); });
  byId('compat-toast-action').addEventListener('click', function () { hideToast(); flushVisuals(); notificationList(); });
  byId('compat-toast').addEventListener('focusin', function (event) {
    if (!this.contains(event.relatedTarget)) { toastLeft = Math.max(0, toastLeft - (Date.now() - toastSince)); clearTimeout(toastTimer); }
  });
  byId('compat-toast').addEventListener('focusout', function () { setTimeout(armToast, 0); });
  var audioInstalled = false, audioLoadTimer;
  function audioUnavailable() {
    if (audioInstalled) return;
    clearTimeout(audioLoadTimer);
    byId('compat-audio').setAttribute('aria-busy', 'false');
    byId('compat-audio').setAttribute('data-audio-state', 'unavailable');
    byId('compat-mute').setAttribute('aria-label', 'Som indisponível');
    byId('compat-mute').title = 'Não foi possível carregar o controle de áudio. Recarregue a página para tentar novamente.';
    byId('compat-volume-on').hidden = true; byId('compat-volume-off').hidden = false;
    text(byId('compat-audio-status'), 'Áudio indisponível'); byId('compat-audio-status').hidden = false;
    applyDensity();
  }
  function installAudioControls() {
    var audio = window.PulseCompatibleAudio;
    if (!audio) { audioUnavailable(); return; }
    if (audioInstalled) return;
    audioInstalled = true; clearTimeout(audioLoadTimer);
    var supported = audio.supported ? audio.supported() : !!(window.AudioContext || window.webkitAudioContext);
    var controls = byId('compat-audio'), mute = byId('compat-mute'), settings = byId('compat-sound-settings');
    controls.setAttribute('aria-busy', 'false');
    controls.setAttribute('data-audio-state', supported ? 'ready' : 'unsupported');
    mute.disabled = false; settings.disabled = false;
    text(byId('compat-audio-status'), supported ? '' : 'Sem suporte a áudio');
    byId('compat-audio-status').hidden = supported;
    function sync() {
      var volume = byId('compat-volume'), test = byId('compat-test-sound');
      var value = audio.volume(), percent = Math.round(value * 100), muted = audio.muted() || value === 0;
      mute.setAttribute('aria-label', muted ? 'Som mudo' : 'Som ativo');
      mute.title = muted ? 'Ativar som' : 'Silenciar som';
      mute.setAttribute('aria-pressed', muted ? 'true' : 'false');
      byId('compat-volume-on').hidden = muted; byId('compat-volume-off').hidden = !muted;
      if (volume) { volume.value = percent; volume.setAttribute('aria-valuetext', percent + '%'); }
      text(byId('compat-volume-value'), percent + '%');
      if (test) test.disabled = muted || !supported;
      text(modal.querySelector('.compat-sound-state'), muted ? 'Sons silenciados' : 'Sons ativados · Kobra Sound');
    }
    mute.addEventListener('click', function () { var enabled = audio.muted() || audio.volume() === 0; if (enabled && audio.volume() === 0) audio.setVolume(0.5); audio.setMuted(!enabled); sync(); });
    settings.addEventListener('click', function () {
      openModal('Sons da interface', byId('compat-audio-template').innerHTML, settings, 'sound');
      var volume = byId('compat-volume'), test = byId('compat-test-sound');
      function changeVolume() { audio.setVolume(Number(volume.value) / 100); sync(); }
      volume.addEventListener('input', changeVolume); volume.addEventListener('change', changeVolume);
      test.addEventListener('click', function () { audio.test(function (started) { text(modal.querySelector('.compat-sound-state'), started ? 'Som de teste iniciado.' : 'O navegador não permitiu iniciar o som.'); }); });
      sync();
    });
    function prepareAudio(event) { if (event.isTrusted) audio.prepare(); }
    document.addEventListener('click', prepareAudio, true); document.addEventListener('keydown', prepareAudio, true);
    window.addEventListener('storage', sync);
    if (supported && !audio.muted() && audio.volume() > 0) audio.prepare();
    sync(); applyDensity();
  }
  var audioScript = document.createElement('script'); audioScript.src = state.audioAdapterUrl;
  audioScript.onload = installAudioControls; audioScript.onerror = audioUnavailable;
  audioLoadTimer = setTimeout(audioUnavailable, 8000);
  document.head.appendChild(audioScript);
  updateControls(); clock(); applyDensity(); armRotation();
  if (window.PulseMonitorAutoScroll) {
    var scrollPaused = state.autoScrollOnLoad === false, scrollButton = byId('compat-auto-scroll');
    autoScroll = window.PulseMonitorAutoScroll.attach(content, { paused: scrollPaused });
    function updateScrollControl() {
      scrollButton.disabled = false;
      scrollButton.setAttribute('aria-pressed', String(scrollPaused));
      scrollButton.setAttribute('aria-label', scrollPaused ? 'Retomar rolagem automática' : 'Pausar rolagem automática');
    }
    scrollButton.addEventListener('click', function () { scrollPaused = !scrollPaused; autoScroll.setPaused(scrollPaused); updateScrollControl(); });
    updateScrollControl();
  }
  window.addEventListener('resize', applyDensity);
  window.addEventListener('orientationchange', applyDensity);
  if (window.MutationObserver) {
    var viewportObserver = new window.MutationObserver(applyDensity);
    viewportObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
  }
  content.setAttribute('data-monitor-controller', 'ready');
  clockTimer = setInterval(clock, 1000);
  pollTimer = setTimeout(refresh, state.refreshAfterMs);
  pollNotifications();
}());
