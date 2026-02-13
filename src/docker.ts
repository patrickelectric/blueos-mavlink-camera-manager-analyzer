/**
 * Docker Engine REST API client.
 *
 * Executes commands inside a container via the exec create + start endpoints
 * and returns the combined stdout as a string. Handles the Docker multiplexed
 * stream framing (8-byte header per frame).
 */

export class DockerClient {
  private baseUrl: string;

  constructor(host: string, port: number) {
    this.baseUrl = `http://${host}:${port}`;
  }

  /**
   * Execute a command inside a container and return stdout.
   */
  async exec(container: string, cmd: string[]): Promise<string> {
    // Step 1: Create exec instance
    const createRes = await fetch(
      `${this.baseUrl}/containers/${container}/exec`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          AttachStdout: true,
          AttachStderr: true,
          Cmd: cmd,
        }),
      }
    );

    if (!createRes.ok) {
      const text = await createRes.text();
      throw new Error(
        `Docker exec create failed (${createRes.status}): ${text}`
      );
    }

    const { Id: execId } = (await createRes.json()) as { Id: string };

    // Step 2: Start exec and read output
    const startRes = await fetch(`${this.baseUrl}/exec/${execId}/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ Detach: false, Tty: false }),
    });

    if (!startRes.ok) {
      const text = await startRes.text();
      throw new Error(
        `Docker exec start failed (${startRes.status}): ${text}`
      );
    }

    // Docker multiplexed stream: each frame has an 8-byte header
    //   [0]    = stream type (1=stdout, 2=stderr)
    //   [1-3]  = padding zeros
    //   [4-7]  = payload size (big-endian uint32)
    const rawBuffer = await startRes.arrayBuffer();
    return this.demuxDockerStream(new Uint8Array(rawBuffer));
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
      const res = await fetch(`${this.baseUrl}/_ping`);
      return res.ok;
    } catch {
      return false;
    }
  }
}
