import test from "node:test";
import assert from "node:assert/strict";
import { platformDigest } from "../scripts/platform-digest.mjs";

const manifest = (architecture, digit) => ({
  platform: { os: "linux", architecture }, digest: "sha256:" + digit.repeat(64),
});
test("runtime verification selects separate platform digests and ignores attestations", () => {
  const index = { manifests: [
    manifest("amd64", "a"), manifest("arm64", "b"), manifest("unknown", "c"),
    { ...manifest("amd64", "d"), annotations: { "vnd.docker.reference.type": "attestation-manifest" } },
  ] };
  assert.equal(platformDigest(index, "amd64"), "sha256:" + "a".repeat(64));
  assert.equal(platformDigest(index, "arm64"), "sha256:" + "b".repeat(64));
});
test("missing, ambiguous and malformed runtime manifests stop verification", () => {
  for (const index of [{}, { manifests: [] }, { manifests: [manifest("amd64", "a"), manifest("amd64", "b")] },
    { manifests: [{ ...manifest("amd64", "a"), digest: "invalid" }] },
    { manifests: [{ ...manifest("amd64", "a"), platform: { os: "windows", architecture: "amd64" } }] }]) {
    assert.throws(() => platformDigest(index, "amd64"));
  }
});
