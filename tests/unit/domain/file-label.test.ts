// Pure, table-driven tests for the per-file label parser (#123, in the spirit
// of #117). A torrent file's display label is `SxxExx` (bold series marker) when
// the filename carries one; otherwise the label is the filename itself (no path,
// no extension stripped beyond the directory). The dim full filename is shown
// underneath separately, so this parser only produces the short label.
import { describe, it, expect } from 'bun:test'
import { fileLabel } from '../../../src/domain/file-label.ts'

describe('fileLabel — SxxExx / filename', () => {
  const cases: Array<[input: string, expected: string]> = [
    // Standard SxxExx — uppercased, zero-padded as written.
    ['Andor.S02E01.1080p.WEB-DL.DDP5.1.x265.mkv', 'S02E01'],
    ['Show.s01e09.HDTV.mkv', 'S01E09'],
    ['Some/Nested/Path/The.Wire.S03E12.720p.mkv', 'S03E12'],
    // Multi-episode files keep the full range marker.
    ['Andor.S02E01E02.1080p.mkv', 'S02E01E02'],
    ['Series.S01E05-E06.mkv', 'S01E05-E06'],
    // Alternate separators (1x05, 1.05) normalise to SxxExx.
    ['Friends.1x05.mkv', 'S01E05'],
    // Bare episode with no season → label is the filename (no fabricated season).
    ['featurette.mkv', 'featurette.mkv'],
    ['poster.jpg', 'poster.jpg'],
    // A movie / non-episodic release → label is the filename.
    ['The.Dark.Knight.2008.1080p.BluRay.x264-GROUP.mkv', 'The.Dark.Knight.2008.1080p.BluRay.x264-GROUP.mkv'],
    // Path is stripped to the basename for the fallback label.
    ['Season 2/random clip.mkv', 'random clip.mkv'],
  ]

  for (const [input, expected] of cases) {
    it(`"${input}" → "${expected}"`, () => {
      expect(fileLabel(input)).toBe(expected)
    })
  }

  it('is case-insensitive on the SxxExx marker but emits uppercase', () => {
    expect(fileLabel('show.s4e11.mkv')).toBe('S04E11')
  })

  it('returns the basename for an empty-ish path', () => {
    expect(fileLabel('a/b/c.txt')).toBe('c.txt')
  })
})
