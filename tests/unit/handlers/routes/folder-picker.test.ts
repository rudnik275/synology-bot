import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test'
import { FolderPickerState, buildFolderKeyboard } from '../../../../src/handlers/flows/folder-picker.ts'

/**
 * FolderPickerFlow state machine and keyboard tests.
 * Tests FolderPickerState transitions and buildFolderKeyboard output.
 */

describe('FolderPickerState — magnet input', () => {
  it('isAtRoot is true initially', () => {
    const state = new FolderPickerState({ kind: 'magnet', value: 'magnet:?xt=urn:btih:abc' })
    expect(state.isAtRoot).toBe(true)
    expect(state.currentPath).toBeNull()
  })

  it('drillDown updates currentPath and isAtRoot', () => {
    const state = new FolderPickerState({ kind: 'magnet', value: 'magnet:?xt=urn:btih:abc' })
    state.drillDown({ name: 'downloads', path: '/downloads' })
    expect(state.isAtRoot).toBe(false)
    expect(state.currentPath).toBe('/downloads')
  })

  it('goBack pops the breadcrumb', () => {
    const state = new FolderPickerState({ kind: 'magnet', value: 'magnet:?xt=urn:btih:abc' })
    state.drillDown({ name: 'downloads', path: '/downloads' })
    state.goBack()
    expect(state.isAtRoot).toBe(true)
    expect(state.currentPath).toBeNull()
  })

  it('drillDown is cumulative (nested folders)', () => {
    const state = new FolderPickerState({ kind: 'magnet', value: 'magnet:?xt=urn:btih:abc' })
    state.drillDown({ name: 'downloads', path: '/downloads' })
    state.drillDown({ name: 'movies', path: '/downloads/movies' })
    expect(state.currentPath).toBe('/downloads/movies')
    state.goBack()
    expect(state.currentPath).toBe('/downloads')
  })
})

describe('FolderPickerState — torrentFile input', () => {
  it('isAtRoot is true initially', () => {
    const state = new FolderPickerState({
      kind: 'torrentFile',
      bytes: new Uint8Array([1, 2, 3]),
      name: 'test.torrent',
    })
    expect(state.isAtRoot).toBe(true)
  })

  it('input.kind is torrentFile and bytes are accessible', () => {
    const bytes = new Uint8Array([0x64, 0x38])
    const state = new FolderPickerState({ kind: 'torrentFile', bytes, name: 'x.torrent' })
    expect(state.input.kind).toBe('torrentFile')
    if (state.input.kind === 'torrentFile') {
      expect(state.input.bytes).toBe(bytes)
      expect(state.input.name).toBe('x.torrent')
    }
  })
})

describe('buildFolderKeyboard', () => {
  it('includes folder buttons for each folder', () => {
    const folders = [
      { name: 'downloads', path: '/downloads' },
      { name: 'video', path: '/video' },
    ]
    const rows = buildFolderKeyboard(folders, true)

    // First 2 rows = folder buttons
    const folderRows = rows.filter((row) => row[0]?.callback_data.startsWith('fp:enter:'))
    expect(folderRows).toHaveLength(2)
    expect(folderRows[0][0].text).toContain('downloads')
    expect(folderRows[1][0].text).toContain('video')
  })

  it('includes select and cancel buttons', () => {
    const rows = buildFolderKeyboard([], true)
    const lastRow = rows[rows.length - 1]
    const cbs = lastRow.map((b) => b.callback_data)
    expect(cbs).toContain('fp:select')
    expect(cbs).toContain('fp:cancel')
  })

  it('does NOT include back button when isAtRoot', () => {
    const rows = buildFolderKeyboard([], true)
    const hasBack = rows.some((row) => row.some((b) => b.callback_data === 'fp:back'))
    expect(hasBack).toBe(false)
  })

  it('includes back button when NOT isAtRoot', () => {
    const rows = buildFolderKeyboard([], false)
    const hasBack = rows.some((row) => row.some((b) => b.callback_data === 'fp:back'))
    expect(hasBack).toBe(true)
  })

  it('encodes folder paths in callback_data', () => {
    const folders = [{ name: 'my folder', path: '/path with spaces' }]
    const rows = buildFolderKeyboard(folders, true)
    const folderRow = rows.find((row) => row[0]?.callback_data.startsWith('fp:enter:'))
    expect(folderRow![0].callback_data).toContain(encodeURIComponent('/path with spaces'))
  })
})

