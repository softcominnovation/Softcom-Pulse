const control = /[\u0000-\u001F\u007F]/;
const taskSuffix = /\.\d+\.[A-Za-z0-9]+$/;

/** Suggest the stable service name. Strips one leading slash and a final `.<slot>.<task>` only. */
export function suggestServicePrefix(name: string) {
  const bare = name.trim().replace(/^\//, "");
  const match = bare.match(/^(.*)\.\d+\.[A-Za-z0-9]+$/);
  return match?.[1] && !match[1].endsWith(".") ? match[1] : bare;
}

/** Banco matches a postgres service name. Redis matches redis. Anything else is not a data service. */
export function serviceCandidateKind(prefix: string): "database" | "redis" | null {
  const parts = prefix.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const postgres = parts.includes("postgres") || parts.includes("pgsql");
  const redis = parts.includes("redis");
  if (postgres === redis) return null;
  return postgres ? "database" : "redis";
}

export function servicePrefixError(value: string) {
  const prefix = value.trim();
  if (!prefix || prefix.length > 200) return "Informe o nome do serviço, sem o id da task.";
  if (control.test(prefix) || prefix.startsWith("/") || prefix.endsWith(".")) return "Informe o nome do serviço, sem o id da task.";
  if (taskSuffix.test(prefix)) return "Use o nome do serviço, sem o sufixo da task.";
  return null;
}
