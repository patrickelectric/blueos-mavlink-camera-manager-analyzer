# CPU Analyzer for mavlink-camera-manager

Real-time per-thread CPU profiler for the `mavlink-camera-manager` process running inside a Docker container. Built with [Bun](https://bun.sh/) and designed for remote debugging on Raspberry Pi (or any Linux target with the Docker Engine API exposed).

## Overview

The tool connects to the Docker Engine REST API, periodically executes a lightweight shell script inside the target container to read `/proc/<pid>/task/*/stat` and related files, then computes per-thread CPU usage from tick deltas between samples. Thread names are automatically categorized into GStreamer element types based on naming conventions used in mavlink-camera-manager (e.g. `q-img-*` -> ImageSink, `q-rtsp-*` -> RTSPSink, `qi-*` -> ProxySrc Internal).

A live web dashboard served on `localhost:3000` streams data over WebSocket and renders interactive charts so you can watch CPU distribution across threads in real time.

## Prerequisites

- [Bun](https://bun.sh/) v1.2 or later
- Docker Engine REST API accessible on the target host (TCP, default `192.168.31.113:2375`)

## Quick Start

```bash
cd cpu-analizer
bun install
bun start
```

Then open <http://localhost:3000> in your browser.

For development with hot-reload:

```bash
bun run dev
```

## CLI Options

All options have sensible defaults and are optional:

| Flag | Description | Default |
|------|-------------|---------|
| `--host <ip>` | Docker host IP address | `192.168.31.113` |
| `--docker-port <n>` | Docker Engine API port | `2375` |
| `--container <name>` | Docker container name | `blueos-core` |
| `--process <name>` | Process name pattern for `pgrep` | `mavlink-camera-` |
| `--interval <ms>` | Sampling interval in milliseconds | `1000` |
| `--port <n>` | Local HTTP port for the dashboard | `3000` |
| `--history <n>` | Maximum number of samples to keep in memory | `600` |
| `--help` | Show help text and exit | |

Example with custom settings:

```bash
bun run src/index.ts --host 10.0.0.50 --interval 500 --port 8080
```

## Dashboard

The web dashboard provides six views, accessible via tabs:

1. **Thread CPU Timeline** -- Per-thread CPU% over time as a line chart. Each thread is a separate series; toggle visibility via the legend.
2. **CPU by Category** -- CPU usage grouped by GStreamer subsystem (ImageSink, RTSPSink, ProxySrc Internal, Tokio Runtime, etc.) as a stacked area chart.
3. **Current CPU Distribution** -- Live snapshot of the latest sample as a doughnut chart, showing which categories are consuming CPU right now.
4. **Context Switches** -- Voluntary vs involuntary context switches per thread as a bar chart. Useful for identifying threads that are frequently sleeping/waking.
5. **Process Overview** -- Total CPU%, RSS memory, and thread count over time as multi-axis line charts.
6. **Thread Detail Table** -- Sortable table listing every thread with current CPU%, average CPU%, max CPU%, and cumulative context switches.

Legend selections persist across tab switches so you can compare the same threads across different chart types.

## Project Structure

```
cpu-analizer/
  public/
    index.html        # Dashboard HTML (tabs, chart containers)
    app.js            # Frontend JS (Chart.js charts, WebSocket client)
  src/
    index.ts          # Entry point: CLI parsing, component wiring
    types.ts          # TypeScript interfaces (Snapshot, ThreadSample, Config, etc.)
    docker.ts         # Docker Engine REST API client (exec via HTTP)
    parser.ts         # Parses raw /proc output into typed structures
    categorizer.ts    # Thread name -> GStreamer category classification rules
    collector.ts      # Periodic data collection and CPU delta computation
    store.ts          # In-memory ring-buffer for snapshot history
    server.ts         # Bun HTTP server, static files, REST API, WebSocket
  package.json
  tsconfig.json
```

## How It Works

```
┌──────────────────────┐     Docker Engine API      ┌──────────────────────┐
│   Bun (this tool)    │ ──── POST /exec/create ──> │  Target Container    │
│                      │ ──── POST /exec/start ───> │  (blueos-core)       │
│  collector.ts        │ <─── /proc/PID/task/*  ─── │                      │
│  parser.ts           │                            │  mavlink-camera-     │
│  categorizer.ts      │                            │  manager process     │
└──────┬───────────────┘                            └──────────────────────┘
       │
       │  Snapshot (JSON)
       v
┌──────────────────────┐
│  store.ts            │  Ring-buffer (max 600 samples)
└──────┬───────────────┘
       │
       ├─── REST API ──── GET /api/history, /api/stats, /api/config
       │
       └─── WebSocket ─── ws://localhost:3000/ws (real-time push)
                │
                v
       ┌──────────────────────┐
       │  Browser Dashboard   │
       │  (Chart.js)          │
       └──────────────────────┘
```

### Collection Cycle

Each tick (default 1 second):

1. **Docker exec** -- A shell script runs inside the container, reading `/proc/<pid>/task/*/stat`, `/proc/<pid>/task/*/status`, `/proc/<pid>/status`, and `/proc/stat` in a single call.
2. **Parse** -- The raw output is parsed into `ThreadRaw[]`, `ProcessInfo`, and `SystemCpuRaw` structures.
3. **Delta** -- Per-thread CPU ticks are differenced against the previous sample. CPU% is computed as `(thread_delta / system_total_delta) * num_cpus * 100`, capped at 100% per thread (one core).
4. **Categorize** -- Thread names are matched against regex rules to assign a `ThreadCategory` (e.g. `q-img-*` -> `ImageSink`).
5. **Store & Broadcast** -- The snapshot is pushed to the ring-buffer store and broadcast to all WebSocket clients.

### Thread Categories

The categorizer recognizes these mavlink-camera-manager thread patterns:

| Pattern | Category | Description |
|---------|----------|-------------|
| `q-img-*` | ImageSink | Thumbnail pipeline queue |
| `q-rtsp-*` | RTSPSink | RTSP sink queue |
| `q-udp-*` | UDPSink | UDP sink queue |
| `q-srv-*` | RTSPServerFactory | RTSP server factory queue |
| `q-wrtc-*` | WebRTCSink | WebRTC sink queue |
| `qi-*`, `psink-*`, `psrc-*` | ProxySrcInternal | ProxySrc internal threads |
| `udpsrc*` | GstUDPSrc | GStreamer UDP source |
| `rtpjitter*` | GstRTPJitter | RTP jitter buffer |
| `shmsrc*`, `shmsink*` | GstShmSrc | Shared memory source |
| `tokio-runtime*`, `task*` | TokioRuntime | Tokio async runtime workers |
| `actix-server*` | ActixServer | Actix HTTP server |
| `MavSender`, `MavReceiver` | MAVLink | MAVLink protocol threads |
| `RTSPServer` | RTSPServerLoop | GStreamer RTSP server loop |
| `mavlink-camera-*` | MainThread | Main process thread |

## REST API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/history` | GET | All stored snapshots (up to `--history` count) |
| `/api/stats` | GET | Computed per-thread statistics (avg, max, current CPU%) |
| `/api/config` | GET | Category colors and labels for chart rendering |
| `/ws` | WS | Real-time snapshot stream; sends full history on connect |

## License

Internal tooling for the mavlink-camera-manager project.
