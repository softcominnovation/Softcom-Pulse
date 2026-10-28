import "server-only";
import { BffError } from "../bff.ts";
import { notificationPolicyWriteSchema, notificationOverrideWriteSchema, notificationTargetRefSchema, notificationPolicySchema } from "../../notifications/policy.ts";
import { notificationTransaction, readPolicy, appendChange } from "./database.ts";
import { notificationTargets } from "./targets.ts";

export async function notificationSettings() {
  return notificationTransaction(async client => {
    const policy = await readPolicy(client), targets = await notificationTargets(client);
    return { data: policy, targets: targets.map(({ ref, label, critical, enabled }) => ({ ref, label, critical, enabled })),
      orphanRefs: Object.keys(policy.overrides).filter(ref => !targets.some(target => target.ref === ref)) };
  }, true);
}
export async function saveNotificationSettings(body: unknown, targetRef?: string) {
  const global = targetRef ? null : notificationPolicyWriteSchema.parse(body);
  const override = targetRef ? notificationOverrideWriteSchema.parse(body) : null;
  if (targetRef) notificationTargetRefSchema.parse(targetRef);
  return notificationTransaction(async client => {
    await client.query("SELECT value FROM pulse_settings WHERE key='notifications' FOR UPDATE");
    const current = await readPolicy(client);
    if (current.revision !== (global?.expectedRevision ?? override!.expectedRevision)) throw new BffError(409, "revision_conflict");
    const targets = await notificationTargets(client), refs = new Set(targets.map(target => target.ref));
    if (targetRef && !refs.has(targetRef)) throw new BffError(404, "notification_target_not_found");
    const settings = global?.settings ?? { ...current, overrides: { ...current.overrides } };
    if (targetRef && override) {
      if (override.override) settings.overrides[targetRef] = override.override; else delete settings.overrides[targetRef];
    }
    if (!targetRef && Object.keys(settings.overrides).some(ref => !refs.has(ref))) throw new BffError(400, "notification_target_not_found");
    const saved = notificationPolicySchema.parse({ ...settings, schemaVersion: 1, revision: current.revision + 1 });
    await client.query("UPDATE pulse_settings SET value=$1,updated_at=clock_timestamp() WHERE key='notifications'", [JSON.stringify(saved)]);
    await appendChange(client, "policy_changed", {}, true);
    return { data: saved };
  });
}
