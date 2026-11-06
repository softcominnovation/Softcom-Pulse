import { z } from "zod";
import { availabilityCardRefSchema } from "./availability-card-refs.ts";
import { hostKeySchema, uuidSchema } from "./resources.ts";
import { availabilityCardSizeOptions, availabilityRowModeOptions } from "../dashboard/availability-sizing.ts";
import { overviewSlotsSchema, overviewSlotKeys, canPlaceOverviewBlock, canStackOverviewBlock } from "./overview-slots.ts";

export const blockTypes = ["summary", "highlighted_resources", "problems", "asgard_summary", "resource_card", "host_inventory", "container_inventory", "uptime_list", "signal_flow", "storage_summary"] as const;
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
export const indicatorKeys = ["hosts", "containers_running", "containers_stopped", "problems", "jobs_waiting"] as const;
export const defaultIndicators = ["hosts", "containers_running", "containers_stopped", "problems"] as const;
export type IndicatorKey = typeof indicatorKeys[number];
export const kpiFontScaleOptions = [100, 110, 125, 150] as const;
export const monitorFontScaleOptions = [100, 105, 110, 115, 120, 125, 130, 135, 140, 145, 150, 155, 160, 165, 170, 175, 180, 185, 190, 195, 200] as const;
export const overviewGridModes = ["default", "split", "split_custom"] as const;
export const blockOptionsSchemas = {
  summary: z.strictObject({ indicators: z.array(z.enum(indicatorKeys)).min(1).max(4).refine(unique).default([...defaultIndicators]), fontScalePercent: z.union([z.literal(100), z.literal(110), z.literal(125), z.literal(150)]).default(100) }),
  asgard_summary: z.strictObject({ sortBy: z.enum(["name", "state", "cpu", "memory"]).default("name"), sortDirection: direction, visibleRows: rows, states: z.array(z.enum(["running", "stopped", "paused", "unknown"])).min(1).max(4).refine(unique).default(["running", "stopped", "paused", "unknown"]) }),
  problems: z.strictObject({ sortBy: z.enum(["severity", "recent"]).default("severity"), sortDirection: z.enum(["asc", "desc"]).default("desc"), visibleRows: rows, severities: z.array(z.number().int().min(0).max(5)).min(1).max(6).refine(unique).default([0, 1, 2, 3, 4, 5]) }),
  highlighted_resources: z.strictObject({
    cardSize: z.enum(availabilityCardSizeOptions).default("compact"),
    rowMode: z.enum(availabilityRowModeOptions).optional(),
    sortBy: z.enum(["configured", "name"]).default("configured"),
    sortDirection: direction,
    criticalOnly: z.boolean().default(false),
    // Preserve legacy compact normalization; explicit row modes can use all three rows.
    visibleRows: z.preprocess(value => typeof value === "number" ? Math.min(3, Math.max(1, value)) : value, z.number().int().min(1).max(3)).default(1),
    selection: z.enum(["default", "custom"]).default("default"),
    cards: z.array(availabilityCardRefSchema).max(8).refine(unique).default([]),
  }).transform(options => ({ ...options, visibleRows: options.cardSize === "compact" && options.rowMode === undefined ? Math.min(2, options.visibleRows) : options.visibleRows, ...(options.selection === "default" ? { cards: [] } : {}) })),
  resource_card: z.strictObject({}),
  host_inventory: z.strictObject({ sortBy: z.enum(["name", "state", "cpu", "memory"]).default("name"), sortDirection: direction, visibleRows: rows }),
  container_inventory: z.strictObject({ sortBy: z.enum(["name", "status", "health", "cpu", "memory"]).default("name"), sortDirection: direction, visibleRows: rows, hostKeys: z.array(hostKeySchema).max(32).refine(unique).optional() }),
  uptime_list: z.strictObject({ sortBy: z.enum(["name", "uptime", "state"]).default("name"), sortDirection: direction, visibleRows: rows }),
  signal_flow: z.strictObject({ visibleRows: z.number().int().min(3).max(10).default(4) }),
  storage_summary: z.strictObject({ storageConfigId: uuidSchema, visibleRows: z.number().int().min(1).max(10).default(3) }),
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
  uptime_list: { available: true, uiPhase: 2, label: "Uptime das aplicações", options: blockOptionsSchemas.uptime_list },
  signal_flow: { available: true, uiPhase: 2, label: "Signal · fluxo de processamento", options: blockOptionsSchemas.signal_flow },
  storage_summary: { available: true, uiPhase: 1, label: "Storage · capacidade e recursos", options: blockOptionsSchemas.storage_summary },
};
const blockSchema = z.strictObject({
  id: uuidSchema, type: z.enum(blockTypes), enabled: z.boolean(), width: z.enum(["standard", "wide", "full"]),
  resourceConfigId: uuidSchema.optional(),
  monitorFontScalePercent: z.number().int().min(100).max(200).multipleOf(5).optional(),
  options: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.array(z.string()), z.array(z.number())])).optional(),
}).refine(block => (block.type === "resource_card") === (block.resourceConfigId !== undefined), { path: ["resourceConfigId"], message: "Only resource cards require a resource reference" });
const screenSchema = z.strictObject({
  id: uuidSchema, name: z.string().trim().min(1).max(80), enabled: z.boolean(), layout: z.enum(["overview", "wall"]),
  overviewGrid: z.enum(overviewGridModes).default("default"),
  overviewSlots: overviewSlotsSchema.optional(),
  blocks: z.array(blockSchema).max(24),
}).refine(screen => !screen.enabled || screen.blocks.some(block => block.enabled), { path: ["blocks"], message: "Enabled screen requires an enabled block" });
const fields = {
  schemaVersion: z.union([z.literal(1), z.literal(2)]), defaultTvMode: z.boolean().default(false),
  displayScalePercent: displayScaleSchema.default(defaultDisplayScalePercent),
  dashboardZoomPercent: z.number().int().min(50).max(150).default(100),
  publicMonitorZoomPercent: z.number().int().min(50).max(150).default(100),
  publicMonitorAutoScrollOnLoad: z.boolean().default(true),
  // Hidden unless explicitly enabled in admin; legacy documents omit the field and stay hidden.
  showStatusBanner: z.boolean().default(false),
  idlePresentation: idlePresentationSchema.prefault({}),
  rotation: z.strictObject({ autoStart: z.boolean().default(false), intervalSeconds: z.number().int().min(5).max(300).default(20) }).prefault({}),
  screens: z.array(screenSchema).min(1).max(3),
};
export const presentationSettingsSchema = z.strictObject(fields).superRefine((settings, ctx) => {
  settings.screens.forEach((screen, i) => {
    const custom = screen.layout === "overview" && screen.overviewGrid === "split_custom";
    if (settings.schemaVersion === 1 && (screen.overviewSlots || screen.overviewGrid === "split_custom")) ctx.addIssue({ code: "custom", path: ["screens", i, "overviewGrid"], message: "Espaços configuráveis exigem versão 2." });
    if (custom && !screen.overviewSlots) ctx.addIssue({ code: "custom", path: ["screens", i, "overviewSlots"], message: "Configure os espaços desta tela." });
    const placed = new Set<string>();
    if (screen.overviewSlots) for (const key of overviewSlotKeys) screen.overviewSlots[key].forEach((id, position) => {
      const block = screen.blocks.find(block => block.id === id);
      const path = ["screens", i, "overviewSlots", key, position];
      if (!block) ctx.addIssue({ code: "custom", path, message: "Escolha um bloco desta tela." });
      else if (!canPlaceOverviewBlock(block.type) || screen.overviewSlots![key].length > 1 && !canStackOverviewBlock(block.type)) ctx.addIssue({ code: "custom", path, message: "Este painel não pode ocupar esse espaço." });
      if (placed.has(id)) ctx.addIssue({ code: "custom", path, message: "O painel já ocupa outro espaço." });
      placed.add(id);
    });
    if (custom) screen.blocks.forEach((block, j) => {
      if (block.enabled && block.type !== "summary" && (!canPlaceOverviewBlock(block.type) || !placed.has(block.id))) ctx.addIssue({ code: "custom", path: ["screens", i, "blocks", j], message: canPlaceOverviewBlock(block.type) ? "Escolha um espaço para este painel." : "Este tipo de bloco não é compatível com espaços configuráveis." });
    });
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

const rotationDraftSchema = z.strictObject({
  autoStart: z.boolean(),
  intervalSeconds: z.number().int().min(5).max(300),
});

/** Reading save also stores TV mode and rotation. An invalid interval stays as a draft and keeps the last saved rotation. */
export function withReadingPlayback<T extends Pick<PresentationSettings, "displayScalePercent" | "dashboardZoomPercent" | "showStatusBanner" | "idlePresentation" | "defaultTvMode" | "rotation" | "publicMonitorZoomPercent" | "publicMonitorAutoScrollOnLoad">>(confirmed: T, draft: Partial<Pick<PresentationSettings, "displayScalePercent" | "dashboardZoomPercent" | "showStatusBanner" | "idlePresentation" | "defaultTvMode" | "rotation" | "publicMonitorZoomPercent" | "publicMonitorAutoScrollOnLoad">>): T {
  const rotation = rotationDraftSchema.safeParse(draft.rotation);
  return {
    ...confirmed,
    displayScalePercent: draft.displayScalePercent ?? confirmed.displayScalePercent,
    dashboardZoomPercent: draft.dashboardZoomPercent ?? confirmed.dashboardZoomPercent,
    publicMonitorZoomPercent: draft.publicMonitorZoomPercent ?? confirmed.publicMonitorZoomPercent,
    publicMonitorAutoScrollOnLoad: draft.publicMonitorAutoScrollOnLoad ?? confirmed.publicMonitorAutoScrollOnLoad,
    showStatusBanner: draft.showStatusBanner ?? confirmed.showStatusBanner,
    idlePresentation: draft.idlePresentation ?? confirmed.idlePresentation,
    defaultTvMode: draft.defaultTvMode ?? confirmed.defaultTvMode,
    rotation: rotation.success ? rotation.data : confirmed.rotation,
  };
}

export function initialPresentation(newId: () => string): PresentationDocument {
  return { schemaVersion: 2, revision: 1, defaultTvMode: false, displayScalePercent: defaultDisplayScalePercent, dashboardZoomPercent: 100, publicMonitorZoomPercent: 100, publicMonitorAutoScrollOnLoad: true, showStatusBanner: false, idlePresentation: idlePresentationSchema.parse({}), rotation: { autoStart: false, intervalSeconds: 20 }, screens: [{
    id: newId(), name: "Visão geral", enabled: true, layout: "overview", overviewGrid: "default",
    blocks: defaultDashboardBlocks.map(block => ({ id: newId(), ...block, enabled: true, options: effectiveOptions(block) })),
  }] };
}
