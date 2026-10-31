(function () {
  if (window.location.pathname.replace(/\/$/, '') !== '/monitor') return;
  var supported = false;
  try {
    supported = !!(window.fetch && window.AbortController && window.ResizeObserver && window.CSS && window.CSS.supports('color', 'oklch(0.5 0 0)'));
    if (supported) new Function('var value; value ??= 1; class Capability { static { this.value = 1; } }');
  } catch (_error) { void _error; supported = false; }
  if (!supported && !/(?:^|[?&])compat=[01](?:&|$)/.test(window.location.search)) {
    window.location.replace(window.location.pathname + (window.location.search ? window.location.search + '&' : '?') + 'compat=1' + window.location.hash);
  }
}());