describe('SynologyClient.createDownloadTaskFromFile — multipart request shape', () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('POSTs to /webapi/entry.cgi with FormData containing required fields', async () => {
    const { SynologyClient } = await import('../../../../src/infra/synology/client.ts')

    const capturedRequests: { url: string; options: RequestInit }[] = []

    globalThis.fetch = mock(async (url: string | URL | Request, options?: RequestInit) => {
      const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : (url as Request).url
      capturedRequests.push({ url: urlStr, options: options ?? {} })

      if (urlStr.includes('auth.cgi')) {
        return new Response(JSON.stringify({ success: true, data: { sid: 'test-sid' } }), {
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response(JSON.stringify({ success: true, data: {} }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }) as unknown as typeof fetch

    const client = new SynologyClient({ host: 'http://nas.local:5000', user: 'admin', password: 'secret' })
    await client.login()
    capturedRequests.length = 0 // Reset after login

    const bytes = new Uint8Array([0x64, 0x38, 0x3a, 0x61, 0x6e, 0x6e, 0x6f, 0x75, 0x6e, 0x63, 0x65])
    const result = await client.createDownloadTaskFromFile(bytes, 'test.torrent', '/downloads')

    expect(result.ok).toBe(true)
    expect(capturedRequests).toHaveLength(1)

    const req = capturedRequests[0]
    expect(req.url).toContain('/webapi/entry.cgi')
    expect(req.options.method).toBe('POST')
    expect(req.options.body).toBeInstanceOf(FormData)

    const form = req.options.body as FormData
    expect(form.get('api')).toBe('SYNO.DownloadStation2.Task')
    expect(form.get('version')).toBe('2')
    expect(form.get('method')).toBe('create')
    expect(form.get('_sid')).toBe('test-sid')
    expect(form.get('type')).toBe('"file"')
    expect(form.get('destination')).toBe('"/downloads"')
  })

  it('returns ok:false when Synology responds with an error code', async () => {
    const { SynologyClient } = await import('../../../../src/infra/synology/client.ts')

    let loginDone = false
    globalThis.fetch = mock(async (url: string | URL | Request) => {
      const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : (url as Request).url
      if (!loginDone && urlStr.includes('auth.cgi')) {
        loginDone = true
        return new Response(JSON.stringify({ success: true, data: { sid: 'sid-err' } }), {
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response(JSON.stringify({ success: false, error: { code: 400 } }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }) as unknown as typeof fetch

    const client = new SynologyClient({ host: 'http://nas.local:5000', user: 'admin', password: 'secret' })
    await client.login()

    const result = await client.createDownloadTaskFromFile(new Uint8Array([1]), 'fail.torrent', '/fail')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toContain('400')
    }
  })

  it('re-logins on error 119 and retries the upload', async () => {
    const { SynologyClient } = await import('../../../../src/infra/synology/client.ts')

    let callCount = 0
    globalThis.fetch = mock(async (url: string | URL | Request) => {
      callCount++
      const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : (url as Request).url

      if (callCount === 1) {
        // Initial login
        return new Response(JSON.stringify({ success: true, data: { sid: 'sid-old' } }), {
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (callCount === 2) {
        // First upload attempt -- session expired
        return new Response(JSON.stringify({ success: false, error: { code: 119 } }), {
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (urlStr.includes('auth.cgi')) {
        // Re-login
        return new Response(JSON.stringify({ success: true, data: { sid: 'sid-new' } }), {
          headers: { 'Content-Type': 'application/json' },
        })
      }
      // Retry upload -- success
      return new Response(JSON.stringify({ success: true, data: {} }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }) as unknown as typeof fetch

    const client = new SynologyClient({ host: 'http://nas.local:5000', user: 'admin', password: 'secret' })
    await client.login()

    const result = await client.createDownloadTaskFromFile(new Uint8Array([1, 2, 3]), 'retry.torrent', '/dl')
    expect(result.ok).toBe(true)
    expect(callCount).toBe(4) // login + failed upload + relogin + retry
  })
})
