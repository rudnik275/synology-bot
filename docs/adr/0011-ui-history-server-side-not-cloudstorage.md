# Mini App UI history is stored server-side, not in Telegram CloudStorage

Recent searches and recent destination folders are persisted on **our backend**
(SQLite `kv` table, `ui:` namespace, exposed via `GET/PUT /api/ui-state/:key`),
not in the browser. We did this because Telegram's WebView wipes `localStorage`
between sessions and redeploys — most aggressively on iOS — so client-only
history kept silently vanishing (the bug that prompted this).

## Considered options

- **Telegram `CloudStorage`** — free, server-side, per-user, survives reinstalls.
  Rejected: it lives outside our data model (one more place owner state hides),
  is only readable from inside the Telegram client (untestable from our backend,
  invisible to the bot surface), and is capped/async with its own quirks. For a
  single-owner app that already runs a SQLite store, keeping UI state next to the
  rest of the owner's state is simpler and fully under our control.
- **`localStorage` only** — the status quo that broke. Kept as an instant-paint
  cache and the sole store in a bare browser / tests, but never the source of
  truth inside Telegram.

## Consequence

If a future reader is tempted to "simplify" by moving this to `CloudStorage`,
note that the move trades testability and a single owner-state home for a
client-only store we can't observe or seed server-side. The rejection was
deliberate. Single-user scoping (ADR 0001) is what lets the keys stay global.
