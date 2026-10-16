export type InstanceProvider = "meta" | "evolution";
export type InstanceStatus = "good" | "warn" | "bad" | "unknown";

export interface InstanceDefinition {
  id: string;
  name: string;
  provider: InstanceProvider;
  number?: string;
  externalId?: string;
  demo?: boolean;
}

export const defaultInstances: readonly InstanceDefinition[] = [
  { id: "meta-atendimento", name: "Atendimento", provider: "meta", demo: true },
  { id: "meta-comercial", name: "Comercial", provider: "meta", demo: true },
  { id: "evolution-suporte", name: "Suporte", provider: "evolution", demo: true },
  { id: "evolution-financeiro", name: "Financeiro", provider: "evolution", demo: true },
  { id: "evolution-relacionamento", name: "Relacionamento", provider: "evolution", demo: true },
  { id: "meta-campanhas", name: "Campanhas", provider: "meta", demo: true },
];

export interface Phone extends InstanceDefinition {
  index: number;
  status: InstanceStatus;
  quality: "Sem dados" | "Baixa" | "Alta" | "Não se aplica";
  sessionLabel: string;
  delivery: string;
  enabledLabel: string;
  failedMessages: number | null;
  attemptedMessages: number | null;
  failureRate: number | null;
  failures: string;
  evidence: string;
  evidenceSource: string;
}

export interface InstanceDraft {
  name: string;
  provider: InstanceProvider;
  number?: string;
  externalId?: string;
}

export const INSTANCE_STORAGE_KEY = "softcom-pulse-whatsapp-instances";

const phoneDeliveries = ["há 12 s", "há 28 s", "há 8 s", "há 1 min", "há 42 s", "há 2 min"] as const;

export const statusLabels: Record<InstanceStatus, string> = {
  good: "Operacional",
  warn: "Atenção",
  bad: "Crítico",
  unknown: "Sem dados",
};

export const statusTone: Record<InstanceStatus, "positive" | "warning" | "negative" | "neutral"> = {
  good: "positive",
  warn: "warning",
  bad: "negative",
  unknown: "neutral",
};

function decimal(value: number): string {
  return value.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

function formatAge(seconds: number): string {
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))} s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return secs > 0 ? `${mins} min ${secs} s` : `${mins} min`;
}

export function evaluateInstances(
  definitions: readonly InstanceDefinition[] = defaultInstances,
  elapsedSeconds = 0
): Phone[] {
  const internalTime = Math.max(0, Math.floor(elapsedSeconds));
  return definitions.map((definition, index) => {
    const pending = definition.demo !== true;
    const meta = definition.provider === "meta";
    const seedIndex = Math.max(0, defaultInstances.findIndex((instance) => instance.id === definition.id));
    const baseAttempted = pending ? null : 24 + seedIndex * 12 + Math.floor(internalTime / (2 + seedIndex));
    const failedMessages = pending ? null : 0;
    const failureRate =
      failedMessages === null || baseAttempted === null || baseAttempted === 0
        ? null
        : (failedMessages / baseAttempted) * 100;
    const deliveryAge = (12 + seedIndex * 7 + internalTime) % (23 + seedIndex * 9);

    return {
      ...definition,
      index,
      status: pending ? "unknown" : "good",
      quality: !meta ? "Não se aplica" : pending ? "Sem dados" : "Alta",
      sessionLabel: meta ? "Não se aplica" : pending ? "Aguardando integração" : "Conectada",
      delivery: pending
        ? "Aguardando integração"
        : internalTime > 0
          ? `há ${formatAge(deliveryAge)}`
          : phoneDeliveries[seedIndex % phoneDeliveries.length]!,
      enabledLabel: !meta ? "Não se aplica" : pending ? "Aguardando integração" : "Habilitado",
      failedMessages,
      attemptedMessages: baseAttempted,
      failureRate,
      failures: failureRate === null ? "—" : `${decimal(failureRate)}% · ${failedMessages} / ${baseAttempted}`,
      evidence: pending ? "Sem coleta" : "Há 30 s",
      evidenceSource: pending
        ? "Integração pendente"
        : meta
          ? "Meta · API + webhooks monitorados"
          : "Evolution · estado da sessão monitorado",
    };
  });
}

