import { z } from "zod";
import { hostKeySchema, uuidSchema } from "./resources.ts";

export const blockTypes = ["summary", "highlighted_resources", "problems", "asgard_summary", "resource_card", "host_inventory", "container_inventory"] as const;
export type BlockType = typeof blockTypes[number];
export const displayScaleOptions = [100, 110, 120, 125] as const;
export const defaultDisplayScalePercent = 110;
export const displayScaleSchema = z.union([z.literal(100), z.literal(110), z.literal(120), z.literal(125)]);
export type DisplayScalePercent = z.infer<typeof displayScaleSchema>;
export const idlePresentationSchema = z.strictObject({
  enabled: z.boolean().default(false),
  afterMinutes: z.number().int().min(1).max(120).default(5),
  requestFullscreen: z.boolean().default(true),
});
export type IdlePresentation = z.infer<typeof idlePresentationSchema>;
const direction = z.enum(["asc", "desc"]).default("asc");
const rows = z.number().int().min(3).max(10).default(6);
const unique = <T>(values: T[]) => new Set(values).size === values.length;
export const indicatorKeys = ["hosts", "containers_running", "containers_stopped", "problems"] as const;
export const blockOptionsSchemas = {
  summary: z.strictObject({ indicators: z.array(z.enum(indicatorKeys)).min(1).max(4).refine(unique).default([...indicatorKeys]) }),
  asgard_summary: z.strictObject({ sortBy: z.enum(["name", "state", "cpu", "memory"]).default("name"), sortDirection: direction, visibleRows: rows, states: z.array(z.enum(["running", "stopped", "paused", "unknown"])).min(1).max(4).refine(unique).default(["running", "stopped", "paused", "unknown"]) }),
  problems: z.strictObject({ sortBy: z.enum(["severity", "recent"]).default("severity"), sortDirection: z.enum(["asc", "desc"]).default("desc"), visibleRows: rows, severities: z.array(z.number().int().min(0).max(5)).min(1).max(6).refine(unique).default([0, 1, 2, 3, 4, 5]) }),
  highlighted_resources: z.strictObject({ sortBy: z.enum(["configured", "name"]).default("configured"), sortDirection: direction, criticalOnly: z.boolean().default(false), visibleRows: z.number().int().min(1).max(3).default(1) }),
  resource_card: z.strictObject({}),
  host_inventory: z.strictObject({ sortBy: z.enum(["name", "state", "cpu", "memory"]).default("name"), sortDirection: direction, visibleRows: rows }),
  container_inventory: z.strictObject({ sortBy: z.enum(["name", "status", "health", "cpu", "memory"]).default("name"), sortDirection: direction, visibleRows: rows, hostKeys: z.array(hostKeySchema).max(32).refine(unique).optional() }),
};
export type OptionsByType = { [K in BlockType]: z.infer<typeof blockOptionsSchemas[K]> };
export type BlockOptions = OptionsByType[BlockType];
export function effectiveOptions<K extends BlockType>(block: { type: K; options?: unknown }): OptionsByType[K] {
  return blockOptionsSchemas[block.type].parse(block.options ?? {}) as OptionsByType[K];
}
export const blockCatalog = {
  summary: { available: true, uiPhase: 5, label: "Indicadores", options: blockOptionsSchemas.summary },
  highlighted_resources: { available: true, uiPhase: 5, label: "Serviços destacados", options: blockOptionsSchemas.highlighted_resources },
  problems: { available: true, uiPhase: 5, label: "Problemas ativos", options: blockOptionsSchemas.problems },
  asgard_summary: { available: true, uiPhase: 5, label: "ASGARD e VMs", options: blockOptionsSchemas.asgard_summary },
  resource_card: { available: true, uiPhase: 5, label: "Recurso individual", options: blockOptionsSchemas.resource_card },
  host_inventory: { available: true, uiPhase: 6, label: "Hosts", options: blockOptionsSchemas.host_inventory },
  container_inventory: { available: true, uiPhase: 7, label: "Containers", options: blockOptionsSchemas.container_inventory },
};
const blockSchema = z.strictObject({
  id: uuidSchema, type: z.enum(blockTypes), enabled: z.boolean(), width: z.enum(["standard", "wide", "full"]),
  resourceConfigId: uuidSchema.optional(),
  options: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.array(z.string()), z.array(z.number())])).optional(),
}).refine(block => (block.type === "resource_card") === (block.resourceConfigId !== undefined), { path: ["resourceConfigId"], message: "Only resource cards require a resource reference" });
const screenSchema = z.strictObject({
  id: uuidSchema, name: z.string().trim().min(1).max(80), enabled: z.boolean(), layout: z.enum(["overview", "wall"]), blocks: z.array(blockSchema).max(24),
}).refine(screen => !screen.enabled || screen.blocks.some(block => block.enabled), { path: ["blocks"], message: "Enabled screen requires an enabled block" });
const fields = {
  schemaVersion: z.union([z.literal(1), z.literal(2)]), defaultTvMode: z.boolean().default(false),
  displayScalePercent: displayScaleSchema.default(defaultDisplayScalePercent),
  idlePresentation: idlePresentationSchema.prefault({}),
  rotation: z.strictObject({ autoStart: z.boolean().default(false), intervalSeconds: z.number().int().min(5).max(300).default(20) }).prefault({}),
  screens: z.array(screenSchema).min(1).max(3),
};
export const presentationSettingsSchema = z.strictObject(fields).superRefine((settings, ctx) => {
  settings.screens.forEach((screen, i) => {
    if (settings.schemaVersion === 2 && screen.blocks.filter(block => block.enabled).length > 6) ctx.addIssue({ code: "custom", path: ["screens", i, "blocks"], message: "Use até seis blocos habilitados por tela." });
    screen.blocks.forEach((block, j) => {
      const path = ["screens", i, "blocks", j, "options"];
      if (settings.schemaVersion === 1) {
        if (block.options !== undefined) ctx.addIssue({ code: "custom", path, message: "Opções exigem versão 2." });
      } else if (block.options === undefined) ctx.addIssue({ code: "custom", path, message: "Informe as opções do bloco." });
      else {
        const result = blockOptionsSchemas[block.type].safeParse(block.options);
        if (!result.success) for (const issue of result.error.issues) ctx.addIssue({ code: "custom", path: [...path, ...issue.path], message: "Opção inválida para este bloco." });
      }
    });
  });
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
  return { schemaVersion: 2, revision: 1, defaultTvMode: false, displayScalePercent: defaultDisplayScalePercent, idlePresentation: idlePresentationSchema.parse({}), rotation: { autoStart: false, intervalSeconds: 20 }, screens: [{
    id: newId(), name: "Visão geral", enabled: true, layout: "overview",
    blocks: defaultDashboardBlocks.map(block => ({ id: newId(), ...block, enabled: true, options: effectiveOptions(block) })),
  }] };
}
