import { appendFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export function parseRelease(tag, environment) {
  if (!["production", "development"].includes(environment)) throw new Error("Unknown release environment.");
  const suffix = environment === "development" ? "-dev" : "";
  const pattern = new RegExp("^v(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)" + suffix + "$");
  const match = pattern.exec(tag || "");
  if (!match || match[0] !== tag) throw new Error("Tag does not match the release environment.");
  return { version: tag.slice(1), major: match[1], minor: match[1] + "." + match[2], branch: environment === "development" ? "develop" : "main" };
}

export function validateRelease(environment, env = process.env) {
  const release = parseRelease(env.GITHUB_REF_NAME, environment);
  const result = spawnSync("git", ["merge-base", "--is-ancestor", "HEAD", "origin/" + release.branch], { encoding: "utf8", windowsHide: true });
  if (result.status !== 0) throw new Error("Tagged commit does not belong to the expected branch.");
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, "version=" + release.version + "\nmajor=" + release.major + "\nminor=" + release.minor + "\n");
  return release;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { validateRelease(process.argv[2]); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
