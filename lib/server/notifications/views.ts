import "server-only";
import type { NotificationEventView, NotificationIncidentView } from "../../notifications/contracts.ts";

type Row = Record<string, unknown>;
const date = (value: unknown) => value instanceof Date ? value.toISOString() : String(value);
export function incidentView(row: Row): NotificationIncidentView {
  return {
    id: String(row.id), targetRef: String(row.target_ref), displayName: String(row.display_name), severity: row.severity as NotificationIncidentView["severity"],
    sourceSeverity: row.source_severity == null ? null : Number(row.source_severity), status: row.status as NotificationIncidentView["status"],
    messageCode: row.message_code as NotificationIncidentView["messageCode"], openedAt: date(row.opened_at), confirmedAt: date(row.confirmed_at),
    changedAt: date(row.changed_at), closedAt: row.closed_at ? date(row.closed_at) : null, revision: String(row.revision),
  };
}
export function eventView(row: Row): NotificationEventView {
  return {
    id: String(row.id), incidentId: String(row.incident_id), targetRef: String(row.target_ref), displayName: String(row.display_name),
    eventType: row.event_type as NotificationEventView["eventType"], transition: row.transition as NotificationEventView["transition"],
    severity: row.severity as NotificationEventView["severity"], sourceSeverity: row.source_severity == null ? null : Number(row.source_severity),
    criticalAtOccurrence: row.critical_at_occurrence === true, messageCode: row.message_code as NotificationEventView["messageCode"],
    occurredAt: date(row.occurred_at), createdAt: date(row.created_at), createdRevision: String(row.created_revision), revision: String(row.revision),
    readAt: row.read_at ? date(row.read_at) : null, announce: row.announce === true,
    incidentStatus: (row.incident_status ?? "active") as NotificationEventView["incidentStatus"], toastEligible: false, sound: false,
  };
}
