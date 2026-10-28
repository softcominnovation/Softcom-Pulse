import "server-only";
import { appendChange, notificationTransaction, readPolicy } from "./database.ts";

export async function maintainNotifications() {
  try {
    await notificationTransaction(async client => {
      if (!(await client.query("SELECT pg_try_advisory_xact_lock(734021021::bigint) AS locked")).rows[0].locked) return;
      const state = (await client.query("SELECT maintained_at FROM notification_stream_state WHERE id=1")).rows[0];
      if (state?.maintained_at && Date.now() - new Date(state.maintained_at).getTime() < 86400000) return;
      const policy = await readPolicy(client), cutoff = new Date(Date.now() - policy.retentionDays * 86400000);
      // Condition checkpoints are expendable only after their incident is closed and old.
      await client.query(`DELETE FROM notification_target_state WHERE (target_ref,condition_key) IN (
        SELECT target_ref,condition_key FROM notification_target_state WHERE condition_key<>'$lifecycle' AND incident_id IS NULL AND updated_at<$1
        ORDER BY target_ref,condition_key LIMIT 200 FOR UPDATE SKIP LOCKED)`, [cutoff]);
      const rows = (await client.query(`SELECT id FROM notification_incident i WHERE status<>'active' AND changed_at<$1
        AND NOT EXISTS(SELECT 1 FROM notification_event e WHERE e.incident_id=i.id AND (e.read_at IS NULL OR e.read_at>=$1)) ORDER BY id LIMIT 200 FOR UPDATE`, [cutoff])).rows;
      if (rows.length) await client.query("DELETE FROM notification_incident WHERE id=ANY($1::uuid[])", [rows.map(row => row.id)]);
      await appendChange(client, "retention", {});
      const removed = await client.query("DELETE FROM notification_change WHERE revision IN (SELECT revision FROM notification_change WHERE created_at<now()-interval '7 days' ORDER BY revision LIMIT 2000) RETURNING revision");
      const minimum = removed.rows.reduce((max: bigint, row) => BigInt(row.revision) > max ? BigInt(row.revision) : max, 0n);
      await client.query("UPDATE notification_stream_state SET maintained_at=clock_timestamp(),minimum_revision=GREATEST(minimum_revision,$1) WHERE id=1", [minimum.toString()]);
    });
  } catch { console.error(JSON.stringify({ event: "notification_maintenance_failed" })); }
}
