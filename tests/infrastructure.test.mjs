import { test } from "node:test";
import assert from "node:assert/strict";
import { alignSeries, historyGroups, historyValue } from "../lib/infrastructure/history.ts";
import { asgardUrl, detailQuerySchema, selectHypervisor } from "../lib/infrastructure/navigation.ts";
import { blockCatalog } from "../lib/config/presentation.ts";

test("detail links preserve opaque identities and reject duplicate or invalid selection parameters", () => {
  const url = new URL(asgardUrl("Host & Espaço", "vm-?=#", "7d"), "http://localhost");
  assert.equal(url.searchParams.get("hostKey"), "Host & Espaço"); assert.equal(url.searchParams.get("vm"), "vm-?=#"); assert.equal(url.searchParams.get("range"), "7d");
  assert.equal(detailQuerySchema.parse({}).range, "24h");
  for (const input of [{ hostKey: ["a", "b"] }, { vm: "" }, { vm: "../a" }, { range: "365d" }, { hostKey: " a" }]) assert.equal(detailQuerySchema.safeParse(input).success, false);
});
test("default ASGARD selection honors the server identity and never picks an arbitrary host", () => {
  const a = { hostKey: "A", role: "hypervisor" }, b = { hostKey: "B", role: "hypervisor" };
  assert.equal(selectHypervisor({ data: [a, b] }), undefined);
  assert.equal(selectHypervisor({ data: [a, b], asgardHostKey: "B" }), b);
  assert.equal(selectHypervisor({ data: [a, b], asgardHostKey: "B" }, "missing"), undefined);
  assert.equal(selectHypervisor({ data: [a] }), a);
});
test("history keeps units and devices separate and does not manufacture percentage series", () => {
  const series = (key, unit) => ({ key, unit, points: [] });
  const history = { series: [series("cpuUsagePercent", "percent"), series("memoryUsedBytes", "bytes"), series("memoryTotalBytes", "bytes"), series("interfaces.device-1.networkReceiveBitsPerSecond", "bits/s"), series("filesystems.device-2.diskUsagePercent", "percent")] };
  const groups = historyGroups(history, { interfaces: [{ key: "device-1", name: "eth0" }], filesystems: [{ key: "device-2", name: "/data" }], storages: [] });
  assert.equal(groups.length, 4); assert.equal(groups[1].series.length, 2); assert.equal(groups[1].unit, "bytes");
  assert.ok(groups.some(group => group.label.includes("eth0"))); assert.ok(groups.some(group => group.label.includes("/data")));
  assert.equal(groups[0].series[0].color, "#64d6b0"); assert.equal(groups[1].series[0].color, "#80bdf2"); assert.equal(groups.find(group => group.label.includes("/data")).series[0].color, "#f2c275");
  assert.equal(groups.flatMap(group => group.series).some(item => item.key === "memoryUsagePercent"), false);
});
test("real source ordering cannot make uptime hide the default CPU chart", () => {
  const groups = historyGroups({series:[{key:"uptimeSeconds",unit:"seconds",points:[]},{key:"memoryUsedBytes",unit:"bytes",points:[]},{key:"cpuUsagePercent",unit:"percent",points:[]}]});
  assert.equal(groups[0].series[0].key,"cpuUsagePercent"); assert.equal(groups.at(-1).unit,"seconds");
});
test("alignment preserves explicit nulls, unsampled timestamps, observed zero and ordering", () => {
  const point = (second, value) => ({ timestamp: `2026-10-03T00:00:0${second}Z`, value });
  const data = alignSeries([{ points: [point(2, null), point(0, 0)] }, { points: [point(1, 10), point(2, 12)] }]);
  assert.deepEqual(data[0], [...data[0]].sort()); assert.deepEqual(data[1], [0, null, null]); assert.deepEqual(data[2], [null, 10, 12]);
  assert.equal(historyValue(0, "percent"), "0%"); assert.equal(historyValue(null, "percent"), "Sem dados"); assert.equal(historyValue(1024 ** 3, "bytes"), "1 GiB");
});
test("host and container inventory are available in their delivered phases", () => {
  assert.equal(blockCatalog.host_inventory.available, true); assert.equal(blockCatalog.container_inventory.available, true);
});
