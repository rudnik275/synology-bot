# ADR 0014: Toloka-aware add intake — resolve topic links, per-file selection for links, typed source errors

## Status

Accepted (2026-06-05). Revises ADR 0008's "accept any `http(s)` URL" intake clause. Extends ADR 0012 (per-file selection) to handed-off Toloka links. Triaged from #219, #220, #201 (G2 grill).

## Context

ADR 0008 made the bot a dumb intake: it stashes any `magnet:` or `http(s)://` text and deep-links the Mini App, which fetches and adds at commit time. Three gaps surfaced in use:

- **Topic links don't work (#219).** The owner's natural reflex is to copy the page URL from the browser address bar — a Toloka **topic** page (`/t<id>`), not the `download.php?id=` link buried in the markup. The commit path feeds that raw topic URL to `toloka.downloadTorrent`, which GETs HTML (not a `.torrent`), fails the `looksLikeTorrent` guard, re-logins, and throws. The direct `download.php?id=` link works; the topic link silently never starts. (NB: topic-id ≠ download-id — `getDownloadUrl(topicId)` is dead code and wrong; the real download URL is only ever obtained by scraping `a[href^="download.php"]`.)
- **No per-file selection for links (#220).** CONTEXT.md already promises per-file selection for everything except magnets, but the implementation resolves *every* URI handoff straight to the whole-torrent path — even Toloka links, whose `.torrent` bytes the server already downloads. So a link source can't be file-filtered.
- **Opaque failures (#201).** A bad/unsupported link still gets «Ссылка получена», sending the owner into the Mini App only to hit a persistent «not found» banner on the confirm step.

## Decision

**Intake is Toloka-aware. The add source is classified; Toloka topic links are resolved to their download link; link sources get per-file selection; and unsupported links fail with a clear error — in chat when cheaply detectable, on the confirm step when only a network call can tell.**

### Source taxonomy (server, on a handed-off URI)

| Source | Behavior |
|--------|----------|
| `magnet:` | whole-torrent add (no per-file selection — BitTorrent constraint, ADR 0012) |
| Toloka topic page (`/t<id>`, `viewtopic.php?t=`) | fetch page → scrape `a[href^="download.php"]` → download link → fetch bytes → **per-file inspect** |
| Toloka `download.php?id=` | fetch bytes → **per-file inspect** |
| Toloka, but not a topic/download page | **error** |
| non-Toloka `http(s)` ending in `.torrent` | passthrough to DownloadStation (whole-torrent, no inspect) |
| any other non-Toloka `http(s)` | **error** |

### Per-file selection for Toloka links (#220)

A Toloka link source runs the **same held-bytes inspect as an in-app search result**: the server already fetches the `.torrent` via `toloka.downloadTorrent` and parses it locally (bencode), returning the file tree + `inspectToken` (ADR 0012's deferred-`create_list` path). This closes the code↔glossary gap — only magnets remain whole-only.

### Two-tier errors

- **Bot intake (cheap, URL-parse only, no network):** classify magnet / Toloka-topic / Toloka-download / non-Toloka-`.torrent` / unknown. Unknown → immediate clear error in chat instead of «Ссылка получена». Supported → stash + deep-link as today. (This is ADR 0008's own escape hatch — *"tighten to `magnet:` + URLs ending in `.torrent`"*.)
- **Mini App confirm (network):** a source that passed intake but fails the fetch/scrape (topic has no torrent, session expired, 404, empty scrape) → error on the confirm step, with a clean fallback rather than a stuck «not found».

## Consequences

- A new `parseTopicPage(html)` parser helper (reusing the search-row selectors) extracts the download link from a topic page. `getDownloadUrl(topicId)` (dead, and wrong — it assumes topic-id == download-id) is removed.
- The bot intake handler gains cheap URL classification and rejects unknown links in chat. It still creates no tasks and holds no flow state — the ADR 0008 split holds.
- The confirm step's "source unavailable — whole torrent" notice is now reserved for **magnets**; Toloka links render the file tree.
- **Capability change vs ADR 0008:** the generic "any `http(s)` URL → DownloadStation" passthrough is narrowed to non-Toloka URLs **ending in `.torrent`**; other arbitrary URLs now error instead of being silently handed to DSM. Accepted — predictable errors beat opaque DSM failures for a single-owner tool that in practice adds from Toloka + magnets.

## Alternatives considered

- **Reject topic links, require the download link.** Rejected — copying the topic URL is the natural reflex (ADR 0008's whole premise); scraping is cheap and the parser infra already exists.
- **Keep accepting any `http(s)` URL (ADR 0008 as-is).** Rejected — it is the source of the opaque #201 failures; the owner adds from Toloka, where topic resolution + per-file selection are the real wins.
- **Resolve topic→download in the bot at intake.** Rejected — keeps the bot a dumb stash (ADR 0008); the authenticated fetch/scrape belongs with the existing `downloadTorrent` at inspect/commit.
- **Pass non-Toloka non-`.torrent` URLs to DSM anyway (current behavior).** Rejected — a webpage URL produces an opaque DSM failure, exactly the "странно работает" the change removes; the `.torrent` extension gate is reversible in one line if a non-`.torrent` direct link ever matters.
