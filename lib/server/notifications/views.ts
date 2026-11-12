import { metricContextSchema } from "../../config/agent-monitoring.ts";
import "server-only";
import { diagnosticSchema } from "./webhook-diagnostic.ts";
import type { NotificationEventView, NotificationIncidentView } from "../../notifications/contracts.ts";

type Row = Record<string, unknown>;
const date = (value: unknown) => value instanceof Date ? value.toISOString() : String(value);
export function notificationDescription(row: Row, privateRead: boolean): string | undefined {
  const detail = diagnosticSchema.safeParse(row.diagnostic).data;
  const code = row.message_code;
  if (code === "problem") {
    if (privateRead && detail?.title) return "Zabbix · " + detail.title;
    const subjects = { container_health: "saúde do container", container_state: "estado do container", filesystem: "sistema de arquivos", memory: "memória", cpu: "CPU", agent: "disponibilidade do Agent" };
    const subject = detail?.subject ? " · " + subjects[detail.subject] : "";
    return "Problema ativo no Zabbix" + subject + (row.source_severity == null ? "" : " · severidade " + row.source_severity + "/5");
  }
  if (!detail || !["connection","unavailable","attention","authorization","invalid_response"].includes(String(code))) return undefined;
  const isSignalService = String(row.target_ref).startsWith("signal_service:");
  const reasons: Record<string, string> = {
    slow: "Tempo de resposta acima do limite", unauthorized: "A consulta foi recusada por falta de autorização",
    status: detail.host || isSignalService ? "Estado de execução do container fora do esperado" : "O monitor recebeu um status HTTP inesperado",
    json: "A resposta recebida não atende ao formato ou valor configurado", timeout: "O serviço não respondeu dentro do prazo",
    network: "Falha de rede ao conectar ao serviço", tls: "Falha na negociação TLS com o serviço",
    degraded: "Signal informou operação degradada", down: "A verificação de disponibilidade do Signal falhou",
    attention: "A verificação de saúde do Signal requer atenção", health: "O monitor de saúde do container indicou falha",
    availability: "O monitor não conseguiu alcançar o recurso",
  };
  const message = detail.reason && reasons[detail.reason];
  return message && (detail.httpStatus ? message + " · HTTP " + detail.httpStatus : message);
}
export function incidentView(row: Row, privateRead = false): NotificationIncidentView {
  return {
    id: String(row.id), targetRef: String(row.target_ref), displayName: String(row.display_name), severity: row.severity as NotificationIncidentView["severity"],
    sourceSeverity: row.source_severity == null ? null : Number(row.source_severity), status: row.status as NotificationIncidentView["status"],
    messageCode: row.message_code as NotificationIncidentView["messageCode"], openedAt: date(row.opened_at), confirmedAt: date(row.confirmed_at),
    metricContext: metricContextSchema.safeParse(row.metric_context).data ?? null, contextOccurredAt: row.context_occurred_at ? date(row.context_occurred_at) : null,
    description: notificationDescription(row, privateRead), dismissedAt: row.dismissed_at ? date(row.dismissed_at) : null,
    changedAt: date(row.changed_at), closedAt: row.closed_at ? date(row.closed_at) : null, revision: String(row.revision),
  };
}
export function eventView(row: Row, privateRead = false): NotificationEventView {
  return {
    id: String(row.id), incidentId: String(row.incident_id), targetRef: String(row.target_ref), displayName: String(row.display_name),
    eventType: row.event_type as NotificationEventView["eventType"], transition: row.transition as NotificationEventView["transition"],
    severity: row.severity as NotificationEventView["severity"], sourceSeverity: row.source_severity == null ? null : Number(row.source_severity),
    criticalAtOccurrence: row.critical_at_occurrence === true, messageCode: row.message_code as NotificationEventView["messageCode"],
    metricContext: metricContextSchema.safeParse(row.metric_context).data ?? null,
    occurredAt: date(row.occurred_at), createdAt: date(row.created_at), createdRevision: String(row.created_revision), revision: String(row.revision),
    readAt: row.read_at ? date(row.read_at) : null, announce: row.announce === true,
    description: notificationDescription(row, privateRead),
    incidentStatus: (row.incident_status ?? "active") as NotificationEventView["incidentStatus"], toastEligible: false, sound: false,
  };
}
