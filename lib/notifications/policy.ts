import { z } from "zod";
import { parseAvailabilityCardRef, formatAvailabilityCardRef } from "../config/availability-card-refs.ts";

export const notificationEventTypes = ["unavailable", "problem", "attention", "recovery"] as const;
export type NotificationEventType = typeof notificationEventTypes[number];
export type NotificationSeverity = "info" | "warning" | "critical";
export type NotificationSound = "notification" | "warning" | "error" | "success";
export const notificationToastPositions = ["bottom-end", "top-end", "header-center"] as const;
export type NotificationToastPosition = (typeof notificationToastPositions)[number];
export const notificationPollMs = 10_000;
export const notificationMaxDeliveryAgeMs = 60_000;
export const notificationVisualGapMs = 10_000;
export const notificationSettingKey = "notifications";

export const notificationTargetRefSchema = z.string().max(60).refine(value => {
  const ref = parseAvailabilityCardRef(value);
  return ref !== null && formatAvailabilityCardRef(ref) === value;
}, "Referência de serviço inválida.");

const eventFlags = z.strictObject({
  unavailable: z.boolean().default(true),
  problem: z.boolean().default(true),
  attention: z.boolean().default(false),
  recovery: z.boolean().default(true),
});
export const notificationOverrideSchema = z.strictObject({
  mode: z.enum(["inherit", "on", "off"]).default("inherit"),
  sound: z.enum(["inherit", "on", "off"]).default("inherit"),
  events: z.strictObject({
    unavailable: z.boolean().optional(), problem: z.boolean().optional(),
    attention: z.boolean().optional(), recovery: z.boolean().optional(),
  }).optional(),
});
export const notificationSettingsSchema = z.strictObject({
  enabled: z.boolean().default(true),
  targetScope: z.enum(["critical", "all"]).default("critical"),
  events: eventFlags.prefault({}),
  minimumProblemSeverity: z.number().int().min(0).max(5).default(4),
  sounds: z.strictObject({
    enabled: z.boolean().default(true),
    targetScope: z.enum(["critical", "all"]).default("critical"),
    unavailable: z.boolean().default(true),
    problem: z.boolean().default(true),
    attention: z.boolean().default(false),
    recovery: z.boolean().default(false),
  }).prefault({}),
  toastPosition: z.enum(notificationToastPositions).default("header-center"),
  toastLifetimeMs: z.number().int().min(4_000).max(15_000).default(8_000),
  soundCooldownMs: z.number().int().min(15_000).max(120_000).default(15_000),
  retentionDays: z.number().int().min(7).max(365).default(30),
  overrides: z.record(notificationTargetRefSchema, notificationOverrideSchema)
    .refine(value => Object.keys(value).length <= 1000, "Limite de exceções excedido.").default({}),
});
export const notificationPolicySchema = notificationSettingsSchema.extend({
  schemaVersion: z.literal(1),
  revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
});
export const notificationPolicyWriteSchema = z.strictObject({
  expectedRevision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER - 1),
  settings: notificationSettingsSchema,
});
export const notificationOverrideWriteSchema = z.strictObject({
  expectedRevision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER - 1),
  override: notificationOverrideSchema.nullable(),
});
export type NotificationPolicy = z.infer<typeof notificationPolicySchema>;
export type NotificationSettings = z.infer<typeof notificationSettingsSchema>;
export type NotificationOverride = z.infer<typeof notificationOverrideSchema>;

export function defaultNotificationPolicy(): NotificationPolicy {
  return notificationPolicySchema.parse({ schemaVersion: 1, revision: 1 });
}

export type NotificationEligibility = {
  targetRef: string;
  critical: boolean;
  monitoringEnabled: boolean;
  eventType: NotificationEventType;
  severity: NotificationSeverity;
  sourceSeverity?: number | null;
  previouslyAnnounced?: boolean;
};

export function notificationDecision(policy: NotificationPolicy, event: NotificationEligibility): {
  enabled: boolean; sound: NotificationSound | false;
} {
  const override = policy.overrides[event.targetRef];
  const scope = override?.mode === "on" || policy.targetScope === "all" || event.critical;
  const eventEnabled = override?.events?.[event.eventType] ?? policy.events[event.eventType];
  const enabled = policy.enabled && event.monitoringEnabled && override?.mode !== "off" && scope && eventEnabled
    && (event.eventType !== "problem" || (event.sourceSeverity != null && event.sourceSeverity >= policy.minimumProblemSeverity))
    && (event.eventType !== "recovery" || event.previouslyAnnounced === true);
  const soundEnabled = enabled && policy.sounds.enabled && override?.sound !== "off"
    && (override?.sound === "on" || policy.sounds.targetScope === "all" || event.critical)
    && policy.sounds[event.eventType];
  const sound = event.eventType === "recovery" ? "success" : event.severity === "critical" ? "error"
    : event.severity === "warning" ? "warning" : "notification";
  return { enabled, sound: soundEnabled ? sound : false };
}

export function notificationRuntime(policy: NotificationPolicy, deliveryRevision: bigint | string) {
  return {
    policyRevision: policy.revision, deliveryRevision: String(deliveryRevision), enabled: policy.enabled,
    toastPosition: policy.toastPosition, toastLifetimeMs: policy.toastLifetimeMs, soundCooldownMs: policy.soundCooldownMs,
    maxDeliveryAgeMs: notificationMaxDeliveryAgeMs, visualGapMs: notificationVisualGapMs,
    refreshAfterMs: notificationPollMs,
  };
}
