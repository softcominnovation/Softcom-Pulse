import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function platformDigest(index, architecture) {
  if (!["amd64", "arm64"].includes(architecture) || !Array.isArray(index?.manifests)) {
    throw new Error("Invalid platform or image index");
  }
  const matches = index.manifests.filter(manifest =>
    manifest.platform?.os === "linux" &&
    manifest.platform?.architecture === architecture &&
    manifest.annotations?.["vnd.docker.reference.type"] !== "attestation-manifest"
  );
  if (matches.length !== 1 || !/^sha256:[a-f0-9]{64}$/.test(matches[0].digest)) {
    throw new Error(`Expected one valid runtime manifest for linux/${architecture}`);
  }
  return matches[0].digest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const index = JSON.parse(readFileSync(process.argv[2], "utf8"));
  console.log(platformDigest(index, process.argv[3]));
}
