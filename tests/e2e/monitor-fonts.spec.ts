import { test, expect, type Page } from '@playwright/test';
import { slotUiFixture } from '../fixtures/overview-slots';
import { signIn } from '../fixtures/infrastructure';
import { id } from '../fixtures/dashboard';
import type { AvailabilityPanelCard } from '../../lib/dashboard/availability-cards';

async function readings(page: Page) {
  await expect(page.locator('.availability-card').first()).toBeVisible();
  return page.locator('[data-block-id]').evaluateAll(blocks => blocks.map(block => {
    const rect = block.getBoundingClientRect();
    return {
      id: block.getAttribute('data-block-id'), box: { width: rect.width, height: rect.height },
      fonts: [...block.querySelectorAll<HTMLElement>('*')].filter(node => node.getBoundingClientRect().width > 0 && [...node.childNodes].some(child => child.nodeType === Node.TEXT_NODE && child.textContent?.trim())).map(node => ({ tag: node.tagName, text: node.textContent!.trim(), size: parseFloat(getComputedStyle(node).fontSize) })),
    };
  }));
}

for (const cardSize of ['compact', 'expanded']) for (const zoom of [70, 100, 125]) test(`monitor fonts keep geometry and root intact: ${cardSize} at ${zoom}% zoom`, async ({ page }) => {
  test.setTimeout(180000);
  const { state, screen, find, model } = await slotUiFixture(page);
  await page.clock.setFixedTime(new Date());
  const cards = (model.overview.data.blocks.find(block => block.type === 'highlighted_resources')!.data as { cards: AvailabilityPanelCard[] }).cards;
  for (const card of cards) {
    if (card.kind === 'resource') card.item.config.presentation.cardMetrics = ['cpu', 'memory', 'disk'];
    if (card.kind === 'signal_service') card.item.cardMetrics = ['cpu', 'memory', 'disk'];
  }
  // Trio exercises the tightest existing card. Keep summary out for exact panel geometry checks.
  find('summary').enabled = false;
  await page.setViewportSize({ width: 1920, height: 1080 });
    find('highlighted_resources').options!.cardSize = cardSize;
    state.document.publicMonitorZoomPercent = zoom;
    for (const block of screen.blocks) block.monitorFontScalePercent = 100;
    await page.goto('/monitor?compat=0');
    const baseline = await readings(page);
    // Cover the previous range, its extension and the maximum in React.
    // Every 5% step is exercised by the schema and classic runtime matrix.
    for (const scale of [115, 130, 160, 180, 200]) {
      for (const block of screen.blocks) block.monitorFontScalePercent = scale;
      await page.reload();
      const scaled = await readings(page);
      for (let index = 0; index < baseline.length; index++) {
        const before = baseline[index], after = scaled[index];
        expect(after.id).toBe(before.id);
        expect(Math.abs(after.box.width - before.box.width)).toBeLessThan(1);
        expect(Math.abs(after.box.height - before.box.height), `panel height ${cardSize}/${zoom}/${scale}/${before.id}`).toBeLessThan(1);
        expect(after.fonts.length).toBe(before.fonts.length);
        after.fonts.forEach((font, i) => expect(Math.abs(font.size - before.fonts[i].size * scale / 100), `${font.tag} ${font.text} at ${scale}%`).toBeLessThan(.03));
      }
      const measurements = await page.locator('.availability-panel').evaluate(panel => {
        const cards = [...panel.querySelectorAll<HTMLElement>('.availability-card')];
        const outer = panel.getBoundingClientRect();
        return { height: cards[0].getBoundingClientRect().height, outerScroll: panel.scrollHeight - panel.clientHeight,
          metricSpacing: cards.filter(card => card.querySelectorAll('.availability-reading').length === 3).map(card => {
            const readings = [...card.querySelectorAll<HTMLElement>('.availability-reading')];
            const percent = readings[0].querySelector('strong')!;
            const label = readings[0].firstElementChild!;
            return { diskGap: readings[1].getBoundingClientRect().top - readings[0].getBoundingClientRect().bottom,
              descriptionGap: readings[0].getBoundingClientRect().top - card.querySelector('.availability-description')!.getBoundingClientRect().bottom,
              percentageRatio: parseFloat(getComputedStyle(percent).fontSize) / parseFloat(getComputedStyle(label).fontSize) };
          }),
          meterHeights: cards.flatMap(card => [...card.querySelectorAll('.availability-meter')].map(meter => meter.getBoundingClientRect().height)),
          footHeight: panel.querySelector('.panel-foot')!.getBoundingClientRect().height,
          fits: cards.every(card => [...card.querySelectorAll<HTMLElement>('.availability-card-heading,.availability-description,.availability-readings,.availability-footer')].every(child => { const r = child.getBoundingClientRect(), c = card.getBoundingClientRect(); return r.top >= c.top - 1 && r.bottom <= c.bottom + 1 && r.right <= c.right + 1; })),
          width: outer.width };
      });
      expect(measurements.height).toBeCloseTo((cardSize === 'compact' ? 148 : 168) * zoom / 100, 0);
      expect(measurements.outerScroll).toBeLessThanOrEqual(1);
      expect(measurements.footHeight).toBeLessThanOrEqual(28 * zoom / 100 + 1);
      expect(measurements.fits, JSON.stringify(measurements)).toBe(true);
      expect(measurements.metricSpacing.length).toBeGreaterThan(0);
      for (const spacing of measurements.metricSpacing) {
        expect(spacing.diskGap).toBeCloseTo(6 * zoom / 100, 0);
        expect(spacing.descriptionGap).toBeGreaterThanOrEqual(2 * zoom / 100 - .1);
        expect(spacing.percentageRatio).toBeCloseTo(1.3, 2);
      }
      for (const height of measurements.meterHeights) expect(height).toBeCloseTo((cardSize === 'compact' ? 12 : 16) * zoom / 100, 0);
      const panelMeters = await page.locator('[data-block-id] .metric-meter').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().height));
      for (const height of panelMeters) expect(height).toBeCloseTo(12 * zoom / 100, 0);
      if (zoom === 70 && scale === 200) await page.screenshot({ path: '.cache/font-monitor-200-' + cardSize + '.png' });
    }
  await signIn(page); await page.goto('/');
  const rootScaled = await readings(page);
  // CSS zoom rounds the computed height to device fractions (e.g. 3.99554px at 70%).
  for (const height of await page.locator('.metric-meter').evaluateAll(nodes => nodes.map(node => parseFloat(getComputedStyle(node).height)))) expect(height).toBeCloseTo(4, 1);
  for (const block of screen.blocks) block.monitorFontScalePercent = 100;
  await page.reload();
  expect(await readings(page)).toEqual(rootScaled);
  expect(state.writes).toHaveLength(0);
});

