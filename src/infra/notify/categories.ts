/**
 * Notification categories — each maps to one private-chat forum topic.
 *
 * The set is fixed at design time. Adding a category requires a code change
 * AND the bot will create the matching topic on the next startup.
 *
 * Topic names face the Owner in their Telegram client, so they're Russian
 * to match the rest of the bot's user-facing copy.
 *
 * Icon colors must be one of the six allowed RGB values per Bot API:
 * 0x6FB9F0 (blue), 0xFFD67E (yellow), 0xCB86DB (purple),
 * 0x8EEE98 (green), 0xFF93B2 (pink), 0xFB6F5F (red).
 */

export type Category = 'torrents' | 'health' | 'deploy' | 'subscriptions'

export type TopicIconColor =
  | 0x6FB9F0
  | 0xFFD67E
  | 0xCB86DB
  | 0x8EEE98
  | 0xFF93B2
  | 0xFB6F5F

export interface CategoryDef {
  key: Category
  name: string
  iconColor: TopicIconColor
}

export const CATEGORIES: readonly CategoryDef[] = [
  { key: 'torrents', name: 'Торренты', iconColor: 0xCB86DB },
  { key: 'health', name: 'Состояние NAS', iconColor: 0xFFD67E },
  { key: 'deploy', name: 'Деплой', iconColor: 0xFB6F5F },
  { key: 'subscriptions', name: 'Подписки', iconColor: 0x6FB9F0 },
]
