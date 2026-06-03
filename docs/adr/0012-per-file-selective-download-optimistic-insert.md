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

## Alternatives considered

- **Block the UI until DSM registers the real task.** Rejected — the three-call sequence takes 1–3 seconds on a LAN NAS and longer over a tunnel; blocking with a spinner gives no progress signal and makes the add feel unreliable. A placeholder card is immediate and communicates intent.
- **Whole-torrent only (drop per-file selection).** Rejected — the owner explicitly requested the ability to pick individual files. Whole-torrent remains the fast default path; selective is opt-in by the file tree the confirm step already renders.
- **Client-side torrent parsing (parse `.torrent` bytes in the browser).** Rejected — adds a parsing library dependency, duplicates logic the NAS already has, and still requires a backend call to commit. The `create_list` → inspect → download flow reuses DSM's own parser and is the only path that works for password-protected or non-standard torrents DSM handles natively.
- **Poll-then-reconcile without a placeholder (wait for the real task to appear).** Rejected — the first poll after add may be up to the poll interval away (currently 5 s). The add action has no visible effect in that window, which looks like a bug.
