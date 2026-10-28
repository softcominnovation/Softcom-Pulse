import type { NotificationToastPosition } from "./policy.ts";

let place: NotificationToastPosition = "header-center";
const listeners = new Set<(place: NotificationToastPosition) => void>();

export function operationalToastPlace() {
  return place;
}

export function setOperationalToastPlace(next: NotificationToastPosition) {
  if (place === next) return;
  place = next;
  for (const listener of listeners) listener(place);
}

export function subscribeOperationalToastPlace(listener: (place: NotificationToastPosition) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
