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