test('block font preferences save independently per screen and reading save leaves drafts unpublished', async ({ page }) => {
  const { state, screen, find } = await slotUiFixture(page);
  const second = structuredClone(screen); second.id = id(9300); second.name = 'Fontes distintas';
  const map = new Map(second.blocks.map((block, index) => [block.id, id(9301 + index)]));
  for (const block of second.blocks) { block.id = map.get(block.id)!; block.monitorFontScalePercent = 110; }
  for (const key of ['topLeft', 'topRight', 'bottomLeft', 'bottomRight'] as const) second.overviewSlots![key] = second.overviewSlots![key].map(value => map.get(value)!);
  state.document.screens.push(second);
  await signIn(page); await page.goto('/admin/configuracoes');
  const block = page.getByRole('article', { name: 'Serviços destacados na tela 1', exact: true });
  await block.getByLabel('Tamanho das fontes no /monitor (%)', { exact: true }).selectOption('200');
  await page.getByRole('button', { name: 'Salvar leitura do telão', exact: true }).click();
  await expect.poll(() => state.writes.length).toBe(1);
  expect(find('highlighted_resources').monitorFontScalePercent).toBeUndefined();
  await page.getByRole('button', { name: 'Salvar apresentação', exact: true }).click();
  await expect.poll(() => state.document.screens[0].blocks.find(item => item.type === 'highlighted_resources')!.monitorFontScalePercent).toBe(200);
  expect(state.document.screens[1].blocks.every(item => item.monitorFontScalePercent === 110)).toBe(true);
  await page.reload(); await expect(block.getByLabel('Tamanho das fontes no /monitor (%)', { exact: true })).toHaveValue('200');
  await page.goto('/monitor?compat=0');
  await expect(page.locator('.block-highlighted_resources')).toHaveAttribute('data-monitor-font-scale', '200');
  const titleSize = await page.locator('.block-highlighted_resources .panel-heading h2').evaluate(node => parseFloat(getComputedStyle(node).fontSize));
  await page.getByRole('combobox', { name: 'Escolher tela', exact: true }).selectOption(second.id);
  await expect(page.locator('.block-highlighted_resources')).toHaveAttribute('data-monitor-font-scale', '110');
  expect(await page.locator('.block-highlighted_resources .panel-heading h2').evaluate(node => parseFloat(getComputedStyle(node).fontSize))).toBeCloseTo(titleSize / 200 * 110, 1);
});

test('monitor block fonts compose KPI scale and leave adjacent panels unchanged', async ({ page }) => {
  const { state, screen, find } = await slotUiFixture(page);
  await page.clock.setFixedTime(new Date());
  await page.setViewportSize({ width: 1920, height: 1080 });
  state.document.publicMonitorZoomPercent = 100;
  for (const kpiScale of [100, 150]) {
    find('summary').options!.fontScalePercent = kpiScale;
    find('summary').monitorFontScalePercent = 100;
    await page.goto('/monitor?compat=0');
    const before = await readings(page);
    find('summary').monitorFontScalePercent = 200;
    await page.reload();
    const after = await readings(page);
    for (let i = 0; i < before.length; i++) {
      expect(Math.abs(after[i].box.height - before[i].box.height), before[i].id ?? 'block').toBeLessThan(1);
      const factor = before[i].id === find('summary').id ? 2 : 1;
      after[i].fonts.forEach((font, j) => expect(font.size).toBeCloseTo(before[i].fonts[j].size * factor, 1));
    }
  }
  for (const block of screen.blocks) block.monitorFontScalePercent = 200;
  state.document.publicMonitorZoomPercent = 70;
  await page.reload();
  await readings(page);
  await page.screenshot({ path: '.cache/font-monitor-200.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  await expect(page.locator('.block-summary .dashboard-kpi').first()).toBeVisible();
});
