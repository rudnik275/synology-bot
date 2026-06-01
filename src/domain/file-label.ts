/**
 * fileLabel — pure heuristic that derives a short display label for one file
 * inside a torrent, in the spirit of #117.
 *
 * The confirm-step file tree shows a bold series marker (`S02E01`) per row with
 * the dim full filename underneath. This function produces only that short
 * label: an `SxxExx` marker when the filename carries one, otherwise the file's
 * basename (the directory is stripped; the extension is kept).
 *
 *   fileLabel('Andor.S02E01.1080p.WEB-DL.x265.mkv') // 'S02E01'
 *   fileLabel('Season 2/random clip.mkv')           // 'random clip.mkv'
 *   fileLabel('poster.jpg')                          // 'poster.jpg'
 *
 * Recognised series forms (case-insensitive, normalised to uppercase SxxExx):
 *   SxxExx, SxxExxExx, SxxExx-Exx (multi-episode), NxNN / N.NN (1x05, 1.05).
 */

const SXXEXX_RE = /\bS(\d{1,2})(E\d{1,3}(?:[-]?E\d{1,3})*)\b/i
const NX_RE = /\b(\d{1,2})[x.](\d{1,3})\b/

/** Strip directory components, returning the basename. */
function basename(path: string): string {
  const parts = path.split('/')
  return parts[parts.length - 1] || path
}

/** Zero-pad a season/episode number to 2 digits (e.g. 4 → "04"). */
function pad2(n: string): string {
  return n.length < 2 ? '0'.repeat(2 - n.length) + n : n
}

export function fileLabel(path: string): string {
  const name = basename(path)

  // 1. Canonical SxxExx (and multi-episode variants).
  const m = name.match(SXXEXX_RE)
  if (m) {
    const season = pad2(m[1])
    // Re-pad each Exx in the (possibly multi-episode) tail.
    const eps = m[2].replace(/E(\d{1,3})/gi, (_, d: string) => `E${pad2(d)}`).toUpperCase()
    return `S${season}${eps}`
  }

  // 2. Alternate NxNN / N.NN season-episode forms → SxxExx.
  const nx = name.match(NX_RE)
  if (nx) {
    return `S${pad2(nx[1])}E${pad2(nx[2])}`
  }

  // 3. Non-episodic file → the basename is the label.
  return name
}
