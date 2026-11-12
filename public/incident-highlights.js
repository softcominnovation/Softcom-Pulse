/* One reducer for React and the standalone TV monitor. Keep this file ES5. */
(function (scope) {
  'use strict';
  function create(paint, wasVisible) {
    var incidents = Object.create(null), recovered = Object.create(null), timer;
    function publish() {
      clearTimeout(timer);
      var states = Object.create(null), now = Date.now(), next = Infinity;
      Object.keys(recovered).forEach(function (ref) {
        if (recovered[ref] <= now) delete recovered[ref];
        else { states[ref] = 'recovered'; next = Math.min(next, recovered[ref]); }
      });
      Object.keys(incidents).forEach(function (id) { states[incidents[id]] = 'error'; });
      if (next !== Infinity) timer = setTimeout(publish, next - now);
      paint(states);
    }
    return {
      replace: function (rows) {
        incidents = Object.create(null);
        recovered = Object.create(null);
        rows.forEach(function (row) { incidents[row.incidentId] = row.targetRef; });
        publish();
      },
      apply: function (changes, serverTime, maxAge) {
        var endings = Object.create(null), changed = false;
        changes.forEach(function (change) {
          var item = change.payload.incident;
          if (!item) return;
          var ref = item.targetRef;
          if (change.payload.highlighted && item.status === 'active') {
            if (incidents[item.id] === ref) return;
            incidents[item.id] = ref;
            delete recovered[ref];
          } else if (incidents[item.id]) {
            delete incidents[item.id];
            var age = serverTime - Date.parse(item.closedAt);
            endings[ref] = item.status === 'resolved' && !item.dismissedAt && age >= 0 && age <= maxAge;
          } else return;
          changed = true;
        });
        if (!changed) return;
        Object.keys(incidents).forEach(function (id) { delete endings[incidents[id]]; });
        Object.keys(endings).forEach(function (ref) {
          if (endings[ref] && wasVisible(ref)) recovered[ref] = Date.now() + 5000;
        });
        publish();
      },
      dispose: function () { clearTimeout(timer); }
    };
  }
  function wasVisible(ref) {
    if (document.hidden) return false;
    var nodes = document.querySelectorAll('[data-incident-state="error"]');
    for (var index = 0; index < nodes.length; index++) {
      if (nodes[index].getAttribute('data-incident-target') === ref && nodes[index].getClientRects().length) return true;
    }
    return false;
  }
  scope.PulseIncidentHighlights = { create: create, wasVisible: wasVisible };
}(typeof window !== 'undefined' ? window : globalThis));
