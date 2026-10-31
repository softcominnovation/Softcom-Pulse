import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { effectiveOptions } from "../../lib/config/presentation.ts";
import { buildDemoOverview, buildDemoPresentation, buildDemoSignalTargets } from "../../lib/server/monitoring/demo-data.ts";
import { compatibleMonitorState, renderCompatibleContent, renderCompatiblePage } from "../../lib/server/monitor-compat/render.ts";

// This scenario explicitly configures both panels; product defaults need not include Signal.
export function buildScrollableMonitorFixture() {
  const document = buildDemoPresentation().data, screen = document.screens[0];
  const overview = buildDemoOverview(screen.id);
  const envelope = overview.data.blocks[0];
  const availability = overview.data.blocks.find(block => block.type === "highlighted_resources").data;
  const asgard = overview.data.asgardSummary;
  if (!asgard.vms.length) throw new Error("Scrollable monitor fixture requires demo VMs");
  const vms = asgard.vms;
  // Repeated read-only rows make the inventory overflow independently of demo inventory size.
  asgard.vms = Array.from({ length: 40 }, (_, index) => vms[index % vms.length]);
  screen.blocks = [
    ["summary", "full"], ["highlighted_resources", "full"], ["asgard_summary", "wide"], ["signal_flow", "wide"],
  ].map(([type, width]) => ({ id: randomUUID(), type, width, enabled: true, options: effectiveOptions({ type }) }));
  const payloads = {
    summary: overview.data.summary,
    highlighted_resources: availability,
    asgard_summary: asgard,
    signal_flow: { target: buildDemoSignalTargets()[0] },
  };
  if (!payloads.signal_flow.target) throw new Error("Scrollable monitor fixture requires a demo Signal target");
  overview.data.blocks = screen.blocks.map(block => ({ ...envelope, blockId: block.id, type: block.type, options: block.options, data: payloads[block.type] }));
  return { document, screens: document.screens, screen, overview, error: null, layout: "overview", tv: false, theme: "dark", now: Date.now(), refreshAfterMs: 60000 };
}

// The runtime suite has no react-server condition. Only this fixture subprocess needs it.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const model = buildScrollableMonitorFixture();
  process.stdout.write(JSON.stringify({
    page: renderCompatiblePage(model, "Softcom Pulse"),
    snapshot: { html: renderCompatibleContent(model), state: compatibleMonitorState(model) },
  }));
}
