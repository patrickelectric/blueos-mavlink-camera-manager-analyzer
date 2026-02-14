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
 * Sources: Muted, Vibrant, and Bright schemes from
 * https://personal.sron.nl/~pault/data/colourschemes.pdf
 */
export const CATEGORY_COLORS: Record<ThreadCategory, string> = {
  ImageSink: "#CC6677",          // rose (muted)
  RTSPSink: "#EE7733",           // orange (vibrant)
  UDPSink: "#CCBB44",            // yellow (bright)
  RTSPServerFactory: "#228833",  // green (bright)
  WebRTCSink: "#009988",         // teal (vibrant)
  ProxySrcInternal: "#33BBEE",   // cyan (vibrant)
  UnnamedQueue: "#AA4499",       // purple (muted)
  GstUDPSrc: "#332288",          // indigo (muted)
  GstRTPJitter: "#44AA99",       // teal (muted)
  GstRTPSession: "#117733",      // green (muted)
  GstFakeSrc: "#BBBBBB",         // grey
  GstShmSrc: "#999933",          // olive (muted)
  GstTimer: "#DDCC77",           // sand (muted)
  TokioRuntime: "#4477AA",       // blue (bright)
  ActixServer: "#882255",        // wine (muted)
  MAVLink: "#CC3311",            // red (vibrant)
  RTSPServerLoop: "#EE3377",     // magenta (vibrant)
  MainThread: "#0077BB",         // blue (vibrant)
  Other: "#88CCEE",              // cyan (muted)
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
