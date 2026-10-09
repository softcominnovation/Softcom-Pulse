import "server-only";
import { z } from "zod";
import { hostKeySchema } from "../../config/resources.ts";
import { getPrisma } from "../prisma.ts";
import { BffError } from "../bff.ts";
import { tag, type Item, type ZabbixHost } from "./types.ts";

export const monitoringScopeSchema = z.strictObject({
  hostKeys: z.array(hostKeySchema).min(1).max(500).refine(values => new Set(values).size === values.length),
  vmLinks: z.array(z.strictObject({ hostKey: hostKeySchema, parentHostKey: hostKeySchema, vmId: z.string().regex(/^(qemu|lxc)\/\d+$/) })).max(500).default([]),
  revision: z.number().int().min(1).default(1),
}).refine(scope => scope.vmLinks.every(link => scope.hostKeys.includes(link.hostKey) && scope.hostKeys.includes(link.parentHostKey)) && new Set(scope.vmLinks.map(link => link.hostKey)).size === scope.vmLinks.length && new Set(scope.vmLinks.map(link => link.parentHostKey + ":" + link.vmId)).size === scope.vmLinks.length);
export type MonitoringScope = z.infer<typeof monitoringScopeSchema>;

export const scopeLinkBodySchema = z.strictObject({
  hostKey: hostKeySchema,
  parentHostKey: hostKeySchema,
  vmId: z.string().regex(/^(qemu|lxc)\/\d+$/),
  expectedRevision: z.number().int().min(1),
});
export const scopeUnlinkBodySchema = z.strictObject({
  hostKey: hostKeySchema,
  expectedRevision: z.number().int().min(1),
  removeHost: z.boolean().default(false),
});

export async function readScopeSettings() {
  try {
    const rows = await getPrisma().pulseSetting.findMany({ where: { key: { in: ["monitoringScope", "asgardHostKey"] } } });
    const scope = rows.find(row => row.key === "monitoringScope"), asgard = rows.find(row => row.key === "asgardHostKey");
    return { scope: scope ? monitoringScopeSchema.parse(scope.value) : null, asgardHostKey: asgard ? hostKeySchema.parse(asgard.value) : null };
  } catch { throw new BffError(503, "monitoring_scope_invalid"); }
}

export function selectScope(hosts: ZabbixHost[], configured: { scope: MonitoringScope | null; asgardHostKey: string | null }) {
  const explicit = configured.asgardHostKey;
  const candidates = hosts.filter(host => explicit ? host.host === explicit : host.host === "ASGARD" || tag(host.tags, "pulse.role") === "asgard");
  if (candidates.length !== 1) throw new BffError(503, "monitoring_scope_required");
  const asgard = candidates[0];
  const selected = configured.scope ? hosts.filter(host => configured.scope!.hostKeys.includes(host.host)) : hosts.filter(host => host === asgard || tag(host.tags, "pulse.parent") === asgard.host);
  if (!selected.includes(asgard) || (configured.scope && selected.length !== configured.scope.hostKeys.length)) throw new BffError(503, "monitoring_scope_unavailable");
  return { hosts: selected, asgardHostKey: asgard.host, vmLinks: configured.scope?.vmLinks ?? [] };
}
export function correlatedHost(parentHostKey: string, vmId: string, hosts: ZabbixHost[], links: MonitoringScope["vmLinks"]) {
  const matches = hosts.filter(host => links.some(link => link.parentHostKey === parentHostKey && link.vmId === vmId && link.hostKey === host.host) || (tag(host.tags, "pulse.parent") === parentHostKey && tag(host.tags, "pulse.vm") === vmId));
  return matches.length === 1 ? matches[0].host : null;
}
export function assertHypervisor(items: Item[], asgardHostId: string) {
  if (!items.some(item => item.hostid === asgardHostId && item.key_.startsWith("proxmox.node."))) throw new BffError(503, "asgard_capability_missing");
}

