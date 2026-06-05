# ADR 0012: Per-file selective download (DS2 create_list → list → download) + optimistic insert

## Status

Accepted (2026-06-03). Extends the Add flow defined in [ADR 0008](0008-add-intake-search-only-app-bot-handoff.md).

## Context

Two distinct problems arose as the Add flow matured:

**Per-file selection.** The owner wanted to download only specific files from a multi-file torrent — picking an episode from a season pack, or skipping extras. The DS2 API exposes no single-call way to pass a file selection at create time. The only path is a three-call sequence (reverse-engineered from the DSM web UI's own `download.js` on the NAS): create the torrent as a transient list, inspect the file tree from that list, then commit with an array of selected indices. The whole-torrent add (a single `create` call) remains the default for speed and for magnets, which cannot be file-inspected before bytes arrive.

**Perceived latency.** The DS2 three-call sequence adds a noticeable round-trip before the task appears in the Downloads list. Even the old single-call add had a poll lag before the real task showed up. Blocking the UI until DSM confirms makes the add feel slow and gives no feedback while the backend works.

## Decision

### 1. Per-file selective download via the DS2 three-call flow

**The confirm step auto-inspects every non-magnet torrent and presents a file tree. «Добавить» commits only the ticked files.**

The three backend calls, issued in sequence:

1. `SYNO.DownloadStation2.Task` `create` with `create_list: true` — DSM parses the torrent, stores it as a transient list, and returns a `list_id`. No permanent task is created.
2. `SYNO.DownloadStation2.Task.List` `get(list_id)` — returns the file tree as `[{index, name, size}]`.
3. `SYNO.DownloadStation2.Task.List.Polling` `download(list_id, selected: [indices])` — creates the real download task for the ticked files only.

The `selected` parameter is an array of zero-based file indices where `enable === true` in the file tree. (The parameter name is `selected`, not `file_indexes` — this was wrong in all earlier attempts and caused the commit to silently fail or create empty tasks.)

**Whole-torrent add (default/instant path)** is unchanged: a single `create` call with no `create_list` flag. Magnets always use this path — they cannot be inspected before the local client has the metadata bytes, which requires actually starting the download.

### 2. Optimistic insert

**Tapping «Добавить» places a placeholder card in the Downloads list immediately. The real task id is reconciled in the background.**

`frontend/src/composables/useOptimisticTasks.ts` is a module-singleton store that holds placeholder tasks. Each placeholder carries a client-generated id, the filename, and a `pending` state that the UI renders as a loader card. On every poll cycle, `useApi` checks new task ids against the outstanding placeholders and retires the first placeholder whose filename matches (or falls back to a 30-second TTL backstop). Once reconciled, the real task takes over in the list and the placeholder is removed.

## Consequences

- **Backend.** `SynologyClient` gains a three-call `createSelectiveDownloadTask` path. The whole-torrent `createDownloadTask` is untouched. Both are called from the same confirm endpoint, branching on whether the stash contains a `.torrent` (selective eligible) or a `magnet:`/URL (whole-torrent only).
- **Frontend — file tree.** The confirm step calls a new `/api/torrent/inspect` endpoint after mount. While inspecting, it shows a skeleton; on success it renders the file tree with individual checkboxes. The owner can untick files before adding. If inspection fails (network error, timeout), the confirm step falls back to the whole-torrent add with an inline notice.
- **Frontend — optimistic store.** The composable is a module singleton so the placeholder survives component remounts (e.g. navigating away and back during the poll window). The 30-second TTL prevents orphaned placeholders if the DS2 task never registers (e.g. DSM rejects it silently).
- **Magnets cannot be selectively downloaded.** This is a fundamental constraint of the BitTorrent protocol — metadata (file list) is only available after the client has the `.torrent` bytes. Documented in the UI with a short notice on the confirm step for magnet-sourced adds.

## Update (2026-06-04): instant tree via deferred `create_list`

The three calls above are still the commit-time sequence, but **when** the first
call fires changed for sources we hold the `.torrent` bytes for (search/Toloka
downloads and `.torrent` uploads — everything except magnets):

- **#161 (instant tree).** The server parses the `.torrent` bytes locally
  (bencode, ~1 ms) and returns the file tree directly, so the confirm step no
  longer polls DSM for parsed metadata. The local file index equals DSM's index
  (both enumerate the torrent's fixed `info.files` order — covered by
  `bencode.test.ts`), so `selected` stays correct.
- **Deferred `create_list` (this change).** `inspect` no longer calls DSM at all
  for held-bytes sources. It returns the locally-parsed tree plus an opaque
  `inspectToken` (a handle to the still-stashed bytes). The `create_list` call
  (step 1) is deferred to `commit`, which runs `create_list` → `download`
  (steps 1+3) back-to-back **inside the optimistic background** after «Добавить».
  Because the commit is already fully optimistic (the placeholder shows and the
  sheet closes before any DSM call), the multi-second DSM round-trip is now
  invisible to the owner. The file tree appears with **no DSM wait**.

  Two further consequences: reaching the confirm step creates **no transient NAS
  list** (it's born at commit), so backing out leaves no orphan to release; and
  the `selected`-array contract from this ADR is unchanged. Magnets keep the
  original create-at-inspect + poll path — they have no local bytes to parse, so
  `inspect` still calls `create_list` and returns a `listId` the client polls.

The contract: `inspect` returns `{ files, inspectToken }` (held bytes) or
`{ listId }` (magnet); `commit` accepts either an `inspectToken` (create-then-
commit) or a `listId` (commit only). This makes the line-below "client-side
parsing rejected" tradeoff moot — the parse happens **server-side** (no browser
dependency) and a backend commit call was always required regardless.

## Update (2026-06-05): in-place mutation convention + reconcile by identity

Two clarifications from the G3 grill (#202, #218):

- **No full-page reload on a mutation.** A user mutation (subscribe/unsubscribe, add) updates state **in place** — patch only the changed field — and never re-enters a full-page loading state. Loading skeletons are **first-load only**. (#218: `handleSubscribe` re-ran `loadDetail`, whose `detailLoading` swapped the whole `ShowDetail` for a loader → a visible flicker. Fix: await the API, then patch `isSubscribed` in place.)
- **Reconcile by identity, not count (#202).** `useOptimisticTasks.reconcile` now retires a placeholder only when a newly-appeared real task **matches it by identity**. The frozen `TaskView` contract carries no infohash, so identity is: **normalized title** (lowercase, `.` and `_` → space, collapse whitespace, trim) OR **normalized destination** (strip leading/trailing slashes, lowercase, trim — skipped if empty/null). The **oldest** matching placeholder is retired (FIFO for two quick adds to the same folder). A real task matching no placeholder retires nothing, so an external add (e.g. from the Telegram bot) can no longer consume a live placeholder. The 30 s TTL backstop remains unchanged. Shipped in `frontend/src/composables/useOptimisticTasks.ts` (#202).

## Alternatives considered

- **Block the UI until DSM registers the real task.** Rejected — the three-call sequence takes 1–3 seconds on a LAN NAS and longer over a tunnel; blocking with a spinner gives no progress signal and makes the add feel unreliable. A placeholder card is immediate and communicates intent.
- **Whole-torrent only (drop per-file selection).** Rejected — the owner explicitly requested the ability to pick individual files. Whole-torrent remains the fast default path; selective is opt-in by the file tree the confirm step already renders.
- **Client-side torrent parsing (parse `.torrent` bytes in the browser).** Rejected — adds a parsing library dependency, duplicates logic the NAS already has, and still requires a backend call to commit. The `create_list` → inspect → download flow reuses DSM's own parser and is the only path that works for password-protected or non-standard torrents DSM handles natively.
- **Poll-then-reconcile without a placeholder (wait for the real task to appear).** Rejected — the first poll after add may be up to the poll interval away (currently 5 s). The add action has no visible effect in that window, which looks like a bug.
