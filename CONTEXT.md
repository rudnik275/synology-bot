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

**Subscription**:
A TV show the owner is tracking for new episodes. Stored in persistent state; metadata from myshows.me. The backend checks subscriptions daily and notifies when an episode airs today. Download is **not** automated — the owner triggers it through the Add flow.
_Avoid:_ Show, tracked show, watchlist item

**Owner**:
The sole user with access. Identified by Telegram user ID, checked against `OWNER_CHAT_ID`. Everyone else receives a rejection. The system is single-user by design.
_Avoid:_ User, admin, allowed user

## Mini App IA

Three bottom tabs — **Downloads / NAS / Shows** (default: Downloads). Every screen shows an ambient **health-chip** in the header (green/amber/red dot + one metric) that taps through to the NAS tab.

**Add flow** — adding a download (ADR 0008). In the Mini App it is **search-only**: FAB → wizard → Toloka search → folder-picker → confirm. `.torrent` files, magnet links, and direct URLs are not pasted in-app; they are sent to the **bot chat**, which stashes them and deep-links the Mini App into the wizard at the folder step (Folder → Confirm). The bot is otherwise push-only; this stash-and-handoff is its sole intake role and it never creates tasks itself.

Design system: ADR 0006 ([`docs/adr/0006-mini-app-design-system-neo-brutalism.md`](./docs/adr/0006-mini-app-design-system-neo-brutalism.md)) — Neo-Brutalism, single light mode, Space Grotesk, hard offset shadows, first-class motion.

## Frontend state architecture

State is managed through **composables** (`useApi`, `useHealth`, `useTasks`, `useSubscriptions`). **Pinia is not used** — this is a single-user mini-app; an extra state-management dependency was not warranted. Each composable owns its reactive state and exposes actions; components import composables directly.

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

## Domain boundary

The backend lives at the moment of an **active task** and an **active NAS**. Once a file lands in the destination folder — what happens next (Plex, Jellyfin, manual viewing) is out of scope. Once the NAS goes offline longer than N minutes — the backend can only signal "unreachable" but not attempt self-repair.

## Engineering lessons

Captured incidents and the lessons they produced live in [`docs/lessons-learned.md`](./docs/lessons-learned.md).
