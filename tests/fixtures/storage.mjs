import { zabbixFixture } from "./zabbix.mjs";
export function storageFixture(now = Date.now()) {
  const f = zabbixFixture(now), source = f.hosts.find(host => host.hostid === "2");
  const host = { ...source, hostid: "77", host: "arbitrary-data-vm", name: "Data VM", tags: [{ tag: "role", value: "worker" }, { tag: "role", value: "storage" }] };
  f.hosts.push(host);
  const copied = f.items.filter(item => item.hostid === "2" && !item.key_.startsWith("docker.")).map((item, i) => ({ ...item, hostid: host.hostid, itemid: String(7700 + i) }));
  copied.find(item => item.key_ === "zabbix[host,agent,available]").lastvalue = "1";
  f.items.push(...copied);
  let id = 8000;
  const item = (key_, value, units, extra = {}) => {
    const row = { ...copied[0], itemid: String(id++), key_, name: key_, units, lastvalue: String(value), ...extra };
    f.items.push(row); return row;
  };
  for (const [mount, used, total, free] of [["/", 400, 1000, 500], ["/data", 9000, 10000, 800]]) {
    for (const [kind, value] of [["used", used], ["total", total], ["free", free]]) item(`vfs.fs.size[${mount},${kind}]`, value, "B");
  }
  item("system.cpu.util[,iowait]", 0, "%");
  item("vfs.fs.dependent[/,readonly]", 0, "");
  item("vfs.fs.dependent.inode[/,pfree]", 99, "%");
  const rpc = async (method, params, signal) => {
    if (method === "host.get" && (params.tags || params.hostids)) {
      f.calls.push({ method, params });
      return f.hosts.filter(candidate => params.hostids ? params.hostids.includes(candidate.hostid) : candidate.tags.some(tag => tag.tag === "role" && tag.value === "storage"));
    }
    return f.rpc(method, params, signal);
  };
  return { ...f, rpc, host, item };
}
