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
