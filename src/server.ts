/**
 * Bun HTTP server with static file serving, REST API, and WebSocket support.
 */

import { readFileSync } from "fs";
import { join } from "path";
import type { Server, ServerWebSocket } from "bun";
import type { SnapshotStore } from "./store";
import type { Snapshot } from "./types";
import { CATEGORY_COLORS, CATEGORY_LABELS } from "./categorizer";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

export function createServer(
  port: number,
  store: SnapshotStore,
  onWsConnect: (send: (data: string) => void) => () => void
): Server {
  const publicDir = join(import.meta.dir, "..", "public");
  const wsClients = new Set<ServerWebSocket<unknown>>();

  const server = Bun.serve({
    port,
    fetch(req, server) {
      const url = new URL(req.url);
      const path = url.pathname;

      // WebSocket upgrade
      if (path === "/ws") {
        const success = server.upgrade(req);
        if (success) return undefined;
        return new Response("WebSocket upgrade failed", { status: 400 });
      }

      // REST API endpoints
      if (path === "/api/history") {
        return Response.json(store.getAll());
      }

      if (path === "/api/stats") {
        return Response.json(store.computeThreadStats());
      }

      if (path === "/api/config") {
        return Response.json({
          colors: CATEGORY_COLORS,
          labels: CATEGORY_LABELS,
        });
      }

      // Static file serving
      let filePath = path === "/" ? "/index.html" : path;
      const ext = filePath.substring(filePath.lastIndexOf("."));
      const fullPath = join(publicDir, filePath);

      try {
        const content = readFileSync(fullPath);
        return new Response(content, {
          headers: {
            "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
            "Cache-Control": "no-cache",
          },
        });
      } catch {
        return new Response("Not Found", { status: 404 });
      }
    },

    websocket: {
      open(ws) {
        wsClients.add(ws);
        // Send full history on connect
        const history = store.getAll();
        if (history.length > 0) {
          ws.send(JSON.stringify({ type: "history", data: history }));
        }
      },
      message(_ws, _message) {
        // No client-to-server messages expected
      },
      close(ws) {
        wsClients.delete(ws);
      },
    },
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

  return server;
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
