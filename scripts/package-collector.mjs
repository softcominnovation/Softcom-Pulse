import { cp, mkdir, readFile, access } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url), target = new URL(".next/standalone/", root);
for (const path of ["collector/", "lib/", "generated/prisma/"]) {
  await mkdir(new URL(path, target), { recursive: true });
  await cp(new URL(path, root), new URL(path, target), { recursive: true });
}
const rootPath = fileURLToPath(root), targetPath = fileURLToPath(target), copied = new Set();
async function copyDependency(name, from) {
  const require = createRequire(join(from, "package.json"));
  let entry;
  try { entry = require.resolve(name + "/package.json"); } catch { entry = require.resolve(name); }
  let directory = dirname(entry);
  while (directory !== dirname(directory)) {
    try { if (JSON.parse(await readFile(join(directory, "package.json"), "utf8")).name === name) break; } catch {}
    directory = dirname(directory);
  }
  const path = relative(rootPath, directory);
  if (!path.startsWith("node_modules") || resolve(rootPath, path) !== directory) throw new Error("Collector dependency must be installed inside the project: " + name);
  if (copied.has(directory)) return;
  copied.add(directory);
  const pkg = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
  await mkdir(dirname(join(targetPath, path)), { recursive: true });
  await cp(directory, join(targetPath, path), { recursive: true });
  for (const dependency of Object.keys(pkg.dependencies ?? {})) await copyDependency(dependency, directory);
  for (const dependency of Object.keys(pkg.optionalDependencies ?? {})) {
    try { require.resolve(dependency); } catch { continue; }
    await copyDependency(dependency, directory);
  }
}
for (const dependency of ["@prisma/adapter-pg", "@prisma/client", "pg", "redis", "axios", "zod", "re2js", "server-only"]) await copyDependency(dependency, rootPath);
await access(new URL("node_modules/@prisma/adapter-pg/package.json", target));
