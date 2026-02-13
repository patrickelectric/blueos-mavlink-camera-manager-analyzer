/**
 * Periodic data collector.
 *
 * Executes a shell script inside the Docker container at regular intervals
 * to read /proc data for all threads, computes CPU deltas from the previous
 * sample, categorizes threads, and pushes snapshots to the store.
 */

import { DockerClient } from "./docker";
import { parseCollectionOutput } from "./parser";
import { categorizeThread } from "./categorizer";
import { SnapshotStore } from "./store";
import type {
  Config,
  ThreadRaw,
  ThreadSample,
  Snapshot,
  SystemCpuRaw,
} from "./types";

/** Previous sample state for delta computation */
interface PreviousState {
  timestamp: number;
  threads: Map<number, { utime: number; stime: number; volCtx: number; involCtx: number }>;
  systemCpu: SystemCpuRaw;
}

export class Collector {
  private docker: DockerClient;
  private config: Config;
  private store: SnapshotStore;
  private previous: PreviousState | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private listeners: Set<(snapshot: Snapshot) => void> = new Set();
  private running = false;
  private collecting = false; // Guard against overlapping collections
  private numCpus = 4; // Raspberry Pi 4 has 4 cores

  constructor(config: Config, store: SnapshotStore) {
    this.config = config;
    this.store = store;
    this.docker = new DockerClient(config.dockerSocket);
  }

