import { test, expect } from "@playwright/experimental-ct-react";
import { ConfirmationFixture } from "../fixtures/confirmation";

test("cancel, Escape, backdrop and focus never execute the action", async ({ mount, page }) => {
  await mount(<ConfirmationFixture />);
  const trigger = page.getByRole("button", { name: "Remover exemplo", exact: true });
  await trigger.click();
  await expect(page.getByRole("button", { name: "Cancelar", exact: true })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("button", { name: "Fechar diálogo" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Cancelar", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await expect(page.getByRole("button", { name: "Cancelar", exact: true })).toBeFocused();
  await page.locator('.fixed.inset-0[data-state="open"]').click({ position: { x: 3, y: 3 } });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByTestId("calls")).toHaveText("0");
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
});
test("confirmation runs once, reports failure and allows retry", async ({ mount, page }) => {
  await mount(<ConfirmationFixture failFirst />);
  await page.getByRole("button", { name: "Remover exemplo", exact: true }).click();
  await page.getByRole("button", { name: "Remover configuração", exact: true }).dblclick({ delay: 25 });
  await expect(page.getByRole("alert")).toContainText("Não foi possível concluir");
  await expect(page.getByTestId("calls")).toHaveText("1");
  await page.getByRole("button", { name: "Remover configuração", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByTestId("calls")).toHaveText("2");
});
for (const [width, height] of [[320,800], [360,800], [390,800], [768,1024], [1024,768], [1440,900], [640,450]]) {
  test("long dialog reflows and preserves actions at " + width + "x" + height, async ({ mount, page }) => {
    await page.setViewportSize({ width, height });
    await mount(<ConfirmationFixture longText />);
    await page.getByRole("button", { name: "Remover exemplo", exact: true }).click();
    const box = await page.getByRole("dialog").boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(height);
    await expect(page.getByRole("button", { name: "Cancelar", exact: true })).toBeInViewport();
    await expect(page.getByRole("button", { name: "Remover configuração", exact: true })).toBeInViewport();
    await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  });
}
test("labels, runtime provider and toast retain their visual contract", async ({ mount, page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await mount(<ConfirmationFixture />);
  await page.getByText("Nome", { exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Nome" })).toBeFocused();
  await expect(page.getByTestId("config")).toHaveText('{"appName":"Pulse","softcomUrl":"https://example.org/"}');
  expect(await page.getByTestId("numeric").evaluate(node => getComputedStyle(node).fontFamily)).toContain("Consolas");
  await expect(page.getByTestId("numeric")).toHaveCSS("font-variant-numeric", "tabular-nums");
  await page.getByRole("button", { name: "Mostrar alerta" }).click();
  const toast = page.locator("[data-sonner-toast]");
  await expect(toast).toBeVisible();
  await expect(toast).toHaveCSS("background-color", "rgb(24, 35, 44)");
  await expect(toast).toBeInViewport();
});

test.describe("touch access", () => {
  test.use({ hasTouch: true, viewport: { width: 320, height: 800 } });
  test("inputs and modal controls have at least 44px touch targets", async ({ mount, page }) => {
    await mount(<ConfirmationFixture />);
    expect((await page.getByRole("textbox", { name: "Nome" }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.getByRole("button", { name: "Remover exemplo", exact: true }).tap();
    for (const name of ["Cancelar", "Remover configuração", "Fechar diálogo"]) {
      const box = await page.getByRole("button", { name, exact: true }).boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.width).toBeGreaterThanOrEqual(44);
    }
    await page.getByRole("button", { name: "Cancelar", exact: true }).tap();
    await expect(page.getByTestId("calls")).toHaveText("0");
  });
});
