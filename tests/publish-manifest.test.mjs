import test from "node:test";
import assert from "node:assert/strict";
import { manifestPlan, publishManifest } from "../scripts/publish-manifest.mjs";

const digests = { amd64: "sha256:" + "a".repeat(64), arm64: "sha256:" + "b".repeat(64) };
const env = { IMAGE: "ghcr.io/softcominnovation/softcom-pulse", RELEASE_VERSION: "0.6.9-dev", RELEASE_MINOR: "0.6", RELEASE_MAJOR: "0", RELEASE_ENVIRONMENT: "development" };
const index = { manifests: Object.entries(digests).map(([architecture, digest]) => ({ digest, platform: { os: "linux", architecture } })) };

test("release aliases preserve dev/prod separation and require both valid image digests", () => {
  assert.deepEqual(manifestPlan(env, digests).tags.map(tag => tag.split(":").at(-1)), ["0.6.9-dev", "dev"]);
  assert.deepEqual(manifestPlan({ ...env, RELEASE_VERSION: "0.6.9", RELEASE_ENVIRONMENT: "production" }, digests).tags.map(tag => tag.split(":").at(-1)), ["0.6.9", "0.6", "0", "latest"]);
  assert.throws(() => manifestPlan(env, { amd64: digests.amd64 }));
  assert.throws(() => manifestPlan(env, { ...digests, arm64: "bad;command" }));
  assert.throws(() => manifestPlan({ ...env, RELEASE_MINOR: "1.0" }, digests));
});

test("a missing or duplicate platform prevents all tag mutations", () => {
  for (const manifests of [[index.manifests[0]], [...index.manifests, index.manifests[1]]]) {
    const calls = [];
    assert.throws(() => publishManifest(env, digests, args => { calls.push(args); return JSON.stringify({ manifests }); }));
    assert.equal(calls.length, 1);
    assert.ok(calls[0].includes("--dry-run"));
  }
});

test("publication checks both runtime digests again after assembling aliases", () => {
  const calls = [];
  publishManifest(env, digests, args => { calls.push(args); return JSON.stringify(index); });
  assert.equal(calls.length, 3);
  assert.ok(calls[1].includes("--tag"));
  assert.ok(calls[2].includes("--raw"));
  let call = 0;
  assert.throws(() => publishManifest(env, digests, () => JSON.stringify(++call === 3 ? { manifests: [] } : index)));
});
