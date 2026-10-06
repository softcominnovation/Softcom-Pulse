import { z } from "zod";
import { uuidSchema } from "./resources.ts";

export const blockTypes = ["summary", "highlighted_resources", "problems", "asgard_summary", "resource_card", "host_inventory", "container_inventory"] as const;
export type BlockType = typeof blockTypes[number];
export const blockCatalog: Record<BlockType, { available: boolean; uiPhase: number }> = {
  summary: { available: true, uiPhase: 5 }, highlighted_resources: { available: true, uiPhase: 5 },
  problems: { available: true, uiPhase: 5 }, asgard_summary: { available: true, uiPhase: 5 },
  resource_card: { available: true, uiPhase: 5 }, host_inventory: { available: true, uiPhase: 6 },
  container_inventory: { available: false, uiPhase: 7 },
};
const blockSchema = z.strictObject({
  id: uuidSchema, type: z.enum(blockTypes), enabled: z.boolean(), width: z.enum(["standard", "wide", "full"]),
  resourceConfigId: uuidSchema.optional(),
}).refine(block => (block.type === "resource_card") === (block.resourceConfigId !== undefined), { path: ["resourceConfigId"], message: "Only resource cards require a resource reference" });
const screenSchema = z.strictObject({
  id: uuidSchema, name: z.string().trim().min(1).max(80), enabled: z.boolean(), layout: z.enum(["overview", "wall"]), blocks: z.array(blockSchema).max(24),
}).refine(screen => !screen.enabled || screen.blocks.some(block => block.enabled), { path: ["blocks"], message: "Enabled screen requires an enabled block" });
const fields = {
  schemaVersion: z.literal(1), defaultTvMode: z.boolean().default(false),
  rotation: z.strictObject({ autoStart: z.boolean().default(false), intervalSeconds: z.number().int().min(5).max(300).default(20) }).prefault({}),
  screens: z.array(screenSchema).min(1).max(3),
};
export const presentationSettingsSchema = z.strictObject(fields).superRefine((settings, ctx) => {
  if (!settings.screens.some(screen => screen.enabled)) ctx.addIssue({ code: "custom", path: ["screens"], message: "Enable at least one screen" });
  const ids = settings.screens.flatMap(screen => [screen.id, ...screen.blocks.map(block => block.id)]);
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: "custom", path: ["screens"], message: "Screen and block IDs must be unique" });
  if (settings.rotation.autoStart && settings.screens.filter(screen => screen.enabled && screen.blocks.some(block => block.enabled && blockCatalog[block.type].available)).length < 2) {
    ctx.addIssue({ code: "custom", path: ["rotation", "autoStart"], message: "Automatic rotation requires two available screens" });
  }
});
export const presentationWriteSchema = z.strictObject({ expectedRevision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER - 1), settings: presentationSettingsSchema });
export const presentationDocumentSchema = presentationSettingsSchema.safeExtend({ revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) });
export type PresentationSettings = z.infer<typeof presentationSettingsSchema>;
export type PresentationDocument = z.infer<typeof presentationDocumentSchema>;
export type PresentationBlock = z.infer<typeof blockSchema>;
export type PresentationResult = { data: PresentationDocument; updatedAt: string };

export const defaultDashboardBlocks = [
  { type: "summary", width: "full" },
  { type: "highlighted_resources", width: "full" },
  { type: "asgard_summary", width: "wide" },
  { type: "problems", width: "wide" },
] as const;

export function initialPresentation(newId: () => string): PresentationDocument {
  return { schemaVersion: 1, revision: 1, defaultTvMode: false, rotation: { autoStart: false, intervalSeconds: 20 }, screens: [{
    id: newId(), name: "Visão geral", enabled: true, layout: "overview",
    blocks: defaultDashboardBlocks.map(block => ({ id: newId(), ...block, enabled: true })),
  }] };
}
