import "server-only";
import { notificationTargets, type NotificationTarget } from "./targets.ts";
import { safelyRecordNotifications, type NotificationObservation } from "./engine.ts";
import { signalStates } from "../../config/signal-targets.ts";

export async function captureNotificationTargets() {
  return new Map((await notificationTargets().catch(() => {
    console.error(JSON.stringify({ event: "notification_targets_unavailable" }));
    return [] as NotificationTarget[];
  })).map(target => [target.ref, target]));
}
export function httpNotificationObservation(target: NotificationTarget, source: "probe" | "vps" | "signal", code: number, checkedAt: Date): NotificationObservation {
  const unknown = source === "signal" ? code === signalStates.no_data || ![0, 1, 2, 3, 4].includes(code) : code < 0 || code > (source === "probe" ? 7 : 5);
  const attention = source === "signal" ? code === signalStates.attention || code === signalStates.degraded : code === 1 || source === "vps" && code === 4;
  const healthy = code === 0;
  const authorization = source !== "signal" && code === 2;
  return { key: "availability", family: "availability", source, eventType: attention ? "attention" : "unavailable",
    messageCode: healthy ? "recovered" : authorization ? "authorization" : attention ? code === 4 ? "invalid_response" : "attention" : "connection",
    observation: { epoch: target.epoch, fingerprint: `${checkedAt.toISOString()}:${code}`, checkedAt: checkedAt.getTime(), observedAt: checkedAt.getTime(),
      validUntil: checkedAt.getTime() + 390000, state: unknown ? "unknown" : healthy ? "healthy" : attention ? "attention" : "unavailable",
      severity: healthy ? "info" : attention || authorization ? "warning" : "critical", sourceSeverity: null, confirmation: "sampled" } };
}
export async function recordHttpNotification(target: NotificationTarget | undefined, source: "probe" | "vps" | "signal", code: number, checkedAt: Date) {
  if (!target) return;
  const observation = httpNotificationObservation(target, source, code, checkedAt);
  await safelyRecordNotifications(target, [observation], observation.observation.state === "unknown" ? [] : ["availability"]);
}
