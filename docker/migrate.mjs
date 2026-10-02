import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { withMigrationLock } from "./migration-lock.mjs";

export function runMigrationProcess(signal, { command = process.execPath, args = [fileURLToPath(new URL("../node_modules/prisma/build/index.js", import.meta.url)), "migrate", "deploy"], cwd = fileURLToPath(new URL("..", import.meta.url)) } = {}) {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const child = spawn(command, args, { cwd, stdio: "ignore", windowsHide: true, detached: process.platform !== "win32" });
    let escalation;
    const stop = () => {
      if (!child.pid) return;
      if (process.platform === "win32") {
        spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }).on("error", () => child.kill());
      } else {
        try { process.kill(-child.pid, "SIGTERM"); } catch {}
        escalation = setTimeout(() => { try { process.kill(-child.pid, "SIGKILL"); } catch {} }, 3000);
      }
    };
    signal.addEventListener("abort", stop, { once: true });
    child.once("error", () => { signal.removeEventListener("abort", stop); clearTimeout(escalation); reject(new Error("Migration process could not start.")); });
    child.once("close", (code) => {
      signal.removeEventListener("abort", stop);
      clearTimeout(escalation);
      if (code === 0 && !signal.aborted) resolve();
      else reject(new Error("Migration process failed; application startup cancelled."));
    });
  });
}

export async function migrate() {
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  const deadline = setTimeout(stop, 15 * 60 * 1000);
  try {
    await withMigrationLock({ connectionString: process.env.DATABASE_URL, signal: controller.signal, execute: runMigrationProcess });
    console.log("Database migrations completed.");
  } finally {
    clearTimeout(deadline);
    process.removeListener("SIGTERM", stop);
    process.removeListener("SIGINT", stop);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  migrate().catch(() => { console.error("Database initialization failed; application was not started."); process.exitCode = 1; });
}
