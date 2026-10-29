import { z } from "zod";

export const availabilityCardKinds = ["resource", "external_service", "standalone_vps", "signal_target", "storage", "signal_service"] as const;
export type AvailabilityCardKind = (typeof availabilityCardKinds)[number];
export type AvailabilityCardRef = { kind: AvailabilityCardKind; id: string };

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function formatAvailabilityCardRef(ref: AvailabilityCardRef): string {
  return `${ref.kind}:${ref.id}`;
}

export function parseAvailabilityCardRef(value: string): AvailabilityCardRef | null {
  const index = value.indexOf(":");
  if (index <= 0) return null;
  const kind = value.slice(0, index);
  const id = value.slice(index + 1).trim().toLowerCase();
  if (!(availabilityCardKinds as readonly string[]).includes(kind) || !uuidPattern.test(id)) return null;
  return { kind: kind as AvailabilityCardKind, id };
}

export const availabilityCardRefSchema = z.string().superRefine((value, ctx) => {
  if (!parseAvailabilityCardRef(value)) ctx.addIssue({ code: "custom", message: "Referência de card inválida." });
}).transform(value => formatAvailabilityCardRef(parseAvailabilityCardRef(value)!));
