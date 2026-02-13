/**
 * Classify thread names into GStreamer / runtime categories.
 *
 * Uses naming conventions from mavlink-camera-manager's sink implementations:
 *   - q-img-*   : ImageSink queue
 *   - q-rtsp-*  : RTSP sink queue
 *   - q-udp-*   : UDP sink queue
 *   - q-srv-*   : RTSP server factory queue
 *   - q-wrtc-*  : WebRTC sink queue
 *   - qi-*      : ProxySrc internal queue
 *   - queue*    : Unnamed GStreamer queue
 *   - udpsrc*   : GStreamer UDP source
 *   - rtpjitter*: RTP jitter buffer
 *   - etc.
 */

import type { ThreadCategory } from "./types";

interface CategoryRule {
  pattern: RegExp;
  category: ThreadCategory;
}

const RULES: CategoryRule[] = [
  { pattern: /^q-img-/, category: "ImageSink" },
  { pattern: /^q-rtsp-/, category: "RTSPSink" },
  { pattern: /^q-udp-/, category: "UDPSink" },
  { pattern: /^q-srv-/, category: "RTSPServerFactory" },
  { pattern: /^q-wrtc-/, category: "WebRTCSink" },
  { pattern: /^qi-/, category: "ProxySrcInternal" },
  { pattern: /^psink-/, category: "ProxySrcInternal" },
  { pattern: /^psrc-/, category: "ProxySrcInternal" },
  { pattern: /^queue\d*:src/, category: "UnnamedQueue" },
  { pattern: /^udpsrc/, category: "GstUDPSrc" },
  { pattern: /^rtpjitter/, category: "GstRTPJitter" },
  { pattern: /^rtpsession/, category: "GstRTPSession" },
  { pattern: /^fakesrc/, category: "GstFakeSrc" },
  { pattern: /^shmsrc/, category: "GstShmSrc" },
  { pattern: /^shmsink/, category: "GstShmSrc" },
  { pattern: /^timer$/, category: "GstTimer" },
  { pattern: /^tokio-runtime/, category: "TokioRuntime" },
  { pattern: /^actix-server/, category: "ActixServer" },
  { pattern: /^MavSender$/, category: "MAVLink" },
  { pattern: /^MavReceiver$/, category: "MAVLink" },
  { pattern: /^RTSPServer$/, category: "RTSPServerLoop" },
  { pattern: /^mavlink-camera-/, category: "MainThread" },
  { pattern: /^task\d+$/, category: "TokioRuntime" },
  { pattern: /^pool-/, category: "Other" },
];

/**
 * Categorize a thread by its comm name.
 */
export function categorizeThread(name: string): ThreadCategory {
  for (const rule of RULES) {
    if (rule.pattern.test(name)) {
      return rule.category;
    }
  }
  return "Other";
}

/**
 * Color palette for each category (used by both backend stats and frontend charts).
 */
export const CATEGORY_COLORS: Record<ThreadCategory, string> = {
  ImageSink: "#e74c3c",
  RTSPSink: "#e67e22",
  UDPSink: "#f39c12",
  RTSPServerFactory: "#2ecc71",
  WebRTCSink: "#1abc9c",
  ProxySrcInternal: "#3498db",
  UnnamedQueue: "#9b59b6",
  GstUDPSrc: "#34495e",
  GstRTPJitter: "#16a085",
  GstRTPSession: "#27ae60",
  GstFakeSrc: "#95a5a6",
  GstShmSrc: "#7f8c8d",
  GstTimer: "#bdc3c7",
  TokioRuntime: "#2980b9",
  ActixServer: "#8e44ad",
  MAVLink: "#c0392b",
  RTSPServerLoop: "#d35400",
  MainThread: "#2c3e50",
  Other: "#7f8c8d",
};

/**
 * Human-readable labels for categories.
 */
export const CATEGORY_LABELS: Record<ThreadCategory, string> = {
  ImageSink: "Image Sink (Thumbnails)",
  RTSPSink: "RTSP Sink",
  UDPSink: "UDP Sink",
  RTSPServerFactory: "RTSP Server Factory",
  WebRTCSink: "WebRTC Sink",
  ProxySrcInternal: "ProxySrc Internal",
  UnnamedQueue: "Unnamed Queue",
  GstUDPSrc: "GStreamer UDP Source",
  GstRTPJitter: "RTP Jitter Buffer",
  GstRTPSession: "RTP Session",
  GstFakeSrc: "Fake Source",
  GstShmSrc: "Shared Memory Source",
  GstTimer: "GStreamer Timer",
  TokioRuntime: "Tokio Runtime",
  ActixServer: "Actix HTTP Server",
  MAVLink: "MAVLink Protocol",
  RTSPServerLoop: "RTSP Server Loop",
  MainThread: "Main Thread",
  Other: "Other",
};
