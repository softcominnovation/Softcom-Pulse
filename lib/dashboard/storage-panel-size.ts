import { monitorFontScaleOptions } from "../config/presentation.ts";

/** Logical pixels, before route zoom. Reserve fixed readings plus one accessible table row. */
export function storagePanelMinimum(panel: HTMLElement): number {
  const block = panel.closest<HTMLElement>("[data-monitor-font-scale]");
  const originalScale = block?.style.getPropertyValue("--monitor-font-scale") ?? "";
  const originalPriority = block?.style.getPropertyPriority("--monitor-font-scale") ?? "";
  // A font preference must not resize its slot or adjacent panels. Measure the
  // supported font envelope synchronously, then restore before the next paint.
  // The private root has no monitor scope and keeps its existing measurements.
  if (block) block.style.setProperty("--monitor-font-scale", String(monitorFontScaleOptions.at(-1)! / 100));
  try {
    return measureStoragePanel(panel);
  } finally {
    if (block) {
      if (originalScale) block.style.setProperty("--monitor-font-scale", originalScale, originalPriority);
      else block.style.removeProperty("--monitor-font-scale");
    }
  }
}

function measureStoragePanel(panel: HTMLElement): number {
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
