// Evaluate inside the browser. A short slot must keep one scroll surface without
// imposing its content height on the dashboard or making the last volume unreachable.
export const storageScrollSurface = '.storage-panel[data-storage-scroll="body"] > .storage-body, .storage-panel[data-storage-scroll="volumes"] .storage-volumes';

export function storageScrollGeometry(panel) {
  const body = panel.querySelector('.storage-body'), table = panel.querySelector('.storage-volumes');
  const compact = panel.getAttribute('data-storage-scroll') === 'body';
  const surface = compact ? body : table, bounds = body.getBoundingClientRect();
  const scrolling = [panel, body, table].filter(node => /auto|scroll/.test(getComputedStyle(node).overflowY));
  return {
    singleScroll: scrolling.length === 1 && scrolling[0] === surface && surface.clientHeight > 0,
    contentFits: compact
      ? getComputedStyle(table).overflowY === 'visible' && table.clientHeight >= table.scrollHeight - 1
      : table.querySelector('tbody tr').getBoundingClientRect().bottom <= table.getBoundingClientRect().bottom + 1
        && [...body.children].filter(node => node !== table).every(node => { const box = node.getBoundingClientRect(); return box.top >= bounds.top - 1 && box.bottom <= bounds.bottom + 1; }),
    noPageOverflow: document.documentElement.scrollWidth <= innerWidth + 1,
  };
}
