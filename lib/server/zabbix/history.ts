import "server-only";
import { z } from "zod";
import { type History, type ReadResult } from "../../monitoring/contracts.ts";
import { type Binding, type SourceBindings } from "./bindings.ts";
import { zabbixCall } from "./client.ts";
import type { Rpc } from "./types.ts";
import { BffError } from "../bff.ts";

const rowSchema = z.object({ itemid: z.string(), clock: z.string(), ns: z.string().optional(), value: z.string().optional(), value_avg: z.string().optional(), value_min: z.string().optional(), value_max: z.string().optional(), num: z.string().optional() });
type Row = z.infer<typeof rowSchema>;
const iso = (clock: number) => new Date(clock * 1000).toISOString();
const duration = { "1h": 3600, "24h": 86400, "7d": 604800 };

async function fetchRows(rpc: Rpc, bindings: Binding[], source: "history" | "trends", from: number, till: number, signal: AbortSignal) {
  if (!bindings.length) return { rows: [] as Row[], limited: false };
  const rows: Row[] = [], ids = new Set(bindings.map(b => b.itemid));
  const limit = source === "trends" ? 50000 : 5000;
  let end = till, limited = false;
  const seen = new Set<string>();
  for (let page = 0; page < 10; page++) {
    const params = { itemids: [...ids], time_from: from, time_till: end, limit, output: source === "history" ? ["itemid", "clock", "ns", "value"] : ["itemid", "clock", "num", "value_min", "value_avg", "value_max"], ...(source === "history" ? { history: Number(bindings[0].valueType), sortfield: ["clock", "ns"], sortorder: "DESC" } : {}) };
    const parsed = z.array(rowSchema).safeParse(await rpc(source === "history" ? "history.get" : "trend.get", params, signal));
    if (!parsed.success) throw new BffError(503, "zabbix_history_invalid");
    const result = parsed.data;
    if (result.some(row => !ids.has(row.itemid) || !Number.isFinite(Number(row.clock)))) throw new BffError(503, "zabbix_history_invalid");
    for (const row of result) { const key = `${row.itemid}:${row.clock}:${row.ns ?? "0"}`; if (!seen.has(key)) { rows.push(row); seen.add(key); } }
    if (result.length < limit) break;
    if (source === "trends") { limited = true; break; }
    const oldest = result.reduce((oldest, row) => Math.min(oldest, Number(row.clock)), till);
    if (oldest >= end || page === 9) { limited = true; break; }
    end = oldest;
  }
  return { rows, limited };
}
export function numericSeries(binding: Binding, rows: Row[], from: number, till: number, trends: boolean): History["series"][number] {
  const step = trends ? 3600 : Math.max(1, Math.ceil((till - from) / 998));
  const start = trends ? Math.floor(from / step) * step : from;
  const buckets = new Map<number, { value: number; min: number; max: number; clock: number }[]>();
  for (const row of rows) {
    const clock = Number(row.clock), raw = trends ? row.value_avg : row.value;
    if (clock < start || clock > till || raw === undefined || !raw.trim() || !Number.isFinite(Number(raw))) continue;
    const value = Number(raw) * binding.scale + binding.offset;
    const bounds = [Number(row.value_min ?? raw) * binding.scale + binding.offset, Number(row.value_max ?? raw) * binding.scale + binding.offset];
    const slot = Math.floor((clock - start) / step);
    buckets.set(slot, [...(buckets.get(slot) ?? []), { value, min: Math.min(...bounds), max: Math.max(...bounds), clock }]);
  }
  const points = [];
  let previous: { value: number; min: number; max: number; clock: number } | undefined;
  for (let i = 0; i <= Math.floor((till - start) / step) && points.length < 1000; i++) {
    const bucket = buckets.get(i)?.sort((a, b) => a.clock - b.clock);
    previous = bucket?.at(-1) ?? previous;
    const held = !trends && previous && start + i * step - previous.clock <= binding.maxGapSeconds ? previous : undefined;
    points.push({ timestamp: iso(Math.max(from, start + i * step)), value: bucket?.at(-1)?.value ?? held?.value ?? null, min: bucket ? Math.min(...bucket.map(p => p.min)) : held?.min ?? null, max: bucket ? Math.max(...bucket.map(p => p.max)) : held?.max ?? null });
  }
  return { key: binding.key, unit: binding.unit, aggregation: trends ? "hourly_average" : "last_min_max", points };
}
const health = { "1": "starting", "2": "unhealthy", "3": "healthy", "4": "not_configured" } as Record<string, string>;
function discreteValue(binding: Binding, value?: string) {
  if (binding.kind === "health") return health[value ?? ""] ?? "unknown";
  if (value === "exited") return "stopped";
  return ["running", "stopped", "paused", "restarting", "created", "removing", "dead"].includes(value ?? "") ? value! : "unknown";
}
export function discreteSeries(binding: Binding, rows: Row[], from: number, till: number, limited: boolean, proofRows: Row[] = []): NonNullable<History["states"]>[number] {
  const sorted = rows.filter(row => Number(row.clock) <= till).sort((a, b) => Number(a.clock) - Number(b.clock) || Number(a.ns ?? 0) - Number(b.ns ?? 0));
  const segments: { from: number; to: number; state: string; observedAt: string | null }[] = [];
  let cursor = from;
  for (let i = 0; i < sorted.length; i++) {
    const clock = Number(sorted[i].clock), next = Number(sorted[i + 1]?.clock ?? till), end = Math.min(till, next, clock + binding.maxGapSeconds);
    if (end <= from || clock >= till) continue;
    if (Math.max(from, clock) > cursor) segments.push({ from: cursor, to: Math.min(till, clock), state: "unknown", observedAt: null });
    if (end > Math.max(from, clock)) { segments.push({ from: Math.max(from, clock), to: end, state: discreteValue(binding, sorted[i].value), observedAt: iso(clock) }); cursor = end; }
  }
  if (cursor < till) segments.push({ from: cursor, to: till, state: "unknown", observedAt: null });
  let evidenced = segments;
  if (binding.proof) {
    const coverage: { from: number; to: number }[] = [];
    for (const row of [...proofRows].sort((a, b) => Number(a.clock) - Number(b.clock))) {
      const interval = { from: Number(row.clock), to: Number(row.clock) + binding.proof.maxGapSeconds };
      const previous = coverage.at(-1);
      if (previous && previous.to >= interval.from) previous.to = Math.max(previous.to, interval.to); else coverage.push(interval);
    }
    evidenced = segments.flatMap(segment => {
      const pieces = []; let position = segment.from;
      for (const interval of coverage) {
        const start = Math.max(segment.from, interval.from), end = Math.min(segment.to, interval.to);
        if (end <= start) continue;
        if (start > position) pieces.push({ from: position, to: start, state: "unknown", observedAt: null });
        pieces.push({ ...segment, from: start, to: end }); position = end;
      }
      if (position < segment.to) pieces.push({ from: position, to: segment.to, state: "unknown", observedAt: null });
      return pieces;
    });
  }
  const severity: Record<string, number> = { unhealthy: 9, dead: 9, stopped: 8, restarting: 7, paused: 7, starting: 6, removing: 6, created: 6, unknown: 5, not_configured: 1, running: 0, healthy: 0 };
  let output = evidenced;
  if (evidenced.length > 1000) {
    output = [];
    const width = (till - from) / 1000;
    for (let i = 0; i < 1000; i++) {
      const start = from + i * width, end = from + (i + 1) * width;
      const candidates = evidenced.filter(segment => segment.from < end && segment.to > start).sort((a, b) => (severity[b.state] ?? 5) - (severity[a.state] ?? 5));
      output.push({ from: start, to: end, state: candidates[0]?.state ?? "unknown", observedAt: candidates[0]?.observedAt ?? null });
    }
  }
  return { key: binding.kind as "status" | "health", aggregation: "worst_state", coverageLimited: limited || output.some(s => s.state === "unknown"), segments: output.map(segment => ({ ...segment, from: iso(segment.from), to: iso(segment.to) })) };
}
export async function queryHistory(resource: History["resource"], window: History["window"], source: SourceBindings[string] | undefined, options: { rpc?: Rpc; signal?: AbortSignal; now?: number; stale?: boolean } = {}): Promise<ReadResult<History>> {
  const till = Math.floor((options.now ?? Date.now()) / 1000), from = till - duration[window], trends = window === "7d";
  const base: History = { resource, window, source: trends ? "trends" : "history", series: [], states: [], coverageLimited: true, ...(source ? { technicalReference: source.identity } : {}) };
  if (!source?.bindings.length) return { data: base, availability: "no_data", stale: !!options.stale, lastUpdated: null, refreshAfterMs: 60000 };
  const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(25000)]) : AbortSignal.timeout(25000);
  const rpc = options.rpc ?? zabbixCall;
  const bindings = source.bindings.filter(b => b.quality !== "unsupported");
  const proofs: Binding[] = bindings.flatMap(b => b.proof ? [{ ...b, ...b.proof, key: "evidence", kind: "status" as const, proof: undefined }] : []);
  const groups = new Map<string, Binding[]>();
  for (const b of [...bindings, ...proofs]) { const key = (b.kind === "numeric" && trends ? "trends" : "history") + ":" + b.valueType; groups.set(key, [...(groups.get(key) ?? []), b]); }
  const allRows: (Row & { source: "history" | "trends" })[] = []; let limited = false;
  for (const [key, group] of groups) {
    const sourceType: "trends" | "history" = key.startsWith("trends") ? "trends" : "history";
    const lookback = group.some(b => b.kind !== "numeric") ? Math.min(86400, Math.max(...group.map(b => b.maxGapSeconds))) : 0;
    const result = await fetchRows(rpc, group, sourceType, from - lookback, till, signal);
    allRows.push(...result.rows.map(row => ({ ...row, source: sourceType }))); limited ||= result.limited;
  }
  const series = bindings.filter(b => b.kind === "numeric").map(b => numericSeries(b, allRows.filter(row => row.itemid === b.itemid && row.source === (trends ? "trends" : "history")), from, till, trends));
  const states = bindings.filter(b => b.kind !== "numeric").map(b => discreteSeries(b, allRows.filter(row => row.itemid === b.itemid && row.source === "history"), from, till, limited, allRows.filter(row => row.itemid === b.proof?.itemid && row.source === "history")));
  const observed = allRows.map(r => Number(r.clock)).filter(Number.isFinite);
  return { data: { ...base, series, states, coverageLimited: limited || states.some(s => s.coverageLimited) || series.some(s => s.points.some(p => p.value === null)) }, availability: observed.length ? "ready" : "no_data", stale: !!options.stale, lastUpdated: observed.length ? iso(observed.reduce((latest, clock) => Math.max(latest, clock), 0)) : null, refreshAfterMs: 60000 };
}
