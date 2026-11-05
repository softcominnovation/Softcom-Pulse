import { access, cp, lstat, readdir, readlink, realpath, stat, symlink, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

function inside(root, path) {
  const part = relative(root, path);
  return part !== ".." && !part.startsWith("../") && !part.startsWith("..\\") && !isAbsolute(part);
}

// Turbopack can emit absolute dependency links into the original checkout.
// Relocate only files already present in the payload; never pull arbitrary paths in.
export async function makeRuntimeLinksPortable(directory, sourceDirectory) {
  const root = resolve(directory), source = resolve(sourceDirectory);
  async function visit(parent) {
    for (const entry of await readdir(parent, { withFileTypes: true })) {
      const path = join(parent, entry.name);
      if (entry.isSymbolicLink()) {
        const destination = await realpath(path);
        let packaged = destination;
        if (!inside(root, destination)) {
          if (!inside(source, destination)) throw new Error("Runtime link points outside the project: " + relative(root, path));
          packaged = join(root, relative(source, destination));
        }
        await access(packaged);
        const link = await readlink(path);
        if (inside(root, destination) && !isAbsolute(link)) continue;
        const type = (await stat(packaged)).isDirectory() ? "dir" : "file";
        await unlink(path);
        try {
          await symlink(relative(dirname(path), packaged), path, type);
        } catch (error) {
          // Windows without symlink privileges cannot make portable junctions.
          // Materialize this alias there; Linux releases retain the smaller link.
          if (process.platform !== "win32" || error.code !== "EPERM") throw error;
          await cp(packaged, path, { recursive: true, dereference: true });
        }
      } else if (entry.isDirectory()) await visit(path);
    }
  }
  await visit(root);
}

// Copy regular files before aliases. On Windows fs.cp can otherwise infer a file
// link for a directory whose target has not been copied yet, producing EPERM.
export async function copyPortableRuntime(sourceDirectory, directory) {
  const source = resolve(sourceDirectory), links = [];
  await cp(source, directory, {
    recursive: true,
    filter: async (from, to) => {
      if (!(await lstat(from)).isSymbolicLink()) return true;
      const link = await readlink(from), destination = await realpath(from);
      if (isAbsolute(link) || !inside(source, destination)) throw new Error("Runtime link is not portable: " + relative(source, from));
      links.push({ to, link, destination, type: (await stat(from)).isDirectory() ? "dir" : "file" });
      return false;
    },
  });
  for (const { to, link, destination, type } of links) {
    try { await symlink(link, to, type); }
    catch (error) {
      if (process.platform !== "win32" || error.code !== "EPERM") throw error;
      await cp(destination, to, { recursive: true, dereference: true });
    }
  }
}
