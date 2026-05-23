/**
 * Extracts the first magnet URI from the given text.
 * Returns null if no valid magnet is found.
 */
const MAGNET_REGEX = /magnet:\?xt=urn:btih:[a-zA-Z0-9]+[^\s]*/

export function extractMagnet(text: string): string | null {
  const match = text.match(MAGNET_REGEX)
  return match ? match[0] : null
}
