import { test, expect } from "@playwright/experimental-ct-react";
import { ResourceCardReadingsFixture } from "../fixtures/resource-card-readings";

test("expanded resources keep their metric pair and complete footer at every presentation scale", async ({ mount }) => {
  for (const scale of [100, 110, 120, 125]) for (const pair of [["cpu", "memory"], ["cpu", "disk"], ["disk", "memory"]] as const) {
    const component = await mount(<ResourceCardReadingsFixture size="expanded" scale={scale} width={260 * scale / 100} pair={[...pair]} />);
    const card = component.locator(".availability-card");
    await expect(card.locator(".availability-reading")).toHaveCount(2);
    const geometry = await card.evaluate(node => ({ height: node.getBoundingClientRect().height, fits: node.scrollHeight <= node.clientHeight + 1, name: parseFloat(getComputedStyle(node.querySelector(".availability-name")!).fontSize), footer: node.querySelector(".availability-footer")!.getBoundingClientRect().bottom, bottom: node.getBoundingClientRect().bottom }));
    expect(geometry.height).toBeCloseTo(140 * scale / 100, 1); expect(geometry.fits).toBe(true);
    expect(geometry.name).toBeCloseTo(15 * scale / 100, 1); expect(geometry.footer).toBeLessThan(geometry.bottom);
    await component.unmount();
  }
});

test("resource pairs keep their choice and every line visible in the 120px card", async ({ mount }) => {
  for (const width of [180, 230]) for (const pair of [["cpu", "memory"], ["cpu", "disk"], ["disk", "memory"]] as const) {
    const component = await mount(<ResourceCardReadingsFixture width={width} pair={[...pair]} />);
    await expect(component.locator(".availability-reading")).toHaveCount(2);
    expect(await component.locator(".availability-reading > span:first-child").allTextContents()).toEqual(pair.map(kind => kind === "cpu" ? "CPU12,9%" : kind === "disk" ? "Disco20%" : "RAM40%"));
    const geometry = await component.locator(".availability-card").evaluate(node => ({ height: node.getBoundingClientRect().height, fits: node.scrollHeight <= node.clientHeight + 1, lines: [".availability-name", ".availability-description", ".availability-footer"].map(selector => node.querySelector(selector)!.getBoundingClientRect().height) }));
    expect(geometry.height).toBe(120); expect(geometry.fits).toBe(true);
    for (const height of geometry.lines) expect(height).toBeGreaterThan(0);
    await component.unmount();
  }
});

test("configured capacity cannot be replaced by root data when its volume or VM binding is missing", async ({ mount }) => {
  for (const mode of ["missing", "binding", "unconfigured", "stale", "expired"] as const) {
    const component = await mount(<ResourceCardReadingsFixture mode={mode} />);
    const disk = component.locator(".availability-reading").last();
    await expect(disk).toContainText("Disco—"); await expect(disk).not.toContainText("80%");
    await expect(disk).toHaveAttribute("title", /Sem leitura atual/);
    await component.unmount();
  }
});

test("root usage and observed zero remain percentages with their source in a discrete hint", async ({ mount }) => {
  for (const source of ["agent", "hypervisor"] as const) {
    const component = await mount(<ResourceCardReadingsFixture mode="standalone" source={source} />);
    await expect(component.locator(".availability-reading").last()).toContainText("Disco80%");
    await expect(component.locator(".availability-reading").last()).toHaveAttribute("title", "Filesystem raiz /");
    await component.unmount();
  }
  const component = await mount(<ResourceCardReadingsFixture mode="zero" />);
  await expect(component.locator(".availability-reading").last()).toContainText("Disco0%");
  await expect(component.locator(".availability-reading").last()).toHaveAttribute("title", /Armazenamento monitorado/);
});

test("an explicit RAM percentage never turns into a byte reading", async ({ mount }) => {
  const component = await mount(<ResourceCardReadingsFixture mode="ram-bytes" pair={["disk", "memory"]} />);
  await expect(component.locator(".availability-reading").first()).toContainText("Disco20%");
  await expect(component.locator(".availability-reading").last()).toContainText("RAM—");
});
