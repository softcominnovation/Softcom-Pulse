export type MonitorScrollController = { sync(): void; capture(): void; setPaused(paused: boolean): void; destroy(): void };

declare global {
  interface Window {
    PulseMonitorAutoScroll?: {
      attach(root: HTMLElement, options?: { paused?: boolean }): MonitorScrollController;
      isAutomatic(target: EventTarget | null): boolean;
    };
  }
}

export function isAutomaticScroll(event: Event) {
  return event.type === "scroll" && typeof window !== "undefined" && window.PulseMonitorAutoScroll?.isAutomatic(event.target) === true;
}
