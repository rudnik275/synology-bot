# Engineering lessons

Captured lessons from real incidents in this project. Each lesson explains the trigger, the consequence, and how to avoid the same trap.

## Probe external systems before architecting around assumed defences

### Lesson

When designing an integration with an external system (a website, an API, a 3rd-party service), probe it directly before architecting around what you assume its defences look like. A 30-second `curl -A "Mozilla/5.0 ..."` answers most of these questions.

### Background

2026-05-24: While sketching the Toloka rewrite (#19, #21), it was assumed (without checking) that toloka.to had aggressive Cloudflare bot-detection and that a Playwright fallback was necessary. This drove:

- ~250 MB Docker image bloat
- ~14 tests
- ~700 lines of code
- CI breakage on every `oven/bun` base-image bump (`bunx playwright install --with-deps` keeps failing as Ubuntu packages rename)

A 5-minute hands-on probe (PR #44, post-v2.0.0) showed Cloudflare was passive-CDN only, login was a plain HTML form, no CAPTCHA, no JS challenge. The entire Playwright fallback was YAGNI and got removed in v2.1.0 / PR #44.

See companion: [toloka.to defences map](./integrations/toloka-defences.md).

### How to apply

- Before adding browser automation, retry-with-backoff layers, anti-bot evasion, TLS fingerprint impersonation, or similar defensive infrastructure → probe the target first.
- When reviewing a PR or design that includes such defences, ask "what evidence triggered this?" If the answer is "in case", that's YAGNI; defer until owner reports an actual production failure.
- For external integrations: walk every endpoint anonymously first (no auth) to map what is reachable, then walk with auth to see what changes. Often reveals cheap paths (RSS, sitemaps, public JSON) the design did not consider.
- Don't conflate "Cloudflare is in front" (very common, mostly CDN) with "Cloudflare actively challenges requests" (rarer, needs evidence).

## Rewriting a whole file silently reverts unrelated fixes from master

### Lesson

When a PR rewrites a whole file (rather than editing in place), the rewrite is implicitly diffed against whichever master state the worktree was forked from. If master has moved on since fork, recent unrelated fixes to that file are erased — and `git diff` against the fork point won't show anything wrong because the rewrite is internally consistent. Always rebase or pull before pushing, and skim `git log <fork-point>..origin/master -- <file>` for any commits that touched the same file.

### Background

2026-05-26: PR #57 (forum topics) rewrote `src/app.ts` end-to-end based on the version read at session start. Between fork and PR open, master had received #53 (`ping-nas → ping_nas`, `deploy-status → deploy_status` to satisfy Telegram's `[a-z0-9_]{1,32}` rule for `setMyCommands`). The rewrite reintroduced the hyphenated names. CI was green (typecheck + unit tests don't hit the live Bot API), the PR merged, v3.1.0 tagged, image deployed — the bot then crash-looped on every start with `Bad Request: BOT_COMMAND_INVALID` until v3.1.1 restored the underscores ~45 min later. No forum topics created in that window; the Owner saw repeated Watchtower shoutrrr "updated" messages with no follow-up from the bot.

### How to apply

- Before pushing a PR that touched a whole file: `git fetch origin && git log <fork-point>..origin/master -- <changed-files>`. If there are commits in that range, rebase onto origin/master and re-resolve.
- When rewriting a file is the right move (heavy refactor, structural change), commit a `BASELINE: copy current master` step first, then the rewrite — review then shows exactly what the rewrite changes vs intervening fixes.
- Tests aren't enough for live-API surface (`setMyCommands`, `createForumTopic`, etc.) — a smoke deploy to a staging bot would have caught this in seconds. Until staging exists, treat any change to the startup sequence as a hot deploy and watch logs immediately after the tag pushes.
- Reverse-canary: bumping a version + tagging is the cheap, recoverable part. The expensive part is bot downtime; a smaller fix-forward PR (v3.1.1) restored service in <2 min once the regression was identified.

## DSM 7 entry.cgi silently drops multipart fields unless the boundary is browser-shaped

### Lesson

Synology DSM 7's `entry.cgi` multipart parser reads **zero** form fields when the `multipart/form-data` boundary doesn't look like a browser's (`----WebKitFormBoundary…` / `----geckoformboundary…`). It doesn't error on the boundary — it just sees an empty field set, so you get a misleading `error 119` (SID not found, because `_sid` "wasn't sent") and then `error 120` (`{name: type, reason: required}`). Bun's built-in `FormData`, curl `-F`, and Python `requests` all emit a generic boundary and hit this. Two more entry.cgi quirks compound it: `_sid` must travel in the **query string** (it's ignored in the body), and the non-file calls want their params in the query too.

### Background

2026-06-02: every DownloadStation2 `.torrent` add and the per-file inspect (#123) had **never worked** in production — the owner saw "Не удалось прочитать список файлов" then a bare `HTTP 502`. The original code built the request with Bun's `FormData` (generic boundary, every param including `_sid` in the body). A live-NAS probe walked it down: `_sid` in body → 119; `_sid` in query, params in body → `120 type required`; params in query → `101`; cookie-jar + body params → still `120`. Only when the body was rebuilt by hand with a `----WebKitFormBoundary…` boundary did the identical payload return `success: true` + a `list_id`. The fix (`buildBrowserMultipart` + `_sid` in the query + `file=["torrent"]` naming a `torrent` part) lives in `src/infra/synology/client.ts`. The `synology-api` Python library carries a `generate_gecko_boundary()` helper for exactly this reason — a strong tell once found.

### How to apply

- For any Synology `entry.cgi` file upload (DownloadStation2, FileStation), do NOT use a stock multipart encoder — emit a browser-shaped boundary and put `_sid` in the query.
- A Synology `119`/`120` on a multipart POST that *looks* correct → suspect the boundary before the payload. Confirm by diffing a raw browser-shaped body against the library body.
- When a vendor library ships a suspiciously specific helper (`generate_gecko_boundary`), treat it as documentation of an undocumented server quirk and replicate it.
- Don't reverse-engineer an undocumented API by trial-and-error — read the vendor's own client. The DS2 selective-download commit was guessed FOUR times against the live NAS (`BT.File`+`Complete` with `list_id`; `Task.List.Polling/download` with `file_indexes`; `Complete start {id}`) — each created tasks that 404'd, hung at the start, or never appeared. The authoritative spec is the **DSM web UI's own JavaScript on the NAS** — `/var/packages/DownloadStation/target/ui/download.js`, readable over SSH as `nas-bot` with no auth. Copy it verbatim: the create dialog's `sendWebAPIForSpecificList` calls `SYNO.DownloadStation2.Task.List.Polling` `download` v2 with `{list_id, destination, create_subfolder, selected:[…]}`, where `selected` (param NAME) is the array of file indices to download (those with `enable===true`). Not `file_indexes`. `Task.Complete start {id}` is a DIFFERENT path (finishing already-queued tasks), which is why it created nothing. The server `.lib` files (`/var/packages/DownloadStation/target/webapi/SYNO.DownloadStation2.Task.lib`) list the methods+versions but NOT the params (those are in the `.so`); the params only live in the UI JS. For any undocumented Synology API: read `download.js` first, don't probe.

## A null DownloadStation default_destination accepts API task creation but never starts it

### Lesson

When DownloadStation's global `default_destination` is `null` (unset), DSM **accepts every API `create` call** — it returns `task_id`, `success: true` — but the task never leaves `waiting` and its size stays `0`. No error is surfaced to the caller. The correct first step when API task creation succeeds yet tasks never start is to check engine/server config (destination, task limits, free space) before changing the request method.

### Background

2026-06-03: A ~2-day "downloads never start" hunt (#154) churned through six different add methods — DS1 `uri`, DS2 `type:url`, self-hosted `.torrent` URL, Telegram-hosted URL, `create_list=false`, `create_list=true` — each with its own workaround PR. All returned `success: true`. None started a task. After bisecting the call stack down to a bare `curl` that replicated DSM's own web-UI request, still no download appeared. Inspecting `getserverconfig` revealed `default_destination: null`. Setting it once via `setserverconfig` to `video` unblocked all pending tasks immediately, including ones submitted by earlier broken code. The bot's pre-existing, never-changed `createDownloadTask` then worked on the first try with no other modifications.

Fix: `SynologyClient.ensureDefaultDestination()` — called once at startup, reads `getserverconfig`, and if the field is empty calls `setserverconfig` with the first available share. This self-heals the condition so it can never silently stall future deploys.

### How to apply

- When API task creation returns success but tasks never appear or always stay `waiting` with `size=0` — run `getserverconfig` against the DownloadStation API and check `default_destination`. If empty, set it with `setserverconfig` before any other debugging.
- Treat engine-level config the application depends on as a startup precondition. For any config your app writes or relies on: read it at boot, validate it, and self-heal if missing. Don't assume it was set by a human at deploy time.
- Rotating through request methods (DS1 vs DS2, URL vs file upload, different endpoints) when the symptom is tasks-not-starting is a red herring. The add method is not in the call stack for "task never leaves waiting". Check the receiving end's config first.
- Prefer a startup self-heal over documentation-only: config drift is invisible and the DSM web UI may reset fields on package reinstall or version upgrade.
