export function zabbixFixture(now = Date.now()) {
  let id = 100;
  const clock = seconds => String(Math.floor(now / 1000) - seconds);
  const items = [];
  const item = (hostid, key_, lastvalue, units = "", options = {}) => {
    const value = { itemid: String(++id), hostid, name: key_, key_, type: "0", value_type: "0", units, delay: "1m", status: "0", state: "0", lastclock: clock(10), lastvalue: String(lastvalue), master_itemid: "0", tags: [], preprocessing: [], ...options };
    items.push(value); return value;
  };
  const hosts = [
    { hostid: "1", host: "ASGARD", name: "ASGARD", status: "0", tags: [], interfaces: [], hostgroups: [{ name: "Hypervisors" }] },
    { hostid: "2", host: "linux-a", name: "Linux A", status: "0", tags: [], interfaces: [{ type: "1", main: "1", available: "0" }], hostgroups: [{ name: "Linux servers" }] },
    { hostid: "3", host: "outsider", name: "Unrelated host", status: "0", tags: [], interfaces: [], hostgroups: [] },
  ];
  const scope = { scope: { hostKeys: ["ASGARD", "linux-a"], vmLinks: [{ hostKey: "linux-a", parentHostKey: "ASGARD", vmId: "qemu/101" }] }, asgardHostKey: "ASGARD" };
  const master = item("1", "proxmox.node.rrd[ASGARD]", "DO_NOT_FETCH_RAW_SECRET", "", { lastclock: "0", value_type: "4", type: "19" });
  const nodeOptions = { master_itemid: master.itemid, delay: "0", type: "18", tags: [{ tag: "node", value: "ASGARD" }], preprocessing: [{ type: "20", params: "10m" }] };
  item("1", "proxmox.node.cpu[ASGARD]", 0, "%", nodeOptions);
  item("1", "proxmox.node.memused[ASGARD]", 1024, "B", nodeOptions);
  item("1", "proxmox.node.memtotal[ASGARD]", 2048, "B", { ...nodeOptions, lastclock: clock(400) });
  item("1", "proxmox.node.online[ASGARD]", 1, "", { value_type: "3", tags: nodeOptions.tags });
  item("1", "proxmox.node.disk[ASGARD,local]", 1024, "B", nodeOptions);
  item("1", "proxmox.node.maxdisk[ASGARD,local]", 4096, "B", nodeOptions);
  for (const vm of ["101", "102"]) {
    const tags = [{ tag: "node", value: "ASGARD" }, { tag: "name", value: vm === "101" ? "Different-VM-name" : "VM-without-Agent" }, { tag: "qemu", value: "qemu/" + vm }];
    item("1", `proxmox.qemu.cpu[qemu/${vm}]`, 25, "%", { tags });
    item("1", `proxmox.qemu.vmstatus[qemu/${vm}]`, "running", "", { tags, value_type: "1" });
  }
  item("2", "system.cpu.util[,idle]", 75, "%");
  item("2", "system.uptime", 1000, "uptime", { value_type: "3" });
  item("2", "vm.memory.size[total]", 8192, "B", { value_type: "3" });
  item("2", "vm.memory.size[available]", 4096, "B", { value_type: "3" });
  item("2", "zabbix[host,agent,available]", 0, "", { value_type: "3" });
  item("2", "vfs.fs.dependent.size[/,pused]", 50, "%");
  item("2", 'net.if.in["eth0"]', 8000, "bps", { preprocessing: [{ type: "10", params: "" }, { type: "1", params: "8" }] });
  for (const [key, value] of [["running", 1], ["stopped", 4], ["total", 5]]) item("2", "docker.containers." + key, value, "", { value_type: "3" });
  const tags = [{ tag: "container", value: "/service.1.abc" }];
  const containerMaster = item("2", 'docker.container_info["/service.1.abc",full]', "DO_NOT_FETCH_CONTAINER_ENV", "", { value_type: "1", lastclock: "0", tags });
  const cOptions = { tags, type: "18", master_itemid: containerMaster.itemid, delay: "0" };
  item("2", 'docker.container_info.state.status["/service.1.abc"]', "running", "", { ...cOptions, value_type: "1", preprocessing: [{ type: "20", params: "1h" }], lastclock: clock(1800) });
  item("2", 'docker.container_info.state.health["/service.1.abc"]', 4, "", { ...cOptions, valuemap: { mappings: ["starting", "unhealthy", "healthy", "none"].map((newvalue, i) => ({ type: "0", value: String(i + 1), newvalue })) } });
  item("2", 'docker.container_info.created["/service.1.abc"]', 1700000000, "unixtime", { ...cOptions, value_type: "3" });
  item("2", 'docker.container_stats.cpu_usage.total.rate["/service.1.abc"]', 0.5, "s", { tags, preprocessing: [{ type: "10", params: "" }, { type: "1", params: "1.0E-9" }] });
  item("2", 'docker.networks.rx_bytes["/service.1.abc"]', 10, "B", { tags, preprocessing: [{ type: "10", params: "" }] });
  item("2", 'docker.container_stats.memory.usage_total["/service.1.abc"]', 1024, "B", { tags, state: "1" });
  const problems = [{ eventid: "900", objectid: "901", name: "Fixture unavailable item", severity: "4", clock: clock(60), tags: [] }];
  const triggers = [{ triggerid: "901", hosts: [{ host: "linux-a" }], items: [{ itemid: items.find(i => i.key_.includes("usage_total")).itemid }] }];
  const calls = [];
  const rpc = async (method, params) => {
    calls.push({ method, params });
    if (method === "apiinfo.version") return "7.0.31";
    if (method === "host.get") return hosts.filter(h => !params.filter?.host || params.filter.host.includes(h.host));
    if (method === "item.get") return items.filter(i => params.itemids ? params.itemids.includes(i.itemid) : params.hostids.includes(i.hostid)).map(i => Object.fromEntries(Object.entries(i).filter(([k]) => params.output.includes(k) || ["tags", "preprocessing", "valuemap", "itemDiscovery"].includes(k))));
    if (method === "problem.get") return problems;
    if (method === "trigger.get") return triggers;
    if (method === "history.get") return params.itemids.map(itemid => ({ itemid, clock: String(Math.max(params.time_from, Math.floor(now / 1000) - 30)), ns: "0", value: items.find(i => i.itemid === itemid)?.lastvalue ?? "1" }));
    if (method === "trend.get") return params.itemids.map(itemid => ({ itemid, clock: String(Math.floor(now / 1000 / 3600) * 3600), num: "60", value_avg: "10", value_min: "0", value_max: "20" }));
    throw new Error("Unexpected method " + method);
  };
  return { hosts, items, scope, problems, triggers, rpc, calls, now };
}
