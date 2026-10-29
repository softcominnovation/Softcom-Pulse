"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { api } from "@/lib/client/api";
import { isPublicPath } from "@/lib/public/paths";
import { getAuthController, useAuthStore } from "@/store/auth.store";
import { toast, dismissToast } from "@/components/ui/toast";
import { playOperationalSound, type SoundName } from "@/components/ui/sound";
import { arrivingSound, hiddenSoundMaxAgeMs, NotificationDelivery } from "@/lib/notifications/delivery";
import { notificationMessages, type NotificationSnapshot, type NotificationChanges, type NotificationCounts } from "@/lib/notifications/contracts";
import { setOperationalToastPlace } from "@/lib/notifications/toast-place";
import { setTabProblemIcon, tabProblemVisible } from "@/lib/notifications/tab-icon";

type Center = { counts: NotificationCounts; revision: string; scopeKey: string; available: boolean; open: boolean; setOpen: (open: boolean) => void; refresh: () => void; register: () => () => void };
const Context = createContext<Center | null>(null);
export function useNotificationCenter() { const value = useContext(Context); if (!value) throw new Error("Notification provider missing"); return value; }
const toastId = "pulse-operational-notification";
export function NotificationRuntime() {
  const { register } = useNotificationCenter();
  useEffect(register, [register]);
  return null;
}

let localLastSound = 0;
const localClaims = new Map<string, number>();
async function playArrivingSound(ids: string[], cooldown: number, sound: SoundName, velocity: number, eligible: () => boolean, key: string) {
  let attempted = false;
  const run = async () => {
    attempted = true;
    if (!eligible()) return;
    const now = Date.now();
    for (const [id, at] of localClaims) if (now - at >= 180000) localClaims.delete(id);
    let claims: Record<string, number> = {}, last = localLastSound;
    try {
      const raw = JSON.parse(localStorage.getItem(key) ?? '{}');
      claims = Object.fromEntries(Object.entries(raw.ids ?? {}).filter((entry): entry is [string, number] => typeof entry[1] === 'number' && now - entry[1] < 180000));
      last = Math.max(last, Number(localStorage.getItem('pulse-notification-last-sound')) || 0);
    } catch { /* Keep the per-tab guard when storage is unavailable. */ }
    if (ids.some(id => claims[id] || localClaims.has(id)) || now - last < cooldown) return;
    // Claim only an actually started source; a suspended context must not consume an alert.
    if (!await playOperationalSound(sound, velocity, eligible)) return;
    localLastSound = Date.now();
    for (const id of ids) { claims[id] = now; localClaims.set(id, now); }
    while (localClaims.size > 1000) localClaims.delete(localClaims.keys().next().value!);
    try {
      localStorage.setItem(key, JSON.stringify({ ids: Object.fromEntries(Object.entries(claims).slice(-1000)) }));
      localStorage.setItem('pulse-notification-last-sound', String(now));
    } catch { /* The voice already started; do not replay it on a storage error. */ }
  };
  if (!navigator.locks) { await run(); return; }
  try {
    // Let a refused resume release its claim, but never wait indefinitely for another tab.
    await navigator.locks.request('pulse-notification-delivery', { signal: AbortSignal.timeout(400) }, run);
  } catch (error) {
    const timedOut = error instanceof DOMException && ['AbortError', 'TimeoutError'].includes(error.name);
    if (!attempted && !timedOut) await run();
  }
}

