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
/**
 * Paul Tol color palette — colorblind-friendly qualitative colors.
 * Source: https://personal.sron.nl/~pault/data/colourschemes.pdf
 *
 * The Bright scheme (6 non-grey, max contrast) is assigned to the
 * categories most commonly visible together in charts; Vibrant and
 * Muted fill in the less-frequent categories.
 */
export const CATEGORY_COLORS: Record<ThreadCategory, string> = {
  // ── Bright scheme (most commonly co-occurring in charts) ──
  TokioRuntime: "#4477AA",       // blue
  GstRTPJitter: "#EE6677",       // red
  UnnamedQueue: "#66CCEE",       // cyan
  ActixServer: "#AA3377",        // purple
  MAVLink: "#CCBB44",            // yellow
  GstUDPSrc: "#228833",          // green
  // ── Vibrant scheme (moderately common) ──
  MainThread: "#EE7733",         // orange
  RTSPSink: "#0077BB",           // blue
  WebRTCSink: "#33BBEE",         // cyan
  RTSPServerLoop: "#EE3377",     // magenta
  ImageSink: "#CC3311",          // red
  RTSPServerFactory: "#009988",  // teal
  // ── Muted scheme (infrequent / background) ──
  ProxySrcInternal: "#44AA99",   // teal
  GstRTPSession: "#117733",      // green
  GstFakeSrc: "#BBBBBB",         // grey
  GstShmSrc: "#999933",          // olive
  GstTimer: "#DDCC77",           // sand
  UDPSink: "#882255",            // wine
  Other: "#AA4499",              // purple
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