async function loadScopeRow(tx: { pulseSetting: ReturnType<typeof getPrisma>["pulseSetting"] }) {
  const rows = await tx.pulseSetting.findMany({ where: { key: { in: ["monitoringScope", "asgardHostKey"] } } });
  const scopeRow = rows.find(row => row.key === "monitoringScope");
  const asgardRow = rows.find(row => row.key === "asgardHostKey");
  if (!scopeRow || !asgardRow) throw new BffError(503, "monitoring_scope_required");
  return {
    scope: monitoringScopeSchema.parse(scopeRow.value),
    asgardHostKey: hostKeySchema.parse(asgardRow.value),
  };
}

export async function replaceMonitoringScope(asgardHostKey: string, scope: MonitoringScope) {
  const parsed = monitoringScopeSchema.parse(scope);
  if (!parsed.hostKeys.includes(asgardHostKey)) throw new BffError(400, "invalid_request");
  return getPrisma().$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(734021003::bigint)`;
    const current = await loadScopeRow(tx).catch(() => null);
    const next = { ...parsed, revision: (current?.scope.revision ?? 0) + 1 };
    for (const [key, value] of [["asgardHostKey", asgardHostKey], ["monitoringScope", next]] as const) {
      await tx.pulseSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
    }
    return { asgardHostKey, scope: next };
  });
}

export async function linkAgentToScope(body: z.infer<typeof scopeLinkBodySchema>, allowedHostKeys: Set<string>) {
  const input = scopeLinkBodySchema.parse(body);
  if (!allowedHostKeys.has(input.hostKey)) throw new BffError(400, "invalid_request");
  return getPrisma().$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(734021003::bigint)`;
    const { scope, asgardHostKey } = await loadScopeRow(tx);
    if (scope.revision !== input.expectedRevision) throw new BffError(409, "revision_conflict");
    if (input.parentHostKey !== asgardHostKey) throw new BffError(400, "invalid_request");
    if (!scope.hostKeys.includes(input.parentHostKey)) throw new BffError(400, "invalid_request");
    const hostKeys = scope.hostKeys.includes(input.hostKey) ? scope.hostKeys : [...scope.hostKeys, input.hostKey];
    const withoutHost = scope.vmLinks.filter(link => link.hostKey !== input.hostKey);
    const withoutVm = withoutHost.filter(link => !(link.parentHostKey === input.parentHostKey && link.vmId === input.vmId));
    const next = monitoringScopeSchema.parse({
      hostKeys,
      vmLinks: [...withoutVm, { hostKey: input.hostKey, parentHostKey: input.parentHostKey, vmId: input.vmId }],
      revision: scope.revision + 1,
    });
    await tx.pulseSetting.update({ where: { key: "monitoringScope" }, data: { value: next } });
    return { asgardHostKey, scope: next };
  });
}

export async function unlinkAgentFromScope(body: z.infer<typeof scopeUnlinkBodySchema>) {
  const input = scopeUnlinkBodySchema.parse(body);
  return getPrisma().$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(734021003::bigint)`;
    const { scope, asgardHostKey } = await loadScopeRow(tx);
    if (scope.revision !== input.expectedRevision) throw new BffError(409, "revision_conflict");
    if (input.hostKey === asgardHostKey) throw new BffError(400, "invalid_request");
    const vmLinks = scope.vmLinks.filter(link => link.hostKey !== input.hostKey);
    let hostKeys = scope.hostKeys;
    if (input.removeHost) hostKeys = hostKeys.filter(key => key !== input.hostKey);
    if (!hostKeys.includes(asgardHostKey)) throw new BffError(400, "invalid_request");
    const next = monitoringScopeSchema.parse({ hostKeys, vmLinks, revision: scope.revision + 1 });
    await tx.pulseSetting.update({ where: { key: "monitoringScope" }, data: { value: next } });
    return { asgardHostKey, scope: next };
  });
}
