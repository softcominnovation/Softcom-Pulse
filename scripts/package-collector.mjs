import { cp, mkdir, readFile, access, readdir, unlink, chmod } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { makeRuntimeLinksPortable } from "./runtime-links.mjs";

const root = new URL("../", import.meta.url), target = new URL(".next/standalone/", root);
// Complete standalone payload: web, workers and the locked migration entrypoint.
for (const path of ["collector/", "lib/", "generated/prisma/", "prisma/", "public/"]) {
  await mkdir(new URL(path, target), { recursive: true });
  await cp(new URL(path, root), new URL(path, target), { recursive: true });
}
const rootPath = fileURLToPath(root), targetPath = fileURLToPath(target), copied = new Set();
async function packageDirectory(name, from) {
  // Some packages only export subpaths (e.g. Prisma Studio), not their root or manifest.
  const require = createRequire(join(from, "package.json"));
  for (const base of require.resolve.paths(name) ?? []) {
    const directory = join(base, name);
    try { if (JSON.parse(await readFile(join(directory, "package.json"), "utf8")).name === name) return directory; }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  throw new Error("Runtime dependency not installed: " + name);
}
async function copyDependency(name, from) {
  const directory = await packageDirectory(name, from);
  const path = relative(rootPath, directory);
  if (!path.startsWith("node_modules") || resolve(rootPath, path) !== directory) throw new Error("Collector dependency must be installed inside the project: " + name);
  if (copied.has(directory)) return;
  copied.add(directory);
  const pkg = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
  await mkdir(dirname(join(targetPath, path)), { recursive: true });
  await cp(directory, join(targetPath, path), { recursive: true, verbatimSymlinks: true });
  for (const dependency of Object.keys(pkg.dependencies ?? {})) await copyDependency(dependency, directory);
  for (const dependency of Object.keys(pkg.optionalDependencies ?? {})) {
    try { await packageDirectory(dependency, directory); } catch { continue; }
    await copyDependency(dependency, directory);
  }
}
// Keep the CLI's dependency closure, not the application's full production install.
for (const dependency of ["@prisma/adapter-pg", "@prisma/client", "pg", "redis", "axios", "zod", "re2js", "server-only", "prisma", "dotenv", "sharp"]) await copyDependency(dependency, rootPath);
await cp(new URL(".next/static/", root), new URL(".next/static/", target), { recursive: true });
await mkdir(new URL("docker/", target), { recursive: true });
for (const path of ["prisma.config.ts", "docker/migrate.mjs", "docker/migration-lock.mjs", "docker/entrypoint.sh"]) {
  await cp(new URL(path, root), new URL(path, target));
}
await chmod(new URL("docker/entrypoint.sh", target), 0o755);
// Next tracing may include local env files. They must never enter a runtime artifact.
for (const name of await readdir(target)) if (name.startsWith(".env")) await unlink(new URL(name, target));
await makeRuntimeLinksPortable(targetPath, rootPath);
await access(new URL("node_modules/@prisma/adapter-pg/package.json", target));
