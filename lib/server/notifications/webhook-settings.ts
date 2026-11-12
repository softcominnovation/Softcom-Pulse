import "server-only";
import { webhookWriteSchema, type WebhookSettings } from "../../notifications/webhook.ts";
import { BffError } from "../bff.ts";
import { assertProbeDestination, parseProbeUrl } from "../probe/network.ts";
import { sealProbeSecret } from "../probe/secret.ts";
import { notificationTransaction } from "./database.ts";

export const webhookSecretContext = "pulse.notification.webhook.v1";
const publicFields = 'active, url, secret IS NOT NULL AS "hasApiKey", revision';

export function readWebhookSettings() {
  return notificationTransaction(async client => (await client.query<WebhookSettings>(
    "SELECT " + publicFields + " FROM notification_webhook WHERE id=1"
  )).rows[0], true);
}

export async function saveWebhookSettings(input: unknown) {
  const data = webhookWriteSchema.parse(input);
  const url = data.url === null ? null : parseProbeUrl(data.url).href;
  // An outage at the saved destination (including DNS) must never prevent switching it off.
  if (url && (data.active || (await readWebhookSettings()).url !== url)) await assertProbeDestination(url);
  const replacement = data.apiKey ? sealProbeSecret(data.apiKey, webhookSecretContext) : null;
  return notificationTransaction(async client => {
    const current = (await client.query("SELECT * FROM notification_webhook WHERE id=1 FOR UPDATE")).rows[0];
    if (current.revision !== data.expectedRevision) throw new BffError(409, "revision_conflict");
    const secret = data.apiKey === undefined ? current.secret : replacement;
    if (data.active && (!url || !secret)) throw new BffError(400, "invalid_request");
    if (data.active !== current.active || url !== current.url) {
      const stream = (await client.query("SELECT revision FROM notification_stream_state WHERE id=1 FOR SHARE")).rows[0];
      await client.query("UPDATE notification_webhook SET generation=gen_random_uuid(), cursor_revision=$1 WHERE id=1", [stream.revision]);
      await client.query("UPDATE notification_webhook_delivery SET finished_at=now(), outcome='cancelled', lease=NULL WHERE generation=$1 AND finished_at IS NULL", [current.generation]);
    }
    return (await client.query<WebhookSettings>(
      "UPDATE notification_webhook SET active=$1,url=$2,secret=$3,revision=revision+1 WHERE id=1 RETURNING " + publicFields,
      [data.active, url, secret],
    )).rows[0];
  });
}
