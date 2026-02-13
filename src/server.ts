/**
 * HTTP server with static file serving, REST API, and WebSocket support.
 *
 * Uses Node.js built-in http module + the `ws` package so it runs on
 * both Bun and Node.js (including arm/v7 for Raspberry Pi).
 */

import { createServer as createHttpServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import type { SnapshotStore } from "./store";
import type { Snapshot } from "./types";
import { CATEGORY_COLORS, CATEGORY_LABELS } from "./categorizer";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

function jsonResponse(
  res: import("node:http").ServerResponse,
  data: unknown,
  status = 200
) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": String(Buffer.byteLength(body)),
  });
  res.end(body);
}

export function createServer(
  port: number,
  store: SnapshotStore,
  onWsConnect: (send: (data: string) => void) => () => void
): Server {
  const publicDir = join(__dirname, "..", "public");
  const wsClients = new Set<WebSocket>();

  const httpServer = createHttpServer((req, res) => {
    const url = new URL(req.url || "/", `http://localhost:${port}`);
    const path = url.pathname;

    // BlueOS extension service registration.
    // BlueOS polls this endpoint to discover extensions and add them
    // to the sidebar menu.
    if (path === "/register_service") {
      jsonResponse(res, {
        name: "MCM CPU Analyzer",
        description:
          "Real-time per-thread CPU profiler for mavlink-camera-manager",
        icon: "mdi-cpu-64-bit",
        company: "Blue Robotics",
        version: "1.0.0",
        new_page: false,
        webpage:
          "https://github.com/patrickelectric/blueos-mavlink-camera-manager-analyzer",
        api: "",
      });
      return;
    }

    // REST API endpoints
    if (path === "/api/history") {
      jsonResponse(res, store.getAll());
      return;
    }

    if (path === "/api/stats") {
      jsonResponse(res, store.computeThreadStats());
      return;
    }

    if (path === "/api/config") {
      jsonResponse(res, {
        colors: CATEGORY_COLORS,
        labels: CATEGORY_LABELS,
      });
      return;
    }

    // Static file serving
    const filePath = path === "/" ? "/index.html" : path;
    const ext = extname(filePath);
    const fullPath = join(publicDir, filePath);

    try {
      const content = readFileSync(fullPath);
      res.writeHead(200, {
        "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
        "Cache-Control": "no-cache",
      });
      res.end(content);
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
    }
  });

  // WebSocket server, attached to the same HTTP server
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

  wss.on("connection", (ws) => {
    wsClients.add(ws);

    // Send full history on connect
    const history = store.getAll();
    if (history.length > 0) {
      ws.send(JSON.stringify({ type: "history", data: history }));
    }

    ws.on("close", () => {
      wsClients.delete(ws);
    });
  });

  // Register broadcast function with the collector
  onWsConnect((data: string) => {
    for (const ws of wsClients) {
      try {
        ws.send(data);
      } catch {
        wsClients.delete(ws);
      }
    }
  });

  httpServer.listen(port);

  return httpServer;
}

/**
 * Create a broadcast helper that serializes snapshots and pushes to all WS clients.
 */
export function createBroadcaster(): {
  broadcast: (snapshot: Snapshot) => void;
  onWsConnect: (send: (data: string) => void) => () => void;
} {
  let sender: ((data: string) => void) | null = null;

  return {
    broadcast(snapshot: Snapshot) {
      if (sender) {
        sender(JSON.stringify({ type: "snapshot", data: snapshot }));
      }
    },
    onWsConnect(send: (data: string) => void): () => void {
      sender = send;
      return () => {
        sender = null;
      };
    },
  };
}
