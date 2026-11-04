import { test, expect } from "@playwright/experimental-ct-react";
import { AgentCardReadingsFixture } from "../fixtures/agent-card-readings";

test("expanded Agent cards increase the envelope and typography together without adding a metric", async ({ mount }) => {
  for (const scale of [100, 125]) {
    const component = await mount(<AgentCardReadingsFixture pair={["disk", "memory"]} size="expanded" scale={scale} />);
    const card = component.locator(".availability-card");
    await expect(card.locator(".availability-reading")).toHaveCount(2);
    expect((await card.boundingBox())!.height).toBeCloseTo(140 * scale / 100, 1);
    expect(await card.evaluate(element => element.scrollHeight <= element.clientHeight && element.scrollWidth <= element.clientWidth)).toBe(true);
    await component.unmount();
  }
});

test("the three metric pairs retain two readings and the same compact card height", async ({ mount, page }) => {
  for (const pair of [["cpu", "memory"], ["cpu", "disk"], ["disk", "memory"]] as const) {
    const component = await mount(<AgentCardReadingsFixture pair={[...pair]} />);
    await expect(component.locator(".availability-reading")).toHaveCount(2);
    await expect(component.locator(".availability-reading").first()).toContainText(pair[0] === "disk" ? "Disco" : "CPU");
    const bounds = await component.boundingBox();
    expect(bounds?.height).toBe(120);
    expect(await component.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await component.unmount();
  }
  await mount(<AgentCardReadingsFixture pair={["cpu", "disk"]} missing />);
  await expect(page.locator(".availability-reading").last()).toContainText("Disco da VM");
  await expect(page.locator(".availability-reading").last()).toContainText("—");
});
