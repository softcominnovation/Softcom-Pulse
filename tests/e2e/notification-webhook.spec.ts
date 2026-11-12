import { test, expect } from "@playwright/test";
import { adminFixture } from "../fixtures/admin";
import { signIn } from "../fixtures/infrastructure";

test("editors can activate the webhook with a saved key, rotate and remove it", async ({ page }) => {
  test.setTimeout(90000);
  await adminFixture(page);
  await signIn(page);
  const response = (method: string) => page.waitForResponse(r =>
    r.url().endsWith("/api/settings/notifications/webhook") && r.request().method() === method);
  const firstRead = response("GET");
  await page.goto("/admin/configuracoes");
  expect((await firstRead).status()).toBe(200);
  const panel = page.getByRole("region", { name: "Notificações externas" });
  const enable = panel.getByLabel("Ativar envio externo"), key = panel.getByLabel("API key", { exact: true });
  async function save() {
    const reply = response("PUT");
    const read = response("GET");
    await panel.getByRole("button", { name: "Salvar envio externo" }).click();
    expect((await reply).status()).toBe(200);
    expect((await read).status()).toBe(200);
    await expect(enable).toBeVisible();
  }
  await expect(enable).toBeDisabled();
  await panel.getByLabel("URL de destino").fill("https://192.0.2.17/alerts");
  await expect(enable).toBeDisabled();
  await key.fill("sentinel"); await save();
  await expect(panel.getByText(/Chave cadastrada\. Preencha/)).toBeVisible();
  await expect(key).toHaveValue("");
  await enable.check(); await save();
  await page.reload(); await expect(enable).toBeChecked();
  await key.fill("replacement"); await save(); await expect(key).toHaveValue("");
  await enable.uncheck(); await panel.getByLabel("Remover chave cadastrada").check(); await save();
  await expect(enable).toBeDisabled();
});
