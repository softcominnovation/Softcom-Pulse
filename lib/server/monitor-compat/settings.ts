import "server-only";
import { presentationDocumentSchema } from "../../config/presentation.ts";
import { publicGet } from "../monitoring/public-handlers.ts";

export async function initialPublicMonitorSettings(host: string, reader = publicGet) {
  const fallback = { publicMonitorZoomPercent: 100, publicMonitorAutoScrollOnLoad: true };
  try {
    const response = await reader(new Request("http://" + host + "/api/public/settings/presentation", { headers: { Host: host } }), ["settings", "presentation"]);
    if (!response.ok) return fallback;
    const settings = presentationDocumentSchema.parse((await response.json()).data);
    return { publicMonitorZoomPercent: settings.publicMonitorZoomPercent, publicMonitorAutoScrollOnLoad: settings.publicMonitorAutoScrollOnLoad };
  } catch { return fallback; }
}
