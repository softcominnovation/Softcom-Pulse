import type { NotificationEventView, NotificationChanges } from "./contracts.ts";

type Runtime = NotificationChanges["runtime"];
/** Device-local delivery only. Durable incident and read state always come from the BFF. */
export class NotificationDelivery {
  private groups: { at: number; events: Map<string, NotificationEventView> }[] = [];
  private seen = new Set<string>();
  private active = false;
  private nextVisual = 0;
  private nextSound = 0;
  reset() { this.groups = []; this.active = false; }
  update(events: NotificationEventView[], readIds: string[] = [], closedIds: string[] = []) {
    const latest = new Map(events.map(event => [event.id, event]));
    for (const group of this.groups) for (const [id, old] of group.events) {
      const event = latest.get(id) ?? old;
      if (readIds.includes(id) || closedIds.includes(event.incidentId) || !event.toastEligible || event.readAt) group.events.delete(id);
      else group.events.set(id, event);
    }
    this.groups = this.groups.filter(group => group.events.size);
  }
  add(events: NotificationEventView[], now: number, runtime: Runtime) {
    const fresh = events.filter(event => !this.seen.has(event.id) && event.announce && event.toastEligible && !event.readAt
      && (event.eventType === "recovery" || event.incidentStatus === "active")
      && now >= Date.parse(event.createdAt) && now - Date.parse(event.createdAt) <= runtime.maxDeliveryAgeMs);
    for (const event of events) this.seen.add(event.id);
    if (this.seen.size > 5000) this.seen = new Set([...this.seen].slice(-2500));
    if (!fresh.length || !runtime.enabled) return;
    let group = this.groups.at(-1);
    if (!group || now - group.at > 2000) {
      if (!group || this.groups.length < 3) { group = { at: now, events: new Map() }; this.groups.push(group); }
    }
    for (const event of fresh) group.events.set(event.id, event);
  }
  take(now: number, runtime: Runtime) {
    if (this.active || now < this.nextVisual) return null;
    while (this.groups.length) {
      const group = this.groups[0];
      if (now < group.at + 2000) return null;
      this.groups.shift();
      const events = [...group.events.values()].filter(event => now - Date.parse(event.createdAt) <= runtime.maxDeliveryAgeMs);
      if (!events.length) continue;
      events.sort((a, b) => ({ critical: 3, warning: 2, info: 1 }[b.severity] - { critical: 3, warning: 2, info: 1 }[a.severity]));
      this.active = true;
      const sound = now >= this.nextSound ? events.find(event => event.sound)?.sound ?? false : false;
      if (sound) this.nextSound = now + runtime.soundCooldownMs;
      return { events, sound, targetCount: new Set(events.map(event => event.targetRef)).size };
    }
    return null;
  }
  dismissed(now: number, runtime: Runtime) { this.active = false; this.nextVisual = now + runtime.visualGapMs; }
}

const severityRank = { critical: 3, warning: 2, info: 1 } as const
/** A background poll can be late. The on-screen toast keeps the shorter window. */
export const hiddenSoundMaxAgeMs = 180_000

export function arrivingSound(events: NotificationEventView[], now: number, runtime: Runtime) {
  const fresh = events.filter(event => event.announce && event.toastEligible && !event.readAt
    && (event.eventType === "recovery" || event.incidentStatus === "active")
    && now >= Date.parse(event.createdAt) && now - Date.parse(event.createdAt) <= runtime.maxDeliveryAgeMs)
  if (!fresh.length || !runtime.enabled) return null
  fresh.sort((a, b) => severityRank[b.severity] - severityRank[a.severity])
  const sound = fresh.find(event => event.sound)?.sound
  if (!sound) return null
  return { sound, velocity: fresh[0].severity === "critical" ? 0.65 : 0.45, ids: fresh.map(event => event.id) }
}
