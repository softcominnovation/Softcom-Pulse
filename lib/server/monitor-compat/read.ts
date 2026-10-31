import "server-only";
import { z } from "zod";
import { presentationDocumentSchema, blockCatalog, blockTypes, type PresentationDocument } from "../../config/presentation.ts";
import { uuidSchema } from "../../config/resources.ts";
import type { Overview, ReadResult } from "../../monitoring/contracts.ts";
import { isPublicHost } from "../auth/public-hosts.ts";
import { authJson } from "../auth/errors.ts";
import { publicGet } from "../monitoring/public-handlers.ts";

const querySchema = z.object({ screenId: uuidSchema.optional(), layout: z.enum(["overview", "wall"]).optional(), tv: z.enum(["0", "1"]).optional(), theme: z.enum(["dark", "light"]).optional() });
const availability = z.enum(["ready", "no_data", "unavailable"]);
const observedAt = z.iso.datetime({ offset: true }).nullable();
const overviewEnvelopeSchema = z.object({
  availability, stale: z.boolean(), lastUpdated: observedAt, refreshAfterMs: z.number().finite().positive(),
  data: z.object({
    screenId: uuidSchema, presentationRevision: z.number().int().positive(),
    blocks: z.array(z.object({ blockId: uuidSchema, type: z.enum(blockTypes), availability, stale: z.boolean(), lastUpdated: observedAt, data: z.unknown() })).max(24),
  }),
});

export type CompatibleMonitor = {
  document: PresentationDocument;
  screens: PresentationDocument["screens"];
  screen: PresentationDocument["screens"][number];
  overview: ReadResult<Overview> | null;
  error: string | null;
  layout: "overview" | "wall";
  tv: boolean;
  theme: "dark" | "light";
  now: number;
  refreshAfterMs: number;
};

function publicRequest(request: Request, path: string) {
  return new Request(new URL(path, request.url), { headers: { Host: request.headers.get("host") ?? "" } });
}

export async function readCompatibleMonitor(request: Request, reader = publicGet): Promise<CompatibleMonitor | Response> {
  if (!isPublicHost(request)) return authJson({ error: { code: "host_not_allowed" } }, 403);
  const query = new URL(request.url).searchParams;
  const parsed = querySchema.safeParse(Object.fromEntries(query));
  if (!parsed.success || new Set(query.keys()).size !== [...query.keys()].length) return authJson({ error: { code: "invalid_request" } }, 400);
  const { screenId, layout, tv, theme } = parsed.data;
  const configuration = await reader(publicRequest(request, "/api/public/settings/presentation"), ["settings", "presentation"]);
  if (!configuration.ok) return configuration;
  const document = presentationDocumentSchema.parse((await configuration.json()).data);
  const screens = document.screens.filter(screen => screen.enabled && screen.blocks.some(block => block.enabled && blockCatalog[block.type].available));
  const screen = screens.find(item => item.id === screenId) ?? screens[0];
  if (!screen) return authJson({ error: { code: "no_playable_screen" } }, 503);
  let overview: ReadResult<Overview> | null = null, error: string | null = null;
  try {
    const response = await reader(publicRequest(request, "/api/public/dashboard/overview?screenId=" + encodeURIComponent(screen.id)), ["dashboard", "overview"]);
    if (!response.ok) throw new Error("Overview unavailable");
    const candidate: unknown = await response.json();
    overviewEnvelopeSchema.parse(candidate);
    const validated = candidate as ReadResult<Overview>;
    if (validated.data.screenId !== screen.id || validated.data.presentationRevision !== document.revision) error = "A apresentação mudou. A atualização será tentada novamente.";
    else overview = validated;
  } catch { error = "Não foi possível atualizar os dados. Tente novamente."; }
  return { document, screens, screen, overview, error, layout: layout === "overview" || layout === "wall" ? layout : screen.layout, tv: tv ? tv === "1" : document.defaultTvMode, theme: theme === "light" ? "light" : "dark", now: Date.now(), refreshAfterMs: Math.max(5000, Math.min(60000, overview?.refreshAfterMs ?? 20000)) };
}
