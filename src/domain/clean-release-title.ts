/**
 * cleanReleaseTitle — pure heuristic function that splits a scene-format
 * torrent title into a human-readable title plus structured metadata tags.
 *
 * Input:  "The.Dark.Knight.2008.1080p.BluRay.x264-GROUP"
 * Output: { title: "The Dark Knight", year: 2008, quality: ["1080p","BluRay","x264"], languages: [] }
 *
 * Algorithm:
 *  1. Normalise underscores → dots for uniform separator handling.
 *  2. Extract quality/language/year tokens (all operate on dot-form).
 *  3. Strip trailing release group suffix from whatever remains.
 *  4. Normalise dots → spaces, trim, collapse whitespace.
 *  5. Never return empty title — fall back to the raw string.
 */

export interface CleanedTitle {
  /** Human-readable title with scene tokens stripped */
  title: string
  /** 4-digit year, if found */
  year?: number
  /** Resolution, source, codec, HDR, audio tokens */
  quality: string[]
  /** Language codes extracted from title */
  languages: string[]
}

// ── Token patterns (order matters: longer/more-specific first) ────────────────

interface TokenGroup {
  re: RegExp
  label: 'quality' | 'language' | 'discard'
  transform?: (s: string) => string
}

const TOKEN_GROUPS: TokenGroup[] = [
  // Subtitle/sub marker — discard
  { re: /\bsub\b/gi, label: 'discard' },

  // Language codes (common on Toloka/Hurtom and international scene)
  {
    re: /\b(Ukr|Eng|Rus|Pol|Ger|Fra|Spa|Ita|Por|Chi|Jpn|Kor|Dut|Swe|Nor|Dan|Fin|Cze|Slo|Hun|Rom|Bul|Srb|Hrv|Tur|Heb|Ara|multi)\b/gi,
    label: 'language',
    transform: (s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase(),
  },

  // Audio — longer tokens first so TrueHD > Atmos, DD5.1 > DD
  {
    re: /\bTrueHD\.Atmos\b|\bTrueHD\b|\bAtmos\b|\bDD\+|\bDD5\.1\b|\bDD2\.0\b|\bDTS-HD\.MA(?:\.\d+\.\d+)?\b|\bDTS-HD\b|\bDTS-X\b|\bDTS\b|\bEAC3\b|\bE-AC3\b|\bAC3\b|\bAAC(?:\d+\.\d+)?\b|\bFLAC\b|\bMP3\b|\bOpus\b|\bPCM\b|\bDD\b/gi,
    label: 'quality',
  },

  // HDR / colour-space
  {
    re: /\bHDR10\+\b|\bHDR10\b|\bDoVi\b|\bDolby\.Vision\b|\bDV\b|\bHLG\b|\b10bit\b|\b10-bit\b|\b8bit\b|\b8-bit\b|\bHDR\b/gi,
    label: 'quality',
    transform: (s) => s.replace(/\./g, ''),
  },

  // Codec
  {
    re: /\bx265\b|\bx264\b|\bH\.265\b|\bH265\b|\bH\.264\b|\bH264\b|\bHEVC\b|\bAVC\b|\bXviD\b|\bDivX\b|\bAV1\b|\bVP9\b|\bVC-1\b|\bVC1\b/gi,
    label: 'quality',
    transform: (s) => s.replace(/\./g, ''),
  },

  // Source — WEB-DL before any partial-matching prefix
  {
    re: /\bWEB-DL\b|\bWEBRip\b|\bBluRay\b|\bBDRip\b|\bBRRip\b|\bHDTV\b|\bDVDRip\b|\bDVDScr\b|\bHDCAM\b|\bRemux\b|\bHDRip\b|\bCAM\b/gi,
    label: 'quality',
  },

  // Resolution
  {
    re: /\b2160p\b|\b1080p\b|\b720p\b|\b480p\b|\b360p\b|\b4K\b/gi,
    label: 'quality',
  },
]

/** Year token */
const YEAR_RE = /\b(19\d{2}|20\d{2})\b/

/**
 * Release group suffix: a hyphen followed by an all-uppercase or mixed-case
 * purely alphabetic-numeric token at the very end of the string.
 * We apply this AFTER all other tokens are extracted so WEB-DL is not confused.
 * Pattern: optionally dot-separated segments, all [A-Za-z0-9]+, at the end.
 */
const RELEASE_GROUP_SUFFIX_RE = /-[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*)*$/

// ── Implementation ────────────────────────────────────────────────────────────

export function cleanReleaseTitle(raw: string): CleanedTitle {
  const quality: string[] = []
  const languages: string[] = []
  let year: number | undefined

  // 1. Normalise underscores → dots for uniform separator handling.
  let working = raw.replace(/_/g, '.')

  // 2. Extract all recognised scene tokens (quality, language, audio, etc.).
  //    We work on the dot-form so multi-char tokens like WEB-DL and DD5.1 match.
  for (const { re, label, transform } of TOKEN_GROUPS) {
    re.lastIndex = 0
    working = working.replace(re, (match) => {
      const value = transform ? transform(match) : match
      if (label === 'quality' && !quality.includes(value)) {
        quality.push(value)
      } else if (label === 'language' && !languages.includes(value)) {
        languages.push(value)
      }
      // Replace with a dot to keep surrounding token boundaries intact.
      return '.'
    })
  }

  // 3. Extract year.
  const yearMatch = working.match(YEAR_RE)
  if (yearMatch) {
    year = parseInt(yearMatch[1], 10)
    working = working.replace(YEAR_RE, '.')
  }

  // 4. Strip trailing release group suffix AFTER other tokens are gone,
  //    so we don't accidentally eat "WEB-DL" or "DD5.1".
  working = working.replace(RELEASE_GROUP_SUFFIX_RE, '')

  // 5. Normalise remaining dots → spaces, collapse whitespace.
  let title = working.replace(/\./g, ' ').replace(/\s+/g, ' ').trim()

  // 6. Drop empty brackets left when a token was extracted from inside them,
  //    e.g. "From (Season 4) (2026)" → "From (Season 4) ( )" → "From (Season 4)".
  title = title.replace(/[([{]\s*[)\]}]/g, ' ')

  // 7. Collapse a RUN of 2+ adjacent separators (left dangling when a token
  //    between/around them was removed) to a single one — but keep a lone
  //    separator, which is a real divider (the "Назва / Title" dual-title split).
  title = title.replace(/\s*([/|·])\s*(?:[/|·]\s*)+/g, ' $1 ')

  // 8. Collapse whitespace, then strip stray leading/trailing punctuation and
  //    now-dangling separators (e.g. a trailing " / |").
  title = title.replace(/\s+/g, ' ').trim()
  title = title.replace(/^[-–/|·\s.]+/, '').replace(/[-–/|·\s.]+$/, '').trim()

  // 9. Guard: never return empty title.
  if (!title) {
    title = raw
  }

  return { title, year, quality, languages }
}
