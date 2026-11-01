import "server-only";
import { presentationDocumentSchema } from "../../config/presentation.ts";
import { publicGet } from "../monitoring/public-handlers.ts";

export async function initialPublicMonitorZoom(host: string, reader = publicGet) {
  try {
    const response = await reader(new Request("http://" + host + "/api/public/settings/presentation", { headers: { Host: host } }), ["settings", "presentation"]);
    if (!response.ok) return 100;
    return presentationDocumentSchema.parse((await response.json()).data).publicMonitorZoomPercent;
  } catch { return 100; }
}
