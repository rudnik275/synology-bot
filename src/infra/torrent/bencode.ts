// Dependency-free bencode decoder + .torrent file-list parser (#161).
//
// Bencode is BitTorrent's serialization format (BEP 3). We only need to READ a
// .torrent's `info` dict to surface the file tree (name / length / files), so
// this is a minimal bdecode — no encoder, no validation beyond what the parse
// needs. It is kept dependency-free on purpose: the add flow is sensitive and we
// don't want a transitive parser pulling surprises into the hot path.
//
// Two design choices matter for the add flow:
//  1. String VALUES decode to raw bytes (Uint8Array), never to a JS string. The
//     `info` dict mixes UTF-8 names with binary (`pieces` is a SHA-1 blob); only
//     the caller, which knows a given field is text, decodes it as UTF-8.
//  2. Dicts decode to a Map in INSERTION order, and lists keep their order. The
//     index-parity guarantee (local index == DSM index) depends on us reading
//     `info.files` in the exact stored order — see bencode.test.ts.

/** A decoded bencode value: int, raw byte-string, list, or ordered dict. */
export type BValue = number | Uint8Array | BValue[] | Map<string, BValue>

const CHAR = {
  i: 0x69, // 'i'
  l: 0x6c, // 'l'
  d: 0x64, // 'd'
  e: 0x65, // 'e'
  colon: 0x3a, // ':'
  minus: 0x2d, // '-'
  zero: 0x30, // '0'
  nine: 0x39, // '9'
} as const

/**
 * Decode a single bencode value from `bytes`. Throws on malformed input so the
 * caller (inspect) can catch and fall back to the DSM poll — a parse error must
 * NEVER surface a corrupt tree.
 */
export function decodeBencode(bytes: Uint8Array): BValue {
  const [value, next] = decodeAt(bytes, 0)
  if (next !== bytes.length) {
    throw new Error(`bencode: ${bytes.length - next} trailing byte(s) after top-level value`)
  }
  return value
}

/** Decode the value starting at `pos`; returns [value, indexAfterValue]. */
function decodeAt(bytes: Uint8Array, pos: number): [BValue, number] {
  if (pos >= bytes.length) throw new Error('bencode: unexpected end of input')
  const c = bytes[pos]
  if (c === CHAR.i) return decodeInt(bytes, pos)
  if (c === CHAR.l) return decodeList(bytes, pos)
  if (c === CHAR.d) return decodeDict(bytes, pos)
  if (c >= CHAR.zero && c <= CHAR.nine) return decodeString(bytes, pos)
  throw new Error(`bencode: unexpected byte 0x${c.toString(16)} at ${pos}`)
}

function decodeInt(bytes: Uint8Array, pos: number): [number, number] {
  // i<digits>e — `pos` points at 'i'.
  let i = pos + 1
  let sign = 1
  if (bytes[i] === CHAR.minus) {
    sign = -1
    i++
  }
  let digits = ''
  while (i < bytes.length && bytes[i] >= CHAR.zero && bytes[i] <= CHAR.nine) {
    digits += String.fromCharCode(bytes[i])
    i++
  }
  if (digits.length === 0) throw new Error(`bencode: empty integer at ${pos}`)
  if (bytes[i] !== CHAR.e) throw new Error(`bencode: unterminated integer at ${pos}`)
  return [sign * Number(digits), i + 1]
}

function decodeString(bytes: Uint8Array, pos: number): [Uint8Array, number] {
  // <len>:<bytes> — `pos` points at the first length digit.
  let i = pos
  let lenStr = ''
  while (i < bytes.length && bytes[i] >= CHAR.zero && bytes[i] <= CHAR.nine) {
    lenStr += String.fromCharCode(bytes[i])
    i++
  }
  if (bytes[i] !== CHAR.colon) throw new Error(`bencode: malformed string length at ${pos}`)
  const len = Number(lenStr)
  const start = i + 1
  const end = start + len
  if (end > bytes.length) throw new Error(`bencode: string overruns input at ${pos}`)
  // slice() copies, so callers can hold the bytes past the buffer's life.
  return [bytes.slice(start, end), end]
}

function decodeList(bytes: Uint8Array, pos: number): [BValue[], number] {
  // l...e — `pos` points at 'l'.
  let i = pos + 1
  const out: BValue[] = []
  while (i < bytes.length && bytes[i] !== CHAR.e) {
    const [value, next] = decodeAt(bytes, i)
    out.push(value)
    i = next
  }
  if (bytes[i] !== CHAR.e) throw new Error(`bencode: unterminated list at ${pos}`)
  return [out, i + 1]
}

function decodeDict(bytes: Uint8Array, pos: number): [Map<string, BValue>, number] {
  // d...e — `pos` points at 'd'. Keys are byte-strings (decoded as UTF-8 for the
  // Map key); insertion order is preserved by Map.
  let i = pos + 1
  const out = new Map<string, BValue>()
  while (i < bytes.length && bytes[i] !== CHAR.e) {
    const [keyBytes, afterKey] = decodeString(bytes, i)
    const [value, afterValue] = decodeAt(bytes, afterKey)
    out.set(new TextDecoder().decode(keyBytes), value)
    i = afterValue
  }
  if (bytes[i] !== CHAR.e) throw new Error(`bencode: unterminated dict at ${pos}`)
  return [out, i + 1]
}

/** One file in a torrent, in `info.files` order. The array index IS the DSM index. */
export interface TorrentFile {
  path: string
  length: number
}

function asMap(v: BValue | undefined): Map<string, BValue> | null {
  return v instanceof Map ? v : null
}

function asInt(v: BValue | undefined): number {
  return typeof v === 'number' ? v : 0
}

function utf8(v: BValue | undefined): string {
  return v instanceof Uint8Array ? new TextDecoder().decode(v) : ''
}

/**
 * Parse the file list from a .torrent's raw bytes, in `info.files` order.
 *
 * Multi-file torrent: each entry's `path` is its path segments joined with '/'
 * (each segment decoded as UTF-8). Single-file torrent (no `info.files`, has
 * `info.length`): one entry `{ path: info.name, length: info.length }`.
 *
 * The RETURNED ORDER defines the 0-based file indices we display and commit. The
 * .torrent spec stores `info.files` in a fixed order and DSM enumerates the same
 * list, so this index matches DSM's `index` — that's the parity guarantee #161
 * relies on to commit the user's selection by index after a local parse.
 */
export function parseTorrentFiles(bytes: Uint8Array): TorrentFile[] {
  const root = asMap(decodeBencode(bytes))
  const info = asMap(root?.get('info'))
  if (!info) throw new Error('bencode: .torrent has no info dict')

  const filesValue = info.get('files')
  if (Array.isArray(filesValue)) {
    return filesValue.map((entry) => {
      const file = asMap(entry)
      const pathSegments = file?.get('path')
      const path = Array.isArray(pathSegments) ? pathSegments.map((seg) => utf8(seg)).join('/') : ''
      return { path, length: asInt(file?.get('length')) }
    })
  }

  // Single-file torrent: the name IS the file, length sits at info.length.
  return [{ path: utf8(info.get('name')), length: asInt(info.get('length')) }]
}
