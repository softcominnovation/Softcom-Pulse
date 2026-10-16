import "server-only";

export function normalizePublicHost(value: string) {
  let host = value.trim().toLowerCase();
  host = host.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  host = host.split("/")[0] ?? "";
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    return end === -1 ? "" : host.slice(1, end);
  }
  return host.replace(/:\d+$/, "");
}

export function publicHosts(value = process.env.PULSE_PUBLIC_HOSTS) {
  const effective = !value?.trim() && process.env.PULSE_DEMO_MODE === "1" && process.env.PULSE_E2E !== "1"
    ? "localhost,127.0.0.1"
    : value;
  if (!effective?.trim()) return new Set<string>();
  return new Set(effective.split(",").map(normalizePublicHost).filter(Boolean));
}

export function requestHostname(request: Request) {
  return normalizePublicHost(request.headers.get("host") ?? "");
}

export function isPublicHost(request: Request, value = process.env.PULSE_PUBLIC_HOSTS) {
  const hostname = requestHostname(request);
  if (!hostname) return false;
  return publicHosts(value).has(hostname);
}
