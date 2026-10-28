import test from "node:test";
import assert from "node:assert/strict";
import { pulseAlertTabIcon, pulseTabIcon, tabProblemVisible } from "../lib/notifications/tab-icon.ts";

test("the tab icon marks an unread active incident only while the document is hidden", () => {
  assert.equal(tabProblemVisible(true, 1, 1), true);
  assert.equal(tabProblemVisible(true, 1, 0), false);
  assert.equal(tabProblemVisible(true, 0, 2), false);
  assert.equal(tabProblemVisible(false, 3, 3), false);
  assert.notEqual(pulseAlertTabIcon, pulseTabIcon);
  assert.match(decodeURIComponent(pulseAlertTabIcon), /#dc2626/);
  assert.doesNotMatch(decodeURIComponent(pulseTabIcon), /#dc2626/);
});
