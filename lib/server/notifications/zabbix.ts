import "server-only";
import { z } from "zod";
import type { ResourceConfig } from "../../config/resources.ts";
import { resolveResource } from "../../monitoring/selectors.ts";
import type { normalizeInventory } from "../zabbix/normalize.ts";
import { zabbixProblemSchema, type Rpc, type ZabbixProblem, type ZabbixHost } from "../zabbix/types.ts";
import type { StorageSnapshot } from "../../storage/contracts.ts";
import type { NotificationTarget } from "./targets.ts";
import { notificationTransaction } from "./database.ts";
import { safelyRecordNotifications, type NotificationObservation } from "./engine.ts";

const triggerSchema = z.object({ triggerid: z.string(), status: z.string(), hosts: z.array(z.object({ host: z.string() })), items: z.array(z.object({ itemid: z.string() })) });
type Trigger = z.infer<typeof triggerSchema>;
export type ZabbixNotificationInput = {
  targets: NotificationTarget[]; configs: ResourceConfig[]; inventory: ReturnType<typeof normalizeInventory>;
  hosts: ZabbixHost[]; problems: ZabbixProblem[]; triggers: Trigger[]; storage: StorageSnapshot;
  checkedAt: number; rpc: Rpc; signal?: AbortSignal;
};
function condition(target: NotificationTarget, key: string, family: NotificationObservation["family"], state: NotificationObservation["observation"]["state"], checkedAt: number, observedAt: string | null | undefined, validUntil: string | null | undefined, severity?: number): NotificationObservation {
  return { key, family, source: "zabbix", eventType: family === "problems" ? "problem" : state === "attention" ? "attention" : "unavailable",
    messageCode: family === "problems" ? "problem" : state === "attention" ? "attention" : "unavailable",
    observation: { epoch: target.epoch, fingerprint: `${key}:${observedAt}:${state}:${severity ?? ""}`, checkedAt,
      observedAt: observedAt ? Date.parse(observedAt) : checkedAt, validUntil: validUntil ? Date.parse(validUntil) : checkedAt,
      state, severity: severity !== undefined ? severity >= 4 ? "critical" : severity >= 2 ? "warning" : "info" : state === "attention" ? "warning" : "critical",
      sourceSeverity: severity ?? null, confirmation: state === "attention" ? "sampled" : "explicit" } };
}

