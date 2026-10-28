import type { Page } from "@playwright/test";
import { defaultNotificationPolicy, notificationRuntime, notificationPolicySchema } from "../../lib/notifications/policy";
import type { NotificationEventView, NotificationChangeView } from "../../lib/notifications/contracts";
import { id } from "./dashboard";

export function notificationFixtureState() {
  return { revision: 1, policy: defaultNotificationPolicy(), events: [] as NotificationEventView[], changes: [] as NotificationChangeView[], snapshots: 0, polls: 0, writes: 0, fail: false, conflict: false };
}
export function addNotification(state: ReturnType<typeof notificationFixtureState>) {
  state.revision++;
  const event: NotificationEventView = { id: id(8000 + state.revision), incidentId: id(9000 + state.revision), targetRef: `resource:${id(90)}`, displayName: "Storage de operações", eventType: "unavailable", transition: "opened", severity: "critical", sourceSeverity: null, criticalAtOccurrence: true, messageCode: "unavailable", occurredAt: new Date().toISOString(), createdAt: new Date().toISOString(), createdRevision: String(state.revision), revision: String(state.revision), readAt: null, announce: true, incidentStatus: "active", toastEligible: true, sound: "error" };
  state.events.unshift(event); state.changes.push({ revision: String(state.revision), kind: "incident", payload: { event: structuredClone(event) } }); return event;
}
export async function notificationFixture(page: Page, state = notificationFixtureState()) {
  await page.route("**/api/**notifications**", async route => {
    const url = new URL(route.request().url()), method = route.request().method();
    if (state.fail) return route.fulfill({ status: 503, json: { error: { code: "notifications_unavailable" } } });
    if (url.pathname.includes("/settings/")) {
      if (method === "PUT") {
        state.writes++; const body = route.request().postDataJSON();
        if (state.conflict || body.expectedRevision !== state.policy.revision) return route.fulfill({ status: 409, json: { error: { code: "revision_conflict" } } });
        const ref = decodeURIComponent(url.pathname.split("/targets/")[1] ?? "");
        state.policy = notificationPolicySchema.parse({ ...(ref ? { ...state.policy, overrides: { ...state.policy.overrides, [ref]: body.override } } : body.settings), schemaVersion: 1, revision: state.policy.revision + 1 });
      }
      return route.fulfill({ json: { data: state.policy, orphanRefs: [], targets: [{ ref: `resource:${id(90)}`, label: "Storage de operações", critical: true, enabled: true }] } });
    }
    const counts = () => ({ unreadCount: state.events.filter(event => !event.readAt).length, activeCount: state.events.length });
    const runtime = () => ({ ...notificationRuntime(state.policy, "1"), toastLifetimeMs: 15000 });
    if (method === "POST") {
      state.writes++; state.revision++;
      const body = route.request().postDataJSON(), ids: string[] = body.ids ?? state.events.filter(event => Number(event.createdRevision) <= Number(body.allThrough)).map(event => event.id);
      for (const event of state.events) if (ids.includes(event.id)) { event.readAt = new Date().toISOString(); event.toastEligible = false; event.sound = false; }
      state.changes.push({ revision: String(state.revision), kind: "read", payload: { ids } });
      return route.fulfill({ json: { counts: counts(), streamRevision: String(state.revision), syncCursor: String(state.revision) } });
    }
    if (url.pathname.endsWith("/changes")) {
      state.polls++;
      return route.fulfill({ json: { changes: state.changes.filter(change => Number(change.revision) > Number(url.searchParams.get("after"))), nextCursor: String(state.revision), hasMore: false, windowEnd: String(state.revision), streamRevision: String(state.revision), counts: counts(), runtime: runtime(), serverTime: new Date().toISOString() } });
    }
    state.snapshots++;
    return route.fulfill({ json: { events: state.events.filter(event => url.searchParams.get("read") !== "unread" || !event.readAt), incidents: [], counts: counts(), sources: [], syncCursor: String(state.revision), nextPageCursor: null, streamRevision: String(state.revision), serverTime: new Date().toISOString(), runtime: runtime() } });
  });
  return state;
}
