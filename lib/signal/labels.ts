import { signalStates } from "../config/signal-targets.ts";

const colors = {
  [signalStates.ok]: "#64d6b0",
  [signalStates.attention]: "#f2c275",
  [signalStates.degraded]: "#ff8585",
  [signalStates.down]: "#ff8585",
  [signalStates.no_data]: "#9daeb9",
} as const;

const labels = {
  [signalStates.ok]: "Disponível",
  [signalStates.attention]: "Atenção",
  [signalStates.degraded]: "Indisponível",
  [signalStates.down]: "Indisponível",
  [signalStates.no_data]: "Sem dados",
} as const;

const tones = {
  [signalStates.ok]: "good",
  [signalStates.attention]: "warn",
  [signalStates.degraded]: "bad",
  [signalStates.down]: "bad",
  [signalStates.no_data]: "unknown",
} as const;

export function signalStateLabel(state: number | null | undefined) {
  if (state === null || state === undefined) return labels[signalStates.no_data];
  return labels[state as keyof typeof labels] ?? labels[signalStates.no_data];
}

export function signalStateTone(state: number | null | undefined) {
  if (state === null || state === undefined) return tones[signalStates.no_data];
  return tones[state as keyof typeof tones] ?? tones[signalStates.no_data];
}

export function signalStateColor(state: number) {
  return colors[state as keyof typeof colors] ?? colors[signalStates.no_data];
}

export function signalWorkersLabel(activeInstances: number | null | undefined, checkedAt: string | null | undefined) {
  if (activeInstances === null || activeInstances === undefined || !checkedAt) return "Sem evidência";
  return activeInstances === 1 ? "1 worker" : `${activeInstances} workers`;
}
