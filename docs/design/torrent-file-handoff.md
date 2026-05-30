# Design note: `.torrent` file handoff (Bot → Mini App) — #99

**Status:** implemented · **Scope:** bot + backend + Mini App

## Problem

The bot is a thin notifier (ADR 0005); all intake (search, magnet, `.torrent`
upload) lives in the Mini App. But a user's natural reflex is to forward a
`.torrent` file straight to the bot chat. Today nothing handles that document.

A file cannot be carried inline through a Telegram deep-link: `start_param` is a
short opaque token (`[A-Za-z0-9_-]`, ≤512 chars), not a payload. So the bot must
stash the bytes server-side and hand the Mini App a key to fetch them.

## Flow

1. Owner sends a `.torrent` document to the bot.
2. `message:document` handler (runs **after** the global owner-only guard, so
   auth is already enforced) detects a torrent by filename suffix `.torrent`
   (case-insensitive) **or** mime `application/x-bittorrent`.
3. Handler downloads the bytes (`getFile` → `api.telegram.org/file/bot…`) and
   stashes `{ fileName, bytes }` under a random token with a 15-minute TTL.
4. Handler replies with the existing "Открыть" WebApp button, deep-linking the
   Mini App with `start_param = tor-<token>`.
5. The Mini App reads `start_param`; the `tor-` prefix routes it (a) to the
   Downloads tab (unknown tab token → Downloads, unchanged) and (b) signals
   AddFlow to auto-open in torrent mode.
6. AddFlow fetches `GET /api/torrent-stash/:token` → `{ name, base64 }`,
   reconstructs a `File`, and resumes the normal wizard at the folder step.
   Submit goes through the **existing** `createTaskFromFile` → multipart
   `POST /api/tasks` path — no new task-creation code.

## Decisions

- **Stash, don't stream.** Bytes live in a dedicated `torrent_stash` SQLite
  table (`token, file_name, data BLOB, expires_at`), not the `kv` table — `.torrent`
  is binary and the row carries its own expiry. Migration v2.
- **TTL, not single-use delete.** `getTorrentStash` prunes on expiry; the GET
  endpoint is idempotent (safe against double-mount / retto). Abandoned stashes
  age out at 15 min. No background janitor — pruning is lazy on read, plus a
  `pruneExpiredStashes()` for opportunistic cleanup.
- **Reuse the upload path.** The Mini App reconstructs a `File` from the stashed
  bytes and calls the already-tested `createTaskFromFile`, rather than adding a
  server-side "create from token" endpoint. The only new endpoint is the stash
  reader. Bytes round-trip to the owner's client once — acceptable for a file
  that is almost always < 1 MB, and it keeps one task-creation path.
- **Auth for free.** `/api/torrent-stash/:token` sits under the existing
  `/api/*` owner-initData guard. The token is a fetch key, not a capability —
  only the owner's signed initData can read it.
- **`tor-` prefix** disambiguates a stash handoff from a tab deep-link
  (`downloads|nas|shows`) in `start_param`. Unknown tab tokens already fall back
  to Downloads, where AddFlow is mounted, so routing needs no change.

## Touched files

- `src/infra/persistence/migrations.ts` — migration v2 (`torrent_stash`)
- `src/infra/persistence/store.ts` — `stashTorrent` / `getTorrentStash` / `deleteTorrentStash` / `pruneExpiredStashes`
- `src/infra/notify/miniapp-link.ts` — `miniAppTorrentUrl` / `openTorrentButton` / `STASH_PARAM_PREFIX`
- `src/handlers/routes/torrent-intake.ts` (new) — `registerTorrentIntakeRoute`, wired in `src/bot.ts`
- `src/server/server.ts` — `GET /api/torrent-stash/:token`; `TorrentStashReader` dep wired in `src/app.ts`
- `frontend/src/telegram.ts` — `torrentToken` parsed from `start_param`
- `frontend/src/api.ts` — `torrentStash(token)`
- `frontend/src/components/AddFlow.vue` — auto-open in torrent mode from a stashed token
