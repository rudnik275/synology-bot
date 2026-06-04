/**
 * Unit tests for the `ds2CreateParams()` builder (#180, phase b).
 *
 * DS2 `entry.cgi` is a foot-gun: it wants JSON-encoded values — `type` as the
 * string `"url"`, `url` as a JSON array `["…"]`, `destination` as a quoted
 * `"…"`, `list_id`/`selected` as JSON. This builder centralises that quoting so
 * `createDownloadTask` / `createInspectList` / `commitInspectList` no longer
 * repeat it three times.
 */
import { describe, it, expect } from 'bun:test'
import { ds2CreateParams } from '../../../../src/infra/synology/client.ts'

describe('ds2CreateParams', () => {
  const uri = 'magnet:?xt=urn:btih:ABCDEF1234567890ABCDEF1234567890ABCDEF12'

  it('builds the createDownloadTask payload (create_list:false)', () => {
    expect(ds2CreateParams({ uri, destination: '/volume1/video', createList: false })).toEqual({
      create_list: 'false',
      type: '"url"',
      url: JSON.stringify([uri]),
      destination: '"video"',
    })
  })

  it('builds the createInspectList payload (create_list:true)', () => {
    expect(ds2CreateParams({ uri, destination: '/volume1/video/Movies', createList: true })).toEqual({
      create_list: 'true',
      type: '"url"',
      url: JSON.stringify([uri]),
      destination: '"video/Movies"',
    })
  })

  it('builds the commitInspectList (Task.List download) payload from listId + selected', () => {
    expect(
      ds2CreateParams({ listId: 'list-xyz', selected: [0, 2, 5], destination: '/volume1/video' }),
    ).toEqual({
      list_id: JSON.stringify('list-xyz'),
      selected: JSON.stringify([0, 2, 5]),
      destination: '"video"',
    })
  })

  it('normalizes the destination (strips /volumeN/ and leading slash, then quotes)', () => {
    const p = ds2CreateParams({ uri, destination: 'video/TV Shows', createList: false })
    expect(p.destination).toBe('"video/TV Shows"')
  })
})
