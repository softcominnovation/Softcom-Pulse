import { test, expect } from "@playwright/test";
import { signIn } from "../fixtures/infrastructure";

test("saved monitor zoom and scroll reach anonymous readers, initial HTML and reload", async ({ page, request, baseURL }) => {
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
      headers, data: { expectedRevision: revision, settings: { ...settings, publicMonitorZoomPercent: 70, publicMonitorAutoScrollOnLoad: false } },
    });
    expect(savedResponse.ok()).toBe(true);
    savedRevision = (await savedResponse.json()).data.revision;
    const publicResponse = await request.get('/api/public/settings/presentation');
    expect(publicResponse.ok()).toBe(true);
    const shared = (await publicResponse.json()).data;
    expect(shared.publicMonitorZoomPercent).toBe(70);
    expect(shared.publicMonitorAutoScrollOnLoad).toBe(false);
    const react = await request.get('/monitor?compat=0');
    expect(react.ok()).toBe(true);
    const reactHtml = await react.text();
    expect(reactHtml).toContain('data-public-monitor-zoom="70"');
    expect(reactHtml).toContain('data-public-monitor-auto-scroll-on-load="false"');
    const classic = await request.get('/monitor?compat=1');
    expect(classic.ok()).toBe(true);
    const classicHtml = await classic.text();
    expect(classicHtml).toContain('style="zoom:70%"');
    expect(classicHtml).toContain('"autoScrollOnLoad":false');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/monitor?compat=0');
    await expect(page.locator('.public-monitor-frame')).toHaveAttribute('data-public-monitor-zoom', '70');
    await expect(page.locator('.dashboard-shell')).toHaveAttribute('data-display-scale', '100');
    await expect(page.getByRole('button', { name: 'Retomar rolagem automática', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Retomar rolagem automática', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Pausar rolagem automática', exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('button', { name: 'Retomar rolagem automática', exact: true })).toBeVisible();
    const enabled = await page.request.put('/api/settings/presentation', { headers, data: { expectedRevision: savedRevision, settings: { ...settings, publicMonitorAutoScrollOnLoad: true } } });
    expect(enabled.ok()).toBe(true); savedRevision = (await enabled.json()).data.revision;
    await page.reload();
    await expect(page.locator('.public-monitor-frame')).toHaveAttribute('data-public-monitor-auto-scroll-on-load', 'true');
    await expect(page.getByRole('button', { name: 'Pausar rolagem automática', exact: true })).toBeVisible();
  } finally {
    const restored = await page.request.put('/api/settings/presentation', { headers, data: { expectedRevision: savedRevision, settings } });
    expect(restored.ok()).toBe(true);
  }
});
