import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { DockerClient } from '../../../../src/infra/docker/client.ts'

// Helper: build a fake Response wrapping JSON
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

// Helper: build a fake Response wrapping plain text (for logs)
function textResponse(body: string, status = 200): Response {
  return new Response(body, { status })
}

describe('DockerClient', () => {
  let fetchMock: ReturnType<typeof mock>
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
    fetchMock = mock(() => Promise.resolve(jsonResponse({})))
    globalThis.fetch = fetchMock as unknown as typeof fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  // --- getContainerByName ---

  it('getContainerByName returns typed object when container is found', async () => {
    const payload = {
      Id: 'abc123',
      State: { Status: 'running', Running: true },
    }
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(payload)))

    const client = new DockerClient({ socketPath: '/var/run/docker.sock' })
    const result = await client.getContainerByName('watchtower')

    expect(result).not.toBeNull()
    expect(result!.id).toBe('abc123')
    expect(result!.state).toBe('running')
    expect(result!.status).toBe('running')
  })

  it('getContainerByName returns null when container is not found (404)', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(new Response('{"message":"No such container"}', { status: 404 }))
    )

    const client = new DockerClient({ socketPath: '/var/run/docker.sock' })
    const result = await client.getContainerByName('no-such-container')

    expect(result).toBeNull()
  })

  it('getContainerByName throws on socket unreachable (simulated network error)', async () => {
    const err = Object.assign(new Error('connect ENOENT /var/run/docker.sock'), { code: 'ENOENT' })
    fetchMock.mockImplementation(() => Promise.reject(err))

    const client = new DockerClient({ socketPath: '/var/run/docker.sock' })
    await expect(client.getContainerByName('watchtower')).rejects.toThrow()
  })

  it('getContainerByName uses default socket path when not specified', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(new Response('{"message":"No such container"}', { status: 404 }))
    )

    // No socketPath arg — uses default
    const client = new DockerClient()
    await client.getContainerByName('watchtower')

    // We can't inspect the unix path from globalThis.fetch easily, just assert it didn't throw
    expect(fetchMock.mock.calls.length).toBe(1)
  })

  // --- getContainerLogs ---

  it('getContainerLogs returns log lines as string', async () => {
    const logBody = '2024-01-15T10:00:00Z some log line\n2024-01-15T10:01:00Z another line\n'
    fetchMock.mockImplementation(() => Promise.resolve(textResponse(logBody)))

    const client = new DockerClient({ socketPath: '/var/run/docker.sock' })
    const logs = await client.getContainerLogs('watchtower', 50)

    expect(typeof logs).toBe('string')
    expect(logs).toContain('some log line')
  })

  it('getContainerLogs uses default tail=50 when lines not specified', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(textResponse('some logs')))

    const client = new DockerClient({ socketPath: '/var/run/docker.sock' })
    await client.getContainerLogs('watchtower')

    const url: string = (fetchMock.mock.calls[0] as [string])[0]
    expect(url).toContain('tail=50')
  })
})

// --- parseLastSessionDone (pure function) ---
import { parseLastSessionDone } from '../../../../src/infra/docker/client.ts'

describe('parseLastSessionDone', () => {
  it('returns the timestamp of the last "Session done" line', () => {
    const logs = [
      '2024-01-15T10:00:00Z time="2024-01-15T10:00:00Z" level=info msg="Starting Watchtower"',
      '2024-01-15T10:05:00Z time="2024-01-15T10:05:00Z" level=info msg="Session done"',
      '2024-01-15T10:10:01Z time="2024-01-15T10:10:01Z" level=info msg="Starting Watchtower"',
      '2024-01-15T10:10:05Z time="2024-01-15T10:10:05Z" level=info msg="Session done"',
    ].join('\n')

    const ts = parseLastSessionDone(logs)
    expect(ts).not.toBeNull()
    // Should pick the LAST occurrence
    expect(ts!.toISOString().startsWith('2024-01-15T10:10:05')).toBe(true)
  })

  it('returns null when there are no "Session done" lines', () => {
    const logs = [
      '2024-01-15T10:00:00Z time="2024-01-15T10:00:00Z" level=info msg="Starting Watchtower"',
      '2024-01-15T10:00:01Z time="2024-01-15T10:00:01Z" level=info msg="Checking for updates"',
    ].join('\n')

    const ts = parseLastSessionDone(logs)
    expect(ts).toBeNull()
  })

  it('returns null for empty log string', () => {
    expect(parseLastSessionDone('')).toBeNull()
  })

  it('returns null when lines are malformed (no leading ISO timestamp)', () => {
    const logs = [
      'not-a-date msg="Session done"',
      'also-malformed Session done here',
    ].join('\n')

    // No valid ISO timestamps, so null
    expect(parseLastSessionDone(logs)).toBeNull()
  })

  it('handles logs where some lines are malformed and some are valid', () => {
    const logs = [
      'malformed line Session done',
      '2024-01-15T10:05:00Z time="2024-01-15T10:05:00Z" level=info msg="Session done"',
    ].join('\n')

    const ts = parseLastSessionDone(logs)
    expect(ts).not.toBeNull()
  })
})
