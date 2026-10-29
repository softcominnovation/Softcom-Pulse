import { chromium, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

/** A separate throwaway browser, without Playwright's forced foreground visibility. */
export async function nativeBrowser() {
  const profile = await mkdtemp(join(tmpdir(), 'pulse-background-test-'));
  const child = spawn(chromium.executablePath(), [
    `--user-data-dir=${profile}`, '--remote-debugging-port=0', '--no-first-run',
    '--no-default-browser-check', '--autoplay-policy=user-gesture-required', 'about:blank',
  ], { windowsHide: true, stdio: 'ignore' });
  const exited = new Promise<void>(resolve => child.once('exit', () => resolve()));
  let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | undefined;
  const close = async () => {
    try { await browser?.close(); } finally {
      child.kill(); await exited;
      const path = relative(tmpdir(), profile);
      if (!path.startsWith('pulse-background-test-') || path.includes('..')) throw new Error('Unexpected test profile path');
      await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  };
  try {
    let port = '';
    await expect.poll(async () => {
      try { port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; return !!Number(port); }
      catch { return false; }
    }, { timeout: 15000 }).toBe(true);
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { noDefaults: true });
    return { context: browser.contexts()[0], close };
  } catch (error) { await close(); throw error; }
}
