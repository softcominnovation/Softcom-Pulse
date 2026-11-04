const icon = (extra = "") =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="9" fill="#171717"/><path d="M4 16h5l3-8 6 16 3-8h7" stroke="white" stroke-width="2" fill="none"/>${extra}</svg>`)}`;

export const pulseTabIcon = icon();
export const pulseAlertTabIcon = icon(`<circle cx="25" cy="8" r="7" fill="#dc2626" stroke="#171717" stroke-width="1.5"/><path d="M22.2 5.2 27.8 10.8M27.8 5.2 22.2 10.8" stroke="white" stroke-width="1.8" stroke-linecap="round"/>`);

export function tabProblemVisible(hidden: boolean, activeCount: number, unreadCount: number) {
  return hidden && activeCount > 0 && unreadCount > 0;
}

export function setTabProblemIcon(problem: boolean) {
  if (typeof document === "undefined" || !document.head) return;
  const href = problem ? pulseAlertTabIcon : pulseTabIcon;
  const links = [...document.querySelectorAll<HTMLLinkElement>('link[rel="icon"]')];
  if (!links.length) {
    const link = document.createElement("link");
    link.rel = "icon";
    document.head.append(link);
    links.push(link);
  }
  // Next/React owns the metadata nodes. Removing or replacing them breaks
  // the next client navigation when React releases its hoisted <link>.
  for (const link of links) {
    if (link.getAttribute("href") !== href) link.setAttribute("href", href);
    if (link.getAttribute("type") !== "image/svg+xml") link.setAttribute("type", "image/svg+xml");
  }
}
