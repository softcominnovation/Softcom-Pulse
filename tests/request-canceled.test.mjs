import test from "node:test";
import assert from "node:assert/strict";
import { CanceledError, AxiosError } from "axios";
import { requestCanceled } from "../lib/client/request-canceled.ts";

test("requestCanceled detects axios cancel shapes", () => {
  assert.equal(requestCanceled(new CanceledError()), true);
  assert.equal(requestCanceled(new AxiosError("canceled", "ERR_CANCELED")), true);
  assert.equal(requestCanceled(Object.assign(new Error("aborted"), { name: "AbortError" })), true);
  assert.equal(requestCanceled(new Error("network")), false);
  assert.equal(requestCanceled(null), false);
});
