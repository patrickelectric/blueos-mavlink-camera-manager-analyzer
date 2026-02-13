/**
 * In-memory time-series ring buffer for CPU snapshots.
 *
 * Stores up to `maxSize` snapshots and provides query methods
 * for the dashboard API and statistics computation.
 */

import type { Snapshot, ThreadStats, ThreadCategory } from "./types";

export class SnapshotStore {
  private buffer: Snapshot[] = [];
  private maxSize: number;

  constructor(maxSize: number = 600) {
    this.maxSize = maxSize;
  }

  /**
   * Add a new snapshot, evicting the oldest if at capacity.
   */
  push(snapshot: Snapshot): void {
    this.buffer.push(snapshot);
    if (this.buffer.length > this.maxSize) {
      this.buffer.shift();
    }
  }

  /**
   * Get all stored snapshots.
   */
  getAll(): Snapshot[] {
    return this.buffer;
  }

  /**
   * Get the last N snapshots.
   */
  getLastN(n: number): Snapshot[] {
    return this.buffer.slice(-n);
  }

  /**
   * Get the most recent snapshot, or null if empty.
   */
  getLatest(): Snapshot | null {
    return this.buffer.length > 0
      ? this.buffer[this.buffer.length - 1]
      : null;
  }

  /**
   * Get number of stored snapshots.
   */
  get size(): number {
    return this.buffer.length;
  }

  /**
   * Compute per-thread statistics across all stored snapshots.
   */
  computeThreadStats(): ThreadStats[] {
    if (this.buffer.length === 0) return [];

    // Accumulate per-thread data keyed by TID
    const statsMap = new Map<
      number,
      {
        tid: number;
        name: string;
        category: ThreadCategory;
        cpuSum: number;
        maxCpu: number;
        currentCpu: number;
        sampleCount: number;
        totalVolCtx: number;
        totalInvolCtx: number;
      }
    >();

    for (const snapshot of this.buffer) {
      for (const thread of snapshot.threads) {
        let entry = statsMap.get(thread.tid);
        if (!entry) {
          entry = {
            tid: thread.tid,
            name: thread.name,
            category: thread.category,
            cpuSum: 0,
            maxCpu: 0,
            currentCpu: 0,
            sampleCount: 0,
            totalVolCtx: thread.voluntaryCtxSwitches,
            totalInvolCtx: thread.involuntaryCtxSwitches,
          };
          statsMap.set(thread.tid, entry);
        }

        entry.name = thread.name; // Update to latest name
        entry.category = thread.category;
        entry.cpuSum += thread.cpuPercent;
        entry.maxCpu = Math.max(entry.maxCpu, thread.cpuPercent);
        entry.currentCpu = thread.cpuPercent;
        entry.sampleCount++;
        entry.totalVolCtx = thread.voluntaryCtxSwitches;
        entry.totalInvolCtx = thread.involuntaryCtxSwitches;
      }
    }

    return Array.from(statsMap.values()).map((e) => ({
      tid: e.tid,
      name: e.name,
      category: e.category,
      currentCpu: Math.round(e.currentCpu * 10) / 10,
      avgCpu: Math.round((e.cpuSum / e.sampleCount) * 10) / 10,
      maxCpu: Math.round(e.maxCpu * 10) / 10,
      totalVoluntaryCtxSwitches: e.totalVolCtx,
      totalInvoluntaryCtxSwitches: e.totalInvolCtx,
      sampleCount: e.sampleCount,
    }));
  }
}
