# ADR 0008: Add intake — Mini App search-only, bot chat hands off `.torrent` and magnet

## Status

Accepted (2026-05-31). Refines ADR 0005 (the "search/add — Toloka, magnet, `.torrent`" clause) and the `.torrent` handoff design note ([`docs/design/torrent-file-handoff.md`](../design/torrent-file-handoff.md), #99). Triaged from #120.

## Context

The unified Add flow (ADR 0006 IA) offered three in-app source modes behind a chooser step: Toloka **search**, **magnet/URL** paste, and **.torrent upload** → folder picker → confirm. Design review (2026-05-30) found the chooser step and the magnet/upload inputs to be clutter the owner rarely touches:

- The **natural reflex** for a `.torrent` file or a magnet link is to drop it into the bot chat, not to open the Mini App and hunt for a paste field. #99 already built that reflex for `.torrent` files (bot stashes the bytes, deep-links the Mini App into the wizard at the folder step).
- The in-app magnet/upload inputs duplicate that path with worse ergonomics, and the source-chooser step exists only to disambiguate three modes — collapse the modes and the step has no reason to exist.
- Search is the only mode that genuinely needs the Mini App (it renders a result list); it should be the whole in-app Add flow, not one of three cards.

This tensions ADR 0005's "thin notifier bot (push) — owner DM alerts only": the bot regains a narrow **intake** role. That role is handoff-only (stash + deep-link), never task creation — task creation stays owner-verified in the Mini App — so the split's intent (no stateful management in chat) holds.

## Decision

**The Mini App Add flow is search-only. `.torrent` files and magnet links are handed off through the bot chat.**

1. **Mini App** — FAB opens the wizard directly into Search. Flow: **Search → Folder → Confirm** (3 steps). The source-chooser step, the magnet/URL input, and the in-wizard `.torrent` upload are removed.
2. **Bot chat** — two intake handlers, both stash-and-deep-link (no task creation in chat):
   - `.torrent` document → stash bytes (existing #99 path).
   - text that is a `magnet:` link **or** an `http(s)://` URL → stash the URI. This mirrors the old in-wizard "Magnet / URL" mode (it accepted any URI), so the direct-`.torrent`-URL capability is preserved. The handler only fires when the message text *is* such a link — ordinary chat text is ignored.
3. **Handoff target** — both deep-link the Mini App, which opens the wizard at the **Folder** step with the source pre-loaded: **Folder → Confirm** (2 steps).
4. **Stash generalization** — the `torrent_stash` mechanism generalizes to an add-intake stash holding either file bytes **or** a URI string (magnet links can exceed the 512-char `start_param` limit, so magnet is stashed, not carried inline).

## Consequences

- The `CONTEXT.md` "Add flow" definition and the "Download Task" provenance line are rewritten: in-app intake is search-only; magnet/`.torrent` come via the bot.
- The bot is no longer strictly push-only — it owns a thin, stateless **intake-handoff** surface (`.torrent` + magnet). It still never creates tasks or holds flow state.
- #114 (broken Add flow) shrinks: the acceptance "all three modes work in-app" becomes "search works in-app end-to-end; `.torrent` + magnet work via the bot handoff."
- Dependent redesign tasks inherit this shape: #119 (wizard shell) targets a 2–3 step flow with no chooser; #121 (search step) is now the wizard's first/primary screen; #123 (final window + file selection) is the surviving Confirm step.
- Capability loss: nothing is dropped vs the old in-wizard "Magnet / URL" mode — magnet links and direct `.torrent` URLs both move to the bot chat. The only loss is *in-app* pasting; the capability itself survives in chat.
- Trigger ambiguity: accepting `http(s)://` text means any link the owner sends to the bot is treated as add-intent. Accepted because the chat is a single-owner DM whose only purpose is this tool — there is no ordinary-conversation traffic to misfire on. If false fires become a problem, tighten to `magnet:` + URLs ending in `.torrent`.

## Alternatives considered

- **Keep magnet as an in-app mode, move only `.torrent` to the bot.** Rejected — asymmetric; the chooser step would survive for two modes (search + magnet) and the "paste into chat" reflex applies equally to magnet.
- **Trigger the bot handler only on `magnet:` (drop direct-URL adds).** Rejected — the old in-wizard mode accepted any URI; restricting to `magnet:` would silently drop the direct-`.torrent`-URL capability. The owner-only DM has no ambiguous traffic, so accepting http(s) too is safe.
