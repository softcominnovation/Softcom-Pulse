import test from "node:test";
import assert from "node:assert/strict";
import { checkDependencies } from "../lib/server/health-result.ts";

for (const [database, cache] of [[true, true], [false, true], [true, false], [false, false]]) {
  test("health distinguishes dependencies: " + database + "/" + cache, async () => {
    const probe = up => () => up ? Promise.resolve("PONG") : Promise.reject(new Error("private connection details"));
    assert.deepEqual(await checkDependencies(probe(database), probe(cache)), {
      status: database && cache ? "ok" : "unavailable",
      checks: { database: database ? "up" : "down", cache: cache ? "up" : "down" },
    });
  });
}
test("synchronous configuration errors do not leak", async () => {
  const result = await checkDependencies(() => { throw new Error("secret"); }, async () => "PONG");
  assert.equal(result.checks.database, "down");
  assert.ok(!JSON.stringify(result).includes("secret"));
});
