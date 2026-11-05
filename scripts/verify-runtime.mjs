import { access, readdir, lstat, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve, relative, isAbsolute, join } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export async function verifyRuntime(directory, { requireNonRoot = false } = {}) {
  const root = resolve(directory);
  if (requireNonRoot && process.getuid?.() === 0) throw new Error("Runtime must not run as root");
  const required = ["server.js", ".next/static", "prisma/schema.prisma", "prisma/migrations/migration_lock.toml", "prisma.config.ts",
    "docker/migrate.mjs", "docker/migration-lock.mjs", "docker/entrypoint.sh", "node_modules/prisma/build/index.js", "node_modules/@prisma/engines",
    "public/logo.ico", "public/images/login-image.png", "public/images/softcom-logo.png", "public/images/404.png"];
  for (const file of required) await access(join(root, file));
  if ((await readdir(root)).some(name => name.startsWith(".env"))) throw new Error("Runtime contains a local env file");
  const require = createRequire(join(root, "package.json"));
  for (const dependency of ["pg", "redis", "axios", "zod", "prisma/config", "dotenv", "sharp", "@prisma/adapter-pg", "@prisma/client/runtime/client"]) {
    const path = relative(root, require.resolve(dependency));
    if (path.startsWith("..") || isAbsolute(path)) throw new Error("Dependency resolved outside runtime: " + dependency);
  }
  // Exercise a native binary in the final OS, not only the host that compiled it.
  const sharp = require("sharp");
  await sharp({ create: { width: 1, height: 1, channels: 3, background: "#000" } }).png().toBuffer();
  for (const args of [
    ...["index", "probe", "vps-monitor", "signal-monitor"].map(worker => ["--conditions=react-server", `collector/${worker}.mjs`, "--check"]),
    ["node_modules/prisma/build/index.js", "validate"],
  ]) {
    const result = spawnSync(process.execPath, args, { cwd: root, windowsHide: true, encoding: "utf8", timeout: 60000,
      env: { ...process.env, DATABASE_URL: "postgresql://check:check@127.0.0.1:1/check", CHECKPOINT_DISABLE: "1" } });
    if (result.status !== 0) throw new Error(`Runtime check failed (${args.join(" ")}): ${result.stderr || result.error || result.status}`);
  }
  async function bytes(path) {
    const info = await lstat(path);
    if (info.isSymbolicLink()) {
      const target = relative(root, await realpath(path));
      if (target.startsWith("..") || isAbsolute(target)) throw new Error("Runtime symlink escapes the package: " + relative(root, path));
      return 0;
    }
    if (info.isFile()) return info.size;
    if (!info.isDirectory()) return 0;
    let total = 0;
    for (const name of await readdir(path)) total += await bytes(join(path, name));
    return total;
  }
  const size = await bytes(root);
  console.log(`Validated standalone runtime: ${(size / 1024 / 1024).toFixed(1)} MiB (web, four workers, migration CLI).`);
  return size;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await verifyRuntime(process.argv[2] ?? ".next/standalone", { requireNonRoot: process.argv.includes("--non-root") });
}
