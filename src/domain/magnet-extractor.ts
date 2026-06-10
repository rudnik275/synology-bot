/**
 * Extracts the first magnet URI from the given text.
 * Returns null if no valid magnet is found.
 *
 * Case-insensitive (handles `MAGNET:?XT=URN:BTIH:`), accepts both BitTorrent
 * v1 (`urn:btih:`) and v2 (`urn:btmh:`) hashes, and captures the full URI
 * including query params, stopping at whitespace.
 */
const MAGNET_REGEX = /magnet:\?xt=urn:bt(?:ih|mh):[a-z0-9]+\S*/i

export function extractMagnet(text: string): string | null {
  const match = text.match(MAGNET_REGEX)
  return match ? match[0] : null
}
