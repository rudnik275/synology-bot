import { describe, it, expect } from 'bun:test'
import { formatDashboard } from '../../../../src/domain/dashboard-formatter.ts'
import type { Task } from '../../../../src/infra/synology/types.ts'

function makeTask(overrides: Partial<Task> & { id: string; status: Task['status'] }): Task {
  return {
    id: overrides.id,
    title: overrides.title ?? `Task ${overrides.id}`,
    status: overrides.status,
    size: overrides.size ?? 0,
    additional: overrides.additional,
  }
}

describe('formatDashboard', () => {
  // ─── Empty state ─────────────────────────────────────────────────────────────
  it('empty list → нет активных задач', () => {
    const result = formatDashboard([])
    expect(result.text).toBe('📊 Нет активных задач')
    expect(result.keyboard).toHaveLength(0)
  })

  // ─── Single downloading task ──────────────────────────────────────────────────
  it('one downloading task → correct progress line', () => {
    const task = makeTask({
      id: 't1',
      title: 'Big.Buck.Bunny.2008.mkv',
      status: 'downloading',
      size: 3_221_225_472, // 3.0 GB
      additional: {
        transfer: {
          size_downloaded: 1_503_238_553, // ~1.4 GB
          speed_download: 14_891_827, // ~14.2 MB/s
        },
      },
    })

    const result = formatDashboard([task])
    expect(result.text).toContain('⬇️ Big.Buck.Bunny.2008.mkv')
    expect(result.text).toMatch(/4[67]%/) // ~46-47% depending on rounding
    expect(result.text).toContain('MB/s')
    expect(result.text).toContain('GB')
    expect(result.text).toContain('📊 Активные задачи (1)')
  })

  // ─── Single paused task ───────────────────────────────────────────────────────
  it('paused task → shows paused status and sizes', () => {
    const task = makeTask({
      id: 't2',
      title: 'Some.Other.Show',
      status: 'paused',
      size: 734_003_200, // 700 MB
      additional: {
        transfer: {
          size_downloaded: 0,
          speed_download: 0,
        },
      },
    })

    const result = formatDashboard([task])
    expect(result.text).toContain('⏸ Some.Other.Show')
    expect(result.text).toContain('приостановлено')
    expect(result.text).toContain('0 B')
  })

  // ─── Mixed statuses ───────────────────────────────────────────────────────────
  it('mixed paused/downloading/seeding → all rows present with correct icons', () => {
    const tasks = [
      makeTask({ id: 't1', status: 'downloading', size: 1_000_000, additional: { transfer: { size_downloaded: 500_000, speed_download: 1024 } } }),
      makeTask({ id: 't2', status: 'paused', size: 2_000_000, additional: { transfer: { size_downloaded: 1_000_000, speed_download: 0 } } }),
      makeTask({ id: 't3', status: 'seeding', size: 3_000_000 }),
    ]

    const result = formatDashboard(tasks)
    expect(result.text).toContain('⬇️')
    expect(result.text).toContain('⏸')
    expect(result.text).toContain('✅')
    expect(result.text).toContain('📊 Активные задачи (3)')
  })

  // ─── 25 task truncation ───────────────────────────────────────────────────────
  it('25 tasks → shows first 20, appends ...и ещё 5', () => {
    const tasks = Array.from({ length: 25 }, (_, i) =>
      makeTask({ id: `t${i}`, status: 'downloading', size: 1_000_000, additional: { transfer: { size_downloaded: 0, speed_download: 0 } } })
    )

    const result = formatDashboard(tasks)
    expect(result.keyboard).toHaveLength(20)
    expect(result.text).toContain('...и ещё 5')
    expect(result.text).toContain('📊 Активные задачи (25)')
  })

  // ─── Keyboard structure ───────────────────────────────────────────────────────
  it('downloading task → keyboard has pause and delete buttons', () => {
    const task = makeTask({ id: 'task-dl', status: 'downloading', size: 1_000_000, additional: { transfer: { size_downloaded: 0, speed_download: 0 } } })

    const result = formatDashboard([task])
    const row = result.keyboard[0]
    expect(row).toBeDefined()
    const pauseBtn = row.find((b) => b.callback_data === 'dash_action:pause:task-dl')
    const deleteBtn = row.find((b) => b.callback_data === 'dash_action:delete:task-dl')
    expect(pauseBtn).toBeDefined()
    expect(pauseBtn?.text).toBe('⏸')
    expect(deleteBtn).toBeDefined()
    expect(deleteBtn?.text).toBe('🗑')
  })

  it('paused task → keyboard has resume and delete buttons (no pause)', () => {
    const task = makeTask({ id: 'task-p', status: 'paused', size: 1_000_000 })

    const result = formatDashboard([task])
    const row = result.keyboard[0]
    const resumeBtn = row.find((b) => b.callback_data === 'dash_action:resume:task-p')
    const pauseBtn = row.find((b) => b.callback_data === 'dash_action:pause:task-p')
    const deleteBtn = row.find((b) => b.callback_data === 'dash_action:delete:task-p')
    expect(resumeBtn).toBeDefined()
    expect(resumeBtn?.text).toBe('▶️')
    expect(pauseBtn).toBeUndefined()
    expect(deleteBtn).toBeDefined()
  })

  it('finished task → keyboard has only delete button (no pause/resume)', () => {
    const task = makeTask({ id: 'task-f', status: 'finished', size: 1_000_000 })

    const result = formatDashboard([task])
    const row = result.keyboard[0]
    const deleteBtn = row.find((b) => b.callback_data === 'dash_action:delete:task-f')
    const pauseBtn = row.find((b) => b.callback_data?.startsWith('dash_action:pause'))
    const resumeBtn = row.find((b) => b.callback_data?.startsWith('dash_action:resume'))
    expect(deleteBtn).toBeDefined()
    expect(pauseBtn).toBeUndefined()
    expect(resumeBtn).toBeUndefined()
  })

  // ─── Title truncation ─────────────────────────────────────────────────────────
  it('title > 30 chars is truncated with ellipsis', () => {
    const longTitle = 'A'.repeat(35)
    const task = makeTask({ id: 't', status: 'paused', title: longTitle })

    const result = formatDashboard([task])
    const lines = result.text.split('\n')
    const titleLine = lines.find((l) => l.includes('⏸'))!
    expect(titleLine.length).toBeLessThan(35 + 5) // icon + space + 30 chars + ellipsis
    expect(titleLine).toContain('…')
  })

  it('title with unicode chars truncates correctly (no broken codepoints)', () => {
    // 35 emoji = 35 grapheme clusters, each codepoint is a surrogate pair in UTF-16
    // [...str] iterates by codepoint so 35 codepoints > TITLE_MAX_CHARS (30) → truncated
    const unicodeTitle = '🎬'.repeat(35)
    const task = makeTask({ id: 't', status: 'paused', title: unicodeTitle })

    const result = formatDashboard([task])
    expect(result.text).toContain('⏸')
    // Should not throw, and should contain ellipsis since > 30 emoji
    expect(result.text).toContain('…')
  })

  // ─── Stopped state ────────────────────────────────────────────────────────────

  it('stopped=false (default) returns normal output without footer', () => {
    const task = makeTask({ id: 't1', status: 'paused', size: 1_000_000 })
    const normal = formatDashboard([task])
    const explicit = formatDashboard([task], { stopped: false })

    expect(normal.text).toBe(explicit.text)
    expect(normal.keyboard).toEqual(explicit.keyboard)
    expect(normal.text).not.toContain('обновление остановлено')
  })

  it('stopped=true with tasks → appends stopped footer and single refresh button', () => {
    const task = makeTask({ id: 't1', status: 'downloading', size: 1_000_000, additional: { transfer: { size_downloaded: 0, speed_download: 0 } } })
    const result = formatDashboard([task], { stopped: true })

    expect(result.text).toContain('обновление остановлено')
    expect(result.text).toContain('Активные задачи')
    expect(result.keyboard).toHaveLength(1)
    expect(result.keyboard[0]).toHaveLength(1)
    expect(result.keyboard[0][0].callback_data).toBe('dash_refresh')
    expect(result.keyboard[0][0].text).toBe('🔄 Обновить')
  })

  it('stopped=true with empty list → stopped footer and single refresh button', () => {
    const result = formatDashboard([], { stopped: true })

    expect(result.text).toContain('обновление остановлено')
    expect(result.text).toContain('Нет активных задач')
    expect(result.keyboard).toHaveLength(1)
    expect(result.keyboard[0][0].callback_data).toBe('dash_refresh')
  })

  it('stopped=true preserves task list text but replaces per-task keyboard rows', () => {
    const tasks = [
      makeTask({ id: 't1', status: 'downloading', size: 1_000_000, additional: { transfer: { size_downloaded: 0, speed_download: 0 } } }),
      makeTask({ id: 't2', status: 'paused', size: 2_000_000 }),
    ]
    const result = formatDashboard(tasks, { stopped: true })

    // Task rows still visible
    expect(result.text).toContain('Task t1')
    expect(result.text).toContain('Task t2')
    // But no per-task action buttons — only the single refresh button
    const allCallbackData = result.keyboard.flat().map((b) => b.callback_data)
    expect(allCallbackData).not.toContain('dash_action:pause:t1')
    expect(allCallbackData).toContain('dash_refresh')
    expect(result.keyboard).toHaveLength(1)
  })
})
