import { describe, it, expect } from 'bun:test'
import { cleanReleaseTitle } from '../../../src/domain/clean-release-title.ts'

describe('cleanReleaseTitle', () => {
  // ── Dotted names ──────────────────────────────────────────────────────────

  it('converts dots to spaces', () => {
    const r = cleanReleaseTitle('The.Dark.Knight.2008.1080p.BluRay.x264-GROUP')
    expect(r.title).toBe('The Dark Knight')
    expect(r.year).toBe(2008)
    expect(r.quality).toContain('1080p')
    expect(r.quality).toContain('BluRay')
    expect(r.quality).toContain('x264')
  })

  it('converts underscores to spaces', () => {
    const r = cleanReleaseTitle('Inception_2010_720p_WEB-DL_x264')
    expect(r.title).toBe('Inception')
    expect(r.year).toBe(2010)
    expect(r.quality).toContain('720p')
    expect(r.quality).toContain('WEB-DL')
    expect(r.quality).toContain('x264')
  })

  // ── Release group suffix stripping ───────────────────────────────────────

  it('strips trailing -GROUP release group', () => {
    const r = cleanReleaseTitle('Movie.Name.2022.1080p.BluRay.x265-RARBG')
    expect(r.title).toBe('Movie Name')
    expect(r.quality).toContain('x265')
    expect(r.title).not.toContain('RARBG')
    expect(r.title).not.toContain('-')
  })

  it('strips -YTS.MX style release groups', () => {
    const r = cleanReleaseTitle('Avengers.Endgame.2019.1080p.BluRay.x264-YTS.MX')
    expect(r.title).toBe('Avengers Endgame')
    expect(r.year).toBe(2019)
  })

  // ── Quality token extraction ──────────────────────────────────────────────

  it('extracts 2160p/4K resolution', () => {
    const r = cleanReleaseTitle('Dune.2021.2160p.UHD.BluRay.x265.HDR-GROUP')
    expect(r.quality).toContain('2160p')
    expect(r.quality).toContain('BluRay')
    expect(r.quality).toContain('x265')
    expect(r.quality).toContain('HDR')
    expect(r.title).not.toContain('2160p')
    expect(r.title).not.toContain('HDR')
  })

  it('extracts Dolby Vision', () => {
    const r = cleanReleaseTitle('Show.S01.2160p.BluRay.DV.HEVC-GROUP')
    expect(r.quality).toContain('DV')
    expect(r.quality).toContain('HEVC')
  })

  it('extracts audio tokens (Atmos, DD5.1)', () => {
    const r = cleanReleaseTitle('Film.2023.1080p.BluRay.DD5.1.x264-GROUP')
    expect(r.quality).toContain('DD5.1')
    expect(r.title).not.toContain('DD5')
  })

  it('extracts Remux source', () => {
    const r = cleanReleaseTitle('Movie.2020.2160p.BluRay.Remux.HDR10-GROUP')
    expect(r.quality).toContain('Remux')
    expect(r.quality).toContain('HDR10')
    expect(r.title).not.toContain('Remux')
  })

  // ── Language extraction ───────────────────────────────────────────────────

  it('multi-language Toloka sample: extracts Ukrainian/English/Russian', () => {
    const r = cleanReleaseTitle('Назва.Фільму.2022.1080p.WEB-DL.Ukr.Eng.Rus.x264-TolName')
    expect(r.languages).toContain('Ukr')
    expect(r.languages).toContain('Eng')
    expect(r.languages).toContain('Rus')
    expect(r.title).not.toContain('Ukr')
    expect(r.title).not.toContain('Eng')
    expect(r.title).not.toContain('Rus')
  })

  it('extracts standalone Ukr language token', () => {
    const r = cleanReleaseTitle('Film.2021.720p.WEB-DL.Ukr.x264')
    expect(r.languages).toContain('Ukr')
  })

  // ── Season pack — SxxExx kept in title ───────────────────────────────────

  it('keeps SxxExx in title', () => {
    const r = cleanReleaseTitle('Breaking.Bad.S03E07.1080p.BluRay.x264-GROUP')
    expect(r.title).toContain('S03E07')
    expect(r.quality).toContain('1080p')
  })

  it('keeps season pack marker (S01 without episode) in title', () => {
    const r = cleanReleaseTitle('The.Wire.S01.720p.BluRay.x264-GROUP')
    expect(r.title).toContain('S01')
    expect(r.quality).toContain('720p')
  })

  // ── Year capture ─────────────────────────────────────────────────────────

  it('extracts 4-digit year 19xx', () => {
    const r = cleanReleaseTitle('Blade.Runner.1982.1080p.BluRay.x264')
    expect(r.year).toBe(1982)
  })

  it('extracts 4-digit year 20xx', () => {
    const r = cleanReleaseTitle('Top.Gun.Maverick.2022.2160p.UHD.BluRay-GROUP')
    expect(r.year).toBe(2022)
  })

  it('returns year undefined when not present', () => {
    const r = cleanReleaseTitle('Some.Film.1080p.x264')
    expect(r.year).toBeUndefined()
  })

  // ── No-empty-title fallback ───────────────────────────────────────────────

  it('never returns empty title — falls back to raw string', () => {
    const raw = '1080p.x264'
    const r = cleanReleaseTitle(raw)
    expect(r.title.length).toBeGreaterThan(0)
  })

  it('returns raw string as title when raw is plain text with no tokens', () => {
    const r = cleanReleaseTitle('Just a Normal Movie')
    expect(r.title).toBe('Just a Normal Movie')
  })

  // ── Real Toloka samples ───────────────────────────────────────────────────

  it('real Toloka sample: multi-dub Ukrainian tracker release', () => {
    const r = cleanReleaseTitle(
      'Зоряні.Війни.Нова.Надія.1977.BDRip.1080p.Ukr.Eng.Rus.sub.Ukr.Eng'
    )
    expect(r.year).toBe(1977)
    expect(r.quality).toContain('BDRip')
    expect(r.quality).toContain('1080p')
    expect(r.languages).toContain('Ukr')
    expect(r.languages).toContain('Eng')
    expect(r.languages).toContain('Rus')
    expect(r.title.length).toBeGreaterThan(0)
    expect(r.title).not.toContain('BDRip')
  })

  it('real Toloka sample: TV series season pack', () => {
    const r = cleanReleaseTitle(
      'Чорне.Дзеркало.S06.2023.WEB-DL.1080p.Ukr.Eng-TolTeam'
    )
    expect(r.year).toBe(2023)
    expect(r.title).toContain('S06')
    expect(r.quality).toContain('WEB-DL')
    expect(r.quality).toContain('1080p')
    expect(r.languages).toContain('Ukr')
    expect(r.languages).toContain('Eng')
  })

  it('drops empty brackets and dangling separators left after token extraction', () => {
    // Reproduces the live confirm-step junk "From (Season 4) ( ) / |".
    const r = cleanReleaseTitle('Ззовні (Сезон 4) / From (Season 4) (2026) WEB-DL 1080p Ukr/Eng')
    expect(r.title).not.toMatch(/[([{]\s*[)\]}]/) // no empty "( )"
    expect(r.title).not.toMatch(/[/|·\s]$/) // no trailing separator / pipe
    expect(r.title).toContain('From (Season 4)') // season marker kept
    expect(r.title).toContain('Ззовні (Сезон 4)') // dual-title + lone "/" preserved
    expect(r.title).toContain(' / ')
    expect(r.year).toBe(2026)
  })

  it('keeps a lone slash divider but collapses a run of separators', () => {
    expect(cleanReleaseTitle('Назва / Title').title).toBe('Назва / Title')
    expect(cleanReleaseTitle('Назва / | Title').title).toBe('Назва / Title')
  })
})
