import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { presentationDocumentSchema, monitorFontScaleOptions, withReadingPlayback } from '../lib/config/presentation.ts';
import { monitorFixture } from './fixtures/monitor-compat.mjs';
import { renderCompatibleContent } from '../lib/server/monitor-compat/render.ts';
import { generateMonitorTypography } from '../scripts/generate-monitor-typography.mjs';

test('monitor typography is optional, bounded and independent per block and screen', () => {
  const { document } = monitorFixture();
  const block = document.screens[0].blocks[0];
  assert.equal(presentationDocumentSchema.parse(document).screens[0].blocks[0].monitorFontScalePercent, undefined);
  for (const value of monitorFontScaleOptions) {
    block.monitorFontScalePercent = value;
    assert.equal(presentationDocumentSchema.parse(document).screens[0].blocks[0].monitorFontScalePercent, value);
    assert.equal(document.screens[0].blocks[1].monitorFontScalePercent, undefined);
  }
  assert.deepEqual([...monitorFontScaleOptions], Array.from({length: 13}, (_, index) => 100 + index * 5));
  for (const value of [0, -5, 99, 101, 115.5, 126, 161, 165, '115', null]) {
    block.monitorFontScalePercent = value;
    assert.equal(presentationDocumentSchema.safeParse(document).success, false, String(value));
  }
  block.monitorFontScalePercent = 115;
  const draft = structuredClone(document); draft.screens[0].blocks[0].monitorFontScalePercent = 125;
  assert.equal(withReadingPlayback(document, draft).screens[0].blocks[0].monitorFontScalePercent, 115);
});

test('classic typography is literal in initial HTML and composes existing KPI scale once', () => {
  const model = monitorFixture({ fontScalePercent: 150 });
  for (const block of model.screen.blocks) block.monitorFontScalePercent = 115;
  const html = renderCompatibleContent(model);
  assert.match(html, /data-monitor-font-scale="115"/);
  assert.match(html, /\[data-monitor-font-scale="115"\] \.panel-heading h2\{font-size:16.1px\}/);
  assert.ok(Math.abs(Number(html.match(/class="kpi-value" style="font-size:([\d.]+)px/)?.[1]) - 48.3) < .001);
  const styles = html.match(/<style data-monitor-block-fonts>(.*?)<\/style>/s)?.[1];
  assert.ok(styles); assert.doesNotMatch(styles, /[;{](?:zoom|transform):|var\(/);
});

test('generated classic typography stays synchronized with its source stylesheet', async () => {
  assert.equal(await readFile(new URL('../lib/server/monitor-compat/typography.generated.ts', import.meta.url), 'utf8'), await generateMonitorTypography());
});
