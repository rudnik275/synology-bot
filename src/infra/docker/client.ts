export interface ContainerInfo {
  id: string
  /** The low-level lifecycle state, e.g. "running", "exited", "paused" */
  state: string
  /** Human-readable status from Docker, e.g. "Up 10 minutes" */
  status: string
  /** Image SHA256 the container was started from (changes on each deploy). */
  imageId: string
}

export interface DockerClientOptions {
  socketPath?: string
}

/**
 * Minimal Docker Engine API client that communicates over the UNIX socket.
 *
 * Bun supports `fetch` with a `unix` option that lets us talk to
 * UNIX-domain sockets using standard HTTP semantics.
 */
export class DockerClient {
  private readonly socketPath: string

  constructor(options: DockerClientOptions = {}) {
    this.socketPath = options.socketPath ?? '/var/run/docker.sock'
  }

  /**
   * Inspect a container by name (or ID).
   * Returns `null` when the container does not exist (404).
   * Throws on network/socket errors.
   */
  async getContainerByName(name: string): Promise<ContainerInfo | null> {
    const url = `http://localhost/containers/${encodeURIComponent(name)}/json`
    const res = await this.fetch(url)

    if (res.status === 404) {
      return null
    }

    if (!res.ok) {
      throw new Error(`Docker API error: ${res.status} ${res.statusText}`)
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const json = (await res.json()) as Record<string, any>
    return {
      id: json['Id'] as string,
      state: (json['State']?.['Status'] as string) ?? 'unknown',
      status: (json['State']?.['Status'] as string) ?? 'unknown',
      imageId: (json['Image'] as string) ?? '',
    }
  }

  /**
   * Fetch the last `lines` of stdout+stderr from a container.
   * Returns log text as a plain string.
   *
   * Docker multiplexes log streams with an 8-byte header per frame. We strip
   * those headers so callers get clean text.
   */
  async getContainerLogs(name: string, lines = 50): Promise<string> {
    const url =
      `http://localhost/containers/${encodeURIComponent(name)}/logs` +
      `?stdout=1&stderr=1&tail=${lines}`

    const res = await this.fetch(url)

    if (!res.ok) {
      throw new Error(`Docker logs error: ${res.status} ${res.statusText}`)
    }

    const buffer = await res.arrayBuffer()
    return stripDockerLogHeaders(buffer)
  }

  /** Low-level fetch that targets the UNIX socket. */
  private fetch(url: string): Promise<Response> {
    // Bun supports UNIX socket via { unix: path } in RequestInit
    // (documented at https://bun.sh/docs/api/fetch#unix-domain-sockets)
    return fetch(url, { unix: this.socketPath } as RequestInit)
  }
}

/**
 * Docker stream log format: each log frame is prefixed with an 8-byte header:
 *   [stream_type: 1 byte][padding: 3 bytes][payload_size: 4 bytes big-endian]
 *
 * This strips those headers and returns the raw text content.
 */
function stripDockerLogHeaders(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  const parts: string[] = []
  let i = 0

  while (i < bytes.length) {
    // Need at least 8 bytes for the header
    if (i + 8 > bytes.length) break

    const size =
      (bytes[i + 4]! << 24) |
      (bytes[i + 5]! << 16) |
      (bytes[i + 6]! << 8) |
      bytes[i + 7]!

    i += 8
    if (size > 0 && i + size <= bytes.length) {
      parts.push(new TextDecoder().decode(bytes.slice(i, i + size)))
    }
    i += size
  }

  // If parsing produced nothing it's likely plain text (e.g. test mock or TTY mode)
  const result = parts.join('')
  if (result.length === 0) {
    return new TextDecoder().decode(buffer)
  }
  return result
}

/**
 * Pure parser: given a block of Watchtower log text, find the timestamp of
 * the last line containing "Session done".
 *
 * Watchtower log lines begin with an ISO-8601 timestamp:
 *   2024-01-15T10:05:00Z time="..." level=info msg="Session done"
 *
 * Returns `null` when no valid Session done line is found.
 */
export function parseLastSessionDone(logs: string): Date | null {
  const lines = logs.split('\n')
  let last: Date | null = null

  for (const line of lines) {
    if (!line.includes('Session done')) continue

    // The leading token should be an ISO-8601 timestamp
    const token = line.split(/\s/)[0]
    if (!token) continue

    const ts = new Date(token)
    if (isNaN(ts.getTime())) continue

    last = ts
  }

  return last
}