export function NotificationProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "", status = useAuthStore(state => state.status);
  const [active, setActive] = useState(false);
  const mounts = useRef(0), detach = useRef<ReturnType<typeof setTimeout> | null>(null);
  const register = useCallback(() => {
    mounts.current++; if (detach.current) clearTimeout(detach.current); setActive(true);
    return () => { mounts.current--; detach.current = setTimeout(() => { if (!mounts.current) setActive(false); }, 0); };
  }, []);
  const scope = !active ? null : isPublicPath(pathname) ? "public" : status === "authenticated" && pathname !== "/login" ? "private" : null;
  const sessionKey = useAuthStore(state => state.session?.user.email ?? "");
  const viewKey = `${scope}:${sessionKey}`;
  const [dataKey, setDataKey] = useState("");
  const [open, setOpen] = useState(false), [available, setAvailable] = useState(false);
  const [counts, setCounts] = useState<NotificationCounts>({ unreadCount: 0, activeCount: 0 });
  const [revision, setRevision] = useState("0");
  const refreshRef = useRef<() => void>(() => undefined);
  useEffect(() => {
    if (!scope) return;
    const abort = new AbortController(), delivery = new NotificationDelivery();
    let cursor: string | null = null, runtime: NotificationSnapshot["runtime"] | null = null;
    let stopped = false, busy = false, offset = 0, lastSuccess = 0, generation = 0;
    let visibleEvents: { id: string; incidentId: string; recovery: boolean }[] = [];
    let activeCount = 0, unreadCount = 0;
    const paintIcon = () => setTabProblemIcon(tabProblemVisible(document.hidden, activeCount, unreadCount));
    const publishCounts = (next: NotificationCounts) => { activeCount = next.activeCount; unreadCount = next.unreadCount; setCounts(next); paintIcon(); };
    const remember = (next: NotificationSnapshot["runtime"]) => {
      if (next.toastPosition === "bottom-end" || next.toastPosition === "top-end" || next.toastPosition === "header-center") setOperationalToastPlace(next.toastPosition);
      return next;
    };
    const clear = () => { delivery.reset(); dismissToast(toastId); };
    const resync = () => { generation++; cursor = null; clear(); };
    refreshRef.current = () => { void poll(); };
    const visibility = () => { paintIcon(); if (document.hidden) clear(); else { resync(); void poll(); } };
    async function poll() {
      if (busy || stopped) return;
      busy = true;
      const run = generation;
      try {
        if (!document.hidden && lastSuccess && Date.now() - lastSuccess > 30000) { cursor = null; clear(); }
        if (!cursor) {
          const { data } = await api.get<NotificationSnapshot>("/monitoring/notifications", { signal: abort.signal, params: { limit: 1 } });
          if (stopped || run !== generation) return;
          cursor = data.syncCursor; runtime = remember(data.runtime); offset = Date.parse(data.serverTime) - Date.now();
          publishCounts(data.counts); setRevision(data.streamRevision);
        } else {
          let after = cursor, count: NotificationCounts | null = null, more = true;
          const changes: NotificationChanges["changes"] = [];
          let latest: NotificationChanges | null = null;
          while (more) {
            const { data } = await api.get<NotificationChanges>("/monitoring/notifications/changes", { signal: abort.signal, params: { after, limit: 200 } });
            if (stopped || run !== generation) return;
            latest = data; count ??= data.counts; changes.push(...data.changes); after = data.nextCursor; more = data.hasMore;
            if (changes.length > 5000) { resync(); return; }
          }
          if (!latest) return;
          runtime = remember(latest.runtime); offset = Date.parse(latest.serverTime) - Date.now(); cursor = after;
          const events = changes.flatMap(change => change.payload.event ? [change.payload.event] : []);
          const read = changes.flatMap(change => change.kind === "read" ? change.payload.ids ?? [] : []);
          const closed = changes.flatMap(change => change.payload.incident?.status !== "active" && change.payload.incident ? [change.payload.incident.id] : []);
          if (visibleEvents.some(event => read.includes(event.id) || !event.recovery && closed.includes(event.incidentId))) { dismissToast(toastId); visibleEvents = []; }
          delivery.update(events, read, closed);
          const heard = events.filter(event => !read.includes(event.id) && (event.eventType === "recovery" || !closed.includes(event.incidentId)));
          const arrived = Date.now() + offset;
          // Sound follows receipt, independently of toast timing, page focus or visibility.
          const cue = arrivingSound(events.filter(event => !read.includes(event.id)), arrived, { ...runtime, maxDeliveryAgeMs: Math.max(runtime.maxDeliveryAgeMs, hiddenSoundMaxAgeMs) });
          if (cue) void playArrivingSound(cue.ids, runtime.soundCooldownMs, cue.sound, cue.velocity, () => !stopped && run === generation, `pulse-notification-claims:${scope}`);
          if (!document.hidden) delivery.add(heard, arrived, runtime);
          if (count) publishCounts(count); setRevision(latest.streamRevision);
        }
        lastSuccess = Date.now(); setDataKey(viewKey); setAvailable(true);
      } catch {
        if (!stopped) { resync(); setAvailable(false); }
      } finally { busy = false; }
    }
    const tick = setInterval(() => {
      if (document.hidden || !runtime || stopped || !lastSuccess || Date.now() - lastSuccess > 20000) return;
      const now = Date.now() + offset, batch = delivery.take(now, runtime), policy = runtime;
      if (!batch) return;
      const epoch = generation;
      const valid = () => !stopped && epoch === generation && !document.hidden;
      const emit = () => {
        if (!valid()) { delivery.dismissed(now, policy); return; }
        const event = batch.events[0];
        visibleEvents = batch.events.map(item => ({ id: item.id, incidentId: item.incidentId, recovery: item.eventType === "recovery" }));
        toast({ id: toastId, operational: true, lifetime: policy.toastLifetimeMs,
          message: batch.events.length > 1 ? `${batch.events.length} ocorrências em ${batch.targetCount} ${batch.targetCount === 1 ? "serviço" : "serviços"} · ${event.displayName}` : `${event.displayName} · ${notificationMessages[event.messageCode]}`,
          state: event.eventType === "recovery" ? "success" : event.severity === "critical" ? "error" : event.severity === "warning" ? "warning" : "info",
          sound: false, velocity: event.severity === "critical" ? 0.65 : 0.45,
          action: { label: "Ver central", run: () => setOpen(true) },
          onDismiss: () => delivery.dismissed(Date.now() + offset, policy),
        });
      };
      emit();
    }, 250);
    const interval = setInterval(() => void poll(), 10000);
    document.addEventListener("visibilitychange", visibility); window.addEventListener("online", visibility);
    void poll();
    return () => {
      stopped = true; abort.abort(); clearInterval(interval); clearInterval(tick); clear(); setTabProblemIcon(false); refreshRef.current = () => undefined;
      document.removeEventListener("visibilitychange", visibility); window.removeEventListener("online", visibility);
    };
  }, [scope, sessionKey, viewKey]);
  // Access gates are also applied to the visible value, so a logout never exposes cached private counts.
  const visible = !!scope && dataKey === viewKey && (scope === "public" || getAuthController().store.getState().status === "authenticated");
  return <Context.Provider value={{ counts: visible ? counts : { unreadCount: 0, activeCount: 0 }, revision: visible ? revision : "0", scopeKey: viewKey, available: visible && available, open: active && open, setOpen, refresh: () => refreshRef.current(), register }}>{children}</Context.Provider>;
}
