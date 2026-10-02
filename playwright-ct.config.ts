import { defineConfig } from "@playwright/experimental-ct-react";
import { fileURLToPath } from "node:url";
process.env.PLAYWRIGHT_BROWSERS_PATH ??= fileURLToPath(new URL(".cache/ms-playwright", import.meta.url));
export default defineConfig({
  testDir: "./tests/components", workers: 1,
  use: { trace: "retain-on-failure", ctPort: 3101, ctViteConfig: { resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } } } },
});
