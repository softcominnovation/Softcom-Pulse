import { z } from "zod";

const text = z.string();
export const tagSchema = z.object({ tag: text, value: text });
export const zabbixHostSchema = z.object({
  hostid: text, host: text, name: text, status: text,
  tags: z.array(tagSchema).default([]), hostgroups: z.array(z.object({ name: text })).default([]),
  interfaces: z.array(z.object({ type: text, main: text, available: text })).default([]),
});
export const itemSchema = z.object({
  itemid: text, hostid: text, name: text, key_: text, type: text, value_type: text, units: text,
  delay: text, status: text, state: text, lastclock: text, lastvalue: text.default(""), master_itemid: text,
  tags: z.array(tagSchema).default([]), preprocessing: z.array(z.object({ type: text, params: text })).default([]),
  valuemap: z.union([z.array(z.unknown()), z.object({ mappings: z.array(z.object({ type: text, value: text, newvalue: text })) })]).optional(),
  itemDiscovery: z.union([z.array(z.never()).length(0), z.object({ status: text.optional() })]).transform(value => Array.isArray(value) ? {} : value).optional(),
});
export const zabbixProblemSchema = z.object({ eventid: text, objectid: text, name: text, severity: text, clock: text, tags: z.array(tagSchema).default([]) });
export type ZabbixHost = z.infer<typeof zabbixHostSchema>;
export type Item = z.infer<typeof itemSchema>;
export type ZabbixProblem = z.infer<typeof zabbixProblemSchema>;
export type Rpc = <T = unknown>(method: string, params: Record<string, unknown>, signal?: AbortSignal) => Promise<T>;
export function tag(tags: { tag: string; value: string }[], key: string) { return tags.find(t => t.tag === key)?.value; }
