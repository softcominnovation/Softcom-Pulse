import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";
process.env.PLAYWRIGHT_BROWSERS_PATH ??= fileURLToPath(new URL(".cache/ms-playwright", import.meta.url));
export default defineConfig({
  testDir: "./tests/e2e", fullyParallel: true, workers: 2,
  use: { baseURL: "http://127.0.0.1:3100", trace: "retain-on-failure" },
  webServer: { command: "npm run dev -- --port 3100", url: "http://127.0.0.1:3100", reuseExistingServer: false, timeout: 60000 },
});
