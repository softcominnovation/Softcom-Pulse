import { type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { storageUiFixture } from "../fixtures/storage";
import { id } from "../fixtures/dashboard";
import { effectiveOptions, type PresentationDocument } from "../../lib/config/presentation";
import type { Overview, ReadResult } from "../../lib/monitoring/contracts";

export async function slotUiFixture(page: Page) {
  const storage = await storageUiFixture(page), state = storage.admin;
  const model = JSON.parse(execFileSync(process.execPath, ["--conditions=react-server", "--input-type=module", "-e", "import{monitorFixture}from'./tests/fixtures/monitor-compat.mjs';process.stdout.write(JSON.stringify(monitorFixture({cardSize:'expanded'})));"], { encoding: "utf8", windowsHide: true })) as { document: PresentationDocument; overview: ReadResult<Overview> };
  model.document.screens = [model.document.screens[0]];
  state.document = model.document; state.document.rotation.autoStart = false; state.document.defaultTvMode = false; state.document.publicMonitorAutoScrollOnLoad = false;
  state.document.displayScalePercent = 100; state.document.dashboardZoomPercent = 70; state.document.publicMonitorZoomPercent = 70;
  const screen = state.document.screens[0], find = (type: string) => screen.blocks.find(block => block.type === type)!;
  find("storage_summary").options!.storageConfigId = storage.items[0].configId!;
  model.overview.data.blocks.find(block => block.type === "storage_summary")!.data = { target: storage.items[0] };
  screen.blocks.push({ id: id(8200), type: "problems", enabled: true, width: "wide", options: effectiveOptions({ type: "problems" }) });
  model.overview.data.blocks.push({ blockId: id(8200), type: "problems", availability: "ready", stale: false, lastUpdated: model.overview.lastUpdated, data: model.overview.data.problems });
  find("highlighted_resources").options = { ...find("highlighted_resources").options, rowMode: "manual", visibleRows: 3 };
  screen.overviewGrid = "split_custom";
  screen.overviewSlots = { topLeft: [find("highlighted_resources").id], topRight: [find("signal_flow").id, find("storage_summary").id], bottomLeft: [find("asgard_summary").id], bottomRight: [find("problems").id] };
  const aggregate = (screenId: string | null) => {
    const current = state.document.screens.find(screen => screen.id === screenId) ?? state.document.screens[0];
    return { ...model.overview, data: { ...model.overview.data, screenId: current.id, presentationRevision: state.document.revision, blocks: current.blocks.filter(block => block.enabled).map(block => ({ ...model.overview.data.blocks.find(item => item.blockId === block.id) ?? model.overview.data.blocks.find(item => item.type === block.type)!, blockId: block.id, options: block.options })) } };
  };
  for (const pattern of ["**/api/dashboard/overview*", "**/api/public/dashboard/overview*"]) await page.route(pattern, route => route.fulfill({ json: aggregate(new URL(route.request().url()).searchParams.get("screenId")) }));
  await page.route("**/api/public/settings/presentation", route => route.fulfill({ json: { data: state.document } }));
  return { state, screen, find, storage, model };
}
