import type { Task } from '../infra/synology/types.ts'
import type { InlineKeyboardButton as GrammyIKBtn } from 'grammy/types'

type CallbackButton = GrammyIKBtn.CallbackButton

const MAX_TASKS = 20
const TITLE_MAX_CHARS = 30

// ─── Helpers ─────────────────────────────────────────────────────────────────

function truncateTitle(title: string): string {
  if ([...title].length <= TITLE_MAX_CHARS) return title
  return [...title].slice(0, TITLE_MAX_CHARS - 1).join('') + '…'
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`
  if (bytes >= 1_024) return `${(bytes / 1_024).toFixed(1)} KB`
  return `${bytes} B`
}

function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec >= 1_048_576) return `${(bytesPerSec / 1_048_576).toFixed(1)} MB/s`
  if (bytesPerSec >= 1_024) return `${(bytesPerSec / 1_024).toFixed(1)} KB/s`
  return `${bytesPerSec} B/s`
}

function statusIcon(status: Task['status']): string {
  switch (status) {
    case 'downloading': return '⬇️'
    case 'paused': return '⏸'
    case 'finished':
    case 'seeding': return '✅'
    case 'error': return '❌'
    case 'waiting':
    case 'filehosting_waiting': return '⏳'
    case 'finishing':
    case 'hash_checking':
    case 'extracting': return '⚙️'
    default: return '❓'
  }
}

function formatTaskRow(task: Task): string {
  const icon = statusIcon(task.status)
  const title = truncateTitle(task.title)
  const downloaded = task.additional?.transfer?.size_downloaded ?? 0
  const speed = task.additional?.transfer?.speed_download ?? 0
  const total = task.size

  const header = `${icon} ${title}`

  if (task.status === 'paused') {
    const dl = formatBytes(downloaded)
    const tot = total > 0 ? formatBytes(total) : '?'
    return `${header}\n└ приостановлено • ${dl} / ${tot}`
  }

  if (task.status === 'downloading') {
    const pct = total > 0 ? Math.round((downloaded / total) * 100) : 0
    const dlStr = formatBytes(downloaded)
    const totStr = total > 0 ? formatBytes(total) : '?'
    const speedStr = formatSpeed(speed)
    return `${header}\n└ ${pct}% • ${speedStr} • ${dlStr} / ${totStr}`
  }

  if (task.status === 'finished' || task.status === 'seeding') {
    const totStr = total > 0 ? formatBytes(total) : '?'
    return `${header}\n└ ${totStr}`
  }

  // Generic fallback for other statuses
  const dl = formatBytes(downloaded)
  const tot = total > 0 ? formatBytes(total) : '?'
  return `${header}\n└ ${dl} / ${tot}`
}

function taskKeyboardRow(task: Task): CallbackButton[] {
  const row: CallbackButton[] = []

  if (task.status === 'downloading') {
    row.push({ text: '⏸', callback_data: `dash_action:pause:${task.id}` })
  } else if (task.status === 'paused') {
    row.push({ text: '▶️', callback_data: `dash_action:resume:${task.id}` })
  }

  row.push({ text: '🗑', callback_data: `dash_action:delete:${task.id}` })

  return row
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface DashboardRender {
  text: string
  keyboard: CallbackButton[][]
}

export interface FormatDashboardOptions {
  stopped?: boolean
}

const STOPPED_FOOTER = '\n\nобновление остановлено'
const REFRESH_BUTTON: CallbackButton = { text: '🔄 Обновить', callback_data: 'dash_refresh' }

export function formatDashboard(tasks: Task[], options: FormatDashboardOptions = {}): DashboardRender {
  const { stopped = false } = options

  if (tasks.length === 0) {
    const text = stopped ? `📊 Нет активных задач${STOPPED_FOOTER}` : '📊 Нет активных задач'
    const keyboard: CallbackButton[][] = stopped ? [[REFRESH_BUTTON]] : []
    return { text, keyboard }
  }

  const visible = tasks.slice(0, MAX_TASKS)
  const overflow = tasks.length - MAX_TASKS

  const header = `📊 Активные задачи (${tasks.length})`
  const rows = visible.map(formatTaskRow)
  const body = overflow > 0
    ? [...rows, `...и ещё ${overflow}`]
    : rows

  const baseText = [header, '', ...body].join('\n\n')
  const text = stopped ? `${baseText}${STOPPED_FOOTER}` : baseText

  const keyboard: CallbackButton[][] = stopped
    ? [[REFRESH_BUTTON]]
    : visible.map(taskKeyboardRow)

  return { text, keyboard }
}
