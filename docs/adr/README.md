# Architecture Decision Records

Короткие записи решений, которые будущий читатель (включая AI-агента) иначе будет re-litigate. Формат — в [`~/.claude/skills/grill-with-docs/ADR-FORMAT.md`](../../../.claude/skills/grill-with-docs/ADR-FORMAT.md).

## When to add a new ADR

Все три должны быть true:

1. **Hard to reverse** — цена изменения позже значима.
2. **Surprising without context** — будущий читатель спросит «почему так?»
3. **Real trade-off** — были реальные альтернативы.

Если хоть один пункт отсутствует — пропускаем ADR.

## Index

| # | Title |
|---|---|
| [0001](./0001-owner-only-single-user.md) | Owner-only single-user bot |
| [0002](./0002-telegram-bot-primary-surface.md) | Telegram Bot as primary surface; Mini App / PWA deferred |
| [0003](./0003-in-flight-only-domain-boundary.md) | Domain boundary — in-flight downloads, not a library |
| [0004](./0004-topics-and-centralized-notifier.md) | Centralized OwnerNotifier; per-category private-chat forum topics _(topics superseded by 0005)_ |
| [0005](./0005-mini-app-for-pull-thin-bot-for-push.md) | Mini App for management (pull), thin bot for notifications (push) |
| [0006](./0006-mini-app-design-system-neo-brutalism.md) | Mini App design system — Neo-Brutalism, single light mode, jobs-first IA |
| [0007](./0007-cloudflared-runtime-topology-and-deploy-resilience.md) | cloudflared in the bot's netns + Watchtower depends-on (tunnel survives deploys) |
| [0008](./0008-add-intake-search-only-app-bot-handoff.md) | Add intake — Mini App search-only; bot chat hands off .torrent + magnet/URL |
| [0009](./0009-shows-tab-search-first-detail-page.md) | Shows tab — search-first, Show detail page, detail-only subscribe, in-app today dropped |
| [0010](./0010-cloudflared-shared-network-tunnel-survives-deploys.md) | cloudflared on a shared Docker network (tunnel survives bot redeploys; supersedes 0007) |
| [0011](./0011-ui-history-server-side-not-cloudstorage.md) | Mini App UI history server-side (SQLite kv), not Telegram CloudStorage |
| [0012](./0012-per-file-selective-download-optimistic-insert.md) | Per-file selective download + optimistic insert |
