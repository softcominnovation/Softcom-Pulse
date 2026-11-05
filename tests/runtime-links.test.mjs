import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { copyPortableRuntime, makeRuntimeLinksPortable } from "../scripts/runtime-links.mjs";

test("packaged aliases survive relocation without depending on the checkout", async () => {
  const base = await mkdtemp(join(tmpdir(), "pulse-runtime-links-"));
  try {
    const project = join(base, "project"), output = join(project, "standalone");
    // Match Next's order: alias directories may precede their dependency targets.
    await mkdir(join(output, ".next/node_modules/@scope"), { recursive: true });
    for (const root of [project, output]) {
      await mkdir(join(root, "node_modules/pkg"), { recursive: true });
      await writeFile(join(root, "node_modules/pkg/index.js"), "export const value = 42;");
    }
    await symlink(join(project, "node_modules/pkg"), join(output, ".next/node_modules/@scope/pkg-hash"), process.platform === "win32" ? "junction" : "dir");
    await makeRuntimeLinksPortable(output, project);
    const moved = join(base, "moved");
    await copyPortableRuntime(output, moved);
    const link = join(moved, ".next/node_modules/@scope/pkg-hash/index.js");
    assert.equal(await readFile(link, "utf8"), "export const value = 42;");
    assert.ok((await realpath(link)).startsWith(resolve(moved) + sep));
  } finally {
    assert.ok(resolve(base).startsWith(resolve(tmpdir()) + sep));
    await rm(base, { recursive: true, force: true });
  }
});

test("packaging rejects links outside the checkout rather than including external files", async () => {
  const base = await mkdtemp(join(tmpdir(), "pulse-runtime-links-"));
  try {
    const project = join(base, "project"), output = join(project, "standalone"), outside = join(base, "outside");
    await mkdir(output, { recursive: true });
    await mkdir(outside);
    await symlink(outside, join(output, "external"), process.platform === "win32" ? "junction" : "dir");
    await assert.rejects(makeRuntimeLinksPortable(output, project), /outside the project/);
  } finally {
    assert.ok(resolve(base).startsWith(resolve(tmpdir()) + sep));
    await rm(base, { recursive: true, force: true });
  }
});