function clean(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().replace(/\s+/g, " ");
  return trimmed ? trimmed : undefined;
}

function slug(value: string): string {
  const base = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || "instancia";
}

function isProvider(value: unknown): value is InstanceProvider {
  return value === "meta" || value === "evolution";
}

function sanitizeStoredInstance(value: unknown): InstanceDefinition | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  const id = clean(candidate.id);
  const name = clean(candidate.name);
  if (!id || !name || !isProvider(candidate.provider)) return null;
  const number = clean(candidate.number);
  const externalId = clean(candidate.externalId);
  const demo = candidate.demo === true;
  return {
    id,
    name,
    provider: candidate.provider,
    ...(number ? { number } : {}),
    ...(externalId ? { externalId } : {}),
    ...(demo ? { demo: true } : {}),
  };
}

export function cloneDefaultInstances(): InstanceDefinition[] {
  return defaultInstances.map((instance) => ({ ...instance }));
}

export function readStoredInstances(storage?: Pick<Storage, "getItem"> | null): InstanceDefinition[] {
  if (!storage) return cloneDefaultInstances();
  try {
    const raw = storage.getItem(INSTANCE_STORAGE_KEY);
    if (!raw) return cloneDefaultInstances();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return cloneDefaultInstances();
    const seen = new Set<string>();
    const instances: InstanceDefinition[] = [];
    for (const item of parsed) {
      const sanitized = sanitizeStoredInstance(item);
      if (!sanitized || seen.has(sanitized.id)) continue;
      seen.add(sanitized.id);
      instances.push(sanitized);
    }
    return instances;
  } catch {
    return cloneDefaultInstances();
  }
}

export function writeStoredInstances(
  storage: Pick<Storage, "setItem"> | null | undefined,
  instances: readonly InstanceDefinition[]
): void {
  if (!storage) return;
  try {
    storage.setItem(INSTANCE_STORAGE_KEY, JSON.stringify(instances));
  } catch {
    // Storage failures must not block monitoring UI interactions.
  }
}

export function normalizeInstanceInput(input: InstanceDraft): InstanceDraft | null {
  const name = clean(input.name);
  if (!name || !isProvider(input.provider)) return null;
  const number = clean(input.number);
  const externalId = clean(input.externalId);
  return {
    name,
    provider: input.provider,
    ...(number ? { number } : {}),
    ...(externalId ? { externalId } : {}),
  };
}

export function createInstanceDefinition(
  existing: readonly InstanceDefinition[],
  input: InstanceDraft
): InstanceDefinition {
  const normalized = normalizeInstanceInput(input);
  if (!normalized) throw new Error("Invalid WhatsApp instance input");
  const baseId = `${normalized.provider}-${slug(normalized.name)}`;
  const ids = new Set(existing.map((instance) => instance.id));
  let id = baseId;
  let suffix = 2;
  while (ids.has(id)) {
    id = `${baseId}-${suffix}`;
    suffix += 1;
  }
  return { id, ...normalized, demo: false };
}

export function updateInstanceDefinition(
  existing: readonly InstanceDefinition[],
  id: string,
  input: InstanceDraft
): InstanceDefinition[] {
  const normalized = normalizeInstanceInput(input);
  if (!normalized) return [...existing];
  return existing.map((instance) => {
    if (instance.id !== id) return instance;
    return {
      id: instance.id,
      ...normalized,
      ...(instance.demo ? { demo: true } : {}),
    };
  });
}

export function removeInstanceDefinition(
  existing: readonly InstanceDefinition[],
  id: string
): InstanceDefinition[] {
  return existing.filter((instance) => instance.id !== id);
}

export function resetInstanceDefinitions(): InstanceDefinition[] {
  return cloneDefaultInstances();
}
