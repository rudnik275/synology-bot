import { describe, it, expect, beforeEach } from 'bun:test'
import { AutoCleaner } from '../../../src/domain/auto-cleaner.ts'
import type { AutoCleanerDeps } from '../../../src/domain/auto-cleaner.ts'

// ---- Helpers ----

const DAY_MS = 24 * 60 * 60 * 1000
const NOW = 1_000_000_000_000 // fixed reference time

function makeHarness(opts: {
  retentionDays?: number
  completions?: Array<{ taskId: string; completedAt: number }>
  deleteError?: string
} = {}): {
  cleaner: AutoCleaner
  deleted: string[]
  removed: string[]
  notifications: string[]
  completions: Array<{ taskId: string; completedAt: number }>
  deleteError: string | undefined
} {
  const retentionDays = opts.retentionDays ?? 7
  const completions: Array<{ taskId: string; completedAt: number }> = opts.completions ?? []
  const deleted: string[] = []
  const removed: string[] = []
  const notifications: string[] = []
  let deleteError: string | undefined = opts.deleteError

  const deps: AutoCleanerDeps = {
    getCompleted: async (cutoffMs: number) => {
      return completions
        .filter((c) => c.completedAt < cutoffMs)
        .map((c) => c.taskId)
    },
    deleteTask: async (taskId: string) => {
      if (deleteError) {
        return { ok: false, reason: deleteError }
      }
      deleted.push(taskId)
      return { ok: true }
    },
    removeCompletion: async (taskId: string) => {
      removed.push(taskId)
    },
    notify: async (message: string) => {
      notifications.push(message)
    },
    retentionDays,
    now: () => NOW,
  }

  const cleaner = new AutoCleaner(deps)

  return { cleaner, deleted, removed, notifications, completions, deleteError: opts.deleteError }
}

// ---- Tests ----

