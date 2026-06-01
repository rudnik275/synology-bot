# ADR 0009: Shows tab rework — search-first, Show detail page, detail-only subscribe

## Status

Accepted (2026-06-01). Refines ADR 0005 (the Shows surface) and ADR 0006 (Mini App IA). Triaged from #124.

## Context

The original Shows tab (ADR 0006 IA) stacked three sections: an "aired today" hero block, an **add-by-numeric-show-id** form, and a subscriptions list with an inline **Remove** button. Design review (2026-05-31, #124) found this backwards:

- Adding a show by myshows **numeric id** is unusable — the owner has to look the id up elsewhere first. The natural action is to **search by name**.
- The tab had no way to *look at* a Show before tracking it (poster, seasons, episode air dates) — exactly the information that decides whether to subscribe.
- The in-app "aired today" block duplicated the daily push notification, which already tells the owner when an episode airs.

This forces a modelling change: until now a **Subscription** *was* a Show (`CONTEXT.md` said so, and listed "Show" as a word to avoid). The rework needs to talk about a **Show** that exists and is viewable independently of whether it is tracked — so Show becomes a first-class catalog entity and Subscription becomes the owner's *tracking relationship* to one.

## Decision

**The Shows tab is search-first, built around a single Show detail page; subscribe/unsubscribe is a detail-page-only action.**

1. **Two terms, not one.** **Show** = a myshows.me catalog entity (poster, Russian + original title, description, seasons, episodes with air dates). **Subscription** = the owner's tracking of a Show. (`CONTEXT.md` glossary updated.)
2. **One query-driven list.** A search field pinned at the top drives a single list area: empty query → the owner's Subscriptions; non-empty → myshows Show search results. The query string *is* the mode switch — no toggle control.
3. **Lists show status only; mutations live in the detail page.** Subscription rows carry a latest-aired-episode badge; search rows carry a *Subscribed* marker. Neither has an action button. Tapping any row opens the **Show detail** page (identical from both modes): poster, titles, description, a season accordion (latest season expanded) separating aired from upcoming episodes by air date. Subscribe / Unsubscribe lives **only** on that page.
4. **Add-by-id is removed.** Subscribing is "search → open detail → Subscribe". The bot `/subscribe <id>` command is unaffected (it is a separate surface).
5. **Badge semantics.** The list badge shows the **last episode that has aired** (most recent air date ≤ now), not `lastNotifiedEpisode` (notification bookkeeping). Priority: last aired episode → else nearest upcoming air date → else "—".
6. **In-app "today" block removed; the daily push stays.** The notifier (`runDigest`) is the sole same-day-airing channel. The now-consumerless `/api/subscriptions/today` endpoint is retired.
7. **Show metadata is cached in the Subscription store, not fetched live (variant B).** The subscriptions list reads `poster` + `latestAiredEpisode` from the store; these are stamped by the existing daily check (which already fetches each Show's full episode list) and self-healed when the detail page is opened. The stored `Subscription` gains optional `poster` and `latestAiredEpisode` fields. The `subscriptions` table stores each record as a single JSON blob (`data TEXT`), so this is a domain-type extension with **no SQL DDL migration** — pre-existing blobs simply lack the fields and are backfilled lazily. (A separate `show_cache` table that cleanly splits cached catalog data from the tracking relationship was considered and rejected as over-engineering at single-user scale — there are no SQL queries over these fields; the table is always read whole.)
8. **Search is a distinct endpoint.** `/api/search` is Toloka; Show search gets its own path (e.g. `/api/shows/search`) and detail its own (`/api/shows/:id`). myshows search uses live debounce on the client (~300 ms, ≥2–3 chars); Russian `title` is primary, `titleOriginal` a subtitle.

## Consequences

- `CONTEXT.md` is rewritten: **Show** is promoted from an avoided word to a first-class term; **Subscription** is redefined as a relationship; the Shows-tab IA paragraph is added.
- The `myshows` client grows a `shows.Search` call and captures `poster`/`description`; a pure badge-selection helper (episodes + now → aired/upcoming descriptor) is extracted for isolated testing.
- The `Subscription` domain type gains two optional cached fields; the store needs no SQL change (JSON-blob storage). Pre-existing subscriptions backfill `poster`/`latestAiredEpisode` on first daily run / detail open, and readers must tolerate the fields being absent.
- Staleness trade-off: the list badge can lag reality by up to ~a day (until the next daily run), accepted because airings are day-grained and the detail open self-heals.

## Alternatives considered

- **Keep Show and Subscription conflated.** Rejected — the rework must render and detail shows that are *not* subscribed; there is no word for that under the old glossary.
- **Live-fetch Show metadata on every list load (variant A).** Rejected — N subscriptions = N myshows RPC calls per tab open; slow and noisy against myshows for a freshness gain that day-grained airings don't need.
- **Inline quick-add / quick-remove in the lists.** Rejected — splits one mutation across two code paths; the detail page is the single canonical place to subscribe/unsubscribe.
- **Explicit "My Shows | Search" toggle.** Rejected — the query string already expresses the mode; a toggle is a redundant control.
- **Keep the in-app "aired today" block.** Rejected — duplicates the daily push with no added capability.
- **Promote the cached fields to SQL columns / a separate `show_cache` table.** Rejected — columns on the existing table would fragment storage (the rest of a Subscription is a JSON blob) for no gain; a `show_cache` table is the cleaner truth/cache split but is over-engineering at single-user scale, where these fields are never queried in SQL and the table is always read whole. The blob keeps storage consistent with the table's existing design.