  /**
   * Register a listener that will be called with each new snapshot.
   */
  onSnapshot(listener: (snapshot: Snapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Start periodic collection.
   */
  async start(): Promise<void> {
    // Verify Docker connectivity
    const ok = await this.docker.ping();
    if (!ok) {
      throw new Error(
        `Cannot reach Docker API at ${this.docker.endpoint}`
      );
    }
    console.log(
      `[collector] Connected to Docker at ${this.docker.endpoint}`
    );

    // Detect number of CPUs
    try {
      const cpuInfo = await this.docker.sh(
        this.config.container,
        "nproc 2>/dev/null || grep -c ^processor /proc/cpuinfo"
      );
      const n = parseInt(cpuInfo.trim(), 10);
      if (n > 0) this.numCpus = n;
    } catch {
      // Default to 4
    }
    console.log(`[collector] Detected ${this.numCpus} CPUs`);

    this.running = true;
    // Run immediately, then at intervals
    await this.collect();
    this.timer = setInterval(() => {
      if (this.running) this.collect().catch(console.error);
    }, this.config.sampleIntervalMs);

    console.log(
      `[collector] Sampling every ${this.config.sampleIntervalMs}ms`
    );
  }

  /**
   * Stop collection.
   */
  stop(): void {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Build the shell script that collects all data in one exec call.
   */
  private buildCollectionScript(): string {
    const proc = this.config.processName;
    // The script:
    // 1. Finds the PID
    // 2. Reads all thread stat + status files
    // 3. Reads process-level status
    // 4. Reads system-wide CPU from /proc/stat
    return `
PID=$(pgrep -x "${proc}" 2>/dev/null | tail -1)
if [ -z "$PID" ]; then
  PID=$(pgrep -f "${proc}" 2>/dev/null | head -1)
fi
if [ -z "$PID" ]; then
  echo "ERROR:Process not found"
  exit 0
fi
echo "PID:$PID"
for tid in $(ls /proc/$PID/task/ 2>/dev/null); do
  COMM=$(cat /proc/$PID/task/$tid/comm 2>/dev/null)
  STAT=$(cat /proc/$PID/task/$tid/stat 2>/dev/null)
  CTXT=$(grep ctxt /proc/$PID/task/$tid/status 2>/dev/null)
  echo "THREAD:$tid:$COMM:$STAT:$CTXT"
done
echo "PROC:$(grep -E 'VmRSS|VmSize|Threads|FDSize' /proc/$PID/status 2>/dev/null | tr '\\n' '|')"
echo "PROC_STAT:$(cat /proc/$PID/stat 2>/dev/null)"
echo "SYSTEM:$(head -1 /proc/stat 2>/dev/null)"
`.trim();
  }

  /**
   * Perform a single collection cycle.
   * Guarded against overlapping calls — if the previous Docker exec is still
   * in-flight we skip this tick, which prevents out-of-order timestamps.
   */
  private async collect(): Promise<void> {
    if (this.collecting) return; // Previous collection still running, skip
    this.collecting = true;
    const now = Date.now();

    try {
      const output = await this.docker.sh(
        this.config.container,
        this.buildCollectionScript()
      );

      if (output.includes("ERROR:Process not found")) {
        console.warn("[collector] Process not found in container");
        return;
      }

      const parsed = parseCollectionOutput(output);
      if (parsed.threads.length === 0) {
        console.warn("[collector] No threads found");
        return;
      }

      // Compute CPU deltas
      const threadSamples = this.computeThreadSamples(
        parsed.threads,
        parsed.systemCpu,
        now
      );

      // Build snapshot
      const totalCpuPercent = threadSamples.reduce(
        (sum, t) => sum + t.cpuPercent,
        0
      );

      const snapshot: Snapshot = {
        timestamp: now,
        threads: threadSamples,
        process: parsed.processInfo,
        system: parsed.systemCpu,
        totalCpuPercent: Math.round(totalCpuPercent * 10) / 10,
      };

      // Update previous state
      this.previous = {
        timestamp: now,
        threads: new Map(
          parsed.threads.map((t) => [
            t.tid,
            {
              utime: t.utime,
              stime: t.stime,
              volCtx: t.voluntaryCtxSwitches,
              involCtx: t.involuntaryCtxSwitches,
            },
          ])
        ),
        systemCpu: parsed.systemCpu,
      };

      // Store and broadcast
      this.store.push(snapshot);
      for (const listener of this.listeners) {
        try {
          listener(snapshot);
        } catch (e) {
          console.error("[collector] Listener error:", e);
        }
      }
    } catch (error) {
      console.error("[collector] Collection failed:", error);
    } finally {
      this.collecting = false;
    }
  }

  /**
   * Compute per-thread CPU% from tick deltas.
   *
   * CPU% = (delta_thread_ticks / delta_system_total_ticks) * num_cpus * 100
   *
   * This gives the percentage of a single CPU core. On a 4-core system,
   * a thread maxes out at 100% (one core fully used).
   */
  private computeThreadSamples(
    threads: ThreadRaw[],
    systemCpu: SystemCpuRaw,
    now: number
  ): ThreadSample[] {
    if (!this.previous) {
      // First sample: no delta available, report 0%
      return threads.map((t) => ({
        tid: t.tid,
        name: t.name,
        category: categorizeThread(t.name),
        cpuPercent: 0,
        utime: t.utime,
        stime: t.stime,
        voluntaryCtxSwitches: t.voluntaryCtxSwitches,
        involuntaryCtxSwitches: t.involuntaryCtxSwitches,
        voluntaryCtxSwitchesDelta: 0,
        involuntaryCtxSwitchesDelta: 0,
      }));
    }

    const deltaTotalTicks =
      systemCpu.totalTicks - this.previous.systemCpu.totalTicks;

    // Avoid division by zero
    if (deltaTotalTicks <= 0) {
      return threads.map((t) => ({
        tid: t.tid,
        name: t.name,
        category: categorizeThread(t.name),
        cpuPercent: 0,
        utime: t.utime,
        stime: t.stime,
        voluntaryCtxSwitches: t.voluntaryCtxSwitches,
        involuntaryCtxSwitches: t.involuntaryCtxSwitches,
        voluntaryCtxSwitchesDelta: 0,
        involuntaryCtxSwitchesDelta: 0,
      }));
    }

    return threads.map((t) => {
      const prev = this.previous!.threads.get(t.tid);
      let cpuPercent = 0;
      let volDelta = 0;
      let involDelta = 0;

      if (prev) {
        const deltaUtime = Math.max(0, t.utime - prev.utime);
        const deltaStime = Math.max(0, t.stime - prev.stime);
        const deltaThread = deltaUtime + deltaStime;

        // CPU% relative to one core: (thread_ticks / total_ticks) * num_cpus * 100
        cpuPercent = (deltaThread / deltaTotalTicks) * this.numCpus * 100;
        // A single thread can never exceed 100% (one core fully used)
        cpuPercent = Math.min(100, Math.round(cpuPercent * 10) / 10);

        volDelta = Math.max(0, t.voluntaryCtxSwitches - prev.volCtx);
        involDelta = Math.max(0, t.involuntaryCtxSwitches - prev.involCtx);
      }

      return {
        tid: t.tid,
        name: t.name,
        category: categorizeThread(t.name),
        cpuPercent,
        utime: t.utime,
        stime: t.stime,
        voluntaryCtxSwitches: t.voluntaryCtxSwitches,
        involuntaryCtxSwitches: t.involuntaryCtxSwitches,
        voluntaryCtxSwitchesDelta: volDelta,
        involuntaryCtxSwitchesDelta: involDelta,
      };
    });
  }
}