const dependencies = {
  prior: (signal?: AbortSignal) => notificationTransaction(async client => (await client.query("SELECT target_ref,condition_key FROM notification_target_state WHERE condition_key LIKE 'problem:%' AND incident_id IS NOT NULL")).rows as { target_ref: string; condition_key: string }[], true, signal),
  record: safelyRecordNotifications,
};
export async function recordZabbixNotifications(input: ZabbixNotificationInput, deps = dependencies) {
  const targets = input.targets.filter(target => target.kind === "resource" || target.kind === "storage");
  if (!targets.length) return;
  if (input.signal?.aborted) return;
  const prior = await deps.prior(input.signal);
  let problems = [...input.problems], triggers = [...input.triggers];
  let storageComplete = true;
  const extras = input.storage.items.filter(item => targets.some(target => target.kind === "storage" && target.identity.hostId === item.hostid) && !input.hosts.some(host => host.hostid === item.hostid));
  try {
    if (extras.length > 100) throw new Error("notification_host_limit");
    if (extras.length) {
      const extra = z.array(zabbixProblemSchema).parse(await input.rpc("problem.get", { hostids: extras.map(item => item.hostid), source: 0, object: 0, recent: false,
        output: ["eventid", "objectid", "name", "severity", "clock"], selectTags: ["tag", "value"], limit: 5001 }, input.signal));
      if (extra.length > 5000) throw new Error("notification_problem_limit");
      problems = [...new Map([...problems, ...extra].map(problem => [problem.eventid, problem])).values()];
    }
  } catch { storageComplete = false; }
  try {
    const ids = [...new Set([...problems.map(problem => problem.objectid), ...prior.map(row => String(row.condition_key).split(":")[2])])].filter(id => id && !triggers.some(trigger => trigger.triggerid === id));
    if (ids.length > 5000) throw new Error("notification_trigger_limit");
    if (ids.length) triggers = [...triggers, ...z.array(triggerSchema).parse(await input.rpc("trigger.get", { triggerids: ids, output: ["triggerid", "status"], selectHosts: ["host"], selectItems: ["itemid"], limit: 5001 }, input.signal))];
    if (triggers.length > 5000) throw new Error("notification_trigger_limit");
  } catch {
    // Existing verified triggers remain usable; missing ones cannot prove recovery.
    console.error(JSON.stringify({ event: "notification_trigger_lookup_incomplete" }));
  }
  for (const target of targets) {
    if (input.signal?.aborted) break;
    const observations: NotificationObservation[] = [], families: string[] = [];
    let hostName: string | null = null, resourceReference: string | null = null, hostMonitored = false;
    if (target.kind === "storage") {
      const item = input.storage.items.find(storage => storage.hostid === target.identity.hostId);
      const removed = input.storage.absent.find(storage => storage.hostid === target.identity.hostId)?.resolution === "tag_missing";
      hostName = item?.technicalName ?? null; hostMonitored = input.storage.status === "ok" && !!item?.monitoringEnabled;
      const state = input.storage.status !== "ok" ? "unknown" : removed || item?.monitoringEnabled === false ? "suppressed" : item?.availability === "reachable" ? "healthy" : item?.availability === "unreachable" ? "unavailable" : "unknown";
      observations.push(condition(target, "availability", "availability", state, input.checkedAt, item?.evidence.observedAt, item?.evidence.validUntil));
      if (state !== "unknown" && state !== "suppressed" && Date.parse(item?.evidence.validUntil ?? "") > input.checkedAt) families.push("availability");
    } else {
      const config = input.configs.find(config => config.id === target.id);
      const resource = config ? resolveResource(config, input.inventory).target : null;
      hostName = config?.zabbixHostKey ?? null;
      hostMonitored = input.hosts.some(host => host.host === hostName && host.status === "0");
      if (input.hosts.some(host => host.host === hostName && host.status === "1")) {
        observations.push(condition(target, "availability", "availability", "suppressed", input.checkedAt, null, null));
      } else if (resource && "availability" in resource) {
        observations.push(condition(target, "availability", "availability", resource.availability === "reachable" ? "healthy" : resource.availability === "unreachable" ? "unavailable" : "unknown", input.checkedAt, resource.evidence.observedAt, resource.evidence.validUntil));
      } else if (resource && "status" in resource) {
        resourceReference = resource.reference;
        const state = resource.status === "running" ? "healthy" : ["stopped", "dead"].includes(resource.status) ? "unavailable" : ["paused", "restarting"].includes(resource.status) ? "attention" : "unknown";
        observations.push(condition(target, "status", "status", state, input.checkedAt, resource.evidence.observedAt, resource.evidence.validUntil));
        observations.push(condition(target, "health", "health", resource.health === "healthy" ? "healthy" : resource.health === "unhealthy" ? "unavailable" : "unknown", input.checkedAt, resource.healthObservedAt, resource.healthValidUntil));
      } else observations.push(condition(target, "availability", "availability", "unknown", input.checkedAt, null, null));
      families.push(...observations.filter(row => row.observation.state !== "unknown" && row.observation.validUntil > input.checkedAt).map(row => row.family));
    }
    const matches = (trigger: Trigger) => {
      if (target.kind === "storage") return trigger.hosts.some(host => host.host === hostName);
      const related = trigger.items.flatMap(item => { const resource = input.inventory.itemResources.get(item.itemid); return resource ? [resource] : []; });
      if (related.length) return related.some(resource => resource.hostKey === hostName && (resourceReference ? resource.type === "docker_container" && resource.reference === resourceReference : target.identity.resourceType === "host" && resource.type === "host"));
      return target.identity.resourceType === "host" && trigger.hosts.some(host => host.host === hostName);
    };
    const complete = input.problems.length <= 5000 && (target.kind !== "storage" || !extras.some(item => item.hostid === target.identity.hostId) || storageComplete);
    if (complete && hostMonitored) {
      const current = problems.filter(problem => { const trigger = triggers.find(trigger => trigger.triggerid === problem.objectid); return trigger?.status === "0" && matches(trigger); });
      for (const problem of current) observations.push(condition(target, `problem:${problem.eventid}:${problem.objectid}`, "problems", "unavailable", input.checkedAt, new Date(Number(problem.clock) * 1000).toISOString(), new Date(input.checkedAt + 120000).toISOString(), Number(problem.severity)));
      for (const old of prior.filter(row => row.target_ref === target.ref && !current.some(problem => row.condition_key === `problem:${problem.eventid}:${problem.objectid}`))) {
        const trigger = triggers.find(trigger => trigger.triggerid === String(old.condition_key).split(":")[2]);
        const stillPresent = problems.some(problem => `problem:${problem.eventid}:${problem.objectid}` === old.condition_key);
        const state = trigger?.status === "1" ? "suppressed" : trigger?.status === "0" && matches(trigger) && !stillPresent ? "healthy" : "unknown";
        observations.push(condition(target, old.condition_key, "problems", state, input.checkedAt, new Date(input.checkedAt).toISOString(), new Date(input.checkedAt + 120000).toISOString()));
      }
      if (problems.every(problem => triggers.some(trigger => trigger.triggerid === problem.objectid))) families.push("problems");
    }
    if (resourceReference) for (const row of observations) row.resourceIdentity = resourceReference;
    await deps.record(target, observations, families, input.signal);
  }
}
