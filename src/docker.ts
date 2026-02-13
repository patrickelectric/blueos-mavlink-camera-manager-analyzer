/**
 * Docker Engine REST API client.
 *
 * Connects via the Docker Unix socket (default /var/run/docker.sock) using
 * Node.js's built-in http module with the socketPath option.
 *
 * Executes commands inside a container via the exec create + start endpoints
 * and returns the combined stdout as a string. Handles the Docker multiplexed
 * stream framing (8-byte header per frame).
 */

import * as http from "node:http";

export class DockerClient {
  private socketPath: string;

  constructor(socketPath: string = "/var/run/docker.sock") {
    this.socketPath = socketPath;
  }

  /** Human-readable description of the connection for logs. */
  get endpoint(): string {
    return `unix://${this.socketPath}`;
  }

  /**
   * Low-level HTTP request over the Docker Unix socket.
   * Returns the raw response body as a Buffer.
   */
  private request(
    path: string,
    options: { method?: string; body?: string } = {}
  ): Promise<{ statusCode: number; body: Buffer }> {
    return new Promise((resolve, reject) => {
      const headers: Record<string, string> = {};
      if (options.body) {
        headers["Content-Type"] = "application/json";
        headers["Content-Length"] = String(Buffer.byteLength(options.body));
      }

      const req = http.request(
        {
          socketPath: this.socketPath,
          path,
          method: options.method || "GET",
          headers,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () => {
            resolve({
              statusCode: res.statusCode || 0,
              body: Buffer.concat(chunks),
            });
          });
          res.on("error", reject);
        }
      );
      req.on("error", reject);
      if (options.body) req.write(options.body);
      req.end();
    });
  }

  /**
   * Execute a command inside a container and return stdout.
   */
  async exec(container: string, cmd: string[]): Promise<string> {
    // Step 1: Create exec instance
    const createRes = await this.request(`/containers/${container}/exec`, {
      method: "POST",
      body: JSON.stringify({
        AttachStdout: true,
        AttachStderr: true,
        Cmd: cmd,
      }),
    });

    if (createRes.statusCode >= 400) {
      throw new Error(
        `Docker exec create failed (${createRes.statusCode}): ${createRes.body.toString()}`
      );
    }

    const { Id: execId } = JSON.parse(createRes.body.toString());

    // Step 2: Start exec and read output
    const startRes = await this.request(`/exec/${execId}/start`, {
      method: "POST",
      body: JSON.stringify({ Detach: false, Tty: false }),
    });

    if (startRes.statusCode >= 400) {
      throw new Error(
        `Docker exec start failed (${startRes.statusCode}): ${startRes.body.toString()}`
      );
    }

    // Docker multiplexed stream: each frame has an 8-byte header
    //   [0]    = stream type (1=stdout, 2=stderr)
    //   [1-3]  = padding zeros
    //   [4-7]  = payload size (big-endian uint32)
    return this.demuxDockerStream(new Uint8Array(startRes.body));
  }

  /**
   * Demultiplex Docker's stream protocol.
   * Returns only stdout content (stream type 1), ignoring stderr (type 2).
   */
  private demuxDockerStream(data: Uint8Array): string {
    const decoder = new TextDecoder();
    const chunks: string[] = [];
    let offset = 0;

    while (offset + 8 <= data.length) {
      const streamType = data[offset];
      const size =
        (data[offset + 4] << 24) |
        (data[offset + 5] << 16) |
        (data[offset + 6] << 8) |
        data[offset + 7];

      offset += 8;

      if (offset + size > data.length) {
        // Partial frame — take what we can
        if (streamType === 1) {
          chunks.push(decoder.decode(data.slice(offset)));
        }
        break;
      }

      if (streamType === 1) {
        // stdout
        chunks.push(decoder.decode(data.slice(offset, offset + size)));
      }
      // Skip stderr (type 2) and stdin (type 0)

      offset += size;
    }

    return chunks.join("");
  }

  /**
   * Convenience: run a shell command string inside a container.
   */
  async sh(container: string, script: string): Promise<string> {
    return this.exec(container, ["sh", "-c", script]);
  }

  /**
   * Ping the Docker API to verify connectivity.
   */
  async ping(): Promise<boolean> {
    try {
      const res = await this.request("/_ping");
      return res.statusCode >= 200 && res.statusCode < 400;
    } catch {
      return false;
    }
  }
}
