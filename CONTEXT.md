# synology-bot

Owner-only Telegram-based NAS tool. Two surfaces:

1. **Telegram Mini App** (pull) — rich UI for browsing and managing everything. Stack: Hono (Bun) + Vue 3 + Vite, served as a static SPA on a loopback port, reached in production via a Cloudflare Tunnel. Auth: Telegram `initData` HMAC-SHA256, owner-only.
2. **Thin notifier bot** (push) — owner DM alerts only. Pushes carry an **Открыть** deep-link button and the bot exposes a chat menu button (`MINIAPP_URL` env) that opens the Mini App directly.

Architecture split rationale: ADR 0005 ([`docs/adr/0005-mini-app-for-pull-thin-bot-for-push.md`](./docs/adr/0005-mini-app-for-pull-thin-bot-for-push.md)).

## Language

**Download Task**:
Active download unit in Synology DownloadStation. Created through the Add flow — either from a Toloka **search** result chosen in the Mini App, or from a `.torrent` file / magnet link / direct URL handed off via the bot chat (ADR 0008). Lives in Synology until completion or deletion. The backend only observes and edits it (pause/resume/delete) — it does not store task state locally. Completed tasks are auto-cleaned after the retention window.
_Avoid:_ Download, torrent, job, item

**NAS Health**:
System state of the NAS itself (not tasks): disk usage, temperatures, service status, uptime. The backend polls Synology via system APIs and alerts the owner when thresholds are exceeded or a service goes down. Available on-demand via the NAS tab in the Mini App and via `/health` bot command.
_Avoid:_ NAS status, system info, health check

**Show**:
A myshows.me catalog entity — title, poster, seasons, and episodes with air dates. Searched for and viewed independently of whether the owner tracks it. We don't own it: it's referenced by myshows id and its metadata is fetched on demand (a **Subscription** may cache a slice of it). Every **Subscription** is *of* a Show; a Show needs no Subscription to exist.
_Avoid:_ Series, title, movie

**Subscription**:
The owner's tracking relationship to a **Show** — created by *subscribing*, removed by *unsubscribing*. Stored in persistent state. The backend checks subscriptions daily and notifies when an episode airs today. Download is **not** automated — the owner triggers it through the Add flow.
_Avoid:_ Tracked show, watchlist item

**Owner**:
The sole user with access. Identified by Telegram user ID, checked against `OWNER_CHAT_ID`. Everyone else receives a rejection. The system is single-user by design.
_Avoid:_ User, admin, allowed user

## Mini App IA

Three bottom tabs — **Downloads / NAS / Shows** (default: Downloads). Every screen shows an ambient **health-chip** in the header (green/amber/red dot + one metric) that taps through to the NAS tab.

**Add flow** — adding a download (ADR 0008). In the Mini App it is **search-only**: FAB → wizard → Toloka search → folder-picker → confirm. `.torrent` files, magnet links, and direct URLs are not pasted in-app; they are sent to the **bot chat**, which stashes them and deep-links the Mini App into the wizard at the folder step (Folder → Confirm). The bot is otherwise push-only; this stash-and-handoff is its sole intake role and it never creates tasks itself. The confirm step **auto-inspects** the torrent and renders a **file tree for per-file selection** (#123, ADR 0012): the owner ticks individual files before adding; the whole-torrent path remains the default for magnets (which cannot be inspected before download). Tapping «Добавить» is **optimistic** — a placeholder card appears immediately in the Downloads list, and the real task id is reconciled in the background on the next poll (#155, ADR 0012).

**Shows tab** — search-first. One query-driven list: an empty query shows the owner's **Subscriptions**; typing searches the myshows **Show** catalog. Lists carry status only — subscription rows show a latest-aired-episode badge, search rows a *Subscribed* marker — and tapping any row opens the **Show detail** page (poster, Russian title + original, description, a season accordion of aired/upcoming episodes with air dates). **Subscribe/unsubscribe happens only on the detail page**, never inline in a list. There is no in-app "aired today" block; same-day airings are delivered solely by the daily push.

Design system: ADR 0006 ([`docs/adr/0006-mini-app-design-system-neo-brutalism.md`](./docs/adr/0006-mini-app-design-system-neo-brutalism.md)) — Neo-Brutalism, single light mode, Space Grotesk, hard offset shadows, first-class motion.

## Frontend state architecture

State is managed through **composables** (`useApi`, `useHealth`, `useTasks`, `useSubscriptions`, `useInspectCommit`). **Pinia is not used** — this is a single-user mini-app; an extra state-management dependency was not warranted. Each composable owns its reactive state and exposes actions; components import composables directly. `useInspectCommit` owns the add-flow inspect→commit state machine (stale-run guard + fast-tap chained commit) behind a small interface, keeping `AddFlow.vue` focused on the sheet/step lifecycle and source modes.

## Architecture decisions

| ADR | Decision |
|-----|----------|
| [0001](./docs/adr/0001-owner-only-single-user.md) | Owner-only single-user |
| [0002](./docs/adr/0002-telegram-bot-primary-surface.md) | Bot as primary surface (superseded by 0005 for management UI) |
| [0003](./docs/adr/0003-in-flight-only-domain-boundary.md) | Domain boundary — in-flight downloads only |
| [0004](./docs/adr/0004-topics-and-centralized-notifier.md) | Centralized OwnerNotifier (topics superseded by 0005) |
| [0005](./docs/adr/0005-mini-app-for-pull-thin-bot-for-push.md) | Mini App for management (pull), thin bot for notifications (push) |
| [0006](./docs/adr/0006-mini-app-design-system-neo-brutalism.md) | Mini App design system — Neo-Brutalism, jobs-first IA |
| [0008](./docs/adr/0008-add-intake-search-only-app-bot-handoff.md) | Add intake — Mini App search-only; bot hands off .torrent + magnet/URL |
| [0009](./docs/adr/0009-shows-tab-search-first-detail-page.md) | Shows tab — search-first, Show detail page, detail-only subscribe, in-app today dropped |
| [0011](./docs/adr/0011-ui-history-server-side-not-cloudstorage.md) | Mini App UI history (recent searches/folders) stored server-side, not Telegram CloudStorage |
| [0012](./docs/adr/0012-per-file-selective-download-optimistic-insert.md) | Per-file selective download (DS2 create_list→list→download) + optimistic insert |

## Domain boundary

The backend lives at the moment of an **active task** and an **active NAS**. Once a file lands in the destination folder — what happens next (Plex, Jellyfin, manual viewing) is out of scope. Once the NAS goes offline longer than N minutes — the backend can only signal "unreachable" but not attempt self-repair.

## Engineering lessons

Captured incidents and the lessons they produced live in [`docs/lessons-learned.md`](./docs/lessons-learned.md).
