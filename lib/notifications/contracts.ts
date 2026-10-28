import { z } from "zod";
import { notificationTargetRefSchema, type NotificationSeverity, type NotificationSound, type NotificationEventType, notificationRuntime } from "./policy.ts";

export const notificationMessages = {
  unavailable: "Serviço indisponível", attention: "Serviço requer atenção", authorization: "Falha de autorização na consulta",
  invalid_response: "Resposta do monitor inválida", connection: "Falha ao consultar o serviço", problem: "Problema ativo no monitoramento",
  recovered: "Serviço recuperado", monitor_changed: "Acompanhamento encerrado por alteração do monitor",
} as const;
export type NotificationMessageCode = keyof typeof notificationMessages;
export const notificationMessageSchema = z.enum(Object.keys(notificationMessages) as [NotificationMessageCode, ...NotificationMessageCode[]]);
export type NotificationIncidentView = {
  id: string; targetRef: string; displayName: string; severity: NotificationSeverity; sourceSeverity: number | null;
  status: "active" | "resolved" | "cancelled"; messageCode: NotificationMessageCode;
  openedAt: string; confirmedAt: string; changedAt: string; closedAt: string | null; revision: string;
};
export type NotificationEventView = {
  id: string; incidentId: string; targetRef: string; displayName: string; eventType: NotificationEventType;
  transition: "opened" | "escalated" | "recovered"; severity: NotificationSeverity; sourceSeverity: number | null;
  criticalAtOccurrence: boolean; messageCode: NotificationMessageCode; occurredAt: string; createdAt: string;
  createdRevision: string; revision: string; readAt: string | null; announce: boolean;
  incidentStatus: NotificationIncidentView["status"]; toastEligible: boolean; sound: NotificationSound | false;
};
export type NotificationCounts = { unreadCount: number; activeCount: number };
export type NotificationSourceHealth = { source: "zabbix" | "probe" | "vps" | "signal"; lastCheckedAt: string | null; status: "receiving" | "stale" | "awaiting" };
export type NotificationSnapshot = {
  events: NotificationEventView[]; incidents: NotificationIncidentView[]; counts: NotificationCounts;
  syncCursor: string; nextPageCursor: string | null; streamRevision: string; serverTime: string;
  runtime: ReturnType<typeof notificationRuntime>;
  sources: NotificationSourceHealth[];
};
export type NotificationChangeView = { revision: string; kind: string; payload: { event?: NotificationEventView; incident?: NotificationIncidentView; ids?: string[] } };
export type NotificationChanges = {
  changes: NotificationChangeView[]; nextCursor: string; hasMore: boolean; windowEnd: string; streamRevision: string;
  counts: NotificationCounts | null; runtime: ReturnType<typeof notificationRuntime>; serverTime: string;
};
export const notificationListQuery = z.strictObject({
  read: z.enum(["all", "unread"]).default("all"), state: z.enum(["all", "active", "resolved", "cancelled"]).default("all"),
  severity: z.enum(["info", "warning", "critical"]).optional(), targetRef: notificationTargetRefSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30), cursor: z.string().max(1200).optional(),
});
export const notificationChangesQuery = z.strictObject({ after: z.string().min(1).max(1200), limit: z.coerce.number().int().min(1).max(200).default(100) });
export const notificationReadSchema = z.union([
  z.strictObject({ ids: z.array(z.uuid()).min(1).max(100).refine(ids => new Set(ids).size === ids.length) }),
  z.strictObject({ allThrough: z.string().min(1).max(1200) }),
]);
