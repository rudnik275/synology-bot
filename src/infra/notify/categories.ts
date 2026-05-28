/**
 * Notification categories — a semantic label on each owner-bound message
 * ('torrents', 'health', 'deploy', 'subscriptions'). Used for log context;
 * no longer routes to forum topics (see ADR 0005, superseding ADR 0004).
 */

export type Category = 'torrents' | 'health' | 'deploy' | 'subscriptions'
