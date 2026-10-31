import { createServer, type Server } from "node:http";
import { test, expect } from "@playwright/test";

let parent: Server;
let parentUrl: string;

test.beforeAll(async ({ baseURL }) => {
  parent = createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(`<!doctype html><iframe title="Pulse" src="${baseURL}/monitor" width="1366" height="768"></iframe>`);
  });
  await new Promise<void>(resolve => parent.listen(0, "127.0.0.1", resolve));
  const address = parent.address();
  if (!address || typeof address === "string") throw new Error("Iframe parent did not start");
  parentUrl = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => { await new Promise<void>((resolve, reject) => parent.close(error => error ? reject(error) : resolve())); });

for (const mode of ["cross-origin", "blocked-storage"]) {
  test(`public dashboard loads in ${mode} iframe without private requests`, async ({ page }) => {
    const errors: string[] = [], privateRequests: string[] = [], writes: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => {
      const path = new URL(request.url()).pathname;
      if (!path.startsWith("/api/")) return;
      if (!path.startsWith("/api/public/")) privateRequests.push(path);
      if (request.method() !== "GET") writes.push(path);
    });
    if (mode === "blocked-storage") await page.addInitScript(() => {
      if (location.port !== "3100") return;
      for (const key of ["localStorage", "sessionStorage"]) Object.defineProperty(window, key, {
        configurable: true,
        get() { throw new DOMException("Storage unavailable", "SecurityError"); },
      });
    });
    const loaded = page.waitForResponse(response => new URL(response.url()).pathname === "/api/public/dashboard/overview");
    await page.goto(parentUrl);
    const response = await loaded;
    expect(response.status()).toBe(200);
    expect((await response.json()).data.blocks.length).toBeGreaterThan(0);
    const frame = page.frameLocator('iframe[title="Pulse"]');
    await expect(frame.locator(".dashboard-blocks")).toBeVisible();
    await expect(frame.getByText("Carregando as telas configuradas…", { exact: true })).toHaveCount(0);
    await expect(frame.getByRole("button", { name: /^Notificações:/ })).toBeVisible();
    expect(errors).toEqual([]);
    expect(privateRequests).toEqual([]);
    expect(writes).toEqual([]);
  });
}

test("public iframe permissions do not open private reads or public writes", async ({ request }) => {
  const headers = { Origin: "null" };
  const privateRead = await request.get("/api/dashboard/overview", { headers });
  expect(privateRead.status()).toBe(401);
  expect(privateRead.headers()["access-control-allow-origin"]).toBeUndefined();
  const write = await request.post("/api/public/settings/presentation", { headers, data: {} });
  expect(write.status()).toBe(405);
  expect(write.headers()["access-control-allow-origin"]).toBeUndefined();
});
