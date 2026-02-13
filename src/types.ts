// ── GStreamer / Runtime thread categories ──

export type ThreadCategory =
  | "ImageSink"
  | "RTSPSink"
  | "UDPSink"
  | "RTSPServerFactory"
  | "WebRTCSink"
  | "ProxySrcInternal"
  | "UnnamedQueue"
  | "GstUDPSrc"
  | "GstRTPJitter"
  | "GstRTPSession"
  | "GstFakeSrc"
  | "GstShmSrc"
  | "GstTimer"
  | "TokioRuntime"
  | "ActixServer"
  | "MAVLink"
  | "RTSPServerLoop"
  | "MainThread"
  | "Other";

// ── Per-thread raw data read from /proc ──

export interface ThreadRaw {
  tid: number;
  name: string;
  /** user-mode CPU ticks (field 14 in /proc/PID/task/TID/stat, 1-indexed) */
  utime: number;
  /** kernel-mode CPU ticks (field 15) */
  stime: number;
  /** voluntary context switches */
  voluntaryCtxSwitches: number;
  /** involuntary context switches */
  involuntaryCtxSwitches: number;
}

// ── Per-thread computed sample (after delta calculation) ──

export interface ThreadSample {
  tid: number;
  name: string;
  category: ThreadCategory;
  /** CPU usage 0-100% for this thread during this interval */
  cpuPercent: number;
  /** raw utime ticks (cumulative) */
  utime: number;
  /** raw stime ticks (cumulative) */
  stime: number;
  /** voluntary context switches (cumulative) */
  voluntaryCtxSwitches: number;
  /** involuntary context switches (cumulative) */
  involuntaryCtxSwitches: number;
  /** delta of voluntary context switches since last sample */
  voluntaryCtxSwitchesDelta: number;
  /** delta of involuntary context switches since last sample */
  involuntaryCtxSwitchesDelta: number;
}

// ── Process-level info ──

export interface ProcessInfo {
  pid: number;
  /** Resident Set Size in KB */
  rssKb: number;
  /** Virtual Memory Size in KB */
  vmSizeKb: number;
  /** Number of threads */
  threadCount: number;
  /** Number of file descriptors */
  fdCount: number;
  /** Total process utime ticks */
  utime: number;
  /** Total process stime ticks */
  stime: number;
}

// ── System-wide CPU info from /proc/stat ──

export interface SystemCpuRaw {
  /** Total CPU ticks across all cores (user+nice+system+idle+iowait+irq+softirq+steal) */
  totalTicks: number;
  /** Idle ticks (idle + iowait) */
  idleTicks: number;
}

// ── A complete snapshot at one point in time ──

export interface Snapshot {
  timestamp: number; // Date.now()
  threads: ThreadSample[];
  process: ProcessInfo;
  system: SystemCpuRaw;
  /** Total CPU% of all threads combined */
  totalCpuPercent: number;
}

// ── Per-thread accumulated statistics ──

export interface ThreadStats {
  tid: number;
  name: string;
  category: ThreadCategory;
  currentCpu: number;
  avgCpu: number;
  maxCpu: number;
  totalVoluntaryCtxSwitches: number;
  totalInvoluntaryCtxSwitches: number;
  sampleCount: number;
}

// ── CLI configuration ──

export interface Config {
  dockerSocket: string;
  container: string;
  processName: string;
  sampleIntervalMs: number;
  dashboardPort: number;
  maxHistory: number;
}

// ── WebSocket message types ──

export interface WsSnapshotMessage {
  type: "snapshot";
  data: Snapshot;
}

export interface WsHistoryMessage {
  type: "history";
  data: Snapshot[];
}

export type WsMessage = WsSnapshotMessage | WsHistoryMessage;
