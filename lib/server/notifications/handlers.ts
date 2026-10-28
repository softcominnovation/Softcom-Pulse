import "server-only";
import { BffError, protectedResponse, queryParams, jsonBody } from "../bff.ts";
import { requireSession } from "../auth/index.ts";
import { notificationListQuery, notificationChangesQuery } from "../../notifications/contracts.ts";
import { listNotifications, notificationDetail, notificationChanges, markNotificationsRead } from "./read.ts";
import { notificationSettings, saveNotificationSettings } from "./settings.ts";

export async function readNotificationRoute(request: Request, segments: string[], scope: "public" | "private") {
  if (!segments.length) return listNotifications(queryParams(request, notificationListQuery), scope);
  if (segments.length === 1 && segments[0] === "changes") {
    const query = queryParams(request, notificationChangesQuery);
    return notificationChanges(query.after, query.limit, scope);
  }
  if (segments[0] === "incidents" && segments.length === 1) {
    const query = queryParams(request, notificationListQuery);
    if (!new URL(request.url).searchParams.has("state")) query.state = "active";
    return listNotifications(query, scope, true);
  }
  if (segments[0] === "incidents" && segments.length === 2) return notificationDetail(segments[1], scope, true, queryParams(request, notificationListQuery));
  if (segments.length === 1) return notificationDetail(segments[0], scope);
  throw new BffError(404, "notification_not_found");
}
type Context = { params: Promise<{ segments?: string[] }> };
export function notificationsGet(request: Request, context: Context) {
  return protectedResponse(request, async () => readNotificationRoute(request, (await context.params).segments ?? [], "private"));
}
export function notificationsPost(request: Request, context: Context) {
  return protectedResponse(request, async () => {
    if ((await context.params).segments?.join("/") !== "read") throw new BffError(404, "notification_not_found");
    const email = requireSession(request).user.email;
    if (!email) throw new BffError(403, "editor_required");
    return markNotificationsRead(await jsonBody(request), email);
  });
}
export function notificationSettingsGet(request: Request, context: Context) {
  return protectedResponse(request, async editor => {
    if (!editor) throw new BffError(403, "editor_required");
    if ((await context.params).segments?.length) throw new BffError(404, "notification_not_found");
    return notificationSettings();
  });
}
export function notificationSettingsPut(request: Request, context: Context) {
  return protectedResponse(request, async () => {
    const segments = (await context.params).segments ?? [];
    if (!segments.length) return saveNotificationSettings(await jsonBody(request, 512 * 1024));
    if (segments.length === 2 && segments[0] === "targets") return saveNotificationSettings(await jsonBody(request), segments[1]);
    throw new BffError(404, "notification_not_found");
  });
}
