import { runProbe } from "./probe-worker.ts";

if (process.argv.includes("--check")) console.log("Pulse probe runtime is available.");
else await runProbe(process.argv.includes("--once")).catch(() => {
  console.error(JSON.stringify({ event: "probe_stopped", error: "probe_initialization_failed" }));
  process.exitCode = 1;
});
