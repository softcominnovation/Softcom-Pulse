import "server-only";
import { notificationText, type NotificationEventView, type NotificationIncidentView } from "../../notifications/contracts.ts";

type Message = Pick<NotificationEventView, "messageCode" | "metricContext" | "targetRef" | "description">;
/** Add presentation text to the current public DTO; never rebuild policy or metric semantics in ES5. */
export function compatibleNotification<T extends Message>(entry: T) {
  return { ...entry, message: notificationText(entry) };
}
export function compatibleNotificationPayload(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const data = value as Record<string, unknown>;
  const entries = (items: unknown) => Array.isArray(items) ? items.map(item => compatibleNotification(item as NotificationEventView)) : items;
  return {
    ...data,
    ...(Array.isArray(data.events) ? { events: entries(data.events) } : {}),
    ...(Array.isArray(data.incidents) ? { incidents: entries(data.incidents) } : {}),
    ...(data.event ? { event: compatibleNotification(data.event as NotificationEventView) } : {}),
    ...(data.incident ? { incident: compatibleNotification(data.incident as NotificationIncidentView) } : {}),
    ...(Array.isArray(data.changes) ? { changes: data.changes.map(change => ({ ...change, payload: compatibleNotificationPayload(change.payload) })) } : {}),
  };
}
