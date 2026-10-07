import { runVpsMonitor } from "./vps-monitor-worker.ts";

if (process.argv.includes("--check")) console.log("Pulse VPS monitor runtime is available.");
else await runVpsMonitor(process.argv.includes("--once")).catch(() => {
  console.error(JSON.stringify({ event: "vps_monitor_stopped", error: "vps_monitor_initialization_failed" }));
  process.exitCode = 1;
});
