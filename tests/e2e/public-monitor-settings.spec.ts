import { test, expect } from "@playwright/test";
import { signIn } from "../fixtures/infrastructure";

test("saved monitor zoom reaches anonymous readers and the first React and classic HTML", async ({ page, request, baseURL }) => {
  await signIn(page);
  const token = await page.evaluate(() => JSON.parse(localStorage.getItem('pulse.auth.v1')!).session.accessToken as string);
  const headers = { Authorization: 'Bearer ' + token, Origin: baseURL! };
  const originalResponse = await page.request.get('/api/settings/presentation', { headers });
  expect(originalResponse.ok()).toBe(true);
  const original = (await originalResponse.json()).data;
  const { revision, ...settings } = original;
  let savedRevision = revision;
  try {
    const savedResponse = await page.request.put('/api/settings/presentation', {
      headers, data: { expectedRevision: revision, settings: { ...settings, publicMonitorZoomPercent: 70 } },
    });
    expect(savedResponse.ok()).toBe(true);
    savedRevision = (await savedResponse.json()).data.revision;
    const publicResponse = await request.get('/api/public/settings/presentation');
    expect(publicResponse.ok()).toBe(true);
    expect((await publicResponse.json()).data.publicMonitorZoomPercent).toBe(70);
    const react = await request.get('/monitor?compat=0');
    expect(react.ok()).toBe(true);
    expect(await react.text()).toContain('data-public-monitor-zoom="70"');
    const classic = await request.get('/monitor?compat=1');
    expect(classic.ok()).toBe(true);
    expect(await classic.text()).toContain('style="zoom:70%"');
    await page.goto('/monitor?compat=0');
    await expect(page.locator('.public-monitor-frame')).toHaveAttribute('data-public-monitor-zoom', '70');
    await expect(page.locator('.dashboard-shell')).toHaveAttribute('data-display-scale', '100');
  } finally {
    const restored = await page.request.put('/api/settings/presentation', { headers, data: { expectedRevision: savedRevision, settings } });
    expect(restored.ok()).toBe(true);
  }
});
