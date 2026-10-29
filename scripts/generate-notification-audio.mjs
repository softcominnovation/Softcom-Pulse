import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = new URL('../', import.meta.url);
process.env.PLAYWRIGHT_BROWSERS_PATH ??= fileURLToPath(new URL('.cache/ms-playwright', root));
const { chromium } = await import('@playwright/test');
const source = await readFile(new URL('components/ui/sound.tsx', root), 'utf8');
const patch = source.match(/const PATCH = [\s\S]*?as const satisfies SoundPatch/);
if (!patch) throw new Error('Kobra sound definitions not found');
const definitions = ts.transpileModule(patch[0], { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const renderer = await readFile(new URL('node_modules/@web-kits/audio/dist/index.js', root), 'utf8');
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.addScriptTag({ type: 'module', content: renderer + '\nwindow.renderNotificationWav = renderToWav;' });
  await page.addScriptTag({ content: definitions + '\nwindow.notificationDefinitions = PATCH.sounds;' });
  const output = new URL('public/sounds/notifications/', root);
  await mkdir(output, { recursive: true });
  for (const sound of ['error', 'warning', 'success', 'notification']) {
    const bytes = await page.evaluate(async name => {
      const blob = await window.renderNotificationWav(window.notificationDefinitions[name], { duration: 0.8, sampleRate: 22050, numberOfChannels: 1 });
      return Array.from(new Uint8Array(await blob.arrayBuffer()));
    }, sound);
    await writeFile(new URL(sound + '.wav', output), Buffer.from(bytes));
    console.log(`${sound}.wav: ${bytes.length} bytes`);
  }
} finally { await browser.close(); }
