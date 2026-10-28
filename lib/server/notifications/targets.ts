import "server-only";
import type { PoolClient } from "pg";
import type { AvailabilityCardKind } from "../../config/availability-card-refs.ts";
import { notificationTransaction } from "./database.ts";

export type NotificationTarget = {
  ref: string; id: string; kind: AvailabilityCardKind; label: string; critical: boolean; enabled: boolean;
  epoch: string; identity: Record<string, string | null>;
};
const targetSql = `SELECT t.*,s.epoch FROM (
  SELECT 'resource:'||id AS ref,id,'resource' AS kind,COALESCE(display_name,'Recurso monitorado') AS label,critical,enabled,
    jsonb_build_object('hostKey',zabbix_host_key,'resourceType',resource_type,'selectorType',selector_type,'selectorValue',selector_value) AS identity FROM monitored_resource_config
  UNION ALL SELECT 'external_service:'||id,id,'external_service',display_name,critical,enabled,'{}'::jsonb FROM external_service
  UNION ALL SELECT 'standalone_vps:'||id,id,'standalone_vps',name,critical,enabled AND NOT monitor_paused AND base_url IS NOT NULL,'{}'::jsonb FROM standalone_vps
  UNION ALL SELECT 'signal_target:'||id,id,'signal_target',display_name,critical,enabled,'{}'::jsonb FROM signal_target
  UNION ALL SELECT 'storage:'||id,id,'storage',COALESCE(display_name,'Storage'),critical,true,jsonb_build_object('hostId',zabbix_host_id,'storageKey',storage_key) FROM storage_config
) t JOIN notification_target_state s ON s.target_ref=t.ref AND s.condition_key='$lifecycle'`;
export async function notificationTargets(client?: PoolClient, ref?: string): Promise<NotificationTarget[]> {
  if (!client) return notificationTransaction(tx => notificationTargets(tx, ref), true);
  return (await client.query<NotificationTarget>(targetSql + (ref ? " WHERE t.ref=$1" : "") + " ORDER BY t.ref", ref ? [ref] : [])).rows;
}
const tables: Record<AvailabilityCardKind, string> = {
  resource: "monitored_resource_config", external_service: "external_service", standalone_vps: "standalone_vps", signal_target: "signal_target", storage: "storage_config",
};
export async function lockTarget(client: PoolClient, target: NotificationTarget) {
  // Table identifiers come only from this allowlist; all caller data is parameterized.
  await client.query(`SELECT id FROM ${tables[target.kind]} WHERE id=$1 FOR SHARE`, [target.id]);
  const current = (await notificationTargets(client, target.ref))[0];
  return current?.epoch === target.epoch ? current : null;
}
