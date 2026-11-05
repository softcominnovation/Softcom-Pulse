import { readFileSync, appendFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { parseRelease } from "./validate-release.mjs";
import { platformDigest } from "./platform-digest.mjs";

export function manifestPlan(env, digests) {
  const release = parseRelease("v" + env.RELEASE_VERSION, env.RELEASE_ENVIRONMENT);
  if (release.minor !== env.RELEASE_MINOR || release.major !== env.RELEASE_MAJOR) throw new Error("Release outputs do not agree");
  if (env.IMAGE !== "ghcr.io/softcominnovation/softcom-pulse") throw new Error("Unexpected image repository");
  const sources = ["amd64", "arm64"].map(arch => {
    const digest = digests[arch]?.trim();
    if (!/^sha256:[a-f0-9]{64}$/.test(digest ?? "")) throw new Error("Missing or invalid digest for " + arch);
    return env.IMAGE + "@" + digest;
  });
  const versions = env.RELEASE_ENVIRONMENT === "development"
    ? [release.version, "dev"] : [release.version, release.minor, release.major, "latest"];
  return { sources, tags: versions.map(version => env.IMAGE + ":" + version) };
}

export function publishManifest(env, digests, docker = args => execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] })) {
  const plan = manifestPlan(env, digests);
  // Validate the merged platform set before moving any public release alias.
  const proposed = JSON.parse(docker(["buildx", "imagetools", "create", "--dry-run", ...plan.sources]));
  const expected = Object.fromEntries(["amd64", "arm64"].map(arch => [arch, platformDigest(proposed, arch)]));
  docker(["buildx", "imagetools", "create", ...plan.tags.flatMap(tag => ["--tag", tag]), ...plan.sources]);
  const published = JSON.parse(docker(["buildx", "imagetools", "inspect", plan.tags[0], "--raw"]));
  for (const arch of ["amd64", "arm64"]) if (platformDigest(published, arch) !== expected[arch]) throw new Error("Published platform differs: " + arch);
  return plan.tags;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const digests = Object.fromEntries(["amd64", "arm64"].map(arch => [arch, readFileSync(".cache/digests/" + arch, "utf8")]));
  const tags = publishManifest(process.env, digests);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, "Published validated AMD64 + ARM64: " + tags.join(", ") + "\n");
}
