import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { startAuthUpstream } from "./auth-upstream.mjs";

const upstream = await startAuthUpstream(3102);
const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", "3100"], {
  windowsHide: true, stdio: "inherit",
  env: { ...process.env, PULSE_E2E: "1", API_BASE_URL: upstream.url, TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("base64") },
});
async function close() { child.kill(); await upstream.close(); }
process.on("SIGTERM", () => { void close(); });
process.on("SIGINT", () => { void close(); });
child.on("exit", async code => { await upstream.close(); process.exit(code ?? 0); });
