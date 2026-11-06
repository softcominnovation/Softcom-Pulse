/** Logical pixels, before route zoom. Reserve fixed readings plus one accessible table row. */
export function storagePanelMinimum(panel: HTMLElement): number {
  // Measure the selected font, without reserving space for an unselected maximum.
  const spacing = (element: Element) => {
    const style = getComputedStyle(element);
    return (parseFloat(style.marginTop) || 0) + (parseFloat(style.marginBottom) || 0);
  };
  const edges = (element: Element) => {
    const style = getComputedStyle(element);
    return [style.paddingTop, style.paddingBottom, style.borderTopWidth, style.borderBottomWidth].reduce((sum, value) => sum + (parseFloat(value) || 0), 0);
  };
  return Math.ceil(edges(panel) + [...panel.children].reduce((total, child) => {
    if (!child.classList.contains("storage-body")) return total + (child as HTMLElement).offsetHeight + spacing(child);
    return total + edges(child) + spacing(child) + [...child.children].reduce((height, section) => {
      if (!section.classList.contains("storage-volumes")) return height + (section as HTMLElement).offsetHeight + spacing(section);
      const head = section.querySelector<HTMLElement>("thead"), row = section.querySelector<HTMLElement>("tbody tr");
      const scrollbar = section.scrollWidth > section.clientWidth + 1 ? 18 : 0;
      return height + (head?.offsetHeight ?? 0) + (row?.offsetHeight ?? 0) + scrollbar + edges(section) + spacing(section) + 2;
    }, 0);
  }, 0));
}
