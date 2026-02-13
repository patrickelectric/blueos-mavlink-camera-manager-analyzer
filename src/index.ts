/**
 * CPU Analyzer for mavlink-camera-manager
 *
 * Entry point: parses CLI arguments, initializes the collector, store,
 * and HTTP/WebSocket server, then starts periodic data collection.
 */

import { parseArgs } from "util";
import type { Config } from "./types";
import { SnapshotStore } from "./store";
import { Collector } from "./collector";
import { createServer, createBroadcaster } from "./server";

// ── Parse CLI arguments ──

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    host: { type: "string", default: "192.168.31.113" },
    "docker-port": { type: "string", default: "2375" },
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

Usage: bun run src/index.ts [options]

Options:
  --host <ip>          Docker host IP (default: 192.168.31.113)
  --docker-port <n>    Docker API port (default: 2375)
  --container <name>   Container name (default: blueos-core)
  --process <name>     Process name for pgrep (default: mavlink-camera-)
  --interval <ms>      Sample interval in ms (default: 1000)
  --port <n>           Dashboard HTTP port (default: 3000)
  --history <n>        Max samples in memory (default: 600)
  --help               Show this help
`);
  process.exit(0);
}

const config: Config = {
  dockerHost: (values.host as string) ?? "192.168.31.113",
  dockerPort: parseInt((values["docker-port"] as string) ?? "2375", 10),
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
console.log(`  Docker host:     ${config.dockerHost}:${config.dockerPort}`);
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
console.log(`[server] Dashboard running at http://localhost:${config.dashboardPort}`);

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
  server.stop();
  process.exit(0);
});

process.on("SIGTERM", () => {
  collector.stop();
  server.stop();
  process.exit(0);
});
