import { runSignalMonitor } from "./signal-monitor-worker.ts";

if (process.argv.includes("--check")) console.log("Pulse Signal monitor runtime is available.");
else await runSignalMonitor(process.argv.includes("--once")).catch(() => {
  console.error(JSON.stringify({ event: "signal_monitor_stopped", error: "signal_monitor_initialization_failed" }));
  process.exitCode = 1;
});
