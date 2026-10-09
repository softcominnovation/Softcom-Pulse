export function isPublicPath(path: string) {
  return path === "/monitor" || path.startsWith("/monitor/") || path === "/exibicao" || path.startsWith("/exibicao/");
}

export function toPublicHref(path: string) {
  if (path.startsWith("/asgard") || path.startsWith("/admin/configuracoes") || path.startsWith("/login")) return null;
  if (path === "/") return "/monitor";
  if (path.startsWith("/admin/vps")) return `/monitor/vps${path.slice("/admin/vps".length)}`;
  if (path.startsWith("/admin/aplicacoes")) return `/monitor/aplicacoes${path.slice("/admin/aplicacoes".length)}`;
  if (path.startsWith("/admin/recursos")) return `/monitor/recursos${path.slice("/admin/recursos".length)}`;
  if (path.startsWith("/monitor")) return path;
  if (path.startsWith("/exibicao")) return `/monitor${path.slice("/exibicao".length)}`;
  return `/monitor${path.startsWith("/") ? path : `/${path}`}`;
}
