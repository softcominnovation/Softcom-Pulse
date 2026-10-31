import test from "node:test";
import assert from "node:assert/strict";
import { notificationDay, notificationDateError } from "../lib/notifications/history-range.ts";
import { notificationHistoryQuery } from "../lib/notifications/contracts.ts";

test("notification calendar uses Fortaleza day boundaries independently of the host timezone", () => {
  assert.equal(notificationDay("2026-10-30T02:59:59.999Z"),"2026-10-29");
  assert.equal(notificationDay("2026-10-30T03:00:00.000Z"),"2026-10-30");
  assert.equal(notificationDay("2026-01-01T02:00:00Z"),"2025-12-31");
});
test("history defaults to today, permits a single past day and validates ranges", () => {
  assert.equal(notificationHistoryQuery.parse({}).from,notificationDay());
  assert.equal(notificationHistoryQuery.parse({}).to,undefined);
  assert.equal(notificationDateError("2026-10-28",undefined,"2026-10-29"),null);
  assert.equal(notificationDateError("2026-10-28","2026-10-29","2026-10-29"),null);
  for(const [from,to,field] of [["",undefined,"from"],["2026-02-30",undefined,"from"],["0000-01-01",undefined,"from"],["2026-10-30",undefined,"from"],["2026-10-29","2026-10-30","to"],["2026-10-29","2026-10-28","to"]]) assert.equal(notificationDateError(from,to,"2026-10-29").field,field);
  assert.equal(notificationHistoryQuery.safeParse({from:"9999-01-01"}).success,false);
  assert.equal(notificationHistoryQuery.safeParse({from:"2026-02-30"}).success,false);
});
