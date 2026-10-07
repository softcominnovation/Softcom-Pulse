import { test, expect, type Locator } from "@playwright/test";
import { adminFixture } from "../fixtures/admin";
import { signIn } from "../fixtures/infrastructure";
import { id } from "../fixtures/dashboard";

const readingSave = "Salvar leitura do telão";

test("reading save preserves invalid drafts elsewhere and advances revision for the next full save", async ({ page }) => {
  const state = await adminFixture(page), original = structuredClone(state.document);
  await signIn(page); await page.goto("/admin/configuracoes");
  await page.getByLabel("Nome da tela", { exact: true }).fill("");
  await page.getByLabel("Intervalo da alternância (segundos)").fill("1");
  await page.getByLabel("Tamanho dos elementos no telão").selectOption("125");
  await page.getByLabel("Tempo sem interação (minutos)").fill("7");
  await page.getByLabel("Entrar no modo TV após inatividade", { exact: true }).check();
  await page.getByRole("button", { name: readingSave, exact: true }).click();
  await expect.poll(() => state.document.revision).toBe(2);
  expect(state.document.screens).toEqual(original.screens); expect(state.document.rotation).toEqual(original.rotation);
  expect(state.document.displayScalePercent).toBe(125); expect(state.document.idlePresentation.afterMinutes).toBe(7);
  await expect(page.getByLabel("Nome da tela", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("Intervalo da alternância (segundos)")).toHaveValue("1");
  await page.getByLabel("Nome da tela", { exact: true }).fill("Operação revisada");
  await page.getByLabel("Intervalo da alternância (segundos)").fill("30");
  await page.getByRole("button", { name: "Salvar apresentação", exact: true }).click();
  await expect.poll(() => state.document.revision).toBe(3);
  expect(state.writes[1].body.expectedRevision).toBe(2);
  expect(state.document.screens[0].name).toBe("Operação revisada");
  await page.reload();
  await expect(page.getByLabel("Tamanho dos elementos no telão")).toHaveValue("125");
  await expect(page.getByLabel("Tempo sem interação (minutos)")).toHaveValue("7");
});

test("reading validation and conflicts stay in its panel; pending saves are locked and cancel keeps confirmed reading", async ({ page }) => {
  const state = await adminFixture(page); await signIn(page); await page.goto("/admin/configuracoes");
  const panel = page.getByRole("region", { name: "Leitura no telão", exact: true });
  await page.getByLabel("Tempo sem interação (minutos)").fill("0");
  await panel.getByRole("button", { name: readingSave }).click();
  await expect(panel.getByRole("alert")).toContainText("entre 1 e 120"); expect(state.writes).toHaveLength(0);
  await page.getByLabel("Tempo sem interação (minutos)").fill("8");
  state.presentationConflict = true;
  await panel.getByRole("button", { name: readingSave }).click();
  await expect(panel.getByRole("alert")).toContainText("outra sessão");
  await expect(page.getByLabel("Tempo sem interação (minutos)")).toHaveValue("8");
  state.presentationConflict = false;
  let release!: () => void; state.wait = new Promise(resolve => { release = resolve; });
  await panel.getByRole("button", { name: readingSave }).click();
  await expect(panel.getByRole("button", { name: readingSave })).toBeDisabled();
  await expect(page.getByLabel("Tamanho dos elementos no telão")).toBeDisabled();
  await expect(page.getByRole("button", { name: "Salvando…", exact: true })).toBeDisabled();
  expect(state.writes).toHaveLength(2);
  release(); state.wait = null;
  await expect.poll(() => state.document.revision).toBe(2);
  await page.getByLabel("Tempo sem interação (minutos)").fill("12");
  await page.getByLabel("Nome da tela", { exact: true }).fill("Outro rascunho");
  await page.getByRole("button", { name: "Cancelar alterações", exact: true }).click();
  await expect(page.getByLabel("Tempo sem interação (minutos)")).toHaveValue("8");
  await expect(page.getByLabel("Nome da tela", { exact: true })).toHaveValue("Visão geral");
});

test("reading-only save preserves legacy composition without upgrading or truncating it", async ({ page }) => {
  const state = await adminFixture(page); state.document.schemaVersion = 1;
  state.document.screens[0].blocks = Array.from({ length: 7 }, (_, index) => ({ id: id(8000 + index), type: "summary", width: "full", enabled: true }));
  const original = structuredClone(state.document.screens);
  await signIn(page); await page.goto("/admin/configuracoes");
  await page.getByLabel("Tamanho dos elementos no telão").selectOption("120");
  await page.getByRole("button", { name: readingSave }).click();
  await expect.poll(() => state.document.revision).toBe(2);
  expect(state.document.schemaVersion).toBe(1); expect(state.document.screens).toEqual(original);
  expect(state.document.displayScalePercent).toBe(120);
});

async function aligned(...controls: Locator[]) {
  const boxes = await Promise.all(controls.map(control => control.boundingBox()));
  const first = boxes[0]!;
  for (const box of boxes.slice(1)) { expect(Math.abs(box!.y - first.y)).toBeLessThanOrEqual(1); expect(Math.abs(box!.height - first.height)).toBeLessThanOrEqual(1); }
}
async function checkboxAligned(control: Locator, checkbox: Locator) {
  const field = (await control.boundingBox())!, check = (await checkbox.boundingBox())!;
  expect(Math.abs(check.y + check.height / 2 - field.y - field.height / 2)).toBeLessThanOrEqual(1);
}
for (const width of [390, 768, 1366, 1920]) {
  test(`settings fields, checkboxes and template editor stay aligned at ${width}px`, async ({ page }) => {
    await adminFixture(page); await page.setViewportSize({ width, height: 1080 }); await signIn(page); await page.goto("/admin/configuracoes");
    const reading = page.getByRole("region", { name: "Leitura no telão", exact: true });
    await expect(reading).toBeVisible();
    if (width >= 1366) {
      await aligned(page.getByLabel("Tamanho dos elementos no telão"), page.getByRole("button", { name: "Restaurar tamanho padrão" }), page.getByLabel("Tempo sem interação (minutos)"));
      const fieldRow = page.getByRole("region", { name: "Tela 1", exact: true }).locator(".admin-fields").first();
      await aligned(fieldRow.getByLabel("Nome da tela"), fieldRow.getByLabel("Formato"));
      await checkboxAligned(fieldRow.getByLabel("Formato"), fieldRow.getByLabel("Tela habilitada"));
      const block = page.getByRole("article", { name: "ASGARD e VMs na tela 1" });
      await aligned(block.getByLabel("Largura"), block.getByLabel("Associado à tela"));
      await checkboxAligned(block.getByLabel("Largura"), block.getByLabel("Bloco habilitado", { exact: true }));
      await aligned(block.getByLabel("Ordenar por"), block.getByLabel("Direção"), block.getByLabel("Linhas visíveis"));
      await block.screenshot({ path: `.cache/settings-block-${width}.png` });
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await reading.screenshot({ path: `.cache/settings-reading-${width}.png` });
    await page.getByRole("button", { name: "Editar template tpl-worker-ubuntu-24", exact: true }).click();
    if (width >= 768) await aligned(page.getByLabel("Nome amigável"), page.getByLabel("Papel", { exact: true }));
    await page.locator(".admin-template-form").screenshot({ path: `.cache/settings-template-${width}.png` });
    if (width === 1366) {
      await page.evaluate(() => { document.documentElement.style.zoom = "2"; });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await reading.getByRole("button", { name: readingSave }).scrollIntoViewIfNeeded();
      await expect(reading.getByRole("button", { name: readingSave })).toBeVisible();
    }
  });
}