describe('AutoCleaner', () => {
  describe('no completions older than retention', () => {
    it('→ no deletes, no push', async () => {
      const h = makeHarness({
        completions: [
          { taskId: 'task-1', completedAt: NOW - 6 * DAY_MS }, // 6 days ago — within retention
          { taskId: 'task-2', completedAt: NOW - 1 * DAY_MS }, // 1 day ago
        ],
      })

      await h.cleaner.cleanup()

      expect(h.deleted).toHaveLength(0)
      expect(h.removed).toHaveLength(0)
      expect(h.notifications).toHaveLength(0)
    })
  })

  describe('1 completion 8 days old', () => {
    it('→ 1 delete, 1 removeCompletion, 1 push (first batch)', async () => {
      const h = makeHarness({
        completions: [
          { taskId: 'task-old', completedAt: NOW - 8 * DAY_MS }, // 8 days ago — past retention
        ],
      })

      await h.cleaner.cleanup()

      expect(h.deleted).toEqual(['task-old'])
      expect(h.removed).toEqual(['task-old'])
      expect(h.notifications).toHaveLength(1)
      expect(h.notifications[0]).toContain('1')
    })
  })

  describe('3 completions older than retention', () => {
    it('→ 3 deletes, 3 removeCompletion, 1 push with N=3', async () => {
      const h = makeHarness({
        completions: [
          { taskId: 'task-a', completedAt: NOW - 10 * DAY_MS },
          { taskId: 'task-b', completedAt: NOW - 9 * DAY_MS },
          { taskId: 'task-c', completedAt: NOW - 8 * DAY_MS },
        ],
      })

      await h.cleaner.cleanup()

      expect(h.deleted).toHaveLength(3)
      expect(h.deleted).toContain('task-a')
      expect(h.deleted).toContain('task-b')
      expect(h.deleted).toContain('task-c')
      expect(h.removed).toHaveLength(3)
      expect(h.notifications).toHaveLength(1)
      expect(h.notifications[0]).toContain('3')
    })
  })

  describe('second tick after successful clean', () => {
    it('→ more old completions deleted but NO additional push', async () => {
      const completions: Array<{ taskId: string; completedAt: number }> = [
        { taskId: 'task-first', completedAt: NOW - 8 * DAY_MS },
      ]

      const deleted: string[] = []
      const removed: string[] = []
      const notifications: string[] = []

      const deps: AutoCleanerDeps = {
        getCompleted: async (cutoffMs: number) => {
          return completions
            .filter((c) => c.completedAt < cutoffMs)
            .map((c) => c.taskId)
        },
        deleteTask: async (taskId: string) => {
          deleted.push(taskId)
          return { ok: true }
        },
        removeCompletion: async (taskId: string) => {
          const idx = completions.findIndex((c) => c.taskId === taskId)
          if (idx !== -1) completions.splice(idx, 1)
          removed.push(taskId)
        },
        notify: async (msg: string) => { notifications.push(msg) },
        retentionDays: 7,
        now: () => NOW,
      }

      const cleaner = new AutoCleaner(deps)

      // First tick — should clean task-first and push
      await cleaner.cleanup()
      expect(notifications).toHaveLength(1)
      expect(deleted).toContain('task-first')

      // Add another old task
      completions.push({ taskId: 'task-second', completedAt: NOW - 9 * DAY_MS })

      // Second tick — should delete task-second but NOT push again
      await cleaner.cleanup()
      expect(deleted).toContain('task-second')
      // Still only 1 notification total
      expect(notifications).toHaveLength(1)
    })
  })

  describe('Synology delete fails', () => {
    it('→ no removeCompletion, no push (retry next tick)', async () => {
      const h = makeHarness({
        completions: [
          { taskId: 'task-fail', completedAt: NOW - 8 * DAY_MS },
        ],
        deleteError: 'Synology error code 500',
      })

      await h.cleaner.cleanup()

      expect(h.deleted).toHaveLength(0)
      expect(h.removed).toHaveLength(0)
      expect(h.notifications).toHaveLength(0)
    })
  })

  describe('completion exactly at retention boundary', () => {
    it('→ NOT deleted (must be strictly older)', async () => {
      const retentionDays = 7
      // completedAt === NOW - 7*DAY_MS (exactly at boundary, not strictly older)
      const h = makeHarness({
        retentionDays,
        completions: [
          { taskId: 'task-boundary', completedAt: NOW - retentionDays * DAY_MS },
        ],
      })

      await h.cleaner.cleanup()

      expect(h.deleted).toHaveLength(0)
      expect(h.removed).toHaveLength(0)
      expect(h.notifications).toHaveLength(0)
    })
  })

  describe('mixed: some old, some fresh', () => {
    it('only old ones deleted, fresh ones untouched', async () => {
      const h = makeHarness({
        completions: [
          { taskId: 'task-old-1', completedAt: NOW - 10 * DAY_MS },
          { taskId: 'task-fresh-1', completedAt: NOW - 3 * DAY_MS },
          { taskId: 'task-old-2', completedAt: NOW - 8 * DAY_MS },
          { taskId: 'task-fresh-2', completedAt: NOW - 1 * DAY_MS },
        ],
      })

      await h.cleaner.cleanup()

      expect(h.deleted).toHaveLength(2)
      expect(h.deleted).toContain('task-old-1')
      expect(h.deleted).toContain('task-old-2')
      expect(h.deleted).not.toContain('task-fresh-1')
      expect(h.deleted).not.toContain('task-fresh-2')
    })
  })

  describe('notification message format', () => {
    it('contains broom emoji and task count', async () => {
      const h = makeHarness({
        completions: [
          { taskId: 'task-1', completedAt: NOW - 8 * DAY_MS },
          { taskId: 'task-2', completedAt: NOW - 9 * DAY_MS },
        ],
      })

      await h.cleaner.cleanup()

      expect(h.notifications).toHaveLength(1)
      const msg = h.notifications[0]
      expect(msg).toContain('🧹')
      expect(msg).toContain('2')
    })
  })

  describe('pure function: uses injected now() for deterministic boundaries', () => {
    it('uses now() from deps, not system time', async () => {
      const customNow = 2_000_000_000_000 // far future
      const deleted: string[] = []
      const notifications: string[] = []

      const deps: AutoCleanerDeps = {
        getCompleted: async (cutoffMs: number) => {
          // Return task only if cutoff is based on customNow - 7 days
          const expectedCutoff = customNow - 7 * DAY_MS
          if (Math.abs(cutoffMs - expectedCutoff) < 1000) {
            return ['task-x']
          }
          return []
        },
        deleteTask: async (taskId: string) => { deleted.push(taskId); return { ok: true } },
        removeCompletion: async () => {},
        notify: async (msg) => { notifications.push(msg) },
        retentionDays: 7,
        now: () => customNow,
      }

      const cleaner = new AutoCleaner(deps)
      await cleaner.cleanup()

      expect(deleted).toContain('task-x')
      expect(notifications).toHaveLength(1)
    })
  })
})
