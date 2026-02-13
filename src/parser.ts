/**
 * Parsers for Linux /proc filesystem files.
 *
 * All field indices follow the proc(5) man page numbering (1-indexed for stat fields).
 */

import type { ThreadRaw, ProcessInfo, SystemCpuRaw } from "./types";

/**
 * Parse a single THREAD line from our collection script.
 *
 * Format: THREAD:<tid>:<comm>:<stat_contents>:<ctxt_lines>
 *
 * The stat contents follow /proc/[pid]/stat format. Key fields (1-indexed):
 *   1  = pid
 *   2  = (comm)              — in parentheses
 *   3  = state
 *   14 = utime               — user mode ticks
 *   15 = stime               — kernel mode ticks
 */
export function parseThreadLine(line: string): ThreadRaw | null {
  // THREAD:1958:queue0:src:1958 (queue0:src) S 1881 ....:voluntary_ctxt_switches:\t933\ninvoluntary_ctxt_switches:\t15
  const firstColon = line.indexOf(":");
  if (firstColon === -1) return null;

  const prefix = line.substring(0, firstColon);
  if (prefix !== "THREAD") return null;

  const rest = line.substring(firstColon + 1);

  // Extract TID (everything up to next colon)
  const tidEnd = rest.indexOf(":");
  if (tidEnd === -1) return null;
  const tid = parseInt(rest.substring(0, tidEnd), 10);
  if (isNaN(tid)) return null;

  const afterTid = rest.substring(tidEnd + 1);

  // The stat line contains the comm in parentheses. Find the stat portion
  // by looking for the pattern: "<tid> (<comm>) <state> ..."
  // The comm field is between the FIRST '(' and LAST ')' in the stat line.
  // Our format: <comm>:<stat_line>:<ctxt_lines>
  // But comm itself can contain colons (e.g., "queue0:src"), so we need
  // to find the stat line by looking for the PID pattern.

  // Find where the stat content starts: look for "<tid> ("
  const statMarker = `${tid} (`;
  const statStart = afterTid.indexOf(statMarker);
  if (statStart === -1) return null;

  // The comm name is everything before the stat marker
  const name = afterTid.substring(0, statStart).replace(/:$/, "");

  // Now parse the stat line. Find the closing paren of comm field.
  const statContent = afterTid.substring(statStart);
  const commEnd = statContent.lastIndexOf(")");
  if (commEnd === -1) return null;

  // Fields after the comm: split by whitespace
  // Fields after ")" are: state(3) ppid(4) pgrp(5) ... utime(14) stime(15)
  // Since fields 1 and 2 are pid and (comm), the remaining start at field 3
  const fieldsAfterComm = statContent.substring(commEnd + 2).trim().split(/\s+/);
  // fieldsAfterComm[0] = state (field 3)
  // fieldsAfterComm[11] = utime (field 14, i.e., 14-3=11)
  // fieldsAfterComm[12] = stime (field 15, i.e., 15-3=12)

  const utime = parseInt(fieldsAfterComm[11], 10) || 0;
  const stime = parseInt(fieldsAfterComm[12], 10) || 0;

  // Parse context switches from the status grep output
  let voluntaryCtxSwitches = 0;
  let involuntaryCtxSwitches = 0;

  const volMatch = afterTid.match(/voluntary_ctxt_switches:\s*(\d+)/);
  const involMatch = afterTid.match(/involuntary_ctxt_switches:\s*(\d+)/);
  if (volMatch) voluntaryCtxSwitches = parseInt(volMatch[1], 10);
  if (involMatch) involuntaryCtxSwitches = parseInt(involMatch[1], 10);

  return {
    tid,
    name: name || `thread-${tid}`,
    utime,
    stime,
    voluntaryCtxSwitches,
    involuntaryCtxSwitches,
  };
}

/**
 * Parse PROC line containing process-level status info.
 * Format: PROC:<status_grep_output>
 *
 * Expected grep output contains lines like:
 *   VmSize:   685832 kB
 *   VmRSS:    220824 kB
 *   Threads:  40
 *   FDSize:   512
 */
export function parseProcessInfoLine(
  line: string,
  statLine: string | null,
  pid: number
): ProcessInfo {
  const info: ProcessInfo = {
    pid,
    rssKb: 0,
    vmSizeKb: 0,
    threadCount: 0,
    fdCount: 0,
    utime: 0,
    stime: 0,
  };

  const rssMatch = line.match(/VmRSS:\s*(\d+)/);
  const vmMatch = line.match(/VmSize:\s*(\d+)/);
  const threadMatch = line.match(/Threads:\s*(\d+)/);
  const fdMatch = line.match(/FDSize:\s*(\d+)/);

  if (rssMatch) info.rssKb = parseInt(rssMatch[1], 10);
  if (vmMatch) info.vmSizeKb = parseInt(vmMatch[1], 10);
  if (threadMatch) info.threadCount = parseInt(threadMatch[1], 10);
  if (fdMatch) info.fdCount = parseInt(fdMatch[1], 10);

  // Parse process-level stat for total utime/stime
  if (statLine) {
    const commEnd = statLine.lastIndexOf(")");
    if (commEnd !== -1) {
      const fields = statLine.substring(commEnd + 2).trim().split(/\s+/);
      info.utime = parseInt(fields[11], 10) || 0;
      info.stime = parseInt(fields[12], 10) || 0;
    }
  }

  return info;
}

/**
 * Parse SYSTEM line containing /proc/stat first line.
 * Format: SYSTEM:cpu  <user> <nice> <system> <idle> <iowait> <irq> <softirq> <steal> ...
 */
export function parseSystemCpuLine(line: string): SystemCpuRaw {
  const content = line.replace(/^SYSTEM:/, "").trim();
  // cpu  12345 678 9012 345678 9012 345 678 90
  const parts = content.replace(/^cpu\s+/, "").trim().split(/\s+/);
  const nums = parts.map((p) => parseInt(p, 10) || 0);

  // user(0) + nice(1) + system(2) + idle(3) + iowait(4) + irq(5) + softirq(6) + steal(7)
  const totalTicks = nums.slice(0, 8).reduce((a, b) => a + b, 0);
  const idleTicks = (nums[3] || 0) + (nums[4] || 0);

  return { totalTicks, idleTicks };
}

/**
 * Parse the PID line from our collection script.
 * Format: PID:<pid>
 */
export function parsePidLine(line: string): number | null {
  const match = line.match(/^PID:(\d+)$/);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Parse all output from a single collection run.
 */
export function parseCollectionOutput(output: string): {
  pid: number;
  threads: ThreadRaw[];
  processInfo: ProcessInfo;
  systemCpu: SystemCpuRaw;
} {
  const lines = output.split("\n").filter((l) => l.length > 0);

  let pid = 0;
  const threads: ThreadRaw[] = [];
  let procLine = "";
  let procStatLine = "";
  let systemLine = "";

  for (const line of lines) {
    if (line.startsWith("PID:")) {
      pid = parsePidLine(line) ?? 0;
    } else if (line.startsWith("THREAD:")) {
      const t = parseThreadLine(line);
      if (t) threads.push(t);
    } else if (line.startsWith("PROC:")) {
      procLine = line.substring(5);
    } else if (line.startsWith("PROC_STAT:")) {
      procStatLine = line.substring(10);
    } else if (line.startsWith("SYSTEM:")) {
      systemLine = line;
    }
  }

  const processInfo = parseProcessInfoLine(procLine, procStatLine, pid);
  const systemCpu = parseSystemCpuLine(systemLine);

  return { pid, threads, processInfo, systemCpu };
}
