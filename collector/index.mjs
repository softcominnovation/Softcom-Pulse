import { runCollector } from "./worker.ts";

if (process.argv.includes("--check")) console.log("Pulse collector runtime is available.");
else await runCollector(process.argv.includes("--once")).catch(() => {
  console.error(JSON.stringify({ event: "collector_stopped", error: "collector_initialization_failed" }));
  process.exitCode = 1;
});
