const keepAlive = setInterval(() => {}, 60000);
console.log("Pulse collector is waiting; Zabbix collection is not enabled in this phase.");
for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, () => {
  clearInterval(keepAlive);
  process.exitCode = 0;
});
