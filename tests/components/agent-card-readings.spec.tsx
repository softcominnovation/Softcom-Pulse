import { test, expect } from "@playwright/experimental-ct-react";
import { AgentCardReadingsFixture } from "../fixtures/agent-card-readings";

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
