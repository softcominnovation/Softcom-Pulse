import "server-only";
import { createHash } from "node:crypto";
import type { Metric } from "../../monitoring/contracts.ts";
import type { Item } from "./types.ts";

export function opaqueReference(kind: string, ...parts: string[]) { return kind + "-" + createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 32); }
export function seconds(value: string): number | null {
  const match = /^(\d+)([smhdw]?)$/.exec(value);
  if (!match) return null;
  const result = Number(match[1]) * ({ s: 1, m: 60, h: 3600, d: 86400, w: 604800, "": 1 }[match[2]] ?? 1);
  return result > 0 ? result : null;
}
export function keyParts(key: string): { base: string; args: string[] } {
  const start = key.indexOf("[");
  if (start < 0) return { base: key, args: [] };
  const input = key.slice(start + 1, -1), args: string[] = [];
  let value = "", quoted = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (c === "\\" && quoted && input[i + 1] === '"') { value += '"'; i++; }
    else if (c === '"') quoted = !quoted;
    else if (c === "," && !quoted) { args.push(value); value = ""; }
    else value += c;
  }
  args.push(value);
  return { base: key.slice(0, start), args };
}
export function observationContext(items: Item[], now = Date.now()) {
  const byId = new Map(items.map(item => [item.itemid, item]));
  function cadence(item: Item, visited = new Set<string>()): number | null {
    if (visited.has(item.itemid)) return null;
    visited.add(item.itemid);
    return seconds(item.delay) ?? (byId.has(item.master_itemid) ? cadence(byId.get(item.master_itemid)!, visited) : null);
  }
  function sampleDeadline(item: Item): number {
    const clock = Number(item.lastclock), interval = cadence(item);
    const throttle = item.preprocessing.find(p => p.type === "20");
    const heartbeat = throttle ? seconds(throttle.params) : 0;
    if (!interval || !Number.isFinite(clock) || clock <= 0 || clock * 1000 > now + 60000 || heartbeat === null) return 0;
    if (item.preprocessing.some(p => p.type === "19") && !heartbeat && item.master_itemid === "0") return 0;
    return clock + heartbeat + Math.max(120, interval * 3 + 30);
  }
  const siblings = new Map<string, number>();
  for (const item of items) {
    const master = byId.get(item.master_itemid);
    if (master?.hostid === item.hostid && item.status === "0" && item.state === "0" && item.itemDiscovery?.status !== "1") {
      siblings.set(master.itemid, Math.max(siblings.get(master.itemid) ?? 0, sampleDeadline(item)));
    }
  }
  function evidence(item?: Item): { quality: Metric["quality"]; observedAt: string | null; validUntil: string | null; maxGapSeconds: number } {
    if (!item) return { quality: "missing", observedAt: null, validUntil: null, maxGapSeconds: 60 };
    const clock = Number(item.lastclock), observedAt = clock > 0 && Number.isFinite(clock) ? new Date(clock * 1000).toISOString() : null;
    const interval = cadence(item);
    const heartbeat = seconds(item.preprocessing.find(p => p.type === "20")?.params ?? "");
    const discards = item.preprocessing.some(p => p.type === "19" || p.type === "20");
    const maxGapSeconds = Math.max(60, (interval ?? 30) * 2 + 15, (heartbeat ?? 0) + (interval ?? 30) * 2);
    let expires = sampleDeadline(item);
    let unsupported = item.state !== "0" || item.status !== "0" || item.itemDiscovery?.status === "1";
    const visited = new Set<string>();
    let child = item;
    while (child.master_itemid !== "0") {
      const master = byId.get(child.master_itemid);
      if (!master || master.hostid !== item.hostid || visited.has(master.itemid)) { expires = 0; break; }
      visited.add(child.master_itemid);
      unsupported ||= master.state !== "0" || master.status !== "0" || master.itemDiscovery?.status === "1";
      // Masters with history disabled have lastclock=0; a supported sibling proves that the same master delivered a sample.
      // Preserve that sibling's heartbeat window instead of treating its stored clock as an unthrottled master sample.
      expires = Math.min(expires, Math.max(sampleDeadline(master), siblings.get(master.itemid) ?? 0));
      child = master;
    }
    if (discards && !heartbeat && item.master_itemid === "0") expires = 0;
    const validUntil = expires > 0 ? new Date(expires * 1000).toISOString() : null;
    const quality = unsupported ? "unsupported" : !observedAt ? "missing" : !interval || !validUntil || now > expires * 1000 || clock * 1000 > now + 60000 ? "stale" : "fresh";
    return { quality, observedAt, validUntil, maxGapSeconds };
  }
  function historyProof(item: Item) {
    if (!item.preprocessing.some(p => p.type === "19" || p.type === "20") || item.master_itemid === "0") return undefined;
    const proof = items.find(candidate => candidate.itemid !== item.itemid && candidate.master_itemid === item.master_itemid && ["0", "3"].includes(candidate.value_type) && candidate.state === "0" && candidate.status === "0" && Number(candidate.lastclock) > 0 && !candidate.preprocessing.some(p => p.type === "19" || p.type === "20"));
    if (!proof) return undefined;
    return { itemid: proof.itemid, valueType: proof.value_type as "0" | "3", maxGapSeconds: Math.max(60, (cadence(proof) ?? 30) * 2 + 15) };
  }
  return { evidence, byId, historyProof };
}
export type ObservationContext = ReturnType<typeof observationContext>;
export function metric(item: Item | undefined, unit: Metric["unit"], context: ObservationContext, scale = 1, offset = 0): Metric {
  const { quality, observedAt, validUntil } = context.evidence(item);
  const number = item?.lastvalue.trim() ? Number(item.lastvalue) * scale + offset : NaN;
  const value = ["fresh", "stale"].includes(quality) && Number.isFinite(number) && number >= 0 ? number : null;
  return { value, unit, observedAt, quality: value === null && quality === "fresh" ? "missing" : quality, validUntil };
}
export function observedText(item: Item | undefined, context: ObservationContext) { return item && context.evidence(item).quality === "fresh" ? item.lastvalue : null; }
