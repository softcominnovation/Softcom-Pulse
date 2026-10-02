import test from "node:test";
import assert from "node:assert/strict";
import { parseRelease } from "../scripts/validate-release.mjs";

test("stable and development tags are strict and disjoint", () => {
  assert.deepEqual(parseRelease("v1.2.3", "production"), { version: "1.2.3", major: "1", minor: "1.2", branch: "main" });
  assert.equal(parseRelease("v0.1.0-dev", "development").branch, "develop");
  for (const tag of ["v1.2.3-dev", "v1.2.3-rc", "v1.2.3-beta", "v1.2.3+build", "v01.2.3", "1.2.3", "v1.2", "v1.2.3\n"]) assert.throws(() => parseRelease(tag, "production"));
  for (const tag of ["v1.2.3", "v1.2.3-dev.1", "v1.2.3-dev-extra", "v1.2.3-beta"]) assert.throws(() => parseRelease(tag, "development"));
  assert.throws(() => parseRelease("v1.2.3", "preview"));
});
