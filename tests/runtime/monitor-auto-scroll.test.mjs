import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

process.env.PLAYWRIGHT_BROWSERS_PATH ??= fileURLToPath(new URL('../../.cache/ms-playwright', import.meta.url));
const { chromium } = await import('@playwright/test');

test('shared monitor controller reverses real overflow, preserves refresh state and releases every region', { timeout: 30000 }, async () => {
  const browser = await chromium.launch(), page = await browser.newPage();
  try {
    await page.clock.install();
    await page.setContent(`<style>.region{height:100px;width:200px;overflow:auto}.rows{height:148px;width:230px}</style>
      <div id="monitor"><div data-block-id="one"><div class="region" tabindex="0"><div class="rows">Rows</div></div><div class="no-overflow">Fits</div></div></div>
      <div role="dialog" data-state="closed">Details</div>`);
    await page.addScriptTag({ path: fileURLToPath(new URL('../../public/monitor-auto-scroll.js', import.meta.url)) });
    await page.evaluate(() => {
      window.manualScrolls = 0;
      document.addEventListener('scroll', event => { if (!window.PulseMonitorAutoScroll.isAutomatic(event.target)) window.manualScrolls++; }, true);
      window.controller = window.PulseMonitorAutoScroll.attach(document.getElementById('monitor'));
    });
    const region = page.locator('.region'), top = () => region.evaluate(element => element.scrollTop);
    await page.clock.runFor(1900); assert.equal(await top(), 0);
    await page.clock.runFor(2100); assert.ok(await top() >= 45, 'Reaches the end at 24 pixels per second');
    await page.clock.runFor(1700); assert.equal(await top(), 48, 'Reads the bottom before returning');
    await page.clock.runFor(2300); assert.ok(await top() < 5, 'Returns slowly to the top');
    assert.equal(await region.evaluate(element => element.scrollLeft), 0);
    assert.equal(await page.locator('.no-overflow[data-monitor-auto-scroll]').count(), 0);
    assert.equal(await page.evaluate(() => window.manualScrolls), 0, 'Automatic events are not user activity');
    await region.evaluate(element => { element.dispatchEvent(new WheelEvent('wheel', { bubbles: true })); element.scrollTop = 20; });
    await page.clock.runFor(6000); assert.equal(await top(), 20, 'Manual input holds the chosen position');
    assert.ok(await page.evaluate(() => window.manualScrolls) > 0);
    await page.clock.runFor(2300); assert.ok(await top() > 25);
    await page.evaluate(() => window.controller.setPaused(true));
    await page.clock.runFor(100);
    const saved = 17;
    await page.evaluate(() => {
      const region = document.querySelector('.region');
      region.style.height = '200px'; window.controller.sync();
      region.style.height = '100px'; region.scrollTop = 17;
      window.controller.capture();
      const block = document.querySelector('[data-block-id]'); block.innerHTML = block.innerHTML;
      window.controller.sync();
    });
    await page.clock.runFor(500); assert.equal(await top(), saved, 'HTML replacement keeps even a manual position whose scroll event is still pending');
    await page.evaluate(() => { window.controller.setPaused(false); document.querySelector('[role=dialog]').setAttribute('data-state', 'open'); });
    await page.clock.runFor(4000); assert.equal(await top(), saved, 'A modal suspends underlying panels');
    await page.evaluate(() => document.querySelector('[role=dialog]').setAttribute('data-state', 'closed'));
    await page.clock.runFor(1000); assert.equal(await top(), saved, 'Resume includes a reading pause');
    await page.evaluate(() => window.controller.destroy());
    await page.clock.runFor(4000); assert.equal(await top(), saved);
    assert.equal(await page.locator('[data-monitor-auto-scroll]').count(), 0);
    await region.evaluate(element => { element.scrollTop = 3; }); await page.clock.runFor(100);
    assert.equal(await region.evaluate(element => window.PulseMonitorAutoScroll.isAutomatic(element)), false);
  } finally { await browser.close(); }
});
