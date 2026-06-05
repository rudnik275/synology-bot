import { SECTIONS, type SectionKey } from './sections'

/** The shell's root view: the Home hub, or one of the spoke sections. */
export type StartView = 'hub' | SectionKey

/**
 * Resolve a Telegram deep-link start param into the shell's initial view
 * (ADR 0015, retargeting ADR 0006's "tab" contract to "section").
 *
 * - A `downloads` / `nas` / `shows` token → boots DIRECTLY into that section,
 *   bypassing the hub (push «Открыть» deep-link contract).
 * - Anything else (empty / unknown token) → the Home hub root.
 *
 * The `tor-<token>` add-handoff is handled separately (telegram.torrentToken →
 * AddFlow auto-open); it never reaches here as a section.
 */
export function resolveStartView(raw: string): StartView {
  return (SECTIONS as readonly string[]).includes(raw) ? (raw as SectionKey) : 'hub'
}
