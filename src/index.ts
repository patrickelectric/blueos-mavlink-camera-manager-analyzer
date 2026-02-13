/**
 * CPU Analyzer for mavlink-camera-manager
 *
 * Entry point: parses CLI arguments, initializes the collector, store,
 * and HTTP/WebSocket server, then starts periodic data collection.
 */

import { parseArgs } from "node:util";
import type { Config } from "./types";
import { SnapshotStore } from "./store";
import { Collector } from "./collector";
import { createServer, createBroadcaster } from "./server";

// ── Parse CLI arguments ──

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    "docker-socket": { type: "string", default: "/var/run/docker.sock" },
    container: { type: "string", default: "blueos-core" },
    process: { type: "string", default: "mavlink-camera-" },
    interval: { type: "string", default: "1000" },
    port: { type: "string", default: "3000" },
    history: { type: "string", default: "600" },
    help: { type: "boolean", default: false },
  },
  strict: false,
  allowPositionals: true,
});

if (values.help) {
  console.log(`
CPU Analyzer for mavlink-camera-manager

Usage: npx tsx src/index.ts [options]

Options:
  --docker-socket <path>  Docker socket path (default: /var/run/docker.sock)
  --container <name>      Container name (default: blueos-core)
  --process <name>        Process name for pgrep (default: mavlink-camera-)
  --interval <ms>         Sample interval in ms (default: 1000)
  --port <n>              Dashboard HTTP port (default: 3000)
  --history <n>           Max samples in memory (default: 600)
  --help                  Show this help
`);
  process.exit(0);
}

const config: Config = {
  dockerSocket: (values["docker-socket"] as string) ?? "/var/run/docker.sock",
  container: (values.container as string) ?? "blueos-core",
  processName: (values.process as string) ?? "mavlink-camera-",
  sampleIntervalMs: parseInt((values.interval as string) ?? "1000", 10),
  dashboardPort: parseInt((values.port as string) ?? "3000", 10),
  maxHistory: parseInt((values.history as string) ?? "600", 10),
};

// ── Initialize components ──

console.log("┌─────────────────────────────────────────────┐");
console.log("│   CPU Analyzer - mavlink-camera-manager      │");
console.log("└─────────────────────────────────────────────┘");
console.log();
console.log("Configuration:");
console.log(`  Docker socket:   ${config.dockerSocket}`);
console.log(`  Container:       ${config.container}`);
console.log(`  Process:         ${config.processName}`);
console.log(`  Sample interval: ${config.sampleIntervalMs}ms`);
console.log(`  Dashboard port:  ${config.dashboardPort}`);
console.log(`  Max history:     ${config.maxHistory} samples`);
console.log();

const store = new SnapshotStore(config.maxHistory);
const collector = new Collector(config, store);
const { broadcast, onWsConnect } = createBroadcaster();

// Wire collector snapshots to WebSocket broadcast
collector.onSnapshot(broadcast);

// Start HTTP server
const server = createServer(config.dashboardPort, store, onWsConnect);
console.log(
  `[server] Dashboard running at http://localhost:${config.dashboardPort}`
);

// Start collector
try {
  await collector.start();
  console.log("[main] Collection started. Press Ctrl+C to stop.");
} catch (error) {
  console.error("[main] Failed to start collector:", error);
  process.exit(1);
}

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\n[main] Shutting down...");
  collector.stop();
  server.close();
  process.exit(0);
});

process.on("SIGTERM", () => {
  collector.stop();
  server.close();
  process.exit(0);
});
