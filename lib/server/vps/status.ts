const units: Record<string, number> = { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3, tb: 1024 ** 4 };

function record(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}
function field(source: Record<string, unknown> | null, name: string) {
  if (!source) return undefined;
  const match = Object.keys(source).find(key => key.toLowerCase() === name);
  return match ? source[match] : undefined;
}
export function parsePercent(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const match = value.trim().replace(",", ".").match(/^(-?\d+(?:\.\d+)?)\s*%?$/);
  if (!match) return null;
  const number = Number(match[1]);
  return Number.isFinite(number) ? number : null;
}
function storedPercent(value: number | null) {
  if (value === null || value < 0 || value > 9999.99) return null;
  return Math.round(value * 100) / 100;
}
export function parseByteSize(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return { bytes: value, text: String(value) };
  if (typeof value !== "string") return null;
  const match = value.trim().replace(",", ".").match(/^(\d+(?:\.\d+)?)\s*([a-z]+)?$/i);
  if (!match) return null;
  const scale = units[(match[2] ?? "b").toLowerCase()];
  if (!scale) return null;
  const bytes = Number(match[1]) * scale;
  return Number.isFinite(bytes) ? { bytes, text: value.trim() } : null;
}
function text(value: unknown, max = 120) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const clean = String(value).trim();
  return clean && clean.length <= max && !/[\u0000-\u001F\u007F]/.test(clean) ? clean : null;
}

export type MonitorReading = {
  usable: boolean;
  cpuPercent: number | null;
  memoryPercent: number | null;
  diskPercent: number | null;
  cpu: { cores: number | null; speed: string | null; coresLoad: { core: string; load: number | null }[] };
  memory: { total: string | null; used: string | null; free: string | null };
  disks: { device: string | null; type: string | null; mount: string | null; size: string | null; used: string | null; available: string | null; use: number | null }[];
};

export function parseMonitorStatus(body: string): MonitorReading {
  const empty: MonitorReading = {
    usable: false, cpuPercent: null, memoryPercent: null, diskPercent: null,
    cpu: { cores: null, speed: null, coresLoad: [] }, memory: { total: null, used: null, free: null }, disks: [],
  };
  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { return empty; }
  const root = record(parsed);
  const cpu = record(field(root, "cpu"));
  const memory = record(field(root, "memory"));
  const cpuPercent = storedPercent(parsePercent(field(cpu, "load")));
  const cores = field(cpu, "cores");
  const coresLoad = Array.isArray(field(cpu, "coresload")) ? field(cpu, "coresload") as unknown[] : [];
  const total = parseByteSize(field(memory, "total"));
  const used = parseByteSize(field(memory, "used"));
  const free = parseByteSize(field(memory, "free"));
  const memoryPercent = total && used && total.bytes > 0 ? storedPercent(used.bytes / total.bytes * 100) : null;
  const disks = (Array.isArray(field(root, "disks")) ? field(root, "disks") as unknown[] : []).flatMap(item => {
    const disk = record(item);
    if (!disk) return [];
    return [{
      device: text(field(disk, "device")), type: text(field(disk, "type")), mount: text(field(disk, "mount"), 255),
      size: parseByteSize(field(disk, "size"))?.text ?? null, used: parseByteSize(field(disk, "used"))?.text ?? null,
      available: parseByteSize(field(disk, "available"))?.text ?? null, use: storedPercent(parsePercent(field(disk, "use"))),
    }];
  });
  const uses = disks.flatMap(disk => disk.use === null ? [] : [disk.use]);
  const reading: MonitorReading = {
    usable: cpuPercent !== null || memoryPercent !== null || uses.length > 0,
    cpuPercent, memoryPercent, diskPercent: uses.length ? Math.max(...uses) : null,
    cpu: { cores: typeof cores === "number" && Number.isInteger(cores) && cores >= 0 ? cores : null, speed: text(field(cpu, "speed")), coresLoad: coresLoad.flatMap(item => {
      const core = record(item);
      const name = text(field(core, "core"), 40);
      return name ? [{ core: name, load: storedPercent(parsePercent(field(core, "load"))) }] : [];
    }) },
    memory: { total: total?.text ?? null, used: used?.text ?? null, free: free?.text ?? null },
    disks,
  };
  return reading;
}
