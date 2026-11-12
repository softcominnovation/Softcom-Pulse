import { expect, test } from "@playwright/test";
import { adminFixture } from "../fixtures/admin";
import { id, overview } from "../fixtures/dashboard";
import { signIn } from "../fixtures/infrastructure";
import { notificationRuntime, defaultNotificationPolicy } from "../../lib/notifications/policy";

for (const path of ["/", "/monitor?compat=0"]) test(`incident borders preserve card and panel geometry through recovery on ${path}`, async ({ page }) => {
  const { document } = await adminFixture(page);
  const publicMonitor = path.startsWith("/monitor");
  document.publicMonitorZoomPercent = 70;
  for (const block of document.screens[0].blocks) {
    if (block.type === "highlighted_resources" && publicMonitor) {
      block.options = { ...block.options, cardSize: "expanded" };
      block.monitorFontScalePercent = 200;
    }
  }
  const base = publicMonitor ? "/api/public" : "/api";
  await page.route("**" + base + "/settings/presentation", route => route.fulfill({ json: { data: document } }));
  const model = overview(document);
  const resourceId = id(90), ref = "resource:" + resourceId;
  const asgard = model.data.blocks.find(block => block.type === "asgard_summary")!;
  asgard.data = { ...model.data.asgardSummary, resourceConfigId: resourceId };
  await page.route("**" + base + "/dashboard/overview*", route => route.fulfill({ json: model }));

  let stage = 0;
  const runtime = notificationRuntime(defaultNotificationPolicy(), "1");
  await page.route("**" + base + "/monitoring/notifications**", route => {
    const url = new URL(route.request().url());
    const serverTime = new Date().toISOString();
    const common = { counts: { unreadCount: 0, activeCount: stage === 1 ? 1 : 0 }, runtime, serverTime, streamRevision: String(stage) };
    const incident = { id: id(890), targetRef: ref, status: stage === 1 ? "active" : "resolved", closedAt: stage === 2 ? serverTime : null };
    return route.fulfill({ json: url.pathname.endsWith("/changes")
      ? { ...common, changes: stage > Number(url.searchParams.get("after")) ? [{ revision: String(stage), kind: "incident", payload: { incident, highlighted: stage === 1 } }] : [], nextCursor: String(stage), hasMore: false }
      : { ...common, highlights: [], events: [], incidents: [], syncCursor: String(stage) } });
  });
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  if (!publicMonitor) await signIn(page);
  await page.clock.install();
  await page.goto(path);
  await expect(page.getByRole("button", { name: /^Notificações: 0 não lidas, 0 incidentes atuais/ })).toBeVisible();
  const card = page.locator(`.availability-card[data-incident-target="${ref}"]`).first();
  const panel = page.locator(".asgard-panel");
  await expect(card).toBeVisible();
  await expect(panel).toBeVisible();
  const geometry = () => page.locator(".availability-panel, .availability-grid, .availability-card, .asgard-panel, .block-problems").evaluateAll(nodes =>
    nodes.map(node => { const r = node.getBoundingClientRect(); return [r.x, r.y, r.width, r.height, node.scrollWidth, node.scrollHeight]; }));
  await page.evaluate(() => window.document.fonts.ready.then(() => true));
  const before = await geometry();
  const box = (await card.boundingBox())!;
  // Sample only the gap beyond the card. A shadow clipped inside the card must fail this check.
  const clip = { x: Math.ceil(box.x + box.width) + 1, y: Math.floor(box.y + box.height / 2), width: 2, height: 6 };
  const gapBefore = await page.screenshot({ clip });
  stage = 1;
  await page.clock.fastForward(10000);
  await expect(card).toHaveAttribute("data-incident-state", "error");
  await expect(panel).toHaveAttribute("data-incident-state", "error");
  expect(await card.evaluate(el => getComputedStyle(el, "::after").animationName)).toBe("none");
  expect(await card.evaluate(el => getComputedStyle(el, "::after").boxShadow)).toContain("3px inset");
  const halo = await card.evaluate(el => getComputedStyle(el).boxShadow);
  expect(halo).toContain("rgba(255,");
  expect(halo).not.toContain("inset");
  expect((await page.screenshot({ clip })).equals(gapBefore)).toBe(false);
  expect(await geometry()).toEqual(before);
  stage = 2;
  await page.clock.fastForward(10000);
  await expect(card).toHaveAttribute("data-incident-state", "recovered");
  expect(await geometry()).toEqual(before);
  await page.clock.fastForward(5000);
  await expect(panel).not.toHaveAttribute("data-incident-state");
  await expect(card).not.toHaveAttribute("data-incident-state");
  expect((await page.screenshot({ clip })).equals(gapBefore)).toBe(true);
  expect(await geometry()).toEqual(before);
});
